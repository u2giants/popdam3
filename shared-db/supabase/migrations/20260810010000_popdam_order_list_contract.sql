-- =====================================================================================
-- PopDAM OrderList — Step 1: the shared database contract.
--
-- Issue:  u2giants/shared-db#613 (object claim #624)
-- Plan:   plan_popdam_order_list.md, Phase 1 (Steps 1.2 and 1.3)
-- Source: docs/app-migration-notes/popdam-order-list.md (the completed 48-column map)
--
-- WHAT THIS FILE IS
-- -----------------
-- The legacy Google `OrderList` workbook is being replaced by a native PopDAM screen
-- at /orders. The canonical destination is the EXISTING pair `plm.production_order`
-- and `plm.production_order_line` created in 20260621151024_domain_tables.sql. This
-- migration is purely ADDITIVE: it adds the header/line columns the 48-column map
-- proved are needed, two dedicated source-reference tables, a per-user saved-view
-- table, one browser-facing serving view, and three narrow write RPCs.
--
-- THE FIVE RULES THIS SCHEMA EXISTS TO ENFORCE (owner decisions, 2026-08-06/07)
-- ----------------------------------------------------------------------------
-- 1. Google OrderList rows and future Coldlion production-order rows are the SAME
--    business orders. Neither source may create a parallel copy of the other's order.
--    => `plm.production_order_source_ref` / `plm.production_order_line_source_ref`.
--       Each canonical row can carry a Google identity AND a Coldlion identity at the
--       same time. The pre-existing single `(source_system, source_id)` pair on the
--       canonical tables cannot express that, so it is left untouched for backwards
--       compatibility and the new tables become the identity surface.
--
-- 2. The durable product relationship is the existing
--    `plm.production_order_line.item_id -> plm.item.id`. No competing permanent FK to
--    `public.style_tracker_rows` is created here, and none may be added later.
--
-- 3. SKU alone never resolves a product. The legacy sheet carries a Licensed/Generic
--    discriminator (column AM) that selects which Master Data catalog is eligible.
--    => `production_order_line.source_style_type` plus `master_data_match_status`, and
--       `public.link_dam_order_line` REFUSES an item that the normalized SKU + type
--       does not uniquely resolve to through `plm.style_tracker_item_bridge`.
--
-- 4. Ambiguity stays visible. There is no fuzzy matching anywhere in this file.
--    `matched | unmatched | ambiguous | manual | not_applicable` is a first-class
--    column so an unresolved historical row is imported and shown, never guessed at
--    and never dropped.
--
-- 5. No hard delete in version 1. Corrections use `voided_at / voided_by /
--    void_reason` so business history survives. There is deliberately no delete RPC
--    and no delete policy.
--
-- A KNOWN, INTENTIONAL DEPENDENCY — READ THIS BEFORE FILING A BUG
-- ---------------------------------------------------------------
-- `public.link_dam_order_line` can only succeed once `plm.item` is populated and
-- `plm.style_tracker_item_bridge.plm_item_id` is filled in. Today `plm.item` is empty
-- and the bridge still points at the legacy `public.erp_items_current`; that cutover
-- is owned by `fix_schema_for_api.md` Phase 4, NOT by this workstream. Until it lands,
-- the OrderList importer records `matched`/`ambiguous`/`unmatched` evidence with a
-- NULL `item_id`, and the link RPC correctly raises rather than inventing a link.
-- That is the designed behaviour, not a defect. Nothing in this file writes to
-- `plm.item`, the bridge, or any `core.*` table.
--
-- RLS AND WHO CAN SEE WHAT
-- ------------------------
-- `plm.production_order[_line]` already carry the baseline `plm_read` policy from
-- 20260621151155, which requires `app.has_app_access('plm')` / administrator / sales /
-- licensing. PopDAM staff hold `popdam` app access and the app-schema `designer` or
-- `viewer` role, so under that policy alone every PopDAM user would open /orders to an
-- empty grid — the exact failure already documented for the Styles page in
-- 20260726210000. Owner decision 8 says all signed-in PopDAM staff use OrderList, and
-- the standing Master Data precedent (20260726200000, "restore open writes", which is
-- DELIBERATE and must not be re-hardened) is authenticated-wide access. So this file
-- adds an additive SELECT policy for `authenticated` on the two canonical tables.
-- WRITES are NOT widened: the `plm_admin_write` policy stays as it is, and ordinary
-- staff write only through the three SECURITY DEFINER RPCs below, each of which
-- validates `auth.uid()`, whitelists every field it will accept, and pins search_path.
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- 1. Header columns on plm.production_order
--
-- Only fields the Phase 0 profile proved are HEADER scoped (stable within a normalized
-- Import PO) get first-class columns. Fields that looked like headers but actually vary
-- inside a PO group — customer PO (differs in 806 groups), order person (341), order
-- type (329), suffix (313), ship-to (283), cargo forecast (407) — are line columns in
-- section 2 instead. Free-text provenance such as the ordering company (`POP` /
-- `Splash` / `Pop/Splash`) stays in the existing `metadata` jsonb; it is not a customer
-- and must never become a second FK next to `company_id`.
-- -------------------------------------------------------------------------------------
alter table plm.production_order
  add column if not exists seal_container_date      date,
  add column if not exists sent_po_date             date,
  add column if not exists vendor_delivery_date     date,
  add column if not exists etd                      date,
  add column if not exists eta                      date,
  add column if not exists warehouse_date           date,
  add column if not exists booking_state            text,
  add column if not exists container_booking_group  text,
  add column if not exists mbl                      text,
  add column if not exists close_tracking           boolean not null default false,
  add column if not exists voided_at                timestamptz,
  add column if not exists voided_by                uuid,
  add column if not exists void_reason              text;

