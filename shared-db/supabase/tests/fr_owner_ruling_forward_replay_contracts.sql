-- #1090 / #1143 -- FORWARD COMPATIBILITY, PROVEN BY EXECUTION.
--
-- WHY THIS FILE EXISTS (2026-08-18, review of PR #1145, finding "High 2")
-- ----------------------------------------------------------------------
-- The whole purpose of guarded forward migration 20260818174350 is that it can
-- coexist with the two migrations AGENTS.md 6.5 holds -- 20260802170000 and
-- historical 20260802171000 -- without either of them fighting it.
--
-- The sibling contract test fr_owner_ruling_guarded_forward_contracts.sql
-- proves the AUTHORIZATION mechanics on a synthetic licensor. It never creates
-- core.taxonomy_owner_ruling, never touches `FR`/`FK`, and never replays either
-- held migration. A green run of it was therefore NOT evidence of forward
-- compatibility, and the claim was resting on a static reading of the SQL.
--
-- This file replays the real migration FILES from disk, in both orders, and
-- asserts the outcome. A static reading cannot substitute for that: the thing
-- that makes historical 20260802171000 safe to replay is that its UPDATE
-- carries `and status is distinct from 'inactive'`, so it matches ZERO rows and
-- the licensing write guard never fires. If a future edit widened that WHERE
-- clause by one word, the replay would demand an authorization it does not
-- hold and abort. Nothing but execution catches that.
--
-- WHAT IT WOULD CATCH
--   * historical 20260802171000 acquiring a row-touching write after the
--     forward migration has already set `FR` inactive (guard refusal, or a
--     silent second write that consumes somebody else's authorization);
--   * the forward migration losing its already-inactive re-entry branch, so a
--     second application raises instead of no-opping;
--   * either migration's duplicate-suppression predicate drifting, so a replay
--     inserts a second core.taxonomy_owner_ruling row for the same ruling;
--   * 20260802170000 quietly restoring the plm.import_master_data body that
--     20260817124545 retired (asserted, not assumed -- see section 4).
--
-- SYNTHETIC DATA. `FR` / "FRIENDS TV" and `FK` / "FRIDA KAHLO" are created here
-- because the migrations under test look those exact rows up by code and name.
-- They are not licensed source data and are not copied from any database; both
-- are named in the clear throughout this public repository, including in
-- AGENTS.md 6.5 and in migration 20260802171000 itself. Everything is rolled
-- back.

begin;

-- ---------------------------------------------------------------------------
-- 0. Seed the two rows the migrations act on, through the licensing guard.
-- ---------------------------------------------------------------------------
do $seed$
declare
  v_fr_id uuid;
begin
  if to_regclass('plm.licensing_write_authorization') is null then
    raise exception 'precondition: 20260817124545 licensing write guard is not present';
  end if;

  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'canonical_merge',
     gen_random_uuid(), repeat('a', 64), 'fr-forward-replay-contract',
     array['name','code','status'], clock_timestamp() + interval '5 minutes');
  insert into core.licensor (name, code, status)
  values ('FRIENDS TV', 'FR', 'active')
  returning id into v_fr_id;

  -- metadata is `not null default '{}'`, so the forward migration's
  -- `metadata || jsonb_build_object(...)` is null-safe by schema. Seed the
  -- production-shaped value anyway so the concatenation is proven to PRESERVE
  -- what was already there rather than merely not crash.
  update core.licensor
  set metadata = jsonb_build_object('plm_import_source', 'designflow_plm')
  where id = v_fr_id;

  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.property', 'canonical_merge',
     gen_random_uuid(), repeat('b', 64), 'fr-forward-replay-contract',
     array['licensor_id','name','code','status'], clock_timestamp() + interval '5 minutes');
  insert into core.property (licensor_id, name, code, status)
  values (v_fr_id, 'FRIDA KAHLO', 'FK', 'active');
end $seed$;

