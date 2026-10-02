// The ColdLion order-intake CANONICAL WRITER (plan_coldlion_order_intake.md §9 C2).
//
// A SEPARATE script from order-intake.mjs (the poller stays claim-only): this
// module turns decoded, pending intake_new_order rows into the canonical
// placeholder header + per-component lines with coldlion source refs, per the
// settled C0 ruling (one sales order maps to MANY production orders, so the
// salesOrderNo is NEVER a canonical header identity — the placeholder
// COLDLION-SO-<so> represents the customer order before production exists).
//
// Intake idempotency is SOURCE-REF-ONLY (§8): a miss of
// (source_system='coldlion', source_id='coldlion:so-header:<so>') in
// plm.production_order_source_ref creates the placeholder; a hit updates it —
// and the UPDATE touches production_order_number ONLY when the header's
// metadata says coldlion_intake_placeholder, refusing otherwise (direct writes
// bypass the #1772 RPC immutability, so the guard lives in this SQL). A
// customer-PO match is NEVER a claim path: under the 1:N ruling a multi-match
// on customer PO is expected and must never quarantine. Every google_order_list
// ref stays untouched.
//
// NO database routines are created here (non-orchestrator work): all SQL lives
// in this file as statements. Read-only helpers the plan names (winner
// selection, decode, run summary) are inline CTEs, so the §8 STABLE-never-
// IMMUTABLE volatility rule for new routines applies to nothing this adds.
//
// Like order-intake-stage.mjs, this module builds SQL as text with database
// access injected by the caller, so the offline tests exercise every branch
// without a database (the locked §8 testability decision).

import { sqlJson, sqlNumber, sqlText, sqlTimestamp, sqlUuid } from "./values.mjs";
// The Phase B staging specs are the single source of truth for the staging
// columns the winner selection reads (round-3 review #5).
import { INTAKE_LINE_SPEC, INTAKE_COMPONENT_SPEC } from "./order-intake-stage.mjs";

export const REQUESTED_BY = "coldlion-order-intake";

/**
 * poNumber normalization for MATCHING (live-solved 2026-09-17: the ERP carries
 * the same customer PO as both a 10-digit zero-padded value and an ordinary
 * 8-digit value). Leading zeros are stripped; an all-zero or empty value
 * normalizes to NULL — those are the Amazon stock orders whose placeholder is
 * keyed on salesOrderNo alone (§8). The RAW text is what lands in
 * customer_po_number (identifiers keep letters and leading zeros); the
 * normalized value rides line metadata for the Phase F comparison.
 */
export function normalizePoNumber(value) {
  if (value === null || value === undefined) return null;
  const stripped = String(value).trim().replace(/^0+/, "");
  return stripped.length === 0 ? null : stripped;
}

/** The deterministic placeholder header number for one sales order. */
export function placeholderHeaderNumber(salesOrderNo) {
  if (!Number.isSafeInteger(salesOrderNo) || salesOrderNo <= 0) {
    throw new Error("a placeholder header requires a positive salesOrderNo (salesOrderNo = 0 must never mint COLDLION-SO-0)");
  }
  return `COLDLION-SO-${salesOrderNo}`;
}

/** The one header source ref per sales order (§8 claim shape). */
export function headerSourceId(salesOrderNo) {
  placeholderHeaderNumber(salesOrderNo); // same refusal: salesOrderNo = 0 must never mint a header ref
  return `coldlion:so-header:${salesOrderNo}`;
}

/** The deterministic per-component line source ref (§8 claim shape). */
export function lineSourceId(salesOrderNo, salesOrderLineNo, componentOrdinal) {
  placeholderHeaderNumber(salesOrderNo); // same refusal: never a coldlion:so:0: family ref
  if (!Number.isSafeInteger(salesOrderLineNo) || salesOrderLineNo < 0) {
    throw new Error("a line source ref requires a non-negative salesOrderLineNo");
  }
  if (!Number.isSafeInteger(componentOrdinal) || componentOrdinal < 1) {
    throw new Error("a line source ref requires a 1-based component ordinal");
  }
  return `coldlion:so:${salesOrderNo}:line:${salesOrderLineNo}:component:${componentOrdinal}`;
}

/**
 * The canonical-write transaction. One statement-set, one transaction:
 *
 *   0. winner selection at both grains (DISTINCT ON riding the two Phase A
 *      winner-selection indexes; the two-key tiebreak — greatest last_seen_run,
 *      then *_source_hash — makes the winner total-order deterministic, so two
 *      runs can never mint different winners, ordinals, or source_ids);
 *   1. customer resolution core.company_source_ref FIRST, then
 *      plm.erp_customer (active = true) — either miss or a disagreement
 *      quarantines (never insert core.customer, never pick silently);
 *   2. placeholder header create-or-update behind the source-ref-only
 *      idempotency check, with the update-only-placeholder SQL guard;
 *   3. one canonical line per winning component with the direct-line/prepack
 *      sku/assortment rules and is_primary refs;
 *   4. intake_new_order state transitions + counts on the run's sync_run row.
 *
 * Postgres CTE visibility: every data-modifying CTE reads only RETURNING rows
 * of earlier CTEs and pre-statement table state, never a fresh read of a table
 * another CTE in this statement writes (the Phase B discipline). Every UPDATE
 * carries an IS DISTINCT FROM guard so a re-run that changes nothing updates
 * zero rows — plm.production_order(_line) have a set_updated_at BEFORE UPDATE
 * trigger, so an unguarded same-value UPDATE would still move updated_at.
 *
 * `write=false` executes the identical transaction and rolls it back: a true
 * rehearsal of the real path (same plans, same constraints) that writes
 * nothing anywhere, including the sync_run row.
 */
