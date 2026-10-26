-- Issue popcre/shared-db#2599 (with #2541): Viacom Multi (VM) canonical Properties from the
-- Paramount TrackerPlus submission scrape, plus the licensing team's reviewed ColdLion MG06
-- code mapping onto them.
--
-- Owner rulings, Albert Hazan:
--   2026-09-06: Paramount, Viacom and Nickelodeon are one Licensor, VM / VIACOM MULTI.
--   2026-10-26 (verbatim): "properties scraped from the submissions sites are 100% canonical."
--   (docs/owner-rulings.md 6.31; docs/business-rules/licensing-master-data.md.)
--
-- NO LICENSED VALUES ARE IN THIS FILE. Property names are read inside the database from the
-- guarded TrackerPlus capture keyed paramount-trackerplus-2026-10-25-4bb087a7bb2514a0 (production
-- id 36fb2b6d-a728-4bf4-bb4c-d04b03125a2b; 40 rows, manifest 263eccc7...). Rows are keyed by property_local_key = sha256(exact label). The code mapping
-- below is (ColdLion MG06 code, property_local_key) from the private 2026-10-15 workbook
-- (u2giants/licensor-source-data, sha256 32917567...); 37 reviewed VM selections.
--
-- Per submission Property, the canonical row is, in order:
--   1. the one VM core.property whose name equals the label ignoring case (all 8 such rows
--      agree with the reviewed code mapping); renamed to the exact label if the case differs;
--   2. else the one existing VM core.property whose code the reviewed mapping assigns to it
--      (one-to-one only); renamed to the exact submission label, prior name kept in metadata;
--   3. else a new code-less 'potential' row with the exact label.
-- Several codes mapping to one label (many-to-one) never merge existing rows: those coded rows
-- stay as they are and the label gets its own canonical row. Each canonical row gets one
-- core.taxonomy_source_ref keyed on the TrackerPlus identity; each reviewed code gets one
-- mapping ref. Nothing is deleted; status of existing rows is unchanged. Idempotent.

