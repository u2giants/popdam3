-- #3947: behavioral proof that Warner fallback twins are hidden, Sesame
-- brand generations collapse to one row per value_key, and Lucasfilm rows
-- that duplicate a Disney DCP identity are hidden while unique Lucasfilm
-- identities and all saved matching decisions are preserved.
--
-- HOW IT IS RUN
--   .github/workflows/database-contract-tests.yml executes every supabase/tests/*.sql
--   against a THROWAWAY local Supabase stack, wrapped in a single
--   `begin; ... \ir <file>; rollback;` transaction, as the migration owner.
--
-- EVERY VALUE IN THIS FILE IS INVENTED (ZZTEST- labels). The assertions CALL
-- api.db_data_admin_scraped_source_inventory as a Licensing principal and check
-- the returned rows; they do not string-search the function body.

do $$
declare
  v_profile uuid;
  v_auth uuid;
  v_role_id uuid;
  v_result jsonb;
  v_rows jsonb;
  v_capture_id uuid;
  v_sesame_capture_id uuid;
  v_warner_fallback_count integer := 0;
  v_warner_source_count integer := 0;
  v_sesame_count integer := 0;
  v_shared_disney_count integer := 0;
  v_shared_lucasfilm_count integer := 0;
  v_unique_lucasfilm_count integer := 0;
  v_shared_conflict_count integer := 0;
  v_page_warner_fallback integer;
  v_page_warner_source integer;
  v_page_sesame integer;
  v_page_shared_disney integer;
  v_page_shared_lucasfilm integer;
  v_page_unique_lucasfilm integer;
  v_page_shared_conflict integer;
  v_cursor text;
begin
  -- Licensing principal fixture.
  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1;
  if v_profile is null then
    raise exception 'fixture requires an active authenticated profile';
  end if;
  select r.id into v_role_id from app.role r where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id = v_profile and role_id = v_role_id;
  delete from app.app_access where profile_id = v_profile and app in ('plm', 'admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');
  perform set_config('request.jwt.claim.sub', v_auth::text, true);

  -- Warner: create a capture header then a source_id row and its fallback twin.
  insert into plm.wb_capture
    (capture_id, chunk_number, target, status, captured_at,
     private_source_commit, snapshot_sha256, expected_row_count,
     captured_by, source_url, started_at)
  values
    (extensions.gen_random_uuid(), 0, 'wb_property', 'loading', current_date,
     'zztest', repeat('a', 64), 2,
     'zztest', 'https://example.invalid', now())
  returning capture_id into v_capture_id;

  insert into plm.wb_property
    (source_namespace, identity_method, source_id, fallback_key, label,
     capture_id, capture_chunk, source_url, raw, source_hash)
  values
    ('warner_art_assets', 'source_id', 'zztest-3947-src', null,
     'ZZTEST Warner Twin', v_capture_id, 0, 'https://example.invalid', '{}'::jsonb, 'zztest-hash-1'),
    ('warner_art_assets', 'natural_key_fallback', null, 'zztest-3947-fb',
     'ZZTEST Warner Twin', v_capture_id, 0, 'https://example.invalid', '{}'::jsonb, 'zztest-hash-2');

  -- Sesame: one value_key with both a legacy and a current generation row.
  insert into plm.sesame_capture
    (capture_key, source_repository, source_commit_sha, source_manifest_sha256,
     portal_base_url, portal_slug, source_captured_at, status, expected_counts,
     load_completed_at, category_tree_walked, pagination_verified,
     multivalue_parse_verified, raw_summary, created_by)
  values
    ('zztest-3947-sesame', 'https://example.invalid', repeat('b', 40), repeat('c', 64),
     'https://example.invalid', 'zztest', now(), 'complete', '{}'::jsonb,
     now(), true, true,
     true, '{}'::jsonb, 'zztest')
  returning id into v_sesame_capture_id;

  insert into plm.sesame_brand
    (capture_id, value_key, value_label, field_generation, asset_count, raw)
  values
    (v_sesame_capture_id, 'zztest 3947 sesame', 'zztest 3947 sesame', 'legacy', 1, '{}'::jsonb),
    (v_sesame_capture_id, 'zztest 3947 sesame', 'ZZTEST 3947 Sesame', 'current', 1, '{}'::jsonb);

  -- Lucasfilm/Disney: one shared dcpvault source_id (Disney twin exists) and
  -- one unique Lucasfilm source_id (no Disney twin).
  insert into plm.dcp_property (source_system, source_id, display_name)
  values ('disney_dcpvault', 'dcpvault:zztest-3947-shared', 'ZZTEST Disney Shared');

  insert into plm.lucasfilm_dcp_property (source_system, source_id, display_name)
  values
    ('lucasfilm_dcpvault', 'dcpvault:zztest-3947-shared', 'ZZTEST Lucasfilm Shared'),
    ('lucasfilm_dcpvault', 'dcpvault:zztest-3947-unique', 'ZZTEST Lucasfilm Unique');

  -- A DCP resolution keyed on the shared source_id, attached to the losing
  -- Lucasfilm copy. After the Lucasfilm display row is hidden this decision
  -- must still surface through the surviving Disney row (B6).
  insert into plm.dcp_opa_property_resolution
    (source_system, source_table, source_property_id, decision_version,
     approval_status, creative_decision_state,
     evidence_reference, evidence_sha256, decision_reason,
     approved_at, approved_by)
  values
    ('lucasfilm_dcpvault', 'plm.lucasfilm_dcp_property',
     'dcpvault:zztest-3947-shared', 1,
     'approved', 'conflict',
     'zztest', repeat('e', 64), 'zztest decision',
     now(), 'zztest');

  -- Walk the property inventory and ACCUMULATE counts across all pages (L1).
  v_cursor := null;
  loop
    v_result := api.db_data_admin_scraped_source_inventory('property', 'ZZTEST', v_cursor, 1000);
    v_rows := coalesce(v_result -> 'rows', '[]'::jsonb);

    select count(*) into v_page_warner_fallback from jsonb_array_elements(v_rows) r
    where r ->> 'source_system' = 'warner_starlabs'
      and r ->> 'display_label' = 'ZZTEST Warner Twin'
      and r ->> 'source_id' like '%natural_key_fallback%';
    v_warner_fallback_count := v_warner_fallback_count + v_page_warner_fallback;

    select count(*) into v_page_warner_source from jsonb_array_elements(v_rows) r
    where r ->> 'source_system' = 'warner_starlabs'
      and r ->> 'display_label' = 'ZZTEST Warner Twin'
      and r ->> 'source_id' like '%source_id%';
    v_warner_source_count := v_warner_source_count + v_page_warner_source;

    select count(*) into v_page_sesame from jsonb_array_elements(v_rows) r
    where r ->> 'source_system' = 'sesame_thelettera_netx'
      and r ->> 'display_label' = 'ZZTEST 3947 Sesame';
    v_sesame_count := v_sesame_count + v_page_sesame;

    -- B4: shared ID — Disney survivor visible, Lucasfilm copy hidden.
    select count(*) into v_page_shared_disney from jsonb_array_elements(v_rows) r
    where r ->> 'source_id' = 'dcpvault:zztest-3947-shared'
      and r ->> 'source_table' = 'plm.dcp_property';
    v_shared_disney_count := v_shared_disney_count + v_page_shared_disney;

    select count(*) into v_page_shared_lucasfilm from jsonb_array_elements(v_rows) r
    where r ->> 'source_id' = 'dcpvault:zztest-3947-shared'
      and r ->> 'source_table' = 'plm.lucasfilm_dcp_property';
    v_shared_lucasfilm_count := v_shared_lucasfilm_count + v_page_shared_lucasfilm;

    -- B5: unique Lucasfilm identity preserved.
    select count(*) into v_page_unique_lucasfilm from jsonb_array_elements(v_rows) r
    where r ->> 'source_id' = 'dcpvault:zztest-3947-unique'
      and r ->> 'source_table' = 'plm.lucasfilm_dcp_property';
    v_unique_lucasfilm_count := v_unique_lucasfilm_count + v_page_unique_lucasfilm;

    -- B6: the surviving Disney row surfaces the Lucasfilm-copy resolution
    -- (conflict -> dcp-authority-conflict group), proving no decision is
    -- orphaned by hiding the Lucasfilm display copy.
    select count(*) into v_page_shared_conflict from jsonb_array_elements(v_rows) r
    where r ->> 'source_id' = 'dcpvault:zztest-3947-shared'
      and r ->> 'source_table' = 'plm.dcp_property'
      and r ->> 'licensor_key' = 'dcp-authority-conflict';
    v_shared_conflict_count := v_shared_conflict_count + v_page_shared_conflict;

    exit when (v_result ->> 'next_cursor') is null;
    v_cursor := v_result ->> 'next_cursor';
  end loop;

  -- B1: The source_id twin is kept.
  if v_warner_source_count <> 1 then
    raise exception 'B1: expected 1 Warner source_id row for ZZTEST Warner Twin, got %', v_warner_source_count;
  end if;
  -- B2: The fallback twin is hidden.
  if v_warner_fallback_count <> 0 then
    raise exception 'B2: Warner fallback twin is still visible (count=%)', v_warner_fallback_count;
  end if;
  -- B3: Exactly one Sesame row survives (the current generation).
  if v_sesame_count <> 1 then
    raise exception 'B3: expected 1 Sesame row for ZZTEST 3947 Sesame, got %', v_sesame_count;
  end if;
  -- B4a: The Disney survivor for the shared ID is visible exactly once.
  if v_shared_disney_count <> 1 then
    raise exception 'B4a: expected 1 Disney row for dcpvault:zztest-3947-shared, got %', v_shared_disney_count;
  end if;
  -- B4b: The Lucasfilm twin of the shared ID is hidden.
  if v_shared_lucasfilm_count <> 0 then
    raise exception 'B4b: Lucasfilm twin of shared Disney ID is still visible (count=%)', v_shared_lucasfilm_count;
  end if;
  -- B5: The unique Lucasfilm identity is preserved.
  if v_unique_lucasfilm_count <> 1 then
    raise exception 'B5: expected 1 unique Lucasfilm row for dcpvault:zztest-3947-unique, got %', v_unique_lucasfilm_count;
  end if;
  -- B6: The surviving Disney row surfaces the resolution that was attached to
  -- the hidden Lucasfilm copy — no decision is orphaned.
  if v_shared_conflict_count <> 1 then
    raise exception 'B6: expected surviving Disney row to show dcp-authority-conflict from the Lucasfilm-copy resolution, got %', v_shared_conflict_count;
  end if;
end $$;

rollback;
