begin;

do $$
declare
  v_fr_id uuid;
  v_reset_plan uuid := gen_random_uuid();
  v_forward_plan constant uuid := '78f8489b-88ba-5d4c-8430-f7275ae6f201'::uuid;
begin
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    v_reset_plan, repeat('1', 64), 'contract fixture', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status)
  values ('guarded-forward-contract', 'GUARDED-FORWARD-CONTRACT', 'active')
  returning id into v_fr_id;

  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor',
    'owner_ruling_fr_inactivation', v_forward_plan,
    'd6f39e72b533b01a76977a822d8d30178c96775fa943c63b6699be9db068ddcf',
    'shared-db migration 20260818174350', array['status'],
    clock_timestamp() + interval '1 minute'
  );
  update core.licensor set status = 'inactive' where id = v_fr_id;

  if not exists (
    select 1 from plm.licensing_write_authorization
    where plan_id = v_forward_plan and consumed_at is not null
      and backend_pid = pg_backend_pid() and transaction_id = txid_current()
  ) then raise exception 'forward authorization was not transaction-bound and consumed'; end if;
  if not exists (
    select 1 from plm.licensing_write_guard_audit
    where plan_id = v_forward_plan
      and write_kind = 'owner_ruling_fr_inactivation'
      and target_table = 'core.licensor'::regclass
      and operation = 'UPDATE'
      and protected_columns = array['status']::text[]
  ) then raise exception 'forward authorization left no immutable audit'; end if;

  delete from plm.licensing_write_authorization
  where backend_pid = pg_backend_pid()
    and transaction_id = txid_current()
    and target_table = 'core.licensor'::regclass
    and consumed_at is null;

  begin
    update core.licensor set status = 'active' where id = v_fr_id;
    raise exception 'consumed authorization was replayed';
  exception when others then
    if position('no exact transaction-bound authorization' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

rollback;
