-- =====================================================================================
-- WWE character-evidence anchor contract tests -- migration 20260828232207, issue #1769,
-- PR #1809. Added after an independent review (grok) found the original
-- "exactly one anchor" CHECK on plm.wwe_character_evidence accepted an empty-string
-- anchor and left evidence_type unrelated to which anchor column was actually set.
--
-- HOW TO RUN
--   Against a throwaway or preview database, as the migration owner:
--       \i supabase/tests/wwe_character_evidence_contracts.sql
--   The whole file runs inside ONE transaction and ends in ROLLBACK, so it leaves no row
--   behind. Every negative test runs inside a plpgsql block with a SPECIFIC exception
--   handler and asserts that the expected NAMED constraint fired -- not just that some
--   error happened. There is deliberately NO `exception when others` anywhere in this
--   file.
--
-- EVERY VALUE IN THIS FILE IS INVENTED.
--   u2giants/shared-db is PUBLIC. Not one WWE property, contract, submission, style
--   guide, asset, tag or raw payload value appears here. Fixtures use obviously fake
--   tokens (ZZTEST-*, example.invalid).
--
-- WHAT IT ASSERTS
--   A. The full positive chain -- capture -> property/submission -> creative capture ->
--      asset_folder/asset -> character_candidate -> character_evidence -- inserts
--      cleanly for each of the three evidence_type values.
--   B. An empty-string (and whitespace-only) anchor value is rejected by the nonblank
--      CHECK, not silently accepted the way a bare "IS NOT NULL" count would.
--   C. A dangling submission_number anchor (no matching plm.wwe_submission row) is
--      rejected by its foreign key. folder_source_id/asset_source_id cannot carry the
--      equivalent FK -- they live under the separate creative-capture id namespace --
--      so that gap is documented, not silently assumed closed.
--   D. evidence_type must match the one populated anchor column; a row claiming one
--      type while its data anchors to a different column is rejected by
--      wwe_character_evidence_type_anchor_chk.
-- =====================================================================================

begin;

do $$
declare
  v_sub_cap  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_cre_cap  uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
begin
  insert into plm.wwe_submission_capture
    (id, capture_key, source_repository, source_commit_sha, source_hash, source_url,
     source_captured_at, expected_counts, raw_summary, created_by)
  values
    (v_sub_cap, 'ZZTEST-wwe-sub-1', 'ZZTEST-repo', repeat('a', 40), repeat('b', 64),
     'https://example.invalid/sub', '2099-01-01Z', '{}'::jsonb, '{}'::jsonb, 'ZZTEST');

  insert into plm.wwe_creative_capture
    (id, capture_key, source_repository, source_commit_sha, source_manifest_sha256,
     portal_base_url, source_captured_at, expected_counts, guidelines_visible,
     guidelines_reported, raw_summary, created_by)
  values
    (v_cre_cap, 'ZZTEST-wwe-cre-1', 'ZZTEST-repo', repeat('a', 40), repeat('c', 64),
     'https://example.invalid/frontify', '2099-01-01Z', '{}'::jsonb, 0, 0, '{}'::jsonb,
     'ZZTEST');

  insert into plm.wwe_submission
    (capture_id, submission_number, licensor_label, source_url, raw)
  values
    (v_sub_cap, 'ZZTEST-SUB-1', 'ZZTEST licensor', 'https://example.invalid/s1', '{}'::jsonb);

  insert into plm.wwe_creative_brand (capture_id, brand_source_id, brand_label, raw)
  values (v_cre_cap, 'ZZTEST-brand-1', 'ZZTEST brand', '{}'::jsonb);

  insert into plm.wwe_asset_folder
    (capture_id, folder_source_id, folder_label, folder_path, folder_depth, raw)
  values
    (v_cre_cap, 'ZZTEST-folder-1', 'ZZTEST folder', '/zztest-folder', 1, '{}'::jsonb);

  insert into plm.wwe_asset_library (capture_id, library_source_id, brand_source_id, library_label, raw)
  values (v_cre_cap, 'ZZTEST-lib-1', 'ZZTEST-brand-1', 'ZZTEST library', '{}'::jsonb);

  insert into plm.wwe_asset
    (capture_id, asset_source_id, library_source_id, file_name, source_hash, raw)
  values
    (v_cre_cap, 'ZZTEST-asset-1', 'ZZTEST-lib-1', 'zztest.jpg', repeat('e', 64), '{}'::jsonb);

  insert into plm.wwe_character_candidate
    (capture_id, character_candidate_key, candidate_label, normalized_candidate_label,
     inference_method, rule_version, raw)
  values
    (v_sub_cap, 'ZZTEST-cand-1', 'ZZTEST character', 'zztest character',
     'free_text_match', 'v1', '{}'::jsonb);

  raise notice 'setup passed: fixture chain established';
