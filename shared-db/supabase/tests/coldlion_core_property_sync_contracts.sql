-- Rollback-safe contracts for 20261112232209 / issue #6194 (core.property daily sync from ColdLion landing).
begin;

do $$
declare
  v_lic uuid; v_a uuid; v_c uuid; v_keep uuid; v_res jsonb; v_row record; v_parent bigint; v_run uuid;
  v_s text := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  v_fake_app boolean := to_regclass('dflow_prod."merchGroup"') is null;
begin
  -- Only fixture MG06 rows in scope for this test.
  delete from coldlion.merch_group_detail where mg_type_code = '06';

  insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
  values(pg_backend_pid(),txid_current(),'core.licensor','scrape_consolidation',gen_random_uuid(),repeat('1',64),'6194-contract',array['name','code','status'],clock_timestamp()+interval '1 minute');
  insert into core.licensor(name,code,status) values('6194 Licensor','L'||v_s,'active') returning id into v_lic;

  insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
  select pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),repeat(g::text,64),'6194-contract',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute'
    from generate_series(2,4) g;
  insert into core.property(licensor_id,name,code,status) values(v_lic,'OLD NAME','A'||v_s,'potential') returning id into v_a;   -- coded, will be renamed + inactivated
  insert into core.property(licensor_id,name,code,status) values(v_lic,'Codeless Value',null,'potential') returning id into v_c; -- code-less, will get its code
  insert into core.property(licensor_id,name,code,status) values(v_lic,'Not In ColdLion','K'||v_s,'potential') returning id into v_keep;

  -- App-list parent for the code-less and new values (production has dflow_prod; CI builds a stand-in).
  if v_fake_app then
    create schema if not exists dflow_prod;
    create table dflow_prod."merchGroup"(mg_id serial primary key, mg_code text, "mgTypeCode" text, parent_id int);
  end if;
  insert into dflow_prod."merchGroup"(mg_code, "mgTypeCode") values ('L'||v_s,'05') returning mg_id into v_parent;
  insert into dflow_prod."merchGroup"(mg_code, "mgTypeCode", parent_id) values ('C'||v_s,'06',v_parent),('N'||v_s,'06',v_parent);

  insert into coldlion.sync_run(endpoint, requested_by) values ('/merchGroupDetails','6194-contract') returning id into v_run;
  insert into coldlion.merch_group_header(company_code,division_code,mg_type_code,mg_type_desc,run_id,fetched_at,source_hash,first_seen_at,last_seen_at)
  values ('FIX6194','CW001','06','Property',v_run,now(),repeat('e',64),now(),now()),
         ('FIX6194','SP001','06','Property',v_run,now(),repeat('f',64),now(),now());
  insert into coldlion.merch_group_detail(company_code,division_code,mg_type_code,mg_code,mg_category,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,mg_desc,active) values
   ('FIX6194','CW001','06','A'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'New Name','N'),
   ('FIX6194','SP001','06','A'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'New Name','N'),
   ('FIX6194','CW001','06','C'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'CODELESS VALUE','Y'),
   ('FIX6194','CW001','06','N'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'Brand New','Y'),
   ('FIX6194','CW001','06','Z'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'No Licensor','Y');

  -- Report-only run writes nothing.
  v_res := plm.sync_core_property_from_coldlion(false);
  if (select name from core.property where id = v_a) <> 'OLD NAME' then raise exception 'dry run changed a row'; end if;
  if (v_res->>'created')::int <> 1 or (v_res->>'skipped_no_licensor')::int <> 1 then raise exception 'dry run counts wrong: %', v_res; end if;

  v_res := plm.sync_core_property_from_coldlion(true);

  select * into v_row from core.property where id = v_a;
  if v_row.name <> 'New Name' or v_row.status::text <> 'inactive' or v_row.metadata->'coldlion_sync'->>'previous_name' <> 'OLD NAME' then
    raise exception 'coded row not synced: % %', v_row.name, v_row.status;
  end if;
  select * into v_row from core.property where id = v_c;
  if v_row.code <> 'C'||v_s or v_row.name <> 'CODELESS VALUE' or v_row.status::text <> 'active' then raise exception 'code-less row not coded: %', v_row; end if;
  select * into v_row from core.property where licensor_id = v_lic and code = 'N'||v_s;
  if v_row.id is null or v_row.name <> 'Brand New' or v_row.status::text <> 'active' then raise exception 'new row not created active'; end if;
  if (select status::text from core.property where id = v_keep) <> 'potential' then raise exception 'row outside ColdLion was touched'; end if;
  if exists (select 1 from core.property where code = 'Z'||v_s) then raise exception 'value without licensor was guessed'; end if;

  -- Second run is a no-op.
  v_res := plm.sync_core_property_from_coldlion(true);
  if (v_res->>'created')::int + (v_res->>'renamed')::int + (v_res->>'status_changed')::int + (v_res->>'coded')::int <> 0 then
    raise exception 'second run not idempotent: %', v_res;
  end if;
  if (select count(*) from plm.coldlion_property_sync_run where applied) < 2 then raise exception 'runs not logged'; end if;
end;
$$;

rollback;
