-- Refresh the plm.erp_vendor SILVER mirror to Coldlion's CORRECTED /vendors table.
--
-- Context (fix_vendor_reconcile.md, HANDOFF OPEN #1)
-- --------------------------------------------------
-- Coldlion fixed the /vendors endpoint on 2026-07-22: it now serves 97 factory-only
-- records (all active), down from 539 mixed with freight/government/bank/courier/
-- real-estate service-providers. The GOLD hub core.factory was already reconciled to
-- the corrected universe on 2026-07-22 (migration 20260722140000 -> 93 rows,
-- 91 active / 2 inactive). But the SILVER mirror plm.erp_vendor still held the OLD
-- 539-row set (97 active + 442 inactive service-providers). Apps read core.factory,
-- not this mirror, so this is not user-facing — but the layers were inconsistent and
-- any future importer reading the mirror would be wrong.
--
-- Why this is a data migration and NOT an API re-pull tool
-- -------------------------------------------------------
-- The corrected live feed was pulled and verified on 2026-07-22 BEFORE writing this
-- migration: GET http://x5.coldlion.com/EhpApi/vendors?companyCode=EDGEHOME
-- returned exactly 97 records, all active, whose vendorCodes are EXACTLY the 97-code
-- allowlist below. Independently, the mirror's own 97 active rows were verified to be
-- exactly those same 97 codes (0 active rows outside the allowlist). So the mirror
-- already holds a faithful copy of every corrected factory; the ONLY drift is the 442
-- stale INACTIVE service-provider rows that Coldlion dropped. Re-pulling identical
-- payloads for the 97 through a service-role tool would add risk (a destructive prod
-- write outside the sanctioned migration path, and a promotion function that could
-- reactivate the curated-inactive ANT001) for no benefit. Removing the 442 stale rows
-- deterministically achieves the same end state — mirror == corrected 97 — inside the
-- normal preview -> PR -> prod workflow.
--
-- The RECURRING importer that actually re-pulls and refreshes payloads (with the two
-- mandatory guards) is specified separately in fix_vendor_sync.md (HANDOFF OPEN #2).
--
-- What this migration does
--   1) Deletes the 442 stale mirror rows: coldlion-sourced vendor_codes that are NOT in
--      the corrected 97-code allowlist. Guarded so it can only ever hit stale rows.
--   2) Records a completed ingest.sync_run documenting the reconcile (source_system
--      'coldlion', source_name 'coldlion_vendors_api', mode 'mirror_reconcile').
--
-- Bronze ingest.raw_record is intentionally left untouched — it is the immutable
-- landing history of the real 2026-07-15 pull. core.factory is NOT touched here.
--
-- Idempotent + guarded: safe to re-run and safe on the data-less/clone preview branch
-- (if the 442 stale rows are already gone, it deletes 0 and still records the run).

do $$
declare
  -- The corrected Coldlion /vendors universe (verified live 2026-07-22 = these 97 codes,
  -- identical to migration 20260722140000's allowlist).
  v_correct text[] := array[
    'ANT001','CACAR','CBPHO','CBYJA','CNASW','CNBCH','CNBEL','CNBTO','CNCHC','CNCHF','CNCKA',
    'CNCXC','CNDCF','CNDHE','CNDWG','CNEVR','CNFEN','CNFER','CNFLW','CNFLY','CNFTH','CNFUJ',
    'CNFUZH','CNGCH','CNHAP','CNHDL','CNHFU','CNHQP','CNHUS','CNINT','CNJAM','CNJDF','CNJHC',
    'CNJHY','CNJJA','CNJNC','CNJTS','CNLTL','CNMHA','CNMUC','CNNBH','CNNDC','CNNEW','CNNHX',
    'CNNMP','CNNTY','CNQJM','CNQMS','CNQUE','CNRPH','CNRUC','CNSFN','CNSHAO','CNTFA','CNTMWA',
    'CNTMZ','CNTNG','CNTTY','CNTXC','CNTZS','CNUNQ','CNWAH','CNWAT','CNWEM','CNWJT','CNWLH',
    'CNXFA','CNXJM','CNXJY','CNXKA','CNXYZ','CNYDE','CNYIC','CNYIH','CNYKE','CNYSC','CNZAK',
    'CNZBJ','CNZCH','CNZHO','CNZJNA','CNZTA','COCO','FLGDS','IKN001','INBABU','INDSM','INHDW',
    'INKAN','INRYP','INTUF','INUCF','INVCW','SKPHL','SKPNP','SKSMB','USDEC'
  ];
  v_before        integer;
  v_extra_active  integer;
  v_deleted       integer;
  v_after         integer;
  v_sync_id       uuid;
begin
  -- Safety assertion: the corrected allowlist must be exactly 97 codes. If Coldlion's
  -- universe changed, stop and re-verify rather than silently deleting the wrong rows.
  if array_length(v_correct, 1) <> 97 then
    raise exception 'Expected 97 corrected vendor codes, got %', array_length(v_correct, 1);
  end if;

  select count(*) into v_before from plm.erp_vendor;

  -- Safety assertion: no ACTIVE mirror row may fall outside the allowlist. The stale
  -- set we are deleting must be inactive service-providers only. If an active row is
  -- outside the 97, the allowlist is stale — abort instead of deleting a live factory.
  select count(*) into v_extra_active
  from plm.erp_vendor
  where active
    and vendor_code <> all (v_correct);
  if v_extra_active > 0 then
    raise exception 'Refusing to reconcile: % active mirror row(s) are outside the corrected 97-code allowlist', v_extra_active;
  end if;

  -- 1) Delete stale rows: coldlion-sourced codes not in the corrected 97.
  --    Guarded so a bug in the allowlist can only remove rows already absent upstream.
  delete from plm.erp_vendor
  where vendor_code <> all (v_correct);
  get diagnostics v_deleted = row_count;

  select count(*) into v_after from plm.erp_vendor;

  -- 2) Record a completed reconcile run (durable audit; the mirror layer's sync_run).
  insert into ingest.sync_run (
    source_system, source_name, status, started_at, finished_at,
    rows_seen, rows_inserted, rows_updated, rows_failed, metadata
  )
  values (
    'coldlion', 'coldlion_vendors_api', 'succeeded', now(), now(),
    array_length(v_correct, 1), 0, 0, v_deleted,
    jsonb_build_object(
      'endpoint', '/vendors',
      'company_code', 'EDGEHOME',
      'mode', 'mirror_reconcile',
      'note', 'Silver plm.erp_vendor reconciled to the corrected 97 factory-only codes; stale inactive service-provider rows removed. Live feed verified = 97 on 2026-07-22. See fix_vendor_reconcile.md / HANDOFF OPEN #1.',
      'mirror_rows_before', v_before,
      'mirror_rows_deleted', v_deleted,
      'mirror_rows_after', v_after
    )
  )
  returning id into v_sync_id;

  raise notice 'plm.erp_vendor mirror reconcile: before=%, deleted=%, after=% (sync_run %)',
    v_before, v_deleted, v_after, v_sync_id;
end $$;
