-- Issue #6269. DesignFlow sandbox ONLY (xupnyeifmpsacrqahwwm).
-- Never apply to shared production or shared preview: there 20261113183820 is the change.
-- The sandbox lacks the licensor-scrape landing tables that 20261113183820 hooks into,
-- so this gives the sandbox only what its screens read: the four name columns on
-- core.property and api.property_names, same names and same view shape. The licensor
-- submission name stays NULL here (no scrape tables to copy it from).
-- derived-from: none

alter table core.property
  add column if not exists submission_source text,
  add column if not exists submission_property_id text,
  add column if not exists submission_property_name text,
  add column if not exists short_name text,
  add column if not exists nickname text;

comment on column core.property.nickname is 'User-facing name shown in POP apps.';
comment on column core.property.short_name is 'Shortened property name used in item descriptions (POP-maintained).';

create schema if not exists api;

create or replace view api.property_names with (security_invoker = false, security_barrier = true) as
select p.id,
       p.code,
       l.code as licensor_code,
       l.name as licensor_name,
       p.name,
       p.nickname,
       p.short_name,
       p.submission_source,
       p.submission_property_id,
       p.submission_property_name,
       coalesce(nullif(btrim(p.nickname), ''), p.name) as display_name,
       coalesce(nullif(btrim(p.short_name), ''), nullif(btrim(p.nickname), ''), p.name) as description_name,
       p.status
  from core.property p
  left join core.licensor l on l.id = p.licensor_id;

revoke all on api.property_names from public, anon;
grant select on api.property_names to authenticated, service_role;
