-- Migration: 20260928211543_coldlion_order_intake_staging.sql
-- Claim:     issue #3679 (db-work), author-lane claim #3680, version reserved
--            atomically by scripts/manage-migration-author-lanes.mjs.
-- Plan:      plan_coldlion_order_intake.md §9 Phase A1.
-- derived-from: none
-- Creates six new tables from scratch; rewrites no earlier object. Authority:
--            docs/business-rules/erp-orders-and-source-meaning.md §"How a new
--            order enters the system (OrderList intake)" (Settled 2026-09-17).
-- =====================================================================================
-- WHAT THIS BUILDS
-- =====================================================================================
-- The UNSEALED intake staging layer for the ColdLion automatic order intake: the
-- current-window + forward-horizon poll that replaces Adam's manual Google
-- OrderList typing. It is COMPLETELY SEPARATE from the sealed-window history
-- machinery: nothing here writes coldlion.window_ledger, the page-evidence
-- tables, or the sealed order_history_*/prod_history_* tables. coldlion.sync_run
-- is the one deliberately shared table (plan §8): the intake records its runs
-- there with requested_by = 'coldlion-order-intake' and grid-aligned windows.
--
-- Staging mirrors the sealed order_history_line/_component projection grain and
-- identity keys VERBATIM (20260905105038:547-662), minus the ledger machinery,
-- with run_id replaced by the only two mutable columns this design allows:
-- first_seen_run / last_seen_run. A changed projection (source_hash change)
-- INSERTS a new version row; an identical re-observation updates last_seen_run
-- and nothing else. The C2 winner rule therefore picks the most recently
-- observed version, and the two-key tiebreak (last_seen_run, then
-- *_source_hash) exists so two runs can never disagree about which version wins.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. intake_window_state - one row per scanned window per track
-- -------------------------------------------------------------------------------------
-- Upserted bookkeeping, never locked, no ledger coupling. The trailing track
-- re-reads the last 3 closed grid windows + the open current week; the forward
-- track scans ahead until two consecutive empty from_date-months (Settled
-- ruling 2026-09-17: "API calls are cheap") with the plan's own 18-month
-- bounded-cost cap.

create table coldlion.intake_window_state (
  track text not null
    constraint coldlion_intake_window_state_track_domain
    check (track in ('trailing', 'forward')),
  from_date date not null,
  to_date   date not null,

  last_run  uuid constraint coldlion_intake_window_state_last_run_fkey
    references coldlion.sync_run(id),
  last_status ingest.sync_status,

  rows_fetched   integer not null default 0,
  rows_staged    integer not null default 0,
  rows_excluded  integer not null default 0,
  new_orders     integer not null default 0,

  last_completed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint coldlion_intake_window_state_pk
    primary key (track, from_date),
  constraint coldlion_intake_window_state_window_ordered
    check (to_date >= from_date),
  -- Same inclusive 7-day cap the API itself enforces and sync_run records
  -- (20260818232639): a wider window is a request that cannot have succeeded.
  constraint coldlion_intake_window_state_window_within_seven_days
    check ((to_date - from_date) <= 6),
  constraint coldlion_intake_window_state_counts_non_negative
    check (rows_fetched >= 0 and rows_staged >= 0 and rows_excluded >= 0
           and new_orders >= 0)
);

comment on table coldlion.intake_window_state is
  'Unsealed per-window bookkeeping for the ColdLion order-intake poll (issue #3679). One row per scanned 7-day grid window per track. Deliberately NOT the sealed window_ledger: it never locks a window, and the current/open week is scanned repeatedly. Forward-track stop rule: two consecutive from_date-months staging zero new rows (Settled 2026-09-17), bounded by the 18-month hard cap that is this plan''s own decision, not part of the ruling.';

-- -------------------------------------------------------------------------------------
-- 2. intake_order_line - one VERSION of one sales-order line (unsealed)
-- -------------------------------------------------------------------------------------

