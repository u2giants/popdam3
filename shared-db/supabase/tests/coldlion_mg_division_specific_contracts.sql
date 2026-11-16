-- Rollback-safe contracts for 20261117020100 / issue #6463 (MG groups are division-specific).
begin;

do $$
declare
  v_s text := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  v_run uuid; v_res jsonb;
begin
  delete from coldlion.merch_group_detail where mg_type_code in ('05','06');
  insert into coldlion.sync_run(endpoint, requested_by) values ('/merchGroupDetails','6463-contract') returning id into v_run;
  insert into coldlion.merch_group_header(company_code,division_code,mg_type_code,mg_type_desc,run_id,fetched_at,source_hash,first_seen_at,last_seen_at)
  values ('FIX6463','CW001','05','Licensor',v_run,now(),repeat('e',64),now(),now()),
         ('FIX6463','EH001','05','Art Theme',v_run,now(),repeat('f',64),now(),now());
  insert into coldlion.merch_group_detail(company_code,division_code,mg_type_code,mg_code,mg_category,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,mg_desc,active) values
   ('FIX6463','CW001','05','L'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'REAL LICENSOR '||v_s,'Y'),
   ('FIX6463','EH001','05','T'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'ABSTRACT '||v_s,'Y');

  v_res := plm.sync_core_licensor_from_coldlion(true);
  if not exists (select 1 from core.licensor where code = 'L'||v_s and status::text = 'active') then
    raise exception 'licensed-division MG05 not made a licensor: %', v_res;
  end if;
  if exists (select 1 from core.licensor where code = 'T'||v_s) then
    raise exception 'EH001 art theme became a licensor';
  end if;
end;
$$;

rollback;
