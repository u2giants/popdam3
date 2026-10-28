-- Issue #4974 (claim #4975): end the nightly-evidence wait for brand-new Master Data
-- auto-flow lines and run the owner's one-time pre-cutoff sweep. Re-derives the
-- #4909/#4941/#4951/#4956 function.
--
-- WHY (owner direction, Albert Hazan, 2026-10-28, verbatim: "that's not good.
-- why would anything slip in? if it has a prepack code, don't import it. i want
-- a one-time sweep of pre-cutoff items"): #4956's evidence gate deferred items
-- whose itemDetails row had not landed yet (nightly masters, 05:20 UTC), so a
-- brand-new item waited up to a day for its line. The sweep workflow side of
-- this change (tools/sync-coldlion-items.mjs, same pull request) now lands the
-- per-item /itemDetails rows of NEW items BEFORE the import runs, so the
-- assortment marker is present at decision time and no deferral happens in the
-- normal path. This migration's function side:
--   1. p_cutoff becomes a parameter (default 2026-10-28T00:00:00Z — unchanged
--      behavior; the cron backstop and the import call it with the default).
--   2. One-time sweep: the function runs once with p_cutoff 2026-10-23T00:00Z
--      to backfill the pre-cutoff window (see the comment at the call).
-- The evidence gate itself is deliberately KEPT as the failure backstop: if a
-- per-item detail pull fails, the item still defers to the next FULL masters
-- projection (the gate clock now reads only masters runs, never the delta's)
-- rather than being wrongly cleared or wrongly skipped.

-- derived-from: 20261028151632

begin;

-- The new parameter list is a NEW signature: CREATE OR REPLACE alone would leave
-- the (boolean) original live next to it, making every 0/1-argument call
-- ambiguous. Drop the old overload first (governed review round 1, H1); every
-- caller — the cron command, plm.import_item_master_data's named p_dry_run call,
-- and the contract tests — resolves to the single remaining signature.
drop function if exists public.sync_new_items_into_style_tracker(boolean);

create or replace function public.sync_new_items_into_style_tracker(p_dry_run boolean default false, p_cutoff timestamptz default '2026-10-28T00:00:00Z'::timestamptz)
returns table(eligible_count integer, inserted_count integer, deferred_count integer)
language plpgsql
security definer
set search_path = public, plm, pg_catalog
as $fn$
declare
  -- p_cutoff: 2026-10-28T00:00:00Z, the first nightly after promotion. Items first seen
  -- in the item master before this timestamp keep today's manual/add-row process by
  -- owner decision (#4909). #4974 exposes it as a parameter for the one-time
  -- pre-cutoff sweep only; the default is unchanged and the cron backstop uses it.
  v_max_rows integer := 500;
  v_eligible integer;
  v_deferred integer;
  v_next_row_number integer;
  v_masters_fetched_at timestamptz;
begin
  -- Assortment evidence clock (#4956, hardened #4974 review round 1 H2): only a
  -- FULL masters projection ('coldlion-landing sync-masters', which pulls every
  -- item's details) may clear a rowless item. The item-sweep delta lands rows too
  -- but is per-item and partial — its runs must not advance this clock, or a
  -- transiently-failed assortment pull would be wrongly cleared by the next delta
  -- landing some other item.
  select max(finished_at) into v_masters_fetched_at
    from coldlion.sync_run
   where endpoint = '/itemDetails'
     and requested_by = 'coldlion-landing sync-masters'
     and status = 'succeeded';

  -- One candidate per normalized SKU: DISTINCT ON picks the oldest plm.item, so two new
  -- plm.item rows sharing upper(btrim(sku)) in one run cannot insert two tracker rows.
  with deduped as (
    select distinct on (upper(btrim(coalesce(i.style_number, i.item_number))))
           i.id as plm_item_id,
           btrim(coalesce(i.style_number, i.item_number)) as sku_value,
           i.created_at,
           coalesce(nullif(i.raw ->> 'itemDisplayDesc', ''), nullif(i.raw ->> 'itemDesc', ''), nullif(i.description, '')) as desc_value,
           lic.name as licensor_value,
           case lower(btrim(i.raw ->> 'itemDiscontinued'))
             when 'y' then true when 'true' then true when 't' then true when '1' then true
             when 'n' then false when 'false' then false when 'f' then false when '0' then false
             else null
           end as discontinued_value,
           nullif(i.raw ->> 'itemNote', '') as notes_value,
           jsonb_strip_nulls(jsonb_build_object(
             'origin', 'plm_item_autoflow',
             'coldlion_created_by', nullif(i.raw ->> 'createdUser', ''),
             'coldlion_created_at', nullif(i.raw ->> 'createdTime', ''),
             'coldlion_division', nullif(i.raw ->> 'divisionCode', ''),
             'coldlion_vendor_code', nullif(i.raw ->> 'vendorCode', ''),
             'coldlion_royalty_code', nullif(i.raw ->> 'royaltyCode', ''),
             'coldlion_size_range', nullif(i.raw ->> 'sizeRangeCode', '')
           )) as row_data_value
    from plm.item i
    left join core.licensor lic on lic.id = i.licensor_id
    where i.created_at >= p_cutoff
      and coalesce(btrim(i.style_number), btrim(i.item_number)) <> ''
      and not exists (
        select 1 from public.style_tracker_rows r
        where upper(btrim(r.sku)) = upper(btrim(coalesce(i.style_number, i.item_number)))
      )
      and not exists (
        select 1 from plm.style_tracker_item_bridge b
        where b.plm_item_id = i.id
      )
      -- #4956 assortment skip, half 1: a marked head is never eligible. The live
      -- parent marker is the head's own pre_pack_code; components carry none.
      and not exists (
        select 1
        from coldlion.item_detail d
        where d.company_code = i.raw ->> 'companyCode'
          and d.division_code = i.raw ->> 'divisionCode'
          and btrim(d.item_no) = btrim(coalesce(nullif(btrim(i.style_number), ''), btrim(i.item_number)))
          and nullif(btrim(d.pre_pack_code), '') is not null
      )
      -- #4956 assortment skip, half 2: without an itemDetails row the item is
      -- undecided, not cleared. Decide it only once a masters projection has
      -- completed after the item landed; items ColdLion never details pass this
      -- gate as soon as any projection has run past their landing time.
      and (
        exists (
          select 1
          from coldlion.item_detail d
          where d.company_code = i.raw ->> 'companyCode'
            and d.division_code = i.raw ->> 'divisionCode'
            and btrim(d.item_no) = btrim(coalesce(nullif(btrim(i.style_number), ''), btrim(i.item_number)))
        )
        or i.created_at <= v_masters_fetched_at
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
           i.created_at,
           coalesce(nullif(i.raw ->> 'itemDisplayDesc', ''), nullif(i.raw ->> 'itemDesc', ''), nullif(i.description, '')) as desc_value,
           lic.name as licensor_value,
           case lower(btrim(i.raw ->> 'itemDiscontinued'))
             when 'y' then true when 'true' then true when 't' then true when '1' then true
             when 'n' then false when 'false' then false when 'f' then false when '0' then false
             else null
           end as discontinued_value,
           nullif(i.raw ->> 'itemNote', '') as notes_value,
           jsonb_strip_nulls(jsonb_build_object(
             'origin', 'plm_item_autoflow',
             'coldlion_created_by', nullif(i.raw ->> 'createdUser', ''),
             'coldlion_created_at', nullif(i.raw ->> 'createdTime', ''),
             'coldlion_division', nullif(i.raw ->> 'divisionCode', ''),
             'coldlion_vendor_code', nullif(i.raw ->> 'vendorCode', ''),
             'coldlion_royalty_code', nullif(i.raw ->> 'royaltyCode', ''),
             'coldlion_size_range', nullif(i.raw ->> 'sizeRangeCode', '')
           )) as row_data_value
    from plm.item i
    left join core.licensor lic on lic.id = i.licensor_id
    where i.created_at >= p_cutoff
      and coalesce(btrim(i.style_number), btrim(i.item_number)) <> ''
      and not exists (
        select 1 from public.style_tracker_rows r
        where upper(btrim(r.sku)) = upper(btrim(coalesce(i.style_number, i.item_number)))
      )
      and not exists (
        select 1 from plm.style_tracker_item_bridge b
        where b.plm_item_id = i.id
      )
      -- #4956 assortment skip, half 1 (identical to the counting CTE above).
      and not exists (
        select 1
        from coldlion.item_detail d
        where d.company_code = i.raw ->> 'companyCode'
          and d.division_code = i.raw ->> 'divisionCode'
          and btrim(d.item_no) = btrim(coalesce(nullif(btrim(i.style_number), ''), btrim(i.item_number)))
          and nullif(btrim(d.pre_pack_code), '') is not null
      )
      -- #4956 assortment skip, half 2 (identical to the counting CTE above).
      and (
        exists (
          select 1
          from coldlion.item_detail d
          where d.company_code = i.raw ->> 'companyCode'
            and d.division_code = i.raw ->> 'divisionCode'
            and btrim(d.item_no) = btrim(coalesce(nullif(btrim(i.style_number), ''), btrim(i.item_number)))
        )
        or i.created_at <= v_masters_fetched_at
      )
    order by upper(btrim(coalesce(i.style_number, i.item_number))), i.created_at, i.id
  ),
  capped as (
    select plm_item_id, sku_value, created_at, desc_value, licensor_value,
           discontinued_value, notes_value, row_data_value
    from deduped
    order by created_at, plm_item_id
    limit v_max_rows
  )
  insert into public.style_tracker_rows (
    source_workbook_id, source_sheet, source_row_number, tracker_type, sku,
    description, licensor, discontinued, notes, row_data
  )
  select
    '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214',
    'License.Style',
    v_next_row_number + row_number() over (order by c.created_at, c.plm_item_id) - 1,
    'licensed',
    c.sku_value,
    c.desc_value,
    c.licensor_value,
    c.discontinued_value,
    c.notes_value,
    c.row_data_value
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

revoke all on function public.sync_new_items_into_style_tracker(boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_new_items_into_style_tracker(boolean, timestamptz) to service_role;

-- The cron backstop is deliberately NOT rewritten here: migration 20261027185232
-- already registers nightly-style-tracker-item-autoflow (50 5 * * *) on production,
-- preview and the CI replay, and this change alters neither its schedule nor its
-- command — only the body of the function it calls. Re-declaring it would add a
-- second written object (table cron.job) outside this change's admitted scope.

-- One-time cleanup (#4956): remove the one assortment line the auto-flow created
-- before the skip existed. Scoped to the auto origin so a team-entered BRG6206
-- line, if any ever exists, is untouched; idempotent (zero rows on databases
-- that never had the defect, including preview).
delete from public.style_tracker_rows r
 where r.row_data ->> 'origin' = 'plm_item_autoflow'
   and upper(btrim(r.sku)) = 'BRG6206';

do $verify$
declare
  v_fn record;
  v_job cron.job%rowtype;
  v_fnsrc text;
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

  -- #4956: the assortment evidence table must carry the columns the skip reads.
  if not exists (select 1 from pg_attribute
                  where attrelid = 'coldlion.item_detail'::regclass and attname = 'pre_pack_code'
                     and not attisdropped)
     or not exists (select 1 from pg_attribute
                     where attrelid = 'coldlion.item_detail'::regclass and attname = 'fetched_at'
                        and not attisdropped)
     or not exists (select 1 from pg_attribute
                     where attrelid = 'coldlion.item_detail'::regclass and attname = 'company_code'
                        and not attisdropped)
     or not exists (select 1 from pg_attribute
                     where attrelid = 'coldlion.item_detail'::regclass and attname = 'division_code'
                        and not attisdropped)
     or not exists (select 1 from pg_attribute
                     where attrelid = 'coldlion.item_detail'::regclass and attname = 'item_no'
                        and not attisdropped) then
    raise exception '#4956: coldlion.item_detail is missing the assortment-marker columns';
  end if;

  if to_regprocedure('public.sync_new_items_into_style_tracker(boolean)') is not null then
    raise exception '#4974: the shadowed (boolean) overload must not survive this migration';
  end if;

  select prosecdef, proconfig, proacl, prosrc into v_fn from pg_proc
   where oid = 'public.sync_new_items_into_style_tracker(boolean, timestamptz)'::regprocedure;
  if not v_fn.prosecdef
     or v_fn.proconfig is distinct from array['search_path=public, plm, pg_catalog'] then
    raise exception '#4909: sync_new_items_into_style_tracker lost SECURITY DEFINER or search_path';
  end if;
  if (select array_agg(format('%s:%s', coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC'), a.privilege_type) order by 1)
        from aclexplode(v_fn.proacl) a)
     is distinct from array['postgres:EXECUTE', 'service_role:EXECUTE'] then
    raise exception '#4909: execute ACL changed: %', v_fn.proacl;
  end if;

  -- #4956: the shipped body really carries the assortment skip halves.
  v_fnsrc := v_fn.prosrc;
  if position('pre_pack_code' in v_fnsrc) = 0
     or position('v_masters_fetched_at' in v_fnsrc) = 0
     or position('p_cutoff' in v_fnsrc) = 0 then
    raise exception '#4956/#4974: the assortment skip or cutoff parameter is absent from the function body';
  end if;

  -- #4956: the wrongly created assortment line is gone.
  if exists (select 1 from public.style_tracker_rows r
              where r.row_data ->> 'origin' = 'plm_item_autoflow'
                and upper(btrim(r.sku)) = 'BRG6206') then
    raise exception '#4956: the auto-origin BRG6206 tracker row still exists';
  end if;

  select * into v_job from cron.job where jobname = 'nightly-style-tracker-item-autoflow';
  if v_job.jobid is null or v_job.schedule is distinct from '50 5 * * *'
     or position('sync_new_items_into_style_tracker' in v_job.command) = 0 then
    raise exception '#4909: cron job nightly-style-tracker-item-autoflow is not registered as expected';
  end if;
end
$verify$;

-- One-time pre-cutoff sweep (#4974, owner direction 2026-10-28: "i want a
-- one-time sweep of pre-cutoff items"): the same function, run once with the
-- cutoff lowered to 2026-10-23T00:00Z (the five-day window the owner's earlier
-- sweep used). Verified read-only on production 2026-10-28: the window holds
-- exactly one eligible non-assortment item without a line (SNM57WBFT01, SP001,
-- no itemDetails row, evidence gate passes because masters projections have run
-- past its landing); the eight other rowless items are marked assortments and
-- the skip excludes them at any cutoff. Idempotent: rows that already exist are
-- skipped by the SKU guard, so re-applying on a database without the gap (any
-- rehearsal) inserts nothing. The counts are raised as a notice so the apply
-- log carries the sweep's actual effect on every target database.
do $sweep$
declare
  v_result record;
begin
  select * into v_result
    from public.sync_new_items_into_style_tracker(p_dry_run => false, p_cutoff => '2026-10-23T00:00:00Z'::timestamptz);
  raise notice '#4974 one-time pre-cutoff sweep: eligible %, inserted %, deferred %',
    v_result.eligible_count, v_result.inserted_count, v_result.deferred_count;
end
$sweep$;

commit;
