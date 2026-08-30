-- Rollback-safe contract for issue #1589. The 1,445 generated rows reproduce
-- only the aggregate studio-resolution shape; no licensed OPA row is embedded.

begin;

do $$
declare
  v_sig text := 'api.db_data_admin_scraped_properties(text,text,integer)';
  v_definition text;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_search text;
  v_role_id uuid;
  v_profile uuid;
  v_auth uuid;
  v_page jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_cursor text;
  v_pages integer := 0;
  v_count integer;
begin
  v_search := 'Issue1589-' || v_suffix;

  if to_regprocedure(v_sig) is null then
    raise exception 'missing scraped Properties function: %', v_sig;
  end if;
  if has_function_privilege('public', v_sig::regprocedure, 'execute')
     or has_function_privilege('anon', v_sig::regprocedure, 'execute')
     or has_function_privilege('service_role', v_sig::regprocedure, 'execute')
     or not has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
    raise exception 'scraped Properties execution grants changed';
  end if;

  select pg_get_functiondef(v_sig::regprocedure) into v_definition;
  if position('app.require_licensing_manager_access()' in v_definition) = 0
     or position('plm.opa_property_studio_resolution' in v_definition) = 0
     or position('Disney OPA (unsplit)' in v_definition) <> 0 then
    raise exception 'authorization, OPA resolution, or retired-group contract changed';
  end if;

  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id
  limit 1;
  if v_profile is null then
    raise exception 'fixture requires one active authenticated profile';
  end if;

  select r.id into v_role_id
  from app.role r
  where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id = v_profile and role_id = v_role_id;
  delete from app.app_access where profile_id = v_profile and app in ('plm', 'admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');
  perform set_config('request.jwt.claim.sub', v_auth::text, true);

  insert into plm.opa_property (licensed_property_id, property_name)
  select -800000000000 - g, v_search || '-OPA-' || lpad(g::text, 4, '0')
  from generate_series(1, 1445) g;

  insert into plm.opa_property_studio_resolution (
    licensed_property_id, studio_code, resolution_status, provenance_type,
    provenance_reference, resolution_reason, resolved_by
  )
  select
    -800000000000 - g,
    case
      when g between 1 and 244 then 'disney'
      when g between 245 and 449 then 'marvel'
      when g between 450 and 451 then 'lucasfilm'
      when g between 452 and 515 then 'pixar'
      else null
    end,
    case
      when g <= 515 then 'canonical'
      when g <= 535 then 'ambiguous_crossover'
      else 'unresolved'
    end,
    case
      when g <= 515 then 'owner_reviewed_resolution'
      when g <= 535 then 'ambiguous_crossover'
      else 'unresolved'
    end,
    case when g <= 535 then 'synthetic-contract' else null end,
    null,
    'issue-1589-contract'
  from generate_series(1, 1445) g;

  -- These source-preserving DCP groups must remain distinct from the new OPA groups.
  insert into plm.dcp_property (source_system, source_id, display_name)
  values ('disney_dcpvault', v_search || '/disney-dcp', v_search || ' Disney DCP');
  insert into plm.marvel_dcp_property (source_system, source_id, display_name)
  values ('marvel_dcpvault', v_search || '/marvel-dcp', v_search || ' Marvel DCP');
  insert into plm.lucasfilm_dcp_property (source_system, source_id, display_name)
  values ('lucasfilm_dcpvault', v_search || '/star-wars-dcp', v_search || ' Star Wars DCP');

  insert into plm.dcp_property_licensor_resolution (
    source_system, source_property_id, presentation_licensor_key,
    presentation_licensor_name, resolution_status, authority_kind,
    authority_reference, evidence_reference, source_hash, resolved_at,
    decision_version, approval_status, approved_at, approved_by, decision_reason
  ) values
    ('disney_dcpvault', v_search || '/disney-dcp', 'disney', 'Disney',
     'supported_core_ownership', 'synthetic', 'synthetic', 'synthetic', repeat('a',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision'),
    ('marvel_dcpvault', v_search || '/marvel-dcp', 'marvel', 'Marvel',
     'supported_core_ownership', 'synthetic', 'synthetic', 'synthetic', repeat('b',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision'),
    ('lucasfilm_dcpvault', v_search || '/star-wars-dcp', 'star-wars', 'Star Wars',
     'supported_core_ownership', 'synthetic', 'synthetic', 'synthetic', repeat('c',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision');

  v_cursor := null;
  loop
    select api.db_data_admin_scraped_properties(v_search, v_cursor, 1000) into v_page;
    v_rows := v_rows || (v_page -> 'rows');
    v_cursor := v_page ->> 'next_cursor';
    v_pages := v_pages + 1;
    exit when v_cursor is null;
    if v_pages > 3 then
      raise exception 'OPA pagination did not terminate';
    end if;
  end loop;

  select count(*) into v_count
  from jsonb_array_elements(v_rows) r
  where r ->> 'source_table' = 'plm.opa_property';
  if v_count <> 1445 then
    raise exception 'expected exactly 1,445 OPA rows, got %', v_count;
  end if;

  select count(distinct r ->> 'source_property_id') into v_count
  from jsonb_array_elements(v_rows) r
  where r ->> 'source_table' = 'plm.opa_property';
  if v_count <> 1445 then
    raise exception 'OPA source identities were omitted or repeated: % distinct', v_count;
  end if;

  if (select count(*) from jsonb_array_elements(v_rows) r
      where r ->> 'source_table' = 'plm.opa_property'
        and r ->> 'presentation_licensor_name' = 'Disney - Submissions (OPA)') <> 244
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'source_table' = 'plm.opa_property'
           and r ->> 'presentation_licensor_name' = 'Marvel - Submissions (OPA)') <> 205
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'source_table' = 'plm.opa_property'
           and r ->> 'presentation_licensor_name' = 'Lucasfilm / Star Wars - Submissions (OPA)') <> 2
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'source_table' = 'plm.opa_property'
           and r ->> 'presentation_licensor_name' = 'Pixar - Submissions (OPA)') <> 64
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'source_table' = 'plm.opa_property'
           and r ->> 'presentation_licensor_name' = 'OPA - Submissions (scope conflict)') <> 20
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'source_table' = 'plm.opa_property'
           and r ->> 'presentation_licensor_name' = 'OPA - Submissions (unresolved)') <> 910 then
    raise exception 'the six OPA presentation outcomes changed';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'presentation_licensor_name' = 'Disney OPA (unsplit)'
  ) then
    raise exception 'retired Disney OPA unsplit group remains visible';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.dcp_property'
      and r ->> 'presentation_licensor_name' = 'DCP Creative - unresolved authority'
      and r ->> 'source_system' = 'disney_dcpvault'
  ) or not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.marvel_dcp_property'
      and r ->> 'presentation_licensor_name' = 'DCP Vault - Creative (non-authoritative Marvel tag)'
      and r ->> 'source_system' = 'marvel_dcpvault'
  ) or not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.lucasfilm_dcp_property'
      and r ->> 'presentation_licensor_name' = 'DCP Creative - unresolved authority'
      and r ->> 'source_system' = 'lucasfilm_dcpvault'
  ) then
    raise exception 'DCP Creative authority presentation or provenance changed';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ?| array['raw', 'source_url', 'licensed_asset', 'metadata']
  ) then
    raise exception 'restricted fields leaked through the API envelope';
  end if;
end $$;

rollback;
