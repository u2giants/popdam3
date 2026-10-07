-- #3545: WildBrain Strawberry Shortcake - Classic under Submissions, Creative
-- root/Classic mapped to it, and the owner's do-not-ingest (excluded) decision.
--
-- HOW IT IS RUN
--   .github/workflows/database-contract-tests.yml executes every supabase/tests/*.sql
--   against a THROWAWAY local Supabase stack, wrapped in a single
--   `begin; ... \ir <file>; rollback;` transaction, as the migration owner.
--
-- EVERY VALUE IN THIS FILE IS EITHER THE ONE AUTHORIZED CLASSIC OPTION ID OR
-- INVENTED (ZZTEST- era ids and labels, .invalid URLs). The assertions CALL
-- api.db_data_admin_scraped_source_inventory as a Licensing principal and check
-- the returned rows; they do not string-search the function body.

-- ---------------------------------------------------------------------------
-- A. Schema invariants.
-- ---------------------------------------------------------------------------
do $$
declare
  v_failed boolean;
begin
  if (select count(*) from plm.wildbrain_submission_property_option) <> 1
     or not exists (select 1 from plm.wildbrain_submission_property_option
                    where option_key = 'e608bfe3-a3e2-439a-899d-dc88a59e9b58'
                      and exact_label = 'Strawberry Shortcake Classic') then
    raise exception 'A1: the one Classic option is not the only row';
  end if;

  -- A2. Any other option is refused by the schema, not by convention.
  v_failed := false;
  begin
    insert into plm.wildbrain_submission_property_option
      (option_key, exact_label, ordinal, source_field, source_captured_at)
    values ('zztest-other-option', 'ZZTEST Other', 1, 'EL_PropertyID', now());
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'A2: a second option was accepted'; end if;

  -- A3. RLS on, sibling read policy present, client roles limited to SELECT.
  if not (select relrowsecurity from pg_class
          where oid = 'plm.wildbrain_submission_property_option'::regclass) then
    raise exception 'A3: RLS is not enabled';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'plm'
                   and tablename = 'wildbrain_submission_property_option'
                   and policyname = 'wildbrain_submission_property_option_plm_read'
                   and qual = (select qual from pg_policies where schemaname = 'plm'
                                 and tablename = 'wildbrain_era'
                                 and policyname = 'wildbrain_era_plm_read')) then
    raise exception 'A3: plm_read policy missing or differs from the wildbrain_era sibling';
  end if;
  if has_table_privilege('anon', 'plm.wildbrain_submission_property_option', 'select')
     or has_table_privilege('authenticated', 'plm.wildbrain_submission_property_option', 'insert')
     or not has_table_privilege('authenticated', 'plm.wildbrain_submission_property_option', 'select') then
    raise exception 'A3: client grants differ from the sibling landing tables';
  end if;

  -- A4. excluded is a legal approved decision state and must carry no members.
  if pg_get_constraintdef((select oid from pg_constraint
       where conname = 'dcp_opa_property_resolution_creative_state_ck'
         and conrelid = 'plm.dcp_opa_property_resolution'::regclass)) not like '%excluded%' then
    raise exception 'A4: excluded state missing from the ledger check';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- B. Behaviour through the page's RPC.
-- ---------------------------------------------------------------------------
insert into plm.wildbrain_capture (id, capture_key, source_repository, source_commit_sha,
  source_manifest_sha256, portal_base_url, source_captured_at, status, load_completed_at,
  pagination_verified, reported_total, expected_counts, error_summary, raw_summary, created_by)
values ('35450000-0000-4000-8000-000000000001', 'contract:3545', 'synthetic/repo',
  repeat('a', 40), repeat('b', 64), 'https://zztest.invalid', now(), 'complete', now(),
  true, 3, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, 'contract');

insert into plm.wildbrain_era (capture_id, era_source_id, parent_era_source_id, era_label,
  normalized_era_label, is_root, raw)
values
  ('35450000-0000-4000-8000-000000000001', 'zztest-root', null, 'ZZTEST Root', 'zztest root', true, '{}'),
  ('35450000-0000-4000-8000-000000000001', 'zztest-mapped', 'zztest-root', 'ZZTEST Mapped', 'zztest mapped', false, '{}'),
  ('35450000-0000-4000-8000-000000000001', 'zztest-excluded', 'zztest-root', 'ZZTEST Excluded', 'zztest excluded', false, '{}');

do $$
declare
  v_map uuid := gen_random_uuid();
  v_exc uuid := gen_random_uuid();
  v_bad uuid := gen_random_uuid();
  v_profile uuid; v_auth uuid; v_role uuid;
  v_cursor text; v_result jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_failed boolean;
  v_dcp text := 'dcpvault:zz3545-' || replace(gen_random_uuid()::text, '-', '');
begin
  insert into plm.dcp_opa_property_resolution (resolution_id, source_system, source_table,
    source_property_id, decision_version, approval_status, evidence_reference, evidence_sha256,
    decision_reason, approved_at, approved_by, creative_decision_state)
  values
    (v_map, 'wildbrain_tenovos', 'plm.wildbrain_era', 'zztest-mapped', 1, 'approved',
     'synthetic', repeat('c', 64), 'synthetic mapped', now(), 'contract', 'mapped'),
    (v_exc, 'wildbrain_tenovos', 'plm.wildbrain_era', 'zztest-excluded', 1, 'approved',
     'synthetic', repeat('d', 64), 'synthetic excluded', now(), 'contract', 'excluded');
  insert into plm.dcp_opa_property_resolution_member (resolution_id, submission_source_system,
    submission_source_table, submission_source_id, member_ordinal)
  values (v_map, 'wildbrain_mediabox', 'plm.wildbrain_submission_property_option',
          'e608bfe3-a3e2-439a-899d-dc88a59e9b58', 1);
  set constraints all immediate;
  set constraints all deferred;

  -- B0. The new trigger rule in isolation: a memberless excluded header on its own
  --     is valid at commit time (fails before this migration: the old CHECK has no
  --     'excluded'), and adding one member to it is refused by
  --     plm.enforce_dcp_opa_crosswalk_members, identified by its own message.
  insert into plm.dcp_opa_property_resolution (resolution_id, source_system, source_table,
    source_property_id, decision_version, approval_status, evidence_reference, evidence_sha256,
    decision_reason, approved_at, approved_by, creative_decision_state)
  values (v_bad, 'wildbrain_tenovos', 'plm.wildbrain_era', 'zztest-b0', 1, 'approved',
    'synthetic', repeat('e', 64), 'synthetic excluded control', now(), 'contract', 'excluded');
  set constraints all immediate;
  set constraints all deferred;
  v_failed := false;
  begin
    insert into plm.dcp_opa_property_resolution_member (resolution_id, submission_source_system,
      submission_source_table, submission_source_id, member_ordinal)
    values (v_bad, 'wildbrain_mediabox', 'plm.wildbrain_submission_property_option',
            'e608bfe3-a3e2-439a-899d-dc88a59e9b58', 1);
    set constraints all immediate;
  exception when check_violation then
    if sqlerrm = 'Creative crosswalk state and exact members disagree' then v_failed := true;
    else raise; end if;
  end;
  set constraints all deferred;
  if not v_failed then raise exception 'B0: excluded decision with a member was accepted'; end if;

  select p.id, p.auth_user_id into v_profile, v_auth from app.profile p
   where p.status = 'active' and p.auth_user_id is not null
   order by p.created_at, p.id limit 1;
  if v_profile is null then raise exception 'B: fixture requires an active profile'; end if;
  select r.id into v_role from app.role r where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id = v_profile and role_id = v_role;
  delete from app.app_access where profile_id = v_profile and app in ('plm', 'admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');
  perform set_config('request.jwt.claim.sub', v_auth::text, true);

  v_cursor := null;
  loop
    v_result := api.db_data_admin_scraped_source_inventory('property', null, v_cursor, 1000);
    v_rows := v_rows || coalesce(v_result -> 'rows', '[]'::jsonb);
    v_cursor := v_result ->> 'next_cursor';
    exit when v_cursor is null;
  end loop;

  -- B1. Exactly one WildBrain Submissions row: Classic, grouped with Strawberry Shortcake.
  if (select count(*) from jsonb_array_elements(v_rows) r
       where r ->> 'source_table' = 'plm.wildbrain_submission_property_option') <> 1 then
    raise exception 'B1: expected exactly one WildBrain Submissions row';
  end if;
  select r into v_row from jsonb_array_elements(v_rows) r
   where r ->> 'source_table' = 'plm.wildbrain_submission_property_option';
  if v_row ->> 'source_id' <> 'e608bfe3-a3e2-439a-899d-dc88a59e9b58'
     or v_row ->> 'display_label' <> 'Strawberry Shortcake Classic'
     or v_row ->> 'source_purpose' <> 'Submissions'
     or v_row ->> 'licensor_group_key' <> 'strawberry-shortcake' then
    raise exception 'B1: Classic Submissions row is wrong: %', v_row;
  end if;
  if not (v_row -> 'mapped_creative') @> '[{"source_id":"zztest-mapped"}]'::jsonb then
    raise exception 'B1: Classic does not list its mapped Creative era: %', v_row;
  end if;

  -- B2. The mapped Creative era is mapped to Classic, not red.
  select r into v_row from jsonb_array_elements(v_rows) r
   where r ->> 'source_table' = 'plm.wildbrain_era' and r ->> 'source_id' = 'zztest-mapped';
  if v_row is null or v_row ->> 'mapping_state' <> 'mapped'
     or not (v_row -> 'submissions') @> '[{"source_id":"e608bfe3-a3e2-439a-899d-dc88a59e9b58","display_label":"Strawberry Shortcake Classic"}]'::jsonb then
    raise exception 'B2: mapped Creative era is not mapped to Classic: %', v_row;
  end if;

  -- B3. The excluded era is not returned; an undecided era still shows unmapped.
  if exists (select 1 from jsonb_array_elements(v_rows) r
              where r ->> 'source_table' = 'plm.wildbrain_era' and r ->> 'source_id' = 'zztest-excluded') then
    raise exception 'B3: excluded Creative era is still listed';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_rows) r
                  where r ->> 'source_table' = 'plm.wildbrain_era' and r ->> 'source_id' = 'zztest-root'
                    and r ->> 'mapping_state' = 'unmapped') then
    raise exception 'B3: control era without a decision is no longer shown as unmapped';
  end if;

  -- B4. The source row itself is kept.
  if not exists (select 1 from plm.wildbrain_era where era_source_id = 'zztest-excluded') then
    raise exception 'B4: excluded source row was removed';
  end if;

  -- B5. A Licensing principal reads the option table through RLS.
  set local role authenticated;
  if (select count(*) from plm.wildbrain_submission_property_option) <> 1 then
    raise exception 'B5: Licensing principal cannot read the Classic option through RLS';
  end if;
  reset role;

  -- B6. DCP Vault identity rule: an excluded decision recorded on one retained copy
  --     of a dcpvault:% identity omits every copy of that identity, so no sibling
  --     copy can surface with mapping_state 'excluded'.
  --     #3947 hides the Lucasfilm display twin of a Disney dcpvault identity, so
  --     only the Disney survivor is listed; the Lucasfilm capture row remains.
  insert into plm.dcp_property (source_system, source_id, display_name)
  values ('disney_dcpvault', v_dcp, v_dcp || ' copy A');
  insert into plm.lucasfilm_dcp_property (source_system, source_id, display_name)
  values ('lucasfilm_dcpvault', v_dcp, v_dcp || ' copy B');
  if not exists (select 1 from plm.lucasfilm_dcp_property where source_id = v_dcp) then
    raise exception 'B6: Lucasfilm capture row was removed; display dedupe must not delete captures';
  end if;
  v_result := api.db_data_admin_scraped_source_inventory('property', v_dcp, null, 1000);
  if (select count(*) from jsonb_array_elements(v_result -> 'rows') r
       where r ->> 'source_id' = v_dcp) < 1 then
    raise exception 'B6 (non-vacuity): the Disney survivor must be listed before the decision: %', v_result;
  end if;
  insert into plm.dcp_opa_property_resolution (source_system, source_table, source_property_id,
    decision_version, approval_status, evidence_reference, evidence_sha256, decision_reason,
    approved_at, approved_by, creative_decision_state)
  values ('disney_dcpvault', 'plm.dcp_property', v_dcp, 1, 'approved', 'synthetic',
    repeat('f', 64), 'synthetic excluded copy', now(), 'contract', 'excluded');
  v_result := api.db_data_admin_scraped_source_inventory('property', v_dcp, null, 1000);
  if exists (select 1 from jsonb_array_elements(v_result -> 'rows') r
              where r ->> 'source_id' = v_dcp) then
    raise exception 'B6: a retained copy of an excluded dcpvault identity is still listed: %', v_result;
  end if;

  -- B7. Property Matching is unchanged and passes the settled value through verbatim.
  v_result := api.db_data_admin_scraped_properties('ZZTEST Excluded', null, 100);
  if not exists (select 1 from jsonb_array_elements(v_result -> 'rows') r
                  where r ->> 'source_table' = 'plm.wildbrain_era'
                    and r ->> 'source_property_id' = 'zztest-excluded'
                    and r ->> 'mapping_state' = 'excluded'
                    and r ->> 'contract_status' = 'unknown') then
    raise exception 'B7: Property Matching does not pass the excluded decision through: %', v_result;
  end if;
end $$;
