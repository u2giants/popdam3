-- #1090 / #1339: ERASE licensor FR "FRIENDS TV" and property FK "FRIDA KAHLO".
--
-- WHAT THIS IS, IN ONE LINE
-- ------------------------
-- The removal half of AGENTS.md 6.5. Until this file existed,
-- FR_REMOVAL_VERSIONS in scripts/production_migration_guard.py was empty, so
-- five merged FR migrations could not legally reach production at all. This
-- file is registered there in the SAME commit.
--
-- THE OWNER RULINGS -- TWO OF THEM, BOTH ON 2026-08-20
-- ---------------------------------------------------
-- 1. THE LICENSOR. Albert ruled on 2026-08-03 that FR "FRIENDS TV" was never a
--    real licensor and must be REMOVED, not merely flagged. Asked again on
--    2026-08-20 whether it should disappear entirely or survive as a retired
--    record that old rows could still point at, he answered: "erase FRIENDS TV
--    completely" (issue #1339). So this migration performs a genuine DELETE. It
--    is not a status flip and it is not a tombstone.
--
-- 2. THE PROPERTY. Asked what to do with the one Property still parented to FR,
--    Albert ruled on 2026-08-20: "I went over this 500 times. FRIDA KAHLO was
--    never supposed to be under Friends. they have no relation to each other.
--    and FRIDA KAHLO is a defunct license anyway. you can delete it if that's
--    the easiest way to get this done." (issue #1339.)
--
--    So core.property FK "FRIDA KAHLO" (cb26ec58-0edb-4d45-8c0b-ba283ffb23f8)
--    is DELETED, not re-homed. Two independent owner reasons: the parentage was
--    spurious -- the two have no relationship at all -- and the licence is
--    defunct, so there is nothing to re-home it TO. It is also a Universe A row
--    under owner ruling AGENTS.md 6.15, which says plainly that anything not
--    moved to a surviving list first is gone. It is not being moved.
--
-- AGENTS.md 6.5 -- NO STEP WAS SKIPPED, READ THIS BEFORE CONCLUDING OTHERWISE.
-- 6.5 defines "the removal work" as including bringing in a real FRIDA KAHLO
-- licensor and RE-POINTING property FK onto it. The 2026-08-20 ruling above
-- supersedes that method: FK is deleted instead of re-homed, because the owner
-- says the licence is defunct and the FR parentage was never real. The OUTCOME
-- 6.5 requires -- "nothing may remain pointed at FR", and FR removed LAST after
-- zero dependants -- is met exactly. Only the disposal of that one row changed,
-- and it changed by owner ruling, not by an author's convenience.
--
-- DECISION 1 -- THE GUARD IS EXTENDED TO COVER DELETE, ON BOTH TABLES.
-- --------------------------------------------------------------------
-- 20260817124545 installed the licensing write guard as
-- `before insert or update` on core.licensor and core.property. A DELETE was
-- therefore covered by nothing: the most destructive operation available on
-- canonical licensing identity was the one operation the guard never saw.
--
-- There were three ways to reach the owner's end state, and only one of them is
-- defensible:
--
--   (a) Delete around the guard -- disable the trigger, use a privileged path,
--       or delete through a view. This spends the guard to avoid extending it,
--       and leaves the hole open for the next author. REJECTED.
--   (b) Keep the covered UPDATE path and "remove" the rows by flipping a status
--       or writing tombstones. Directly contrary to both 2026-08-20 answers,
--       and AGENTS.md 6.5 already refuses to leave production at `inactive`.
--       REJECTED.
--   (c) Extend the guard to DELETE and then perform AUTHORIZED deletes through
--       it. CHOSEN. The two deletes this database will ever want on canonical
--       licensing identity are the ones that pay for closing the hole.
--
-- WHY core.property IS COVERED TOO, WHEN AN EARLIER DRAFT LEFT IT OUT.
-- An earlier revision of this file covered only core.licensor and recorded the
-- Property half as a known, stated gap -- on the sole ground that core.property
-- belonged to another workstream (#1238) and could not be claimed here. The
-- 2026-08-20 property ruling removed that ground: this migration now deletes a
-- core.property row itself, under an expanded object claim. Performing an
-- UNGUARDED delete of canonical master data, in the very migration whose whole
-- purpose is to close the unguarded-delete hole, would have been indefensible
-- -- and it would have left the two sibling tables permanently asymmetric for
-- no reason anyone could later reconstruct. So `property_licensing_write_guard`
-- is recreated as `before insert or update or delete` as well.
--
-- Concretely: `app.enforce_licensing_write_authority` handles `tg_op =
-- 'DELETE'` on both tables, and a delete is refused unless it carries a one-use
-- transaction-bound authorization of the matching new write kind --
-- `owner_ruling_fr_removal` for the licensor, `owner_ruling_fk_removal` for the
-- property. The kinds are pinned PER TABLE: no other write kind may authorize
-- any DELETE, neither removal kind may authorize anything but a DELETE, and
-- neither may be pointed at the other's table. Each is bound to the exact code
-- and name it may remove, and each is one-use.
--
-- ONE CONSEQUENCE, STATED PLAINLY BECAUSE IT IS PERMANENT: after this
-- migration, NO core.licensor or core.property row can be deleted by anything,
-- ever, except the two rows named here. There is deliberately no authorization
-- shape for deleting an arbitrary Licensor or Property. Two pre-existing
-- contract tests that deleted their own fixture rows were corrected in the same
-- change; a repository-wide sweep found no other code path that deletes either.
--
-- DECISION 2 -- THE MECHANISM IS THE ONE 20260819151527 ESTABLISHED.
-- ------------------------------------------------------------------
-- No second mechanism is invented. Each delete consumes a transaction-bound,
-- one-use authorization row through `app.enforce_licensing_write_authority`,
-- exactly as the FR inactivation does, and the binding is derived from the row
-- being deleted and from the owner rulings already recorded in this database --
-- never from columns a migration author could forget to fill in.
--
-- DECISION 3 -- WHAT PROVES ANY OF THIS HAPPENED, ONCE BOTH ROWS ARE GONE.
-- ------------------------------------------------------------------------
-- After this migration the database holds NO trace of either row. The surviving
-- explanation is written BEFORE the deletes, in the same transaction, and the
-- guard REFUSES each delete if its record is missing, so the explanation cannot
-- be skipped:
--   * core.taxonomy_owner_ruling gains TWO rows -- one for the licensor and one
--     for the property -- each stating in terms that the row was ERASED, on
--     whose ruling, when, on what evidence, and what became of its dependants.
--   * plm.licensing_write_guard_audit gains an immutable row per delete, naming
--     the deleted row id, the operation, the ruling migration and the status
--     the row held when it died. That table was revoked from every
--     non-superuser role by 20260817124545 and nothing here re-grants any of it.
--
-- AGENTS.md 6.14 (PUBLIC REPO / no personal identifiers) -- CHECKED, and
-- `ruled_by = 'Albert Hazan (owner)'` STAYS, for the reasons already recorded
-- at length in 20260818174350: 6.14 exempts personal names that are THE DATA
-- ITSELF, core.taxonomy_owner_ruling.ruled_by is exactly that, and the same
-- literal is already stored in that column by two applied/merged migrations.
--
-- PRECONDITIONS, MEASURED LIVE ON PRODUCTION qsllyeztdwjgirsysgai 2026-08-20
-- --------------------------------------------------------------------------
-- (target proved from the Supabase project URL immediately before each read)
--
--   core.licensor FR "FRIENDS TV" 2b2caddf-4fb0-4fc3-8245-ccd8f8177e48: present,
--     status = 'active'.
--   core.property FK "FRIDA KAHLO" cb26ec58-0edb-4d45-8c0b-ba283ffb23f8: present,
--     status = 'active', licensor_id = the FR row above.
--   core.property rows under FR OTHER than that one: ZERO.
--
--   Of the 24 foreign keys that reference core.licensor, exactly five carry a
--     row pointing at FR (every other referrer is 0):
--       public.assets            2   on delete SET NULL, column nullable
--       public.style_groups      1   on delete SET NULL, column nullable
--       plm.property_import      1   on delete SET NULL, column nullable
--       plm.licensor_import      1   on delete RESTRICT, column NOT NULL
--       core.property            1   on delete RESTRICT, column NOT NULL
--
--   Of the 35 foreign-key columns that reference core.property, exactly three
--     carry a row pointing at FK (every other referrer is 0):
--       public.assets            1   on delete SET NULL, column nullable
--       public.style_groups      1   on delete SET NULL, column nullable
--       plm.property_import      1   on delete RESTRICT, column NOT NULL
--
--   The plm.property_import row is ONE row (plm_property_id 4156, "FRIDA
--     KAHLO"), and it is both the FR-linked and the FK-linked one. Its
--     property_id is NOT NULL under RESTRICT, so it cannot be unlinked from the
--     Property -- it is deleted, which disposes of its FR link at the same time.
--
-- Every dependant is handled EXPLICITLY below, counted and asserted, rather
-- than left to each foreign key's own ON DELETE action.
--
-- THE DELETES ARE BOUNDED TO EXACT PRIMARY KEYS, NEVER TO A PARENT PREDICATE.
-- `delete from core.property where licensor_id = <FR>` would have been shorter,
-- and it is exactly how a one-row spurious-link cleanup becomes data loss the
-- day an unexpected second row exists. Each delete names its own uuid and
-- asserts a row count of one. The unexpected-row case is handled separately and
-- loudly: if ANY core.property row other than FK is parented to FR, this
-- migration REFUSES rather than widening its own blast radius. That refusal is
-- the surviving half of the old #1238 block and must not be removed with it.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- --------------------------------------------
--   * It touches no core.property row but the single named uuid.
--   * It does not promote or reorder anything. AGENTS.md 6.5 still requires ONE
--     bounded production apply carrying 20260802170000, 20260817225127,
--     20260818174350, this version and (ordering permitting) 20260819151527.
--   * It does not weaken the guard's co-presence check. Registering this
--     version in FR_REMOVAL_VERSIONS is a DATA change to the guard, which is
--     the only legitimate way that hold releases.
--   * It changes catalogue shape (a constraint, a function and two triggers),
--     so it makes no claim of being a pure-data change and declares no such
--     token.

-- ---------------------------------------------------------------------------
-- 1. Admit the two new, narrow write kinds -- one per table, never one shared.
-- ---------------------------------------------------------------------------
alter table plm.licensing_write_authorization
  drop constraint if exists licensing_write_authorization_write_kind_check;

alter table plm.licensing_write_authorization
  add constraint licensing_write_authorization_write_kind_check
  check (write_kind in (
    'scrape_consolidation',
    'licensing_review_create',
    'coldlion_status',
    'canonical_merge',
    'owner_ruling_fr_inactivation',
    'owner_ruling_fr_removal',
    'owner_ruling_fk_removal'
  ));

-- ---------------------------------------------------------------------------
-- 2. The guard, re-derived from its CURRENT body (20260819151527) with DELETE
--    handling added. Every pre-existing branch is reproduced unchanged; the
--    only edits are the DELETE plumbing and the new removal branch.
--
--    NOTE the `if tg_op <> 'DELETE'` fences around the pre-existing branches.
--    In a DELETE trigger NEW is unassigned, and referencing it raises before
--    any of those conditions can be judged. The fences are load-bearing, not
--    tidiness -- do not "simplify" them away.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_licensing_write_authority()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, core, plm
as $$
declare
  v_changed text[] := '{}'::text[];
  v_auth plm.licensing_write_authorization%rowtype;
  v_result record;
  v_old_metadata jsonb;
  v_new_metadata jsonb;
  v_ruling jsonb;
  v_ruling_keys text[];
  v_recorded_ruler text;
  v_parent_code text;
  v_parent_name text;
  v_ruled_at constant timestamptz := timestamptz '2026-08-02 12:00:00+00';
  v_erased_at constant timestamptz := timestamptz '2026-08-20 12:00:00+00';
  v_audit_row_id uuid;
  v_audit_ruling_migration text;
  v_audit_old_status text;
  v_audit_new_status text;
begin
  if tg_op = 'DELETE' then
    v_result := old;
  else
    v_result := new;
  end if;

  if tg_op = 'DELETE' then
    -- #1339: DELETE coverage, on core.licensor and core.property alike. Any
    -- OTHER table reaching this branch means a trigger was widened without
    -- widening this function, so refuse rather than fall through to a
    -- permissive path.
    --
    -- A delete removes the whole protected identity, so it must be authorized
    -- for the whole protected identity -- the same column list the INSERT path
    -- builds for that table, in the same order.
    if tg_table_name = 'licensor' then
      v_changed := array['name','code','status'];
    elsif tg_table_name = 'property' then
      v_changed := array['licensor_id','name','code','status'];
    else
      raise exception 'licensing canonical write refused: DELETE is not authorized on %.%', tg_table_schema, tg_table_name;
    end if;
  elsif tg_table_name = 'licensor' then
    if tg_op = 'INSERT' or new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
    if tg_op = 'INSERT' or new.code is distinct from old.code then v_changed := array_append(v_changed, 'code'); end if;
    if tg_op = 'INSERT' or new.status is distinct from old.status then v_changed := array_append(v_changed, 'status'); end if;
  elsif tg_table_name = 'property' then
    if tg_op = 'INSERT' or new.licensor_id is distinct from old.licensor_id then v_changed := array_append(v_changed, 'licensor_id'); end if;
    if tg_op = 'INSERT' or new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
    if tg_op = 'INSERT' or new.code is distinct from old.code then v_changed := array_append(v_changed, 'code'); end if;
    if tg_op = 'INSERT' or new.status is distinct from old.status then v_changed := array_append(v_changed, 'status'); end if;
  end if;
  if cardinality(v_changed) = 0 then return v_result; end if;

  select * into v_auth
  from plm.licensing_write_authorization a
  where a.backend_pid = pg_backend_pid()
    and a.transaction_id = txid_current()
    and a.target_table = tg_relid
    and a.expires_at > clock_timestamp()
    and a.consumed_at is null
    and a.protected_columns @> v_changed
    and v_changed @> a.protected_columns
  order by a.created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'licensing canonical write refused: no exact transaction-bound authorization for %.% columns %', tg_table_schema, tg_table_name, v_changed;
  end if;

  -- The DELETE contract, stated as separate conditions so a failure names which
  -- one failed. The removal kinds are pinned PER TABLE in BOTH directions: no
  -- other write kind may delete anything, neither removal kind may do anything
  -- but delete, and neither may be pointed at the other's table.
  if tg_op = 'DELETE' then
    if tg_table_name = 'licensor' and v_auth.write_kind <> 'owner_ruling_fr_removal' then
      raise exception 'licensing canonical write refused: write_kind % may not authorize a DELETE of %.%', v_auth.write_kind, tg_table_schema, tg_table_name;
    end if;
    if tg_table_name = 'property' and v_auth.write_kind <> 'owner_ruling_fk_removal' then
      raise exception 'licensing canonical write refused: write_kind % may not authorize a DELETE of %.%', v_auth.write_kind, tg_table_schema, tg_table_name;
    end if;
  end if;
  if v_auth.write_kind = 'owner_ruling_fr_removal' and (tg_op <> 'DELETE' or tg_table_name <> 'licensor') then
    raise exception 'owner_ruling_fr_removal authorization permits only a DELETE of core.licensor, not % on %', tg_op, tg_table_name;
  end if;
  if v_auth.write_kind = 'owner_ruling_fk_removal' and (tg_op <> 'DELETE' or tg_table_name <> 'property') then
    raise exception 'owner_ruling_fk_removal authorization permits only a DELETE of core.property, not % on %', tg_op, tg_table_name;
  end if;

  if tg_op <> 'DELETE' then
    if v_auth.write_kind = 'coldlion_status' and (tg_table_name <> 'property' or v_changed <> array['status']::text[] or new.status not in ('active','inactive')) then
      raise exception 'coldlion_status authorization may change only Property status to active or inactive';
    end if;
    if v_auth.write_kind in ('scrape_consolidation','licensing_review_create') and tg_table_name = 'property' and tg_op = 'INSERT' and new.status <> 'potential' then
      raise exception '% authorization must create Property as potential', v_auth.write_kind;
    end if;
    if v_auth.write_kind = 'scrape_consolidation' and tg_table_name = 'property' and tg_op = 'UPDATE' and new.status is distinct from old.status then
      raise exception 'scrape_consolidation cannot change matched Property status';
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- #1140: the FR owner-ruling INACTIVATION branch. Reproduced unchanged from
  -- 20260819151527 apart from its DELETE fence.
  -- ---------------------------------------------------------------------
  if tg_op <> 'DELETE' and v_auth.write_kind = 'owner_ruling_fr_inactivation' then
    if tg_table_name <> 'licensor' or tg_op <> 'UPDATE' then
      raise exception 'owner_ruling_fr_inactivation authorization permits only an UPDATE of core.licensor, not % on %', tg_op, tg_table_name;
    end if;
    if v_changed <> array['status']::text[] then
      raise exception 'owner_ruling_fr_inactivation authorization permits only the status column, not %', v_changed;
    end if;
    if old.code is distinct from 'FR' or new.code is distinct from 'FR' then
      raise exception 'owner_ruling_fr_inactivation authorization permits only licensor code FR, not %', coalesce(new.code, '<null>');
    end if;
    if old.name is distinct from 'FRIENDS TV' or new.name is distinct from 'FRIENDS TV' then
      raise exception 'owner_ruling_fr_inactivation authorization permits only licensor name FRIENDS TV, not %', coalesce(new.name, '<null>');
    end if;
    if old.status::text <> 'active' then
      raise exception 'owner_ruling_fr_inactivation expects the row to be active before the write, found %', coalesce(old.status::text, '<null>');
    end if;
    if new.status::text <> 'inactive' then
      raise exception 'owner_ruling_fr_inactivation permits only the target status inactive, not %', coalesce(new.status::text, '<null>');
    end if;

    select r.ruled_by into v_recorded_ruler
    from core.taxonomy_owner_ruling r
    where r.entity_table = 'licensor'
      and r.entity_id = new.id
      and r.ruled_at = v_ruled_at
    order by r.created_at
    limit 1;
    if v_recorded_ruler is null then
      raise exception 'owner_ruling_fr_inactivation refused: the 2026-08-02 owner ruling for this licensor is not recorded in this database yet (record it before the write)';
    end if;

    v_old_metadata := coalesce(old.metadata, '{}'::jsonb);
    v_new_metadata := coalesce(new.metadata, '{}'::jsonb);
    v_ruling := v_new_metadata -> 'owner_ruling';
    if v_ruling is null then
      raise exception 'owner_ruling_fr_inactivation refused: the write records no owner_ruling metadata';
    end if;
    if v_new_metadata <> (v_old_metadata || jsonb_build_object('owner_ruling', v_ruling)) then
      raise exception 'owner_ruling_fr_inactivation refused: the write changes metadata outside the owner_ruling record';
    end if;
    if jsonb_typeof(v_ruling) <> 'object' then
      raise exception 'owner_ruling_fr_inactivation refused: owner_ruling metadata must be an object, not %', jsonb_typeof(v_ruling);
    end if;
    select array_agg(k order by k) into v_ruling_keys from jsonb_object_keys(v_ruling) as k;
    if v_ruling_keys is null
       or not (array['migration','ruled_by','ruled_on','ruling']::text[] <@ v_ruling_keys)
       or not (v_ruling_keys <@ array['migration','ruled_by','ruled_on','ruling','supersedes']::text[]) then
      raise exception 'owner_ruling_fr_inactivation refused: owner_ruling metadata has the wrong key set: %', coalesce(v_ruling_keys::text, '<null>');
    end if;
    -- `is distinct from`, NOT `<>`. See 20260819151527 for why every value
    -- comparison in this branch is written this way. Do not simplify them.
    if v_ruling ->> 'ruled_on' is distinct from '2026-08-02' then
      raise exception 'owner_ruling_fr_inactivation refused: owner_ruling metadata must state the 2026-08-02 ruling date, not %', coalesce(v_ruling ->> 'ruled_on', '<null>');
    end if;
    if v_ruling ->> 'ruling' is distinct from 'never a real licensor; created by mistake' then
      raise exception 'owner_ruling_fr_inactivation refused: owner_ruling metadata must state the exact historical ruling text';
    end if;
    if v_ruling ->> 'migration' is null
       or v_ruling ->> 'migration' not in ('20260802171000', '20260818174350') then
      raise exception 'owner_ruling_fr_inactivation refused: owner_ruling metadata names an unknown ruling migration (%)', coalesce(v_ruling ->> 'migration', '<null>');
    end if;
    if v_ruling ? 'supersedes'
       and v_ruling ->> 'supersedes' is distinct from '20260802171000' then
      raise exception 'owner_ruling_fr_inactivation refused: owner_ruling metadata supersedes an unexpected migration (%)', coalesce(v_ruling ->> 'supersedes', '<null>');
    end if;
    if v_ruling ->> 'ruled_by' is distinct from v_recorded_ruler then
      raise exception 'owner_ruling_fr_inactivation refused: owner_ruling metadata names a different ruler than the recorded owner ruling';
    end if;

    if exists (
      select 1 from plm.licensing_write_authorization a2
      where a2.write_kind = 'owner_ruling_fr_inactivation'
        and a2.id <> v_auth.id
        and a2.consumed_at is null
    ) then
      raise exception 'owner_ruling_fr_inactivation refused: another unconsumed FR owner-ruling authorization exists; exactly one may be outstanding';
    end if;

    v_audit_row_id := new.id;
    v_audit_ruling_migration := v_ruling ->> 'migration';
    v_audit_old_status := old.status::text;
    v_audit_new_status := new.status::text;
  end if;

  -- ---------------------------------------------------------------------
  -- #1339: the FR owner-ruling ERASURE branch. Everything below is new.
  -- Each condition is refused BY NAME, so a failure says which one failed and
  -- a test can falsify exactly one condition at a time.
  -- ---------------------------------------------------------------------
  if v_auth.write_kind = 'owner_ruling_fr_removal' then
    if tg_table_name <> 'licensor' then
      raise exception 'owner_ruling_fr_removal authorization permits only core.licensor, not %', tg_table_name;
    end if;
    if v_changed <> array['name','code','status']::text[] then
      raise exception 'owner_ruling_fr_removal authorization must cover the whole protected identity, not %', v_changed;
    end if;
    if old.code is distinct from 'FR' then
      raise exception 'owner_ruling_fr_removal authorization permits only licensor code FR, not %', coalesce(old.code, '<null>');
    end if;
    if old.name is distinct from 'FRIENDS TV' then
      raise exception 'owner_ruling_fr_removal authorization permits only licensor name FRIENDS TV, not %', coalesce(old.name, '<null>');
    end if;

    -- Both rulings must ALREADY be recorded: the original 2026-08-02 finding
    -- that FR was never a real licensor, and the 2026-08-20 reaffirmation that
    -- the row is to be ERASED rather than retired. Once the row is gone those
    -- records are the only explanation left in this database, so a delete that
    -- has not written them first is refused. This is the same ordering proof
    -- the inactivation branch makes, applied to the irreversible step.
    if not exists (
      select 1 from core.taxonomy_owner_ruling r
      where r.entity_table = 'licensor' and r.entity_id = old.id and r.ruled_at = v_ruled_at
    ) then
      raise exception 'owner_ruling_fr_removal refused: the original 2026-08-02 owner ruling for this licensor is not recorded in this database';
    end if;
    select r.ruled_by into v_recorded_ruler
    from core.taxonomy_owner_ruling r
    where r.entity_table = 'licensor'
      and r.entity_id = old.id
      and r.ruled_at = v_erased_at
    order by r.created_at
    limit 1;
    if v_recorded_ruler is null then
      raise exception 'owner_ruling_fr_removal refused: the 2026-08-20 erasure ruling for this licensor is not recorded in this database yet (record it before the delete)';
    end if;

    -- One use means one, exactly as for the inactivation.
    if exists (
      select 1 from plm.licensing_write_authorization a2
      where a2.write_kind = 'owner_ruling_fr_removal'
        and a2.id <> v_auth.id
        and a2.consumed_at is null
    ) then
      raise exception 'owner_ruling_fr_removal refused: another unconsumed FR removal authorization exists; exactly one may be outstanding';
    end if;

    v_audit_row_id := old.id;
    v_audit_ruling_migration := '20260820183334';
    v_audit_old_status := old.status::text;
    v_audit_new_status := null;
  end if;

  -- ---------------------------------------------------------------------
  -- #1339: the FRIDA KAHLO owner-ruling ERASURE branch, for core.property.
  -- Same shape as the licensor branch above, bound to its own row.
  -- ---------------------------------------------------------------------
  if v_auth.write_kind = 'owner_ruling_fk_removal' then
    if v_changed <> array['licensor_id','name','code','status']::text[] then
      raise exception 'owner_ruling_fk_removal authorization must cover the whole protected identity, not %', v_changed;
    end if;
    if old.code is distinct from 'FK' then
      raise exception 'owner_ruling_fk_removal authorization permits only property code FK, not %', coalesce(old.code, '<null>');
    end if;
    if old.name is distinct from 'FRIDA KAHLO' then
      raise exception 'owner_ruling_fk_removal authorization permits only property name FRIDA KAHLO, not %', coalesce(old.name, '<null>');
    end if;

    -- The SPURIOUS PARENTAGE is the whole basis of the owner's ruling ("FRIDA
    -- KAHLO was never supposed to be under Friends"), so the guard proves it
    -- rather than trusting the caller. A FRIDA KAHLO row correctly parented
    -- somewhere else is NOT what the owner ruled on and is not deletable here.
    select l.code, l.name into v_parent_code, v_parent_name
    from core.licensor l where l.id = old.licensor_id;
    if v_parent_code is distinct from 'FR' or v_parent_name is distinct from 'FRIENDS TV' then
      raise exception 'owner_ruling_fk_removal refused: this property is parented to % / %, not the spurious FR / FRIENDS TV parent the owner ruled on', coalesce(v_parent_code, '<null>'), coalesce(v_parent_name, '<null>');
    end if;

    -- Both rulings must ALREADY be recorded, exactly as for the licensor: the
    -- 2026-08-02 finding that the FR parentage is wrong, and the 2026-08-20
    -- ruling that the row is to be ERASED rather than re-homed.
    if not exists (
      select 1 from core.taxonomy_owner_ruling r
      where r.entity_table = 'property' and r.entity_id = old.id and r.ruled_at = v_ruled_at
    ) then
      raise exception 'owner_ruling_fk_removal refused: the original 2026-08-02 owner ruling for this property is not recorded in this database';
    end if;
    select r.ruled_by into v_recorded_ruler
    from core.taxonomy_owner_ruling r
    where r.entity_table = 'property'
      and r.entity_id = old.id
      and r.ruled_at = v_erased_at
    order by r.created_at
    limit 1;
    if v_recorded_ruler is null then
      raise exception 'owner_ruling_fk_removal refused: the 2026-08-20 erasure ruling for this property is not recorded in this database yet (record it before the delete)';
    end if;

    if exists (
      select 1 from plm.licensing_write_authorization a2
      where a2.write_kind = 'owner_ruling_fk_removal'
        and a2.id <> v_auth.id
        and a2.consumed_at is null
    ) then
      raise exception 'owner_ruling_fk_removal refused: another unconsumed FRIDA KAHLO removal authorization exists; exactly one may be outstanding';
    end if;

    v_audit_row_id := old.id;
    v_audit_ruling_migration := '20260820183334';
    v_audit_old_status := old.status::text;
    v_audit_new_status := null;
  end if;

  insert into plm.licensing_write_guard_audit
    (authorization_id, target_table, operation, write_kind, protected_columns, plan_id, plan_hash, actor,
     target_row_id, ruling_migration, old_status, new_status)
  values (v_auth.id, tg_relid, tg_op, v_auth.write_kind, v_changed, v_auth.plan_id, v_auth.plan_hash, v_auth.actor,
          v_audit_row_id, v_audit_ruling_migration, v_audit_old_status, v_audit_new_status);
  update plm.licensing_write_authorization
  set consumed_at = clock_timestamp()
  where id = v_auth.id;
  return v_result;
end;
$$;

revoke all on function app.enforce_licensing_write_authority() from public;

-- ---------------------------------------------------------------------------
-- 3. Widen BOTH guard triggers to DELETE. A trigger's event list cannot be
--    altered in place, so each is dropped and recreated under the SAME name.
--    Both tables are covered -- see "WHY core.property IS COVERED TOO" in the
--    header. Leaving one of a matched pair uncovered would be a hole nobody
--    could later reconstruct a reason for.
-- ---------------------------------------------------------------------------
drop trigger if exists licensor_licensing_write_guard on core.licensor;
create trigger licensor_licensing_write_guard before insert or update or delete on core.licensor
for each row execute function app.enforce_licensing_write_authority();

drop trigger if exists property_licensing_write_guard on core.property;
create trigger property_licensing_write_guard before insert or update or delete on core.property
for each row execute function app.enforce_licensing_write_authority();

-- ---------------------------------------------------------------------------
-- 4. Record both rulings, dispose of the dependants, and erase the two rows.
--
--    ORDER MATTERS AND IS NOT NEGOTIABLE. core.property.licensor_id is NOT NULL
--    under ON DELETE RESTRICT, so the Property must go BEFORE the Licensor.
--    plm.property_import.property_id is NOT NULL under RESTRICT too, so that
--    staging row must go before the Property. Nothing is orphaned at any step,
--    which is what AGENTS.md 6.5 means by "remove FR LAST".
--
--    The whole block is skipped when FR is already absent. That is not a soft
--    failure: this migration's contract is "no FRIENDS TV licensor and no
--    FR-parented FRIDA KAHLO property exist", and a database where they never
--    existed already satisfies it. The from-empty CI replay is exactly that
--    database. When the rows ARE present, every step below is strict and a
--    wrong precondition aborts the transaction loudly.
-- ---------------------------------------------------------------------------
do $fr_erase$
declare
  v_fr_id constant uuid := '2b2caddf-4fb0-4fc3-8245-ccd8f8177e48'::uuid;
  v_fk_id constant uuid := 'cb26ec58-0edb-4d45-8c0b-ba283ffb23f8'::uuid;
  v_ruled_at constant timestamptz := timestamptz '2026-08-02 12:00:00+00';
  v_erased_at constant timestamptz := timestamptz '2026-08-20 12:00:00+00';
  v_ruler constant text := 'Albert Hazan (owner)';
  v_plan_fr constant uuid := '3c9a1f64-2b57-5d18-9a3e-6f0b1c7d4e22'::uuid;
  v_plan_fk constant uuid := '7d20b8e5-4c93-5a67-b1f8-2e5c9a0d3b41'::uuid;
  v_evidence_fr constant text :=
    'Owner ruling given on 2026-08-03 (AGENTS.md 6.5) that FR "FRIENDS TV" was '
    'never a real licensor and must be removed, reaffirmed in plain terms on '
    '2026-08-20 as "erase FRIENDS TV completely" (issue #1339 owner answer). '
    'Applied by migration 20260820183334.';
  v_evidence_fk constant text :=
    'Owner ruling given on 2026-08-20 (issue #1339): "FRIDA KAHLO was never '
    'supposed to be under Friends. they have no relation to each other. and '
    'FRIDA KAHLO is a defunct license anyway. you can delete it if that''s the '
    'easiest way to get this done." This supersedes the re-homing method named '
    'in AGENTS.md 6.5 and is consistent with owner ruling AGENTS.md 6.15, under '
    'which an unmoved Universe A property row is gone. Applied by migration '
    '20260820183334.';
  v_row core.licensor%rowtype;
  v_prop core.property%rowtype;
  v_rows integer;
  v_strays integer;
  v_assets integer;
  v_style_groups integer;
  v_property_import integer;
  v_licensor_import integer;
  v_prop_assets integer;
  v_prop_style_groups integer;
begin
  select * into v_row from core.licensor where id = v_fr_id;
  if not found then
    -- Nothing to erase. Prove that no OTHER row is wearing either identity
    -- before calling this satisfied, so a re-keyed FR or FK can never pass
    -- silently.
    if exists (select 1 from core.licensor where code = 'FR' or name = 'FRIENDS TV') then
      raise exception 'FR erasure refused: % is absent but another core.licensor row still carries code FR or name FRIENDS TV', v_fr_id;
    end if;
    if exists (select 1 from core.property where id = v_fk_id) then
      raise exception 'FR erasure refused: the FR licensor is absent but property % still exists; the pair must be resolved together', v_fk_id;
    end if;
    raise notice 'FR "FRIENDS TV" is already absent from core.licensor; nothing to erase.';
    return;
  end if;
  if v_row.code is distinct from 'FR' or v_row.name is distinct from 'FRIENDS TV' then
    raise exception 'FR erasure refused: % is % / %, not FR / FRIENDS TV', v_fr_id, coalesce(v_row.code, '<null>'), coalesce(v_row.name, '<null>');
  end if;

  -- 4a. THE SURVIVING SAFETY FROM THE OLD #1238 BLOCK.
  --
  --     The owner ruled on ONE property row. Any OTHER row parented to FR is a
  --     row nobody has measured, nobody has ruled on, and nobody knows the
  --     disposal of. Deleting it because it happens to share a parent is
  --     exactly the widening this migration refuses to do; leaving it would
  --     block the licensor delete on the foreign key anyway. So: refuse, by
  --     name, and let a human decide. Measured 2026-08-20: this count is ZERO.
  --
  --     DO NOT DELETE THIS CHECK when reading the header note that the #1238
  --     sequencing block is lifted. The block that was lifted is the one on the
  --     KNOWN FRIDA KAHLO row. This is the unknown-row half and it still stands.
  select count(*) into v_strays
  from core.property where licensor_id = v_fr_id and id <> v_fk_id;
  if v_strays > 0 then
    raise exception 'FR erasure REFUSED: % unexpected core.property row(s) are parented to FR besides FRIDA KAHLO (%). The 2026-08-20 owner ruling covers that one row only; nothing authorizes deleting or re-homing others, and this migration will not widen its own predicate to get past a foreign key. Measure them, take a ruling, and handle them in their own change.', v_strays, v_fk_id;
  end if;

  -- 4b. Both ruling records. Written FIRST, because the guard refuses each
  --     delete without its record and because they are the only explanation
  --     that outlives the rows.
  insert into core.taxonomy_owner_ruling (
    entity_table, entity_id, entity_code, entity_name, ruling, ruled_by,
    ruled_at, ruling_evidence, action_taken, open_questions
  )
  select 'licensor', v_fr_id, 'FR', 'FRIENDS TV',
    'Licensor FR "FRIENDS TV" was never a real licensor. It was created by '
    'mistake, and the owner ruled that it be ERASED entirely rather than kept '
    'as a retired or inactive record.',
    v_ruler, v_erased_at, v_evidence_fr,
    'core.licensor row 2b2caddf-4fb0-4fc3-8245-ccd8f8177e48 was ERASED '
    '(deleted) by migration 20260820183334, under a one-use transaction-bound '
    'owner_ruling_fr_removal authorization consumed through '
    'app.enforce_licensing_write_authority. Its dependants: public.assets (2) '
    'and public.style_groups (1) had their licensor link cleared; the '
    'plm.licensor_import staging row (1) was deleted; the single child property '
    'FK "FRIDA KAHLO" was itself deleted under the same 2026-08-20 ruling set '
    '(see the property ruling recorded alongside this one). This ruling row and '
    'the plm.licensing_write_guard_audit row are the only remaining record that '
    'FRIENDS TV ever existed as a licensor.',
    'None. The FR removal no longer waits on issue #1238: the owner ruled on '
    '2026-08-20 that the FR-parented property be deleted outright.'
  where not exists (
    select 1 from core.taxonomy_owner_ruling
    where entity_table = 'licensor' and entity_id = v_fr_id and ruled_at = v_erased_at
  );

  insert into core.taxonomy_owner_ruling (
    entity_table, entity_id, entity_code, entity_name, ruling, ruled_by,
    ruled_at, ruling_evidence, action_taken, open_questions
  )
  select 'property', v_fk_id, 'FK', 'FRIDA KAHLO',
    'Property FK "FRIDA KAHLO" was never supposed to sit under FRIENDS TV -- '
    'the two have no relation to each other -- and the FRIDA KAHLO licence is '
    'defunct, so there is nothing to re-home it to. The owner ruled that it be '
    'DELETED rather than re-parented.',
    v_ruler, v_erased_at, v_evidence_fk,
    'core.property row cb26ec58-0edb-4d45-8c0b-ba283ffb23f8 was ERASED '
    '(deleted) by migration 20260820183334, under a one-use transaction-bound '
    'owner_ruling_fk_removal authorization consumed through '
    'app.enforce_licensing_write_authority. Its dependants: public.assets (1) '
    'and public.style_groups (1) had their property link cleared, and the '
    'plm.property_import staging row (1, plm_property_id 4156) was deleted. '
    'This ruling row and the plm.licensing_write_guard_audit row are the only '
    'remaining record that this property ever existed.',
    'None. This replaces the re-homing step named in AGENTS.md 6.5; no real '
    'FRIDA KAHLO licensor is brought in, because the licence is defunct.'
  where not exists (
    select 1 from core.taxonomy_owner_ruling
    where entity_table = 'property' and entity_id = v_fk_id and ruled_at = v_erased_at
  );

  if not exists (
    select 1 from core.taxonomy_owner_ruling
    where entity_table = 'licensor' and entity_id = v_fr_id and ruled_at = v_ruled_at
  ) then
    raise exception 'FR erasure refused: the original 2026-08-02 licensor owner ruling is not recorded. Migration 20260818174350 must run before this one.';
  end if;
  if not exists (
    select 1 from core.taxonomy_owner_ruling
    where entity_table = 'property' and entity_id = v_fk_id and ruled_at = v_ruled_at
  ) then
    raise exception 'FRIDA KAHLO erasure refused: the original 2026-08-02 property owner ruling is not recorded. Migration 20260818174350 must run before this one.';
  end if;

  -- 4c. THE PROPERTY GOES FIRST, and only if it is the exact row ruled on.
  select * into v_prop from core.property where id = v_fk_id;
  if not found then
    raise exception 'FR erasure refused: property % is already absent, but its parent licensor % still exists. Expected the pair to be resolved together.', v_fk_id, v_fr_id;
  end if;
  if v_prop.code is distinct from 'FK' or v_prop.name is distinct from 'FRIDA KAHLO' then
    raise exception 'FRIDA KAHLO erasure refused: % is % / %, not FK / FRIDA KAHLO', v_fk_id, coalesce(v_prop.code, '<null>'), coalesce(v_prop.name, '<null>');
  end if;
  if v_prop.licensor_id is distinct from v_fr_id then
    raise exception 'FRIDA KAHLO erasure refused: % is no longer parented to FR; the owner ruled on the spurious FR parentage specifically', v_fk_id;
  end if;

  -- Its dependants. The plm.property_import row is NOT NULL under RESTRICT on
  -- property_id, so it cannot be unlinked -- it is deleted, which also disposes
  -- of the FR licensor link it carries.
  update public.assets set property_id = null where property_id = v_fk_id;
  get diagnostics v_prop_assets = row_count;
  update public.style_groups set property_id = null where property_id = v_fk_id;
  get diagnostics v_prop_style_groups = row_count;
  delete from plm.property_import where property_id = v_fk_id;
  get diagnostics v_property_import = row_count;
  raise notice 'FRIDA KAHLO dependants disposed: assets %, style_groups %, property_import rows deleted %',
    v_prop_assets, v_prop_style_groups, v_property_import;

  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.property',
    'owner_ruling_fk_removal', v_plan_fk,
    'c4e8a1276b09d35fae62c810b7d4931f5a0e6c28d7b13f490a6e25cb8d1937fa',
    'shared-db migration 20260820183334', array['licensor_id','name','code','status'],
    clock_timestamp() + interval '1 minute'
  );

  -- Bounded to the exact primary key. NEVER `where licensor_id = v_fr_id`.
  delete from core.property where id = v_fk_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FRIDA KAHLO erasure deleted % rows, expected 1', v_rows;
  end if;

  -- 4d. Now the licensor's own remaining dependants.
  update public.assets set licensor_id = null where licensor_id = v_fr_id;
  get diagnostics v_assets = row_count;
  update public.style_groups set licensor_id = null where licensor_id = v_fr_id;
  get diagnostics v_style_groups = row_count;
  -- Measured 2026-08-20, the only FR-linked plm.property_import row is the
  -- FRIDA KAHLO one already deleted above, so this is expected to clear zero.
  -- It is kept because "expected zero" is not "guaranteed zero", and a leftover
  -- row here would block the licensor delete on its foreign key.
  update plm.property_import set licensor_id = null where licensor_id = v_fr_id;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    raise notice 'FR: % residual plm.property_import row(s) had their licensor link cleared', v_rows;
  end if;
  -- plm.licensor_import is the DesignFlow staging row that created FR in the
  -- first place. Its licensor_id is NOT NULL, so the link cannot be cleared,
  -- and a staging row for a licensor that was never real has no meaning once
  -- the licensor is gone. It is deleted.
  delete from plm.licensor_import where licensor_id = v_fr_id;
  get diagnostics v_licensor_import = row_count;
  raise notice 'FR dependants disposed: assets %, style_groups %, licensor_import rows deleted %',
    v_assets, v_style_groups, v_licensor_import;

  -- 4e. The authorized erasure of the licensor.
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor',
    'owner_ruling_fr_removal', v_plan_fr,
    '9b1f0c3d5e7a2846b0d9f4c17e35a8629d40bb71c2e6f8039a5d7c41e8b26f03',
    'shared-db migration 20260820183334', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );

  delete from core.licensor where id = v_fr_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FR erasure deleted % rows, expected 1', v_rows;
  end if;

  -- 4f. Proof, for both rows.
  if exists (select 1 from core.licensor where id = v_fr_id or code = 'FR' or name = 'FRIENDS TV') then
    raise exception 'FR erasure left a FRIENDS TV row behind in core.licensor';
  end if;
  if exists (select 1 from core.property where id = v_fk_id) then
    raise exception 'FRIDA KAHLO erasure left the property row behind in core.property';
  end if;
  if not exists (
    select 1 from plm.licensing_write_authorization
    where plan_id = v_plan_fr and consumed_at is not null
      and backend_pid = pg_backend_pid() and transaction_id = txid_current()
  ) then
    raise exception 'FR removal authorization was not consumed in its transaction';
  end if;
  if not exists (
    select 1 from plm.licensing_write_authorization
    where plan_id = v_plan_fk and consumed_at is not null
      and backend_pid = pg_backend_pid() and transaction_id = txid_current()
  ) then
    raise exception 'FRIDA KAHLO removal authorization was not consumed in its transaction';
  end if;
  if not exists (
    select 1 from plm.licensing_write_guard_audit
    where plan_id = v_plan_fr and write_kind = 'owner_ruling_fr_removal'
      and target_table = 'core.licensor'::regclass and operation = 'DELETE'
      and target_row_id = v_fr_id and ruling_migration = '20260820183334'
      and protected_columns = array['name','code','status']::text[]
  ) then
    raise exception 'FR erasure left no immutable guard audit';
  end if;
  if not exists (
    select 1 from plm.licensing_write_guard_audit
    where plan_id = v_plan_fk and write_kind = 'owner_ruling_fk_removal'
      and target_table = 'core.property'::regclass and operation = 'DELETE'
      and target_row_id = v_fk_id and ruling_migration = '20260820183334'
      and protected_columns = array['licensor_id','name','code','status']::text[]
  ) then
    raise exception 'FRIDA KAHLO erasure left no immutable guard audit';
  end if;
