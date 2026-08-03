-- =====================================================================================
-- TEMPORARY — THIS ENTIRE SCHEMA IS TO BE DELETED. READ THE DELETION TRIGGER BELOW.
-- =====================================================================================
--
-- Schema:  temp_status_watch
-- Purpose: (1) a point-in-time SNAPSHOT of the curated `status` of every row in
--              core.property and core.licensor, captured from LIVE DATA at the moment
--              this migration is applied; and
--          (2) a RUNNING RECORD of every subsequent change to those statuses, written
--              by row-level triggers on the tables themselves, so a change made by ANY
--              path is recorded.
--
-- Requested by Albert Hazan, 2026-08-03:
--   "do the snapshot of all 256 statuses and keep a running record of changes in a
--    table. and mark that table as temporary and to be deleted once we're all moved
--    over with no problems."
--
-- -------------------------------------------------------------------------------------
-- WHY THIS EXISTS
-- -------------------------------------------------------------------------------------
-- core.property.status and core.licensor.status are curated BY HAND. AGENTS.md §6.4
-- (owner ruling, 2026-08-03) establishes that curated data outranks the transitional
-- Master Data catch-up import — but production's plm.import_master_data(jsonb, jsonb)
-- still force-sets status = 'active' on every matched row of every re-pull. The
-- corrective migration 20260802170000 is merged to main but is NOT applied to
-- production. The only reason nothing has been lost yet is that the import lane has
-- not succeeded since 2026-07-08.
--
-- There is NO audit trail of any kind on these two columns today. If the import is
-- revived before the fix lands, every deliberate inactivation is reverted silently and
-- NOBODY CAN RECONSTRUCT WHAT IT WAS. This schema closes that evidence gap. It captures
-- and records; it does not curate. It changes no status value.
--
-- -------------------------------------------------------------------------------------
-- WHY THE SNAPSHOT IS POPULATED FROM LIVE DATA, NOT HARD-CODED
-- -------------------------------------------------------------------------------------
-- The INSERT below is `select ... from core.property`, evaluated when this file is
-- applied. It therefore captures whatever is true in the database it lands in. It is
-- deliberately NOT a hard-coded VALUES list read off preview: preview and production
-- DIVERGE on exactly the column being snapshotted (licensor `FR` is inactive on
-- preview and active on production, 2026-08-03), so a snapshot transcribed from a
-- preview read would be a FALSE record of production. Populating at apply time is the
-- only construction that is correct in both databases.
--
-- The snapshot is keyed by a label so the migration is safely re-runnable and so a
-- later "second look" capture can be added without disturbing the original.
--
-- -------------------------------------------------------------------------------------
-- *** DELETION TRIGGER — THE CONDITION UNDER WHICH THIS SCHEMA IS DROPPED ***
-- -------------------------------------------------------------------------------------
-- Albert's instruction is that this is deleted "once we're all moved over with no
-- problems". A deferral without a written trigger becomes "never", so the trigger is
-- written here, in the table comments, and in docs/status-snapshot-and-change-log.md.
--
-- DROP this schema when ALL THREE are true:
--
--   1. The import can no longer force status. `plm.import_master_data` on PRODUCTION
--      (qsllyeztdwjgirsysgai) no longer writes core.property.status or
--      core.licensor.status on a matched row — verified by reading
--      pg_get_functiondef(), not by a ledger row. (This is what migration
--      20260802170000 does; it is not applied to production as of 2026-08-03.)
--
--   2. The cut-over is done. The transitional Master Data catch-up import described in
--      AGENTS.md §6.4 has been retired, and has not run for 30 consecutive days.
--
--   3. This is no longer the only record. A durable per-field curation record exists on
--      core.property / core.licensor (the "deliberately set" record AGENTS.md §6.4 says
--      does not exist today), so dropping this schema loses no unique evidence.
--
-- TEARDOWN, when all three hold:   drop schema temp_status_watch cascade;
-- That is the whole teardown. Nothing outside this schema depends on it: no core.*
-- object references it, no view outside it selects from it, and the two triggers it
-- installs on core.property / core.licensor are dropped by the CASCADE because their
-- functions live inside the schema.
--
-- REVIEW DATE: 2026-11-03. If all three conditions are not met by then, an agent must
-- report that to Albert rather than let this drift into permanence. Do not silently
-- extend it.
--
-- -------------------------------------------------------------------------------------
-- DESIGN NOTES — the specific traps this file is built to avoid
-- -------------------------------------------------------------------------------------
-- * NOT a Postgres `CREATE TEMPORARY TABLE`. That is session-scoped and would vanish at
--   disconnect. This is a durable table that is LABELLED temporary — by its schema name,
--   its table names, its comments, this header, and the doc.
--
-- * Triggers are AFTER, not BEFORE. A BEFORE trigger cannot read a
--   `GENERATED ... STORED` column (Postgres populates those after before-triggers), so a
--   BEFORE guard silently reads NULL and never fires — a migration in this repo once
--   installed perfectly and did nothing for exactly that reason. Neither table has a
--   generated column today, but AFTER is correct regardless and stays correct if one is
--   added later.
--
-- * The append-only guard has NO role check, BY CONSTRUCTION. The known failure mode
--   here is a null-permissive guard shaped
--       if not ( ... or auth.role() = 'service_role' ) then raise ...
--   which NEVER fires when auth.role() is NULL — which is exactly what it is inside a
--   migration. This file avoids the whole class: the guard raises unconditionally, so
--   there is no expression that a NULL can satisfy. History is append-only for
--   everyone including postgres; a correction is a new row, and the teardown is
--   DROP SCHEMA, which no trigger blocks.
--
-- * ACTOR HONESTY. This repo previously recorded a sub-agent in an audit trail as
--   though it were a human (`reset_by`), and an auditor reached a wrong conclusion.
--   Therefore the change log has NO free-text "changed by" field that a caller can
--   fill in. It records only facts the database itself can prove about the connection:
--   current_user, session_user, auth.uid(), auth.role(), and application_name. The
--   derived `actor_kind` is computed from those facts, never supplied. An automated
--   actor cannot present itself as a person because there is nowhere to type a name.
-- =====================================================================================

