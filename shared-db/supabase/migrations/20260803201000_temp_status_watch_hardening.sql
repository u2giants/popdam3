-- =====================================================================================
-- TEMPORARY — hardening of the temp_status_watch stopgap added by 20260803200000.
-- This file is part of the SAME temporary artefact and is removed by the SAME teardown
-- (`drop schema temp_status_watch cascade;`). See 20260803200000's header and the
-- COMMENT ON SCHEMA for the deletion trigger and the 2026-11-03 review date.
-- =====================================================================================
--
-- WHY A SECOND FILE. 20260803200000 is already applied to preview
-- (rjyboqwcdzcocqgmsyel). Supabase's ledger keys on the VERSION, so editing that file
-- would change the repo without changing the database and desync file from ledger. Every
-- fix is FORWARD (AGENTS.md §4 rule 4).
--
-- Source: independent review by GLM 5.2, 2026-08-03. Four of its findings are adopted
-- here. Its findings that were NOT adopted, and why, are recorded in
-- docs/status-snapshot-and-change-log.md.
--
-- =====================================================================================
-- FINDING 1 (adopted) — `session_replication_role = 'replica'` skips the record entirely
-- =====================================================================================
-- GLM, verbatim: "these triggers are default `ENABLE ORIGIN`; a replica-role session skips
-- them. A bulk-import job often holds that privilege." Verified: the four triggers were
-- created with tgenabled = 'O' (ORIGIN) on preview.
--
-- This is the most important finding in the review. The whole point of this schema is that
-- an import cannot revert a curated status without leaving a trace, and a bulk loader that
-- sets session_replication_role = 'replica' — a normal ETL habit — would have walked
-- straight past it. ENABLE ALWAYS makes the triggers fire regardless of the session's
-- replication role.

alter table core.property  enable always trigger property_status_change_log;
alter table core.property  enable always trigger property_status_change_log_upd;
alter table core.licensor  enable always trigger licensor_status_change_log;
alter table core.licensor  enable always trigger licensor_status_change_log_upd;

-- =====================================================================================
-- FINDING 2 (adopted) — TRUNCATE bypasses row-level triggers
-- =====================================================================================
-- GLM, verbatim: "`TRUNCATE core.property` / `core.licensor` — row-level DELETE triggers do
-- not fire on TRUNCATE and there is no `truncate` trigger. Mass-wipe = mass status loss,
-- unlogged. Primary bypass."
--
-- Correct. Handled two different ways, deliberately:
--
--   * On the CURATED tables (core.property / core.licensor) the truncate is RECORDED, not
--     blocked. Blocking TRUNCATE on shared master data would be a curation/policy change to
--     tables this work does not own, and this work captures and records — it does not
--     curate. A statement-level AFTER TRUNCATE trigger writes one marker row.
--   * On the TEMPORARY tables the truncate is BLOCKED, because "append-only" that a TRUNCATE
--     can empty is not append-only.
--
-- A truncate marker has no single entity, so entity_id must be nullable and 'truncate'
-- must be an allowed change_kind.

alter table temp_status_watch.status_change_log
  alter column entity_id drop not null;

alter table temp_status_watch.status_change_log
  drop constraint if exists status_change_log_change_kind_check;

alter table temp_status_watch.status_change_log
  add constraint status_change_log_change_kind_check
  check (change_kind in ('insert', 'update', 'delete', 'truncate'));

-- entity_id is NULL only for a truncate marker, never for a real row event.
alter table temp_status_watch.status_change_log
  drop constraint if exists status_change_log_entity_id_present;

alter table temp_status_watch.status_change_log
  add constraint status_change_log_entity_id_present
  check ((change_kind = 'truncate') = (entity_id is null));

