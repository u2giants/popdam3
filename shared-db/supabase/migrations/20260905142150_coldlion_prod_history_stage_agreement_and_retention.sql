-- =====================================================================================
-- Issue #2174 - ColdLion landing unit 4: production-history redesign with three-stage
-- agreement and retention. Tracker #2081; plan `plan_coldlion_landing_schema_completion.md`
-- §9 Step 5. Claim #2394 reserves version 20260905142150 and exactly these objects:
--
--   coldlion.prod_history_line        (replaced by forward migration)
--   coldlion.prod_history_component   (replaced by forward migration)
--   coldlion.prod_history_last_lookup (replaced by forward migration)
--
-- derived-from: 20260825023430
--
-- The trigger functions created here exist only to enforce contracts of those three
-- tables that no CHECK constraint can express, because they span two rows or two
-- tables. They are part of the declared tables, not separately claimed objects.
--
-- EVIDENCE THIS MIGRATION IS BUILT ON
-- ---------------------------------------------------------------------------------
--  1. A STAGE-LESS /prodHistory REQUEST LOOKS COMPLETE AND IS NOT (objection U13,
--     re-confirmed live 2026-09-02 with a positive control on companyCode=EDGEHOME).
--     One seven-day window answered a stage-less call with 3 rows, ALL `ISS`, no error
--     and a plausible total, while an independent stageCode=INTRAN call returned 3
--     INTRAN rows for that same window and REC returned 0. Earlier: for 2026-08-03..09
--     the default returned 67 rows identical to ISS while REC returned 21 rows with
--     ZERO key overlap. Every window must therefore be fetched three times, once per
--     stage, and each of those requests paged to completion through the repaired ledger
--     from issue #2173. A no-stage request is an incomplete request, not a superset.
--  2. THE STAGE IS NOW RETURNED, SO IT IS ASSERTED AND NO LONGER STAMPED. ColdLion
--     added `stageCode` to the payload on 2026-08-26. Every probe since returned a
--     stage equal to the one requested. Both are stored and a mismatch aborts, because
--     the moment they can disagree, a stamped stage would be a fabricated one.
--  3. THERE ARE EXACTLY THREE STAGES - ISS, INTRAN, REC (ColdLion, 2026-08-19,
--     authoritative). There is no fourth stage and none is invented here.
--  4. `prodHistory` HAS NO divisionCode PARAMETER. Unlike /orderHistory it cannot be
--     narrowed, so division_code on these rows is payload-derived and is never read as
--     a request scope. EP001 is still refused by constraint.
--  5. prodLineSeq SEPARATES REAL BUY LINES. ColdLion added it on 2026-08-17 and it is
--     present on every one of 1,475 sampled rows. Distinct prodLineSeq values are
--     distinct purchases: order 90004 / ZZH4803 carried a 1,500-pack line and a
--     3,000-pack line on one order, and collapsing them erases a real purchase.
--  6. THE `last*` BLOCK IS A LOOKUP, NOT THE PURCHASE. Of 98 duplicate keys in two
--     March-2021 windows, 98 differed ONLY in `last*` fields and 0 in anything else.
--     The surviving fan-out is on `lastProdCost` - the same order line and component
--     carrying 3.00 and 3.60. `lastProdCost` IS NOT THE COST OF THIS ORDER; prodCost,
--     extCost and ppkDetailCost are. One copy is picked deterministically and recorded
--     as such; the copies are never aggregated or summed.
--  7. `salesOrderNo = 0` MEANS NO LINKED SALES ORDER (explained by ColdLion 2026-08-18:
--     hard linking began around 2022-23, and INTRAN/REC lines never carry the link).
--     It is data, not a missing key, and it is never a foreign key.
--  8. `1900-01-01` IS THE EMPTY-DATE MARKER (owner confirmation, Albert Hazan,
--     2026-08-14). Storing it as a real date makes every date-range report wrong, so
--     every date column here refuses it.
--  9. `depositPerc` is 0 in all rows tested and `totalProdCost` is 0 in 3,218 of 3,411.
--     They are ingested as the vendor sends them and neither is treated as a cost.
--
-- The `ProdHistory` property count is deliberately NOT written into this file. It has
-- moved more than once already and a count copied into a migration becomes a false
-- constant the day the vendor changes the feed. Field DISPOSITIONS come from
-- `docs/coldlion-field-decisions-20260819.csv`: every `ingest` prodHistory property is
-- carried here and every `ignore` one is absent.
--
-- NO foreign key from any of these tables to coldlion.item_header: discontinued
-- historical items are legitimately absent from the current item master. No FK into
-- core.*. No application grants. No raw column (D5). No loader: its runtime is not this
-- issue's to decide.
-- =====================================================================================