comment on column plm.production_order.seal_container_date is
  'Google OrderList column D. Malformed source values such as "1//12/2022" and "CANCELLED" stay as raw text in metadata; this typed column is left NULL rather than coerced.';
comment on column plm.production_order.sent_po_date is
  'Google OrderList column E. Deliberately NOT assumed to equal Coldlion order_date.';
comment on column plm.production_order.booking_state is
  'Google OrderList column AC ("Book Container"). Kept as text, not boolean: the only observed value is "Booked" and a future source may add states.';
comment on column plm.production_order.close_tracking is
  'Google OrderList column AK. Tracking is finished for this order. This is NOT a delete flag and must never be treated as one.';
comment on column plm.production_order.voided_at is
  'Non-destructive correction. Version 1 has no hard delete: a wrong order is voided so its history and source refs survive.';

-- ETD held two impossible serial dates (6693547) in the source. A date column cannot
-- store them at all, which is the point: they are rejected at import and counted in the
-- reconciliation report rather than silently becoming a year-20000 date.

-- -------------------------------------------------------------------------------------
-- 2. Line columns on plm.production_order_line
-- -------------------------------------------------------------------------------------
alter table plm.production_order_line
  add column if not exists order_person                 text,
  add column if not exists order_type                   text,
  add column if not exists customer_suffix              text,
  add column if not exists customer_po_number           text,
  add column if not exists assortment_id                text,
  add column if not exists assortment_component_ordinal integer,
  add column if not exists order_depth_inches           numeric,
  add column if not exists case_pack                    numeric,
  add column if not exists cases_reported               numeric,
  add column if not exists ship_to                      text,
  add column if not exists start_ship_date              date,
  add column if not exists start_ship_raw               text,
  add column if not exists cancel_date                  date,
  add column if not exists cancel_raw                   text,
  add column if not exists cargo_forecast_date          date,
  add column if not exists cargo_forecast_raw           text,
  add column if not exists test_report                  text,
  add column if not exists professional_photos          text,
  add column if not exists contractual_sample_reorder   boolean not null default false,
  add column if not exists source_style_type            text,
  add column if not exists master_data_match_status     text not null default 'not_applicable',
  add column if not exists voided_at                    timestamptz,
  add column if not exists voided_by                    uuid,
  add column if not exists void_reason                  text;

-- Normalized SKU. Trim + case-fold ONLY. Punctuation stripping and any other
-- "helpful" normalization is forbidden by owner decision 5 — it is how two different
-- products silently become one. Empty strings collapse to NULL so a blank SKU can
-- never match another blank SKU.
--
-- This is a GENERATED ... STORED column. Postgres populates it AFTER row-level BEFORE
-- triggers run, so nothing in this file reads it from a BEFORE trigger; the link RPC
-- reads it with a fresh SELECT after the row is already committed to the table.
alter table plm.production_order_line
  add column if not exists sku_normalized text
  generated always as (nullif(btrim(lower(sku)), '')) stored;

comment on column plm.production_order_line.sku_normalized is
  'Trim + case-fold only. Never fuzzy. Used for Master Data matching and for the link guard in public.link_dam_order_line.';
comment on column plm.production_order_line.source_style_type is
  'Google OrderList column AM, normalized to licensed|generic. Selects which Master Data catalog is eligible. For an assortment, the per-component value, not the parent row value.';
comment on column plm.production_order_line.master_data_match_status is
  'How this line resolved to a canonical item. Evidence only — it never substitutes for item_id. ambiguous means Master Data held duplicate SKU+type rows (449 such cases in the historical source) and a human must choose.';
comment on column plm.production_order_line.assortment_component_ordinal is
  '1-based ordinal within a Google assortment row. Part of the deterministic Google source id, so a re-import maps each component back to the same canonical line.';
comment on column plm.production_order_line.cases_reported is
  'Google OrderList column W. The source holds 531 "Wrong QTY" strings and other text; those stay raw in metadata and this column is left NULL. Never compute over a coerced value.';

-- Match-status and discriminator domains. Added as NOT VALID then validated so the
-- statement cannot be blocked by a long lock on a populated table; both tables are
-- empty today, so validation is instant.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'plm.production_order_line'::regclass
      and conname  = 'production_order_line_master_data_match_status_check'
  ) then
    alter table plm.production_order_line
      add constraint production_order_line_master_data_match_status_check
      check (master_data_match_status in ('matched', 'unmatched', 'ambiguous', 'manual', 'not_applicable'))
      not valid;
    alter table plm.production_order_line
      validate constraint production_order_line_master_data_match_status_check;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'plm.production_order_line'::regclass
      and conname  = 'production_order_line_source_style_type_check'
  ) then
    alter table plm.production_order_line
      add constraint production_order_line_source_style_type_check
      check (source_style_type is null or source_style_type in ('licensed', 'generic'))
      not valid;
    alter table plm.production_order_line
      validate constraint production_order_line_source_style_type_check;
  end if;

  -- A line claiming `matched` must actually hold the FK. Without this the grid could
  -- show a green "matched" badge on a row with no product at all.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'plm.production_order_line'::regclass
      and conname  = 'production_order_line_matched_requires_item_check'
  ) then
    alter table plm.production_order_line
      add constraint production_order_line_matched_requires_item_check
      check (master_data_match_status not in ('matched', 'manual') or item_id is not null)
      not valid;
    alter table plm.production_order_line
      validate constraint production_order_line_matched_requires_item_check;
  end if;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 3. Multi-source identity: the two source-reference tables