create or replace function temp_status_watch.record_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_role text;
begin
  begin
    v_uid  := auth.uid();
    v_role := auth.role();
  exception when others then
    v_uid := null; v_role := null;
  end;

  insert into temp_status_watch.status_change_log (
    entity_type, entity_id, entity_name, change_kind, old_status, new_status,
    actor_kind, db_current_user, db_session_user, jwt_uid, jwt_role,
    application_name, statement_prefix, txid
  ) values (
    tg_argv[0], null, '(ALL ROWS — table truncated)', 'truncate', null, null,
    temp_status_watch.derive_actor_kind(v_uid, v_role),
    current_user, session_user, v_uid, v_role,
    nullif(current_setting('application_name', true), ''),
    left(coalesce(current_query(), ''), 100),
    txid_current()
  );
  return null;
end;
$$;

comment on function temp_status_watch.record_truncate() is
  'TEMPORARY — dropped with the schema. Statement-level AFTER TRUNCATE marker, because '
  'row-level triggers do NOT fire on TRUNCATE, which would otherwise erase every curated '
  'status with no trace. Records the event; does not block it.';

drop trigger if exists property_status_truncate_log on core.property;
create trigger property_status_truncate_log
  after truncate on core.property
  for each statement execute function temp_status_watch.record_truncate('property');

drop trigger if exists licensor_status_truncate_log on core.licensor;
create trigger licensor_status_truncate_log
  after truncate on core.licensor
  for each statement execute function temp_status_watch.record_truncate('licensor');

alter table core.property enable always trigger property_status_truncate_log;
alter table core.licensor enable always trigger licensor_status_truncate_log;

-- The temporary tables themselves: TRUNCATE is blocked, like UPDATE and DELETE.
-- reject_mutation() raises unconditionally and reports tg_op, so it serves here unchanged.
drop trigger if exists status_change_log_no_truncate on temp_status_watch.status_change_log;
create trigger status_change_log_no_truncate
  before truncate on temp_status_watch.status_change_log
  for each statement execute function temp_status_watch.reject_mutation();

drop trigger if exists status_snapshot_no_truncate on temp_status_watch.status_snapshot;
create trigger status_snapshot_no_truncate
  before truncate on temp_status_watch.status_snapshot
  for each statement execute function temp_status_watch.reject_mutation();

-- =====================================================================================
-- FINDING 3 (adopted) — a direct connection can FORGE a JWT identity
-- =====================================================================================
-- GLM, verbatim: "`auth.uid()`/`auth.role()` read the `request.jwt.claims` GUC — a two-part
-- custom setting with no superuser restriction. Any session can
-- `set local request.jwt.claims='{"role":"service_role","sub":"<real user uuid>"}'`. Then
-- `auth.uid()` returns the forged uuid, the CASE labels the row `'signed_in_user'`, and
-- `jwt_uid`/`jwt_role` record the impersonated identity. An auditor reads it as a specific
-- human."
--
-- Verified and correct. request.jwt.claims is an ordinary customised GUC; anyone holding a
-- direct database connection can set it, and the original CASE trusted auth.uid() alone.
-- This is precisely the failure this schema was built to prevent — an automated actor
-- producing a row an auditor reads as a person — so it is fixed rather than documented.
--
-- The fix is structural, not another heuristic: a genuine end-user request arrives through
-- PostgREST, which validates the JWT and connects as `authenticator`/`authenticated`, NEVER
-- as `postgres` or `supabase_admin`. A JWT subject presented on an admin connection is
-- therefore inherently suspect, and now gets its own loud label instead of being laundered
-- into 'signed_in_user'.

