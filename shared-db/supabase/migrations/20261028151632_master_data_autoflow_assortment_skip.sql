-- Issue #4956 (claim #4961): exclude ColdLion assortments from the Master Data
-- auto-flow (re-derives the #4909/#4941/#4951 function) and remove the one line
-- the flow wrongly created. Defect found at wrap-up 2026-10-28: BRG6206 is an
-- assortment head and assortments must not appear in Master Data
-- (docs/business-rules/product-items-and-identifiers.md, owner ruling
-- 2026-09-06), but both the live import path and the nightly backstop gave it a
-- Licensed line because plm.item's own /items payload carries no assortment
-- marker.
--
-- MARKER SEMANTICS (verified read-only on production 2026-10-28, issue #4956):
-- coldlion.item_detail.pre_pack_code is set on the assortment HEAD, not the
-- members: BRG6206 carries PPK2943 while its four single-brand components
-- (BRG62NBSF03, BRG62MVSP01, BRG62SESR04, BRG62SESR03) are enumerated in
-- coldlion.prepack_detail under PPK2943 and carry no marker themselves. At
-- population level: 2,542 distinct items carry a non-empty pre_pack_code; only
-- 13 of them also appear as prepack_detail components and only 4 as
-- transaction-attested prod_history_component heads, while sampled attested
-- heads and sampled components carry no marker at all. This matches the
-- 2026-09-28 correction in the business-rules doc ("the authoritative live
-- parent marker is GET /itemDetails -> prePackCode") and supersedes the older
-- table in the same doc that mapped this column to prepack members; that table
-- is corrected separately in the docs, not here. All nine assortments among the
-- items created 2026-10-23..28 carry the marker; BRG6206 is the only one that
-- ever received a tracker row.
--
-- EVIDENCE GATE (why the skip has two halves). The only writer of
-- coldlion.item_detail is the nightly masters landing (coldlion-landing-sync,
-- 05:20 UTC), which upserts fetched_at on every row, so max(fetched_at) is the
-- moment the latest itemDetails projection completed. The item sweep runs every
-- 30 minutes, so a brand-new item can land in plm.item long before its
-- itemDetails row exists. A bare "marker is null" skip would then clear a
-- mid-day assortment on arrival and recreate this defect. Therefore:
--   1. marked head  -> never eligible (any item_detail row with a pre_pack_code);
--   2. no itemDetails row at all -> eligible only once a masters projection has
--      completed after the item landed (created_at <= max(fetched_at)); items
--      ColdLion never details stay eligible once a projection has passed them.
-- Deferred items need no new machinery: every run re-evaluates them, so the row
-- appears on the first run after the next masters landing (worst case ~24h).
--
-- CLEANUP: exactly one wrongly created line exists (verified read-only
-- 2026-10-28): the auto-origin BRG6206 row. The other eight assortments among
-- recent items never got rows. The bridge link follows the row via ON DELETE
-- CASCADE; style_tracker_audit_log keeps its events with the row id set to NULL
-- by its ON DELETE SET NULL foreign key.

-- derived-from: 20261028130227

begin;

create or replace function public.sync_new_items_into_style_tracker(p_dry_run boolean default false)
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
  v_masters_fetched_at timestamptz;
begin
  -- Assortment evidence clock (#4956): the masters landing is the only writer of
  -- coldlion.item_detail and advances fetched_at on every row it touches, so this
  -- is when the latest itemDetails projection completed.
  select max(fetched_at) into v_masters_fetched_at from coldlion.item_detail;

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

revoke all on function public.sync_new_items_into_style_tracker(boolean) from public, anon, authenticated;
grant execute on function public.sync_new_items_into_style_tracker(boolean) to service_role;

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

  select prosecdef, proconfig, proacl, prosrc into v_fn from pg_proc
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

  -- #4956: the shipped body really carries the assortment skip halves.
  v_fnsrc := v_fn.prosrc;
  if position('pre_pack_code' in v_fnsrc) = 0
     or position('v_masters_fetched_at' in v_fnsrc) = 0 then
    raise exception '#4956: the assortment skip predicates are absent from the function body';
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

commit;