create schema if not exists temp_status_watch;

comment on schema temp_status_watch is
  'TEMPORARY — DELETE THIS SCHEMA. Stopgap snapshot + change log for the hand-curated '
  'core.property.status / core.licensor.status, created 2026-08-03 at Albert Hazan''s '
  'request because production''s plm.import_master_data force-sets status=''active'' and '
  'there is no audit trail. Teardown is a single "drop schema temp_status_watch cascade". '
  'Drop it when ALL THREE hold: (1) plm.import_master_data on production no longer writes '
  'those status columns on a matched row, verified via pg_get_functiondef; (2) the '
  'transitional Master Data catch-up import is retired and has not run for 30 consecutive '
  'days; (3) a durable per-field curation record exists on core.property/core.licensor so '
  'this is no longer the only evidence. REVIEW DATE 2026-11-03 — if all three are not met '
  'by 2026-11-03, report that to Albert; do not silently extend.';


-- =====================================================================================
-- 1. THE SNAPSHOT
-- =====================================================================================
-- `status` on both tables is an enum (USER-DEFINED). It is stored here as TEXT on
-- purpose: the record must remain readable if the enum is ever altered, and a snapshot
-- that fails to restore because a label was removed is not a snapshot.

create table if not exists temp_status_watch.status_snapshot (
  snapshot_label   text        not null,
  entity_type      text        not null check (entity_type in ('property', 'licensor')),
  entity_id        uuid        not null,
  entity_name      text        not null,
  entity_code      text,
  licensor_id      uuid,                 -- property rows only; NULL for licensor rows
  licensor_name    text,                 -- property rows only
  status           text        not null,
  entity_updated_at timestamptz not null,
  captured_at      timestamptz not null default now(),
  primary key (snapshot_label, entity_type, entity_id)
);

comment on table temp_status_watch.status_snapshot is
  'TEMPORARY — see the schema comment for the deletion trigger. Point-in-time capture of '
  'core.property.status and core.licensor.status, taken from live data when the creating '
  'migration was applied (NOT hard-coded, because preview and production differ on these '
  'very values). Answers "what did I have inactive before?" via the '
  'temp_status_watch.what_was_inactive_before view.';