do $$ begin
  if to_regclass('coldlion.sync_run') is null or to_regclass('coldlion.window_ledger') is null then
    raise exception 'ColdLion phase 1 spine is required before issue #2174';
  end if;
  if to_regclass('coldlion.history_page_ledger') is null then
    raise exception
      'issue #2173 (stage- and page-scoped history ledger) is a hard prerequisite of #2174';
  end if;
end $$;

-- The 2026-09-02 census found all three tables empty, but application time is not
-- frozen at census time. Refuse rather than destroy evidence if any writer has
-- populated one of them before this migration is applied.
--
-- The emptiness proof and the DROP must be ONE atomic step. A bare `select exists`
-- takes only AccessShareLock, so a service_role writer (the old tables still carry
-- GRANT ALL) could INSERT and commit between the check and the DROP, and the DROP
-- would then destroy rows nothing ever looked at. Each table is therefore locked in
-- ACCESS EXCLUSIVE MODE first, re-checked while that lock is held, and dropped
-- without ever releasing it - the lock is held to the end of this transaction.
do $fn$
declare
  v_table regclass;
  v_has_rows boolean;
begin
  foreach v_table in array array[
    to_regclass('coldlion.prod_history_last_lookup'),
    to_regclass('coldlion.prod_history_component'),
    to_regclass('coldlion.prod_history_line')
  ] loop
    if v_table is not null then
      execute format('lock table %s in access exclusive mode', v_table);
      execute format('select exists (select 1 from %s limit 1)', v_table)
        into v_has_rows;
      if v_has_rows then
        raise exception
          'refusing to replace non-empty obsolete ColdLion production-history table %', v_table;
      end if;
      execute format('drop table %s', v_table);
    end if;
  end loop;
end;
$fn$;

-- Belt and braces for a table that did not exist above (nothing to lock, nothing to
-- lose): the named drops are no-ops after the guarded drops succeed.
drop table if exists coldlion.prod_history_last_lookup;
drop table if exists coldlion.prod_history_component;
drop table if exists coldlion.prod_history_line;

-- -------------------------------------------------------------------------------------
-- 1. coldlion.prod_history_line - the parent purchase-line version
-- -------------------------------------------------------------------------------------
--
-- The surrogate id exists because the two child grains need one stable thing to point
-- at, and because a line's identity includes its own content hash: two differing
-- projections of the same purchase line are two VERSIONS, never one merged row.

