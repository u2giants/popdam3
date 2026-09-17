begin;

do $$
declare
  v_failed boolean := false;
  v_plan uuid := gen_random_uuid();
  v_licensor uuid;
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

  -- #2794 removed plm.import_master_data(jsonb,jsonb) outright, so the contract
  -- here is about ABSENCE. State precisely what this block does and does not do:
  -- absence is the SILENT SUCCESS PATH below, not an assertion. There is no
  -- `else raise` for "the function is gone", so this block cannot fail because
  -- the drop happened. What it does catch is the two ways absence is violated.
  --
  -- The unconditional absence check lives in the migration itself
  -- (20260917102139), whose post-drop block RAISEs if to_regprocedure still
  -- resolves the importer. That runs at apply time on a forward-only database
  -- and is the enforcement; this file is a conditioned corroboration of it.
  --
  -- Absence is asserted where it is assertable, and NOT asserted unconditionally,
  -- for a reason that was measured rather than assumed. On the from-empty CI
  -- replay, migration 20260917102139 applies cleanly in pass 1 and the function is
  -- genuinely dropped. But 20260723183000_step11_bounded_production_forward.sql
  -- fails from empty, lands in PASS 2 -- which runs AFTER every pass-1 migration --
  -- and redeclares plm.import_master_data with its pre-retirement body. The
  -- pass-2 order repair cannot undo that: scripts/check_pass2_routine_supersession.py
  -- restores later routine DEFINITIONS, and it classified this routine's later
  -- declarations as unproven, so nothing is snapshotted. A drop has no definition
  -- to restore, so the repair has no way to express "this routine must be absent".
  -- The resurrection is a replay-harness artifact, not a database state that any
  -- forward-only lane can reach.
  --
  -- So: absent is the contract, and it is enforced by the migration's own
  -- post-drop RAISE rather than by this block. Present-and-still-the-#1090-stub
  -- means 20260917102139 did not do its job and IS a failure. Present with a
  -- pre-retirement body can only be the pass-2 resurrection, which is recorded
  -- loudly here instead of being asserted away or silently tolerated.
  --
  -- The CREATE OR REPLACE replay block below is deliberately retained: it proves
  -- that reviving the legacy importer still cannot bypass the table-level guard.
  if to_regprocedure('plm.import_master_data(jsonb,jsonb)') is not null then
    if position('retired by #1090 Step 1.0' in
                pg_get_functiondef(to_regprocedure('plm.import_master_data(jsonb,jsonb)'))) > 0 then
      raise exception
        'retired DesignFlow importer plm.import_master_data is still present as the '
        '#1090 retirement stub: migration 20260917102139 did not remove it';
    end if;
    raise notice
      'RECORDED: plm.import_master_data is present with a PRE-RETIREMENT body after '
      '#2794 removed it. On a from-empty replay this is the pass-2 reinstatement by '
      '20260723183000, which the pass-2 order repair cannot reverse because a drop '
      'leaves no routine definition to snapshot. On a forward-only database this '
      'notice must never appear -- if it does, an older migration is resurrecting '
      'the retired importer and #2794 is incomplete.';
  end if;

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