end;
$$;

-- ---------------------------------------------------------------------------------------
-- A. Positive path: one evidence row per evidence_type, each with its matching anchor.
-- ---------------------------------------------------------------------------------------
do $$
declare
  v_sub_cap uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  insert into plm.wwe_character_evidence
    (capture_id, character_candidate_key, evidence_key, submission_number, folder_source_id,
     asset_source_id, evidence_type, evidence_value, match_method, rule_version, confidence, raw)
  values
    (v_sub_cap, 'ZZTEST-cand-1', 'ZZTEST-ev-sub', 'ZZTEST-SUB-1', null, null,
     'submission_ip', 'ZZTEST character', 'exact', 'v1', 0.9, '{}'::jsonb),
    (v_sub_cap, 'ZZTEST-cand-1', 'ZZTEST-ev-folder', null, 'ZZTEST-folder-1', null,
     'asset_folder', 'ZZTEST folder', 'exact', 'v1', 0.8, '{}'::jsonb),
    (v_sub_cap, 'ZZTEST-cand-1', 'ZZTEST-ev-asset', null, null, 'ZZTEST-asset-1',
     'asset_tag', 'ZZTEST tag', 'exact', 'v1', 0.7, '{}'::jsonb);

  if (select count(*) from plm.wwe_character_evidence
       where capture_id = v_sub_cap and character_candidate_key = 'ZZTEST-cand-1') <> 3 then
    raise exception 'A FAILED: expected 3 positive evidence rows to insert';
  end if;
  raise notice 'A passed: one valid evidence row per evidence_type inserted';
end;
$$;

-- ---------------------------------------------------------------------------------------
-- B. Empty-string / whitespace-only anchors are rejected by the nonblank CHECK.
-- ---------------------------------------------------------------------------------------
do $$
declare
  v_sub_cap uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_con     text;
  v_raised  integer := 0;
  v_warn    integer := 0;
begin
  begin
    insert into plm.wwe_character_evidence
      (capture_id, character_candidate_key, evidence_key, submission_number, folder_source_id,
       asset_source_id, evidence_type, evidence_value, match_method, rule_version, confidence, raw)
    values
      (v_sub_cap, 'ZZTEST-cand-1', 'ZZTEST-ev-empty', '', null, null,
       'submission_ip', 'x', 'exact', 'v1', 0.5, '{}'::jsonb);
    v_warn := v_warn + 1;
    raise warning 'B1 FAIL: empty-string submission_number anchor was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') not in
       ('wwe_character_evidence_submission_nonblank_chk',
        'wwe_character_evidence_type_anchor_chk') then
      raise exception 'B1 FAILED: unexpected constraint % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  begin
    insert into plm.wwe_character_evidence
      (capture_id, character_candidate_key, evidence_key, submission_number, folder_source_id,
       asset_source_id, evidence_type, evidence_value, match_method, rule_version, confidence, raw)
    values
      (v_sub_cap, 'ZZTEST-cand-1', 'ZZTEST-ev-whitespace', '   ', null, null,
       'submission_ip', 'x', 'exact', 'v1', 0.5, '{}'::jsonb);
    v_warn := v_warn + 1;
    raise warning 'B2 FAIL: whitespace-only submission_number anchor was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') not in
       ('wwe_character_evidence_submission_nonblank_chk',
        'wwe_character_evidence_type_anchor_chk') then
      raise exception 'B2 FAILED: unexpected constraint % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  if v_warn > 0 then
    raise exception 'B FAILED: % blank-anchor row(s) were wrongly accepted', v_warn;
  end if;
  if v_raised <> 2 then
    raise exception 'B FAILED: expected 2 rejections, got %', v_raised;
  end if;
  raise notice 'B passed: blank and whitespace-only anchors are both rejected';
end;
$$;

