-- Issue #2085: the browser-reachable wrapper exists, anon is denied, and an
-- `authenticated` caller can record a durable decision through it.
begin;

-- Shape and grant truth.
do $$
declare
  v_signature text := 'api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz)';
  v_definition text;
begin
  if to_regprocedure(v_signature) is null then
    raise exception 'api.set_source_resolution is missing';
  end if;
  v_definition := lower(pg_get_functiondef(v_signature::regprocedure));
  if position('security definer' in v_definition) = 0 then
    raise exception 'api.set_source_resolution is not security definer';
  end if;
  if position('pg_catalog' in v_definition) = 0 or position('search_path' in v_definition) = 0 then
    raise exception 'api.set_source_resolution does not pin its search_path';
  end if;
  if position('plm.set_source_resolution' in v_definition) = 0 then
    raise exception 'api.set_source_resolution does not delegate to the only write path';
  end if;

  -- The wrapper must not widen reach beyond the setter it fronts.
  if has_function_privilege('anon', v_signature::regprocedure, 'EXECUTE')
     or has_function_privilege('public', v_signature::regprocedure, 'EXECUTE') then
    raise exception 'api.set_source_resolution is reachable without a JWT';
  end if;
  if not has_function_privilege('authenticated', v_signature::regprocedure, 'EXECUTE')
     or not has_function_privilege('service_role', v_signature::regprocedure, 'EXECUTE') then
    raise exception 'api.set_source_resolution is missing its intended grants';
  end if;

  -- Direct table mutation must still be impossible for every API role.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema='plm' and table_name='source_resolution'
       and grantee in ('anon','authenticated','service_role')
       and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
  ) then raise exception 'the wrapper is not the narrowest write path'; end if;
end;
$$;

-- anon is denied at call time, not merely on paper.
set local role anon;
do $$
begin
  perform api.set_source_resolution('paramount','property','contract-test-2085-anon','no_match',
    null,null,null,null,'ZZTEST anon',null);
  raise exception 'anon was allowed to record a source resolution';
exception when insufficient_privilege then null;
end;
$$;
reset role;

-- An authenticated caller succeeds and the decision lands durably.
set local role authenticated;
do $$
declare
  v_row plm.source_resolution;
begin
  v_row := api.set_source_resolution('paramount','property','contract-test-2085-authenticated','no_match',
    null,null,null,null,'ZZTEST authenticated',null);
  if v_row.resolution_status <> 'no_match' then
    raise exception 'wrapper returned status %, expected no_match', v_row.resolution_status;
  end if;
  if coalesce(v_row.resolved_by,'') = '' then
    raise exception 'wrapper did not stamp an actor';
  end if;
  if not exists (
    select 1 from api.source_resolution
     where source_system='paramount' and entity_kind='property'
       and source_id='contract-test-2085-authenticated'
  ) then raise exception 'the authenticated decision is not visible on the read path'; end if;
end;
$$;
reset role;

rollback;