create table coldlion.prod_history_line (
  id uuid primary key default gen_random_uuid(),

  company_code text not null,
  prod_order_no bigint not null,
  -- Added upstream 2026-08-17 and populated on every sampled row. Distinct values are
  -- distinct real buy lines on one order and must never be merged.
  prod_line_seq bigint not null,

  -- THE THREE-STAGE AGREEMENT. `requested_stage_code` is the stage we asked for;
  -- `stage_code` is the stage the payload returned. Both are stored and the check
  -- below refuses a row where they differ - the assertion the issue requires.
  requested_stage_code text not null,
  stage_code text not null,

  division_code text,
  customer_code text,
  customer_desc text,
  prod_type_code text,

  ship_date date,
  ship_cancel_date date,
  orig_ship_date date,
  orig_due_date date,
  orig_ship_cancel_date date,
  prod_order_date date,
  due_date date,
  receive_date date,
  cust_start_date date,
  cust_cancel_date date,

  prod_country text,
  freight_forwarder_code text,
  warehouse_code text,
  vendor_code text,
  vendor_desc text,
  arrival_port_code text,

  -- 0 means NO LINKED SALES ORDER. Never a foreign key, never joined on.
  sales_order_no bigint,
  -- Derived, not asserted: it simply makes rule 7 readable and queryable instead of
  -- leaving every consumer to remember that 0 is a sentinel.
  sales_order_link_present boolean
    generated always as (sales_order_no is not null and sales_order_no <> 0) stored,

  prod_reference_no text,
  cust_po_number text,

  item_no text,
  item_desc text,
  short_item_no text,
  label_code text,
  pre_pack_code text,
  warehouse_sku text,

  -- PARENT TOTALS, stored once and never summed across components.
  prod_order_qty numeric,
  prepack_qty numeric,
  total_ppk_qty numeric,

  -- COSTS OF THIS ORDER. `last_prod_cost` is deliberately NOT among them; it lives on
  -- coldlion.prod_history_last_lookup and is a different production's cost.
  prod_cost numeric,
  ext_cost numeric,
  total_prod_cost numeric,
  deposit_perc numeric,

  -- COMPONENT QUANTITY ASSERTION. False until the loader has proven the component
  -- quantities against this parent's total; the guard below refuses to let it become
  -- true on anything less. It is evidence, not a flag anyone may simply set.
  component_quantities_asserted boolean not null default false,

  -- RETENTION ORDERING. `source_observed_at` is the deterministic observation timestamp
  -- the newest-three rule orders by; `source_version_seq` refines it when the loader
  -- has a vendor-side version; `line_source_hash` is the stable tie-breaker, and it is
  -- unique within a partition because it is part of the identity below.
  source_observed_at timestamptz not null,
  source_version_seq bigint,
  -- An initial backfill writes ONE baseline version. It is not reconstructed change
  -- history and the retention guard refuses to prune it.
  is_backfill_baseline boolean not null default false,
  -- Either flag stops pruning of the whole partition. Retention refuses when it cannot
  -- prove what "newest" or "the same line" means, rather than guessing.
  retention_ordering_ambiguous boolean not null default false,
  retention_identity_ambiguous boolean not null default false,

  line_source_hash text not null check (line_source_hash ~ '^[0-9a-f]{64}$'),

  run_id uuid not null references coldlion.sync_run(id),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint coldlion_prod_history_line_company_not_blank
    check (length(btrim(company_code)) > 0),
  constraint coldlion_prod_history_line_stage_allowed
    check (stage_code in ('ISS','INTRAN','REC')),
  constraint coldlion_prod_history_line_requested_stage_allowed
    check (requested_stage_code in ('ISS','INTRAN','REC')),
  -- THE ASSERTION. A returned stage that is not the requested stage aborts the row.
  constraint coldlion_prod_history_line_stage_agreement
    check (stage_code = requested_stage_code),
  constraint coldlion_prod_history_line_division_not_ep001
    check (division_code is null or division_code <> 'EP001'),
  constraint coldlion_prod_history_line_division_not_blank
    check (division_code is null or length(btrim(division_code)) > 0),
  constraint coldlion_prod_history_line_seq_positive
    check (prod_line_seq > 0),
  constraint coldlion_prod_history_line_sales_order_non_negative
    check (sales_order_no is null or sales_order_no >= 0),
  -- 1900-01-01 is the vendor's empty-date marker. It is NULL here or it is refused.
  constraint coldlion_prod_history_line_no_sentinel_dates
    check (
      (ship_date is null or ship_date > date '1900-01-01') and
      (ship_cancel_date is null or ship_cancel_date > date '1900-01-01') and
      (orig_ship_date is null or orig_ship_date > date '1900-01-01') and
      (orig_due_date is null or orig_due_date > date '1900-01-01') and
      (orig_ship_cancel_date is null or orig_ship_cancel_date > date '1900-01-01') and
      (prod_order_date is null or prod_order_date > date '1900-01-01') and
      (due_date is null or due_date > date '1900-01-01') and
      (receive_date is null or receive_date > date '1900-01-01') and
      (cust_start_date is null or cust_start_date > date '1900-01-01') and
      (cust_cancel_date is null or cust_cancel_date > date '1900-01-01')
    ),

  constraint coldlion_prod_history_line_identity_unique
    unique nulls not distinct
      (company_code, prod_order_no, prod_line_seq, stage_code, line_source_hash)
);

create index if not exists coldlion_prod_history_line_partition_idx
  on coldlion.prod_history_line
     (company_code, prod_order_no, prod_line_seq, stage_code,
      source_observed_at desc, source_version_seq desc, line_source_hash desc);