--
-- One canonical row, many source identities. `unique (source_system, source_id)` makes
-- a repeated import a no-op instead of a duplicate. Google refs are written by the
-- historical importer; Coldlion refs are added LATER, alongside them, by the ERP feed.
-- Overwriting a Google ref with a Coldlion ref is forbidden (plan section 11 rule 22).
-- -------------------------------------------------------------------------------------
create table if not exists plm.production_order_source_ref (
  id                  uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references plm.production_order(id) on delete cascade,
  source_system       text not null,
  source_id           text not null,
  is_primary          boolean not null default false,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint production_order_source_ref_unique unique (source_system, source_id)
);

create table if not exists plm.production_order_line_source_ref (
  id                       uuid primary key default gen_random_uuid(),
  production_order_line_id uuid not null references plm.production_order_line(id) on delete cascade,
  source_system            text not null,
  source_id                text not null,
  is_primary               boolean not null default false,
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint production_order_line_source_ref_unique unique (source_system, source_id)
);

comment on table plm.production_order_source_ref is
  'Every external identity of one canonical production order. Google (google_order_list) and Coldlion refs coexist on the same row; a later source CLAIMS an existing order, it never creates a parallel one.';
comment on table plm.production_order_line_source_ref is
  'Every external identity of one canonical order line. Google ids are deterministic: order:row:<sheet-row> for a direct line and order:row:<sheet-row>:component:<ordinal> for an assortment component, which is what makes the historical import idempotent.';

-- A source system may hold at most one PRIMARY identity per canonical row.
create unique index if not exists production_order_source_ref_primary_uidx
  on plm.production_order_source_ref (production_order_id, source_system)
  where is_primary;

create unique index if not exists production_order_line_source_ref_primary_uidx
  on plm.production_order_line_source_ref (production_order_line_id, source_system)
  where is_primary;

create index if not exists production_order_source_ref_order_idx
  on plm.production_order_source_ref (production_order_id);
create index if not exists production_order_line_source_ref_line_idx
  on plm.production_order_line_source_ref (production_order_line_id);

drop trigger if exists set_updated_at on plm.production_order_source_ref;
create trigger set_updated_at
  before update on plm.production_order_source_ref
  for each row execute function app.set_updated_at();

drop trigger if exists set_updated_at on plm.production_order_line_source_ref;
create trigger set_updated_at
  before update on plm.production_order_line_source_ref
  for each row execute function app.set_updated_at();

alter table plm.production_order_source_ref      enable row level security;
alter table plm.production_order_line_source_ref enable row level security;

drop policy if exists production_order_source_ref_read on plm.production_order_source_ref;
create policy production_order_source_ref_read
  on plm.production_order_source_ref
  for select to authenticated
  using (true);

drop policy if exists production_order_line_source_ref_read on plm.production_order_line_source_ref;
create policy production_order_line_source_ref_read
  on plm.production_order_line_source_ref
  for select to authenticated
  using (true);

-- Writes to the identity tables are importer/service work, never browser work.
grant select on plm.production_order_source_ref      to authenticated;
grant select on plm.production_order_line_source_ref to authenticated;
grant all    on plm.production_order_source_ref      to service_role;
grant all    on plm.production_order_line_source_ref to service_role;

-- -------------------------------------------------------------------------------------
-- 4. Read access for PopDAM staff on the canonical tables (see the RLS note in the
--    header). SELECT only — the existing plm_admin_write policy is untouched.
-- -------------------------------------------------------------------------------------
drop policy if exists production_order_popdam_read on plm.production_order;
create policy production_order_popdam_read
  on plm.production_order
  for select to authenticated
  using (true);

drop policy if exists production_order_line_popdam_read on plm.production_order_line;
create policy production_order_line_popdam_read
  on plm.production_order_line
  for select to authenticated
  using (true);

-- -------------------------------------------------------------------------------------
-- 5. Indexes for the OrderList grid's real access patterns
-- -------------------------------------------------------------------------------------
create index if not exists production_order_number_idx
  on plm.production_order (production_order_number);
create index if not exists production_order_company_idx
  on plm.production_order (company_id);
create index if not exists production_order_factory_idx
  on plm.production_order (factory_id);
create index if not exists production_order_status_idx
  on plm.production_order (status);
create index if not exists production_order_default_sort_idx
  on plm.production_order (sent_po_date desc nulls last, production_order_number);
create index if not exists production_order_open_idx
  on plm.production_order (id) where voided_at is null;

create index if not exists production_order_line_order_idx
  on plm.production_order_line (production_order_id);
create index if not exists production_order_line_item_idx
  on plm.production_order_line (item_id);
create index if not exists production_order_line_sku_normalized_idx
  on plm.production_order_line (sku_normalized);
create index if not exists production_order_line_match_status_idx
  on plm.production_order_line (master_data_match_status);
create index if not exists production_order_line_customer_po_idx
  on plm.production_order_line (customer_po_number);
create index if not exists production_order_line_assortment_idx
  on plm.production_order_line (assortment_id);
create index if not exists production_order_line_open_idx
  on plm.production_order_line (id) where voided_at is null;

-- -------------------------------------------------------------------------------------
-- 6. Per-user saved grid layouts, patterned on public.style_tracker_user_views but
--    scoped to OrderList. Isolated per user by RLS: one user can never read, change or
--    delete another user's saved view.
-- -------------------------------------------------------------------------------------
create table if not exists public.order_list_user_views (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid(),
  view_name    text not null default 'default',
  column_state jsonb not null default '[]'::jsonb,
  filter_model jsonb not null default '{}'::jsonb,
  sort_model   jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint order_list_user_views_user_name_unique unique (user_id, view_name)
);

comment on table public.order_list_user_views is
  'Saved AG Grid column/filter/sort layouts for the PopDAM /orders page, one row per user per named view. Private to its owner.';

drop trigger if exists set_updated_at on public.order_list_user_views;
create trigger set_updated_at
  before update on public.order_list_user_views
  for each row execute function app.set_updated_at();

alter table public.order_list_user_views enable row level security;

