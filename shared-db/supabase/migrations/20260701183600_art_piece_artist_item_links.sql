-- Normalize art-piece attribution and support many item/SKU links.
--
-- `plm.art_piece` is the shared operational art-piece record imported from the
-- PLM/item-master domain. DAM can read it through RLS and the api view below.
-- Keep the legacy `artist` text column for import compatibility; use
-- `artist_id` for the approved app-level artist lookup.

alter table plm.art_piece
  add column if not exists artist_id uuid references core.artist(id) on delete set null;

create index if not exists plm_art_piece_artist_idx
  on plm.art_piece (artist_id);

create table if not exists plm.art_piece_item (
  id uuid primary key default gen_random_uuid(),
  art_piece_id uuid not null references plm.art_piece(id) on delete cascade,
  item_id uuid references plm.item(id) on delete set null,
  sku text,
  normalized_sku text generated always as (upper(regexp_replace(coalesce(sku, ''), '[^A-Za-z0-9]+', '', 'g'))) stored,
  style_number text,
  normalized_style_number text generated always as (upper(regexp_replace(coalesce(style_number, ''), '[^A-Za-z0-9]+', '', 'g'))) stored,
  source_system text,
  source_id text,
  confidence app.source_confidence not null default 'verified',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint art_piece_item_has_item_or_sku check (
    item_id is not null
    or nullif(btrim(coalesce(sku, '')), '') is not null
    or nullif(btrim(coalesce(style_number, '')), '') is not null
  ),
  unique nulls not distinct (art_piece_id, item_id, normalized_sku, normalized_style_number, source_system, source_id)
);

create index if not exists plm_art_piece_item_art_piece_idx
  on plm.art_piece_item (art_piece_id);

create index if not exists plm_art_piece_item_item_idx
  on plm.art_piece_item (item_id);

create index if not exists plm_art_piece_item_sku_idx
  on plm.art_piece_item (normalized_sku)
  where nullif(normalized_sku, '') is not null;

create index if not exists plm_art_piece_item_style_number_idx
  on plm.art_piece_item (normalized_style_number)
  where nullif(normalized_style_number, '') is not null;

alter table plm.art_piece_item enable row level security;

drop policy if exists shared_read on plm.art_piece_item;
create policy shared_read on plm.art_piece_item
  for select to authenticated
  using ((select app.has_any_role(array['administrator', 'sales', 'licensing', 'designer', 'viewer', 'vendor']::app.app_role[])));

drop policy if exists admin_write on plm.art_piece_item;
create policy admin_write on plm.art_piece_item
  for all to authenticated
  using ((select app.has_role('administrator')))
  with check ((select app.has_role('administrator')));

drop policy if exists service_role_write on plm.art_piece_item;
create policy service_role_write on plm.art_piece_item
  for all to service_role
  using (true)
  with check (true);

create trigger set_updated_at before update on plm.art_piece_item
  for each row execute function app.set_updated_at();

grant select on plm.art_piece_item to authenticated;
grant all on plm.art_piece_item to service_role;

create or replace view api.art_piece_library
with (security_invoker = true)
as
select
  ap.id,
  ap.name,
  ap.art_type,
  ap.artist as legacy_artist_text,
  ap.artist_id,
  ar.name as artist_name,
  ap.status,
  ap.source_system,
  ap.source_id,
  ap.raw,
  ap.created_at,
  ap.updated_at,
  coalesce(
    jsonb_agg(
      distinct jsonb_strip_nulls(jsonb_build_object(
        'art_piece_item_id', api.id,
        'item_id', api.item_id,
        'sku', api.sku,
        'style_number', coalesce(api.style_number, i.style_number),
        'item_number', i.item_number,
        'confidence', api.confidence
      ))
    ) filter (where api.id is not null),
    '[]'::jsonb
  ) as linked_items
from plm.art_piece ap
left join core.artist ar on ar.id = ap.artist_id
left join plm.art_piece_item api on api.art_piece_id = ap.id
left join plm.item i on i.id = api.item_id
group by
  ap.id,
  ap.name,
  ap.art_type,
  ap.artist,
  ap.artist_id,
  ar.name,
  ap.status,
  ap.source_system,
  ap.source_id,
  ap.raw,
  ap.created_at,
  ap.updated_at;

grant select on api.art_piece_library to authenticated;

comment on column plm.art_piece.artist_id is 'Approved shared artist lookup for this art piece. Legacy plm.art_piece.artist is retained as raw/import text.';
comment on table plm.art_piece_item is 'Junction table linking one PLM art piece to many item/SKU/style records. Used by DAM and other apps to attribute artwork without misusing designer fields.';
comment on view api.art_piece_library is 'RLS-safe art piece read model for apps such as DAM, including approved artist name and linked SKU/item/style references.';
