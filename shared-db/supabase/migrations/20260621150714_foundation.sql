-- Unified POP shared database foundation.
-- This migration is intended for review/rehearsal first; do not apply to production
-- until source dumps, RLS roles, and cutover order are approved.

create schema if not exists app;
create schema if not exists core;
create schema if not exists dam;
create schema if not exists pim;
create schema if not exists crm;
create schema if not exists plm;
create schema if not exists ingest;
create schema if not exists api;
create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create type app.app_name as enum ('dam', 'crm', 'pm', 'plm', 'admin');
create type app.app_role as enum ('administrator', 'sales', 'licensing', 'designer', 'viewer', 'vendor');
create type app.entity_status as enum ('active', 'inactive', 'archived', 'deleted');
create type app.source_confidence as enum ('verified', 'probable', 'possible', 'unmatched', 'rejected');
create type app.file_storage_provider as enum ('supabase', 'spaces', 'directus', 'external', 'local');
create type ingest.sync_status as enum ('pending', 'running', 'succeeded', 'failed', 'cancelled');

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app.jwt_role_names()
returns text[]
language sql
stable
as $$
  select coalesce(
    array(
      select lower(value::text)
      from jsonb_array_elements_text(
        coalesce(
          nullif(auth.jwt() -> 'app_metadata' -> 'roles', 'null'::jsonb),
          '[]'::jsonb
        )
      ) as value
    ),
    array[]::text[]
  );
$$;

comment on schema app is 'Shared identity-adjacent app data, collaboration, files, and cross-domain support tables.';
comment on schema core is 'Canonical shared business objects used by DAM, CRM, PM, and PLM.';
comment on schema dam is 'Digital asset management, style groups, style guides, and DAM operational queues.';
comment on schema pim is 'PM/PIM projects, products, designs, workflow, orders, and saved views.';
comment on schema crm is 'CRM account workflow, opportunities, communications, notes, tasks, and approvals.';
comment on schema plm is 'Operational PLM item master, production, licensing, RFQ, and ERP reference data.';
comment on schema ingest is 'Raw imports, sync runs, snapshots, source rows, and dedupe reports.';
comment on schema api is 'Stable browser-facing views and RPC contracts.';
