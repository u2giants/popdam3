-- =====================================================================================
-- Issue #597 Phase 1 — seed core.product_depth from the 121 authoritative DesignFlow
-- itemDepth rows, with legacy ids and labels UNCHANGED.
--
-- WHY THE SEED READS THE DATABASE INSTEAD OF EMBEDDING 121 LITERAL ROWS
-- ---------------------------------------------------------------------
-- The authoritative snapshot is DesignFlow production Cloud SQL, captured read-only
-- on 2026-08-07 with SHA-256
--   6a8dd274e380bbb12fd997d916858a75d5f6ae61872be02a92432f2a1f92c1ce
-- (docs/verification/master-data-designflow-reference-cutover-20260807/). That same
-- evidence proves the Supabase `dflow."itemDepth"` mirror matches Cloud SQL EXACTLY
-- across legacy id, code, title, status and audit text — zero row differences.
--
-- Reading the mirror therefore reproduces the authoritative snapshot without
-- re-transcribing 121 rows by hand, which is the step where labels get "tidied".
-- Issue #597 requires the labels unchanged, and a copy-paste is the only part of
-- this job that could silently change one.
--
-- The risk of reading live data in a migration is that the data might not be what
-- you assumed. That risk is closed by asserting the shape BEFORE the insert and the
-- result AFTER it. If the mirror is ever not the 121-row snapshot, this migration
-- ABORTS. It never seeds a partial set and never reports success on a wrong count.
--
-- IDEMPOTENT. Re-running upserts by legacy id and re-asserts the same invariants.
-- =====================================================================================

do $$
declare
  v_expected_rows constant integer := 121;
  v_src_rows    integer;
  v_src_ids     integer;
  v_src_codes   integer;
  v_src_blank   integer;
  v_after_rows  integer;
  v_after_ids   integer;
  v_after_refs  integer;