export function buildWriteSql({ runId, write = false, limit = null, order = null, startedAt = new Date().toISOString(), finishedAt = new Date().toISOString() } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId ?? "")) {
    throw new Error("buildWriteSql requires a UUID run id");
  }
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("limit must be a positive integer or null");
  }
  if (order !== null && (!Number.isSafeInteger(order) || order <= 0)) {
    // salesOrderNo = 0 is quarantined upstream and must never reach the writer
    // (never COLDLION-SO-0); the refusal mirrors placeholderHeaderNumber.
    throw new Error("order must be a positive sales order number (salesOrderNo = 0 is never written)");
  }
  const scopeFilter = order !== null ? `and n.sales_order_no = ${sqlNumber(order)}` : "";
  const scopeLimit = limit !== null ? `\n  limit ${sqlNumber(limit)}` : "";
  return `begin;

insert into coldlion.sync_run
  (id, endpoint, company_code, request_params, status, requested_by,
   started_at, finished_at, notes)
values
  (${sqlUuid(runId)}, '/orderHistory', 'POP',
   ${sqlJson({ step: "canonical-write", requestedBy: REQUESTED_BY, ...(order !== null ? { order } : {}), ...(limit !== null ? { limit } : {}) })},
   'succeeded', ${sqlText(REQUESTED_BY)}, ${sqlTimestamp(startedAt)}, ${sqlTimestamp(finishedAt)},
   'canonical write step')
on conflict (id) do nothing;

with scope as (
  select n.sales_order_no, n.warehouse_code
  from coldlion.intake_new_order n
  where n.state = 'pending'
    -- The table check refuses sales_order_no = 0 outright; this predicate is
    -- defence in depth so a relaxed future constraint can never mint
    -- COLDLION-SO-0, whose header ref would collapse every zero-SO row onto
    -- one header under unique (source_system, source_id).
    and n.sales_order_no <> 0
    -- Only decodable orders enter the claim path; C1 owns the
    -- unknown-code quarantine, so anything still pending without a map row
    -- stays pending for the decode step instead of being written or hidden.
    and exists (select 1 from coldlion.routing_code_map m
                where m.code = n.warehouse_code)
    ${scopeFilter}
  order by n.sales_order_no${scopeLimit}
),
line_version_winners as (
  -- C2 step 0, first tier: the winning VERSION of every staged line, per
  -- (sales_order_no, sales_order_line_no, master_item_no): greatest
  -- last_seen_run, then line_source_hash — both tiebreak keys ride the
  -- coldlion_intake_order_line_winner_idx the Phase A migration declares (the
  -- identity unique omits last_seen_run and cannot serve this sort). Cross-
  -- version forks are RESOLVED here, never quarantined and never merged.
  select distinct on (l.sales_order_no, l.sales_order_line_no, l.master_item_no)
    l.id, l.sales_order_no, l.sales_order_line_no, l.master_item_no,
    l.last_seen_run,
    l.company_code, l.division_code, l.customer_code, l.po_number,
    l.sales_person_code1, l.start_date, l.cancel_date, l.line_qty,
    l.warehouse_code, l.line_source_hash
  from coldlion.intake_order_line l
  join scope s on s.sales_order_no = l.sales_order_no
  -- Defence in depth: EP001 was filtered at ingestion AND refused by the
  -- staging check constraint; the claim path asserts it again so a future
  -- constraint relaxation can never write Edgeucational rows canonically.
  where l.division_code is distinct from 'EP001'
  order by l.sales_order_no, l.sales_order_line_no, l.master_item_no,
           l.last_seen_run desc, l.line_source_hash
),
winning_lines as (
  -- Second tier (round-2 review H2): master_item_no is PART of the line
  -- projection, so a corrected item is a new version whose identity row sits
  -- beside the old one — two per-item winners can share one
  -- (sales_order_no, sales_order_line_no). The line ref grammar
  -- coldlion:so:<so>:line:<lineNo>:component:<ord> (plan §8, binding) has
  -- ONE slot per line number, so the fork is resolved once more by
  -- winner-selection (§603: forks are never quarantined, never merged): the
  -- same two-key tiebreak over the per-item winners, with master_item_no as
  -- the final deterministic key. The identity unique makes the
  -- (run, hash, item) triple distinct, so the order is total and two runs
  -- can never mint different winners — nor collide two winners on one
  -- source_id. The winner index serves the first tier; this tier sorts a
  -- bounded per-order set already narrowed by it.
  select distinct on (w.sales_order_no, w.sales_order_line_no)
    w.id, w.sales_order_no, w.sales_order_line_no, w.master_item_no,
    w.company_code, w.division_code, w.customer_code, w.po_number,
    w.sales_person_code1, w.start_date, w.cancel_date, w.line_qty,
    w.warehouse_code, w.line_source_hash
  from line_version_winners w
  order by w.sales_order_no, w.sales_order_line_no,
           w.last_seen_run desc, w.line_source_hash, w.master_item_no
),
winning_components as (
  -- Same winner rule at component grain, per (line_id, sub_item_no,
  -- sub_label_code), riding coldlion_intake_order_component_winner_idx. NULL
  -- sub keys are one identity to the NULLS NOT DISTINCT constraint and to
  -- DISTINCT ON alike; the sort keys keep NULLS LAST so the direct line's
  -- NULL-sub component is unambiguous.
  select distinct on (c.line_id, c.sub_item_no, c.sub_label_code)
    c.line_id, c.sub_item_no, c.sub_label_code, c.order_qty,
    c.component_source_hash
  from coldlion.intake_order_component c
  where c.line_id in (select id from winning_lines)
  order by c.line_id, c.sub_item_no asc nulls last, c.sub_label_code asc nulls last,
           c.last_seen_run desc, c.component_source_hash
),
ordinalled as (
  -- The component ordinal for source_id determinism: order of first
  -- appearance sorted by (sub_item_no NULLS LAST, sub_label_code NULLS LAST)
  -- — stable across runs (§9 C2 step 0). One canonical line per winning
  -- component, direct line included (its single NULL-sub component is
  -- ordinal 1).
  select wc.*,
         row_number() over (partition by wc.line_id
                            order by wc.sub_item_no asc nulls last,
                                     wc.sub_label_code asc nulls last) as component_ordinal
  from winning_components wc
),
case_pack as (
  -- Case Pack default ← coldlion.item_detail.carton_qty (§9 C2 step 2). The
  -- lookup names the FULL primary-key predicate (company_code, division_code,
  -- item_no — plan A2): item_detail is SKU-grained by item_pkey, so a lookup
  -- yielding more than one item_pkey per item_no makes carton_qty ambiguous,
  -- and the HAVING asserts uniqueness BEFORE the value is used. Ambiguous or
  -- missing lookups leave case_pack NULL (the sheet's line-level exceptions
  -- stay human); no value is ever picked silently.
  select l.id as line_id,
         coalesce(nullif(btrim(c.sub_item_no), ''), l.master_item_no) as sku,
         min(d.carton_qty) as carton_qty
  from winning_lines l
  join ordinalled c on c.line_id = l.id
  join coldlion.item_detail d
    on d.company_code = l.company_code
   and d.division_code = l.division_code
   and d.item_no = coalesce(nullif(btrim(c.sub_item_no), ''), l.master_item_no)
  group by l.id, coalesce(nullif(btrim(c.sub_item_no), ''), l.master_item_no)
  having count(distinct d.item_pkey) = 1
),
customer_ref as (
  -- Customer resolution FIRST: core.company_source_ref (source_system
  -- 'coldlion', source_table 'customers', source_id = customerCode) →
  -- company_id → core.customer.id. min(uuid) does not exist, so the "any
  -- one company" pick is the first of an ORDER BY-distinct array; the count
  -- beside it detects an ambiguous lookup (a quarantine reason below).
  select wl.sales_order_no,
         (array_agg(distinct r.company_id order by r.company_id))[1] as company_id,
         count(distinct r.company_id) as companies
  from winning_lines wl
  join core.company_source_ref r
    on r.source_system = 'coldlion'
   and r.source_table = 'customers'
   and r.source_id = wl.customer_code
  group by wl.sales_order_no
),
customer_erp as (
  -- SECOND: plm.erp_customer by natural key, requiring the importer's
  -- active = true filter; an unpromoted row (customer_id null) is not a
  -- resolution.
  select wl.sales_order_no,
         (array_agg(distinct e.customer_id order by e.customer_id))[1] as company_id,
         count(distinct e.customer_id) as companies
  from winning_lines wl
  join plm.erp_customer e
    on e.customer_code = wl.customer_code
   and e.active
  where e.customer_id is not null
  group by wl.sales_order_no
),
order_codes as (
  select sales_order_no, count(distinct customer_code) as distinct_codes
  from winning_lines
  group by sales_order_no
),
resolution as (
  -- Either miss → quarantine 'customer-unresolvable'; any disagreement (the
  -- order's own lines carry more than one customerCode, either lookup is
  -- itself ambiguous, or the two lookups resolve different companies) →
  -- 'customer-disagreement'. core.customer is NEVER inserted. A multi-match
  -- on customer PO alone is NOT here and never can be: under the 1:N ruling
  -- it is expected, and customer-PO matching is not a claim path at intake.
  select s.sales_order_no,
         case
           when oc.distinct_codes > 1 then 'customer-disagreement'
           when cr.companies > 1 then 'customer-disagreement'
           when ce.companies > 1 then 'customer-disagreement'
           when cr.company_id is not null and ce.company_id is not null
                and cr.company_id <> ce.company_id then 'customer-disagreement'
           when coalesce(cr.company_id, ce.company_id) is not null then null
           else 'customer-unresolvable'
         end as quarantine_reason,
         coalesce(cr.company_id, ce.company_id) as company_id,
         s.warehouse_code
  from scope s
  left join order_codes oc on oc.sales_order_no = s.sales_order_no
  left join customer_ref cr on cr.sales_order_no = s.sales_order_no
  left join customer_erp ce on ce.sales_order_no = s.sales_order_no
),
header_ref as (
  -- The source-ref-only idempotency check (§8): exactly the pair
  -- (source_system='coldlion', source_id='coldlion:so-header:<so>').
  -- Nothing else — no customer-PO tuple, no business-key match — may claim a
  -- header. (A SQL comment ends at its newline: the pair above stays on its
  -- own -- line so the parenthesized text can never parse as code.)
  select s.sales_order_no, r.production_order_id,
         (p.metadata ->> 'production_order_number_origin') as origin
  from scope s
  join plm.production_order_source_ref r
    on r.source_system = 'coldlion'
   and r.source_id = 'coldlion:so-header:' || s.sales_order_no::text
  join plm.production_order p on p.id = r.production_order_id
),
claim_failure as (
  -- The ref exists but the header is NOT ours: quarantine and touch nothing.
  -- Never attach a coldlion:so-header ref to a non-placeholder header; never
  -- update a non-placeholder's production_order_number (the #1772 RPC
  -- immutability is bypassed by direct writes, so the refusal lives in SQL).
  insert into coldlion.intake_quarantine (reason, sales_order_no, detail, first_seen_run)
  select 'claim-failure', hr.sales_order_no,
         jsonb_build_object(
           'header_source_id', 'coldlion:so-header:' || hr.sales_order_no::text,
           'production_order_number_origin', hr.origin),
         ${sqlUuid(runId)}
  from header_ref hr
  where hr.origin is distinct from 'coldlion_intake_placeholder'
    and not exists (
      select 1 from coldlion.intake_quarantine q
      where q.reason = 'claim-failure'
        and q.sales_order_no = hr.sales_order_no)
  returning sales_order_no
),
unresolvable as (
  insert into coldlion.intake_quarantine (reason, sales_order_no, detail, first_seen_run)
  select 'customer-unresolvable', r.sales_order_no,
         jsonb_build_object('customerCodes',
           (select coalesce(jsonb_agg(distinct wl.customer_code order by wl.customer_code), '[]'::jsonb)
              from winning_lines wl
             where wl.sales_order_no = r.sales_order_no)),
         ${sqlUuid(runId)}
  from resolution r
  where r.quarantine_reason = 'customer-unresolvable'
    and not exists (
      select 1 from coldlion.intake_quarantine q
      where q.reason = 'customer-unresolvable'
        and q.sales_order_no = r.sales_order_no)
  returning sales_order_no
),
disagreement as (
  insert into coldlion.intake_quarantine (reason, sales_order_no, detail, first_seen_run)
  select 'customer-disagreement', r.sales_order_no,
         jsonb_build_object('customerCodes',
           (select coalesce(jsonb_agg(distinct wl.customer_code order by wl.customer_code), '[]'::jsonb)
              from winning_lines wl
             where wl.sales_order_no = r.sales_order_no)),
         ${sqlUuid(runId)}
  from resolution r
  where r.quarantine_reason = 'customer-disagreement'
    and not exists (
      select 1 from coldlion.intake_quarantine q
      where q.reason = 'customer-disagreement'
        and q.sales_order_no = r.sales_order_no)
  returning sales_order_no
),
claimable as (
  select r.sales_order_no, r.company_id, r.warehouse_code
  from resolution r
  where r.quarantine_reason is null
    and r.sales_order_no not in (select sales_order_no from claim_failure)
),
new_headers as (
  -- Idempotency miss → CREATE the placeholder header COLDLION-SO-<so> with
  -- metadata.production_order_number_origin = 'coldlion_intake_placeholder'
  -- (the importer's blank-PO GOOGLE-ROW-<n> precedent; the column is not
  -- unique-constrained, so placeholders cannot collide). Metadata is
  -- deterministic — no run id — so a rewrite computes the identical object.
  insert into plm.production_order
    (production_order_number, company_id, metadata, source_system, source_id)
  select 'COLDLION-SO-' || c.sales_order_no::text, c.company_id,
         jsonb_build_object(
           'production_order_number_origin', 'coldlion_intake_placeholder',
           'sales_order_no', c.sales_order_no,
           'warehouse_code', c.warehouse_code,
           'order_type', m.order_type,
           'ship_to', m.ship_to),
         'coldlion', 'coldlion:so-header:' || c.sales_order_no::text
  from claimable c
  join coldlion.routing_code_map m on m.code = c.warehouse_code
  where not exists (
    select 1 from header_ref h where h.sales_order_no = c.sales_order_no)
  returning id, source_id
),
all_headers as (
  -- New and pre-existing placeholder headers, one row per claimable order.
  -- The new half reads new_headers' RETURNING (data-modifying CTEs cannot see
  -- each other's table writes); the existing half is exactly the
  -- placeholder-origin subset of header_ref.
  select (regexp_replace(nh.source_id, '^coldlion:so-header:', ''))::bigint as sales_order_no,
         nh.id as production_order_id
  from new_headers nh
  union all
  select hr.sales_order_no, hr.production_order_id
  from header_ref hr
  where hr.origin = 'coldlion_intake_placeholder'
),
canonical_lines as (
  -- One canonical line per winning component. Direct line →
  -- sku = COALESCE(NULLIF(sub_item_no,''), master_item_no), assortment_id
  -- NULL; prepack component → assortment_id = master_item_no (the parent
  -- assortment item) and assortment_component_ordinal = the stable ordinal.
  -- quantity_ordered = order_qty — the per-SKU quantity ColdLion computes —
  -- NEVER line_qty (the parent total repeated on every exploded component;
  -- it rides line metadata only) and never a sum across versions or
  -- components. start/cancel dates were NULL-ified at staging when the ERP
  -- sent its 1900-01-01 empty marker (values.mjs), and are stored verbatim.
  select wl.sales_order_no, wl.sales_order_line_no, wl.master_item_no,
         wl.po_number, wl.sales_person_code1, wl.start_date, wl.cancel_date,
         wl.line_qty, wl.line_source_hash,
         o.sub_item_no, o.sub_label_code,
         coalesce(nullif(btrim(o.sub_item_no), ''), wl.master_item_no) as sku,
         case when nullif(btrim(o.sub_item_no), '') is not null
              then wl.master_item_no end as assortment_id,
         case when nullif(btrim(o.sub_item_no), '') is not null
              then o.component_ordinal end as assortment_component_ordinal,
         o.order_qty as quantity_ordered,
         o.component_ordinal, o.component_source_hash,
         nullif(ltrim(regexp_replace(wl.po_number, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '0'), '') as po_number_normalized,
         m.order_type, m.ship_to, cp.carton_qty as case_pack,
         ah.production_order_id,
         'coldlion:so:' || wl.sales_order_no::text || ':line:'
           || wl.sales_order_line_no::text || ':component:'
           || o.component_ordinal::text as line_source_id
  from winning_lines wl
  join claimable c on c.sales_order_no = wl.sales_order_no
  join coldlion.routing_code_map m on m.code = c.warehouse_code
  join ordinalled o on o.line_id = wl.id
  left join case_pack cp
    on cp.line_id = wl.id
   and cp.sku = coalesce(nullif(btrim(o.sub_item_no), ''), wl.master_item_no)
  join all_headers ah on ah.sales_order_no = wl.sales_order_no
),
line_inserts as (
  -- Line idempotency is the deterministic source ref: a miss inserts the
  -- line; a hit takes the update path below. The insert never rewrites a
  -- Google line: the refs it checks are coldlion-only and its source_id
  -- grammar is unreachable from google_order_list ids.
  insert into plm.production_order_line
    (production_order_id, line_number, sku, quantity_ordered, order_person,
     order_type, customer_po_number, assortment_id,
     assortment_component_ordinal, case_pack, ship_to, start_ship_date,
     cancel_date, metadata, source_system, source_id)
  select cl.production_order_id, cl.sales_order_line_no::text, cl.sku,
         cl.quantity_ordered, cl.sales_person_code1, cl.order_type,
         cl.po_number, cl.assortment_id, cl.assortment_component_ordinal,
         cl.case_pack, cl.ship_to, cl.start_date, cl.cancel_date,
         jsonb_build_object(
           'line_qty', cl.line_qty,
           'po_number_normalized', cl.po_number_normalized,
           'sub_item_no', cl.sub_item_no,
           'sub_label_code', cl.sub_label_code,
           'master_item_no', cl.master_item_no,
           'component_source_hash', cl.component_source_hash),
         'coldlion', cl.line_source_id
  from canonical_lines cl
  where not exists (
    select 1 from plm.production_order_line_source_ref r
    where r.source_system = 'coldlion'
      and r.source_id = cl.line_source_id)
  returning id, source_id
),
line_refs as (
  -- is_primary = true on exactly one ref per line — the single coldlion ref
  -- this intake mints (the partial unique index production_order_line_
  -- source_ref_primary_uidx enforces one primary per line per source system).
  -- ON CONFLICT DO NOTHING keeps the insert idempotent; no ref row is ever
  -- updated, so a google_order_list ref can never be overwritten.
  insert into plm.production_order_line_source_ref
    (production_order_line_id, source_system, source_id, is_primary, metadata)
  select li.id, 'coldlion', li.source_id, true,
         jsonb_build_object('origin', 'coldlion_intake')
  from line_inserts li
  on conflict (source_system, source_id) do nothing
  returning production_order_line_id
),
header_refs as (
  -- is_primary = true on exactly one header ref: the coldlion placeholder
  -- ref, one per sales order (unique per source system under the partial
  -- index production_order_source_ref_primary_uidx).
  insert into plm.production_order_source_ref
    (production_order_id, source_system, source_id, is_primary, metadata)
  select nh.id, 'coldlion', nh.source_id, true,
         jsonb_build_object('origin', 'coldlion_intake')
  from new_headers nh
  on conflict (source_system, source_id) do nothing
  returning production_order_id
),
header_updates as (
  -- Idempotency hit → UPDATE the placeholder. production_order_number is
  -- touched ONLY under the placeholder-origin guard (the refusal for any
  -- other header is claim_failure above). The IS DISTINCT FROM guard makes a
  -- nothing-changed re-run update ZERO rows — the set_updated_at BEFORE
  -- UPDATE trigger on plm.production_order would move updated_at on an
  -- unguarded same-value update, breaking second-run no-op idempotency.
  update plm.production_order p
     set production_order_number = 'COLDLION-SO-' || c.sales_order_no::text,
         company_id = c.company_id,
         metadata = p.metadata || jsonb_build_object(
           'sales_order_no', c.sales_order_no,
           'warehouse_code', c.warehouse_code,
           'order_type', m.order_type,
           'ship_to', m.ship_to)
   from claimable c
   join coldlion.routing_code_map m on m.code = c.warehouse_code
   join header_ref hr on hr.sales_order_no = c.sales_order_no
   where p.id = hr.production_order_id
     and p.metadata ->> 'production_order_number_origin' = 'coldlion_intake_placeholder'
     and (p.production_order_number, p.company_id, p.metadata) is distinct from
         ('COLDLION-SO-' || c.sales_order_no::text, c.company_id,
          p.metadata || jsonb_build_object(
            'sales_order_no', c.sales_order_no,
            'warehouse_code', c.warehouse_code,
            'order_type', m.order_type,
            'ship_to', m.ship_to))
  returning p.id
),
line_updates as (
  -- A re-processed order whose line refs exist: refresh the mapped values
  -- ONLY where they differ, and only while the line still belongs to this
  -- placeholder (a future production-side claim MOVES lines; this writer
  -- never fights that). Same IS DISTINCT FROM discipline as header_updates.
  update plm.production_order_line pl
     set production_order_id = cl.production_order_id,
         line_number = cl.sales_order_line_no::text,
         sku = cl.sku,
         quantity_ordered = cl.quantity_ordered,
         order_person = cl.sales_person_code1,
         order_type = cl.order_type,
         customer_po_number = cl.po_number,
         assortment_id = cl.assortment_id,
         assortment_component_ordinal = cl.assortment_component_ordinal,
         case_pack = cl.case_pack,
         ship_to = cl.ship_to,
         start_ship_date = cl.start_date,
         cancel_date = cl.cancel_date,
         metadata = jsonb_build_object(
           'line_qty', cl.line_qty,
           'po_number_normalized', cl.po_number_normalized,
           'sub_item_no', cl.sub_item_no,
           'sub_label_code', cl.sub_label_code,
           'master_item_no', cl.master_item_no,
           'component_source_hash', cl.component_source_hash)
   from canonical_lines cl
   where pl.source_system = 'coldlion'
     and pl.source_id = cl.line_source_id
     and pl.production_order_id = cl.production_order_id
     and (pl.production_order_id, pl.line_number, pl.sku, pl.quantity_ordered,
          pl.order_person, pl.order_type, pl.customer_po_number,
          pl.assortment_id, pl.assortment_component_ordinal, pl.case_pack,
          pl.ship_to, pl.start_ship_date, pl.cancel_date, pl.metadata)
       is distinct from
         (cl.production_order_id, cl.sales_order_line_no::text, cl.sku,
          cl.quantity_ordered, cl.sales_person_code1, cl.order_type,
          cl.po_number, cl.assortment_id, cl.assortment_component_ordinal,
          cl.case_pack, cl.ship_to, cl.start_date, cl.cancel_date,
          jsonb_build_object(
            'line_qty', cl.line_qty,
            'po_number_normalized', cl.po_number_normalized,
            'sub_item_no', cl.sub_item_no,
            'sub_label_code', cl.sub_label_code,
            'master_item_no', cl.master_item_no,
            'component_source_hash', cl.component_source_hash))
  returning pl.id
),
created as (
  -- pending → created, with the deterministic claim evidence (refs only,
  -- never row contents). Requires canonical lines to exist: an order that
  -- resolved but produced no lines stays pending and visible, never
  -- silently "created" empty.
  update coldlion.intake_new_order n
     set state = 'created', state_changed_at = now(),
         claim_evidence = n.claim_evidence || jsonb_build_object(
           'header_source_id', 'coldlion:so-header:' || n.sales_order_no::text,
           'production_order_number', 'COLDLION-SO-' || n.sales_order_no::text,
           'run', ${sqlJson(runId)})
   where n.state = 'pending'
     and n.sales_order_no in (select sales_order_no from claimable)
     and exists (select 1 from canonical_lines cl
                 where cl.sales_order_no = n.sales_order_no)
  returning n.sales_order_no
),
quarantined as (
  -- An order can land in BOTH quarantine axes at once (a non-placeholder
  -- header ref AND an unresolvable customer are independent facts; both rows
  -- stay visible in intake_quarantine per §11). The state row records ONE
  -- deterministic reason — claim-failure wins, because it names the stronger
  -- refusal (the writer must never touch that header at all) — instead of
  -- letting Postgres pick an arbitrary match from the union.
  update coldlion.intake_new_order n
     set state = 'quarantined', state_changed_at = now(),
         claim_evidence = n.claim_evidence || jsonb_build_object(
           'quarantine_reason', r.quarantine_reason,
           'run', ${sqlJson(runId)})
   from (
     select sales_order_no, quarantine_reason from resolution
      where quarantine_reason is not null
        and sales_order_no not in (select sales_order_no from claim_failure)
     union all
     select sales_order_no, 'claim-failure' from claim_failure
   ) r
   where r.sales_order_no = n.sales_order_no
     and n.state = 'pending'
  returning n.sales_order_no
),
run_counts as (
  update coldlion.sync_run s
     set rows_inserted = (select count(*) from new_headers)
                       + (select count(*) from line_inserts),
         rows_updated = (select count(*) from header_updates)
                      + (select count(*) from line_updates),
         -- rows_unchanged is pinned 0, never left null (the Phase B staging
         -- rule): every row this step touches either inserts or updates, and
         -- a null would read as "not recorded" on the shared audit row.
         rows_unchanged = 0,
         notes = 'step=canonical-write created=' || (select count(*) from created)
              || ' quarantined=' || (select count(*) from quarantined)
              || ' headers+' || (select count(*) from new_headers)
              || '~' || (select count(*) from header_updates)
              || ' lines+' || (select count(*) from line_inserts)
              || '~' || (select count(*) from line_updates)
   where s.id = ${sqlUuid(runId)}
  returning s.id
)
select
  (select count(*) from created) as orders_created,
  (select count(*) from quarantined) as orders_quarantined,
  (select count(*) from new_headers) as headers_inserted,
  (select count(*) from header_updates) as headers_updated,
  (select count(*) from line_inserts) as lines_inserted,
  (select count(*) from line_updates) as lines_updated,
  -- Visible, never silent (§11): scoped pending orders that neither created
  -- nor quarantined — resolved but lineless, or skipped by a re-pend edge —
  -- stay pending and are counted here so the run summary says so.
  (select count(*) from scope)
  - (select count(*) from created)
  - (select count(*) from quarantined) as orders_left_pending;
${write ? "commit;" : "rollback;"}
`;
}