drop policy if exists order_list_user_views_owner_select on public.order_list_user_views;
create policy order_list_user_views_owner_select
  on public.order_list_user_views for select to authenticated
  using (user_id = auth.uid());

drop policy if exists order_list_user_views_owner_insert on public.order_list_user_views;
create policy order_list_user_views_owner_insert
  on public.order_list_user_views for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists order_list_user_views_owner_update on public.order_list_user_views;
create policy order_list_user_views_owner_update
  on public.order_list_user_views for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists order_list_user_views_owner_delete on public.order_list_user_views;
create policy order_list_user_views_owner_delete
  on public.order_list_user_views for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.order_list_user_views to authenticated;
grant all on public.order_list_user_views to service_role;

-- -------------------------------------------------------------------------------------
-- 7. api.dam_order_list — the one browser-facing read contract
--
-- SECURITY INVOKER (the default) on purpose: the RLS policies on the underlying tables
-- stay in force and this view cannot become a way around them. The `plm` schema itself
-- is NOT exposed to PostgREST; PopDAM reads this view and nothing else.
--
-- Current product facts come from the LIVE linked item and Master Data row. The
-- immutable `order_list_snapshot` under line metadata is what the Google sheet said at
-- import time and is only a display fallback when the link is missing — it is never
-- presented as current truth, which is why the snapshot fields are projected under
-- their own `snapshot_` names rather than merged into the live ones.
-- -------------------------------------------------------------------------------------
create or replace view api.dam_order_list as
select
  -- identity
  pol.id                                    as order_line_id,
  po.id                                     as order_id,

  -- order (header) facts
  po.production_order_number,
  po.status                                 as order_status,
  po.company_id,
  cust.name                                 as customer_name,
  po.factory_id,
  fact.name                                 as vendor_name,
  po.metadata ->> 'ordering_company'        as ordering_company,
  po.order_date,
  po.sent_po_date,
  po.seal_container_date,
  po.vendor_delivery_date,
  po.requested_ship_date,
  po.actual_ship_date,
  po.booking_state,
  po.etd,
  po.eta,
  po.warehouse_date,
  po.container_booking_group,
  po.mbl,
  po.close_tracking,
  po.voided_at                              as order_voided_at,
  po.void_reason                            as order_void_reason,

  -- line facts
  pol.line_number,
  pol.order_person,
  pol.order_type,
  pol.customer_suffix,
  pol.customer_po_number,
  pol.assortment_id,
  pol.assortment_component_ordinal,
  pol.sku,
  pol.sku_normalized,
  pol.quantity_ordered,
  pol.quantity_shipped,
  pol.unit_cost,
  pol.order_depth_inches,
  pol.case_pack,
  pol.cases_reported,
  pol.ship_to,
  pol.start_ship_date,
  pol.start_ship_raw,
  pol.cancel_date,
  pol.cancel_raw,
  pol.cargo_forecast_date,
  pol.cargo_forecast_raw,
  pol.test_report,
  pol.professional_photos,
  pol.contractual_sample_reorder,
  pol.status                                as line_status,
  pol.voided_at                             as line_voided_at,
  pol.void_reason                           as line_void_reason,

  -- how this line resolved to a product
  pol.source_style_type,
  pol.master_data_match_status,
  pol.item_id,

  -- CURRENT product facts (live, read-only in the UI)
  item.item_number                          as item_number,
  item.style_number                         as item_style_number,
  item.name                                 as item_name,
  item.description                          as item_description,
  bridge.id                                 as style_tracker_bridge_id,
  bridge.style_tracker_row_id,
  bridge.tracker_type                       as master_data_tracker_type,
  str.description                           as master_data_description,
  str.license_status                        as master_data_license_status,
  str.licensor                              as master_data_licensor,
  str.default_vendor                        as master_data_default_vendor,
  str.customer                              as master_data_customer,

  -- IMMUTABLE source snapshot (display fallback only, never current truth)
  pol.metadata #>> '{order_list_snapshot,sku}'            as snapshot_sku,
  pol.metadata #>> '{order_list_snapshot,description}'    as snapshot_description,
  pol.metadata #>> '{order_list_snapshot,license_status}' as snapshot_license_status,
  pol.metadata #>> '{order_list_snapshot,style_type}'     as snapshot_style_type,
  pol.metadata #>> '{order_list_snapshot,source_row}'     as snapshot_source_row,

  -- diagnostics the grid renders as a badge, computed here so every client agrees
  (pol.item_id is null)                     as item_link_missing,
  (
    pol.item_id is not null
    and bridge.id is not null
    and pol.source_style_type is not null
    and bridge.tracker_type is distinct from pol.source_style_type
  )                                         as item_link_type_mismatch,

  -- provenance
  google_ref.source_id                      as google_source_id,
  coldlion_ref.source_id                    as coldlion_source_id,
  pol.created_at                            as line_created_at,
  pol.updated_at                            as line_updated_at
from plm.production_order_line pol
join plm.production_order po
  on po.id = pol.production_order_id
left join core.customer cust
  on cust.id = po.company_id
left join core.factory fact
  on fact.id = po.factory_id
left join plm.item item
  on item.id = pol.item_id
left join plm.style_tracker_item_bridge bridge
  on bridge.plm_item_id = pol.item_id
left join public.style_tracker_rows str
  on str.id = bridge.style_tracker_row_id
left join plm.production_order_line_source_ref google_ref
  on google_ref.production_order_line_id = pol.id
 and google_ref.source_system = 'google_order_list'
left join plm.production_order_line_source_ref coldlion_ref
  on coldlion_ref.production_order_line_id = pol.id
 and coldlion_ref.source_system = 'coldlion';