begin
  -- ---------------------------------------------------------------------------------
  -- 1. Refuse to run at all unless the source table is present and the right shape.
  -- ---------------------------------------------------------------------------------
  if to_regclass('dflow."itemDepth"') is null then
    raise exception
      'core.product_depth seed aborted: dflow."itemDepth" does not exist on this database'
      using errcode = 'P0001';
  end if;

  select count(*),
         count(distinct "itemDepth_id"),
         count(distinct "itemDepth_code"),
         count(*) filter (
           where "itemDepth_id" is null
              or "itemDepth_code" is null or btrim("itemDepth_code") = ''
              or "itemDepth_title" is null or btrim("itemDepth_title") = ''
         )
    into v_src_rows, v_src_ids, v_src_codes, v_src_blank
    from dflow."itemDepth";

  if v_src_rows <> v_expected_rows then
    raise exception
      'core.product_depth seed aborted: dflow."itemDepth" holds % rows, expected the authoritative % (snapshot 6a8dd274e380bbb12fd997d916858a75d5f6ae61872be02a92432f2a1f92c1ce)',
      v_src_rows, v_expected_rows
      using errcode = 'P0001';
  end if;

  if v_src_ids <> v_expected_rows or v_src_codes <> v_expected_rows then
    raise exception
      'core.product_depth seed aborted: expected % distinct legacy ids and % distinct codes, found % and %',
      v_expected_rows, v_expected_rows, v_src_ids, v_src_codes
      using errcode = 'P0001';
  end if;

  if v_src_blank > 0 then
    raise exception
      'core.product_depth seed aborted: % source rows have a null/blank legacy id, code or title',
      v_src_blank
      using errcode = 'P0001';
  end if;

  -- Deliberately NOT asserted: label uniqueness. 7 labels legitimately appear twice
  -- (2.25in, 1.2cm, 3.8in, 2.5in, 4in, 6in, 8in). Requiring distinct labels here
  -- would fail on correct authoritative data.

  -- ---------------------------------------------------------------------------------
  -- 2. Seed. Labels and legacy ids are copied verbatim — no trim, no case change,
  --    no de-duplication, no re-numbering.
  -- ---------------------------------------------------------------------------------
  insert into core.product_depth (
    legacy_id, code, label, status, legacy_status, legacy_audit_text,
    source_system, sort_order, metadata
  )
  select
    d."itemDepth_id",
    d."itemDepth_code",
    d."itemDepth_title",
    case
      when upper(btrim(coalesce(d."itemDepth_status", 'ACTIVE'))) = 'ACTIVE' then 'active'
      else 'inactive'
    end::app.entity_status,
    d."itemDepth_status",
    d."itemDepth_auditlog",
    'designflow',
    d."itemDepth_id",
    jsonb_build_object(
      'seeded_by', 'shared-db migration 20260809170100',
      'issue', 597,
      'authoritative_snapshot_sha256',
        '6a8dd274e380bbb12fd997d916858a75d5f6ae61872be02a92432f2a1f92c1ce'
    )
  from dflow."itemDepth" d
  on conflict (legacy_id) where legacy_id is not null do update
  set code              = excluded.code,
      label             = excluded.label,
      legacy_status     = excluded.legacy_status,
      legacy_audit_text = excluded.legacy_audit_text,
      sort_order        = excluded.sort_order,
      metadata          = core.product_depth.metadata || excluded.metadata,
      updated_at        = now();

  -- ---------------------------------------------------------------------------------
  -- 3. Provenance rows, keyed on the legacy id so a replay updates rather than doubles.
  -- ---------------------------------------------------------------------------------
  insert into core.product_depth_source_ref (
    product_depth_id, source_system, source_table, source_id,
    source_code, source_label, metadata
  )
  select
    pd.id,
    'designflow',
    'itemDepth',
    d."itemDepth_id"::text,
    d."itemDepth_code",
    d."itemDepth_title",
    jsonb_build_object(
      'legacy_status', d."itemDepth_status",
      'legacy_auditlog', d."itemDepth_auditlog",
      'airbyte_emitted_at', d."itemDepth_airbyte_emitted_at"
    )
  from dflow."itemDepth" d
  join core.product_depth pd on pd.legacy_id = d."itemDepth_id"
  on conflict (source_system, source_table, source_id) do update
  set product_depth_id = excluded.product_depth_id,
      source_code      = excluded.source_code,
      source_label     = excluded.source_label,
      metadata         = core.product_depth_source_ref.metadata || excluded.metadata,
      captured_at      = now();

  -- ---------------------------------------------------------------------------------
  -- 4. Assert the RESULT. "The migration applied" is not evidence; this is.
  -- ---------------------------------------------------------------------------------
  select count(*), count(*) filter (where legacy_id is not null)
    into v_after_rows, v_after_ids
    from core.product_depth;

  select count(*) into v_after_refs
    from core.product_depth_source_ref
    where source_system = 'designflow' and source_table = 'itemDepth';

  if v_after_ids <> v_expected_rows then
    raise exception
      'core.product_depth seed FAILED: % legacy-backed rows after seeding, expected %',
      v_after_ids, v_expected_rows
      using errcode = 'P0001';
  end if;

  if v_after_refs <> v_expected_rows then
    raise exception
      'core.product_depth seed FAILED: % itemDepth source refs after seeding, expected %',
      v_after_refs, v_expected_rows
      using errcode = 'P0001';
  end if;

  -- Prove no label was altered in transit: every seeded label must still be
  -- byte-identical to its source row.
  if exists (
    select 1
    from core.product_depth pd
    join dflow."itemDepth" d on d."itemDepth_id" = pd.legacy_id
    where pd.label is distinct from d."itemDepth_title"
       or pd.code  is distinct from d."itemDepth_code"
  ) then
    raise exception
      'core.product_depth seed FAILED: at least one seeded label or code differs from the authoritative source row'
      using errcode = 'P0001';
  end if;

  raise notice
    'core.product_depth seeded: % legacy-backed rows (% total), % source refs.',
    v_after_ids, v_after_rows, v_after_refs;
end;
$$;