comment on column temp_status_watch.status_snapshot.snapshot_label is
  'Names the capture, e.g. ''2026-08-03-pre-import-fix''. Part of the primary key so a '
  'later capture can be added without disturbing an earlier one.';
comment on column temp_status_watch.status_snapshot.status is
  'Stored as TEXT, not the enum, so the record survives any future change to the enum.';


-- =====================================================================================
-- 2. THE RUNNING RECORD
-- =====================================================================================
-- One row per status change, per entity, forever (until the schema is dropped).
--
-- INSERT and DELETE are recorded too, not just UPDATE. Recording only UPDATE would leave
-- an obvious hole: an importer that fails to match a curated row and DELETE+INSERTs it
-- (the row-level loophole AGENTS.md §6.4 names explicitly) would produce no update at
-- all, and the status change would vanish from the record.

create table if not exists temp_status_watch.status_change_log (
  id               bigint      generated always as identity primary key,
  changed_at       timestamptz not null default now(),
  entity_type      text        not null check (entity_type in ('property', 'licensor')),
  entity_id        uuid        not null,
  entity_name      text,
  entity_code      text,
  change_kind      text        not null check (change_kind in ('insert', 'update', 'delete')),
  old_status       text,       -- NULL on insert
  new_status       text,       -- NULL on delete
  -- ---- connection facts. All observed, none supplied by the caller. ----
  actor_kind       text        not null,
  db_current_user  name        not null,
  db_session_user  name        not null,
  jwt_uid          uuid,       -- auth.uid(); NULL on a direct (non-JWT) connection
  jwt_role         text,       -- auth.role(); NULL inside a migration or psql session
  application_name text,
  statement_prefix text,       -- first 100 chars of the top-level statement
  txid             bigint      not null
);

comment on table temp_status_watch.status_change_log is
  'TEMPORARY — see the schema comment for the deletion trigger. Append-only running record '
  'of every change to core.property.status / core.licensor.status. Written by AFTER '
  'row-level triggers on the tables themselves, so it captures a change made by ANY path: a '
  'direct UPDATE by an engineer in psql, plm.import_master_data, PostgREST, the Supabase '
  'dashboard, or a script. UPDATE and DELETE on this table are blocked by a trigger — a '
  'correction is a new row.';
comment on column temp_status_watch.status_change_log.actor_kind is
  'DERIVED from the connection, never supplied by the caller. There is deliberately no '
  'free-text "changed by" column: an earlier audit trail in this repo recorded a sub-agent '
  'as though it were a person, and an auditor reached a wrong conclusion. An automated '
  'actor cannot claim to be human here because there is nowhere to type a name.';
comment on column temp_status_watch.status_change_log.jwt_role is
  'auth.role(). NULL inside a migration or a direct psql connection. NEVER write a guard '
  'that treats NULL here as permission — that is the exact bug that made an earlier guard '
  'in this repo a no-op.';

create index if not exists status_change_log_entity_idx
  on temp_status_watch.status_change_log (entity_type, entity_id, changed_at desc);
create index if not exists status_change_log_changed_at_idx
  on temp_status_watch.status_change_log (changed_at desc);


-- =====================================================================================
-- 3. APPEND-ONLY ENFORCEMENT
-- =====================================================================================
-- Unconditional. No role test, therefore no expression a NULL role can satisfy.

create or replace function temp_status_watch.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'temp_status_watch.% is append-only: % is not permitted. Record a correction as a new row. To remove this stopgap entirely, drop the whole schema (see the schema comment for the deletion trigger).',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

comment on function temp_status_watch.reject_mutation() is
  'Raises unconditionally. Deliberately has NO role allowlist: a guard shaped '
  '"if not (... or auth.role() = ''service_role'') then raise" never fires when auth.role() '
  'is NULL, which is what it is inside a migration. Removing the branch removes the bug.';

drop trigger if exists status_snapshot_append_only on temp_status_watch.status_snapshot;
create trigger status_snapshot_append_only
  before update or delete on temp_status_watch.status_snapshot
  for each row execute function temp_status_watch.reject_mutation();

