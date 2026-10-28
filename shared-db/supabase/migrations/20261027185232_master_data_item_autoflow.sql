-- Issue #4909: Master Data auto-flow. Items born in DesignFlow reach plm.item through the
-- nightly ColdLion sweep (05:20 UTC, plm.import_item_master_data), but nothing created a
-- Master Data row for them: rows appeared only via the manual Add-row RPC or the Google
-- Sheet import, and plm.refresh_style_tracker_item_bridge only links rows that already
-- exist. This adds one additive function plus a nightly cron at 05:50 UTC (after the
-- sweep): for each plm.item born on/after the cutoff, insert one Licensed tracker row
-- (source_sheet 'License.Style', tracker_type 'licensed', sku =
-- coalesce(style_number, item_number), row_data {"origin":"plm_item_autoflow"}) and then
-- run the existing bridge refresh so the row arrives linked.
--
-- Deliberately incremental: items with created_at before the cutoff are NOT backfilled.
-- Idempotent: an item whose normalized SKU already has a tracker row (any tab) or whose
-- id is already bridged is skipped, so a re-run inserts nothing. No updates, no deletes,
-- cap 500 inserts per run (oldest first) with a warning for the remainder (nightly delta
-- is 2-25/day). Exactly one row per normalized SKU even when several new plm.item rows
-- share it: DISTINCT ON keeps the oldest, because the unique-match linker would strand a
-- duplicate pair as ambiguous forever (governed review round 1, REJECT 0b334d7f7afe).

begin;

create function public.sync_new_items_into_style_tracker(p_dry_run boolean default false)
returns table(eligible_count integer, inserted_count integer, deferred_count integer)
language plpgsql
security definer
set search_path = public, plm, pg_catalog
as $fn$
declare
  -- v_cutoff: 2026-10-28T00:00:00Z, the first nightly after promotion. Items first seen
  -- in the item master before this timestamp keep today's manual/add-row process by
  -- owner decision.
  v_cutoff timestamptz := '2026-10-28T00:00:00Z'::timestamptz;
  v_max_rows integer := 500;
  v_eligible integer;
  v_deferred integer;
  v_next_row_number integer;
begin
  -- One candidate per normalized SKU: DISTINCT ON picks the oldest plm.item, so two new
  -- plm.item rows sharing upper(btrim(sku)) in one run cannot insert two tracker rows.
  with deduped as (
    select distinct on (upper(btrim(coalesce(i.style_number, i.item_number))))
           i.id as plm_item_id,
           btrim(coalesce(i.style_number, i.item_number)) as sku_value,
           i.created_at
    from plm.item i
    where i.created_at >= v_cutoff
      and coalesce(btrim(i.style_number), btrim(i.item_number)) <> ''
      and not exists (
        select 1 from public.style_tracker_rows r
        where upper(btrim(r.sku)) = upper(btrim(coalesce(i.style_number, i.item_number)))
      )
      and not exists (
        select 1 from plm.style_tracker_item_bridge b
        where b.plm_item_id = i.id
      )
    order by upper(btrim(coalesce(i.style_number, i.item_number))), i.created_at, i.id
  )
  select count(*) into v_eligible from deduped;

  v_deferred := greatest(0, v_eligible - v_max_rows);
  if v_deferred > 0 then
    raise warning 'sync_new_items_into_style_tracker: % eligible items exceed the % row cap; % deferred to the next run',
      v_eligible, v_max_rows, v_deferred;
  end if;

  if p_dry_run then
    eligible_count := v_eligible;
    inserted_count := 0;
    deferred_count := v_deferred;
    return next;
    return;
  end if;

  select coalesce(max(source_row_number), 2) + 1 into v_next_row_number
  from public.style_tracker_rows
  where source_workbook_id = '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214'
    and source_sheet = 'License.Style';

  with deduped as (
    select distinct on (upper(btrim(coalesce(i.style_number, i.item_number))))
           i.id as plm_item_id,
           btrim(coalesce(i.style_number, i.item_number)) as sku_value,
           i.created_at
    from plm.item i
    where i.created_at >= v_cutoff
      and coalesce(btrim(i.style_number), btrim(i.item_number)) <> ''
      and not exists (
        select 1 from public.style_tracker_rows r
        where upper(btrim(r.sku)) = upper(btrim(coalesce(i.style_number, i.item_number)))
      )
      and not exists (
        select 1 from plm.style_tracker_item_bridge b
        where b.plm_item_id = i.id
      )
    order by upper(btrim(coalesce(i.style_number, i.item_number))), i.created_at, i.id
  ),
  capped as (
    select plm_item_id, sku_value, created_at
    from deduped
    order by created_at, plm_item_id
    limit v_max_rows
  )
  insert into public.style_tracker_rows (
    source_workbook_id, source_sheet, source_row_number, tracker_type, sku, row_data
  )
  select
    '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214',
    'License.Style',
    v_next_row_number + row_number() over (order by c.created_at, c.plm_item_id) - 1,
    'licensed',
    c.sku_value,
    jsonb_build_object('origin', 'plm_item_autoflow')
  from capped c;

  get diagnostics inserted_count = row_count;

  -- Link the new rows through the existing, already-reviewed matcher: unique
  -- upper(trim(sku)) = upper(trim(coalesce(style_number, item_number))) wins, ambiguous
  -- SKUs stay unmatched for manual linking, exactly like hand-added rows. The refresh is
  -- a full-tracker reconcile, so skip it on zero-insert nights.
  if inserted_count > 0 then
    perform plm.refresh_style_tracker_item_bridge();
  end if;

  eligible_count := v_eligible;
  deferred_count := v_deferred;
  return next;
