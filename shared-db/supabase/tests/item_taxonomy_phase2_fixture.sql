-- Disposable-database fixture for Phase 2a+2b. Do not run against preview or
-- production. The task that authored it was explicitly static-only, so this is
-- checked in for the first sanctioned local/preview rehearsal after review.
begin;

do $$
declare
  lic_a uuid;
  lic_b uuid;
  lic_lapsed uuid;
  prop_a uuid;
  prop_fr uuid;
  prop_lapsed uuid;
  run_result record;
begin
  insert into core.licensor(name,code) values ('Fixture Licensor A','T2LA') returning id into lic_a;
  insert into core.licensor(name,code) values ('Fixture Licensor B','T2LB') returning id into lic_b;
  insert into core.licensor(name,code,status) values ('Fixture Lapsed Licensor','T2LAP','inactive') returning id into lic_lapsed;
  insert into core.property(licensor_id,name,code) values (lic_a,'Fixture Property A','T2PA') returning id into prop_a;
  insert into core.property(licensor_id,name,code,status) values (lic_lapsed,'Fixture Lapsed Property','T2LAPP','inactive') returning id into prop_lapsed;
  insert into core.property(licensor_id,name,code) values (lic_a,'Fixture Ambiguous A','T2AMB');
  insert into core.property(licensor_id,name,code) values (lic_b,'Fixture Ambiguous B','T2AMB');
  -- FR-style cross-type collision: the same short code is a licensor and a
  -- property, but property lookup is constrained by its parent licensor.
  insert into core.licensor(name,code) values ('Fixture FR Licensor','T2FR');
  insert into core.property(licensor_id,name,code) values (lic_a,'Fixture FR Property','T2FR') returning id into prop_fr;

  perform * from plm.import_merch_group_headers('[
    {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor"},
    {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property"},
    {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor"},
    {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property"},
    {"companyCode":"EDGEHOME","divisionCode":"EH001","mgTypeCode":"05","mgTypeDesc":"Big Theme"},
    {"companyCode":"EDGEHOME","divisionCode":"EH001","mgTypeCode":"06","mgTypeDesc":"Little Theme"},
    {"companyCode":"EDGEHOME","divisionCode":"EP001","mgTypeCode":"05","mgTypeDesc":"Product Line"},
    {"companyCode":"EDGEHOME","divisionCode":"EP001","mgTypeCode":"06","mgTypeDesc":"Product Type"}
  ]'::jsonb);

  select * into run_result from plm.import_item_master_data(jsonb_build_object(
    'sweepId',gen_random_uuid(),'terminalReached',true,'minimumSilverRatio',0.8,'items',jsonb_build_array(
      jsonb_build_object('companyCode','EDGEHOME','divisionCode','CW001','itemNo','MARVEL','merchGroup05','T2LA','merchGroup06','T2PA'),
      jsonb_build_object('companyCode','EDGEHOME','divisionCode','CW001','itemNo','DISAGREE','merchGroup05','T2LB','merchGroup06','T2PA'),
      jsonb_build_object('companyCode','EDGEHOME','divisionCode','CW001','itemNo','LAPSED','merchGroup05','T2LAP','merchGroup06','T2LAPP'),
      jsonb_build_object('companyCode','EDGEHOME','divisionCode','SP001','itemNo','FR-STYLE','merchGroup05','T2LA','merchGroup06','T2FR'),
      jsonb_build_object('companyCode','EDGEHOME','divisionCode','CW001','itemNo','AMB','merchGroup05','UNKNOWN','merchGroup06','T2AMB'),
      jsonb_build_object('companyCode','EDGEHOME','divisionCode','EH001','itemNo','NONLIC','merchGroup05','THEME','merchGroup06','LITTLE'),
      jsonb_build_object('companyCode','EDGEHOME','divisionCode','EP001','itemNo','EDGE','merchGroup05','LINE','merchGroup06','TYPE'),
      jsonb_build_object('companyCode','EDGEHOME','divisionCode','CW001','itemNo','RERUN','merchGroup05','T2LA','merchGroup06','MISSING')
    )));

  if (select resolution_outcome from plm.item_import where item_no='MARVEL') <> 'resolved' then raise exception 'known licensed item did not resolve'; end if;
  if (select licensor_id from plm.item where source_id='EDGEHOME|CW001|DISAGREE') is distinct from lic_a then raise exception 'property parent did not win disagreement'; end if;
  if not exists(select 1 from plm.item_taxonomy_disagreement where item_no='DISAGREE') then raise exception 'licensor/property disagreement was silently dropped'; end if;
  if (select status from core.licensor where id=lic_lapsed) <> 'inactive' or (select status from core.property where id=prop_lapsed) <> 'inactive' then raise exception 'resolver changed lapsed taxonomy status'; end if;
  if (select property_id from plm.item where source_id='EDGEHOME|SP001|FR-STYLE') is distinct from prop_fr then raise exception 'FR-style cross-type code resolved incorrectly'; end if;
  if (select resolution_outcome from plm.item_import where item_no='AMB') <> 'ambiguous' then raise exception 'ambiguous property was not quarantined'; end if;
  if exists(select 1 from plm.item where source_id='EDGEHOME|EH001|NONLIC' and (licensor_id is not null or property_id is not null)) then raise exception 'EH001 was treated as licensed taxonomy'; end if;
  if (select resolution_outcome from plm.item_import where item_no='EDGE') <> 'unresolved' then raise exception 'EP001 unexpectedly resolved'; end if;
  if not exists(select 1 from plm.item_import_unresolved where item_no='RERUN' and slot_code='06') then raise exception 'missing property did not enter quarantine'; end if;

  insert into core.property(licensor_id,name,code) values (lic_a,'Fixture Later Property','MISSING');
  perform * from plm.import_item_master_data(jsonb_build_object(
    'sweepId',gen_random_uuid(),'terminalReached',true,'minimumSilverRatio',0.1,'items',jsonb_build_array(
      jsonb_build_object('companyCode','EDGEHOME','divisionCode','CW001','itemNo','RERUN','merchGroup05','T2LA','merchGroup06','MISSING'),
      jsonb_build_object('companyCode','EDGEHOME','divisionCode','SP001','itemNo','FR-STYLE','merchGroup05','T2LA','merchGroup06','T2FR'),
      jsonb_build_object('companyCode','EDGEHOME','divisionCode','EH001','itemNo','NONLIC','merchGroup05','THEME','merchGroup06','LITTLE'),
      jsonb_build_object('companyCode','EDGEHOME','divisionCode','EP001','itemNo','EDGE','merchGroup05','LINE','merchGroup06','TYPE')
    )));
  if exists(select 1 from plm.item_import_unresolved where item_no='RERUN' and slot_code='06') then raise exception 'resolved rerun did not clear quarantine'; end if;
end $$;

rollback;