create index if not exists coldlion_prod_history_line_run_idx
  on coldlion.prod_history_line (run_id);
create index if not exists coldlion_prod_history_line_stage_idx
  on coldlion.prod_history_line (stage_code, source_observed_at);

comment on table coldlion.prod_history_line is
  'One version of one ColdLion production (purchase) line, append-only. Identity is (companyCode, prodOrderNo, prodLineSeq, stageCode, line_source_hash) under NULLS NOT DISTINCT: distinct prodLineSeq values are distinct real buy lines and are never merged, and two differing projections of one line are two VERSIONS, never one merged row. THE STAGE IS ASSERTED, NOT STAMPED: requested_stage_code and the returned stage_code are both stored and a mismatch aborts the row (ColdLion began returning stageCode on 2026-08-26). A stage-less /prodHistory request returns only ISS rows while INTRAN and REC rows exist, with no error and a plausible total, so a window is fetched once per stage and each request is paged to completion through coldlion.history_page_ledger (issue #2173). /prodHistory has no divisionCode parameter, so division_code is payload-derived and is never a request scope. salesOrderNo = 0 means no linked sales order and is never a foreign key. 1900-01-01 is the vendor empty-date marker and is refused on every date column. Retention keeps the newest three versions per (company, prodOrderNo, prodLineSeq, stage) partition, ordered by source_observed_at then source_version_seq then line_source_hash, and refuses to prune when ordering or identity is ambiguous or when the partition holds three or fewer versions - which is why a single backfill baseline survives. NO FK to coldlion.item_header: discontinued historical items are legitimately absent from the current item master. Issue #2174.';

comment on column coldlion.prod_history_line.requested_stage_code is
  'The stageCode this row was requested with. Stored beside the returned stage_code precisely so the two can be compared; the stage_agreement check refuses a row where they differ.';
comment on column coldlion.prod_history_line.stage_code is
  'The stageCode the payload actually returned. ColdLion added it on 2026-08-26; before that the stage was stamped from the request, which this migration ends.';
comment on column coldlion.prod_history_line.sales_order_no is
  'salesOrderNo. 0 means NO LINKED SALES ORDER (ColdLion 2026-08-18: hard linking began around 2022-23, and INTRAN/REC lines never carry it). Never a foreign key and never joined on.';
comment on column coldlion.prod_history_line.ext_cost is
  'extCost - the cost of THIS order, populated and meaningful. Never confuse it with prod_history_last_lookup.last_prod_cost, which is an earlier production''s cost.';
comment on column coldlion.prod_history_line.total_prod_cost is
  'totalProdCost as the vendor sends it. It was 0 on 3,218 of 3,411 sampled rows; it is ingested, not interpreted.';
comment on column coldlion.prod_history_line.deposit_perc is
  'depositPerc, 0 in every row tested. Write-back wanted by the owner but currently impossible: ColdLion exposes no write endpoint for prodHistory. Flag only; no invented write path.';
comment on column coldlion.prod_history_line.source_observed_at is
  'The deterministic observation timestamp retention orders by. NOT NULL because a version with no position in time cannot be called newest or oldest.';
comment on column coldlion.prod_history_line.is_backfill_baseline is
  'True on the single version written by the initial backfill. One baseline version is a baseline, not reconstructed change history, and the retention guard refuses to prune it.';
comment on column coldlion.prod_history_line.component_quantities_asserted is
  'Evidence, not a preference: the guard refuses to let it become true unless components exist and their ppk_detail_qty sums to this line''s total_ppk_qty.';

-- -------------------------------------------------------------------------------------
-- 2. coldlion.prod_history_component - component-level prepack facts
-- -------------------------------------------------------------------------------------
--
-- The API row grain is purchase line times component, so subItemNo and linePrice belong
-- here. The parent FK is MANDATORY: a component with no purchase line is a fact about
-- nothing. About 52% of production rows are assortment components.

