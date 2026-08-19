-- #1140: the FR owner-ruling authorization must be narrow, one-use, ordered,
-- transaction-bound, and must leave immutable evidence.
--
-- EVERY assertion below fails if migration 20260819151527 is absent: before it,
-- 'owner_ruling_fr_inactivation' is the widest authorization in the system and
-- each of these refusals simply does not happen.
--
-- No `exception when others` swallows anything. Every handler re-raises unless
-- the message is the exact refusal being proven, so a typo in this file is red,
-- not green. Every proof increments a counter and the counter is asserted at
-- the end, so a block that silently never runs is red too. There is not one
-- `raise warning` in this file, by design.

begin;

-- The test needs the owner-ruling table. On preview it already exists. On the
-- from-empty CI database it does NOT: both 20260802171000 and 20260818174350
-- abort on their `select ... into strict` for the FR/FK rows, so their
-- `create table` rolls back with them. Creating it here (inside this
-- transaction, rolled back at the end) is test scaffolding, not a schema
-- change.
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
  v_checks integer := 0;
  v_expected_checks constant integer := 28;
  v_ruled_at constant timestamptz := timestamptz '2026-08-02 12:00:00+00';
  v_ruler constant text := 'contract-test ruler';
  v_fr uuid;
  v_other uuid;
  v_auth uuid;
  v_delta jsonb;
  v_case record;
  v_audit_before bigint;
  v_metadata_now jsonb;
  v_status_now text;