comment on view api.dam_order_list is
  'PopDAM /orders serving contract. Security invoker. Live item/Master Data values plus the immutable order_list_snapshot fallback, with explicit master_data_match_status and link diagnostics. Read-only: writes go through public.create_dam_order / update_dam_order / link_dam_order_line.';

grant select on api.dam_order_list to authenticated;

-- -------------------------------------------------------------------------------------
-- 8. Write RPCs
--
-- Ordinary PopDAM staff cannot write `plm` directly (plm_admin_write is administrator
-- only) and MUST NOT be given a blanket write policy on a canonical table. These three
-- SECURITY DEFINER functions are the whole write surface. Each one:
--   * refuses an unauthenticated caller;
--   * rejects any field name it does not explicitly recognise, so a future column can
--     never become browser-writable by accident;
--   * pins search_path;
--   * is revoked from public and anon (required by the 20260729 public-execute
--     lockdown: no anon-reachable SECURITY DEFINER routine may exist in `public`).
-- There is deliberately NO delete RPC.
-- -------------------------------------------------------------------------------------

-- Whitelists live in one place so the RPCs and the tests cannot drift apart.
create or replace function plm.dam_order_allowed_header_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'production_order_number', 'status', 'company_id', 'factory_id',
    'order_date', 'requested_ship_date', 'actual_ship_date',
    'seal_container_date', 'sent_po_date', 'vendor_delivery_date',
    'booking_state', 'etd', 'eta', 'warehouse_date',
    'container_booking_group', 'mbl', 'close_tracking',
    'metadata', 'void_reason', 'voided'
  ]::text[];
$$;

create or replace function plm.dam_order_allowed_line_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'id', 'line_number', 'sku', 'quantity_ordered', 'quantity_shipped', 'unit_cost',
    'status', 'order_person', 'order_type', 'customer_suffix', 'customer_po_number',
    'assortment_id', 'assortment_component_ordinal', 'order_depth_inches',
    'case_pack', 'cases_reported', 'ship_to',
    'start_ship_date', 'start_ship_raw', 'cancel_date', 'cancel_raw',
    'cargo_forecast_date', 'cargo_forecast_raw',
    'test_report', 'professional_photos', 'contractual_sample_reorder',
    'source_style_type', 'metadata', 'void_reason', 'voided'
  ]::text[];
$$;

revoke all on function plm.dam_order_allowed_header_keys() from public;
revoke all on function plm.dam_order_allowed_line_keys()   from public;
grant execute on function plm.dam_order_allowed_header_keys() to authenticated, service_role;
grant execute on function plm.dam_order_allowed_line_keys()   to authenticated, service_role;

create or replace function plm.assert_dam_order_keys(p_payload jsonb, p_allowed text[], p_what text)
returns void
language plpgsql
immutable
as $$
declare
  offending text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'dam order %: payload must be a json object, got %',
      p_what, coalesce(jsonb_typeof(p_payload), 'null')
      using errcode = '22023';
  end if;

  select string_agg(k, ', ' order by k)
    into offending
  from jsonb_object_keys(p_payload) as k
  where k <> all (p_allowed);

  if offending is not null then
    raise exception 'dam order %: field(s) not writable through this rpc: %', p_what, offending
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function plm.assert_dam_order_keys(jsonb, text[], text) from public;
grant execute on function plm.assert_dam_order_keys(jsonb, text[], text) to authenticated, service_role;

