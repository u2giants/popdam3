-- Issue #5064 (claim #5065; supersedes #5058, #5048): Master Data auto-flow lines take the FULL ColdLion
-- description. Owner direction (Albert Hazan, 2026-10-29, verbatim):
-- "MasterData is using the shorter Display Description for its description.
-- change the to full description". Re-derives the #4974 function with one
-- change: the description pre-fill prefers itemDesc (full) over itemDisplayDesc
-- (short display text); fallback order is otherwise unchanged. Signature,
-- security, grants and cron are unchanged.
--
-- Owner follow-up (2026-10-29, verbatim): "no one should be able to change the
-- description. that comes from coldlion, changing it here would give the user
-- the false impression that that's actually changing the item's description
-- everywhere." So every run (nightly and on import) also re-asserts the full
-- ColdLion description on EVERY ColdLion-linked line, overwriting local edits,
-- and this migration does it once now (~4.8k lines on production at authoring
-- time). The style tracker audit log does not cover description, so the first
-- overwritten local value is kept in row_data.pre_coldlion_description for
-- recovery. Lines whose ColdLion item has no description at all are left as
-- they are. These are system writes: the audit-fields trigger stamps
-- updated_at and sets updated_by to the caller (null for cron), exactly as the
-- existing nightly bridge refresh does. Unlinked lines are untouched. The
-- PopDAM page locks the column for linked lines.

-- Folded in (issue #5063, superseded PR #5062; owner 2026-10-29, verbatim:
-- "there is 1 generic division and 2 licensed divisions. check the division."
-- and "yes, all EH001 items should be in Generic"): new EH001 items are filed
-- in the Generic list (Generic.Style / generic, numbered after the Generic
-- max), and every existing Licensed row whose bridged item or auto-flow origin
-- is EH001 moves to Generic once (47 rows on production when rehearsed),
-- followed by a bridge refresh because the bridge snapshots tracker_type.

-- derived-from: 20261028183729

begin;

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
  v_next_generic_row_number integer;
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
           coalesce(nullif(i.raw ->> 'itemDesc', ''), nullif(i.raw ->> 'itemDisplayDesc', ''), nullif(i.description, '')) as desc_value,
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

  -- Owner direction 2026-10-29: EH001 is the one generic division; CW001 and SP001 are licensed.
  select coalesce(max(source_row_number), 2) + 1 into v_next_generic_row_number
  from public.style_tracker_rows
  where source_workbook_id = '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214'
    and source_sheet = 'Generic.Style';

  with deduped as (
    select distinct on (upper(btrim(coalesce(i.style_number, i.item_number))))
           i.id as plm_item_id,
           btrim(coalesce(i.style_number, i.item_number)) as sku_value,
           i.created_at,
           coalesce(nullif(i.raw ->> 'itemDesc', ''), nullif(i.raw ->> 'itemDisplayDesc', ''), nullif(i.description, '')) as desc_value,
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
           )) as row_data_value,
           coalesce((i.raw ->> 'divisionCode') = 'EH001', false) as is_generic
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
           discontinued_value, notes_value, row_data_value, is_generic
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
    case when c.is_generic then 'Generic.Style' else 'License.Style' end,
    case when c.is_generic then v_next_generic_row_number else v_next_row_number end
      + row_number() over (partition by c.is_generic order by c.created_at, c.plm_item_id) - 1,
    case when c.is_generic then 'generic' else 'licensed' end,
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

  -- #5058: a ColdLion-linked line's description is ColdLion's full description,
  -- never a local edit. Re-assert it every run so ColdLion changes flow in; the
  -- first overwritten local value is kept in row_data for recovery.
  update public.style_tracker_rows r
       set description = src.full_desc,
           row_data = case
             when r.description is null or r.row_data ? 'pre_coldlion_description' then r.row_data
             else coalesce(r.row_data, '{}'::jsonb) || jsonb_build_object('pre_coldlion_description', r.description)
           end
      from (
        select b.style_tracker_row_id,
               coalesce(nullif(i.raw ->> 'itemDesc', ''), nullif(i.raw ->> 'itemDisplayDesc', ''), nullif(i.description, '')) as full_desc
          from plm.style_tracker_item_bridge b
          join plm.item i on i.id = b.plm_item_id
         where i.source_system = 'coldlion'
      ) src
     where src.style_tracker_row_id = r.id
       and src.full_desc is not null
       and r.description is distinct from src.full_desc;

  eligible_count := v_eligible;
  deferred_count := v_deferred;
  return next;
