-- Rollback-safe contracts for 20261113145056 / issue #6194 (core.licensor daily sync from ColdLion landing).
begin;

do $$
declare
  v_s text := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  v_run uuid; v_coded uuid; v_old uuid; v_res jsonb; v_row record; v_pid uuid;
begin
  delete from coldlion.merch_group_detail where mg_type_code in ('05','06');

  insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
  select pg_backend_pid(),txid_current(),'core.licensor','scrape_consolidation',gen_random_uuid(),repeat(g::text,64),'6194-contract',array['name','code','status'],clock_timestamp()+interval '1 minute'
    from generate_series(1,2) g;
  insert into core.licensor(name,code,status) values('Paul-Frank '||v_s,null,'active') returning id into v_coded;   -- code-less, matched by name
  insert into core.licensor(name,code,status) values('OLD','O'||v_s,'active') returning id into v_old;             -- coded, renamed + inactivated

  insert into coldlion.sync_run(endpoint, requested_by) values ('/merchGroupDetails','6194-contract') returning id into v_run;
  insert into coldlion.merch_group_header(company_code,division_code,mg_type_code,mg_type_desc,run_id,fetched_at,source_hash,first_seen_at,last_seen_at)
  values ('FIX6194','CW001','05','Licensor',v_run,now(),repeat('e',64),now(),now()),
         ('FIX6194','CW001','06','Property',v_run,now(),repeat('f',64),now(),now());
  insert into coldlion.merch_group_detail(company_code,division_code,mg_type_code,mg_code,mg_category,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,mg_desc,active) values
   ('FIX6194','CW001','05','P'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'PAUL FRANK '||v_s,'Y'),
   ('FIX6194','CW001','05','O'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'New Licensor Name','N'),
   ('FIX6194','CW001','05','N'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'FORD - DESPERATE '||v_s,'Y'),
   ('FIX6194','CW001','06','X'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'BRONCO - DESPERATE','Y');

  v_res := plm.sync_core_licensor_from_coldlion(false);
  if (v_res->>'created')::int <> 1 or (v_res->>'coded')::int <> 1 then raise exception 'dry run counts wrong: %', v_res; end if;
  if (select code from core.licensor where id = v_coded) is not null then raise exception 'dry run wrote'; end if;

  v_res := plm.sync_core_licensor_from_coldlion(true);
  select * into v_row from core.licensor where id = v_coded;
  if v_row.code <> 'P'||v_s or v_row.name <> 'PAUL FRANK '||v_s then raise exception 'code-less licensor not coded: %', v_row; end if;
  select * into v_row from core.licensor where id = v_old;
  if v_row.name <> 'New Licensor Name' or v_row.status::text <> 'inactive' then raise exception 'coded licensor not synced: %', v_row; end if;
  if not exists (select 1 from core.licensor where code = 'N'||v_s and status::text = 'active') then raise exception 'new licensor not created'; end if;

  -- The new ColdLion licensor lets its Property be placed (app list names the MG05 parent).
  if to_regclass('dflow_prod."merchGroup"') is null then
    create schema if not exists dflow_prod;
    create table dflow_prod."merchGroup"(mg_id int generated always as identity primary key, mg_code text, "mgTypeCode" text, parent_id int);
  end if;
  insert into dflow_prod."merchGroup"(mg_code,"mgTypeCode") values ('N'||v_s,'05') returning mg_id into v_row;
  insert into dflow_prod."merchGroup"(mg_code,"mgTypeCode",parent_id) values ('X'||v_s,'06',v_row.mg_id);
  perform plm.sync_core_property_from_coldlion(true);
  if not exists (select 1 from core.property p join core.licensor l on l.id=p.licensor_id where p.code='X'||v_s and l.code='N'||v_s) then
    raise exception 'property under new ColdLion licensor not created';
  end if;

  v_res := plm.sync_core_licensor_from_coldlion(true);
  if (v_res->>'created')::int + (v_res->>'coded')::int + (v_res->>'renamed')::int + (v_res->>'status_changed')::int <> 0 then
    raise exception 'second run not idempotent: %', v_res;
  end if;
end;
$$;

rollback;
