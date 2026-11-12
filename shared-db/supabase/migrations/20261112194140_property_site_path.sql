-- shared-db#6150 — plan_mg06_licensor_site_path.md steps 2-3.
-- Each ColdLion MG06 value (licensed Property) keeps a short display name; this table
-- stores, per property and licensor site, the exact on-site path an AI clicks when it
-- fills a licensor submission form, e.g. MICKEY MOUSE -> Disney OPA
-- "Mickey Mouse Family" > character "Mickey Mouse". Owner ruling 2026-11-11: short
-- display name, full site path in the backend.
-- Keyed by core.property.id (plan §8 preference). One property may have several rows.
-- Site ids are stored with names because names repeat across levels on OPA.
-- Access: authenticated may read (RLS policy); only service_role writes.
-- No data loaded here (step 6 is a separate change). Purely additive.
-- Rollback: drop function api.mg06_site_path(uuid, text); drop table core.property_site_path.

create table core.property_site_path (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references core.property (id) on delete cascade,
  licensor_site text not null
    check (licensor_site in ('disney_opa', 'wb', 'nbcu', 'sega', 'pmt_trackerplus')),
  site_property_name text not null check (btrim(site_property_name) <> ''),
  site_property_id text null,
  site_character_name text null check (site_character_name is null or btrim(site_character_name) <> ''),
  site_character_id text null,
  ordinal integer not null default 1 check (ordinal >= 1),
  source_evidence text not null check (btrim(source_evidence) <> ''),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index property_site_path_path_key on core.property_site_path
  (property_id, licensor_site, site_property_name, coalesce(site_character_name, ''));
create index property_site_path_lookup_idx on core.property_site_path
  (property_id, licensor_site) where is_current;

comment on table core.property_site_path is
  'Exact licensor-site path (site property, optional character) per Property/MG06 value, for AI-filled licensor submissions (shared-db#6150).';

create trigger set_updated_at before update on core.property_site_path
  for each row execute function app.set_updated_at();

alter table core.property_site_path enable row level security;
revoke all on table core.property_site_path from anon, authenticated;
grant select on table core.property_site_path to authenticated;
grant select, insert, update, delete on table core.property_site_path to service_role;

create policy property_site_path_read on core.property_site_path
  for select to authenticated using (true);

create or replace function api.mg06_site_path(p_property_id uuid, p_licensor_site text)
returns table (
  site_property_name text,
  site_property_id text,
  site_character_name text,
  site_character_id text
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select p.site_property_name, p.site_property_id, p.site_character_name, p.site_character_id
  from core.property_site_path p
  where p.property_id = p_property_id
    and p.licensor_site = p_licensor_site
    and p.is_current
  order by p.ordinal, p.site_property_name, p.site_character_name nulls first;
$fn$;

comment on function api.mg06_site_path(uuid, text) is
  'Current licensor-site path rows for one Property/MG06 value on one licensor site (shared-db#6150).';

revoke all on function api.mg06_site_path(uuid, text) from public, anon;
grant execute on function api.mg06_site_path(uuid, text) to authenticated, service_role;