create table coldlion.prod_history_component (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null
    references coldlion.prod_history_line(id) on delete cascade,

  -- NULLABLE ON PURPOSE. §4.3 of the history-shape note: a non-prepack production row
  -- is identified by (prodOrderNo, prodLineSeq, itemNo) with an EMPTY prepackItemNo,
  -- and the field census puts prepackItemNo at 73.9% - about a quarter of real rows.
  -- Those rows still need a component row, because subItemNo (100%) and linePrice (83%)
  -- live only here. NOT NULL would refuse documented feed rows outright. Empty strings
  -- are normalised to NULL, exactly as order_history_component.sub_item_no does for the
  -- analogous sales-history case; the not-blank check below refuses a blank that was
  -- not normalised, so '' can never masquerade as a prepack item number.
  prepack_item_no text,
  prepack_item_pkey text,
  prepack_dim_code text,
  prepack_division_code text,

  -- PER-COMPONENT quantities and cost. ppk_detail_qty is what the parent's total_ppk_qty
  -- is asserted against; it is never read as the parent total and never summed into one.
  ppk_detail_qty numeric,
  ppk_detail_qty2 numeric,
  ppk_detail_cost numeric,

  sub_item_no text,
  line_price numeric,

  ppk_merch_group01 text, ppk_merch_group02 text, ppk_merch_group03 text,
  ppk_merch_group04 text, ppk_merch_group05 text, ppk_merch_group06 text,
  ppk_merch_group07 text, ppk_merch_group08 text, ppk_merch_group09 text,
  ppk_merch_group10 text, ppk_merch_group11 text, ppk_merch_group12 text,
  ppk_merch_group13 text, ppk_merch_group14 text,
  ppk_merch_group01_desc text, ppk_merch_group02_desc text, ppk_merch_group03_desc text,
  ppk_merch_group04_desc text, ppk_merch_group05_desc text, ppk_merch_group06_desc text,
  ppk_merch_group07_desc text, ppk_merch_group08_desc text, ppk_merch_group09_desc text,
  ppk_merch_group10_desc text, ppk_merch_group11_desc text, ppk_merch_group12_desc text,
  ppk_merch_group13_desc text, ppk_merch_group14_desc text,

  component_source_hash text not null check (component_source_hash ~ '^[0-9a-f]{64}$'),

  run_id uuid not null references coldlion.sync_run(id),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint coldlion_prod_history_component_prepack_item_not_blank
    check (prepack_item_no is null or length(btrim(prepack_item_no)) > 0),
  constraint coldlion_prod_history_component_division_not_ep001
    check (prepack_division_code is null or prepack_division_code <> 'EP001'),
  constraint coldlion_prod_history_component_quantities_non_negative
    check ((ppk_detail_qty is null or ppk_detail_qty >= 0)
       and (ppk_detail_qty2 is null or ppk_detail_qty2 >= 0)),
  constraint coldlion_prod_history_component_identity_unique
    unique nulls not distinct
      (line_id, prepack_item_no, sub_item_no, component_source_hash)
);

create index if not exists coldlion_prod_history_component_line_idx
  on coldlion.prod_history_component (line_id);
create index if not exists coldlion_prod_history_component_run_idx
  on coldlion.prod_history_component (run_id);

comment on table coldlion.prod_history_component is
  'One component design of one production-line version, with a MANDATORY parent FK - every component has exactly one purchase line. The API row grain is line times component, which is why subItemNo and linePrice live here and not on the parent. ppk_detail_qty is a per-component quantity: it is asserted against the parent''s total_ppk_qty by the component-quantity guard and is never read as, or summed into, a parent total. Component taxonomy is the fourteen ppkMerchGroup slots with their descriptions, per the 2026-08-19 field dispositions. Issue #2174.';
comment on column coldlion.prod_history_component.ppk_detail_qty is
  'The per-component quantity. Summed across a line''s components ONLY to assert it equals that line''s total_ppk_qty; it is never a parent total in its own right.';
comment on column coldlion.prod_history_component.line_price is
  'linePrice is PER COMPONENT, not per line (ColdLion, 2026-08-20). Two components of one line with different prices are one line, not two.';

-- -------------------------------------------------------------------------------------
-- 3. coldlion.prod_history_last_lookup - the most-recent-production lookup
-- -------------------------------------------------------------------------------------
--
-- Of 98 duplicate keys in two March-2021 windows, 98 differed ONLY in these fields.
-- They are a lookup at a different production, not the purchase, and lastProdCost is
-- NOT the cost of this order. The copies are never aggregated: one is picked
-- deterministically, the rule that picked it is recorded, and the rest stay visible.

