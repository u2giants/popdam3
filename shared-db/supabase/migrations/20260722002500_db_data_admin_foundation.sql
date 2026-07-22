-- DB Data Admin foundation: explicit authorization, immutable audit storage,
-- and per-user grid state. Additive only; no existing application contract is
-- replaced and browser roles receive no direct table privileges.

create or replace function app.has_explicit_app_access(required_app app.app_name)
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
    from app.app_access aa
    where aa.profile_id = app.current_profile_id()
      and aa.app = required_app
      and aa.revoked_at is null
  );
$$;

comment on function app.has_explicit_app_access(app.app_name) is
  'True only for a current, non-revoked app_access row. Unlike has_app_access, administrators do not receive an implicit grant.';

revoke all on function app.has_explicit_app_access(app.app_name) from public;
grant execute on function app.has_explicit_app_access(app.app_name) to authenticated, service_role;

create table app.db_data_admin_audit_event (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  operation_item_key text not null default 'primary'
    check (btrim(operation_item_key) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id uuid not null,
  action text not null check (btrim(action) <> ''),
  old_snapshot jsonb
    check (old_snapshot is null or jsonb_typeof(old_snapshot) = 'object'),
  new_snapshot jsonb
    check (new_snapshot is null or jsonb_typeof(new_snapshot) = 'object'),
  reason text not null check (btrim(reason) <> ''),
  actor_profile_id uuid,
  actor_user_id uuid,
  occurred_at timestamptz not null default now(),
  merge_survivor_id uuid,
  merge_loser_id uuid,
  succeeded boolean not null,
  error_code text,
  error_detail jsonb
    check (error_detail is null or jsonb_typeof(error_detail) = 'object'),
  constraint db_data_admin_audit_operation_item_unique
    unique (operation_id, operation_item_key),
  constraint db_data_admin_audit_merge_pair_check
    check (
      (merge_survivor_id is null and merge_loser_id is null)
      or (
        merge_survivor_id is not null
        and merge_loser_id is not null
        and merge_survivor_id <> merge_loser_id
      )
    ),
  constraint db_data_admin_audit_result_check
    check (
      (succeeded and error_code is null and error_detail is null)
      or not succeeded
    )
);

comment on table app.db_data_admin_audit_event is
  'Immutable DB Data Admin operation ledger. Rows are written and read only through protected API functions; retention is indefinite.';
comment on column app.db_data_admin_audit_event.operation_item_key is
  'Stable item key within an idempotent operation; primary for a single-record operation and a record-specific key for bulk work.';
comment on column app.db_data_admin_audit_event.old_snapshot is
  'Approved business fields before the operation; never unrestricted source payloads.';
comment on column app.db_data_admin_audit_event.new_snapshot is
  'Approved business fields after the operation; never unrestricted source payloads.';

create index db_data_admin_audit_entity_occurred_idx
  on app.db_data_admin_audit_event (entity_type, entity_id, occurred_at desc);
create index db_data_admin_audit_actor_occurred_idx
  on app.db_data_admin_audit_event (actor_profile_id, occurred_at desc);
create index db_data_admin_audit_occurred_idx
  on app.db_data_admin_audit_event (occurred_at desc, id desc);

create or replace function app.reject_db_data_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = app, public
as $$
begin
  raise exception 'db_data_admin_audit_event is immutable'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger db_data_admin_audit_event_immutable
before update or delete on app.db_data_admin_audit_event
for each row execute function app.reject_db_data_admin_audit_mutation();

alter table app.db_data_admin_audit_event enable row level security;
revoke all on app.db_data_admin_audit_event from public, anon, authenticated;

create table app.db_data_admin_grid_state (
  profile_id uuid not null references app.profile(id) on delete cascade,
  entity_type text not null check (btrim(entity_type) <> ''),
  view_key text not null check (btrim(view_key) <> ''),
  state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(state) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, entity_type, view_key)
);

comment on table app.db_data_admin_grid_state is
  'Saved DB Data Admin grid filters, sorting, columns, widths, and visibility. Browser access is only through protected owner-scoped API functions.';

create trigger set_updated_at before update on app.db_data_admin_grid_state
for each row execute function app.set_updated_at();

alter table app.db_data_admin_grid_state enable row level security;
revoke all on app.db_data_admin_grid_state from public, anon, authenticated;

-- Functions are not browser RPCs. Keep the trigger helper private to table
-- owners and the later protected API functions.
revoke all on function app.reject_db_data_admin_audit_mutation() from public;

