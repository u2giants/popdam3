-- Characters and style guides — Phase 2: additive canonical schema for the style axis.
--
-- Plan:  fix_characters_style_guides.md  §"Phase 2 — additive schema on preview"
-- Model: docs/style-guides-characters-and-royalties.md  §5A
--
-- Ownership (axis 1) is linear and already correct:
--   core.licensor -> core.property -> core.character   (one property per character)
-- Style (axis 2) is many-to-many and does not exist yet. This migration adds it:
--   core.style_guide            — the style guide NAME and its links to licensor/property
--   core.style_guide_character  — the M:N bridge the 9,622 legacy rows become
--
-- ADDITIVE ONLY. Creates two empty tables plus their indexes, trigger, RLS and grants.
-- Touches no existing object. No backfill here — that is Phase 3, preview only.
--
-- Deliberate omissions (do not "fix" these):
--   * No likeness column. Talent likeness lives on the app-owned style guide FILE row
--     (dam.style_guide_file), per model doc §2.2 / §5A.0a — not on the shared catalogue.
--   * property_id is NULLABLE. Some style guides have no property code at all
--     (Luca, Kim Possible, Inside Out) and no placeholder property may be invented
--     for them, per model doc §5A.0 rule 3.
--   * Sub-style guides are a self-reference on this table, NOT a level between
--     property and character (model doc §5A key points).

create table if not exists core.style_guide (
  id uuid primary key default gen_random_uuid(),
  licensor_id uuid references core.licensor(id) on delete set null,
  property_id uuid references core.property(id) on delete set null,
  parent_style_guide_id uuid references core.style_guide(id) on delete set null,
  name text not null,
  code text,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint style_guide_not_own_parent
    check (parent_style_guide_id is null or parent_style_guide_id <> id),
  unique nulls not distinct (licensor_id, name)
);

-- Codes are optional and only unique within a licensor when present.
create unique index if not exists style_guide_licensor_code_key
  on core.style_guide (licensor_id, code)
  where code is not null;

create index if not exists idx_style_guide_licensor
  on core.style_guide (licensor_id)
  where licensor_id is not null;

create index if not exists idx_style_guide_property
  on core.style_guide (property_id)
  where property_id is not null;

create index if not exists idx_style_guide_parent
  on core.style_guide (parent_style_guide_id)
  where parent_style_guide_id is not null;

create index if not exists idx_style_guide_status_name
  on core.style_guide (status, name);

drop trigger if exists set_updated_at on core.style_guide;
create trigger set_updated_at before update on core.style_guide
  for each row execute function app.set_updated_at();

-- The M:N bridge. THIS is where a character's multiplicity lives:
-- Batman = 1 core.character row + N style_guide_character rows.
-- No updated_at: an edge either exists or it does not, matching dam.asset_character.
create table if not exists core.style_guide_character (
  style_guide_id uuid not null references core.style_guide(id) on delete cascade,
  character_id uuid not null references core.character(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (style_guide_id, character_id)
);

-- Reverse lookup: "which style guides does this character appear in?"
create index if not exists idx_style_guide_character_character
  on core.style_guide_character (character_id);

alter table core.style_guide enable row level security;
alter table core.style_guide_character enable row level security;

drop policy if exists shared_read on core.style_guide;
create policy shared_read on core.style_guide
  for select to authenticated
  using (
    app.has_any_role(array[
      'administrator',
      'sales',
      'licensing',
      'designer',
      'viewer',
      'vendor'
    ]::app.app_role[])
  );

drop policy if exists admin_write on core.style_guide;
create policy admin_write on core.style_guide
  for all to authenticated
  using (app.has_role('administrator'))
  with check (app.has_role('administrator'));

drop policy if exists shared_read on core.style_guide_character;
create policy shared_read on core.style_guide_character
  for select to authenticated
  using (
    app.has_any_role(array[
      'administrator',
      'sales',
      'licensing',
      'designer',
      'viewer',
      'vendor'
    ]::app.app_role[])
  );

drop policy if exists admin_write on core.style_guide_character;
create policy admin_write on core.style_guide_character
  for all to authenticated
  using (app.has_role('administrator'))
  with check (app.has_role('administrator'));

-- An RLS policy is not a GRANT (AGENTS.md §11). Both are required.
grant select on table core.style_guide to authenticated;
grant all on table core.style_guide to service_role;

grant select on table core.style_guide_character to authenticated;
grant all on table core.style_guide_character to service_role;

comment on table core.style_guide is
  'Canonical shared style guide NAMES and their links to licensor/property. Axis 2 of the taxonomy: a style guide holds many characters and a character appears in many style guides. Not a level between property and character. Style guide FILES are app-owned in dam.style_guide_file.';

comment on column core.style_guide.property_id is
  'Owning property, NULLABLE. Null means the title has no property code in ColdLion (e.g. Luca, Kim Possible, Inside Out) or the mapping is unresolved. Never invent a placeholder property to fill this.';

comment on column core.style_guide.parent_style_guide_id is
  'Self-reference for sub-style guides. A sub-style guide belongs to the same property as its parent.';

comment on table core.style_guide_character is
  'Many-to-many bridge between core.style_guide and core.character. The 9,622 legacy public.characters appearance rows become edges here; each edge must resolve to a single canonical character identity so the duplication is not recreated.';