create table coldlion.prod_history_last_lookup (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null
    references coldlion.prod_history_line(id) on delete cascade,

  last_prod_ref_no text,
  last_due_date date,
  last_prod_date date,
  last_warehouse_code text,
  last_vendor_code text,
  last_vendor_desc text,
  -- NEVER a current-order cost. The order's costs are prod_cost, ext_cost and
  -- ppk_detail_cost, and none of those column names exists on this table.
  last_prod_cost numeric,

  -- Pick one copy DETERMINISTICALLY, and say which rule picked it. At most one selected
  -- copy per line, enforced by a partial unique index: aggregation is structurally
  -- impossible rather than merely discouraged.
  is_selected_lookup boolean not null default false,
  selection_rule text,

  lookup_source_hash text not null check (lookup_source_hash ~ '^[0-9a-f]{64}$'),

  run_id uuid not null references coldlion.sync_run(id),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint coldlion_prod_history_last_lookup_no_sentinel_dates
    check (
      (last_due_date is null or last_due_date > date '1900-01-01') and
      (last_prod_date is null or last_prod_date > date '1900-01-01')
    ),
  -- A selection with no recorded rule is a guess wearing a flag.
  constraint coldlion_prod_history_last_lookup_selection_has_rule
    check (not is_selected_lookup
           or (selection_rule is not null and length(btrim(selection_rule)) > 0)),
  constraint coldlion_prod_history_last_lookup_identity_unique
    unique nulls not distinct (line_id, lookup_source_hash)
);

create unique index coldlion_prod_history_last_lookup_one_selected_idx
  on coldlion.prod_history_last_lookup (line_id)
  where is_selected_lookup;

create index if not exists coldlion_prod_history_last_lookup_line_idx
  on coldlion.prod_history_last_lookup (line_id);
create index if not exists coldlion_prod_history_last_lookup_run_idx
  on coldlion.prod_history_last_lookup (run_id);

comment on table coldlion.prod_history_last_lookup is
  'The seven last* fields, which are a MOST-RECENT-PRODUCTION LOOKUP and not part of the purchase, with a mandatory FK to their parent line version. Of 98 duplicate keys across two March-2021 windows, 98 differed only in these fields and 0 in anything else; the surviving fan-out is on lastProdCost, where one line and component carried both 3.00 and 3.60. LAST_PROD_COST IS NEVER THE COST OF THIS ORDER - prod_cost, ext_cost and ppk_detail_cost are - and no column named for an order cost exists on this table. The copies are never aggregated or summed: at most one may be marked is_selected_lookup, enforced by a partial unique index, and a selection without a recorded selection_rule is refused. lookup_source_hash covers only these lookup fields, so a changed lookup can never duplicate a purchase line. Issue #2174.';
comment on column coldlion.prod_history_last_lookup.last_prod_cost is
  'The cost of a DIFFERENT, earlier production of this item. Never expose it as this order''s cost and never let it reach a cost report; use prod_history_line.ext_cost or prod_history_component.ppk_detail_cost.';
comment on column coldlion.prod_history_last_lookup.selection_rule is
  'The deterministic rule that picked this copy (for example: maximum last_prod_date, then maximum last_prod_cost, then lookup_source_hash). Required whenever is_selected_lookup is true.';

-- This is checked at APPLY TIME, not only in the test suite: an order-cost column name
-- appearing on the lookup table is exactly how lastProdCost would be mistaken for the
-- cost of this order.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'coldlion' and table_name = 'prod_history_last_lookup'
      and column_name in ('prod_cost','ext_cost','total_prod_cost','ppk_detail_cost','order_cost')
  ) then
    raise exception
      'an order-cost column was added to the last* lookup table; lastProdCost is not this order''s cost';
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- 4. The things no CHECK constraint can say
-- -------------------------------------------------------------------------------------

-- (a) COMPONENT QUANTITY ASSERTION. A parent may only claim its component quantities
--     are proven when components exist and their per-component quantities sum to the
--     parent total the vendor reported.
create or replace function coldlion.prod_history_component_quantity_guard()
returns trigger
language plpgsql
security definer
set search_path = coldlion, pg_temp
as $fn$
declare
  v_components integer;
  v_sum numeric;
  v_missing integer;
