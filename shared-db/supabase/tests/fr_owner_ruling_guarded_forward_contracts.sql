-- #1143: guarded forward replacement 20260818174350 must issue a
-- transaction-bound, one-use, audited authorization for the FR owner ruling.
--
-- REWRITTEN UNDER #1140 (2026-08-19), with the orchestrator's explicit
-- permission to edit another author's file. WHAT CHANGED AND WHY:
--
-- This file used to exercise the 'owner_ruling_fr_inactivation' write_kind
-- against a SYNTHETIC licensor called 'GUARDED-FORWARD-CONTRACT', with no
-- recorded owner ruling and no ruling metadata. When it was written that
-- passed, because the guard function had no branch for that write_kind at all
-- -- it was the widest authorization in the system, and this file was, without
-- meaning to, asserting exactly the looseness #1140 exists to remove.
--
-- Migration 20260819151527 narrows that write_kind to the real ruling: licensor
-- code FR, name FRIENDS TV, active to inactive, status only, an UPDATE, with
-- the 2026-08-02 ruling recorded FIRST and metadata whose only change is the
-- exact historical owner_ruling record. So this file now uses a real FR /
-- FRIENDS TV fixture with the ruling recorded first -- which is precisely what
-- held migration 20260818174350 does in production.
--
-- Every original assertion is kept: transaction binding, consumption, immutable
-- audit, and refusal of a replay after consumption. The guard was NOT weakened
-- to make this file pass; the file was wrong.

begin;

-- On the from-empty CI database core.taxonomy_owner_ruling does not exist:
-- 20260802171000 and 20260818174350 both abort on their `select ... into
-- strict` for the FR/FK rows, so their `create table` rolls back with them.
-- Creating it here, inside this rolled-back transaction, is test scaffolding.
create table if not exists core.taxonomy_owner_ruling (
  id uuid primary key default gen_random_uuid(),
  entity_schema text not null default 'core',
  entity_table text not null,
  entity_id uuid,
  entity_code text,
  entity_name text,
  ruling text not null,
  ruled_by text not null,
  ruled_at timestamptz not null,
  ruling_evidence text not null,
  action_taken text not null,
  open_questions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  v_fr_id uuid;
  v_reset_plan uuid := gen_random_uuid();
  v_forward_plan constant uuid := '78f8489b-88ba-5d4c-8430-f7275ae6f201'::uuid;
  v_ruled_at constant timestamptz := timestamptz '2026-08-02 12:00:00+00';
  v_ruler constant text := 'guarded-forward contract ruler';
begin
  -- supabase/ci-bootstrap/020_test_fixture_seed.sql pre-issues 100 blanket
  -- 'canonical_merge' authorizations for every column subset, in this very
  -- transaction. They would silently authorize the replay this file must see
  -- REFUSED at the end. Clear them, then prove the baseline is closed.
  delete from plm.licensing_write_authorization where consumed_at is null;
  begin
    insert into core.licensor (name, code, status) values ('baseline probe', 'FWDBASE', 'active');
    raise exception 'the licensing guard was already open before this contract began';
  exception when others then
    if position('no exact transaction-bound authorization' in sqlerrm) = 0 then raise; end if;
  end;

  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    v_reset_plan, repeat('1', 64), 'contract fixture', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status)
  values ('FRIENDS TV', 'FR', 'active')
  returning id into v_fr_id;

  -- The ruling is recorded BEFORE the write, exactly as the held migration
  -- does it. The guard refuses the write outright if it is not.
  insert into core.taxonomy_owner_ruling (
    entity_table, entity_id, entity_code, entity_name, ruling, ruled_by,
    ruled_at, ruling_evidence, action_taken
  ) values (
    'licensor', v_fr_id, 'FR', 'FRIENDS TV',
    'Licensor FR "FRIENDS TV" was never a real licensor. It was created by mistake.',
    v_ruler, v_ruled_at, 'contract fixture', 'contract fixture'
  );

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
  update core.licensor
  set status = 'inactive',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'owner_ruling', jsonb_build_object(
          'ruled_by', v_ruler,
          'ruled_on', '2026-08-02',
          'ruling', 'never a real licensor; created by mistake',
          'migration', '20260818174350',
          'supersedes', '20260802171000'
        ))
  where id = v_fr_id;

  if (select status::text from core.licensor where id = v_fr_id) <> 'inactive' then
    raise exception 'the guarded forward ruling did not apply';
  end if;
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
      and target_row_id = v_fr_id
      and ruling_migration = '20260818174350'
      and old_status = 'active'
      and new_status = 'inactive'
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
