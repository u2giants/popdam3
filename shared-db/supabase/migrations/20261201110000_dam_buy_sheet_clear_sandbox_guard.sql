-- #6520: public.clear_dam_buy_sheet_import becomes sandbox-only.
-- Owner correction (Albert, 2026-11-16): the "Clear my last HFC upload" tool
-- (popdam3 Burlington menu, PR #1031) must exist only on
-- https://dam-sandbox.designflow.app, never on live production.
-- The frontend half is u2giants/popdam3#1033 (item hidden on production
-- builds via IS_NON_PRODUCTION_DATABASE). This is the database half: the
-- function refuses unless public.admin_config key SANDBOX_ENABLED_TOOLS
-- (jsonb array) lists 'clear_dam_buy_sheet_import'. Deny-by-default:
-- production never carries that row, so every call refuses there with
-- 42501. The row is a PopDAM-session data write on the preview/sandbox
-- database only (AGENTS.md §4.2 target proof), which keeps the sandbox
-- working. No grant or ACL change (baseline restated below, unchanged).
-- Body otherwise identical to the live 20261119120000 definition.
-- Rollback: recreate from 20261119120000 and drop the admin_config row.
-- derived-from: 20261119120000

begin;

create or replace function public.clear_dam_buy_sheet_import(
  p_import_id uuid default null,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = plm, public, core, dam, pg_temp
as $$
declare
  v_actor    uuid := auth.uid();
  v_imp      dam.order_buy_sheet_import%rowtype;
  v_created  uuid[];
  v_updated  jsonb;
  v_orders   uuid[];
  v_empty    uuid[];
  v_r        jsonb;
begin
  if v_actor is null then
    raise exception 'clear_dam_buy_sheet_import: authentication required' using errcode = '42501';
  end if;
  -- #6520 sandbox-only guard: refuses everywhere the enable row is absent
  -- (production); the preview/sandbox database carries it as data.
  if not exists (
    select 1 from public.admin_config
     where key = 'SANDBOX_ENABLED_TOOLS'
       and value @> '["clear_dam_buy_sheet_import"]'::jsonb
  ) then
    raise exception 'clear_dam_buy_sheet_import: sandbox-only tool, not enabled on this database (admin_config.SANDBOX_ENABLED_TOOLS)'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_dam_buy_sheet'));
  if p_import_id is null then
    select * into v_imp from dam.order_buy_sheet_import
     where imported_by = v_actor order by imported_at desc, id desc limit 1;
  else
    select * into v_imp from dam.order_buy_sheet_import where id = p_import_id;
  end if;
  if v_imp.id is null then
    raise exception 'clear_dam_buy_sheet_import: no buy-sheet import to clear' using errcode = 'P0002';
  end if;
  if v_imp.imported_by is distinct from v_actor then
    raise exception 'clear_dam_buy_sheet_import: only the person who uploaded this buy sheet can clear it' using errcode = '42501';
  end if;

  -- Lines this import created: still carrying its own popdam_buy_sheet ref.
  select coalesce(array_agg(distinct l.id), '{}') into v_created
    from jsonb_array_elements(v_imp.result) r
    join plm.production_order_line l on l.id = (r ->> 'line_id')::uuid
   where r ->> 'outcome' = 'new' and l.source_system = 'popdam_buy_sheet'
     and exists (select 1 from plm.production_order_line_source_ref s
                  where s.production_order_line_id = l.id and s.source_system = 'popdam_buy_sheet'
                    and s.source_id = coalesce(r ->> 'source_ref', l.source_id));
  -- Lines this import updated, with what to restore.
  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_updated
    from jsonb_array_elements(v_imp.result) r
   where r ->> 'outcome' = 'updated' and r ->> 'line_id' is not null
     and exists (select 1 from plm.production_order_line l where l.id = (r ->> 'line_id')::uuid);
  select coalesce(array_agg(distinct production_order_id), '{}') into v_orders
    from plm.production_order_line where id = any (v_created);
  -- Orders the import created that would be left with no lines.
  select coalesce(array_agg(o.id), '{}') into v_empty
    from plm.production_order o
   where o.id = any (v_orders) and o.source_system = 'popdam_buy_sheet'
     and o.metadata ->> 'created_via' = 'popdam_buy_sheet'
     and not exists (select 1 from plm.production_order_line l
                      where l.production_order_id = o.id and not (l.id = any (v_created)));

  if exists (select 1 from plm.production_order_line_source_ref s
              where s.source_system = 'coldlion'
                and (s.production_order_line_id = any (v_created)
                     or s.production_order_line_id in (select (u ->> 'line_id')::uuid from jsonb_array_elements(v_updated) u))) then
    raise exception 'clear_dam_buy_sheet_import: a line from this buy sheet is now linked to ColdLion; nothing was cleared' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(v_imp.result) r
               join plm.production_order_line l on l.id = (r ->> 'line_id')::uuid
               join plm.production_order o on o.id = l.production_order_id
              where l.id = any (v_created) and nullif(btrim(coalesce(r ->> 'order_number', '')), '') is null
                and btrim(o.production_order_number) <> '') then
    raise exception 'clear_dam_buy_sheet_import: a real PO number has since been put on an order from this buy sheet; nothing was cleared' using errcode = 'P0001';
  end if;

  if p_apply then
    delete from plm.production_order_line_source_ref where production_order_line_id = any (v_created);
    delete from dam.production_order_snapshot where production_order_line_id = any (v_created);
    delete from plm.production_order_line where id = any (v_created);
    for v_r in select * from jsonb_array_elements(v_updated)
    loop
      update plm.production_order_line
         set quantity_ordered = (v_r ->> 'previous_quantity')::numeric,
             metadata = coalesce(metadata, '{}'::jsonb) - 'buy_sheet',
             assortment_id = case when coalesce((v_r ->> 'assortment_set')::boolean, false)
                                  then v_r ->> 'previous_assortment_id' else assortment_id end,
             case_pack = case when v_r ? 'previous_case_pack' then (v_r ->> 'previous_case_pack')::numeric else case_pack end,
             item_id = case when v_r ? 'previous_item_id' then (v_r ->> 'previous_item_id')::uuid else item_id end,
             master_data_match_status = case when v_r ? 'previous_match_status'
                                             then v_r ->> 'previous_match_status' else master_data_match_status end,
             updated_at = now()
       where id = (v_r ->> 'line_id')::uuid;
      delete from plm.production_order_line_source_ref
       where production_order_line_id = (v_r ->> 'line_id')::uuid and source_system = 'popdam_buy_sheet'
         and (v_r ->> 'source_ref' is null or source_id = v_r ->> 'source_ref');
    end loop;
    delete from plm.production_order_source_ref where production_order_id = any (v_empty);
    delete from dam.order_tracking_ext where order_id = any (v_empty);
    delete from plm.production_order where id = any (v_empty);
    delete from dam.order_buy_sheet_import where id = v_imp.id;
  end if;

  return jsonb_build_object(
    'applied', p_apply, 'import_id', v_imp.id, 'file_name', v_imp.file_name,
    'imported_at', v_imp.imported_at,
    'lines_to_delete', cardinality(v_created),
    'lines_to_restore', jsonb_array_length(v_updated),
    'orders_to_delete', cardinality(v_empty));
end;
$$;

comment on function public.clear_dam_buy_sheet_import(uuid, boolean) is
  'PopDAM buy-sheet Clear (shared-db#6476): the uploader undoes one import (default: their latest). p_apply=false previews counts; true deletes the lines it created and the then-empty orders it created, restores quantity/assortment/metadata on lines it updated, and deletes the import record. Refused when a line is now ColdLion-linked or a created order has since received a PO number. Sandbox-only (#6520, owner correction 2026-11-16): refuses unless admin_config.SANDBOX_ENABLED_TOOLS lists clear_dam_buy_sheet_import; production never carries that row.';

-- Baseline ACL unchanged (restated): client roles keep EXECUTE only via
-- authenticated; the #6520 guard is the production control, not the ACL.
revoke all on function public.clear_dam_buy_sheet_import(uuid, boolean) from public, anon;
grant execute on function public.clear_dam_buy_sheet_import(uuid, boolean) to authenticated, service_role;

commit;
