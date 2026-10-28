-- shared-db#4909/#4941/#4956: Master Data auto-flow contracts, both legs.
-- Live leg (#4941): plm.import_item_master_data itself creates and links the
-- Licensed tracker row inside the same transaction as the item insert — one
-- import call, no explicit sync call.
-- Scheduled leg (#4909), full retained coverage: per-normalized-SKU dedupe
-- across statements, pre-existing-SKU guard, isolated bridge guard, pre-cutoff
-- no-backfill, dry-run eligibility counts, real-run insert counts, row_added
-- audit, cron backstop registration, service_role grant, anon/authenticated
-- refusal, and idempotent re-runs.
-- Assortment skip (#4956): a marked assortment head (item_detail.pre_pack_code)
-- never gets a row on either leg; an item with no itemDetails row yet is
-- deferred until a masters projection (max(item_detail.fetched_at)) has run
-- past its landing, then flows; an item ColdLion never details flows once a
-- projection has passed it.
-- LOCAL THROWAWAY DATABASE ONLY; never execute against production. Rolled back.
begin;

do $test$
declare
  v_cutoff timestamptz;
  v_old timestamptz := now() - interval '30 days';
  v_new timestamptz := now() + interval '1 day';
  v_land timestamptz;
  v_result record;
  v_item_new uuid;
  v_linked uuid;
  v_sku_imp text := 'ZZ4941IMP-NEW';
  v_sku_imp_asst text := 'ZZ4956IMP-ASST';
  v_sku_new text := 'ZZ4941DIR-NEW';
  v_sku_old text := 'ZZ4941DIR-OLD';
  v_sku_asst text := 'ZZ4956DIR-ASST';
  v_sku_defer text := 'ZZ4956DIR-DEFER';
  v_rows integer;
  v_run_id uuid := '00000000-0000-4000-8000-000000004956';
begin
  -- Grants.
  if has_function_privilege('authenticated', 'public.sync_new_items_into_style_tracker(boolean)', 'execute')
     or has_function_privilege('anon', 'public.sync_new_items_into_style_tracker(boolean)', 'execute') then
    raise exception 'sync_new_items_into_style_tracker must not be executable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.sync_new_items_into_style_tracker(boolean)', 'execute') then
    raise exception 'service_role must execute sync_new_items_into_style_tracker';
  end if;

  -- Recover the shipped cutoff from the sync function body so fixtures straddle it.
  select (regexp_match(prosrc, 'v_cutoff[^:=]*:=[[:space:]]*''([^'']+)''', 'i'))[1]::timestamptz
    into v_cutoff from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_new_items_into_style_tracker';
  if v_cutoff is null then
    raise exception 'could not read the cutoff constant from the function body';
  end if;
  v_old := least(v_old, v_cutoff - interval '1 day');
  v_new := greatest(v_new, v_cutoff + interval '1 day');
  -- v_land is the seeded masters projection moment: after v_new (so v_new items
  -- without an itemDetails row count as seen), and before the deferred item's
  -- landing so it starts out deferred.
  v_land := v_new + interval '1 day';

  ---------------- Assortment evidence fixtures (#4956): one masters run plus
  ---------------- itemDetails rows — a marked head, an unmarked real item, a
  ---------------- clock row, and a marked head for the live import leg.
  insert into coldlion.sync_run (id, endpoint, company_code, division_code, requested_by)
  values (v_run_id, '/itemDetails', 'ZZ', 'ZZ', 'zztest4956');

  insert into coldlion.item_header (company_code, division_code, item_no, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  select 'ZZ', 'ZZ', x.item_no, v_run_id, v_land, repeat('0', 64), v_land, v_land
  from (values (v_sku_new), (v_sku_asst), ('ZZ4956DIR-CLOCK'), (v_sku_imp_asst)) as x(item_no);

  insert into coldlion.item_detail (company_code, division_code, item_no, item_pkey, pre_pack_code, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
  values ('ZZ', 'ZZ', v_sku_new,       '1', null,                v_run_id, v_land, repeat('0', 64), v_land, v_land),
         ('ZZ', 'ZZ', v_sku_asst,      '1', 'PPK-ZZ4956',        v_run_id, v_land, repeat('0', 64), v_land, v_land),
         ('ZZ', 'ZZ', 'ZZ4956DIR-CLOCK', '1', null,              v_run_id, v_land, repeat('0', 64), v_land, v_land),
         ('ZZ', 'ZZ', v_sku_imp_asst,  '1', 'PPK-ZZ4956-IMP',    v_run_id, v_land, repeat('0', 64), v_land, v_land);

  ---------------- Scheduled-leg fixtures (direct plm.item inserts; the live leg
  ---------------- is driven only by the import, so these do not auto-flow).
  -- OLD: pre-cutoff. NEW: fresh, itemDetails row unmarked. DUP: SKU of an
  -- existing tracker row. MULTI A/B: two items sharing one normalized SKU
  -- (dedupe pair, no itemDetails rows — seen because the seeded projection ran
  -- past their landing). ASST: marked assortment head. DEFER: landed after the
  -- seeded projection with no itemDetails row.
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values (v_sku_old, 'zztest4941', 'old', '{}', v_old);
  insert into plm.item (item_number, source_system, source_id, description, raw, created_at)
  values (v_sku_new, 'zztest4941', 'new', 'zztest 4951 fallback description',
          jsonb_build_object('companyCode','ZZ','divisionCode','ZZ',
                             'itemDesc','zztest 4951 coldlion description',
                             'itemDiscontinued','Y','createdUser','ZZTEST'),
          v_new)
  returning id into v_item_new;
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values ('ZZ4941DIR-DUP', 'zztest4941', 'dup', '{}', v_new);
  insert into public.style_tracker_rows (source_sheet, source_row_number, tracker_type, sku, row_data)
  values ('License.Style', 9900001, 'licensed', 'zz4941dir-dup', '{}');
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values ('ZZ4941DIR-MULTI', 'zztest4941', 'multia',
          jsonb_build_object('companyCode','ZZ','divisionCode','ZZ'), v_new);
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values (' zz4941dir-multi ', 'zztest4941', 'multib',
          jsonb_build_object('companyCode','ZZ','divisionCode','ZZ'), v_new);
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values (v_sku_asst, 'zztest4956', 'asst',
          jsonb_build_object('companyCode','ZZ','divisionCode','ZZ',
                             'itemDesc','zztest 4956 assortment head'),
          v_new);
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values (v_sku_defer, 'zztest4956', 'defer',
          jsonb_build_object('companyCode','ZZ','divisionCode','ZZ'),
          v_new + interval '2 days');

  -- Isolated bridge guard: HOST tracker row (its own SKU) manually linked to
  -- BRIDGE-ONLY (whose own SKU has no tracker row), so only the bridge can skip it.
  insert into public.style_tracker_rows (source_sheet, source_row_number, tracker_type, sku, row_data)
  values ('License.Style', 9900002, 'licensed', 'ZZ4941DIR-HOST', '{}');
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values ('ZZ4941DIR-BRIDGE-ONLY', 'zztest4941', 'bridgeonly',
          jsonb_build_object('companyCode','ZZ','divisionCode','ZZ'), v_new);
  insert into plm.style_tracker_item_bridge (
    style_tracker_row_id, source_workbook_id, source_sheet, tracker_type, plm_item_id
  )
  select r.id, r.source_workbook_id, r.source_sheet, r.tracker_type, i.id
  from public.style_tracker_rows r, plm.item i
  where r.sku = 'ZZ4941DIR-HOST' and i.item_number = 'ZZ4941DIR-BRIDGE-ONLY';

  -- Dry run: NEW + one deduped MULTI = 2 eligible; nothing written. The marked
  -- head and the not-yet-projected item are not eligible.
  select * into v_result from public.sync_new_items_into_style_tracker(p_dry_run => true);
  if v_result.inserted_count <> 0 then
    raise exception 'dry run must not insert rows: %', v_result;
  end if;
  select count(*) into v_rows from public.style_tracker_rows where sku = v_sku_new;
  if v_rows <> 0 then raise exception 'dry run wrote a row'; end if;
  if v_result.eligible_count is distinct from 2 then
    raise exception 'expected exactly 2 eligible (old, dup-sku, bridged, assortment and unprojected skipped; MULTI pair deduped): %', v_result;
  end if;

  -- Real run: exactly 2 inserted (NEW and the MULTI winner), licensed, marked.
  select * into v_result from public.sync_new_items_into_style_tracker(p_dry_run => false);
  if v_result.inserted_count is distinct from 2 then
    raise exception 'expected exactly 2 inserted rows: %', v_result;
  end if;
  select count(*) into v_rows from public.style_tracker_rows
   where sku = v_sku_new and tracker_type = 'licensed'
     and source_sheet = 'License.Style'
     and row_data ->> 'origin' = 'plm_item_autoflow';
  if v_rows <> 1 then raise exception 'auto row missing or malformed'; end if;
  if not exists (select 1 from public.style_tracker_rows
                  where sku = v_sku_new
                    and description = 'zztest 4951 coldlion description'
                    and discontinued is true
                    and row_data ->> 'coldlion_created_by' = 'ZZTEST'
                    and row_data ->> 'coldlion_division' = 'ZZ') then
    raise exception 'auto row must be pre-filled from the ColdLion payload';
  end if;

  -- #4956: the marked assortment head got no row on the scheduled leg.
  select count(*) into v_rows from public.style_tracker_rows where upper(btrim(sku)) = v_sku_asst;
  if v_rows <> 0 then raise exception 'assortment head must never receive a tracker row'; end if;

  -- Cross-statement dedupe: a third item with the MULTI pair's SKU adds no row.
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values (' ZZ4941DIR-MULTI ', 'zztest4941', 'multic',
          jsonb_build_object('companyCode','ZZ','divisionCode','ZZ'), v_new);
  select count(*) into v_rows from public.style_tracker_rows
   where upper(btrim(sku)) = 'ZZ4941DIR-MULTI';
  if v_rows <> 1 then
    raise exception 'third same-SKU item must not create a second row, found %', v_rows;
  end if;

  -- Linkage through the existing matcher.
  select b.plm_item_id into v_linked from plm.style_tracker_item_bridge b
   join public.style_tracker_rows r on r.id = b.style_tracker_row_id
   where r.sku = v_sku_new;
  if v_linked is distinct from v_item_new then
    raise exception 'new row must be linked to its plm.item (% vs %)', v_item_new, v_linked;
  end if;

  -- Pre-cutoff item never flowed in.
  select count(*) into v_rows from public.style_tracker_rows where sku = v_sku_old;
  if v_rows <> 0 then raise exception 'pre-cutoff item must not be backfilled'; end if;

  -- Audit: row_added exists for the auto row.
  if not exists (select 1 from public.style_tracker_audit_log a
                  join public.style_tracker_rows r on r.id = a.style_tracker_row_id
                  where r.sku = v_sku_new and a.event_type = 'row_added') then
    raise exception 'row_added audit missing for the auto row';
  end if;

  -- Cron backstop registered.
  if not exists (select 1 from cron.job
                  where jobname = 'nightly-style-tracker-item-autoflow'
                    and schedule = '50 5 * * *'
                    and position('sync_new_items_into_style_tracker' in command) > 0) then
    raise exception 'cron backstop nightly-style-tracker-item-autoflow missing or misconfigured';
  end if;

  -- #4956 evidence gate: the deferred item (no itemDetails row, landed after the
  -- seeded projection) has no row yet; after the next masters projection runs
  -- past its landing, the next sync flows it.
  select count(*) into v_rows from public.style_tracker_rows where sku = v_sku_defer;
  if v_rows <> 0 then raise exception 'item landed after the latest projection must stay deferred'; end if;
  update coldlion.item_detail
     set fetched_at = v_new + interval '3 days', last_seen_at = v_new + interval '3 days'
   where item_no = 'ZZ4956DIR-CLOCK';
  select * into v_result from public.sync_new_items_into_style_tracker(p_dry_run => false);
  if v_result.inserted_count is distinct from 1 then
    raise exception 'expected the formerly deferred item to flow after the projection: %', v_result;
  end if;
  select count(*) into v_rows from public.style_tracker_rows
   where sku = v_sku_defer and row_data ->> 'origin' = 'plm_item_autoflow';
  if v_rows <> 1 then raise exception 'deferred item must flow after the projection passes it'; end if;

  ---------------- Live leg: the real import entry point.
  -- One import call: item + Licensed row + bridge link, no explicit sync call;
  -- its statement also carries a duplicate-SKU pair for within-statement dedupe
  -- and a marked assortment head that must come away with no row.
  select * into v_result from plm.import_item_master_data(jsonb_build_object(
    'sweepId', '7f4d5111-0000-4000-8000-494100000001', 'terminalReached', true,
    'items', jsonb_build_array(
      jsonb_build_object('companyCode','ZZ','divisionCode','ZZ','itemNo', v_sku_imp,
                         'itemDesc','zztest 4941 live import'),
      jsonb_build_object('companyCode','ZZ','divisionCode','ZZ','itemNo','ZZ4941DIR-MULTI-2',
                         'itemDesc','zztest 4941 same sku a'),
      jsonb_build_object('companyCode','ZZ','divisionCode','ZZ','itemNo',' zz4941dir-multi-2 ',
                         'itemDesc','zztest 4941 same sku b'),
      jsonb_build_object('companyCode','ZZ','divisionCode','ZZ','itemNo', v_sku_imp_asst,
                         'itemDesc','zztest 4956 live assortment head'))
  ));
  select count(*) into v_rows from public.style_tracker_rows
   where sku = v_sku_imp and tracker_type = 'licensed'
     and source_sheet = 'License.Style'
     and row_data ->> 'origin' = 'plm_item_autoflow';
  if v_rows <> 1 then
    raise exception 'import must create exactly one licensed auto row for the new item, found %', v_rows;
  end if;
  if not exists (select 1 from plm.style_tracker_item_bridge b
                  join public.style_tracker_rows r on r.id = b.style_tracker_row_id
                  join plm.item i on i.id = b.plm_item_id
                  where i.item_number = v_sku_imp and r.sku = v_sku_imp) then
    raise exception 'import must link the new row to its plm.item';
  end if;
  if not exists (select 1 from public.style_tracker_rows
                  where sku = v_sku_imp
                    and coalesce(description, '') = 'zztest 4941 live import') then
    raise exception 'live import row must carry the ColdLion description';
  end if;
  -- Within-statement dedupe on the live path: two same-normalized-SKU items in
  -- ONE import statement yield exactly one tracker row.
  select count(*) into v_rows from public.style_tracker_rows
   where upper(btrim(sku)) = 'ZZ4941DIR-MULTI-2';
  if v_rows <> 1 then
    raise exception 'one import statement with a duplicate SKU pair must yield one row, found %', v_rows;
  end if;
  -- #4956: a marked assortment head imported live gets no row either.
  select count(*) into v_rows from public.style_tracker_rows
   where upper(btrim(sku)) = v_sku_imp_asst;
  if v_rows <> 0 then
    raise exception 'live import must not create a row for a marked assortment head, found %', v_rows;
  end if;

  -- Re-import (update path) must not duplicate.
  perform plm.import_item_master_data(jsonb_build_object(
    'sweepId', '7f4d5111-0000-4000-8000-494100000002', 'terminalReached', true, 'minimumSilverRatio', 0.05,
    'items', jsonb_build_array(
      jsonb_build_object('companyCode','ZZ','divisionCode','ZZ','itemNo', v_sku_imp,
                         'itemDesc','zztest 4941 live import v2'))
  ));
  select count(*) into v_rows from public.style_tracker_rows
   where upper(btrim(sku)) = upper(btrim(v_sku_imp));
  if v_rows <> 1 then
    raise exception 're-import must not duplicate the row, found %', v_rows;
  end if;

  -- After both legs handled everything, explicit runs are no-ops.
  select * into v_result from public.sync_new_items_into_style_tracker(p_dry_run => true);
  if v_result.eligible_count is distinct from 0 then
    raise exception 'after both legs, dry run must report 0 eligible: %', v_result;
  end if;
  select * into v_result from public.sync_new_items_into_style_tracker(p_dry_run => false);
  if v_result.inserted_count is distinct from 0 then
    raise exception 'explicit run must be a no-op after both legs: %', v_result;
  end if;
end
$test$;

rollback;
