begin;

do $$
declare
  v_expected text[] := array[
    'opa_property_character_resolution_immutable','opa_property_resolution_immutable',
    'opa_character_resolution_immutable','dcp_portal_tile_resolution_immutable',
    'dcp_style_guide_resolution_immutable','dcp_property_resolution_immutable',
    'dcp_character_resolution_immutable','lucasfilm_dcp_portal_tile_resolution_immutable',
    'lucasfilm_dcp_style_guide_resolution_immutable','lucasfilm_dcp_property_resolution_immutable',
    'lucasfilm_dcp_character_resolution_immutable','marvel_dcp_portal_tile_resolution_immutable',
    'marvel_dcp_style_guide_resolution_immutable','marvel_dcp_property_resolution_immutable',
    'marvel_dcp_character_resolution_immutable','twentieth_century_dcp_portal_tile_resolution_immutable',
    'twentieth_century_dcp_style_guide_resolution_immutable','twentieth_century_dcp_property_resolution_immutable',
    'twentieth_century_dcp_character_resolution_immutable',
    'wb_property_character_normalized_resolution_immutable'
  ];
  v_count integer;
  v_ok boolean;
  v_lic uuid;
  v_prop uuid;
  v_row plm.source_resolution%rowtype;
begin
  select count(*) into v_count
  from pg_trigger
  where not tgisinternal and tgname = any(v_expected)
    and pg_get_triggerdef(oid) like '%reject_legacy_landing_resolution_write%';
  if v_count <> cardinality(v_expected) then
    raise exception 'expected % remaining-source guards, found %', cardinality(v_expected), v_count;
  end if;

  if exists (
    select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname='plm'
      and c.relname in ('erp_licensor','erp_property','taxonomy_resolution_review')
      and t.tgname like '%resolution_immutable'
  ) then
    raise exception 'ColdLion workflow tables received a generic resolution guard';
  end if;

  if position('plm.source_resolution' in pg_get_viewdef('api.opa_property_reconciliation'::regclass, true)) = 0 then
    raise exception 'OPA reconciliation still reads legacy pair decisions';
  end if;

  -- A first-write INSERT must not bypass the guard.
  v_ok := false;
  begin
    insert into plm.dcp_portal_tile(source_key,resolution_status,resolution_reason)
    values ('ZZTEST-REMAINING-TILE','no_match','reviewed');
  exception when sqlstate '23514' then v_ok := true;
  end;
  if not v_ok then raise exception 'DCP portal tile accepted a legacy decision on insert'; end if;

  insert into plm.dcp_portal_tile(source_key) values ('ZZTEST-REMAINING-TILE');
  v_ok := false;
  begin
    update plm.dcp_portal_tile set resolution_reason='reviewed'
    where source_key='ZZTEST-REMAINING-TILE';
  exception when sqlstate '23514' then v_ok := true;
  end;
  if not v_ok then raise exception 'DCP portal tile accepted a legacy decision on update'; end if;

  -- Metadata used a different note column. Its null-only constraint closes that path too.
  v_ok := false;
  begin
    insert into plm.dcp_property(source_id,resolution_note)
    values ('ZZTEST-REMAINING-PROPERTY','reviewed');
  exception when sqlstate '23514' then v_ok := true;
  end;
  if not v_ok then raise exception 'DCP metadata property accepted legacy resolution_note'; end if;

  -- The durable setter is the working replacement and OPA's reader observes it.
  insert into core.licensor(name,code) values ('ZZTEST Remaining Licensor','ZZREMAIN')
    returning id into v_lic;
  insert into core.property(licensor_id,name,code)
    values (v_lic,'ZZTEST Remaining Property','ZZREMAINPROP') returning id into v_prop;
  insert into plm.opa_property(licensed_property_id,property_name)
    values (990000001,'ZZTEST Remaining OPA');
  insert into plm.opa_character(character_id,character_name)
    values (990000002,'ZZTEST Remaining Character');
  insert into plm.opa_property_character(
    licensed_property_id,character_id,property_name,character_name,
    brand_property_id,option_source_id,captured_at,source_url,raw,source_hash
  ) values (
    990000001,990000002,'ZZTEST Remaining OPA','ZZTEST Remaining Character',
    990000001,1007,date '2026-08-14','https://example.invalid/zztest','{}','zztest-remaining'
  );

  select * into v_row from plm.set_source_resolution(
    'disney_opa','property','990000001','matched',v_prop,
    null,null,null,'contract decision',null
  );
  if v_row.core_property_id is distinct from v_prop or v_row.resolution_status <> 'matched' then
    raise exception 'durable OPA setter did not preserve the reviewed property decision';
  end if;
  if not exists (
    select 1 from api.opa_property_reconciliation
    where licensed_property_id=990000001 and resolution_status='matched'
      and matched_core_property_ids=array[v_prop]
  ) then
    raise exception 'OPA reconciliation did not read the durable decision';
  end if;

  -- Landing refresh fields remain writable while decisions remain protected.
  update plm.opa_property set property_name='ZZTEST Remaining OPA refreshed'
  where licensed_property_id=990000001;
  if (select resolution_status from plm.opa_property where licensed_property_id=990000001) <> 'unresolved' then
    raise exception 'source-field refresh changed a guarded OPA legacy decision';
  end if;

  raise notice 'remaining source resolution contracts passed';
end;
$$;

rollback;