/**
 * The writer's failure recorder — the same SIBLING discipline as the Phase B
 * stager: a failed sync_run row plus pg_notify('coldlion_sync_alert', …) and
 * nothing else. recordFailure() itself would mark coldlion.window_ledger rows
 * state='failed' and poison sealed-window resume (plan §8); this step has no
 * window at all, so no window columns and no intake_window_state write.
 */
export function buildWriteFailureSql({ runId, error, startedAt = new Date().toISOString(), finishedAt = new Date().toISOString() } = {}) {
  const message = String(error?.message ?? error).slice(0, 4000);
  return `begin;
insert into coldlion.sync_run
  (id, endpoint, company_code, request_params, status, requested_by,
   started_at, finished_at, error_message, notes)
values
  (${sqlUuid(runId)}, '/orderHistory', 'POP',
   ${sqlJson({ step: "canonical-write", requestedBy: REQUESTED_BY })},
   'failed', ${sqlText(REQUESTED_BY)}, ${sqlTimestamp(startedAt)}, ${sqlTimestamp(finishedAt)},
   ${sqlText(message)}, 'canonical write step failed')
-- The common failure rolls the whole transaction back, so the id is free and
-- the insert lands. The rare case is a failure AFTER commit (an unreadable
-- summary): the run's row already exists as succeeded, and marking a
-- committed write failed would be a lie — so the conflict path appends the
-- post-commit failure to notes and still fires the alert.
on conflict (id) do update
   set notes = coldlion.sync_run.notes || ' | post-commit failure: ' || excluded.error_message;

select pg_notify('coldlion_sync_alert', ${sqlText(
    `/orderHistory intake canonical write failed: ${message}`.slice(0, 7000),
  )});
commit;`;
}

