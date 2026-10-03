-- #3910: plm.import_item_master_data writes only changed rows, and a sweep that no
-- longer returns out-of-scope division EP001 promotes (retiring EP001) instead of
-- failing. Run inside begin; ... rollback; by database-contract-tests. ZZT values only.
do $$
declare
  v_run uuid;
  v_items jsonb := jsonb_build_array(
    jsonb_build_object('companyCode','EDGEHOME','divisionCode','CW001','itemNo','ZZT-A','itemDesc','Alpha'),
    jsonb_build_object('companyCode','EDGEHOME','divisionCode','CW001','itemNo','ZZT-B','itemDesc','Beta'),
    jsonb_build_object('companyCode','EDGEHOME','divisionCode','EP001','itemNo','ZZT-E','itemDesc','Edge'));
begin
  perform * from plm.import_item_master_data(jsonb_build_object(
    'sweepId',gen_random_uuid(),'terminalReached',true,'minimumSilverRatio',0.1,'items',v_items));
  if (select count(*) from plm.item where source_id like 'EDGEHOME|%|ZZT-%') <> 3 then
    raise exception 'T1: first sweep did not land 3 items';
  end if;

  -- Backdate, then repeat the identical sweep: unchanged rows must keep updated_at.
  -- (set_updated_at would overwrite a plain backdate, so bypass it for this one write)
  alter table plm.item disable trigger set_updated_at;
  update plm.item set updated_at = '2001-01-01' where source_id like 'EDGEHOME|%|ZZT-%';
  alter table plm.item enable trigger set_updated_at;
  alter table plm.item_import disable trigger user;
  update plm.item_import set updated_at = '2001-01-01', imported_at = '2001-01-01' where item_no like 'ZZT-%';
  alter table plm.item_import enable trigger user;
  update ingest.raw_record set imported_at = '2001-01-01' where source_table = 'items' and source_id like 'EDGEHOME|%|ZZT-%';
  perform * from plm.import_item_master_data(jsonb_build_object(
    'sweepId',gen_random_uuid(),'terminalReached',true,'minimumSilverRatio',0.1,'items',v_items));
  if exists (select 1 from plm.item where source_id like 'EDGEHOME|%|ZZT-%' and updated_at <> '2001-01-01') then
    raise exception 'T2: an unchanged sweep bumped plm.item.updated_at';
  end if;
  if exists (select 1 from ingest.raw_record where source_table = 'items' and source_id like 'EDGEHOME|%|ZZT-%' and imported_at <> '2001-01-01') then
    raise exception 'T2c: an unchanged sweep rewrote ingest.raw_record';
  end if;
  if exists (select 1 from plm.item_import where item_no like 'ZZT-%' and (updated_at <> '2001-01-01' or imported_at <> '2001-01-01')) then
    raise exception 'T2b: an unchanged sweep rewrote plm.item_import';
  end if;

  -- A real change still updates that one row.
  perform * from plm.import_item_master_data(jsonb_build_object(
    'sweepId',gen_random_uuid(),'terminalReached',true,'minimumSilverRatio',0.1,'items',jsonb_set(v_items,'{0,itemDesc}','"Alpha 2"')));
  if (select count(*) from plm.item where source_id like 'EDGEHOME|%|ZZT-%' and updated_at <> '2001-01-01') <> 1 then
    raise exception 'T3: a changed item was not the only row updated';
  end if;

  -- T6: a reviewed disagreement decision survives a sweep where it did not change.
  declare v_lb text; v_pa text; v_dis jsonb;
  begin
    -- Uses existing canonical Licensing rows (canonical writes need a transaction-bound
    -- authorization): any coded property, plus a different coded licensor.
    select p.code into v_pa from core.property p join core.licensor l on l.id = p.licensor_id
     where p.code is not null and l.code is not null
       and (select count(*) from core.property p2 where p2.code = p.code) = 1
     order by p.code limit 1;
    select l2.code into v_lb from core.licensor l2
     where l2.code is not null and (select count(*) from core.licensor l3 where l3.code = l2.code) = 1
       and l2.id <> (select licensor_id from core.property where code = v_pa)
     order by l2.code limit 1;
    if v_pa is null or v_lb is null then raise exception 'T6 setup: no coded licensing rows in this database'; end if;
    perform * from plm.import_merch_group_headers('[
      {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor"},
      {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property"}]'::jsonb);
    v_dis := v_items || jsonb_build_array(jsonb_build_object('companyCode','EDGEHOME','divisionCode','CW001',
      'itemNo','ZZT-D','merchGroup05',v_lb,'merchGroup06',v_pa));
    perform * from plm.import_item_master_data(jsonb_build_object(
      'sweepId',gen_random_uuid(),'terminalReached',true,'minimumSilverRatio',0.1,'items',v_dis));
    if not exists (select 1 from plm.item_taxonomy_disagreement where item_no = 'ZZT-D') then
      raise exception 'T6 setup: fixture disagreement was not detected';
    end if;
    update plm.item_taxonomy_disagreement set status = 'reviewed' where item_no = 'ZZT-D';
    perform * from plm.import_item_master_data(jsonb_build_object(
      'sweepId',gen_random_uuid(),'terminalReached',true,'minimumSilverRatio',0.1,'items',v_dis));
    if (select status from plm.item_taxonomy_disagreement where item_no = 'ZZT-D') <> 'reviewed' then
      raise exception 'T6: an unchanged disagreement was re-opened';
    end if;
    v_items := v_dis;
  end;

  -- T7: retiring EP001 is refused while it holds a reviewed disagreement decision.
  insert into plm.item_taxonomy_disagreement(company_code,division_code,item_no,property_id,status,reason)
  select 'EDGEHOME','EP001','ZZT-E', property_id, 'reviewed', 'zzt fixture' from plm.item_taxonomy_disagreement where item_no = 'ZZT-D';
  begin
    perform * from plm.import_item_master_data(jsonb_build_object(
      'sweepId',gen_random_uuid(),'terminalReached',true,'minimumSilverRatio',0.1,
      'items',jsonb_build_array(v_items->0, v_items->1, v_items->3)));
    raise exception 'T7: EP001 retirement discarded a reviewed decision';
  exception when raise_exception then
    if sqlerrm not like '%reviewed disagreement decisions%' then raise; end if;
  end;
  delete from plm.item_taxonomy_disagreement where item_no = 'ZZT-E';

  -- EP001 disappears from the sweep: promotes and retires it from silver.
  select r.sync_run_id into v_run from plm.import_item_master_data(jsonb_build_object(
    'sweepId',gen_random_uuid(),'terminalReached',true,'minimumSilverRatio',0.1,
    'items',jsonb_build_array(v_items->0, v_items->1, v_items->3))) r;
  if exists (select 1 from plm.item_import where division_code = 'EP001' and item_no = 'ZZT-E') then
    raise exception 'T4: EP001 was not retired from silver';
  end if;
  if not exists (select 1 from plm.item where source_id = 'EDGEHOME|EP001|ZZT-E') then
    raise exception 'T4b: the durable Item Master row for a retired EP001 item was deleted';
  end if;
  if not ((select metadata->'retired_divisions' from ingest.sync_run where id = v_run) ? 'EDGEHOME|EP001') then
    raise exception 'T4c: retirement was not recorded in sync_run metadata';
  end if;

  -- Any other missing division still refuses.
  begin
    perform * from plm.import_item_master_data(jsonb_build_object(
      'sweepId',gen_random_uuid(),'terminalReached',true,'minimumSilverRatio',0.1,
      'items',jsonb_build_array(jsonb_build_object('companyCode','EDGEHOME','divisionCode','SP001','itemNo','ZZT-S'))));
    raise exception 'T5: a sweep omitting CW001 was accepted';
  exception when raise_exception then
    if sqlerrm not like '%omitted a division%' then raise; end if;
  end;
end;
$$;