create table coldlion.intake_order_line (
  -- Same surrogate parent-version rationale as the sealed table: the child grain
  -- needs one stable thing to point at, and a line''s identity includes its own
  -- content hash, so two differing projections are two VERSIONS, never one row.
  id uuid primary key default gen_random_uuid(),

  company_code text,
  sales_order_no bigint not null,
  -- 0 is the prepack-explosion marker (docs/business-rules/erp-data.md §10.4):
  -- the row has no line of its own; it is a piece of its parent''s line.
  sales_order_line_no integer not null,
  -- itemNo. On an exploded prepack row this is the PARENT assortment''s item
  -- number; the SKU actually shipped is on the component.
  master_item_no text not null,

  label_code text,
  pre_pack_code text,
  division_code text,
  customer_code text,
  customer_desc text,
  po_number text,
  sales_person_code1 text,
  start_date date,
  cancel_date date,

  -- PARENT TOTALS, repeated by the vendor on every exploded row. Stored once,
  -- never summed across components.
  line_qty numeric,
  line_cancelled_qty numeric,
  prepack_qty numeric,

  item_desc text,
  short_item_no text,
  brand_assurance_no text,
  warehouse_code text,
  prod_cost numeric,
  prod_reference_no text,

  line_source_hash text not null check (line_source_hash ~ '^[0-9a-f]{64}$'),

  -- The only mutable columns in this table (plan §8): an identical
  -- re-observation updates last_seen_run; everything else is insert-only.
  first_seen_run uuid not null
    constraint coldlion_intake_order_line_first_seen_run_fkey
    references coldlion.sync_run(id),
  last_seen_run  uuid not null
    constraint coldlion_intake_order_line_last_seen_run_fkey
    references coldlion.sync_run(id),

  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint coldlion_intake_order_line_no_non_negative
    check (sales_order_line_no >= 0),
  constraint coldlion_intake_order_line_division_not_ep001
    check (division_code is null or division_code <> 'EP001'),
  constraint coldlion_intake_order_line_identity_unique
    unique nulls not distinct
      (sales_order_no, sales_order_line_no, master_item_no, line_source_hash)
);

-- Winner selection for C2 step 0: greatest last_seen_run, then line_source_hash,
-- per identity prefix. The identity unique omits last_seen_run and cannot serve
-- this sort; the tiebreak key rides the same index so it never forces a second
-- sort. DESC on last_seen_run makes the winning version the first index entry
-- of each identity prefix.
create index coldlion_intake_order_line_winner_idx
  on coldlion.intake_order_line
  (sales_order_no, sales_order_line_no, master_item_no, last_seen_run desc,
   line_source_hash);

-- Run-FK lookups need leading keys, matching how the sealed tables index run_id
-- (20260905105038:666-669); a btree trailing key does not serve
-- WHERE last_seen_run = $run_id.
create index coldlion_intake_order_line_first_seen_run_idx
  on coldlion.intake_order_line (first_seen_run);
create index coldlion_intake_order_line_last_seen_run_idx
  on coldlion.intake_order_line (last_seen_run);

comment on table coldlion.intake_order_line is
  'One version of one ColdLion sales-order line, staged by the unsealed intake poll (issue #3679). Same projection grain and identity as sealed coldlion.order_history_line minus the ledger machinery. Append-only except last_seen_run: a changed projection is a NEW version row, never an in-place rewrite. The intake never writes the sealed tables; the daily sealed sync stays the authority for closed windows and the two pipelines converge by shared identity + source hash. EP001 (Edgeucational) is excluded here at ingestion AND by constraint, the sealed tables'' exact nullable form.';

-- -------------------------------------------------------------------------------------
-- 3. intake_order_component - one component design of one staged line version
-- -------------------------------------------------------------------------------------

