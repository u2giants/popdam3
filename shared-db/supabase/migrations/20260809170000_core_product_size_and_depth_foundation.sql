-- =====================================================================================
-- Issue #597 Phase 1 — canonical shared Product Size and Product Depth (foundation).
--
-- ADDITIVE ONLY. Creates four new tables in `core` and nothing else. No existing
-- table, view, function, policy, grant or contract is altered by this migration.
--
-- WHY TWO SEPARATE ENTITIES
-- -------------------------
-- They look alike and are NOT alike:
--
--   * Product SIZE is ColdLion ERP master data. Its authoritative identity is the
--     merch-group tuple (companyCode, divisionCode, mgTypeCode, mgCode). It is
--     imported, never hand-authored, and it is refreshed by a guarded importer.
--   * Product DEPTH is DesignFlow master data. Its authoritative identity is the
--     legacy `designflow."itemDepth"."itemDepth_id"` integer. It has NO upstream
--     feed at all — DesignFlow's own admin screen was the editor — so after this
--     cutover DB Data Admin becomes the single writer (owner decision 3 on #597).
--
-- Modelling them as one table would force one of the two to carry meaningless
-- columns and would make "who may edit this row" un-answerable.
--
-- THE ONE RULE THAT MATTERS MOST HERE
-- -----------------------------------
-- `mgTypeCode` HAS NO FIXED MEANING ACROSS DIVISIONS. Slot `04` means Size in
-- CW001/EH001/SP001 and means **Pages** in EP001. This is why the natural key
-- includes the division and why `core.product_size` must never be resolved by
-- `code` alone. See AGENTS.md §12 rule 9 and
-- docs/coldlion-erp-api-reference.md ("Merch groups: read the taxonomy doc first").
-- The EP001 exclusion is enforced as a CHECK CONSTRAINT below, not as importer
-- politeness, so no future code path can quietly admit Pages rows as Sizes.
--
-- DUPLICATE LEGACY ROWS ARE EXPECTED — THAT IS WHY SOURCE REFS ARE A CHILD TABLE
-- -----------------------------------------------------------------------------
-- Measured on preview 2026-08-09 against the `dflow."merchGroup"` mirror:
--   CW001  202 legacy rows / 190 distinct codes
--   EH001  263 legacy rows / 161 distinct codes
--   SP001  187 legacy rows / 187 distinct codes
--   EP001    9 legacy rows /   9 distinct codes   (Pages — excluded from Size)
-- 661 legacy rows, 547 distinct MG04 code identities. 547 − 8 historical-inactive
-- − 9 EP001 = 530, which is exactly the direct ColdLion feed count recorded in
-- docs/verification/master-data-designflow-reference-cutover-20260807/.
-- One canonical Size row can therefore have MANY legacy source rows behind it, so
-- provenance lives in a 1:N child table and never in a column on the parent.
--
-- NO GENERATED COLUMNS ARE READ BY ANY TRIGGER IN THIS CHANGE SET.
-- A migration in this repo once installed cleanly while doing nothing, because a
-- BEFORE trigger read a `GENERATED ... STORED` column that Postgres does not
-- populate until after before-triggers. The only triggers added here are the
-- standard `app.set_updated_at()` timestamp triggers, which read nothing.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. core.product_size
-- -------------------------------------------------------------------------------------

create table if not exists core.product_size (
  id uuid primary key default gen_random_uuid(),

  -- Stable ColdLion merch-group identity. All four parts are required; this tuple
  -- is the ONLY supported way to resolve a Size.
  company_code  text not null,
  division_code text not null,
  mg_type_code  text not null default '04',
  code          text not null,

  -- Current display label. ColdLion is the authority for the label attached to a
  -- given identity; the legacy DesignFlow label is retained alongside it so the
  -- 11 known label drifts stay auditable and old exports remain explainable.
  label        text not null,
  legacy_label text,
  label_source text not null default 'designflow_legacy_mirror',

  -- Lifecycle. `inactive` means "retained for existing items, never offered for a
  -- new selection" (owner decision 2 on #597).
  status app.entity_status not null default 'active',

  first_seen_at          timestamptz not null default now(),
  last_seen_in_source_at timestamptz,
  retired_at             timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_size_company_code_not_blank
    check (length(btrim(company_code)) > 0),
  constraint product_size_division_code_not_blank
    check (length(btrim(division_code)) > 0),
  constraint product_size_mg_type_code_not_blank
    check (length(btrim(mg_type_code)) > 0),
  constraint product_size_code_not_blank
    check (length(btrim(code)) > 0),
  constraint product_size_label_not_blank
    check (length(btrim(label)) > 0),
  constraint product_size_legacy_label_not_blank
    check (legacy_label is null or length(btrim(legacy_label)) > 0),
  constraint product_size_label_source_allowed
    check (label_source in ('coldlion', 'designflow_legacy_mirror', 'manual')),
  constraint product_size_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),

  -- MG04 in EP001 means Pages, not Size. Hard-refuse it at the table.
  constraint product_size_excludes_ep001_pages
    check (not (upper(btrim(division_code)) = 'EP001' and btrim(mg_type_code) = '04')),

  -- A retired identity must say when it was retired, and a live one must not
  -- claim a retirement date. Keeps "inactive" from being an unexplained state.
  constraint product_size_retired_at_matches_status
    check (
      (status = 'active' and retired_at is null)
      or (status <> 'active' and retired_at is not null)
    )
);

