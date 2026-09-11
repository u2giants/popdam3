-- =====================================================================================
-- Issue #2175 - ColdLion landing UNIT 5a: the two remainder feeds whose grain is proven.
--
-- Tracker: #2081. Plan: plan_coldlion_landing_schema_completion.md section 9 Step 6.
-- Author lane claim: #2184. Structure only; this migration loads no rows and creates
-- no loader.
--
-- WHAT THIS ADDS
-- --------------
--   coldlion.inventory      /inventory     - warehouse stock position, paged envelope
--   coldlion.prod_tracking  /prodtracking  - open production orders, BARE ARRAY
--
-- Both hang off the phase-1 spine (20260818232639) and follow the phases 2-6 landing
-- conventions (20260825023430): ColdLion field names transliterated to snake_case, no
-- per-row raw archive (D5), no foreign keys into core.*, no application grants, a
-- current-state source_hash over the complete fetched record before projection, and
-- first_seen_at / last_seen_at bookkeeping.
--
-- EVIDENCE. THE SPEC IS NOT THE CONTRACT.
-- ---------------------------------------
-- GET /EhpApi/v2/api-docs types BOTH of these feeds as a bare {"type":"object"}: 14 of
-- its 16 GET feeds are untyped, and where it DOES type a feed it is wrong (both history
-- feeds are declared as raw arrays but live-return a Spring Page envelope). Every column
-- and every constraint below comes from live sampling on 2026-09-02, recorded in
-- docs/coldlion-unit-5a-grain-proof-20260902.md. A loader built on this schema must key
-- its unknown-field refusal to that SAMPLED SHAPE and never to /api-docs.
--
-- GRAIN PROOF 1 - /inventory. Whole population, not a sample: five pages, 8,754 of 8,754
-- rows for companyCode=EDGEHOME, 12 fields in the union, zero nulls in any field.
--   * (item_pkey, warehouse_code) is unique across all 8,754 rows.
--   * item_pkey ALONE is NOT unique (7,412 / 8,754) - one item sits in many warehouses.
--   * The descriptive tuple (division, itemNo, color, size, dim, label, prepack,
--     warehouse) is ALSO NOT unique (8,499 / 8,754). Those columns describe the row;
--     they do not identify it. itemPkey does.
-- The payload carries NO companyCode, so company_code is stamped from the request and
-- leads the primary key - two companies could otherwise collide on one itemPkey.
--
-- GRAIN PROOF 2 - /prodtracking. Also whole population, for a reason that matters:
--   ** THE FILTER PARAMETERS ARE INERT. ** Three probes - companyCode=EDGEHOME with a
--   June-2026 window, companyCode=SPRUCE with a January-2019 window, and no parameters
--   at all - returned three byte-identical 4,885,440-byte bodies (equal SHA-256). The
--   feed is a full snapshot of 3,922 rows spanning prodOrderDate 2019-05-03 to
--   2026-09-02 across all three company codes, every time. There is no incremental
--   window here and no page envelope, so window_ledger has nothing to record for it. A
--   loader must treat every pull as a complete replacement snapshot.
--   * 51 fields in the union across all 3,922 rows. The 2026-09-02 census on #2081 said
--     52; re-derived at authoring time it is 51. Neither number is a contract - re-derive
--     again before the loader lands.
--   * companyCode IS present in this payload (unlike /inventory).
--   * (company_code, prod_order_no) identifies a row: 3,917 distinct over 3,922 rows.
--     The 5 collisions are five pairs of rows with ZERO differing fields - byte-identical
--     duplicate emissions, not two versions of one order. That is the only duplicate
--     collapse this table performs and it is measured, not assumed, so the primary key is
--     natural and is not a guess. If a future pull ever produces two rows sharing that key
--     with DIFFERENT payloads the upsert is no longer safe and this grain must be
--     re-proven before loading.
--
-- SOURCE RULES CARRIED FORWARD FROM THE SPINE
-- -------------------------------------------
--   * 1900-01-01 is ColdLion's empty-date marker. Typed date columns store NULL for it.
--     Live proof in this feed: cancel_date, start_date and order_date carry the marker on
--     3,911 of 3,922 rows and ship_date on 790. A loader that stores 1900-01-01 as a real
--     date turns "no date" into "shipped in 1900" on 99.7% of the table.
--   * ColdLion sends '' where other systems send null. All 12 /inventory fields and all
--     51 /prodtracking fields were non-null in the full population, but blanks are common
--     (dim_code 1,891, prepack_code 1,593 and label_code 732 of 8,754 on /inventory;
--     lc_no, freight_forwarder_code and season_code blank on ALL 3,922 prod_tracking
--     rows). Text columns are therefore nullable and are NOT check-constrained non-blank:
--     the landing layer records what arrived.
--
-- TWO THINGS DELIBERATELY NOT DONE
-- --------------------------------
--   * NO EP001 EXCLUSION CHECK. The phases 2-6 tables carry check (division_code <> 'EP001')
--     because those feeds are curated-master shaped. Both of these feeds actually CONTAIN
--     EP001 rows today, so the same check would make faithful landing impossible and would
--     fail the load rather than filter it. EP001 handling stays a loader contract.
--     Related trap for whoever writes that loader: division_code arrives in both casings -
--     'CW001' and 'cw001' are both live in both feeds. Nothing here normalises it.
--   * NO IMAGE-CONTENT TABLE, here or ever (owner decision). PopDAM is the image source.
-- =====================================================================================