begin
  v_delta := jsonb_build_object('owner_ruling', jsonb_build_object(
    'ruled_by', v_ruler,
    'ruled_on', '2026-08-02',
    'ruling', 'never a real licensor; created by mistake',
    'migration', '20260802171000'
  ));

  -- ------------------------------------------------------------------
  -- CLEAR THE BLANKET CI AUTHORIZATIONS FIRST.
  -- supabase/ci-bootstrap/020_test_fixture_seed.sql defines
  -- public.ci_authorize_licensing_contract_test(), and the contract-test
  -- runner calls it at the top of EVERY test session. It pre-issues 100
  -- unconsumed 'canonical_merge' authorizations for every column subset of
  -- core.licensor and core.property, in this very backend and transaction, so
  -- that legacy tests can write canonical rows without issuing their own.
  --
  -- For this file that fixture is poison: many proofs below assert that a
  -- write with NO valid authorization is refused, and a blanket
  -- 'canonical_merge' row silently authorizes exactly those writes. The first
  -- CI run of this file failed on precisely that and was right to.
  --
  -- So the outstanding fixture authorizations are removed inside this
  -- transaction (rolled back at the end, like every other change here), and
  -- the empty baseline is then PROVEN rather than assumed. Consumed rows are
  -- left alone: they carry immutable audit evidence.
  -- ------------------------------------------------------------------
  delete from plm.licensing_write_authorization where consumed_at is null;
  if exists (select 1 from plm.licensing_write_authorization where consumed_at is null) then
    raise exception 'the blanket CI licensing authorizations could not be cleared';
  end if;
  begin
    insert into core.licensor (name, code, status) values ('baseline probe', 'FRBASE', 'active');
    raise exception 'the licensing guard was already open before this contract began';
  exception when others then
    if position('no exact transaction-bound authorization' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;

  -- ------------------------------------------------------------------
  -- Fixture: the FR "FRIENDS TV" licensor and an unrelated licensor, both
  -- created through the ordinary guard, plus the recorded 2026-08-02 ruling.
  -- ------------------------------------------------------------------
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create', gen_random_uuid(), repeat('a',64),
     'fr-contract-test', array['name','code','status'], clock_timestamp() + interval '5 minutes');
  insert into core.licensor (name, code, status) values ('FRIENDS TV', 'FR', 'active') returning id into v_fr;

  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create', gen_random_uuid(), repeat('a',64),
     'fr-contract-test', array['name','code','status'], clock_timestamp() + interval '5 minutes');
  insert into core.licensor (name, code, status) values ('NOT FRIENDS TV', 'FRX', 'active') returning id into v_other;

  insert into core.taxonomy_owner_ruling
    (entity_table, entity_id, entity_code, entity_name, ruling, ruled_by, ruled_at, ruling_evidence, action_taken)
  values
    ('licensor', v_fr, 'FR', 'FRIENDS TV', 'never a real licensor', v_ruler, v_ruled_at,
     'contract test fixture', 'contract test fixture');
  -- The unrelated licensor gets a ruling too, so that "a different licensor is
  -- refused" cannot pass merely because its ruling record is missing.
  insert into core.taxonomy_owner_ruling
    (entity_table, entity_id, entity_code, entity_name, ruling, ruled_by, ruled_at, ruling_evidence, action_taken)
  values
    ('licensor', v_other, 'FRX', 'NOT FRIENDS TV', 'unrelated', v_ruler, v_ruled_at,
     'contract test fixture', 'contract test fixture');

  -- ==================================================================
  -- 1. A DIFFERENT LICENSOR is refused, even with a valid authorization
  --    and its own recorded ruling.
  -- ==================================================================
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'owner_ruling_fr_inactivation', gen_random_uuid(), repeat('b',64),
     'fr-contract-test', array['status'], clock_timestamp() + interval '5 minutes')
  returning id into v_auth;
  begin
    update core.licensor
       set status = 'inactive',
           metadata = coalesce(metadata,'{}'::jsonb) || v_delta
     where id = v_other;
    raise exception 'the guard inactivated a licensor that is not FR';
  exception when others then
    if position('permits only licensor code FR' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;

  -- ==================================================================
  -- 2. A DIFFERENT SESSION (backend pid) is refused.
  -- ==================================================================
  delete from plm.licensing_write_authorization where id = v_auth;
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values
    (pg_backend_pid() + 1, txid_current(), 'core.licensor', 'owner_ruling_fr_inactivation', gen_random_uuid(), repeat('b',64),
     'fr-contract-test', array['status'], clock_timestamp() + interval '5 minutes');
  begin
    update core.licensor set status = 'inactive' where id = v_fr;
    raise exception 'the guard accepted an authorization created by another session';
  exception when others then
    if position('no exact transaction-bound authorization' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;
  delete from plm.licensing_write_authorization where consumed_at is null;

  -- ==================================================================
  -- 3. A DIFFERENT TRANSACTION is refused.
  -- ==================================================================
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current() + 1, 'core.licensor', 'owner_ruling_fr_inactivation', gen_random_uuid(), repeat('b',64),
     'fr-contract-test', array['status'], clock_timestamp() + interval '5 minutes');
  begin
    update core.licensor set status = 'inactive' where id = v_fr;
    raise exception 'the guard accepted an authorization created in another transaction';
  exception when others then
    if position('no exact transaction-bound authorization' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;
  delete from plm.licensing_write_authorization where consumed_at is null;

  -- ==================================================================
  -- 4. AN INSERT is refused, and 5. a WIDER COLUMN SET is refused.
  -- ==================================================================
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'owner_ruling_fr_inactivation', gen_random_uuid(), repeat('b',64),
     'fr-contract-test', array['name','code','status'], clock_timestamp() + interval '5 minutes');
  begin
    insert into core.licensor (name, code, status) values ('FRIENDS TV', 'FR2', 'active');
    raise exception 'an owner-ruling authorization created a new licensor row';
  exception when others then
    if position('permits only an UPDATE of core.licensor' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;
  delete from plm.licensing_write_authorization where consumed_at is null;

  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'owner_ruling_fr_inactivation', gen_random_uuid(), repeat('b',64),
     'fr-contract-test', array['name','status'], clock_timestamp() + interval '5 minutes');
  begin
    update core.licensor set status = 'inactive', name = 'FRIENDS TV RENAMED' where id = v_fr;
    raise exception 'an owner-ruling authorization licensed a column other than status';
  exception when others then
    if position('permits only the status column' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;
  delete from plm.licensing_write_authorization where consumed_at is null;

  -- ==================================================================
  -- 7. A WRONG NAME on the FR row is refused, and 8. a row that is not
  --    'active' before the write is refused.
  --
  --    core.licensor.code is unique and the guard demands 'FR', so there
  --    can only ever be ONE row this branch will look at. Falsifying its
  --    name or its starting status therefore means editing that row -- and
  --    the guard rightly refuses to let this test do that. So the trigger is
  --    disabled for the SETUP edit only, then re-enabled and PROVEN
  --    re-enabled before the write under test is attempted. Every write
  --    being judged here goes through the live guard.
  -- ==================================================================
  for v_case in
    select *
    from (values
      ('update core.licensor set name = ''WRONG NAME'' where code = ''FR''',
       'update core.licensor set name = ''FRIENDS TV'' where code = ''FR''',
       'permits only licensor name FRIENDS TV'),
      ('update core.licensor set status = ''archived'' where code = ''FR''',
       'update core.licensor set status = ''active'' where code = ''FR''',
       'expects the row to be active before the write')
    ) as t(setup, restore, msg)
  loop
    execute 'alter table core.licensor disable trigger licensor_licensing_write_guard';
    execute v_case.setup;
    execute 'alter table core.licensor enable trigger licensor_licensing_write_guard';
    if not exists (
      select 1 from pg_trigger
      where tgname = 'licensor_licensing_write_guard' and not tgisinternal and tgenabled <> 'D'
    ) then
      raise exception 'the licensing write guard was left disabled by the setup scaffolding';
    end if;

    insert into plm.licensing_write_authorization
      (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
    values
      (pg_backend_pid(), txid_current(), 'core.licensor', 'owner_ruling_fr_inactivation', gen_random_uuid(), repeat('b',64),
       'fr-contract-test', array['status'], clock_timestamp() + interval '5 minutes');
    begin
      update core.licensor
         set status = 'inactive',
             metadata = coalesce(metadata,'{}'::jsonb) || v_delta
       where id = v_fr;
      raise exception 'the guard accepted a write it should have refused (setup was: %)', v_case.setup;
    exception when others then
      if position(v_case.msg in sqlerrm) = 0 then raise; end if;
      v_checks := v_checks + 1;
    end;
    delete from plm.licensing_write_authorization where consumed_at is null;

    execute 'alter table core.licensor disable trigger licensor_licensing_write_guard';
    execute v_case.restore;
    execute 'alter table core.licensor enable trigger licensor_licensing_write_guard';
  end loop;
  if not exists (
    select 1 from core.licensor
    where id = v_fr and code = 'FR' and name = 'FRIENDS TV' and status::text = 'active'
  ) then
    raise exception 'the scaffolding did not restore the FR row to its starting state';
  end if;

  -- ==================================================================
  -- From here on, ONE valid authorization stands, and each proof falsifies
  -- exactly one thing about the WRITE itself.
  -- ==================================================================
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'owner_ruling_fr_inactivation', gen_random_uuid(), repeat('c',64),
     'fr-contract-test', array['status'], clock_timestamp() + interval '5 minutes')
  returning id into v_auth;

  -- 6. A DIFFERENT TARGET VALUE is refused.
  begin
    update core.licensor
       set status = 'archived',
           metadata = coalesce(metadata,'{}'::jsonb) || v_delta
     where id = v_fr;
    raise exception 'the guard accepted a status other than inactive';
  exception when others then
    if position('permits only the target status inactive' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;

  -- 7. A METADATA CHANGE OUTSIDE the historical statement is refused.
  begin
    update core.licensor
       set status = 'inactive',
           metadata = coalesce(metadata,'{}'::jsonb) || v_delta || jsonb_build_object('smuggled', true)
     where id = v_fr;
    raise exception 'the guard accepted an unauthorized metadata change';
  exception when others then
    if position('changes metadata outside the owner_ruling record' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;

  -- 8. A write recording NO owner_ruling metadata at all is refused.
  begin
    update core.licensor set status = 'inactive' where id = v_fr;
    raise exception 'the guard accepted a status flip that recorded no ruling metadata';
  exception when others then
    if position('records no owner_ruling metadata' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;

  -- ==================================================================
  -- 9-14. Every named owner_ruling metadata refusal, one falsified
  --       condition at a time. Without 20260819151527 every one of these
  --       writes succeeds.
  -- ==================================================================
  for v_case in
    select *
    from (values
      (jsonb_build_object('owner_ruling', jsonb_build_object(
         'ruled_by', v_ruler, 'ruled_on', '2026-08-02',
         'ruling', 'never a real licensor; created by mistake',
         'migration', '19990101000000')),
       'names an unknown ruling migration'),
      (jsonb_build_object('owner_ruling', jsonb_build_object(
         'ruled_by', 'someone who did not rule', 'ruled_on', '2026-08-02',
         'ruling', 'never a real licensor; created by mistake',
         'migration', '20260802171000')),
       'names a different ruler than the recorded owner ruling'),
      (jsonb_build_object('owner_ruling', jsonb_build_object(
         'ruled_by', v_ruler, 'ruled_on', '2026-08-02',
         'ruling', 'some other ruling entirely',
         'migration', '20260802171000')),
       'must state the exact historical ruling text'),
      (jsonb_build_object('owner_ruling', jsonb_build_object(
         'ruled_by', v_ruler, 'ruled_on', '2026-08-03',
         'ruling', 'never a real licensor; created by mistake',
         'migration', '20260802171000')),
       'must state the 2026-08-02 ruling date'),
      (jsonb_build_object('owner_ruling', jsonb_build_object(
         'ruled_by', v_ruler, 'ruled_on', '2026-08-02',
         'ruling', 'never a real licensor; created by mistake',
         'migration', '20260802171000', 'bogus', 1)),
       'has the wrong key set'),
      (jsonb_build_object('owner_ruling', 5),
       'owner_ruling metadata must be an object'),
      -- #1219 shape: PRESENT BUT NULL. These two passed until 2026-08-19
      -- because the guard compared with `<>` instead of `is distinct from`,
      -- so a JSON null made the comparison UNKNOWN and the check never fired.
      (jsonb_build_object('owner_ruling', jsonb_build_object(
         'ruled_by', v_ruler, 'ruled_on', null,
         'ruling', 'never a real licensor; created by mistake',
         'migration', '20260802171000')),
       'must state the 2026-08-02 ruling date'),
      (jsonb_build_object('owner_ruling', jsonb_build_object(
         'ruled_by', v_ruler, 'ruled_on', '2026-08-02',
         'ruling', null,
         'migration', '20260802171000')),
       'must state the exact historical ruling text'),
      -- `supersedes` is optional, but when present its value is bound.
      (jsonb_build_object('owner_ruling', jsonb_build_object(
         'ruled_by', v_ruler, 'ruled_on', '2026-08-02',
         'ruling', 'never a real licensor; created by mistake',
         'migration', '20260818174350', 'supersedes', '19990101000000')),
       'supersedes an unexpected migration')
    ) as t(delta, msg)
  loop
    begin
      update core.licensor
         set status = 'inactive',
             metadata = coalesce(metadata,'{}'::jsonb) || v_case.delta
       where id = v_fr;
      raise exception 'the guard accepted malformed owner_ruling metadata: %', v_case.delta;
    exception when others then
      if position(v_case.msg in sqlerrm) = 0 then raise; end if;
      v_checks := v_checks + 1;
    end;
  end loop;

  -- ==================================================================
  -- 15. ORDERING: without the recorded ruling, the write is refused.
  --     This is what makes a standalone status flip impossible.
  -- ==================================================================
  delete from core.taxonomy_owner_ruling where entity_id = v_fr;
  begin
    update core.licensor
       set status = 'inactive',
           metadata = coalesce(metadata,'{}'::jsonb) || v_delta
     where id = v_fr;
    raise exception 'the guard applied the ruling before the ruling was recorded';
  exception when others then
    if position('owner ruling for this licensor is not recorded' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;
  insert into core.taxonomy_owner_ruling
    (entity_table, entity_id, entity_code, entity_name, ruling, ruled_by, ruled_at, ruling_evidence, action_taken)
  values
    ('licensor', v_fr, 'FR', 'FRIENDS TV', 'never a real licensor', v_ruler, v_ruled_at,
     'contract test fixture', 'contract test fixture');

  -- ==================================================================
  -- 15b. THE RULING TABLE ITSELF MISSING -- FAIL CLOSED, MEASURED.
  --
  --      Two independent reviewers disagreed about what happens when
  --      core.taxonomy_owner_ruling does not exist at all (the from-empty
  --      case, #1258): fails closed, or fails open? It was settled by
  --      running it, not by arguing it. Measured on 2026-08-19:
  --
  --        SQLSTATE 42P01, relation "core.taxonomy_owner_ruling" does not
  --        exist; the UPDATE aborted; FR stayed 'active'; 0 audit rows
  --        written; 0 authorizations consumed.
  --
  --      The guard has no exception handler, so the missing-relation error
  --      propagates out of the trigger and takes the write with it. This
  --      proof PINS that. If someone later wraps the ruling lookup in an
  --      `exception when others` that swallows 42P01, the guard would start
  --      inactivating FR with no owner ruling behind it anywhere -- and this
  --      block goes red the moment they try.
  --
  --      The table is dropped inside this transaction and rebuilt straight
  --      after; the whole file is rolled back regardless.
  -- ==================================================================
  execute 'drop table core.taxonomy_owner_ruling';
  declare
    v_state text;
  begin
    update core.licensor
       set status = 'inactive',
           metadata = coalesce(metadata,'{}'::jsonb) || v_delta
     where id = v_fr;
    raise exception 'the guard applied the ruling with the owner-ruling table absent -- IT FAILS OPEN';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42P01' then raise; end if;
    v_checks := v_checks + 1;
  end;
  if (select status::text from core.licensor where id = v_fr) <> 'active' then
    raise exception 'the aborted missing-table write still moved FR';
  end if;
  if exists (select 1 from plm.licensing_write_authorization where id = v_auth and consumed_at is not null) then
    raise exception 'the aborted missing-table write still consumed its authorization';
  end if;

  create table core.taxonomy_owner_ruling (
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
  insert into core.taxonomy_owner_ruling
    (entity_table, entity_id, entity_code, entity_name, ruling, ruled_by, ruled_at, ruling_evidence, action_taken)
  values
    ('licensor', v_fr, 'FR', 'FRIENDS TV', 'never a real licensor', v_ruler, v_ruled_at,
     'contract test fixture', 'contract test fixture');

  -- ==================================================================
  -- 16. STOCKPILING a second unconsumed FR authorization is refused.
  -- ==================================================================
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'owner_ruling_fr_inactivation', gen_random_uuid(), repeat('d',64),
     'fr-contract-test', array['status'], clock_timestamp() + interval '5 minutes');
  begin
    update core.licensor
       set status = 'inactive',
           metadata = coalesce(metadata,'{}'::jsonb) || v_delta
     where id = v_fr;
    raise exception 'the guard accepted a write with a spare FR authorization outstanding';
  exception when others then
    if position('exactly one may be outstanding' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;
  delete from plm.licensing_write_authorization
   where write_kind = 'owner_ruling_fr_inactivation' and consumed_at is null and id <> v_auth;

  -- ==================================================================
  -- 17. ROLLBACK BEHAVIOUR: every refusal above left nothing behind.
  -- ==================================================================
  select status::text, coalesce(metadata,'{}'::jsonb) into strict v_status_now, v_metadata_now
  from core.licensor where id = v_fr;
  if v_status_now <> 'active' or v_metadata_now ? 'owner_ruling' or v_metadata_now ? 'smuggled' then
    raise exception 'a refused FR write left a partial change behind: status %, metadata %', v_status_now, v_metadata_now;
  end if;
  if exists (select 1 from plm.licensing_write_authorization where id = v_auth and consumed_at is not null) then
    raise exception 'a refused FR write consumed its authorization';
  end if;
  if exists (select 1 from plm.licensing_write_guard_audit where authorization_id = v_auth) then
    raise exception 'a refused FR write wrote guard audit evidence';
  end if;
  if (select status::text from core.licensor where id = v_other) <> 'active' then
    raise exception 'a refused FR write changed the unrelated licensor';
  end if;
  v_checks := v_checks + 1;

  -- ==================================================================
  -- 18. THE AUTHORIZED WRITE: the exact historical statement succeeds,
  --     consumes its authorization, and leaves exact audit evidence.
  -- ==================================================================
  select count(*) into v_audit_before from plm.licensing_write_guard_audit;
  update core.licensor
     set status = 'inactive',
         metadata = coalesce(metadata,'{}'::jsonb) || v_delta
   where id = v_fr;

  if (select status::text from core.licensor where id = v_fr) <> 'inactive' then
    raise exception 'the authorized FR owner ruling did not apply';
  end if;
  if not exists (
    select 1 from plm.licensing_write_authorization where id = v_auth and consumed_at is not null
  ) then
    raise exception 'the authorized FR owner ruling did not consume its authorization';
  end if;
  if not exists (
    select 1 from plm.licensing_write_guard_audit
    where authorization_id = v_auth
      and target_table = 'core.licensor'::regclass
      and operation = 'UPDATE'
      and write_kind = 'owner_ruling_fr_inactivation'
      and protected_columns = array['status']::text[]
      and target_row_id = v_fr
      and ruling_migration = '20260802171000'
      and old_status = 'active'
      and new_status = 'inactive'
  ) then
    raise exception 'the authorized FR owner ruling left no exact immutable audit evidence';
  end if;
  if (select count(*) from plm.licensing_write_guard_audit) <> v_audit_before + 1 then
    raise exception 'the authorized FR owner ruling wrote the wrong number of audit rows';
  end if;
  v_checks := v_checks + 1;

  -- ==================================================================
  -- 19. ONE USE: replaying the statement in the same transaction is refused,
  --     because the authorization is consumed.
  -- ==================================================================
  begin
    update core.licensor set status = 'active' where id = v_fr;
    raise exception 'the consumed FR authorization was reusable';
  exception when others then
    if position('no exact transaction-bound authorization' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;

  -- ==================================================================
  -- 20. THE GUARDED REPLACEMENT'S OWN METADATA SHAPE is accepted.
  --     20260818174350 is MERGED and due to run inside the FR bundle AFTER
  --     this migration. Its owner_ruling record carries an extra
  --     `supersedes` key. If this contract refused that shape, this
  --     migration would make a held migration unrunnable -- which is exactly
  --     the defect the first CI run of this branch exposed.
  --
  --     Only ONE row can ever satisfy this guard (core.licensor.code is
  --     unique and the guard demands 'FR'), so proving a second accepted
  --     shape needs the row reset to 'active'. The guard rightly refuses to
  --     do that -- section 19 just proved it. So the trigger is disabled for
  --     the reset ONLY, then re-enabled and PROVEN re-enabled before the
  --     second write is attempted. The reset is scaffolding; the write that
  --     follows it goes through the live guard like every other.
  -- ==================================================================
  execute 'alter table core.licensor disable trigger licensor_licensing_write_guard';
  update core.licensor set status = 'active', metadata = '{}'::jsonb where id = v_fr;
  execute 'alter table core.licensor enable trigger licensor_licensing_write_guard';
  if not exists (
    select 1 from pg_trigger
    where tgname = 'licensor_licensing_write_guard' and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'the licensing write guard was left disabled by the reset scaffolding';
  end if;

  v_delta := jsonb_build_object('owner_ruling', jsonb_build_object(
    'ruled_by', v_ruler,
    'ruled_on', '2026-08-02',
    'ruling', 'never a real licensor; created by mistake',
    'migration', '20260818174350',
    'supersedes', '20260802171000'
  ));
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'owner_ruling_fr_inactivation', gen_random_uuid(), repeat('e',64),
     'shared-db migration 20260818174350', array['status'], clock_timestamp() + interval '5 minutes')
  returning id into v_auth;

  update core.licensor
     set status = 'inactive',
         metadata = coalesce(metadata,'{}'::jsonb) || v_delta
   where id = v_fr;

  if (select status::text from core.licensor where id = v_fr) <> 'inactive' then
    raise exception 'the guarded replacement metadata shape was refused';
  end if;
  if not exists (
    select 1 from plm.licensing_write_guard_audit
    where authorization_id = v_auth
      and target_row_id = v_fr
      and ruling_migration = '20260818174350'
      and old_status = 'active'
      and new_status = 'inactive'
  ) then
    raise exception 'the guarded replacement write left no exact audit evidence';
  end if;
  v_checks := v_checks + 1;

  -- ==================================================================
  -- 21. CLEANUP PROOF / STRICT GUARD RESTORED: nothing is left outstanding,
  --     and an ordinary unauthorized licensing write is refused exactly as
  --     it was before any of this ran.
  -- ==================================================================
  if exists (
    select 1 from plm.licensing_write_authorization
    where write_kind = 'owner_ruling_fr_inactivation' and consumed_at is null
  ) then
    raise exception 'an unconsumed FR owner-ruling authorization was left outstanding';
  end if;
  begin
    insert into core.licensor (name, code, status) values ('post-ruling', 'FRPOST', 'active');
    raise exception 'the strict licensing guard was not restored after the FR owner ruling';
  exception when others then
    if position('no exact transaction-bound authorization' in sqlerrm) = 0 then raise; end if;
    v_checks := v_checks + 1;
  end;

  if v_checks <> v_expected_checks then
    raise exception 'FR owner-ruling contract ran % of % proofs -- a block was skipped', v_checks, v_expected_checks;
  end if;
end $$;

rollback;