begin
  if not new.component_quantities_asserted then
    return null;
  end if;

  select count(*), sum(ppk_detail_qty), count(*) filter (where ppk_detail_qty is null)
    into v_components, v_sum, v_missing
  from coldlion.prod_history_component
  where line_id = new.id;

  if v_components = 0 then
    raise exception
      'line % cannot assert component quantities: it has no components', new.id;
  end if;

  if v_missing > 0 then
    raise exception
      'line % cannot assert component quantities: % component(s) have no ppk_detail_qty',
      new.id, v_missing;
  end if;

  if new.total_ppk_qty is null then
    raise exception
      'line % cannot assert component quantities: the parent total_ppk_qty is not recorded',
      new.id;
  end if;

  if v_sum is distinct from new.total_ppk_qty then
    raise exception
      'line % cannot assert component quantities: components sum to % but the parent total is %',
      new.id, v_sum, new.total_ppk_qty;
  end if;

  return null;
end;
$fn$;

comment on function coldlion.prod_history_component_quantity_guard() is
  'Refuses to let coldlion.prod_history_line.component_quantities_asserted become true unless its components exist, all carry a ppk_detail_qty, and those quantities sum to the parent total_ppk_qty. Part of the prod_history_line table contract (issue #2174).';

drop trigger if exists prod_history_component_quantity_guard on coldlion.prod_history_line;
create constraint trigger prod_history_component_quantity_guard
  after insert or update on coldlion.prod_history_line
  deferrable initially immediate
  for each row execute function coldlion.prod_history_component_quantity_guard();

-- (b) The components ARE the evidence behind that assertion. They may not be added,
--     rewritten or removed while their parent still claims the assertion holds.
create or replace function coldlion.prod_history_component_immutable_when_asserted()
returns trigger
language plpgsql
security definer
set search_path = coldlion, pg_temp
as $fn$
declare
  v_parent record;
  v_line_ids uuid[];
begin
  if tg_op = 'INSERT' then
    v_line_ids := array[new.line_id];
  elsif tg_op = 'DELETE' then
    v_line_ids := array[old.line_id];
  else
    v_line_ids := array[old.line_id, new.line_id];
  end if;

  -- Deterministic lock order over both parents: an UPDATE that re-parents a component
  -- must protect its destination as well as its source.
  for v_parent in
    select id, component_quantities_asserted
      from coldlion.prod_history_line
     where id = any(v_line_ids)
     order by id
     for update
  loop
    if v_parent.component_quantities_asserted then
      raise exception
        'component evidence for line % cannot be added, changed or removed while its quantities are asserted',
        v_parent.id;
    end if;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

comment on function coldlion.prod_history_component_immutable_when_asserted() is
  'Protects the component evidence behind an asserted production line from being added, rewritten or deleted. Part of the prod_history_component table contract (issue #2174).';

drop trigger if exists prod_history_component_immutable_when_asserted
  on coldlion.prod_history_component;
create trigger prod_history_component_immutable_when_asserted
  before insert or update or delete on coldlion.prod_history_component
  for each row execute function coldlion.prod_history_component_immutable_when_asserted();

-- (c) RETENTION - a separate, restartable maintenance operation.
--
--     Retention is not a batch job baked into a migration. It is one DELETE at a time,
--     each one independently checked, so it can be stopped and resumed at any point
--     without leaving a partition half-pruned. The rules it enforces:
--
--       * The partition is the FULL SOURCE IDENTITY: company, prodOrderNo, prodLineSeq
--         and stage. A partition that spanned stages would prune a real REC receipt
--         line because an ISS line is newer.
--       * Newest is source_observed_at, then source_version_seq, then line_source_hash,
--         which is unique within the partition because it is part of the identity - so
--         the ordering is total, and the guard proves that rather than assuming it.
--       * The newest THREE are retained. A partition of three or fewer is untouched,
--         which is exactly why the initial backfill's single baseline version survives.
--       * Only the oldest live version may be pruned, one at a time.
--       * If ordering or identity is flagged ambiguous, the whole partition REFUSES to
--         prune. Retention never guesses which version is real.
create or replace function coldlion.prod_history_line_retention_guard()
returns trigger
language plpgsql
security definer
set search_path = coldlion, pg_temp
as $fn$
declare
  v_live integer;
  v_ambiguous integer;
  v_ties integer;
  v_oldest uuid;
  v_baselines integer;
