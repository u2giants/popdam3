-- Issue #963: durable resolution shape, security and coherence.
begin;

do $$
declare
  v_rls boolean;
  v_count integer;
begin
  select relrowsecurity into v_rls from pg_class where oid = 'plm.source_resolution'::regclass;
  if not v_rls then raise exception 'plm.source_resolution RLS is not enabled'; end if;

  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'plm' and table_name = 'source_resolution'
    and grantee in ('anon','authenticated','service_role')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN');
  if v_count <> 0 then
    raise exception 'direct source_resolution mutation grants exist: %', v_count;
  end if;

  if exists (
       select 1
       from pg_proc p,
            aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where p.oid = 'plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz)'::regprocedure
         and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
     ) or has_function_privilege('anon',
       'plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz)',
       'EXECUTE') then
    raise exception 'source resolution command is executable by PUBLIC/anon';
  end if;
  if not has_function_privilege('authenticated',
       'plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz)',
       'EXECUTE')
     or not has_function_privilege('service_role',
       'plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz)',
       'EXECUTE') then
    raise exception 'source resolution command missing authenticated/service_role execute';
  end if;

  if position('pg_advisory_xact_lock' in pg_get_functiondef(
       'plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz)'::regprocedure
     )) = 0 then
    raise exception 'source resolution command does not serialize first writers';
  end if;

  begin
    execute 'set local role anon';
    perform plm.set_source_resolution(
      'zztest', 'property', 'anon-must-fail', 'unresolved',
      null, null, null, null, null, null
    );
    execute 'reset role';
    raise exception 'anon executed the source resolution command';
  exception when insufficient_privilege then
    execute 'reset role';
  end;

  execute 'set local role authenticated';
  perform plm.set_source_resolution(
    'zztest', 'property', 'authenticated-command', 'unresolved',
    null, null, null, null, null, null
  );
  execute 'reset role';
  delete from plm.source_resolution
    where source_system = 'zztest' and entity_kind = 'property'
      and source_id = 'authenticated-command';

  begin
    insert into plm.source_resolution (
      source_system, entity_kind, source_id, resolution_status
    ) values ('zztest', 'property', 'matched-without-target', 'matched');
    raise exception 'matched resolution without a target was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into plm.source_resolution (
      source_system, entity_kind, source_id, resolution_status, core_property_id
    ) values ('zztest', 'character', 'wrong-kind', 'matched', gen_random_uuid());
    raise exception 'character-to-property target was accepted';
  exception when check_violation or foreign_key_violation then null;
  end;
end;
$$;
rollback;
