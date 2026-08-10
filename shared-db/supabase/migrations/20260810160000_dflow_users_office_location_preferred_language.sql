-- DesignFlow staff office + preferred language (issue #690, impl #692).
--
-- WHY: Sample Tracking must default Ningbo-office staff to Simplified Chinese
-- with a per-person override, and the application must NEVER infer office or
-- language from email, name, IP address, browser language, or time zone. That
-- requires explicit stored fields on the authoritative staff-user table.
--
-- AUTHORITATIVE TABLE: dflow.users. designflow-backend's GET /api/user/me
-- (services/user.service.js) branches on role: only role === 'vendor' reads
-- dflow.vendor; every staff user reads dflow.users. app.profile is the shared
-- Supabase-Auth identity and DesignFlow never reads it.
--
-- VALUE CASING DECISION (orchestrator, 2026-08-10) — consumers must hard-code
-- exactly these strings:
--   office_location    -> 'ningbo' | 'nyc'   (LOWERCASE)
--   preferred_language -> 'en' | 'zh-CN'     (BCP-47, as written)
-- Issue #690 wrote the offices as `Ningbo`/`NYC`, but it also asked for
-- canonical conventions where they differ. The existing Sample Tracking
-- vocabulary in this very schema is lowercase — see
-- 20260722221300_sample_tracking_shipment_intent.sql,
-- 20260724040000_sample_shipment_line_route_legs_explicit.sql:32-34, and
-- 20260723230000 which maps 'ningbo' -> 'Ningbo Ofc Inventory' for display.
-- Two casings for one concept in one schema is a data-quality trap, so the
-- stored values stay lowercase and display strings are mapped in the UI layer.
--
-- SHAPE: text + CHECK, not an enum type. That is the repo precedent for value
-- lists in dflow, and a Postgres enum would additionally require a matching
-- Sequelize DataTypes.ENUM in the app repo, which drifts.
--
-- SCOPE: two nullable columns, two CHECK constraints, two column comments, and
-- a startup-contract assertion. Deliberately NOT done here:
--   * no backfill of any kind — #690 forbids guessing anyone's office; office
--     assignment happens later via DesignFlow's Manage Users workflow from an
--     authoritative roster;
--   * no NOT NULL, no default, no index (both columns are two-valued);
--   * no GRANT/REVOKE/RLS — there are no grants or RLS on any dflow.* object;
--     the backend connects as the owning DB role through Sequelize and a new
--     column inherits table privileges;
--   * no api view and no pgrst.db_schemas change — dflow is not PostgREST
--     exposed and must not become so (dflow.users holds a `passw` column);
--   * no primary key or unique constraint — dflow.users deliberately has none
--     (legacy Sequelize), and dflow."productUserAssignment" FKs to
--     dflow.users(id) via the identity sequence's unique index.

set lock_timeout = '5s';
set statement_timeout = '2min';

alter table dflow.users
  add column if not exists office_location text;

alter table dflow.users
  add column if not exists preferred_language text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'dflow.users'::regclass
      and conname = 'users_office_location_check'
  ) then
    alter table dflow.users
      add constraint users_office_location_check
      check (office_location is null or office_location in ('ningbo', 'nyc'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'dflow.users'::regclass
      and conname = 'users_preferred_language_check'
  ) then
    alter table dflow.users
      add constraint users_preferred_language_check
      check (preferred_language is null or preferred_language in ('en', 'zh-CN'));
  end if;
end
$$;

comment on column dflow.users.office_location is
  'DesignFlow staff office assignment. Lowercase canonical values ''ningbo'' or ''nyc'', or NULL when unassigned. Set explicitly through the Manage Users workflow only — never inferred from email, name, IP, browser language, or time zone. Display strings are mapped in the UI layer.';

comment on column dflow.users.preferred_language is
  'Per-user UI language override for Sample Tracking. BCP-47 values ''en'' or ''zh-CN'', or NULL for no override. Resolution rule: coalesce(preferred_language, case when office_location = ''ningbo'' then ''zh-CN'' else ''en'' end).';

-- Register the two columns in the canonical dflow.users startup contract.
-- 20260717163500_reconcile_dflow_backend_startup_contract.sql owns that list
-- and raises on drift; it is an applied migration and must never be edited, so
-- the extension of the expected list is asserted forward here, mirroring how
-- profile_photo / graph_photo / graph_photo_synced_at were registered.
do $$
declare
  mismatch record;
begin
  for mismatch in
    with expected(table_name, column_name, data_type, max_length) as (
      values
        ('users', 'office_location', 'text', null::integer),
        ('users', 'preferred_language', 'text', null::integer)
    )
    select expected.*, actual.data_type as actual_type,
           actual.character_maximum_length as actual_max_length
    from expected
    left join information_schema.columns actual
      on actual.table_schema = 'dflow'
     and actual.table_name = expected.table_name
     and actual.column_name = expected.column_name
    where actual.column_name is null
       or actual.data_type <> expected.data_type
       or actual.character_maximum_length is distinct from expected.max_length
  loop
    raise exception 'dflow %.% definition mismatch: expected %(%), found %(%)',
      mismatch.table_name, mismatch.column_name, mismatch.data_type,
      mismatch.max_length, mismatch.actual_type, mismatch.actual_max_length;
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'dflow.users'::regclass
      and conname = 'users_office_location_check'
  ) then
    raise exception 'dflow.users_office_location_check is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'dflow.users'::regclass
      and conname = 'users_preferred_language_check'
  ) then
    raise exception 'dflow.users_preferred_language_check is missing';
  end if;
end
$$;
