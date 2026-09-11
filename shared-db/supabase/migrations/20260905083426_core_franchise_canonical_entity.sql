-- core.franchise and core.franchise_alias -- the canonical Franchise entity.
-- Issue #2333 (structural successor to #1090). Claim issue #2387,
-- reserved version 20260905083426.
--
-- WHY THIS EXISTS
-- ---------------
-- A 2026-09-04 reconciliation of current `main` against production proved that a
-- canonical Franchise entity is absent. Franchise-shaped truth exists today only as
-- SOURCE-SPECIFIC landing evidence -- for example plm.pmt_franchise, which is keyed
-- (capture_id, franchise_source_id) and is deliberately scoped to one Paramount
-- capture. Landing evidence is not a canonical entity: it cannot be referenced across
-- applications, it disappears when a capture is superseded, and two licensors may use
-- the same small integer source id for entirely different franchises.
--
-- WHAT THIS IS NOT
-- ----------------
-- This migration is ADDITIVE ONLY. It creates two new tables and nothing else. It does
-- NOT alter core.licensor, core.property, core.character, any *_ext table, any shared
-- provenance table, or any Asset table, and it does NOT change any existing view,
-- function, policy or grant. It seeds NO rows: no curated licensing data is authorized
-- by #2333, and inventing franchise rows here would be exactly the ad-hoc Master Data
-- load that AGENTS.md 6.4 forbids.
--
-- IDENTITY MODEL
-- --------------
-- Identity is SOURCE-SCOPED, not name-scoped. A franchise is identified by the triple
-- (licensor_id, source_system, source_id). Licensor is part of the key because integer
-- source ids collide across licensors -- Disney and Sega both number from small
-- integers, so a bare source id join attributes one licensor's franchise to another.
-- Names are NOT unique and are NOT identity: two licensors may legitimately publish a
-- franchise of the same name, and the same franchise may be renamed at source.
--
-- ALIAS MODEL
-- -----------
-- core.franchise_alias resolves an observed string to a canonical franchise. Its
-- normalization is source-neutral: it reuses core.normalize_popsg_property_observation,
-- the repository's single frozen observation normalizer (contract
-- popsg-property-observation-v1), rather than adding a second, divergent one.
--
-- Alias uniqueness is scoped to the LICENSOR, not global and not to the franchise. The
-- same observed string under two different licensors is legitimate; the same observed
-- string resolving to two franchises of ONE licensor is an ambiguity that must be
-- refused at write time. licensor_id is therefore carried on the alias row and bound to
-- the parent by a COMPOSITE foreign key (franchise_id, licensor_id), so an alias can
-- never drift onto a franchise belonging to a different licensor, and re-parenting a
-- franchise can never silently re-license its aliases.

-- ---------------------------------------------------------------------------
-- 1. core.franchise
-- ---------------------------------------------------------------------------
create table if not exists core.franchise (
  id                uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT, matching core.licensor_alias: silently discarding canonical
  -- franchises because a licensor row was deleted is the kind of quiet loss this
  -- repository forbids. Every franchise belongs to exactly one licensor.
  licensor_id       uuid not null references core.licensor(id) on delete restrict,

  name              text not null,
  code              text,

  -- Source-scoped identity. source_system names the system the franchise was observed
  -- in ('paramount', 'wb_starlabs', 'nbcu', 'disney_opa', 'coldlion', 'manual', ...);
  -- source_id is that system's own key, kept as text so integer, GUID and slug keys all
  -- land without a lossy cast. A hand-curated franchise uses source_system 'manual' and
  -- a null source_id.
  source_system     text not null,
  source_id         text,
  source_evidence   text,

  -- Lifecycle, using the same enum every other core.* entity uses.
  status            app.entity_status not null default 'active',

  metadata          jsonb not null default '{}'::jsonb,

  -- Audit fields.
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        text,
  updated_by        text,

  constraint franchise_name_not_blank
    check (length(btrim(name)) > 0),

  -- A name that normalizes to nothing can never be matched by any observation, so it
  -- would be a permanently unreachable canonical row.
  constraint franchise_name_normalizes_not_blank
    check (length(core.normalize_popsg_property_observation(name)) > 0),

  constraint franchise_source_system_not_blank
    check (length(btrim(source_system)) > 0),

  -- A present source_id must be a real key, never an empty string masquerading as one.
  constraint franchise_source_id_not_blank
    check (source_id is null or length(btrim(source_id)) > 0),

  constraint franchise_code_not_blank
    check (code is null or length(btrim(code)) > 0)
);

-- Source-scoped identity. NULLS NOT DISTINCT so a licensor cannot accumulate many
-- 'manual' franchises that all claim the same null source key; a second hand-curated
-- franchise for the same licensor must carry a distinct source_id.
create unique index if not exists franchise_licensor_source_key
  on core.franchise (licensor_id, source_system, source_id) nulls not distinct;

-- Codes, where used, are unique within a licensor. PARTIAL, not NULLS NOT DISTINCT:
-- `code` is optional, so a NULLS NOT DISTINCT key would let a licensor hold exactly ONE
-- franchise without a code and refuse every later one. (core.property carries that
-- shape; it is not copied here on purpose.) Uniqueness of a real code is preserved --
-- only the meaningless "no code at all" collision is allowed.
create unique index if not exists franchise_licensor_code_key
  on core.franchise (licensor_id, code) where code is not null;

