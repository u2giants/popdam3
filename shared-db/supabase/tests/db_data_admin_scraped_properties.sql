-- Rollback-safe contract for issues #1533 and #1546.

begin;

do $$
declare
  v_sig text := 'api.db_data_admin_scraped_properties(text,text,integer)';
  v_definition text;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_search text;
  v_capture_old uuid := '00000000-0000-0000-0000-000000000001';
  v_capture_new uuid := '00000000-0000-0000-0000-000000000002';
  v_pmt_complete uuid := gen_random_uuid();
  v_pmt_ineligible uuid := gen_random_uuid();
  v_nbcu_complete uuid := gen_random_uuid();
  v_nbcu_ineligible uuid := gen_random_uuid();
  v_pmt_source_id text := '9999991533';
  v_role_id uuid;
  v_profile uuid;
  v_auth uuid;
  v_denied_profile uuid;
  v_denied_auth uuid;
  v_page jsonb;
  v_rows jsonb;
  v_count integer;
  v_cursor text;
  v_walk_rows jsonb := '[]'::jsonb;
  v_walk_pages integer := 0;
begin
  v_search := 'Issue1533-' || v_suffix;

  if to_regprocedure(v_sig) is null then
    raise exception 'missing scraped Properties function: %', v_sig;
  end if;
  if has_function_privilege('public', v_sig::regprocedure, 'execute')
     or has_function_privilege('anon', v_sig::regprocedure, 'execute')
     or has_function_privilege('service_role', v_sig::regprocedure, 'execute') then
    raise exception 'scraped Properties function is executable outside authenticated';
  end if;
  if not has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
    raise exception 'authenticated cannot execute scraped Properties function';
  end if;

  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p where p.oid = v_sig::regprocedure;

  if position('app.require_licensing_manager_access()' in v_definition) = 0 then
    raise exception 'licensing-manager gate is missing';
  end if;

  if position('plm.opa_property' in v_definition) = 0
     or position('plm.dcp_property' in v_definition) = 0
     or position('plm.marvel_dcp_property' in v_definition) = 0
     or position('plm.lucasfilm_dcp_property' in v_definition) = 0
     or position('plm.twentieth_century_dcp_property' in v_definition) = 0
     or position('plm.pmt_property' in v_definition) = 0
     or position('plm.pmt_capture' in v_definition) = 0
     or position('plm.wb_property' in v_definition) = 0
     or position('plm.nbcu_property' in v_definition) = 0
     or position('plm.nbcu_capture' in v_definition) = 0
     or position('plm.sega_property' in v_definition) = 0
     or position('plm.sega_property_licensor' in v_definition) = 0 then
    raise exception 'source Property union is incomplete';
  end if;

  if position('plm.wb_franchise' in v_definition) <> 0
     or position('plm.pmt_collection' in v_definition) <> 0
     or position('plm.dcp_style_guide' in v_definition) <> 0
     or position('core.property' in v_definition) <> 0 then
    raise exception 'contract includes a non-source-Property vocabulary';
  end if;

  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1;
  select p.id, p.auth_user_id into v_denied_profile, v_denied_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 1;
  if v_denied_profile is null then
    raise exception 'fixture requires two active authenticated profiles';
  end if;

  select r.id into v_role_id from app.role r where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id in (v_profile, v_denied_profile) and role_id = v_role_id;
  delete from app.app_access where profile_id in (v_profile, v_denied_profile) and app in ('plm','admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');

  perform set_config('request.jwt.claim.sub', v_denied_auth::text, true);
  begin
    perform api.db_data_admin_scraped_properties(v_search, null, 100);
    raise exception 'unauthorized caller was allowed';
  exception when insufficient_privilege then null;
  end;

  insert into plm.dcp_property (source_system, source_id, display_name)
  values ('disney_dcpvault', v_search || '/journey-to-the-moon''s-edge', null);
  insert into plm.marvel_dcp_property (source_system, source_id, display_name)
  values ('marvel_dcpvault', v_search || '/ignored-derived-name', v_search || ' Marvel name');
  insert into plm.lucasfilm_dcp_property (source_system, source_id, display_name)
  values ('lucasfilm_dcpvault', v_search || '/galaxy_far_far_away', null);

  insert into plm.dcp_property_licensor_resolution (
    source_system, source_property_id, presentation_licensor_key,
    presentation_licensor_name, resolution_status, authority_kind,
    authority_reference, evidence_reference, source_hash, resolved_at,
    decision_version, approval_status, approved_at, approved_by, decision_reason
  ) values
    ('disney_dcpvault', v_search || '/journey-to-the-moon''s-edge', 'disney', 'Disney',
     'supported_core_ownership', 'synthetic', 'synthetic', 'synthetic', repeat('a',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision'),
    ('marvel_dcpvault', v_search || '/ignored-derived-name', 'marvel', 'Marvel',
     'supported_core_ownership', 'synthetic', 'synthetic', 'synthetic', repeat('b',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision'),
    ('lucasfilm_dcpvault', v_search || '/galaxy_far_far_away', 'star-wars', 'Star Wars',
     'supported_core_ownership', 'synthetic', 'synthetic', 'synthetic', repeat('c',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision');

  -- Fixed, non-licensed synthetic IDs exercise malformed terminal segments and
  -- prove that a DCP studio outside #1546's three-target allowlist keeps the
  -- pre-existing explicit fallback.
  insert into plm.dcp_property (source_system, source_id, display_name) values
    ('disney_dcpvault', 'zz-contract-1546/trailing/', null),
    ('disney_dcpvault', 'zz-contract-1546/---___', null),
    ('disney_dcpvault', 'zz-contract-1546/we''re-ready', null);
  insert into plm.twentieth_century_dcp_property (source_system, source_id, display_name)
  values ('twentieth_century_dcpvault', 'zz-contract-1546/not-targeted', null);

  insert into plm.pmt_capture (
    capture_id, status, capture_kind, source_url, library_name, started_at,
    completed_at, captured_by, private_source_commit, manifest_sha256,
    portal_global_asset_count, licensed_title_count,
    licensed_property_selection_count, property_result_row_count,
    unique_asset_count, metadata_batch_count, failure_count, anomaly_count,
    validated_at, validation_passed
  ) values
    (v_pmt_complete, 'complete', 'full', 'https://invalid.example', 'contract-test',
     '2026-08-24T00:00:00Z', '2026-08-24T00:01:00Z', 'contract-test',
     repeat('5', 40), repeat('5', 64), 0, 0, 0, 0, 0, 0, 0, 0,
     '2026-08-24T00:01:00Z', true),
    (v_pmt_ineligible, 'complete', 'targeted', 'https://invalid.example', 'contract-test',
     '2026-08-25T00:00:00Z', '2026-08-25T00:01:00Z', 'contract-test',
     repeat('6', 40), repeat('6', 64), 0, 0, 0, 0, 0, 0, 0, 0,
     '2026-08-25T00:01:00Z', true);

  insert into plm.pmt_property (
    capture_id, property_source_id, property_name, source_hash, imported_at
  ) values
    (v_pmt_complete, v_pmt_source_id, v_search || ' Paramount complete', repeat('7', 64),
     '2026-08-24T00:01:00Z'),
    (v_pmt_ineligible, v_pmt_source_id, v_search || ' Paramount targeted', repeat('8', 64),
     '2026-08-25T00:01:00Z');

  insert into plm.nbcu_capture (
    id, capture_key, source_repository, source_commit_sha,
    source_manifest_sha256, portal_base_url, source_captured_at,
    load_completed_at, status, expected_counts, observed_counts,
    error_summary, raw_summary, created_by
  ) values
    (v_nbcu_complete, v_search || '-nbcu-complete', 'synthetic-test', repeat('9', 40),
     repeat('9', 64), 'https://invalid.example', '2026-08-24T00:00:00Z',
     '2026-08-24T00:01:00Z', 'complete', '{}', '{}', '[]', '{}', 'contract-test'),
    (v_nbcu_ineligible, v_search || '-nbcu-loading', 'synthetic-test', repeat('a', 40),
     repeat('a', 64), 'https://invalid.example', '2026-08-25T00:00:00Z',
     null, 'loading', '{}', '{}', '[]', '{}', 'contract-test');

  insert into plm.nbcu_property (
    capture_id, property_key, property_source_id, property_label, source_kind,
    source_url, source_captured_at, raw
  ) values
    (v_nbcu_complete, 'source-id:' || v_search || '-NBCU', v_search || '-NBCU',
     v_search || ' NBCU complete', 'property', 'https://invalid.example',
     '2026-08-24T00:00:00Z', '{}'),
    (v_nbcu_ineligible, 'source-id:' || v_search || '-NBCU', v_search || '-NBCU',
     v_search || ' NBCU loading', 'property', 'https://invalid.example',
     '2026-08-25T00:00:00Z', '{}');

  insert into plm.sega_capture (
    id, capture_key, source_repository, source_commit_sha,
    source_manifest_sha256, portal_base_url, source_captured_at,
    load_completed_at, status, expected_counts, observed_counts,
    is_limited, ip_paging_terminal, asset_paging_terminal,
    ip_associations_complete, error_summary, raw_summary, created_by
  ) values
    (v_capture_old, v_search || '-old', 'synthetic-test', repeat('1',40),
     repeat('1',64), 'https://invalid.example', '2026-08-24T00:00:00Z',
     '2026-08-24T00:01:00Z', 'complete', '{}', '{}', false, true, true,
     true, '[]', '{}', 'contract-test'),
    (v_capture_new, v_search || '-new', 'synthetic-test', repeat('2',40),
     repeat('2',64), 'https://invalid.example', '2026-08-25T00:00:00Z',
     '2026-08-25T00:01:00Z', 'complete', '{}', '{}', false, true, true,
     true, '[]', '{}', 'contract-test');

  insert into plm.sega_property (
    capture_id, property_source_id, property_label, source_status,
    source_url, source_hash, raw
  ) values
    (v_capture_old, v_search || '-Sega', v_search || ' Sega old', 'old',
     'https://invalid.example', repeat('3',64), '{}'),
    (v_capture_new, v_search || '-Sega', v_search || ' Sega new', 'active',
     'https://invalid.example', repeat('4',64), '{}');

  insert into plm.sega_property_licensor (
    capture_id, property_source_id, licensor_ordinal,
    licensor_label, normalized_licensor_label, raw
  ) values
    (v_capture_old, v_search || '-Sega', 1, 'SEGA', 'sega', '{}'),
    (v_capture_new, v_search || '-Sega', 1, 'SEGA', 'sega', '{}'),
    (v_capture_new, v_search || '-Sega', 2, 'ATLUS', 'atlus', '{}');

  perform set_config('request.jwt.claim.sub', v_auth::text, true);
  select api.db_data_admin_scraped_properties(v_search, null, 100) into v_page;
  v_rows := v_page -> 'rows';

  select count(*) into v_count from jsonb_array_elements(v_rows);
  if v_count <> 7 then
    raise exception 'expected seven exact fixture rows, got %', v_count;
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'presentation_licensor_name' = 'Disney - Creative (DCP Vault)'
      and r ->> 'source_table' = 'plm.dcp_property'
  ) or not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'presentation_licensor_name' = 'DCP Vault - non-authoritative Marvel tag'
      and r ->> 'source_table' = 'plm.marvel_dcp_property'
  ) or not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'presentation_licensor_name' = 'Lucasfilm / Star Wars - Creative (DCP Vault)'
      and r ->> 'source_system' = 'lucasfilm_dcpvault'
  ) then
    raise exception 'Disney Creative, retained Marvel-tag evidence, and Star Wars Creative groups are not distinct';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_property_id' = v_search || '/journey-to-the-moon''s-edge'
      and r -> 'source_property_name' = 'null'::jsonb
      and r ->> 'display_label' = 'Journey to the Moon''s Edge'
  ) then
    raise exception 'Disney DCP terminal slug was not converted to a presentation label';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_property_id' = v_search || '/ignored-derived-name'
      and r ->> 'source_property_name' = v_search || ' Marvel name'
      and r ->> 'display_label' = v_search || ' Marvel name'
  ) then
    raise exception 'future nonblank Marvel source display name did not override derivation';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_property_id' = v_search || '/galaxy_far_far_away'
      and r -> 'source_property_name' = 'null'::jsonb
      and r ->> 'display_label' = 'Galaxy Far Far Away'
      and r ->> 'presentation_licensor_name' = 'Lucasfilm / Star Wars - Creative (DCP Vault)'
      and r ->> 'source_system' = 'lucasfilm_dcpvault'
  ) then
    raise exception 'Lucasfilm DCP underscore slug or Star Wars provenance changed';
  end if;

  select api.db_data_admin_scraped_properties('zz-contract-1546', null, 100) into v_page;
  v_rows := v_page -> 'rows';
  if not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_property_id' = 'zz-contract-1546/trailing/'
      and r ->> 'display_label' = '[Unlabeled source ID: zz-contract-1546/trailing/]'
  ) or not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_property_id' = 'zz-contract-1546/---___'
      and r ->> 'display_label' = '[Unlabeled source ID: zz-contract-1546/---___]'
  ) then
    raise exception 'malformed or empty DCP terminal segment did not retain fallback';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_property_id' = 'zz-contract-1546/we''re-ready'
      and r ->> 'display_label' = 'We''re Ready'
  ) then
    raise exception 'common apostrophe contraction was not capitalized conservatively';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.twentieth_century_dcp_property'
      and r ->> 'source_property_id' = 'zz-contract-1546/not-targeted'
      and r ->> 'display_label' = '[Unlabeled source ID: zz-contract-1546/not-targeted]'
  ) then
    raise exception 'non-target source fallback changed';
  end if;

  -- Restore the main fixture result for the remaining source and pagination checks.
  select api.db_data_admin_scraped_properties(v_search, null, 100) into v_page;
  v_rows := v_page -> 'rows';

  select count(*) into v_count
  from jsonb_array_elements(v_rows) r
  where r ->> 'source_property_id' = v_search || '-Sega';
  if v_count <> 2 then
    raise exception 'Sega capture repeats or multi-Licensor rows were collapsed incorrectly: %', v_count;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_property_id' = v_search || '-Sega'
      and r ->> 'capture_marker' <> v_capture_new::text
  ) then
    raise exception 'Sega capture deduplication did not select one deterministic capture';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.pmt_property'
      and r ->> 'source_property_name' = v_search || ' Paramount complete'
  ) or exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_property_name' = v_search || ' Paramount targeted'
  ) then
    raise exception 'Paramount served an ineligible targeted capture';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.nbcu_property'
      and r ->> 'source_property_name' = v_search || ' NBCU complete'
  ) or exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_property_name' = v_search || ' NBCU loading'
  ) then
    raise exception 'NBCUniversal served an ineligible loading capture';
  end if;

  -- Walk the complete result one row at a time. This catches gaps, repeats, and
  -- next-cursor mistakes that a single first-page assertion cannot detect.
  v_cursor := null;
  loop
    select api.db_data_admin_scraped_properties(v_search, v_cursor, 1) into v_page;
    v_walk_pages := v_walk_pages + 1;
    v_walk_rows := v_walk_rows || (v_page -> 'rows');
    v_cursor := v_page ->> 'next_cursor';
    exit when v_cursor is null;
    if v_walk_pages > 20 then
      raise exception 'pagination cursor did not terminate';
    end if;
  end loop;

  select count(*) into v_count from jsonb_array_elements(v_walk_rows);
  if v_count <> 7 or (
    select count(distinct r ->> 'row_key') from jsonb_array_elements(v_walk_rows) r
  ) <> 7 then
    raise exception 'pagination walk omitted or repeated fixture rows';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ?| array['raw','source_url','licensed_asset','metadata']
  ) then
    raise exception 'restricted raw/source fields leaked through the contract';
  end if;

  begin
    perform api.db_data_admin_scraped_properties(v_search, 'not-base64!', 100);
    raise exception 'invalid cursor accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

rollback;