/**
 * Parse the canonical-write summary row as runSql's psql ACTUALLY prints it
 * (default ALIGNED output with a header, rule, and `(1 row)` footer; or the
 * tab-separated queryRows shape) — parseStageSummary's discipline, with all
 * seven columns required numeric: a NaN count here would silently corrupt the
 * run summary, and §11 forbids silent failures.
 */
export function parseWriteSummary(output) {
  const rows = String(output ?? "")
    .split(/\r?\n/)
    .filter((row) => row.trim().length > 0 && !/^begin;?$/i.test(row.trim()) && !/^commit;?$/i.test(row.trim()) && !/^rollback;?$/i.test(row.trim()));
  const candidates = [];
  for (const row of rows) {
    const fields = row.includes("\t") ? row.split("\t") : row.split("|");
    const trimmed = fields.map((field) => field.trim());
    if (trimmed.length === 7 && trimmed.every((field) => /^\d+$/.test(field))) candidates.push(trimmed);
  }
  const data = candidates.at(-1);
  if (!data) {
    throw new Error(
      "the canonical-write transaction returned no parseable summary row (expected 7 numeric columns: " +
        "orders_created, orders_quarantined, headers_inserted, headers_updated, lines_inserted, lines_updated, orders_left_pending)",
    );
  }
  return {
    orders_created: Number(data[0]),
    orders_quarantined: Number(data[1]),
    headers_inserted: Number(data[2]),
    headers_updated: Number(data[3]),
    lines_inserted: Number(data[4]),
    lines_updated: Number(data[5]),
    orders_left_pending: Number(data[6]),
  };
}

