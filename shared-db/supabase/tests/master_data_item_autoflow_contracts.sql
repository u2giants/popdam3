-- shared-db#4909: public.sync_new_items_into_style_tracker creates exactly one Licensed
-- tracker row per new plm.item born after the cutoff (deduplicated per normalized SKU),
-- skips SKUs that already have a row and items already bridged, links the new row through
-- the existing bridge matcher, is idempotent, honors the dry-run flag, audits row_added,
-- registers the nightly cron job, and is not callable by anon/authenticated.
-- LOCAL THROWAWAY DATABASE ONLY; never execute against production. Rolled back.
begin;

do $test$
declare
  v_cutoff timestamptz;
  v_old timestamptz := now() - interval '30 days';
  v_new timestamptz := now() + interval '1 day';
  v_result record;
  v_item_new uuid;
  v_item_dup_a uuid;
  v_item_dup_b uuid;
  v_row_id uuid;
  v_linked uuid;
  v_sku_new text := 'ZZTEST4909-NEW';
  v_sku_old text := 'ZZTEST4909-OLD';
  v_rows integer;
begin
  if has_function_privilege('authenticated', 'public.sync_new_items_into_style_tracker(boolean)', 'execute')
     or has_function_privilege('anon', 'public.sync_new_items_into_style_tracker(boolean)', 'execute') then
    raise exception 'sync_new_items_into_style_tracker must not be executable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.sync_new_items_into_style_tracker(boolean)', 'execute') then
    raise exception 'service_role must execute sync_new_items_into_style_tracker';
  end if;

  -- Recover the shipped cutoff from the function body so the fixtures straddle it.
  select (regexp_match(prosrc, 'v_cutoff[^:=]*:=[[:space:]]*''([^'']+)''', 'i'))[1]::timestamptz
    into v_cutoff from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_new_items_into_style_tracker';
  if v_cutoff is null then
    raise exception 'could not read the cutoff constant from the function body';
  end if;
  v_old := least(v_old, v_cutoff - interval '1 day');
  v_new := greatest(v_new, v_cutoff + interval '1 day');

  -- Fixtures:
  --  OLD      born before the cutoff            -> must NOT flow in (no backfill)
  --  NEW      born after, fresh unique SKU      -> must flow in, linked
  --  DUP      born after, SKU of an existing row -> must be skipped (sku guard)
  --  HOST     tracker row manually bridged to BRIDGE-ONLY (different SKU) —
  --           BRIDGE-ONLY's own SKU has no tracker row, so only the bridge
  --           guard can skip it                                -> isolated bridge-skip
  --  DUP_A/B  born after, two items sharing one normalized SKU -> exactly ONE row
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values (v_sku_old, 'zztest4909', 'old', '{}', v_old);
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values (v_sku_new, 'zztest4909', 'new', '{}', v_new)
  returning id into v_item_new;
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values ('ZZTEST4909-DUP', 'zztest4909', 'dup', '{}', v_new);
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values ('ZZTEST4909-BRIDGE-ONLY', 'zztest4909', 'bridgeonly', '{}', v_new);
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values ('ZZTEST4909-MULTI', 'zztest4909', 'multia', '{}', v_new)
  returning id into v_item_dup_a;
  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values (' zztest4909-multi ', 'zztest4909', 'multib', '{}', v_new)
  returning id into v_item_dup_b;

  insert into public.style_tracker_rows (source_sheet, source_row_number, tracker_type, sku, row_data)
  values ('License.Style', 9900001, 'licensed', 'zztest4909-dup', '{}');

  -- Bridge fixture: HOST tracker row (its own SKU) manually linked to BRIDGE-ONLY.
  insert into public.style_tracker_rows (source_sheet, source_row_number, tracker_type, sku, row_data)
  values ('License.Style', 9900002, 'licensed', 'ZZTEST4909-HOST', '{}');
  insert into plm.style_tracker_item_bridge (
    style_tracker_row_id, source_workbook_id, source_sheet, tracker_type, plm_item_id
  )
  select r.id, r.source_workbook_id, r.source_sheet, r.tracker_type, i.id
  from public.style_tracker_rows r, plm.item i
  where r.sku = 'ZZTEST4909-HOST' and i.item_number = 'ZZTEST4909-BRIDGE-ONLY';

  -- Dry run reports eligibility (NEW + one deduped MULTI = 2) but writes nothing.
  select * into v_result from public.sync_new_items_into_style_tracker(p_dry_run => true);
  if v_result.inserted_count <> 0 then
    raise exception 'dry run must not insert rows: %', v_result;
  end if;
  select count(*) into v_rows from public.style_tracker_rows where sku = v_sku_new;
  if v_rows <> 0 then raise exception 'dry run wrote a row'; end if;
  if v_result.eligible_count is distinct from 2 then
    raise exception 'expected exactly 2 eligible (pre-cutoff, dup-sku, bridged skipped; MULTI pair deduped): %', v_result;
  end if;

  -- Real run inserts exactly the two rows (NEW and the MULTI winner), licensed, marked.
  select * into v_result from public.sync_new_items_into_style_tracker(p_dry_run => false);
  if v_result.inserted_count is distinct from 2 then
    raise exception 'expected exactly 2 inserted rows: %', v_result;
  end if;
  select count(*) into v_rows from public.style_tracker_rows
   where sku = v_sku_new and tracker_type = 'licensed'
     and source_sheet = 'License.Style'
     and row_data ->> 'origin' = 'plm_item_autoflow';
  if v_rows <> 1 then raise exception 'auto row missing or malformed'; end if;

  -- Batch-internal duplicate SKU: exactly ONE tracker row for the shared normalized SKU.
  select count(*) into v_rows from public.style_tracker_rows
   where upper(btrim(sku)) = 'ZZTEST4909-MULTI';
  if v_rows <> 1 then
    raise exception 'duplicate-SKU pair must dedupe to one row, found %', v_rows;
  end if;

  -- Linkage: the unique new SKU is bridged to its plm.item by the existing matcher.
  select b.plm_item_id into v_linked from plm.style_tracker_item_bridge b
   join public.style_tracker_rows r on r.id = b.style_tracker_row_id
   where r.sku = v_sku_new;
  if v_linked is distinct from v_item_new then
    raise exception 'new row must be linked to its plm.item (% vs %)', v_item_new, v_linked;
  end if;

  -- Audit: the trigger logged row_added for the auto row.
  select r.id into v_row_id from public.style_tracker_rows r where r.sku = v_sku_new;
  if not exists (select 1 from public.style_tracker_audit_log a
                  where a.style_tracker_row_id = v_row_id and a.event_type = 'row_added') then
    raise exception 'row_added audit missing for the auto row';
  end if;

  -- Pre-cutoff item never flowed in.
  select count(*) into v_rows from public.style_tracker_rows where sku = v_sku_old;
  if v_rows <> 0 then raise exception 'pre-cutoff item must not be backfilled'; end if;

  -- Cron job is registered with the expected schedule and command.
  if not exists (select 1 from cron.job
                  where jobname = 'nightly-style-tracker-item-autoflow'
                    and schedule = '50 5 * * *'
                    and position('sync_new_items_into_style_tracker' in command) > 0) then
    raise exception 'cron job nightly-style-tracker-item-autoflow missing or misconfigured';
  end if;

  -- Idempotent: an immediate re-run finds nothing eligible.
  select * into v_result from public.sync_new_items_into_style_tracker(p_dry_run => true);
  if v_result.eligible_count is distinct from 0 then
    raise exception 're-run must be idempotent: %', v_result;
  end if;
end
$test$;

rollback;