-- The target of core.franchise_alias's composite foreign key. It exists so an alias's
-- licensor_id is provably the parent franchise's licensor_id.
create unique index if not exists franchise_id_licensor_key
  on core.franchise (id, licensor_id);

create index if not exists franchise_licensor_idx
  on core.franchise (licensor_id);

create index if not exists franchise_status_idx
  on core.franchise (status);

create trigger set_updated_at before update on core.franchise
  for each row execute function app.set_updated_at();

alter table core.franchise enable row level security;

-- Read for the same role set every other core.* entity uses. There is deliberately no
-- write policy for `authenticated`: RLS and GRANTs independently keep browser roles
-- read-only, exactly as core.licensor_alias does.
create policy shared_read on core.franchise
  for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));

revoke all on core.franchise from public, anon, authenticated;
grant select on core.franchise to authenticated;
grant all    on core.franchise to service_role;

comment on table core.franchise is
  'Canonical Franchise entity (issue #2333, successor to #1090). Identity is source-scoped: '
  '(licensor_id, source_system, source_id). Licensor is part of the key because integer source '
  'ids collide across licensors. Names are descriptive, never identity. Source-specific landing '
  'evidence such as plm.pmt_franchise remains the raw record; this table is the cross-application '
  'canonical entity. Browser roles are read-only. No curated rows are seeded by the creating '
  'migration.';
comment on column core.franchise.source_system is
  'The system this franchise was observed in: paramount | wb_starlabs | nbcu | disney_opa | '
  'coldlion | manual. Free text, required, and part of the identity key.';
comment on column core.franchise.source_id is
  'That source system''s own key for the franchise, held as text so integer, GUID and slug keys '
  'all land without a lossy cast. Null only for hand-curated rows, and then unique per licensor.';
comment on column core.franchise.source_evidence is
  'Where the row came from: capture id, portal export, PR URL or decision record.';
comment on column core.franchise.status is
  'Lifecycle, using app.entity_status. Retiring a franchise is a status change, never a delete: '
  'aliases and downstream references must survive it.';

-- ---------------------------------------------------------------------------
-- 2. core.franchise_alias
-- ---------------------------------------------------------------------------
create table if not exists core.franchise_alias (
  id                uuid primary key default gen_random_uuid(),

  franchise_id      uuid not null,

  -- Denormalized on purpose: it is the scope of alias uniqueness AND the thing the
  -- composite foreign key below proves consistent with the parent.
  licensor_id       uuid not null,

  alias             text not null,
  normalized_alias  text generated always as
                      (core.normalize_popsg_property_observation(alias)) stored,

  source_system     text,
  evidence_notes    text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        text,
  updated_by        text,

  -- Licensor-safe integrity. Not two independent references: one composite reference,
  -- so (franchise, licensor) must be a pair that actually exists in core.franchise.
  constraint franchise_alias_franchise_fkey
    foreign key (franchise_id, licensor_id)
    references core.franchise (id, licensor_id) on delete restrict,

  constraint franchise_alias_alias_not_blank
    check (length(btrim(alias)) > 0),

  -- An alias that normalizes to nothing can never match an observation and would
  -- collide with every other such row on the unique index below. Also rejects '---'.
  constraint franchise_alias_normalized_not_blank
    check (length(core.normalize_popsg_property_observation(alias)) > 0)
);

-- The core safety property: within one licensor, a normalized observation may never
-- resolve to two different franchises. Scoped to the licensor rather than globally
-- because the same franchise name under a different licensor is legitimate, and
-- scoped no tighter than that because per-franchise uniqueness would allow exactly
-- the ambiguity this index exists to refuse.
create unique index if not exists franchise_alias_licensor_norm_key
  on core.franchise_alias (licensor_id, normalized_alias);

create index if not exists franchise_alias_franchise_idx
  on core.franchise_alias (franchise_id);

create trigger set_updated_at before update on core.franchise_alias
  for each row execute function app.set_updated_at();

alter table core.franchise_alias enable row level security;

create policy shared_read on core.franchise_alias
  for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));

revoke all on core.franchise_alias from public, anon, authenticated;
grant select on core.franchise_alias to authenticated;
grant all    on core.franchise_alias to service_role;

comment on table core.franchise_alias is
  'Observed strings resolving to a canonical core.franchise. Normalization is source-neutral: it '
  'reuses core.normalize_popsg_property_observation (contract popsg-property-observation-v1) '
  'rather than adding a second normalizer. Uniqueness is scoped to the licensor, and the '
  'composite foreign key (franchise_id, licensor_id) makes a cross-licensor alias '
  'unrepresentable. Browser roles are read-only.';
comment on column core.franchise_alias.licensor_id is
  'The licensor of the parent franchise, carried here as the scope of alias uniqueness. It is '
  'not independently editable: the composite foreign key requires it to equal the parent '
  'franchise''s licensor_id.';
comment on column core.franchise_alias.normalized_alias is
  'Generated by core.normalize_popsg_property_observation. Never write it directly, and never '
  'change that function without rebaselining every generated column that depends on it.';
