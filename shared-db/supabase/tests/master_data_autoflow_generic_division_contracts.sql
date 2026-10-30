-- Master Data auto-flow division routing (owner 2026-10-29): EH001 items land
-- in the Generic list with Generic numbering; other divisions stay Licensed.
-- LOCAL THROWAWAY DATABASE ONLY; never execute against production. Rolled back.
begin;

do $test$
declare
  v_new timestamptz := greatest(now(), '2026-10-28T00:00:00Z'::timestamptz) + interval '1 day';
  v_land timestamptz := v_new + interval '1 day';
  v_masters_run uuid := gen_random_uuid();
  v_generic_max integer;
  v_row record;
begin
  insert into coldlion.sync_run (id, endpoint, company_code, division_code, requested_by)
  values (v_masters_run, '/itemDetails', 'ZZ', null, 'coldlion-landing sync-masters');
  update coldlion.sync_run set status = 'succeeded', started_at = v_land, finished_at = v_land, rows_fetched = 0
   where id = v_masters_run;

  select coalesce(max(source_row_number), 2) into v_generic_max
    from public.style_tracker_rows
   where source_workbook_id = '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214'
     and source_sheet = 'Generic.Style';

  insert into plm.item (item_number, source_system, source_id, raw, created_at)
  values ('ZZDIVGEN-EH', 'zztestdiv', 'eh', jsonb_build_object('companyCode','ZZ','divisionCode','EH001'), v_new),
         ('ZZDIVGEN-CW', 'zztestdiv', 'cw', jsonb_build_object('companyCode','ZZ','divisionCode','CW001'), v_new),
         ('ZZDIVGEN-NULL', 'zztestdiv', 'nl', '{}', v_new);

  perform public.sync_new_items_into_style_tracker(p_dry_run => false);

  select tracker_type, source_sheet, source_row_number into v_row
    from public.style_tracker_rows where sku = 'ZZDIVGEN-EH';
  if v_row.tracker_type is distinct from 'generic' or v_row.source_sheet is distinct from 'Generic.Style'
     or v_row.source_row_number is distinct from v_generic_max + 1 then
    raise exception 'EH001 item must land in Generic.Style at the next generic row: %', v_row;
  end if;

  select tracker_type, source_sheet into v_row from public.style_tracker_rows where sku = 'ZZDIVGEN-CW';
  if v_row.tracker_type is distinct from 'licensed' or v_row.source_sheet is distinct from 'License.Style' then
    raise exception 'CW001 item must stay Licensed: %', v_row;
  end if;

  select tracker_type into v_row from public.style_tracker_rows where sku = 'ZZDIVGEN-NULL';
  if v_row.tracker_type is distinct from 'licensed' then
    raise exception 'an item without a division must default to Licensed: %', v_row;
  end if;

  if not exists (select 1 from plm.style_tracker_item_bridge b
                  join public.style_tracker_rows r on r.id = b.style_tracker_row_id
                 where r.sku = 'ZZDIVGEN-EH' and b.tracker_type = 'generic') then
    raise exception 'the bridge must carry generic for the EH001 row';
  end if;
end
$test$;

rollback;