do $vm_submission_canonical$
declare
  v_vm constant uuid := '5f951f5e-aaee-4add-bb51-fea888951405';
  v_capture_key constant text := 'paramount-trackerplus-2026-10-25-4bb087a7bb2514a0';
  v_capture uuid;
  v_manifest constant text := '263eccc71645bf9c63e658d8521cba1706f965dd256f47360b6cb63db1c97b6b';
  v_workbook constant text := '32917567f1f57c78346922361faf0792e4a1fc3142c1bb82747141f4278ee724';
  v_actor constant text := 'shared-db migration 20261026150931';
  v_map constant text[][] := array[
    array['90','d77c37fd1c1d426a1dc3b24ec73faba375bebb856e911963ca46e665b140b4d6'],
    array['AM1','efe401285997afdcc59ae945b1581da3ba72299448eeeb293bc327975aa64c8a'],
    array['AM2','75f1ce3fc920d016c2b6f35187096ff1adbc1a6f9020a30d65a62016e99137e4'],
    array['AT','bd03eb784c85de3be8d7179166656d6ef01452f3965852af2cd457ba6a1aae24'],
    array['BB','4f7cecae689ed321865bcbca217cb1d3671628780bd17b9499760230341e5e46'],
    array['BH','bd94353f3769002c7f71d65736160fc363de6d86b4660849d2035b3ed38270a3'],
    array['CU','fde22786c4e5e5358901028b53133622758a06f22e1e0354631dfc42440815be'],
    array['DN','b0e25444e346e2a0d69c32cf74bd9745f8848fc29164a87bf7dda03fb58b7147'],
    array['EN','b0e25444e346e2a0d69c32cf74bd9745f8848fc29164a87bf7dda03fb58b7147'],
    array['EP','2ba82e8fe6da526d195cf411c3c1d1f6ab03feb293b312571e6b4b4113f892bb'],
    array['FB','db96ab45578f557826803ab1958f66208a514cd85f0cae30e68f966a3ca9f2ef'],
    array['FE','6ae08a70bc7eacef76689c0732d631a9bbca37a690640f674b8d99ec51ec94af'],
    array['FG','f7d2485466399e902ddadecc23fb123fc3850bb635d58f6efd4ba068dd41bc02'],
    array['GE','53a9e30a298862ec5ca6203d0bb00a9eb1941de66049798ec2fd3736cf2b629c'],
    array['GE1','7eb07dab6bae24395858f445f9d02ce0d789167f9e57cc3e57dac3dbdd22d873'],
    array['GH','5810d66ac44b8f2380962269fdc1829466753186aa086fec7482e012396babb9'],
    array['GRE','d9607a5345f7bc7e70b94aa837ef7a0966bec2a57d2f92ef41e2d3478bac87f3'],
    array['HDS','0ac2efd260724f5aac4bf0bd3a78564d721191478a20145bddcc451db97c367f'],
    array['MA','b0e25444e346e2a0d69c32cf74bd9745f8848fc29164a87bf7dda03fb58b7147'],
    array['MG1','c668c436a414113ffbb2df349ce0f27a21bb931ad83fd8c4a3e251b49f9850f4'],
    array['MG2','f984a50a4a0993225fcc59512d8ff9a179fb4ea2b416c2b256e2492559921e84'],
    array['MGM','b16f62f4728e0ef7aecc6db4686bac8e1e7c815d8610703ef5216d4182309694'],
    array['NT','b0e25444e346e2a0d69c32cf74bd9745f8848fc29164a87bf7dda03fb58b7147'],
    array['RA','b0e25444e346e2a0d69c32cf74bd9745f8848fc29164a87bf7dda03fb58b7147'],
    array['SB','bb6d2425b630031d0904b2a9b76e344aa1f101c0b7d6c1085f92818deabe5eb2'],
    array['SCM','0072bff034316806df9812e10594ffdf4b632c963af3f42357fdbb9801aebc45'],
    array['SM1','0072bff034316806df9812e10594ffdf4b632c963af3f42357fdbb9801aebc45'],
    array['SM6','1abf201aa851cb819c3a5965f721229f91d7473c39fc561b975ca6c7905eec75'],
    array['SM7','88f663890fa7325dfd47ca40385b209d44082ef2feb414c96f312161e8a2a577'],
    array['TNT','e78009d31a69904d8b34dffffe303a1f61a86d365f27440354e57b8121fbeb32'],
    array['TU','5dbe1eb9778bad2f0c9bb0632e07292287d9e4d0e51047f0fb961154f5070900'],
    array['TZ1','78bfa4a8d018abaffa4846ad5c3077e877d56172a26d730299c8b4d035833f73'],
    array['TZ2','b7a9af80772100eb17c0f3017675d3459d3a4d0ac43d56720f46b9e969e997ea'],
    array['TZ3','c0b5473ac392ea78d127e834bc378e574cf43db535b86cd0720639850752b180'],
    array['WND','90b05904cfb9749a36d25ac6393b3774957a52e97c593453e269424ebfd2684d'],
    array['YS','314a356c641835f1c9a19554d3c0b6178dd026c853d7881283b76bacdd33fa4c'],
    array['ZM','5744915091dbd41a9ea5f61b01dc5d8a1d775c0a44c79d13d3145b571447dd5a']
  ];
  v_pair text[];
  r record; v_id uuid; v_name text; v_n integer; v_codes text[]; v_rows integer;