end;
$fn$;

revoke all on function public.sync_new_items_into_style_tracker(boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_new_items_into_style_tracker(boolean, timestamptz) to service_role;

-- One-time correction (owner 2026-10-29: "all EH001 items should be in
-- Generic"): move every Licensed row whose bridged item, or auto-flow origin,
-- is division EH001. Idempotent: zero rows once corrected.
with wrong as (
  select r.id,
         row_number() over (order by r.source_row_number, r.id) as rn
  from public.style_tracker_rows r
  where r.tracker_type = 'licensed'
    and r.source_workbook_id = '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214'
    and r.source_sheet = 'License.Style'
    and (r.row_data ->> 'coldlion_division' = 'EH001'
         or exists (select 1
                      from plm.style_tracker_item_bridge b
                      join plm.item i on i.id = b.plm_item_id
                     where b.style_tracker_row_id = r.id
                       and i.raw ->> 'divisionCode' = 'EH001'))
), base as (
  select coalesce(max(source_row_number), 2) as n
  from public.style_tracker_rows
  where source_workbook_id = '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214'
    and source_sheet = 'Generic.Style'
)
update public.style_tracker_rows r
   set tracker_type = 'generic',
       source_sheet = 'Generic.Style',
       source_row_number = base.n + wrong.rn
  from wrong, base
 where r.id = wrong.id;

-- The bridge snapshots tracker_type; order linking reads it, so refresh now.
select plm.refresh_style_tracker_item_bridge();


-- One-time: bring every ColdLion-linked line to the full description now.
update public.style_tracker_rows r
   set description = src.full_desc,
       row_data = case
         when r.description is null or r.row_data ? 'pre_coldlion_description' then r.row_data
         else coalesce(r.row_data, '{}'::jsonb) || jsonb_build_object('pre_coldlion_description', r.description)
       end
  from (
    select b.style_tracker_row_id,
           coalesce(nullif(i.raw ->> 'itemDesc', ''), nullif(i.raw ->> 'itemDisplayDesc', ''), nullif(i.description, '')) as full_desc
      from plm.style_tracker_item_bridge b
      join plm.item i on i.id = b.plm_item_id
     where i.source_system = 'coldlion'
  ) src
 where src.style_tracker_row_id = r.id
   and src.full_desc is not null
   and r.description is distinct from src.full_desc;

do $verify$
declare
  v_fn record;
  v_job cron.job%rowtype;
  v_fnsrc text;
begin
  -- #5058: everything the parent (#4974) asserted, then this change's own checks.
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

  select * into v_job from cron.job where jobname = 'nightly-style-tracker-item-autoflow';
  if v_job.jobid is null or v_job.schedule is distinct from '50 5 * * *'
     or position('sync_new_items_into_style_tracker' in v_job.command) = 0 then
    raise exception '#4909: cron job nightly-style-tracker-item-autoflow is not registered as expected';
  end if;
  -- #5058: columns the re-assert reads and writes.
  if not exists (select 1 from pg_attribute where attrelid = 'plm.item'::regclass and attname = 'raw' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'plm.item'::regclass and attname = 'source_system' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'plm.item'::regclass and attname = 'description' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'plm.style_tracker_item_bridge'::regclass and attname = 'style_tracker_row_id' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.style_tracker_rows'::regclass and attname = 'row_data' and not attisdropped) then
    raise exception '#5058: a column the description re-assert depends on is missing';
  end if;
  if position($q$coalesce(nullif(i.raw ->> 'itemDesc', ''), nullif(i.raw ->> 'itemDisplayDesc', '')$q$ in v_fnsrc) = 0
     or position($q$coalesce(nullif(i.raw ->> 'itemDisplayDesc', ''), nullif(i.raw ->> 'itemDesc', '')$q$ in v_fnsrc) > 0 then
    raise exception '#5058: description pre-fill does not prefer itemDesc';
  end if;
  -- #5063 (folded in): generic-division routing.
  if position('Generic.Style' in v_fnsrc) = 0 or position('''EH001''' in v_fnsrc) = 0 then
    raise exception '#5063: division routing is absent from the function body';
  end if;
  if position('pre_coldlion_description' in v_fnsrc) = 0
     or position('set description = src.full_desc' in v_fnsrc) = 0 then
    raise exception '#5058: the function body lacks the ColdLion description re-assert';
  end if;
end
$verify$;

commit;