-- ---------------------------------------------------------------------------
-- 1. Apply the guarded forward migration ITSELF, from disk.
--
-- `\ir` is relative to THIS file, so it names supabase/migrations/ no matter
-- what directory psql was started in. A wrong path is a hard error under
-- ON_ERROR_STOP, never a silently skipped step.
-- ---------------------------------------------------------------------------
\ir ../migrations/20260818174350_fr_owner_ruling_guarded_forward.sql

do $after_forward$
begin
  if (select status from core.licensor where code = 'FR') <> 'inactive' then
    raise exception 'forward migration did not set FR inactive';
  end if;
  if (select metadata -> 'owner_ruling' ->> 'migration' from core.licensor where code = 'FR')
     <> '20260818174350' then
    raise exception 'forward migration did not stamp its own version on FR metadata';
  end if;
  if (select metadata ->> 'plm_import_source' from core.licensor where code = 'FR')
     is distinct from 'designflow_plm' then
    raise exception 'forward migration discarded pre-existing FR metadata';
  end if;
  if (select count(*) from core.taxonomy_owner_ruling) <> 2 then
    raise exception 'forward migration did not record exactly the two ruling rows';
  end if;
end $after_forward$;

-- ---------------------------------------------------------------------------
-- 2. THE CLAIM UNDER TEST: replay held historical 20260802171000 AFTERWARDS.
--
-- It must apply cleanly and change NOTHING. Snapshot first, replay, compare.
-- ---------------------------------------------------------------------------
create temporary table fr_replay_before on commit drop as
select id, entity_table, entity_id, ruling, ruled_by, ruled_at, ruling_evidence,
       action_taken, open_questions
from core.taxonomy_owner_ruling;

create temporary table fr_licensor_before on commit drop as
select id, code, name, status, metadata from core.licensor where code = 'FR';

create temporary table fr_audit_before on commit drop as
select id from plm.licensing_write_guard_audit;

\ir ../migrations/20260802171000_owner_ruling_friends_tv_frida_kahlo.sql

do $after_historical$
declare
  v_diff bigint;
begin
  -- (a) not one ruling row added, removed or altered.
  select count(*) into v_diff from (
    (select * from fr_replay_before except select id, entity_table, entity_id, ruling,
       ruled_by, ruled_at, ruling_evidence, action_taken, open_questions
     from core.taxonomy_owner_ruling)
    union all
    (select id, entity_table, entity_id, ruling, ruled_by, ruled_at, ruling_evidence,
       action_taken, open_questions
     from core.taxonomy_owner_ruling except select * from fr_replay_before)
  ) d;
  if v_diff <> 0 then
    raise exception 'replaying held 20260802171000 changed core.taxonomy_owner_ruling (% row difference)', v_diff;
  end if;

  -- (b) the licensor row is byte-identical, INCLUDING the metadata stamp. If
  --     the historical migration had written, `owner_ruling.migration` would
  --     now read 20260802171000 and the production audit trail would name a
  --     migration that never ran there.
  select count(*) into v_diff from (
    (select * from fr_licensor_before
     except select id, code, name, status, metadata from core.licensor where code = 'FR')
    union all
    (select id, code, name, status, metadata from core.licensor where code = 'FR'
     except select * from fr_licensor_before)
  ) d;
  if v_diff <> 0 then
    raise exception 'replaying held 20260802171000 modified core.licensor FR';
  end if;

  -- (c) THE SHARP EDGE. A no-op UPDATE never reaches the licensing write
  --     guard, so no audit row may appear. A new audit row here would mean the
  --     historical migration DID write, and did so by consuming an
  --     authorization it was never issued.
  if exists (
    select 1 from plm.licensing_write_guard_audit a
    where not exists (select 1 from fr_audit_before b where b.id = a.id)
  ) then
    raise exception 'replaying held 20260802171000 performed a guarded write';
  end if;
end $after_historical$;