create or replace function temp_status_watch.derive_actor_kind(p_uid uuid, p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- A JWT subject presented on a direct/admin connection is NOT evidence of a person:
    -- request.jwt.claims is a settable GUC, so such a connection can mint any subject.
    when p_uid is not null
     and current_user in ('postgres', 'supabase_admin')  then 'claimed_jwt_on_admin_connection'
    when p_uid is not null                               then 'signed_in_user'
    when p_role = 'service_role'                         then 'service_role_automation'
    when p_role = 'anon'                                 then 'anonymous'
    when current_user in ('supabase_admin', 'supabase_auth_admin',
                          'authenticator', 'service_role') then 'privileged_or_service_connection'
    else 'direct_db_connection_unattributed'
  end;
$$;

comment on function temp_status_watch.derive_actor_kind(uuid, text) is
  'TEMPORARY — dropped with the schema. Derives actor_kind from connection facts ONLY; '
  'nothing here is supplied by the caller. Note the first branch: a JWT subject arriving on '
  'a postgres/supabase_admin connection is labelled claimed_jwt_on_admin_connection, NOT '
  'signed_in_user, because request.jwt.claims is a settable GUC and such a connection can '
  'mint any subject (GLM 5.2 review, 2026-08-03). A NULL role never grants a label — it '
  'falls through to the least-trusting one.';

-- Re-point the row-level recorder at the shared, hardened derivation.
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

  begin
    v_uid  := auth.uid();
    v_role := auth.role();
  exception when others then
    v_uid := null; v_role := null;
  end;

  insert into temp_status_watch.status_change_log (
    entity_type, entity_id, entity_name, entity_code, change_kind,
    old_status, new_status,
    actor_kind, db_current_user, db_session_user, jwt_uid, jwt_role,
    application_name, statement_prefix, txid
  ) values (
    v_entity_type, v_id, v_name, v_code, v_kind,
    v_old, v_new,
    temp_status_watch.derive_actor_kind(v_uid, v_role),
    current_user, session_user, v_uid, v_role,
    nullif(current_setting('application_name', true), ''),
    left(coalesce(current_query(), ''), 100),
    txid_current()
  );

  return null;
end;
$$;

-- =====================================================================================
-- FINDING 4 (adopted) — the record was readable by every signed-in user
-- =====================================================================================
-- GLM, verbatim: "`grant select … on status_change_log … to authenticated` exposes
-- `actor_kind`, `db_current_user`, `db_session_user`, `jwt_uid`, `application_name`,
-- `statement_prefix` to every signed-in app user. Too broad for a security log […]
-- `statement_prefix` leaks SQL (first 100 chars, may contain UUIDs/values)."
--
-- Correct, and the grant bought nothing: `temp_status_watch` is NOT in pgrst.db_schemas
-- (AGENTS.md §8.1 — exposed schemas are public, graphql_public, api, crm, pim, core, app),
-- so `authenticated` could never reach it through PostgREST anyway. Removing it costs no
-- capability and removes a standing surface.

revoke select on temp_status_watch.status_snapshot,
                 temp_status_watch.status_change_log,
                 temp_status_watch.what_was_inactive_before,
                 temp_status_watch.status_changes_since_snapshot,
                 temp_status_watch.status_change_history
  from authenticated;
revoke usage on schema temp_status_watch from authenticated;

-- =====================================================================================
-- FINDING 5 (adopted as documentation) — application_name / statement_prefix are
-- caller-controlled
-- =====================================================================================
-- GLM, verbatim: "`application_name` and `statement_prefix` are caller-controlled free
-- text. The 'no free-text changed-by column' claim is partially undermined — an automated
-- direct-connection actor can still craft human-looking signal in those columns."
--
-- True as stated, and worth labelling, though it is a weaker claim than it sounds: neither
-- column is presented as identity, and `actor_kind` — the field an auditor reads for "who"
-- — cannot be written by the caller at all. The honest fix is to say so in the database.

comment on column temp_status_watch.status_change_log.application_name is
  'CALLER-CONTROLLED. A client may set application_name to anything, including a human '
  'name. This is a diagnostic hint, NEVER identity. Read actor_kind for who acted.';
comment on column temp_status_watch.status_change_log.statement_prefix is
  'CALLER-CONTROLLED, first 100 chars of the top-level statement. Diagnostic only, NEVER '
  'identity, and may contain literal values — do not widen SELECT on this table.';
comment on column temp_status_watch.status_change_log.entity_id is
  'NULL only on a change_kind = ''truncate'' marker row, which covers the whole table.';