drop trigger if exists status_change_log_append_only on temp_status_watch.status_change_log;
create trigger status_change_log_append_only
  before update or delete on temp_status_watch.status_change_log
  for each row execute function temp_status_watch.reject_mutation();


-- =====================================================================================
-- 4. THE RECORDING TRIGGER
-- =====================================================================================
-- SECURITY DEFINER so any caller that can change a status can also record it — the
-- record must not be defeatable by a caller lacking INSERT on the log. search_path is
-- pinned empty, so every reference below is schema-qualified.

create or replace function temp_status_watch.record_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_type text := tg_argv[0];
  v_kind        text;
  v_id          uuid;
  v_name        text;
  v_code        text;
  v_old         text;
  v_new         text;
  v_uid         uuid;
  v_role        text;
  v_actor_kind  text;
begin
  if tg_op = 'INSERT' then
    v_kind := 'insert';
    v_id := new.id; v_name := new.name; v_code := new.code;
    v_old := null;  v_new := new.status::text;
  elsif tg_op = 'DELETE' then
    v_kind := 'delete';
    v_id := old.id; v_name := old.name; v_code := old.code;
    v_old := old.status::text; v_new := null;
  else
    v_kind := 'update';
    v_id := new.id; v_name := new.name; v_code := new.code;
    v_old := old.status::text; v_new := new.status::text;
  end if;

  -- auth.* may not exist in every environment this schema is rehearsed in; never let a
  -- missing helper stop the record from being written.
  begin
    v_uid  := auth.uid();
    v_role := auth.role();
  exception when others then
    v_uid := null; v_role := null;
  end;

  -- actor_kind is DERIVED. Ordered most-specific first. Note that a NULL v_role is
  -- never treated as a permission or as evidence of a person.
  v_actor_kind := case
    when v_uid is not null                                        then 'signed_in_user'
    when v_role = 'service_role'                                  then 'service_role_automation'
    when v_role = 'anon'                                          then 'anonymous'
    when current_user in ('supabase_admin', 'supabase_auth_admin',
                          'authenticator', 'service_role')        then 'privileged_or_service_connection'
    else 'direct_db_connection_unattributed'
  end;

  insert into temp_status_watch.status_change_log (
    entity_type, entity_id, entity_name, entity_code, change_kind,
    old_status, new_status,
    actor_kind, db_current_user, db_session_user, jwt_uid, jwt_role,
    application_name, statement_prefix, txid
  ) values (
    v_entity_type, v_id, v_name, v_code, v_kind,
    v_old, v_new,
    v_actor_kind, current_user, session_user, v_uid, v_role,
    nullif(current_setting('application_name', true), ''),
    left(coalesce(current_query(), ''), 100),
    txid_current()
  );

  return null;  -- AFTER trigger; return value is ignored
end;
$$;

comment on function temp_status_watch.record_status_change() is
  'TEMPORARY — dropped with the schema. Writes one temp_status_watch.status_change_log row '
  'per status change. Installed as an AFTER row-level trigger so it fires for EVERY write '
  'path (direct UPDATE, plm.import_master_data, PostgREST, dashboard, script), and AFTER '
  'rather than BEFORE because a BEFORE trigger reads NULL from a GENERATED...STORED column.';

drop trigger if exists property_status_change_log on core.property;
create trigger property_status_change_log
  after insert or delete on core.property
  for each row execute function temp_status_watch.record_status_change('property');

drop trigger if exists property_status_change_log_upd on core.property;
create trigger property_status_change_log_upd
  after update on core.property
  for each row
  when (old.status is distinct from new.status)
  execute function temp_status_watch.record_status_change('property');

drop trigger if exists licensor_status_change_log on core.licensor;
create trigger licensor_status_change_log
  after insert or delete on core.licensor
  for each row execute function temp_status_watch.record_status_change('licensor');

drop trigger if exists licensor_status_change_log_upd on core.licensor;
create trigger licensor_status_change_log_upd
  after update on core.licensor
  for each row
  when (old.status is distinct from new.status)
  execute function temp_status_watch.record_status_change('licensor');


-- =====================================================================================
-- 5. POPULATE THE SNAPSHOT FROM LIVE DATA (at apply time — see header)
-- =====================================================================================