-- --- create -------------------------------------------------------------------------
create or replace function public.create_dam_order(
  p_order jsonb,
  p_lines jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = plm, public, core, app, pg_temp
as $$
declare
  v_actor    uuid := auth.uid();
  v_order_id uuid;
  v_line     jsonb;
begin
  if v_actor is null then
    raise exception 'create_dam_order: authentication required' using errcode = '42501';
  end if;

  perform plm.assert_dam_order_keys(p_order, plm.dam_order_allowed_header_keys(), 'header');

  if coalesce(btrim(p_order ->> 'production_order_number'), '') = '' then
    raise exception 'create_dam_order: production_order_number is required' using errcode = '23514';
  end if;

  insert into plm.production_order (
    production_order_number, status, company_id, factory_id,
    order_date, requested_ship_date, actual_ship_date,
    seal_container_date, sent_po_date, vendor_delivery_date,
    booking_state, etd, eta, warehouse_date,
    container_booking_group, mbl, close_tracking, metadata
  )
  values (
    btrim(p_order ->> 'production_order_number'),
    nullif(btrim(coalesce(p_order ->> 'status', '')), ''),
    (p_order ->> 'company_id')::uuid,
    (p_order ->> 'factory_id')::uuid,
    (p_order ->> 'order_date')::date,
    (p_order ->> 'requested_ship_date')::date,
    (p_order ->> 'actual_ship_date')::date,
    (p_order ->> 'seal_container_date')::date,
    (p_order ->> 'sent_po_date')::date,
    (p_order ->> 'vendor_delivery_date')::date,
    nullif(btrim(coalesce(p_order ->> 'booking_state', '')), ''),
    (p_order ->> 'etd')::date,
    (p_order ->> 'eta')::date,
    (p_order ->> 'warehouse_date')::date,
    nullif(btrim(coalesce(p_order ->> 'container_booking_group', '')), ''),
    nullif(btrim(coalesce(p_order ->> 'mbl', '')), ''),
    coalesce((p_order ->> 'close_tracking')::boolean, false),
    coalesce(p_order -> 'metadata', '{}'::jsonb)
      || jsonb_build_object('created_by', v_actor, 'created_via', 'popdam_order_list')
  )
  returning id into v_order_id;

  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for v_line in select * from jsonb_array_elements(p_lines)
    loop
      perform plm.assert_dam_order_keys(v_line, plm.dam_order_allowed_line_keys(), 'line');

      insert into plm.production_order_line (
        production_order_id, line_number, sku, quantity_ordered, quantity_shipped,
        unit_cost, status, order_person, order_type, customer_suffix, customer_po_number,
        assortment_id, assortment_component_ordinal, order_depth_inches, case_pack,
        cases_reported, ship_to, start_ship_date, start_ship_raw, cancel_date, cancel_raw,
        cargo_forecast_date, cargo_forecast_raw, test_report, professional_photos,
        contractual_sample_reorder, source_style_type, metadata
      )
      values (
        v_order_id,
        nullif(btrim(coalesce(v_line ->> 'line_number', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'sku', '')), ''),
        (v_line ->> 'quantity_ordered')::numeric,
        (v_line ->> 'quantity_shipped')::numeric,
        (v_line ->> 'unit_cost')::numeric,
        nullif(btrim(coalesce(v_line ->> 'status', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'order_person', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'order_type', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'customer_suffix', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'customer_po_number', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'assortment_id', '')), ''),
        (v_line ->> 'assortment_component_ordinal')::integer,
        (v_line ->> 'order_depth_inches')::numeric,
        (v_line ->> 'case_pack')::numeric,
        (v_line ->> 'cases_reported')::numeric,
        nullif(btrim(coalesce(v_line ->> 'ship_to', '')), ''),
        (v_line ->> 'start_ship_date')::date,
        nullif(btrim(coalesce(v_line ->> 'start_ship_raw', '')), ''),
        (v_line ->> 'cancel_date')::date,
        nullif(btrim(coalesce(v_line ->> 'cancel_raw', '')), ''),
        (v_line ->> 'cargo_forecast_date')::date,
        nullif(btrim(coalesce(v_line ->> 'cargo_forecast_raw', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'test_report', '')), ''),
        nullif(btrim(coalesce(v_line ->> 'professional_photos', '')), ''),
        coalesce((v_line ->> 'contractual_sample_reorder')::boolean, false),
        nullif(btrim(lower(coalesce(v_line ->> 'source_style_type', ''))), ''),
        coalesce(v_line -> 'metadata', '{}'::jsonb)
          || jsonb_build_object('created_by', v_actor, 'created_via', 'popdam_order_list')
      );
      -- item_id is deliberately NOT settable here. A product link is only ever created
      -- by public.link_dam_order_line, which proves the SKU + type resolves uniquely.
    end loop;
  end if;

  return v_order_id;
end;
$$;

-- --- update -------------------------------------------------------------------------
create or replace function public.update_dam_order(
  p_order_id     uuid,
  p_order_patch  jsonb default '{}'::jsonb,
  p_line_patches jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = plm, public, core, app, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_patch jsonb;
  v_line_id uuid;
  v_hit int;
begin
  if v_actor is null then
    raise exception 'update_dam_order: authentication required' using errcode = '42501';
  end if;

  if not exists (select 1 from plm.production_order where id = p_order_id) then
    raise exception 'update_dam_order: order % not found', p_order_id using errcode = 'P0002';
  end if;

  perform plm.assert_dam_order_keys(coalesce(p_order_patch, '{}'::jsonb),
                                    plm.dam_order_allowed_header_keys(), 'header');

  -- Only keys actually PRESENT in the patch are written, so a partial patch can never
  -- blank a field the caller did not mention.
  update plm.production_order po set
    production_order_number = case when p_order_patch ? 'production_order_number'
                                   then btrim(p_order_patch ->> 'production_order_number')
                                   else po.production_order_number end,
    status                  = case when p_order_patch ? 'status'
                                   then nullif(btrim(coalesce(p_order_patch ->> 'status','')),'')
                                   else po.status end,
    company_id              = case when p_order_patch ? 'company_id'
                                   then (p_order_patch ->> 'company_id')::uuid else po.company_id end,
    factory_id              = case when p_order_patch ? 'factory_id'
                                   then (p_order_patch ->> 'factory_id')::uuid else po.factory_id end,
    order_date              = case when p_order_patch ? 'order_date'
                                   then (p_order_patch ->> 'order_date')::date else po.order_date end,
    requested_ship_date     = case when p_order_patch ? 'requested_ship_date'
                                   then (p_order_patch ->> 'requested_ship_date')::date else po.requested_ship_date end,
    actual_ship_date        = case when p_order_patch ? 'actual_ship_date'
                                   then (p_order_patch ->> 'actual_ship_date')::date else po.actual_ship_date end,
    seal_container_date     = case when p_order_patch ? 'seal_container_date'
                                   then (p_order_patch ->> 'seal_container_date')::date else po.seal_container_date end,
    sent_po_date            = case when p_order_patch ? 'sent_po_date'
                                   then (p_order_patch ->> 'sent_po_date')::date else po.sent_po_date end,
    vendor_delivery_date    = case when p_order_patch ? 'vendor_delivery_date'
                                   then (p_order_patch ->> 'vendor_delivery_date')::date else po.vendor_delivery_date end,
    booking_state           = case when p_order_patch ? 'booking_state'
                                   then nullif(btrim(coalesce(p_order_patch ->> 'booking_state','')),'') else po.booking_state end,
    etd                     = case when p_order_patch ? 'etd'
                                   then (p_order_patch ->> 'etd')::date else po.etd end,
    eta                     = case when p_order_patch ? 'eta'
                                   then (p_order_patch ->> 'eta')::date else po.eta end,
    warehouse_date          = case when p_order_patch ? 'warehouse_date'
                                   then (p_order_patch ->> 'warehouse_date')::date else po.warehouse_date end,
    container_booking_group = case when p_order_patch ? 'container_booking_group'
                                   then nullif(btrim(coalesce(p_order_patch ->> 'container_booking_group','')),'') else po.container_booking_group end,
    mbl                     = case when p_order_patch ? 'mbl'
                                   then nullif(btrim(coalesce(p_order_patch ->> 'mbl','')),'') else po.mbl end,
    close_tracking          = case when p_order_patch ? 'close_tracking'
                                   then coalesce((p_order_patch ->> 'close_tracking')::boolean, false) else po.close_tracking end,
    metadata                = case when p_order_patch ? 'metadata'
                                   then po.metadata || (p_order_patch -> 'metadata') else po.metadata end,
    void_reason             = case when p_order_patch ? 'void_reason'
                                   then nullif(btrim(coalesce(p_order_patch ->> 'void_reason','')),'') else po.void_reason end,
    voided_at               = case when p_order_patch ? 'voided'
                                   then case when (p_order_patch ->> 'voided')::boolean then now() else null end
                                   else po.voided_at end,
    voided_by               = case when p_order_patch ? 'voided'
                                   then case when (p_order_patch ->> 'voided')::boolean then v_actor else null end
                                   else po.voided_by end,
    updated_at              = now()
  where po.id = p_order_id;

  if p_line_patches is not null and jsonb_typeof(p_line_patches) = 'array' then
    for v_patch in select * from jsonb_array_elements(p_line_patches)
    loop
      perform plm.assert_dam_order_keys(v_patch, plm.dam_order_allowed_line_keys(), 'line');

      v_line_id := (v_patch ->> 'id')::uuid;
      if v_line_id is null then
        raise exception 'update_dam_order: every line patch needs an id' using errcode = '22023';
      end if;

      update plm.production_order_line pol set
        line_number        = case when v_patch ? 'line_number' then nullif(btrim(coalesce(v_patch->>'line_number','')),'') else pol.line_number end,
        sku                = case when v_patch ? 'sku' then nullif(btrim(coalesce(v_patch->>'sku','')),'') else pol.sku end,
        quantity_ordered   = case when v_patch ? 'quantity_ordered' then (v_patch->>'quantity_ordered')::numeric else pol.quantity_ordered end,
        quantity_shipped   = case when v_patch ? 'quantity_shipped' then (v_patch->>'quantity_shipped')::numeric else pol.quantity_shipped end,
        unit_cost          = case when v_patch ? 'unit_cost' then (v_patch->>'unit_cost')::numeric else pol.unit_cost end,
        status             = case when v_patch ? 'status' then nullif(btrim(coalesce(v_patch->>'status','')),'') else pol.status end,
        order_person       = case when v_patch ? 'order_person' then nullif(btrim(coalesce(v_patch->>'order_person','')),'') else pol.order_person end,
        order_type         = case when v_patch ? 'order_type' then nullif(btrim(coalesce(v_patch->>'order_type','')),'') else pol.order_type end,
        customer_suffix    = case when v_patch ? 'customer_suffix' then nullif(btrim(coalesce(v_patch->>'customer_suffix','')),'') else pol.customer_suffix end,
        customer_po_number = case when v_patch ? 'customer_po_number' then nullif(btrim(coalesce(v_patch->>'customer_po_number','')),'') else pol.customer_po_number end,
        assortment_id      = case when v_patch ? 'assortment_id' then nullif(btrim(coalesce(v_patch->>'assortment_id','')),'') else pol.assortment_id end,
        assortment_component_ordinal = case when v_patch ? 'assortment_component_ordinal' then (v_patch->>'assortment_component_ordinal')::integer else pol.assortment_component_ordinal end,
        order_depth_inches = case when v_patch ? 'order_depth_inches' then (v_patch->>'order_depth_inches')::numeric else pol.order_depth_inches end,
        case_pack          = case when v_patch ? 'case_pack' then (v_patch->>'case_pack')::numeric else pol.case_pack end,
        cases_reported     = case when v_patch ? 'cases_reported' then (v_patch->>'cases_reported')::numeric else pol.cases_reported end,
        ship_to            = case when v_patch ? 'ship_to' then nullif(btrim(coalesce(v_patch->>'ship_to','')),'') else pol.ship_to end,
        start_ship_date    = case when v_patch ? 'start_ship_date' then (v_patch->>'start_ship_date')::date else pol.start_ship_date end,
        start_ship_raw     = case when v_patch ? 'start_ship_raw' then nullif(btrim(coalesce(v_patch->>'start_ship_raw','')),'') else pol.start_ship_raw end,
        cancel_date        = case when v_patch ? 'cancel_date' then (v_patch->>'cancel_date')::date else pol.cancel_date end,
        cancel_raw         = case when v_patch ? 'cancel_raw' then nullif(btrim(coalesce(v_patch->>'cancel_raw','')),'') else pol.cancel_raw end,
        cargo_forecast_date= case when v_patch ? 'cargo_forecast_date' then (v_patch->>'cargo_forecast_date')::date else pol.cargo_forecast_date end,
        cargo_forecast_raw = case when v_patch ? 'cargo_forecast_raw' then nullif(btrim(coalesce(v_patch->>'cargo_forecast_raw','')),'') else pol.cargo_forecast_raw end,
        test_report        = case when v_patch ? 'test_report' then nullif(btrim(coalesce(v_patch->>'test_report','')),'') else pol.test_report end,
        professional_photos= case when v_patch ? 'professional_photos' then nullif(btrim(coalesce(v_patch->>'professional_photos','')),'') else pol.professional_photos end,
        contractual_sample_reorder = case when v_patch ? 'contractual_sample_reorder' then coalesce((v_patch->>'contractual_sample_reorder')::boolean,false) else pol.contractual_sample_reorder end,
        source_style_type  = case when v_patch ? 'source_style_type' then nullif(btrim(lower(coalesce(v_patch->>'source_style_type',''))),'') else pol.source_style_type end,
        metadata           = case when v_patch ? 'metadata' then pol.metadata || (v_patch->'metadata') else pol.metadata end,
        void_reason        = case when v_patch ? 'void_reason' then nullif(btrim(coalesce(v_patch->>'void_reason','')),'') else pol.void_reason end,
        voided_at          = case when v_patch ? 'voided'
                                  then case when (v_patch->>'voided')::boolean then now() else null end
                                  else pol.voided_at end,
        voided_by          = case when v_patch ? 'voided'
                                  then case when (v_patch->>'voided')::boolean then v_actor else null end
                                  else pol.voided_by end,
        updated_at         = now()
      where pol.id = v_line_id
        and pol.production_order_id = p_order_id;

      get diagnostics v_hit = row_count;
      if v_hit = 0 then
        raise exception 'update_dam_order: line % does not belong to order %', v_line_id, p_order_id
          using errcode = 'P0002';
      end if;
    end loop;
  end if;

  return p_order_id;
end;
$$;

-- --- link ---------------------------------------------------------------------------
-- The whole safety of the OrderList feature sits in this function. It is the ONLY way
-- an order line gets an item_id, and it refuses anything that is not an exact, unique,
-- type-correct resolution.
create or replace function public.link_dam_order_line(
  p_line_id      uuid,
  p_item_id      uuid,
  p_match_status text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = plm, public, core, app, pg_temp
as $$
declare
  v_actor      uuid := auth.uid();
  v_sku_norm   text;
  v_type       text;
  v_candidates int;
begin
  if v_actor is null then
    raise exception 'link_dam_order_line: authentication required' using errcode = '42501';
  end if;

  select pol.sku_normalized, pol.source_style_type
    into v_sku_norm, v_type
  from plm.production_order_line pol
  where pol.id = p_line_id;

  if not found then
    raise exception 'link_dam_order_line: line % not found', p_line_id using errcode = 'P0002';
  end if;

  -- Unlinking. Allowed, but the row must then say so honestly.
  if p_item_id is null then
    if p_match_status not in ('unmatched', 'ambiguous', 'not_applicable') then
      raise exception 'link_dam_order_line: clearing the item requires match status unmatched, ambiguous or not_applicable, got %', p_match_status
        using errcode = '23514';
    end if;
    update plm.production_order_line
       set item_id = null,
           master_data_match_status = p_match_status,
           metadata = metadata || jsonb_build_object('last_relinked_by', v_actor, 'last_relinked_at', now()),
           updated_at = now()
     where id = p_line_id;
    return p_line_id;
  end if;

  if p_match_status not in ('matched', 'manual') then
    raise exception 'link_dam_order_line: setting an item requires match status matched or manual, got %', p_match_status
      using errcode = '23514';
  end if;

  if v_sku_norm is null then
    raise exception 'link_dam_order_line: line % has no SKU, so no product can be resolved for it', p_line_id
      using errcode = '23514';
  end if;

  if v_type is null then
    raise exception 'link_dam_order_line: line % has no licensed/generic discriminator, so the eligible Master Data catalog is unknown', p_line_id
      using errcode = '23514';
  end if;

  if not exists (select 1 from plm.item where id = p_item_id) then
    raise exception 'link_dam_order_line: item % does not exist', p_item_id using errcode = 'P0002';
  end if;

  -- Exact, unique, type-qualified resolution through the style bridge. Trim + case-fold
  -- only. Zero candidates and two candidates are BOTH failures: an ambiguous SKU must
  -- stay visibly ambiguous rather than be resolved by picking one.
  select count(*)
    into v_candidates
  from plm.style_tracker_item_bridge b
  join public.style_tracker_rows r on r.id = b.style_tracker_row_id
  where b.plm_item_id  = p_item_id
    and b.tracker_type = v_type
    and nullif(btrim(lower(r.sku)), '') = v_sku_norm;

  if v_candidates = 0 then
    raise exception 'link_dam_order_line: SKU % (%) does not resolve to item % through the % Master Data catalog', v_sku_norm, v_type, p_item_id, v_type
      using errcode = '23514';
  elsif v_candidates > 1 then
    raise exception 'link_dam_order_line: SKU % (%) resolves to % Master Data rows for item %; ambiguity must be reviewed, not guessed', v_sku_norm, v_type, v_candidates, p_item_id
      using errcode = '23514';
  end if;

  update plm.production_order_line
     set item_id = p_item_id,
         master_data_match_status = p_match_status,
         metadata = metadata || jsonb_build_object('last_relinked_by', v_actor, 'last_relinked_at', now()),
         updated_at = now()
   where id = p_line_id;

  return p_line_id;
end;
$$;

revoke all on function public.create_dam_order(jsonb, jsonb)          from public, anon;
revoke all on function public.update_dam_order(uuid, jsonb, jsonb)    from public, anon;
revoke all on function public.link_dam_order_line(uuid, uuid, text)   from public, anon;

grant execute on function public.create_dam_order(jsonb, jsonb)        to authenticated, service_role;
grant execute on function public.update_dam_order(uuid, jsonb, jsonb)  to authenticated, service_role;
grant execute on function public.link_dam_order_line(uuid, uuid, text) to authenticated, service_role;

comment on function public.create_dam_order(jsonb, jsonb) is
  'PopDAM OrderList create. Whitelisted fields only; item links are NOT settable here (use link_dam_order_line).';
comment on function public.update_dam_order(uuid, jsonb, jsonb) is
  'PopDAM OrderList update. Partial patch: only keys present in the payload are written. Pass {"voided": true, "void_reason": "..."} to void instead of deleting.';
comment on function public.link_dam_order_line(uuid, uuid, text) is
  'The only path to plm.production_order_line.item_id. Requires an exact, unique, licensed/generic-qualified SKU resolution through plm.style_tracker_item_bridge. Never fuzzy.';

commit;