create table coldlion.intake_order_component (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null
    constraint coldlion_intake_order_component_line_fkey
    references coldlion.intake_order_line(id) on delete cascade,

  -- The real SKU is COALESCE(NULLIF(subItemNo,''), itemNo) at read time. NULL
  -- here means a non-prepack row whose SKU is the parent''s master_item_no;
  -- empty strings normalise to NULL and the identity is NULLS NOT DISTINCT.
  sub_item_no text,
  sub_label_code text,
  sub_upc text,

  -- PER-DESIGN facts. linePrice is per component, not per line.
  line_price numeric,
  quantity numeric,
  order_qty numeric,
  invoice_qty numeric,
  ship_qty numeric,
  order_amount numeric,
  ship_amount numeric,

  sub_merch_group01 text, sub_merch_group02 text, sub_merch_group03 text,
  sub_merch_group04 text, sub_merch_group05 text, sub_merch_group06 text,
  merch_group01 text, merch_group02 text, merch_group03 text,
  merch_group04 text, merch_group05 text, merch_group06 text,

  invoice_no_string text,
  invoice_date_string text,
  pick_ticket_no_string text,
  document_list_cardinality_mismatch boolean not null default false,

  component_source_hash text not null check (component_source_hash ~ '^[0-9a-f]{64}$'),

  first_seen_run uuid not null
    constraint coldlion_intake_order_component_first_seen_run_fkey
    references coldlion.sync_run(id),
  last_seen_run  uuid not null
    constraint coldlion_intake_order_component_last_seen_run_fkey
    references coldlion.sync_run(id),

  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint coldlion_intake_order_component_identity_unique
    unique nulls not distinct
      (line_id, sub_item_no, sub_label_code, component_source_hash)
);

create index coldlion_intake_order_component_line_idx
  on coldlion.intake_order_component (line_id);

create index coldlion_intake_order_component_winner_idx
  on coldlion.intake_order_component
  (line_id, sub_item_no, sub_label_code, last_seen_run desc,
   component_source_hash);

create index coldlion_intake_order_component_first_seen_run_idx
  on coldlion.intake_order_component (first_seen_run);
create index coldlion_intake_order_component_last_seen_run_idx
  on coldlion.intake_order_component (last_seen_run);

comment on table coldlion.intake_order_component is
  'One component design of one staged sales-order line version (issue #3679). order_qty is the per-SKU quantity ColdLion computes; line_qty on the parent is a PARENT TOTAL repeated on every component and is never a per-line quantity and never summed. Append-only except last_seen_run.';

-- -------------------------------------------------------------------------------------
-- 4. intake_new_order - the novelty queue
-- -------------------------------------------------------------------------------------
-- Detection is salesOrderNo novelty against canonical coldlion source refs
-- (plan §8): NOT presence in order_history_line, which would suppress every
-- order whose week has closed and been sealed. One row per sales order.

create table coldlion.intake_new_order (
  id uuid primary key default gen_random_uuid(),

  sales_order_no bigint not null,
  -- Deliberately NOT unique-negative-guarded here: rows with salesOrderNo = 0
  -- are quarantined at decode (C1) and never reach this table''s claim path;
  -- the constraint below refuses the collapse-on-one-header failure mode.
  first_seen_run uuid not null
    constraint coldlion_intake_new_order_first_seen_run_fkey
    references coldlion.sync_run(id),
  last_seen_run  uuid
    constraint coldlion_intake_new_order_last_seen_run_fkey
    references coldlion.sync_run(id),

  -- The most recently observed routing code for the order; decode joins
  -- routing_code_map at C1 and records the result here.
  warehouse_code text,
  decoded_order_type text,
  decoded_ship_to text,

  state text not null default 'pending'
    constraint coldlion_intake_new_order_state_domain
    check (state in ('pending', 'claimed', 'created', 'quarantined')),

  claim_evidence jsonb not null default '{}'::jsonb
    constraint coldlion_intake_new_order_claim_evidence_is_object
    check (jsonb_typeof(claim_evidence) = 'object'),

  created_at timestamptz not null default now(),
  state_changed_at timestamptz not null default now(),

  constraint coldlion_intake_new_order_sales_order_unique
    unique (sales_order_no),
  constraint coldlion_intake_new_order_so_not_zero
    check (sales_order_no <> 0)
);

create index coldlion_intake_new_order_state_idx
  on coldlion.intake_new_order (state);

comment on table coldlion.intake_new_order is
  'Novelty queue for the ColdLion order intake (issue #3679). A row appears when a staged salesOrderNo has NO canonical coldlion identity (no so-header source ref and no coldlion:so:<so>: line-ref prefix in plm). sales_order_no = 0 is refused outright: that value collapses every such row onto one header under unique (source_system, source_id) and is quarantined upstream instead. state: pending -> claimed/created, or quarantined; claim_evidence carries the deterministic refs.';