/**
 * Pre-flight object assertion for the WRITE path: OBJECTS, not names (round-1
 * review M1 — the poller's Phase B assertion checks table existence only, and
 * a same-named table with the wrong key would pass it). Three families are
 * asserted exactly:
 *   - tables by (schema, relkind='r');
 *   - the load-bearing CONSTRAINTS by exact relation AND pg_get_constraintdef
 *     text (the Phase B round-3 M-1 rule): both ref-table uniques the
 *     idempotency design rides, both legacy canonical uniques the inserts
 *     touch, and both staging identity uniques that make within-hash-group
 *     constancy structural (one row per identity+hash — the reason C2 needs
 *     no constancy quarantine of its own);
 *   - the INDEXES the winner selection and is_primary placement ride, by exact
 *     relation AND full pg_get_indexdef text (a pg_constraint check cannot see
 *     an index, and a same-named index with a different shape would silently
 *     remove the winner total-order and the one-primary guarantee);
 *   - the set_updated_at BEFORE UPDATE triggers on both canonical tables,
 *     which the second-run no-op guarantee reasons about.
 * Plus every column every INSERT in this module names (both canonical
 * tables, both ref tables, the quarantine insert, and the sync_run write
 * list), so a same-named table missing assortment_component_ordinal refuses
 * before any write.
 */