begin
  perform 1 from core.licensor where id=v_vm and code='VM' and name='VIACOM MULTI';
  if not found then raise exception '#2599: core.licensor VM/VIACOM MULTI % not found; re-check target database', v_vm; end if;
  select id into v_capture from plm.pmt_trackerplus_submission_capture
   where capture_key=v_capture_key and status='complete' and expected_property_manifest_sha256=v_manifest;
  if v_capture is null then raise exception '#2599: TrackerPlus capture % is not complete here', v_capture_key; end if;
  select count(*) into v_n from plm.pmt_trackerplus_submission_property where capture_id=v_capture;
  if v_n<>40 or (select encode(extensions.digest(string_agg(property_local_key,E'\n' order by property_local_key),'sha256'),'hex')
      from plm.pmt_trackerplus_submission_property where capture_id=v_capture)<>v_manifest then
    raise exception '#2599: TrackerPlus capture % does not hold the expected 40-row manifest', v_capture;
  end if;

  foreach v_pair slice 1 in array v_map loop
    if not exists(select 1 from plm.pmt_trackerplus_submission_property p where p.capture_id=v_capture and p.property_local_key=v_pair[2]) then
      raise exception '#2599: reviewed code % maps to a key outside the capture', v_pair[1];
    end if;
  end loop;

  for r in select property_local_key k, exact_label l from plm.pmt_trackerplus_submission_property where capture_id=v_capture order by property_local_key loop
    v_id:=null;
    select entity_id into v_id from core.taxonomy_source_ref
     where source_system='paramount_trackerplus' and source_table='plm.pmt_trackerplus_submission_property' and source_id=r.k;
    if v_id is null then
      select count(*),min(id::text)::uuid into v_n,v_id from core.property where licensor_id=v_vm and lower(name)=lower(r.l);
      if v_n>1 then raise exception '#2599: % VM rows share one submission label ignoring case (key %)', v_n, r.k; end if;
      if v_n=0 then
        v_codes:='{}';
        foreach v_pair slice 1 in array v_map loop
          if v_pair[2]=r.k then v_codes:=v_codes||v_pair[1]; end if;
        end loop;
        select count(*),min(p.id::text)::uuid into v_n,v_id from core.property p where p.licensor_id=v_vm and p.code = any(coalesce(v_codes,'{}'))
          and not exists(select 1 from core.taxonomy_source_ref x where x.source_system='paramount_trackerplus' and x.entity_id=p.id)
          and not exists(select 1 from plm.pmt_trackerplus_submission_property s where s.capture_id=v_capture and lower(s.exact_label)=lower(p.name) and s.property_local_key<>r.k);
        if v_n<>1 then v_id:=null; end if;
      end if;
      if v_id is null then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values(pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),
          encode(extensions.digest('2599/create/'||r.k,'sha256'),'hex'),v_actor,array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute');
        insert into core.property(licensor_id,name,code,status,metadata)
        values(v_vm,r.l,null,'potential',jsonb_build_object('curated',true,'import_owned',false,'authorising_issue',2599,
          'owner_instruction_date','2026-10-26','migration','20261026150931','curated_source',
          jsonb_build_object('source_system','paramount_trackerplus','capture_id',v_capture,'property_local_key',r.k)))
        returning id into v_id;
      else
        select name into v_name from core.property where id=v_id;
        if v_name is distinct from r.l then
          insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
          values(pg_backend_pid(),txid_current(),'core.property','scrape_consolidation',gen_random_uuid(),
            encode(extensions.digest('2599/rename/'||v_id::text,'sha256'),'hex'),v_actor,array['name'],clock_timestamp()+interval '1 minute');
          update core.property set name=r.l,
            metadata=coalesce(metadata,'{}')||jsonb_build_object('submission_canonical',jsonb_build_object('authorising_issue',2599,
              'migration','20261026150931','previous_name',v_name,'property_local_key',r.k))
          where id=v_id;
          get diagnostics v_rows=row_count;
          if v_rows<>1 then raise exception '#2599: rename changed % rows', v_rows; end if;
        end if;
      end if;
      insert into core.taxonomy_source_ref(entity_schema,entity_table,entity_id,source_system,source_table,source_id,source_code,source_name,confidence,raw)
      values('core','property',v_id,'paramount_trackerplus','plm.pmt_trackerplus_submission_property',r.k,null,r.l,'verified',
        jsonb_build_object('authorising_issue',2599,'capture_id',v_capture,'identity_method','exact_label_sha256','owner_ruling','2026-10-26'));
    end if;
  end loop;

  foreach v_pair slice 1 in array v_map loop
    insert into core.taxonomy_source_ref(entity_schema,entity_table,entity_id,source_system,source_table,source_id,source_code,source_name,confidence,raw)
    select 'core','property',t.entity_id,'licensing_mg06_submission_mapping','mg06-to-submissions-mapping-20261015','VM/'||v_pair[1],v_pair[1],null,'verified',
      jsonb_build_object('authorising_issue',2599,'related_issue',2541,'workbook_sha256',v_workbook,'property_local_key',v_pair[2])
    from core.taxonomy_source_ref t
    where t.source_system='paramount_trackerplus' and t.source_table='plm.pmt_trackerplus_submission_property' and t.source_id=v_pair[2]
    on conflict (source_system,source_table,source_id) do nothing;
  end loop;

  select count(*) into v_n from core.taxonomy_source_ref t join core.property p on p.id=t.entity_id and p.licensor_id=v_vm
   where t.source_system='paramount_trackerplus' and t.source_table='plm.pmt_trackerplus_submission_property'
     and t.source_id in (select property_local_key from plm.pmt_trackerplus_submission_property where capture_id=v_capture);
  if v_n<>40 then raise exception '#2599 post-condition: expected 40 VM submission refs, found %', v_n; end if;
  select count(*) into v_n from core.taxonomy_source_ref where source_system='licensing_mg06_submission_mapping' and source_id like 'VM/%';
  if v_n<>37 then raise exception '#2599 post-condition: expected 37 VM code mapping refs, found %', v_n; end if;
  if exists(select 1 from core.taxonomy_source_ref t join plm.pmt_trackerplus_submission_property s on s.capture_id=v_capture and s.property_local_key=t.source_id
     join core.property p on p.id=t.entity_id where t.source_system='paramount_trackerplus' and p.name is distinct from s.exact_label) then
    raise exception '#2599 post-condition: a canonical VM row does not carry its exact submission name';
  end if;
end
$vm_submission_canonical$;