insert into temp_status_watch.status_snapshot (
  snapshot_label, entity_type, entity_id, entity_name, entity_code,
  licensor_id, licensor_name, status, entity_updated_at
)
select '2026-08-03-pre-import-fix', 'licensor', l.id, l.name, l.code,
       null, null, l.status::text, l.updated_at
from core.licensor l
on conflict (snapshot_label, entity_type, entity_id) do nothing;

insert into temp_status_watch.status_snapshot (
  snapshot_label, entity_type, entity_id, entity_name, entity_code,
  licensor_id, licensor_name, status, entity_updated_at
)
select '2026-08-03-pre-import-fix', 'property', p.id, p.name, p.code,
       p.licensor_id, l.name, p.status::text, p.updated_at
from core.property p
left join core.licensor l on l.id = p.licensor_id
on conflict (snapshot_label, entity_type, entity_id) do nothing;


-- =====================================================================================
-- 6. PLAIN-ENGLISH VIEWS — so Albert can ask the question without writing SQL
-- =====================================================================================

create or replace view temp_status_watch.what_was_inactive_before as
select s.snapshot_label            as snapshot,
       s.entity_type               as kind,
       s.licensor_name             as licensor,
       s.entity_name               as name,
       s.entity_code               as code,
       s.status                    as status_at_snapshot,
       coalesce(p.status::text, l.status::text, '(row no longer exists)') as status_now,
       s.captured_at
from temp_status_watch.status_snapshot s
left join core.property p on s.entity_type = 'property' and p.id = s.entity_id
left join core.licensor l on s.entity_type = 'licensor' and l.id = s.entity_id
where s.status <> 'active'
order by s.entity_type, s.licensor_name nulls first, s.entity_name;

comment on view temp_status_watch.what_was_inactive_before is
  'TEMPORARY. Answers "what did I have inactive before?" — every licensor/property that was '
  'NOT active when the snapshot was taken, beside what its status is right now.';

create or replace view temp_status_watch.status_changes_since_snapshot as
select s.snapshot_label            as snapshot,
       s.entity_type               as kind,
       s.licensor_name             as licensor,
       s.entity_name               as name,
       s.status                    as status_at_snapshot,
       coalesce(p.status::text, l.status::text, '(row no longer exists)') as status_now
from temp_status_watch.status_snapshot s
left join core.property p on s.entity_type = 'property' and p.id = s.entity_id
left join core.licensor l on s.entity_type = 'licensor' and l.id = s.entity_id
where s.status is distinct from coalesce(p.status::text, l.status::text)
order by s.entity_type, s.licensor_name nulls first, s.entity_name;

comment on view temp_status_watch.status_changes_since_snapshot is
  'TEMPORARY. Every licensor/property whose status differs from the snapshot — i.e. what '
  'has drifted, including anything an import reverted to active.';

create or replace view temp_status_watch.status_change_history as
select c.changed_at,
       c.changed_at at time zone 'America/New_York' as changed_at_new_york,
       c.entity_type as kind,
       c.entity_name as name,
       c.change_kind as what_happened,
       c.old_status  as was,
       c.new_status  as became,
       c.actor_kind  as who_kind,
       c.db_current_user as db_role,
       c.jwt_uid     as signed_in_user_id,
       c.application_name,
       c.statement_prefix
from temp_status_watch.status_change_log c
order by c.changed_at desc, c.id desc;

comment on view temp_status_watch.status_change_history is
  'TEMPORARY. The running record in plain columns, newest first, with the timestamp shown '
  'in both UTC and America/New_York (a midnight-UTC change reads back as the previous day '
  'in New York).';


-- =====================================================================================
-- 7. GRANTS — read-only for apps. Writing the log is the trigger's job.
-- =====================================================================================

grant usage on schema temp_status_watch to authenticated, service_role;
grant select on temp_status_watch.status_snapshot,
                temp_status_watch.status_change_log,
                temp_status_watch.what_was_inactive_before,
                temp_status_watch.status_changes_since_snapshot,
                temp_status_watch.status_change_history
  to authenticated, service_role;
revoke insert, update, delete on temp_status_watch.status_snapshot,
                                 temp_status_watch.status_change_log
  from authenticated, service_role;