export const WRITE_REQUIRED_TABLES = Object.freeze([
  "coldlion.intake_order_line",
  "coldlion.intake_order_component",
  "coldlion.intake_new_order",
  "coldlion.routing_code_map",
  "coldlion.intake_quarantine",
  "coldlion.sync_run",
  "plm.production_order",
  "plm.production_order_line",
  "plm.production_order_source_ref",
  "plm.production_order_line_source_ref",
  "core.company_source_ref",
  "plm.erp_customer",
  "coldlion.item_detail",
]);

export const WRITE_REQUIRED_CONSTRAINTS = Object.freeze([
  { schema: "plm", table: "production_order_source_ref", conname: "production_order_source_ref_unique", definition: "UNIQUE (source_system, source_id)" },
  { schema: "plm", table: "production_order_line_source_ref", conname: "production_order_line_source_ref_unique", definition: "UNIQUE (source_system, source_id)" },
  { schema: "plm", table: "production_order", conname: "production_order_source_system_source_id_key", definition: "UNIQUE (source_system, source_id)" },
  { schema: "plm", table: "production_order_line", conname: "production_order_line_source_system_source_id_key", definition: "UNIQUE (source_system, source_id)" },
  { schema: "coldlion", table: "intake_order_line", conname: "coldlion_intake_order_line_identity_unique", definition: "UNIQUE NULLS NOT DISTINCT (sales_order_no, sales_order_line_no, master_item_no, line_source_hash)" },
  { schema: "coldlion", table: "intake_order_component", conname: "coldlion_intake_order_component_identity_unique", definition: "UNIQUE NULLS NOT DISTINCT (line_id, sub_item_no, sub_label_code, component_source_hash)" },
  // Round-2 review M2: the dependencies the writer's own comments lean on.
  // One row per order (deterministic --limit ordering) and salesOrderNo <> 0
  // (never COLDLION-SO-0) are TABLE guarantees, not code conventions.
  { schema: "coldlion", table: "intake_new_order", conname: "coldlion_intake_new_order_sales_order_unique", definition: "UNIQUE (sales_order_no)" },
  { schema: "coldlion", table: "intake_new_order", conname: "coldlion_intake_new_order_so_not_zero", definition: "CHECK ((sales_order_no <> 0))" },
  // The decode join must be unambiguous (plan A1: "PK on code is
  // load-bearing"), the customer lookups ride their uniques/PKs, and the
  // case-pack predicate is the item_detail four-part PK (plan A2).
  { schema: "coldlion", table: "routing_code_map", conname: "coldlion_routing_code_map_code_pkey", definition: "PRIMARY KEY (code)" },
  { schema: "core", table: "company_source_ref", conname: "company_source_ref_source_system_source_table_source_id_key", definition: "UNIQUE (source_system, source_table, source_id)" },
  { schema: "plm", table: "erp_customer", conname: "erp_customer_pkey", definition: "PRIMARY KEY (customer_code)" },
  { schema: "coldlion", table: "item_detail", conname: "item_detail_pkey", definition: "PRIMARY KEY (company_code, division_code, item_no, item_pkey)" },
]);