create unique index if not exists product_size_source_identity_key
  on core.product_size (company_code, division_code, mg_type_code, code);

create index if not exists product_size_status_division_label_idx
  on core.product_size (status, division_code, label);

create index if not exists product_size_division_code_idx
  on core.product_size (division_code, code);

drop trigger if exists set_updated_at on core.product_size;
create trigger set_updated_at before update on core.product_size
  for each row execute function app.set_updated_at();

comment on table core.product_size is
  'Canonical shared Product Size, sourced from the ColdLion MG04 merch-group feed. Identity is the tuple (company_code, division_code, mg_type_code, code) — NEVER code alone, because mgTypeCode has no fixed meaning across divisions. Issue #597 Phase 1.';
comment on column core.product_size.mg_type_code is
  'ColdLion merch-group slot. Always ''04'' for Size. Stored explicitly because slot number does not imply meaning: MG04 in division EP001 is Pages, which a CHECK constraint on this table refuses outright.';
comment on column core.product_size.label is
  'Current display label. ColdLion is the authority for the label attached to a given identity.';
comment on column core.product_size.legacy_label is
  'DesignFlow/Cloud SQL label for the same identity at cutover. Retained so the 11 known ColdLion-vs-legacy label differences stay auditable; never shown in a picker.';
comment on column core.product_size.status is
  'active = selectable. inactive = retained so existing items keep resolving, but never offered for a NEW selection (owner decision 2 on issue #597).';
comment on column core.product_size.last_seen_in_source_at is
  'Last time the guarded ColdLion importer observed this identity in the live feed. NULL means it has only ever been seeded from the legacy mirror.';

-- -------------------------------------------------------------------------------------
-- 2. core.product_depth
-- -------------------------------------------------------------------------------------
--
-- Depth labels are NOT unique and must not be constrained to be. Measured on
-- preview 2026-08-09: 121 rows, 121 distinct legacy ids, 121 distinct codes, but
-- only 114 distinct titles — `2.25in`, `1.2cm`, `3.8in`, `2.5in`, `4in`, `6in`
-- and `8in` each appear twice. A unique index on the label would have failed the
-- seed, and "fixing" the data to satisfy it would have changed authoritative
-- DesignFlow values, which issue #597 forbids.

create table if not exists core.product_depth (
  id uuid primary key default gen_random_uuid(),

  -- Legacy DesignFlow identity, preserved unchanged. This is what existing
  -- itemHeader rows and any rollback path resolve against.
  legacy_id integer,

  code  text not null,
  label text not null,

  status app.entity_status not null default 'active',

  -- Verbatim legacy fields, kept as evidence rather than reinterpreted.
  legacy_status     text,
  legacy_audit_text text,

  source_system text not null default 'designflow',
  sort_order    integer,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_depth_code_not_blank
    check (length(btrim(code)) > 0),
  constraint product_depth_label_not_blank
    check (length(btrim(label)) > 0),
  constraint product_depth_source_system_not_blank
    check (length(btrim(source_system)) > 0),
  constraint product_depth_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint product_depth_legacy_id_positive
    check (legacy_id is null or legacy_id > 0)
);

