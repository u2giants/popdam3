-- core.customer_alias — alternate names a customer is known by.
--
-- Why: merging duplicate customers destroys the losing names, but those names are
-- how people actually find the record. Real cases driving this (2026-07-16):
--   * TJX Canada is variously called "Winners" and "HomeSense"
--   * Burlington's old, old name was "Modecraft" (hence its Coldlion MOD* codes)
--   * Directus/DesignFlow carry abbreviations ("B&N", "BAM", "UPD", "Osjl") for
--     records whose canonical name is spelled out
-- Aliases keep every one of those searchable after the canonical row is merged.
--
-- Shape: one row per (customer, alias). normalized_alias is generated the same way
-- core.customer.normalized_name is, so alias lookups and name lookups agree. A trigram
-- index supports fuzzy search, which is exactly how the dedupe work finds candidates.

create table core.customer_alias (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references core.customer(id) on delete cascade,
  alias            text not null,
  normalized_alias text generated always as (lower(regexp_replace(alias, '\s+', ' ', 'g'))) stored,
  alias_type       text not null default 'other',
  source_system    text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint customer_alias_alias_not_blank check (length(btrim(alias)) > 0),
  constraint customer_alias_type_check check (
    alias_type in ('legacy_name','banner','dba','erp_name','abbreviation','other')
  )
);

create unique index customer_alias_customer_norm_key on core.customer_alias (customer_id, normalized_alias);
create index customer_alias_customer_idx on core.customer_alias (customer_id);
create index customer_alias_norm_idx on core.customer_alias (normalized_alias);
create index customer_alias_trgm_idx on core.customer_alias using gin (normalized_alias extensions.gin_trgm_ops);

create trigger set_updated_at before update on core.customer_alias
  for each row execute function app.set_updated_at();

alter table core.customer_alias enable row level security;

-- RLS mirrors core.customer exactly: admins write, the shared roles read.
create policy admin_write on core.customer_alias
  for all to authenticated
  using (app.has_role('administrator'))
  with check (app.has_role('administrator'));

create policy shared_read on core.customer_alias
  for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));

grant select on core.customer_alias to authenticated;
grant all on core.customer_alias to service_role;

comment on table core.customer_alias is
  'Alternate names a core.customer is known by (legacy names, banners, DBAs, ERP spellings, abbreviations). Lets duplicate customers be merged without losing the searchable names of the records absorbed. normalized_alias matches core.customer.normalized_name normalization; trigram-indexed for fuzzy candidate search.';
comment on column core.customer_alias.alias_type is
  'legacy_name (e.g. Burlington <- Modecraft) | banner (TJX Canada <- Winners/HomeSense) | dba | erp_name (the Coldlion spelling) | abbreviation (B&N, UPD) | other';
comment on column core.customer_alias.source_system is
  'Where the alias came from: coldlion | designflow_plm | directus | manual. Free text, not enforced.';