begin
  select count(*),
         count(*) filter (where retention_ordering_ambiguous or retention_identity_ambiguous),
         count(*) filter (where is_backfill_baseline)
    into v_live, v_ambiguous, v_baselines
  from coldlion.prod_history_line
  where company_code = old.company_code
    and prod_order_no = old.prod_order_no
    and prod_line_seq = old.prod_line_seq
    and stage_code = old.stage_code;

  if v_ambiguous > 0 then
    raise exception
      'refusing to prune production line %: % version(s) of its partition are flagged ambiguous',
      old.id, v_ambiguous;
  end if;

  -- The ordering must be total before "newest three" means anything.
  select count(*) into v_ties
  from (
    select source_observed_at, source_version_seq, line_source_hash
    from coldlion.prod_history_line
    where company_code = old.company_code
      and prod_order_no = old.prod_order_no
      and prod_line_seq = old.prod_line_seq
      and stage_code = old.stage_code
    group by 1, 2, 3
    having count(*) > 1
  ) ties;

  if v_ties > 0 then
    raise exception
      'refusing to prune production line %: its partition ordering is not total (% tied key(s))',
      old.id, v_ties;
  end if;

  -- The column and function comments promise that a backfill baseline is never pruned.
  -- The <= 3 floor alone does not keep that promise: a fourth version makes the oldest
  -- row eligible even when it IS the baseline. The baseline is the only version that is
  -- an observation of the world before we were watching - it is not reconstructable, so
  -- it is refused outright rather than merely being usually protected by the floor.
  if old.is_backfill_baseline then
    raise exception
      'refusing to prune production line %: it is the backfill baseline of its partition',
      old.id;
  end if;

  if v_live <= 3 then
    raise exception
      'refusing to prune production line %: retention keeps the newest three and its partition holds % version(s)%',
      old.id, v_live,
      case when v_baselines > 0 then ' (including a backfill baseline)' else '' end;
  end if;

  select id into v_oldest
  from coldlion.prod_history_line
  where company_code = old.company_code
    and prod_order_no = old.prod_order_no
    and prod_line_seq = old.prod_line_seq
    and stage_code = old.stage_code
  order by source_observed_at asc, source_version_seq asc nulls first, line_source_hash asc
  limit 1;

  if v_oldest is distinct from old.id then
    raise exception
      'refusing to prune production line %: only the oldest version of a partition may be pruned (that is %)',
      old.id, v_oldest;
  end if;

  return old;
end;
$fn$;

comment on function coldlion.prod_history_line_retention_guard() is
  'The retention contract of coldlion.prod_history_line, enforced one DELETE at a time so the maintenance operation is restartable. Partitions by the full source identity (company, prodOrderNo, prodLineSeq, stage), orders newest by source_observed_at then source_version_seq then the stable line_source_hash tie-breaker, retains the newest three, allows only the oldest to be pruned, and REFUSES to prune at all when ordering or identity is ambiguous, when the partition holds three or fewer versions, or when the row being deleted is the backfill baseline - the baseline refusal is explicit and does not depend on the three-version floor. Issue #2174.';

drop trigger if exists prod_history_line_retention_guard on coldlion.prod_history_line;
create trigger prod_history_line_retention_guard
  before delete on coldlion.prod_history_line
  for each row execute function coldlion.prod_history_line_retention_guard();

-- -------------------------------------------------------------------------------------
-- 5. Closed landing posture - no application role reads this schema
-- -------------------------------------------------------------------------------------

do $access$
declare r record;
begin
  for r in
    select c.oid::regclass as relation_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'coldlion' and c.relkind = 'r'
      and c.relname in ('prod_history_line','prod_history_component','prod_history_last_lookup')
  loop
    execute format('alter table %s enable row level security', r.relation_name);
    execute format('revoke all on table %s from public, anon, authenticated', r.relation_name);
    execute format('grant all on table %s to service_role', r.relation_name);
  end loop;
end
$access$;

revoke all on function coldlion.prod_history_component_quantity_guard() from public, anon, authenticated;
revoke all on function coldlion.prod_history_component_immutable_when_asserted() from public, anon, authenticated;
revoke all on function coldlion.prod_history_line_retention_guard() from public, anon, authenticated;