-- -------------------------------------------------------------------------------------
-- 5. routing_code_map - curated decode of warehouseCode
-- -------------------------------------------------------------------------------------
-- Order Type and Ship To are ONE ColdLion field (Settled, live-solved
-- 2026-09-17): the routing code in warehouseCode/warehouseDesc. This is the
-- curated decode; an unknown code goes to intake_quarantine, never a guess.
-- PK on code is load-bearing: the C1 decode join must be unambiguous.

create table coldlion.routing_code_map (
  code text constraint coldlion_routing_code_map_code_pkey primary key,
  description text not null,
  order_type text not null,
  ship_to text,
  is_poe_ddp_family boolean not null,
  notes text
);

comment on table coldlion.routing_code_map is
  'Curated decode of the ColdLion routing code (warehouseCode) into Order Type and Ship To (Settled 2026-09-17, issue #3679). warehouseCode - never prodTypeCode - matches the business meaning: the two disagree exactly on the orders that matter (Forman Mills / Shoppers World are DDPNJ, wrongly labelled POE on the sheet). Unknown codes quarantine at C1. COS/stock recognition is NOT here: that identity lives on the production side and intake performs none of it.';

-- Seed: the full observed vocabulary (business-rules routing table, observed
-- live 2026-09-17, sales and production sides). Deterministic PKs make the
-- seed idempotent.
insert into coldlion.routing_code_map
  (code, description, order_type, ship_to, is_poe_ddp_family, notes)
values
  ('FOB',    'FOB',               'FOB',    null,       false,
   'Origin port (Ningbo/Xiamen/Qingdao/Shanghai) is NOT in the code; added sheet-side. FOB Ship To stays human until shipPortCode populates (Phase 2, /prodtracking).'),
  ('POECA',  'POE CALIFORNIA',    'POE',    'LA',       true,
   'Burlington, DD''s Discounts (true POE LA).'),
  ('POEGA',  'POE GA Savannah',   'POE',    'SAVANNAH', true, null),
  ('POEVA',  'POE GA Norfolk',    'POE',    'NORFOLK',  true,
   'Code says VA, description says GA - as returned by the ERP.'),
  ('POE',    'POE',               'POE',    null,       true,
   'Bare port-of-entry code, destination unstated; ship_to NULL stays human.'),
  ('DDPNJ',  'DDP New Jersey',    'DDP',    'NJ',       true,
   'Forman Mills and Shoppers World ride this code although their sheet rows say POE+NJ; the ERP is more correct than the sheet column it replaces.'),
  ('DDPMD',  'DDP Maryland',      'DDP',    'MD',       true,
   'State expansion from the code; description as observed live 2026-09-17.'),
  ('DDPPA',  'DDP Pennsylvania',  'DDP',    'PA',       true, null),
  ('DDPOH',  'DDP Ohio',          'DDP',    'OH',       true, null),
  ('DDPNC',  'DDP North Carolina','DDP',    'NC',       true, null),
  ('DDPCA',  'DDP California',    'DDP',    'CA',       true, null),
  ('DDPGA',  'DDP Georgia',       'DDP',    'GA',       true,
   'Spencer Gifts uses the DDP-state family.'),
  ('MDDP',   'MDDP',              'MDDP',   'NINGBO',   true,
   'DDP variant; the expansion is Unknown (sheet pairs it with NINGBO). Distinct code, not a catch-all DDP label.'),
  ('DES001', 'Deco Signs',        'DES001', null,       false,
   'Drop-ship/destination code; no sheet Order Type equivalent recorded - kept as its own visible value, human-correctable via this curated table.'),
  ('ANT001', 'ANTHONY''S WAREHOUSE','ANT001', null,     false,
   'POP-side warehouse.'),
  ('WMFC',   'Walmart Fulfillment Center', 'WMFC', null, false, null)
on conflict (code) do nothing;

