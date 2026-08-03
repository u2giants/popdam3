You are a senior Postgres/Supabase security reviewer. REVIEW ONLY — do not edit, commit,
push, delete, or run anything. Do not explore the repository; everything you need is below.

CONTEXT (short):
`core.property.status` and `core.licensor.status` are curated BY HAND (enum values:
active / inactive / potential). A production function `plm.import_master_data(jsonb, jsonb)`
force-sets those columns to 'active' on every matched row of every run, silently reverting
human decisions. There is NO audit trail today. This migration adds (a) a point-in-time
snapshot and (b) a running change record, in a new schema deliberately labelled temporary.
It must change no status value.

Known past defects in this codebase that this design claims to avoid:
- A guard shaped `if not ( ... or auth.role() = 'service_role' ) then raise ...` never fires
  when auth.role() is NULL (which it is inside a migration) -> silently permissive.
- A BEFORE trigger reading a GENERATED ... STORED column always reads NULL, so the guard
  does nothing.
- A free-text `reset_by` audit field that an automated agent filled in with a human-looking
  name, misleading an auditor.

ANSWER EXACTLY THESE FOUR QUESTIONS, each with a clear verdict and, where applicable, the
exact line or expression at fault:

1. Can a status change on core.property or core.licensor BYPASS the change record?
   List every bypass you can find.
2. Can the actor fields be FORGED — can an automated/service caller cause a row that an
   auditor would read as a human decision?
3. Does the append-only guard actually fire when auth.role() is NULL? Is there ANY
   NULL-permissive expression anywhere in this SQL?
4. Would this table and its triggers SURVIVE plm.import_master_data being revived and run
   — i.e. does anything here break the import, or does the import evade the record?

Then list any other correctness or security defect you find. Be concise and specific.

--- SQL BEGINS ---
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

  begin
    v_uid  := auth.uid();
    v_role := auth.role();
  exception when others then
    v_uid := null; v_role := null;
  end;

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
--- SQL ENDS ---
