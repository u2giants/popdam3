-- Rollback-safe contracts for 20261116124500 / issue #6440 (core.licensor is the ColdLion MG05 list only).
begin;

do $$
declare
  v_s text := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  v_run uuid; v_coded uuid; v_hand uuid; v_res jsonb; v_row record; v_refused boolean;
begin
  delete from coldlion.merch_group_detail where mg_type_code in ('05','06');

  -- Arrange as the feed (CI runs as the feed; production sessions do not).
  perform set_config('app.core_licensor_writer', 'mg05_feed', true);
  insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
  select pg_backend_pid(),txid_current(),'core.licensor','scrape_consolidation',gen_random_uuid(),repeat(g::text,64),'6440-contract',array['name','code','status'],clock_timestamp()+interval '1 minute'
    from generate_series(1,2) g;
  insert into core.licensor(name,code,status) values('Paul-Frank '||v_s,null,'active') returning id into v_coded;   -- matched by name
  insert into core.licensor(name,code,status) values('Hand Made '||v_s,'H'||v_s,'active') returning id into v_hand; -- not in MG05

  insert into coldlion.sync_run(endpoint, requested_by) values ('/merchGroupDetails','6440-contract') returning id into v_run;
  insert into coldlion.merch_group_header(company_code,division_code,mg_type_code,mg_type_desc,run_id,fetched_at,source_hash,first_seen_at,last_seen_at)
  values ('FIX6440','CW001','05','Licensor',v_run,now(),repeat('e',64),now(),now());
  insert into coldlion.merch_group_detail(company_code,division_code,mg_type_code,mg_code,mg_category,run_id,fetched_at,source_hash,first_seen_at,last_seen_at,mg_desc,active) values
   ('FIX6440','CW001','05','P'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'PAUL FRANK '||v_s,'Y'),
   ('FIX6440','CW001','05','N'||v_s,'',v_run,now(),repeat('a',64),now(),now(),'NEW LICENSOR '||v_s,'Y');

  -- Every other writer is refused.
  perform set_config('app.core_licensor_writer', '', true);
  v_refused := false;
  begin insert into core.licensor(name,code,status) values('Sneaky '||v_s,'S'||v_s,'active');
  exception when insufficient_privilege then v_refused := true; end;
  if not v_refused then raise exception 'hand insert was not refused'; end if;
  v_refused := false;
  begin update core.licensor set name = 'Renamed' where id = v_hand;
  exception when insufficient_privilege then v_refused := true; end;
  if not v_refused then raise exception 'hand rename was not refused'; end if;
  v_refused := false;
  begin delete from core.licensor where id = v_hand;
  exception when insufficient_privilege then v_refused := true; end;
  if not v_refused then raise exception 'hand delete was not refused'; end if;

  -- Dry run writes nothing.
  v_res := plm.sync_core_licensor_from_coldlion(false);
  if (v_res->>'created')::int <> 1 or (v_res->>'coded')::int <> 1 then raise exception 'dry run counts wrong: %', v_res; end if;
  if (select code from core.licensor where id = v_coded) is not null then raise exception 'dry run wrote'; end if;

  -- Apply: MG05 rows exist exactly once, the hand-made row is archived, nothing deleted.
  v_res := plm.sync_core_licensor_from_coldlion(true);
  select * into v_row from core.licensor where id = v_coded;
  if v_row.code <> 'P'||v_s or v_row.name <> 'PAUL FRANK '||v_s then raise exception 'code-less licensor not coded: %', v_row; end if;
  if (select count(*) from core.licensor where code = 'N'||v_s and status::text = 'active') <> 1 then raise exception 'new licensor not created once'; end if;
  select * into v_row from core.licensor where id = v_hand;
  if v_row.status::text <> 'inactive' or v_row.metadata->'mg05_retired'->>'previous_status' <> 'active' then
    raise exception 'row outside MG05 not retired recoverably: %', v_row;
  end if;
  if exists (select 1 from core.licensor l where l.status::text = 'active'
              and (l.code is null or l.code not in (select mg_code from coldlion.merch_group_detail where mg_type_code = '05'))) then
    raise exception 'active licensor outside MG05 remains';
  end if;

  v_res := plm.sync_core_licensor_from_coldlion(true);
  if (v_res->>'created')::int + (v_res->>'coded')::int + (v_res->>'renamed')::int
     + (v_res->>'status_changed')::int + (v_res->>'retired')::int <> 0 then
    raise exception 'second run not idempotent: %', v_res;
  end if;
end;
$$;

rollback;