-- Partial unique: legacy ids are unique among imported rows, and a NEW value
-- authored in DB Data Admin legitimately has no legacy id at all.
create unique index if not exists product_depth_legacy_id_key
  on core.product_depth (legacy_id)
  where legacy_id is not null;

create unique index if not exists product_depth_code_key
  on core.product_depth (code);

create index if not exists product_depth_status_label_idx
  on core.product_depth (status, label);

drop trigger if exists set_updated_at on core.product_depth;
create trigger set_updated_at before update on core.product_depth
  for each row execute function app.set_updated_at();

comment on table core.product_depth is
  'Canonical shared Product Depth, seeded from the 121 authoritative DesignFlow itemDepth rows with legacy ids and labels unchanged. Has NO upstream feed: after issue #597 Phase 1, DB Data Admin is the only writer (owner decision 3).';
comment on column core.product_depth.legacy_id is
  'designflow."itemDepth"."itemDepth_id", preserved unchanged so legacy item rows and any rollback still resolve. NULL only for values authored in DB Data Admin after cutover.';
comment on column core.product_depth.label is
  'Depth label exactly as DesignFlow holds it. DELIBERATELY NOT UNIQUE: 7 label values legitimately appear twice across the 121 authoritative rows.';
comment on column core.product_depth.legacy_status is
  'Raw itemDepth_status text (all 121 authoritative rows read ACTIVE at cutover). Kept verbatim; core.product_depth.status is the interpreted lifecycle.';

-- -------------------------------------------------------------------------------------
-- 3. Provenance — one child row per upstream record, never a column on the parent
-- -------------------------------------------------------------------------------------

create table if not exists core.product_size_source_ref (
  id uuid primary key default gen_random_uuid(),
  product_size_id uuid not null references core.product_size(id) on delete cascade,
  source_system text not null,
  source_table  text not null,
  source_id     text not null,
  source_code   text,
  source_label  text,
  source_is_active boolean,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint product_size_source_ref_system_not_blank
    check (length(btrim(source_system)) > 0),
  constraint product_size_source_ref_table_not_blank
    check (length(btrim(source_table)) > 0),
  constraint product_size_source_ref_id_not_blank
    check (length(btrim(source_id)) > 0),
  constraint product_size_source_ref_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint product_size_source_ref_unique
    unique (source_system, source_table, source_id)
);

create index if not exists product_size_source_ref_parent_idx
  on core.product_size_source_ref (product_size_id);

comment on table core.product_size_source_ref is
  'Provenance for core.product_size. 1:N by design — a single canonical Size identity can have several legacy dflow."merchGroup" rows behind it (661 legacy rows collapse to 547 distinct MG04 identities).';

create table if not exists core.product_depth_source_ref (
  id uuid primary key default gen_random_uuid(),
  product_depth_id uuid not null references core.product_depth(id) on delete cascade,
  source_system text not null,
  source_table  text not null,
  source_id     text not null,
  source_code   text,
  source_label  text,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint product_depth_source_ref_system_not_blank
    check (length(btrim(source_system)) > 0),
  constraint product_depth_source_ref_table_not_blank
    check (length(btrim(source_table)) > 0),
  constraint product_depth_source_ref_id_not_blank
    check (length(btrim(source_id)) > 0),
  constraint product_depth_source_ref_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint product_depth_source_ref_unique
    unique (source_system, source_table, source_id)
);

create index if not exists product_depth_source_ref_parent_idx
  on core.product_depth_source_ref (product_depth_id);

comment on table core.product_depth_source_ref is
  'Provenance for core.product_depth. Records the authoritative DesignFlow itemDepth row each canonical Depth was seeded from, so the legacy id/label chain survives independently of the parent row.';

-- -------------------------------------------------------------------------------------
-- 4. RLS and grants
-- -------------------------------------------------------------------------------------
--
-- Reads follow the established shared-lookup pattern (core.product_material).
-- Writes are NOT granted to any browser role: every supported mutation goes
-- through a SECURITY DEFINER RPC added later in this change set, so `authenticated`
-- gets SELECT and nothing more. The RLS write policies below are defence in depth
-- on top of the missing grant, not the primary guard.

alter table core.product_size            enable row level security;
alter table core.product_depth           enable row level security;
alter table core.product_size_source_ref enable row level security;
alter table core.product_depth_source_ref enable row level security;

