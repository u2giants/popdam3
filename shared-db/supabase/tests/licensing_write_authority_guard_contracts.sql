begin;

do $$
declare
  v_failed boolean := false;
  v_plan uuid := gen_random_uuid();
  v_licensor uuid;
  v_import_body text;
begin
  begin
    insert into core.licensor(name, code, status) values ('guard-test', 'GUARD-TEST', 'active');
  exception when others then
    v_failed := position('no exact transaction-bound authorization' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'direct canonical Licensor insert was not refused'; end if;

  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation', v_plan, repeat('a',64), 'contract-test', array['name','code','status'], clock_timestamp() + interval '1 minute');
  insert into core.licensor(name, code, status)
  values ('guard-authorized', 'GUARD-AUTH', 'active') returning id into v_licensor;
  if not exists (select 1 from plm.licensing_write_guard_audit where plan_id = v_plan and target_table = 'core.licensor'::regclass) then
    raise exception 'authorized write did not create immutable audit evidence';
  end if;

  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'coldlion_status', gen_random_uuid(), repeat('b',64), 'contract-test', array['status'], clock_timestamp() + interval '1 minute');
  update core.licensor set status = 'inactive' where id = v_licensor;
  if (select status::text from core.licensor where id=v_licensor) is distinct from 'inactive' then
    raise exception 'coldlion_status did not change an exactly-authorized Licensor status';
  end if;
  if not exists (select 1 from plm.licensing_write_guard_audit
                 where target_table='core.licensor'::regclass and write_kind='coldlion_status'
                   and actor='contract-test' and protected_columns=array['status']) then
    raise exception 'coldlion_status Licensor transition has no immutable guard audit';
  end if;

  begin
    perform * from plm.promote_coldlion_source_owned('{}', null, true);
    raise exception 'ColdLion promotion drill unexpectedly ran';
  exception when others then
    if position('does not accept drill writes' in sqlerrm) = 0 then raise; end if;
  end;

  v_failed := false;
  select p.prosrc into v_import_body
  from pg_proc p
  where p.oid = 'plm.import_master_data(jsonb,jsonb)'::regprocedure;
  if position('retired by #1090 Step 1.0' in v_import_body) > 0 then
    begin
      perform * from plm.import_master_data('[]', '[]');
    exception when others then
      v_failed := position('retired by #1090 Step 1.0' in sqlerrm) > 0;
    end;
  else
    -- The from-empty CI replay deliberately replays the held 20260802170000 body
    -- after this migration. Its licensing write must still stop at the table guard.
    begin
      perform * from plm.import_master_data(
        '[{"id":"guard-held-licensor","mg_code":"GUARD-HELD","title":"Guard Held Licensor","properties":[]}]',
        '[]'
      );
    exception when others then
      v_failed := position('no exact transaction-bound authorization' in sqlerrm) > 0;
    end;
  end if;
  if not v_failed then raise exception 'DesignFlow licensing importer bypassed retirement/table guard'; end if;

  if has_table_privilege('service_role', 'plm.licensing_write_authorization', 'INSERT') then
    raise exception 'service_role can forge licensing authorization';
  end if;
  if has_table_privilege('service_role', 'plm.licensing_write_guard_audit', 'UPDATE')
     or has_table_privilege('service_role', 'plm.licensing_write_guard_audit', 'DELETE')
     or has_table_privilege('service_role', 'plm.licensing_write_guard_audit', 'TRUNCATE') then
    raise exception 'service_role can mutate licensing guard audit';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'licensor_licensing_write_guard' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'property_licensing_write_guard' and not tgisinternal) then
    raise exception 'licensing write guards are missing';
  end if;
end $$;

-- A later CREATE OR REPLACE of the legacy importer cannot weaken the table guard.
create or replace function plm.import_master_data(licensors_payload jsonb, customers_payload jsonb)
returns table (sync_run_id uuid, licensors_seen integer, properties_seen integer, customers_seen integer, raw_records_upserted integer)
language plpgsql security definer set search_path = pg_catalog, plm, core, app as $$
begin
  insert into core.property (licensor_id, name, code, status)
  values (null, 'held-body-replay', 'HELD-REPLAY', 'active');
  return query select gen_random_uuid(), 0, 1, 0, 1;
end;
$$;

do $$
begin
  begin
    perform * from plm.import_master_data('[]', '[]');
    raise exception 'replacement importer bypassed the table-level licensing guard';
  exception when others then
    if position('no exact transaction-bound authorization' in sqlerrm) = 0 then raise; end if;
  end;
  if exists (select 1 from core.property where code = 'HELD-REPLAY') then
    raise exception 'replacement importer changed a protected Property';
  end if;
end $$;

rollback;