-- ---------------------------------------------------------------------------
-- 3. And the forward migration is re-entrant on top of that.
--
-- Its `elsif status = 'inactive'` branch must accept the state and no-op --
-- not raise, and not issue a second authorization.
-- ---------------------------------------------------------------------------
\ir ../migrations/20260818174350_fr_owner_ruling_guarded_forward.sql

do $reentry$
begin
  if (select status from core.licensor where code = 'FR') <> 'inactive' then
    raise exception 're-applying the forward migration disturbed FR status';
  end if;
  if (select count(*) from core.taxonomy_owner_ruling) <> 2 then
    raise exception 're-applying the forward migration duplicated the ruling rows';
  end if;
  if (select count(*) from plm.licensing_write_authorization
      where write_kind = 'owner_ruling_fr_inactivation') <> 1 then
    raise exception 're-applying the forward migration issued a second FR authorization';
  end if;
end $reentry$;

-- ---------------------------------------------------------------------------
-- 4. Replay held 20260802170000 as well -- and RECORD WHAT IT ACTUALLY DOES.
--
-- It applies cleanly, which is what the forward-compatibility claim needed.
-- But it is a `create or replace function plm.import_master_data(...)` carrying
-- the PRE-#1090 working body, and 20260817124545 replaced that function with a
-- stub that refuses outright ("retired by #1090 Step 1.0"). Replaying it after
-- 20260817124545 therefore RESTORES the retired import path.
--
-- That is asserted rather than glossed, because AGENTS.md 6.5's one permitted
-- promotion carries 20260802170000, and if 20260817124545 lands FIRST in that
-- ordering the retirement is silently undone. This test does not decide the
-- ordering -- it makes the consequence impossible to rediscover by accident on
-- a forward-only production lane.
-- ---------------------------------------------------------------------------
-- to_regprocedure, not a cast: a database without the function at all must
-- report `false` here, not abort the file on a resolution error.
create temporary table fr_import_retired_before on commit drop as
select coalesce(
         position('retired by #1090 Step 1.0' in
           pg_get_functiondef(to_regprocedure('plm.import_master_data(jsonb,jsonb)'))) > 0,
         false) as retired;

\ir ../migrations/20260802170000_plm_import_preserve_curated_licensor_property_status.sql

do $after_170000$
declare
  v_was_retired boolean;
begin
  -- THE FORWARD-COMPATIBILITY CLAIM. Unconditional: 20260802170000 applied
  -- cleanly on top of the forward migration and left its rows alone.
  if (select status from core.licensor where code = 'FR') <> 'inactive' then
    raise exception 'replaying 20260802170000 disturbed FR status';
  end if;
  if (select count(*) from core.taxonomy_owner_ruling) <> 2 then
    raise exception 'replaying 20260802170000 disturbed the ruling rows';
  end if;

  -- THE RECORDED CONSEQUENCE. Only assertable where 20260817124545's retired
  -- stub was the live body to begin with; on any other starting state there is
  -- no retirement to undo and nothing to say. Conditioned on the precondition
  -- rather than asserting it, so a database that never held the stub reports
  -- honestly instead of failing for a reason unrelated to this PR.
  select retired into v_was_retired from fr_import_retired_before;
  if v_was_retired then
    if coalesce(position('retired by #1090 Step 1.0' in
         pg_get_functiondef(to_regprocedure('plm.import_master_data(jsonb,jsonb)'))), 0) <> 0 then
      raise exception
        'plm.import_master_data is still retired after replaying 20260802170000. '
        'That is an IMPROVEMENT over the state this test recorded on 2026-08-18. '
        'Update section 4 of this file rather than deleting the assertion.';
    end if;
    raise notice
      'RECORDED: replaying 20260802170000 restored the plm.import_master_data body '
      'that 20260817124545 retired. AGENTS.md 6.5 promotes 20260802170000; if '
      '20260817124545 lands first, that retirement is silently undone.';
  else
    raise notice
      'SKIPPED the plm.import_master_data retirement observation: the 20260817124545 '
      'stub was not the live body on this database, so there was no retirement to undo.';
  end if;
end $after_170000$;

rollback;