// Round-2 review H1: an index is a SHAPE, not a name — assert the exact
// pg_get_indexdef text. A same-named index over different columns, or with
// the partial predicate dropped, must refuse the write: the winner
// total-order and the one-primary-per-row guarantee live in these shapes.
export const WRITE_REQUIRED_INDEXES = Object.freeze([
  { schema: "coldlion", name: "coldlion_intake_order_line_winner_idx", definition: "CREATE INDEX coldlion_intake_order_line_winner_idx ON coldlion.intake_order_line USING btree (sales_order_no, sales_order_line_no, master_item_no, last_seen_run DESC, line_source_hash)" },
  { schema: "coldlion", name: "coldlion_intake_order_component_winner_idx", definition: "CREATE INDEX coldlion_intake_order_component_winner_idx ON coldlion.intake_order_component USING btree (line_id, sub_item_no, sub_label_code, last_seen_run DESC, component_source_hash)" },
  { schema: "plm", name: "production_order_source_ref_primary_uidx", definition: "CREATE UNIQUE INDEX production_order_source_ref_primary_uidx ON plm.production_order_source_ref USING btree (production_order_id, source_system) WHERE is_primary" },
  { schema: "plm", name: "production_order_line_source_ref_primary_uidx", definition: "CREATE UNIQUE INDEX production_order_line_source_ref_primary_uidx ON plm.production_order_line_source_ref USING btree (production_order_line_id, source_system) WHERE is_primary" },
]);

// The second-run no-op guarantee reasons about the set_updated_at BEFORE
// UPDATE ROW trigger on both canonical tables (an unguarded same-value
// update would still move updated_at). A trigger is a SHAPE, not a name
// (round-3 review #4): assert the exact pg_get_triggerdef text and that the
// trigger is enabled, so a same-named AFTER/statement-level/disabled
// trigger refuses the write.
export const WRITE_REQUIRED_TRIGGERS = Object.freeze([
  { schema: "plm", table: "production_order", tgname: "set_updated_at", definition: "CREATE TRIGGER set_updated_at BEFORE UPDATE ON plm.production_order FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()" },
  { schema: "plm", table: "production_order_line", tgname: "set_updated_at", definition: "CREATE TRIGGER set_updated_at BEFORE UPDATE ON plm.production_order_line FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()" },
]);

// Round-3 review #3/#5: the typed entries assert information_schema
// data_type too (a same-named text assortment_component_ordinal refuses the
// write instead of breaking the insert), and the list covers every column
// the module WRITES plus every column it READS from the intake staging
// tables (reusing the Phase B specs as the single source of truth) and the
// lookup tables.
const INTAKE_READ_COLUMNS = [
  ...INTAKE_LINE_SPEC.map(([column]) => ({ schema: "coldlion", table: "intake_order_line", column })),
  ...INTAKE_COMPONENT_SPEC.map(([column]) => ({ schema: "coldlion", table: "intake_order_component", column })),
];

export const WRITE_REQUIRED_COLUMNS = Object.freeze([
  { schema: "plm", table: "production_order", column: "production_order_number", type: "text" },
  { schema: "plm", table: "production_order", column: "company_id" },
  { schema: "plm", table: "production_order", column: "metadata", type: "jsonb" },
  { schema: "plm", table: "production_order", column: "source_system", type: "text" },
  { schema: "plm", table: "production_order", column: "source_id", type: "text" },
  { schema: "plm", table: "production_order_line", column: "production_order_id", type: "uuid" },
  { schema: "plm", table: "production_order_line", column: "line_number", type: "text" },
  { schema: "plm", table: "production_order_line", column: "sku", type: "text" },
  { schema: "plm", table: "production_order_line", column: "quantity_ordered", type: "numeric" },
  { schema: "plm", table: "production_order_line", column: "order_person", type: "text" },
  { schema: "plm", table: "production_order_line", column: "order_type", type: "text" },
  { schema: "plm", table: "production_order_line", column: "customer_po_number", type: "text" },
  { schema: "plm", table: "production_order_line", column: "assortment_id", type: "text" },
  { schema: "plm", table: "production_order_line", column: "assortment_component_ordinal", type: "integer" },
  { schema: "plm", table: "production_order_line", column: "case_pack", type: "numeric" },
  { schema: "plm", table: "production_order_line", column: "ship_to", type: "text" },
  { schema: "plm", table: "production_order_line", column: "start_ship_date", type: "date" },
  { schema: "plm", table: "production_order_line", column: "cancel_date", type: "date" },
  { schema: "plm", table: "production_order_line", column: "metadata", type: "jsonb" },
  { schema: "plm", table: "production_order_line", column: "source_system", type: "text" },
  { schema: "plm", table: "production_order_line", column: "source_id", type: "text" },
  { schema: "plm", table: "production_order_source_ref", column: "production_order_id", type: "uuid" },
  { schema: "plm", table: "production_order_source_ref", column: "is_primary", type: "boolean" },
  { schema: "plm", table: "production_order_line_source_ref", column: "production_order_line_id", type: "uuid" },
  { schema: "plm", table: "production_order_line_source_ref", column: "is_primary", type: "boolean" },
  { schema: "coldlion", table: "intake_new_order", column: "sales_order_no" },
  { schema: "coldlion", table: "intake_new_order", column: "warehouse_code" },
  { schema: "coldlion", table: "intake_new_order", column: "claim_evidence" },
  { schema: "coldlion", table: "intake_new_order", column: "state" },
  { schema: "coldlion", table: "intake_new_order", column: "state_changed_at" },
  { schema: "coldlion", table: "intake_quarantine", column: "reason" },
  { schema: "coldlion", table: "intake_quarantine", column: "sales_order_no" },
  { schema: "coldlion", table: "intake_quarantine", column: "detail" },
  { schema: "coldlion", table: "intake_quarantine", column: "first_seen_run" },
  { schema: "coldlion", table: "sync_run", column: "notes" },
  { schema: "coldlion", table: "sync_run", column: "rows_inserted" },
  { schema: "coldlion", table: "sync_run", column: "rows_updated" },
  { schema: "coldlion", table: "sync_run", column: "rows_unchanged" },
  { schema: "coldlion", table: "sync_run", column: "error_message" },
  // Lookup columns the resolution/decode/case-pack paths read.
  { schema: "coldlion", table: "routing_code_map", column: "code" },
  { schema: "coldlion", table: "routing_code_map", column: "order_type" },
  { schema: "coldlion", table: "routing_code_map", column: "ship_to" },
  { schema: "core", table: "company_source_ref", column: "source_system" },
  { schema: "core", table: "company_source_ref", column: "source_table" },
  { schema: "core", table: "company_source_ref", column: "source_id" },
  { schema: "core", table: "company_source_ref", column: "company_id" },
  { schema: "plm", table: "erp_customer", column: "customer_code" },
  { schema: "plm", table: "erp_customer", column: "customer_id" },
  { schema: "plm", table: "erp_customer", column: "active" },
  { schema: "coldlion", table: "item_detail", column: "company_code" },
  { schema: "coldlion", table: "item_detail", column: "division_code" },
  { schema: "coldlion", table: "item_detail", column: "item_no" },
  { schema: "coldlion", table: "item_detail", column: "item_pkey" },
  { schema: "coldlion", table: "item_detail", column: "carton_qty" },
  // Every staging column the winner selection reads (Phase B specs).
  ...INTAKE_READ_COLUMNS,
]);