-- ---------------------------------------------------------------------------------------
-- C. A dangling anchor (no matching parent row) is rejected by its foreign key, for
--    each of the three anchor columns.
--
-- submission_number is checked against a real foreign key because
-- plm.wwe_character_evidence.capture_id is rooted on the SAME submissions capture as
-- plm.wwe_submission (both must match plm.wwe_character_candidate's capture_id).
-- folder_source_id and asset_source_id point into plm.wwe_creative_capture's separate
-- id namespace, so they cannot carry the equivalent same-capture composite FK -- see
-- the constraint comment on plm.wwe_character_evidence in the migration. Only the
-- submission anchor is exercised here for real FK rejection.
-- ---------------------------------------------------------------------------------------
do $$
declare
  v_sub_cap uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_con     text;
  v_raised  integer := 0;
  v_warn    integer := 0;
begin
  begin
    insert into plm.wwe_character_evidence
      (capture_id, character_candidate_key, evidence_key, submission_number, folder_source_id,
       asset_source_id, evidence_type, evidence_value, match_method, rule_version, confidence, raw)
    values
      (v_sub_cap, 'ZZTEST-cand-1', 'ZZTEST-ev-dangle-sub', 'ZZTEST-SUB-DOES-NOT-EXIST', null, null,
       'submission_ip', 'x', 'exact', 'v1', 0.5, '{}'::jsonb);
    v_warn := v_warn + 1;
    raise warning 'C1 FAIL: dangling submission_number anchor was accepted';
  exception when foreign_key_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'wwe_character_evidence_submission_fkey' then
      raise exception 'C1 FAILED: expected wwe_character_evidence_submission_fkey, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  if v_warn > 0 then
    raise exception 'C FAILED: % dangling submission_number row(s) were wrongly accepted', v_warn;
  end if;
  if v_raised <> 1 then
    raise exception 'C FAILED: expected 1 rejection, got %', v_raised;
  end if;
  raise notice 'C passed: a dangling submission_number anchor is rejected by its foreign key';
end;
$$;

-- ---------------------------------------------------------------------------------------
-- D. evidence_type must match the one populated anchor column.
-- ---------------------------------------------------------------------------------------
do $$
declare
  v_sub_cap uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_con     text;
  v_raised  integer := 0;
  v_warn    integer := 0;
begin
  -- type says submission_ip, data anchors to folder_source_id.
  begin
    insert into plm.wwe_character_evidence
      (capture_id, character_candidate_key, evidence_key, submission_number, folder_source_id,
       asset_source_id, evidence_type, evidence_value, match_method, rule_version, confidence, raw)
    values
      (v_sub_cap, 'ZZTEST-cand-1', 'ZZTEST-ev-mismatch-1', null, 'ZZTEST-folder-1', null,
       'submission_ip', 'x', 'exact', 'v1', 0.5, '{}'::jsonb);
    v_warn := v_warn + 1;
    raise warning 'D1 FAIL: evidence_type/anchor mismatch was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'wwe_character_evidence_type_anchor_chk' then
      raise exception 'D1 FAILED: expected wwe_character_evidence_type_anchor_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- type says asset_tag, data anchors to submission_number.
  begin
    insert into plm.wwe_character_evidence
      (capture_id, character_candidate_key, evidence_key, submission_number, folder_source_id,
       asset_source_id, evidence_type, evidence_value, match_method, rule_version, confidence, raw)
    values
      (v_sub_cap, 'ZZTEST-cand-1', 'ZZTEST-ev-mismatch-2', 'ZZTEST-SUB-1', null, null,
       'asset_tag', 'x', 'exact', 'v1', 0.5, '{}'::jsonb);
    v_warn := v_warn + 1;
    raise warning 'D2 FAIL: evidence_type/anchor mismatch was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'wwe_character_evidence_type_anchor_chk' then
      raise exception 'D2 FAILED: expected wwe_character_evidence_type_anchor_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- two anchors populated at once, even with a matching type on one of them.
  begin
    insert into plm.wwe_character_evidence
      (capture_id, character_candidate_key, evidence_key, submission_number, folder_source_id,
       asset_source_id, evidence_type, evidence_value, match_method, rule_version, confidence, raw)
    values
      (v_sub_cap, 'ZZTEST-cand-1', 'ZZTEST-ev-mismatch-3', 'ZZTEST-SUB-1', 'ZZTEST-folder-1', null,
       'submission_ip', 'x', 'exact', 'v1', 0.5, '{}'::jsonb);
    v_warn := v_warn + 1;
    raise warning 'D3 FAIL: two populated anchors were accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'wwe_character_evidence_type_anchor_chk' then
      raise exception 'D3 FAILED: expected wwe_character_evidence_type_anchor_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  if v_warn > 0 then
    raise exception 'D FAILED: % type/anchor mismatch row(s) were wrongly accepted', v_warn;
  end if;
  if v_raised <> 3 then
    raise exception 'D FAILED: expected 3 rejections, got %', v_raised;
  end if;
  raise notice 'D passed: evidence_type is bound to its one populated anchor column';
end;
$$;

rollback;