end;
$fn$;

revoke all on function public.sync_new_items_into_style_tracker(boolean) from public, anon, authenticated;
grant execute on function public.sync_new_items_into_style_tracker(boolean) to service_role;

do $cron$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'nightly-style-tracker-item-autoflow'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'nightly-style-tracker-item-autoflow',
    '50 5 * * *',
    $cron_body$ select public.sync_new_items_into_style_tracker() $cron_body$
  );
end
$cron$;

do $verify$
declare
  v_fn record;
  v_job cron.job%rowtype;
begin
  -- Dependencies CREATE FUNCTION does not validate: fail at migration time, not at the
  -- 05:50 cron run (governed review round 1, medium finding).
  if not exists (select 1 from pg_attribute
                  where attrelid = 'plm.item'::regclass and attname = 'style_number'
                     and not attisdropped)
     or not exists (select 1 from pg_attribute
                     where attrelid = 'plm.item'::regclass and attname = 'item_number'
                        and not attisdropped)
     or not exists (select 1 from pg_attribute
                     where attrelid = 'plm.item'::regclass and attname = 'created_at'
                        and not attisdropped) then
    raise exception '#4909: plm.item is missing style_number/item_number/created_at';
  end if;
  if to_regprocedure('plm.refresh_style_tracker_item_bridge()') is null
     or pg_get_function_result('plm.refresh_style_tracker_item_bridge()'::regprocedure)
        <> 'TABLE(inserted_count integer, updated_count integer, total_count integer)' then
    raise exception '#4909: plm.refresh_style_tracker_item_bridge() is missing or reshaped';
  end if;
  if not exists (select 1 from pg_attribute
                  where attrelid = 'plm.style_tracker_item_bridge'::regclass
                    and attname = 'plm_item_id' and not attisdropped) then
    raise exception '#4909: plm.style_tracker_item_bridge is missing plm_item_id';
  end if;

  select prosecdef, proconfig, proacl into v_fn from pg_proc
   where oid = 'public.sync_new_items_into_style_tracker(boolean)'::regprocedure;
  if not v_fn.prosecdef
     or v_fn.proconfig is distinct from array['search_path=public, plm, pg_catalog'] then
    raise exception '#4909: sync_new_items_into_style_tracker lost SECURITY DEFINER or search_path';
  end if;
  if (select array_agg(format('%s:%s', coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC'), a.privilege_type) order by 1)
        from aclexplode(v_fn.proacl) a)
     is distinct from array['postgres:EXECUTE', 'service_role:EXECUTE'] then
    raise exception '#4909: execute ACL changed: %', v_fn.proacl;
  end if;

  select * into v_job from cron.job where jobname = 'nightly-style-tracker-item-autoflow';
  if v_job.jobid is null or v_job.schedule is distinct from '50 5 * * *'
     or position('sync_new_items_into_style_tracker' in v_job.command) = 0 then
    raise exception '#4909: cron job nightly-style-tracker-item-autoflow is not registered as expected';
  end if;
end
$verify$;

commit;