export function buildWriterObjectAssertionSql() {
  const tableRows = WRITE_REQUIRED_TABLES.map((name) => {
    const parts = name.split(".");
    return "    (" + sqlText(parts[0]) + ", " + sqlText(parts[1]) + ")";
  }).join(", ");
  const constraintRows = WRITE_REQUIRED_CONSTRAINTS.map(
    (entry) => "    (" + sqlText(entry.schema) + ", " + sqlText(entry.table) + ", " + sqlText(entry.conname) + ", " + sqlText(entry.definition) + ")",
  ).join(", ");
  const indexRows = WRITE_REQUIRED_INDEXES.map(
    (entry) => "    (" + sqlText(entry.schema) + ", " + sqlText(entry.name) + ", " + sqlText(entry.definition) + ")",
  ).join(", ");
  const triggerRows = WRITE_REQUIRED_TRIGGERS.map(
    (entry) => "    (" + sqlText(entry.schema) + ", " + sqlText(entry.table) + ", " + sqlText(entry.tgname) + ", " + sqlText(entry.definition) + ")",
  ).join(", ");
  const columnRows = WRITE_REQUIRED_COLUMNS.map(
    (entry) => "    (" + sqlText(entry.schema) + ", " + sqlText(entry.table) + ", " + sqlText(entry.column) + ", " + (entry.type ? sqlText(entry.type) : "null") + ")",
  ).join(", ");
  const NL = "\n";
  return (
    "with required_tables(table_schema, table_name) as (" + NL +
    "  values " + tableRows + NL +
    ")," + NL +
    "required_constraints(schema_name, table_name, conname, def) as (" + NL +
    "  values " + constraintRows + NL +
    ")," + NL +
    "required_indexes(schema_name, index_name, def) as (" + NL +
    "  values " + indexRows + NL +
    ")," + NL +
    "required_triggers(schema_name, table_name, tgname, def) as (" + NL +
    "  values " + triggerRows + NL +
    ")," + NL +
    "required_columns(schema_name, table_name, column_name, type_name) as (" + NL +
    "  values " + columnRows + NL +
    ")," + NL +
    "missing as (" + NL +
    "  select t.table_schema || '.' || t.table_name as missing_object" + NL +
    "    from required_tables t" + NL +
    "   where not exists (" + NL +
    "     select 1 from pg_catalog.pg_class c" + NL +
    "     join pg_catalog.pg_namespace n on n.oid = c.relnamespace" + NL +
    "    where n.nspname = t.table_schema and c.relname = t.table_name and c.relkind = 'r')" + NL +
    "  union all" + NL +
    "  -- A constraint is verified against its EXACT relation AND its definition," + NL +
    "  -- never by name alone (Phase B round-3 M-1)." + NL +
    "  select k.schema_name || '.' || k.table_name || '!' || k.conname as missing_object" + NL +
    "    from required_constraints k" + NL +
    "   where not exists (" + NL +
    "     select 1 from pg_catalog.pg_constraint c" + NL +
    "     join pg_catalog.pg_class r on r.oid = c.conrelid" + NL +
    "     join pg_catalog.pg_namespace n on n.oid = r.relnamespace" + NL +
    "    where n.nspname = k.schema_name" + NL +
    "      and r.relname = k.table_name" + NL +
    "      and c.conname = k.conname" + NL +
    "      and pg_catalog.pg_get_constraintdef(c.oid) = k.def)" + NL +
    "  union all" + NL +
    "  -- pg_constraint cannot see a bare index, and an index is a SHAPE, not" + NL +
    "  -- a name (round-2 review H1): each index is verified against its exact" + NL +
    "  -- relation AND its full pg_get_indexdef text, so a same-named index" + NL +
    "  -- over different columns — or with the partial predicate dropped —" + NL +
    "  -- refuses the write." + NL +
    "  select i.schema_name || '.' || i.index_name as missing_object" + NL +
    "    from required_indexes i" + NL +
    "   where not exists (" + NL +
    "     select 1 from pg_catalog.pg_class c" + NL +
    "     join pg_catalog.pg_namespace n on n.oid = c.relnamespace" + NL +
    "    where n.nspname = i.schema_name" + NL +
    "      and c.relname = i.index_name" + NL +
    "      and c.relkind = 'i'" + NL +
    "      and pg_catalog.pg_get_indexdef(c.oid) = i.def)" + NL +
    "  union all" + NL +
    "  -- The set_updated_at BEFORE UPDATE ROW triggers the second-run no-op" + NL +
    "  -- guarantee reasons about, verified by exact pg_get_triggerdef text" + NL +
    "  -- AND enabled state (a same-named AFTER/statement/disabled trigger" + NL +
    "  -- refuses the write — round-3 review #4)." + NL +
    "  select t.schema_name || '.' || t.table_name || '!' || t.tgname as missing_object" + NL +
    "    from required_triggers t" + NL +
    "   where not exists (" + NL +
    "     select 1 from pg_catalog.pg_trigger g" + NL +
    "     join pg_catalog.pg_class r on r.oid = g.tgrelid" + NL +
    "     join pg_catalog.pg_namespace n on n.oid = r.relnamespace" + NL +
    "    where n.nspname = t.schema_name" + NL +
    "      and r.relname = t.table_name" + NL +
    "      and g.tgname = t.tgname" + NL +
    "      and not g.tgisinternal" + NL +
    "      and g.tgenabled = 'O'" + NL +
    "      and pg_catalog.pg_get_triggerdef(g.oid) = t.def)" + NL +
    "  union all" + NL +
    "  -- Typed entries also pin information_schema.data_type (round-3 review" + NL +
    "  -- #3): a same-named text assortment_component_ordinal refuses here" + NL +
    "  -- instead of breaking the insert mid-transaction." + NL +
    "  select k.schema_name || '.' || k.table_name || '.' || k.column_name ||" + NL +
    "         case when k.type_name is null then '' else '::' || k.type_name end as missing_object" + NL +
    "    from required_columns k" + NL +
    "   where not exists (" + NL +
    "     select 1 from information_schema.columns c" + NL +
    "    where c.table_schema = k.schema_name" + NL +
    "      and c.table_name = k.table_name" + NL +
    "      and c.column_name = k.column_name" + NL +
    "      and (k.type_name is null or c.data_type = k.type_name))" + NL +
    ")" + NL +
    "select coalesce(string_agg(missing_object, ', ' order by missing_object), '') as missing_objects from missing;"
  );
}
