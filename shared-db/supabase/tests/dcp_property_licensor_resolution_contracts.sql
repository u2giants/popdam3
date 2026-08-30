-- Rollback-safe, synthetic aggregate-only contract for issue #1592.

begin;

do $$
declare
  v_sig text := 'api.db_data_admin_scraped_properties(text,text,integer)';
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
  v_search := 'Issue1592-' || v_suffix;

  if not (select relrowsecurity from pg_class
          where oid = 'plm.dcp_property_licensor_resolution'::regclass) then
    raise exception 'DCP licensor resolution RLS is not enabled';
  end if;
  if has_table_privilege('public', 'plm.dcp_property_licensor_resolution', 'select')
     or has_table_privilege('anon', 'plm.dcp_property_licensor_resolution', 'select')
     or has_table_privilege('authenticated', 'plm.dcp_property_licensor_resolution', 'select')
     or has_table_privilege('authenticated', 'plm.dcp_property_licensor_resolution', 'insert') then
    raise exception 'private DCP licensor resolution grants are too broad';
  end if;
  if not has_table_privilege('service_role', 'plm.dcp_property_licensor_resolution', 'select')
     or not has_table_privilege('service_role', 'plm.dcp_property_licensor_resolution', 'insert')
     or has_table_privilege('service_role', 'plm.dcp_property_licensor_resolution', 'update')
     or has_table_privilege('service_role', 'plm.dcp_property_licensor_resolution', 'delete')
     or has_table_privilege('service_role', 'plm.dcp_property_licensor_resolution', 'truncate') then
    raise exception 'service-role resolution loading grant is incomplete';
  end if;

  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1;
  select r.id into v_role_id from app.role r where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id = v_profile and role_id = v_role_id;
  delete from app.app_access where profile_id = v_profile and app in ('plm', 'admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');
  perform set_config('request.jwt.claim.sub', v_auth::text, true);

  insert into plm.dcp_property (source_system, source_id, display_name)
  select 'disney_dcpvault', v_search || '/d-' || g, v_search || '-D-' || g
  from generate_series(1, 3) g;
  insert into plm.marvel_dcp_property (source_system, source_id, display_name)
  select 'marvel_dcpvault', v_search || '/m-' || g, v_search || '-M-' || g
  from generate_series(1, 2) g;
  insert into plm.lucasfilm_dcp_property (source_system, source_id, display_name)
  select 'lucasfilm_dcpvault', v_search || '/l-' || g, v_search || '-L-' || g
  from generate_series(1, 2) g;

  insert into plm.dcp_property_licensor_resolution (
    source_system, source_property_id, presentation_licensor_key,
    presentation_licensor_name, resolution_status, authority_kind,
    authority_reference, evidence_reference, source_hash, resolved_at,
    decision_version, approval_status, approved_at, approved_by, decision_reason
  ) values
    ('disney_dcpvault', v_search || '/d-1', 'disney', 'Disney',
     'supported_signed_contract', 'signed_contract', 'synthetic-authority',
     'private-evidence-pointer', repeat('1',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision'),
    ('disney_dcpvault', v_search || '/d-2', 'marvel', 'Marvel',
     'supported_core_ownership', 'canonical_core', 'synthetic-authority',
     'private-evidence-pointer', repeat('2',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision'),
    ('disney_dcpvault', v_search || '/d-3', 'star-wars', 'Star Wars',
     'supported_owner_approved_opa', 'owner_approved_opa', 'synthetic-authority',
     'private-evidence-pointer', repeat('3',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision'),
    ('marvel_dcpvault', v_search || '/m-1', null, null,
     'authority_conflict', 'multiple_authorities', 'synthetic-authority',
     'private-evidence-pointer', repeat('4',64), null, 1, 'approved', now(), 'contract', 'synthetic conflict'),
    ('marvel_dcpvault', v_search || '/m-2', null, null,
     'unresolved', null, null, null, repeat('5',64), null, 1, 'approved', now(), 'contract', 'synthetic unresolved'),
    ('lucasfilm_dcpvault', v_search || '/l-1', 'disney', 'Disney',
     'supported_core_ownership', 'canonical_core', 'synthetic-authority',
     'private-evidence-pointer', repeat('6',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision');
  -- l-2 deliberately has no mapping and must fail closed.

  loop
    select api.db_data_admin_scraped_properties(v_search, v_cursor, 2) into v_page;
    v_rows := v_rows || (v_page -> 'rows');
    v_cursor := v_page ->> 'next_cursor';
    v_pages := v_pages + 1;
    exit when v_cursor is null;
    if v_pages > 5 then raise exception 'pagination did not terminate'; end if;
  end loop;

  select count(*) into v_count from jsonb_array_elements(v_rows);
  if v_count <> 7 or (select count(distinct r ->> 'row_key')
      from jsonb_array_elements(v_rows) r) <> 7 then
    raise exception 'DCP exact-once coverage changed: % rows', v_count;
  end if;

  if (select count(*) from jsonb_array_elements(v_rows) r
      where r ->> 'presentation_licensor_name' = 'DCP Creative - unresolved authority') <> 5
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'presentation_licensor_name' = 'DCP Vault - Creative (non-authoritative Marvel tag)') <> 2
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'presentation_licensor_name' = 'Disney - Creative (DCP Vault)') <> 0
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'presentation_licensor_name' = 'Lucasfilm / Star Wars - Creative (DCP Vault)') <> 0
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'presentation_licensor_name' = 'DCP Creative - contract/OPA conflict') <> 0 then
    raise exception 'retired DCP resolution history still controls current authority';
  end if;

  if exists (select 1 from jsonb_array_elements(v_rows) r
             where r ->> 'source_table' = 'plm.dcp_property'
               and r ->> 'source_property_id' = v_search || '/d-2'
               and r ->> 'presentation_licensor_name' <> 'DCP Creative - unresolved authority')
     or exists (select 1 from jsonb_array_elements(v_rows) r
               where r ->> 'source_table' = 'plm.lucasfilm_dcp_property'
                 and r ->> 'source_property_id' = v_search || '/l-1'
                 and r ->> 'presentation_licensor_name' <> 'DCP Creative - unresolved authority') then
    raise exception 'landing-table family still controls presentation licensor';
  end if;

  if exists (select 1 from jsonb_array_elements(v_rows) r
             where r ?| array['authority_reference','evidence_reference','source_hash','authority_kind']) then
    raise exception 'private DCP resolution evidence leaked through the API';
  end if;
end $$;

rollback;