drop policy if exists shared_read on core.product_size;
create policy shared_read on core.product_size
  for select to authenticated
  using (
    (select app.has_any_role(array[
      'administrator', 'sales', 'licensing', 'designer', 'viewer', 'vendor'
    ]::app.app_role[]))
  );

drop policy if exists admin_or_designer_write on core.product_size;
create policy admin_or_designer_write on core.product_size
  for all to authenticated
  using ((select app.has_any_role(array['administrator', 'designer']::app.app_role[])))
  with check ((select app.has_any_role(array['administrator', 'designer']::app.app_role[])));

drop policy if exists shared_read on core.product_depth;
create policy shared_read on core.product_depth
  for select to authenticated
  using (
    (select app.has_any_role(array[
      'administrator', 'sales', 'licensing', 'designer', 'viewer', 'vendor'
    ]::app.app_role[]))
  );

drop policy if exists admin_or_designer_write on core.product_depth;
create policy admin_or_designer_write on core.product_depth
  for all to authenticated
  using ((select app.has_any_role(array['administrator', 'designer']::app.app_role[])))
  with check ((select app.has_any_role(array['administrator', 'designer']::app.app_role[])));

drop policy if exists shared_read on core.product_size_source_ref;
create policy shared_read on core.product_size_source_ref
  for select to authenticated
  using (
    (select app.has_any_role(array[
      'administrator', 'sales', 'licensing', 'designer', 'viewer', 'vendor'
    ]::app.app_role[]))
  );

drop policy if exists shared_read on core.product_depth_source_ref;
create policy shared_read on core.product_depth_source_ref
  for select to authenticated
  using (
    (select app.has_any_role(array[
      'administrator', 'sales', 'licensing', 'designer', 'viewer', 'vendor'
    ]::app.app_role[]))
  );

revoke all on table core.product_size             from public, anon;
revoke all on table core.product_depth            from public, anon;
revoke all on table core.product_size_source_ref  from public, anon;
revoke all on table core.product_depth_source_ref from public, anon;

grant select on table core.product_size             to authenticated;
grant select on table core.product_depth            to authenticated;
grant select on table core.product_size_source_ref  to authenticated;
grant select on table core.product_depth_source_ref to authenticated;

grant all on table core.product_size             to service_role;
grant all on table core.product_depth            to service_role;
grant all on table core.product_size_source_ref  to service_role;
grant all on table core.product_depth_source_ref to service_role;

-- -------------------------------------------------------------------------------------
-- 5. PLM item contract links (additive; compatibility fields retained)
-- -------------------------------------------------------------------------------------
--
-- These two columns live in THIS migration, not a later one, purely because they
-- are foreign keys into the tables created above and there is no coherent point
-- between "the tables exist" and "the item can point at them".
--
-- EXPAND, DO NOT CONTRACT. Nothing is removed and nothing is repointed:
--   * `plm.item.raw` keeps whatever legacy size/depth text it already carried.
--   * The DesignFlow `dflow."itemHeader"` mirror columns are untouched.
--   * `api.plm_item_list` is NOT modified. That view reads `public.erp_items_current`
--     (the ColdLion ERP item mirror), not `plm.item`, so appending Size/Depth to it
--     would mean inventing a join rather than exposing a link. It is deliberately
--     left alone — it is consumed by four style-tracker views and this change has no
--     business touching them.
-- Both columns stay NULL until a separate, owner-approved backfill runs. Consumers
-- must keep reading the compatibility text until parity and rollback checks pass.

alter table plm.item
  add column if not exists product_size_id uuid references core.product_size(id) on delete set null;

alter table plm.item
  add column if not exists product_depth_id uuid references core.product_depth(id) on delete set null;

create index if not exists item_product_size_id_idx
  on plm.item (product_size_id)
  where product_size_id is not null;

create index if not exists item_product_depth_id_idx
  on plm.item (product_depth_id)
  where product_depth_id is not null;

comment on column plm.item.product_size_id is
  'Stable link to canonical core.product_size. Additive: the legacy size text in plm.item.raw and in the DesignFlow itemHeader mirror is retained as a compatibility field and remains the reader of record until parity and rollback checks pass (issue #597 Phase 1).';
comment on column plm.item.product_depth_id is
  'Stable link to canonical core.product_depth. Additive: the legacy depth text remains the compatibility field until parity and rollback checks pass (issue #597 Phase 1).';