do $$ begin
  if to_regclass('coldlion.sync_run') is null then
    raise exception 'ColdLion phase 1 spine is required before unit 5a';
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- coldlion.inventory - GET /inventory (paged Spring envelope)
-- -------------------------------------------------------------------------------------
create table coldlion.inventory (
  -- Identity. company_code is request-stamped: the payload does not carry it.
  company_code   text   not null,
  item_pkey      bigint not null,
  warehouse_code text   not null,

  -- Descriptive projection of the remaining nine sampled fields. Proven NOT to identify
  -- the row (8,499 distinct tuples over 8,754 rows) - see GRAIN PROOF 1 above.
  division_code  text,
  item_no        text,
  color_code     text,
  size_code      text,
  dim_code       text,
  label_code     text,
  prepack_code   text,
  warehouse_sku  text,
  inventory_qty  numeric,
  inventory_cost numeric,

  run_id      uuid        not null references coldlion.sync_run(id),
  fetched_at  timestamptz not null,
  source_hash text        not null check (source_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null,
  last_seen_at  timestamptz not null,

  primary key (company_code, item_pkey, warehouse_code),
  check (last_seen_at >= first_seen_at)
);

comment on table coldlion.inventory is
  'ColdLion GET /inventory landing table (issue #2175, unit 5a). One row per company + itemPkey + warehouseCode; proven unique over the whole 8,754-row EDGEHOME population on 2026-09-02, while itemPkey alone (7,412 distinct) and the full descriptive tuple (8,499) are both NOT unique. Twelve source fields, paged Spring envelope. company_code is stamped from the request because the payload omits it. Contains EP001 rows; no exclusion is enforced here. Grain proof: docs/coldlion-unit-5a-grain-proof-20260902.md.';

comment on column coldlion.inventory.company_code is
  'Stamped from the request, NOT from the payload - /inventory returns no companyCode. It leads the primary key so two companies cannot collide on one itemPkey.';
comment on column coldlion.inventory.item_pkey is
  'ColdLion itemPkey. The only proven identifier in this feed. Not unique on its own: one item is stocked in many warehouses.';
comment on column coldlion.inventory.warehouse_code is
  'ColdLion warehouseCode. Part of identity. A blank warehouse code is live in the source and is recorded as sent, so this column is not constrained non-blank.';
comment on column coldlion.inventory.warehouse_sku is
  'ColdLion warehouseSku. Frequently equal to itemNo but not proven to be, and not unique per warehouse (division + sku + warehouse gave 1,905 distinct over a 2,000-row page). Descriptive only - never join on it.';
comment on column coldlion.inventory.inventory_qty is
  'Signed. Negative quantities are live in the source (8 rows in the 8,754-row population) and are recorded as sent, not clamped.';

-- No secondary indexes are created here. The declared write scope for issue #2175 is
-- these two tables and nothing else, both tables are empty until a loader exists, and
-- the phases 2-6 landing tables carry none either. Index them when a loader or a
-- consumer contract shows a real access path, under its own claim.

-- -------------------------------------------------------------------------------------
-- coldlion.prod_tracking - GET /prodtracking (BARE ARRAY, no envelope, inert filters)
-- -------------------------------------------------------------------------------------
create table coldlion.prod_tracking (
  -- Identity, both from the payload. See GRAIN PROOF 2 above.
  company_code  text   not null,
  prod_order_no bigint not null,

  division_code     text,
  prod_reference_no text,
  prod_rev_no       text,
  prod_type_code    text,
  prod_cost_type    text,
  prod_country      text,
  sales_order_no    bigint,
  season_code       text,
  warehouse_code    text,

  vendor_code         text,
  vendor_desc         text,
  vendor_confirm      text,
  vendor_confirm_date date,
  fty_sales_rep       text,

  customer_code  text,
  customer_desc  text,
  customer_po_no text,

  currency_code   text,
  pay_term_code   text,
  deposit_paid    numeric,
  deposit_balance numeric,
  prod_qty        numeric,
  wip_qty         numeric,

  arrival_port_code      text,
  ship_port_code         text,
  container_no           text,
  freight_forwarder_code text,
  lc_no                  text,

  hang_tags_ordered      text,
  hang_tag_ordered_date  date,
  hang_tag_received      text,
  hang_tag_received_date date,

  prod_order_date       date,
  prod_rev_date         date,
  order_date            date,
  start_date            date,
  due_date              date,
  orig_due_date         date,
  ship_date             date,
  orig_ship_date        date,
  ship_cancel_date      date,
  orig_ship_cancel_date date,
  cancel_date           date,
  fema_exp_date         date,
  nbc_exp_date          date,

  created_time timestamptz,
  created_user text,
  mod_time     timestamptz,
  mod_user     text,

  run_id      uuid        not null references coldlion.sync_run(id),
  fetched_at  timestamptz not null,
  source_hash text        not null check (source_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null,
  last_seen_at  timestamptz not null,

  primary key (company_code, prod_order_no),
  check (last_seen_at >= first_seen_at)
);

comment on table coldlion.prod_tracking is
  'ColdLion GET /prodtracking landing table (issue #2175, unit 5a). Open-production-order grain, one row per company + prodOrderNo, proven over the entire 3,922-row feed on 2026-09-02. THE FILTER PARAMETERS ARE INERT: companyCode and fromDate/toDate are ignored and every request returns the identical full snapshot (three probes, byte-identical bodies), so every pull is a complete replacement and window_ledger has nothing to record. Bare JSON array - NO page envelope. 51 source fields as sampled; the #2081 census said 52, so re-derive before the loader lands. Grain proof: docs/coldlion-unit-5a-grain-proof-20260902.md.';

comment on column coldlion.prod_tracking.prod_order_no is
  'ColdLion prodOrderNo. With company_code this is a MEASURED natural key, not a guess: 3,917 distinct over 3,922 rows, and every one of the 5 collisions is a pair of rows with zero differing fields - byte-identical duplicate emissions. That is the only duplicate collapse this table performs. Two rows sharing this key with DIFFERENT payloads would invalidate the grain and must stop the load, not overwrite.';
comment on column coldlion.prod_tracking.division_code is
  'Recorded exactly as sent. Both casings are live in this feed (CW001 and cw001); nothing here normalises them.';
comment on column coldlion.prod_tracking.customer_po_no is
  'ColdLion field name is customerPONo. Blank on 3,637 of 3,922 rows sampled.';
comment on column coldlion.prod_tracking.lc_no is
  'ColdLion field name is lcno (no separator). Blank on all 3,922 rows sampled.';
comment on column coldlion.prod_tracking.order_date is
  'Almost always the 1900-01-01 empty-date marker (3,911 of 3,922 rows), which lands as NULL. Do not read an absent order date as an old one.';
comment on column coldlion.prod_tracking.ship_date is
  'The 1900-01-01 empty-date marker on 790 of 3,922 rows lands as NULL. Presence of a ship date is not proof of shipment.';
comment on column coldlion.prod_tracking.customer_desc is
  'Customer NAME as sent by ColdLion. Landing-layer evidence only: this schema has no application grants, and no promotion may expose it without an owner ruling.';

-- -------------------------------------------------------------------------------------
-- No application role may read or mutate the landing layer (spine rule, unchanged).
--
-- Written out statically, one statement per table, rather than as the `execute format`
-- loop the phases 2-6 migration used. Two named tables need no dynamic SQL, and every
-- statement below is readable in the diff and verifiable in the catalog by name.
-- -------------------------------------------------------------------------------------
alter table coldlion.inventory enable row level security;
revoke all on table coldlion.inventory from public, anon, authenticated;
grant all on table coldlion.inventory to service_role;

alter table coldlion.prod_tracking enable row level security;
revoke all on table coldlion.prod_tracking from public, anon, authenticated;
grant all on table coldlion.prod_tracking to service_role;