-- -------------------------------------------------------------------------------------
-- 6. intake_quarantine - visible failures, never silent
-- -------------------------------------------------------------------------------------

create table coldlion.intake_quarantine (
  id uuid primary key default gen_random_uuid(),

  -- Machine-readable reason key: unknown-routing-code | sales-order-no-zero |
  -- customer-unresolvable | customer-disagreement | constancy-violation |
  -- claim-failure. One row per failure, with its evidence.
  reason text not null
    constraint coldlion_intake_quarantine_reason_not_blank
    check (length(btrim(reason)) > 0),
  sales_order_no bigint,
  routing_code text,

  -- Raw JSON evidence for the failure: the offending payload fragment or the
  -- conflicting values. Counts and refs only ever leave this table; licensed
  -- row contents stay here behind the closed posture below.
  detail jsonb not null default '{}'::jsonb
    constraint coldlion_intake_quarantine_detail_is_object
    check (jsonb_typeof(detail) = 'object'),

  first_seen_run uuid not null
    constraint coldlion_intake_quarantine_first_seen_run_fkey
    references coldlion.sync_run(id),
  created_at timestamptz not null default now()
);

create index coldlion_intake_quarantine_reason_idx
  on coldlion.intake_quarantine (reason);
create index coldlion_intake_quarantine_sales_order_idx
  on coldlion.intake_quarantine (sales_order_no);
create index coldlion_intake_quarantine_first_seen_run_idx
  on coldlion.intake_quarantine (first_seen_run);

comment on table coldlion.intake_quarantine is
  'Failed decode/claim rows from the ColdLion order intake (issue #3679). Every quarantine is a visible row with a reason and raw JSON evidence - no band-aids, no silent failures. Unknown routing codes, salesOrderNo = 0 rows (never COLDLION-SO-0), unresolvable or disagreeing customer lookups, and within-hash-group constancy violations land here.';

-- -------------------------------------------------------------------------------------
-- 7. Closed landing posture - append-only evidence precedent, not the bare
--    sealed-history grant-all
-- -------------------------------------------------------------------------------------
-- Plan §8: RLS on, nothing for public/anon/authenticated, service_role arwd,
-- and NO truncate/references/trigger/maintain. TRUNCATE bypasses row triggers -
-- the exact defect class 20260812020000 records for append-only evidence
-- tables. The sealed tables'' bare `grant all` (20260905105038:780-782) is a
-- known gap there, not authority to repeat it here.

alter table coldlion.intake_window_state      enable row level security;
alter table coldlion.intake_order_line        enable row level security;
alter table coldlion.intake_order_component   enable row level security;
alter table coldlion.intake_new_order         enable row level security;
alter table coldlion.routing_code_map         enable row level security;
alter table coldlion.intake_quarantine        enable row level security;

revoke all on table coldlion.intake_window_state    from public, anon, authenticated;
revoke all on table coldlion.intake_order_line      from public, anon, authenticated;
revoke all on table coldlion.intake_order_component from public, anon, authenticated;
revoke all on table coldlion.intake_new_order       from public, anon, authenticated;
revoke all on table coldlion.routing_code_map       from public, anon, authenticated;
revoke all on table coldlion.intake_quarantine      from public, anon, authenticated;

grant all on table coldlion.intake_window_state    to service_role;
grant all on table coldlion.intake_order_line      to service_role;
grant all on table coldlion.intake_order_component to service_role;
grant all on table coldlion.intake_new_order       to service_role;
grant all on table coldlion.routing_code_map       to service_role;
grant all on table coldlion.intake_quarantine      to service_role;

revoke truncate, references, trigger, maintain
  on table coldlion.intake_window_state    from service_role;
revoke truncate, references, trigger, maintain
  on table coldlion.intake_order_line      from service_role;
revoke truncate, references, trigger, maintain
  on table coldlion.intake_order_component from service_role;
revoke truncate, references, trigger, maintain
  on table coldlion.intake_new_order       from service_role;
revoke truncate, references, trigger, maintain
  on table coldlion.routing_code_map       from service_role;
revoke truncate, references, trigger, maintain
  on table coldlion.intake_quarantine      from service_role;