end;
$fr_erase$;

-- ---------------------------------------------------------------------------
-- 5. Verify. Shape is asserted from the catalogue; the only rows counted are in
--    this migration's own tables and are reached by indexed or tiny predicates,
--    so nothing here is an expensive statement.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_events text;
  v_table text;
  v_trigger text;
  v_kind text;
begin
  foreach v_kind in array array['owner_ruling_fr_removal','owner_ruling_fk_removal'] loop
    if not exists (
      select 1 from pg_constraint
      where conname = 'licensing_write_authorization_write_kind_check'
        and conrelid = 'plm.licensing_write_authorization'::regclass
        and pg_get_constraintdef(oid) like '%' || v_kind || '%'
    ) then
      raise exception 'verify: the write_kind constraint does not admit %', v_kind;
    end if;
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'enforce_licensing_write_authority'
        and p.prosrc like '%' || v_kind || '%'
    ) then
      raise exception 'verify: the guard function has no % branch', v_kind;
    end if;
    if exists (
      select 1 from plm.licensing_write_authorization
      where write_kind = v_kind and consumed_at is null
    ) then
      raise exception 'verify: an unconsumed % authorization was left outstanding', v_kind;
    end if;
  end loop;

  -- BOTH guard triggers must cover all three events. pg_trigger.tgtype bits:
  -- 4 = INSERT, 8 = DELETE, 16 = UPDATE.
  for v_table, v_trigger in
    values ('core.licensor', 'licensor_licensing_write_guard'),
           ('core.property', 'property_licensing_write_guard')
  loop
    select case when t.tgtype & 4 > 0 then 'insert ' else '' end
        || case when t.tgtype & 8 > 0 then 'delete ' else '' end
        || case when t.tgtype & 16 > 0 then 'update' else '' end
      into v_events
    from pg_trigger t
    where t.tgrelid = v_table::regclass
      and t.tgname = v_trigger
      and not t.tgisinternal;
    if v_events is null then
      raise exception 'verify: the % licensing write guard trigger is missing', v_table;
    end if;
    if position('insert' in v_events) = 0
       or position('delete' in v_events) = 0
       or position('update' in v_events) = 0 then
      raise exception 'verify: the % guard trigger does not cover insert, update AND delete (it covers: %)', v_table, v_events;
    end if;
  end loop;

  if exists (select 1 from core.licensor where code = 'FR' or name = 'FRIENDS TV') then
    raise exception 'verify: a FRIENDS TV licensor row still exists in core.licensor';
  end if;
  if exists (select 1 from core.property where id = 'cb26ec58-0edb-4d45-8c0b-ba283ffb23f8'::uuid) then
    raise exception 'verify: the FRIDA KAHLO property row still exists in core.property';
  end if;
end;
$verify$;
