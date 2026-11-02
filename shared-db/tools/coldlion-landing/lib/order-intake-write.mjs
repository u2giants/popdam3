import { correctionExpressions, buildSourceCorrectionPreflightSql, buildCancellationPreflightSql } from './order-source-corrections.mjs';
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
// NO database routines are created here (non-coordinator work): all SQL lives
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
 *      winner-selection indexes; actual sync_run.started_at orders observations,
 *      then run ID and source hash break ties deterministically, so two
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
  // An explicit --order also re-processes an already-created order, so a
  // writer fix can correct its existing lines in place (every UPDATE stays
  // IS DISTINCT FROM guarded; the state transitions stay pending-only).
  const scopeStates = order !== null ? "('pending', 'created')" : "('pending')";
  // A created order also re-enters scope, explicitly or not, whenever its
  // latest staged components are not all carried by an identity-matching
  // ref — a component ColdLion added after creation (SO 7128092, 2026-10-26)
  // is minted on the next hourly run instead of waiting for a manual --order.
  const incompleteCreated = `
    or (n.state = 'created' and exists (
      select 1
      from (select l.id, l.sales_order_line_no, l.master_item_no,
                   rank() over (partition by l.sales_order_line_no
                                order by r.started_at desc nulls last, l.last_seen_run desc) as run_rank
            from coldlion.intake_order_line l
            left join coldlion.sync_run r on r.id = l.last_seen_run
            where l.sales_order_no = n.sales_order_no
              and l.division_code is distinct from 'EP001') lv
      join coldlion.intake_order_component c on c.line_id = lv.id
      where lv.run_rank = 1
        and not exists (
          select 1 from plm.production_order_line_source_ref r
          where r.source_system = 'coldlion'
            and r.source_id like 'coldlion:so:' || n.sales_order_no::text || ':line:'
                                 || lv.sales_order_line_no::text || ':component:%'
            and r.metadata ->> 'master_item_no' = lv.master_item_no
            and r.metadata ->> 'sub_item_no' is not distinct from nullif(c.sub_item_no, '')
            and r.metadata ->> 'sub_label_code' is not distinct from nullif(c.sub_label_code, ''))))`;
  const scopeLimit = limit !== null ? `\n  limit ${sqlNumber(limit)}` : "";
  const corrected = correctionExpressions({ sku: "raw.sku", po: "raw.po_number" });
  return `begin;

${buildSourceCorrectionPreflightSql()}
${buildCancellationPreflightSql()}

create temporary table coldlion_orderlist_link_scope (
  line_id uuid primary key, expected_type text, incoming_sku text,
  prior_sku text, prior_item_id uuid, prior_status text, prior_source_proof jsonb, expected_replacement_id uuid
) on commit drop;

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
  select n.sales_order_no, n.warehouse_code, n.state
  from coldlion.intake_new_order n
  where (n.state in ${scopeStates}${incompleteCreated})
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
  -- C2 step 0, first tier: the latest OBSERVATION of every staged line
  -- number. ColdLion explodes a prepack line into one row per component, and
  -- the stager stores each as its own line row (one component each, distinct
  -- line_source_hash) under the SAME (sales_order_no, sales_order_line_no,
  -- master_item_no). Those rows are siblings, not versions: picking ONE per
  -- identity dropped 3 of 4 prepack items (2026-10-23, POs 62012010 et al.).
  -- So every row from the most recent run that observed the line number is
  -- kept; rows only an OLDER run saw are superseded versions (changed or
  -- removed items) and drop out. Runs order by sync_run.started_at — a uuid
  -- run id carries no time order — with the run id as the total tiebreak.
  select l.id, l.sales_order_no, l.sales_order_line_no, l.master_item_no,
    l.last_seen_run,
    l.company_code, l.division_code, l.label_code, l.customer_code, l.po_number,
    l.sales_person_code1, l.start_date, l.cancel_date, l.line_qty,
    l.prepack_qty, l.pre_pack_code, l.line_cancelled_qty,
    l.warehouse_code, l.line_source_hash,
    rank() over (partition by l.sales_order_no, l.sales_order_line_no
                 order by r.started_at desc nulls last, l.last_seen_run desc) as run_rank
  from coldlion.intake_order_line l
  join scope s on s.sales_order_no = l.sales_order_no
  left join coldlion.sync_run r on r.id = l.last_seen_run
  -- Defence in depth: EP001 was filtered at ingestion AND refused by the
  -- staging check constraint; the claim path asserts it again so a future
  -- constraint relaxation can never write Edgeucational rows canonically.
  where l.division_code is distinct from 'EP001'
),
winning_lines as (
  -- Second tier: every line row of the latest observation. Several rows may
  -- share one (sales_order_no, sales_order_line_no) — prepack siblings or
  -- several master items — and each keeps its own component slot below.
  select w.id, w.sales_order_no, w.sales_order_line_no, w.master_item_no,
    w.company_code, w.division_code, w.label_code, w.customer_code, w.po_number,
    w.sales_person_code1, w.start_date, w.cancel_date, w.line_qty,
    w.prepack_qty, w.pre_pack_code, w.line_cancelled_qty, w.warehouse_code, w.line_source_hash
  from line_version_winners w
  where w.run_rank = 1
),
winning_components as (
  -- One winner per (line number, master item, sub_item_no, sub_label_code)
  -- across the sibling rows, riding coldlion_intake_order_component_winner_idx
  -- per line_id. NULL sub keys are one identity to DISTINCT ON; the sort keys
  -- keep NULLS LAST so the direct line's NULL-sub component is unambiguous.
  -- UUIDs carry no chronology: component observation time comes first too.
  -- Run ID and hash tiebreaks make the winner total-order deterministic.
  select distinct on (wl.sales_order_no, wl.sales_order_line_no,
                      wl.master_item_no, c.sub_item_no, c.sub_label_code)
    c.line_id, wl.sales_order_no, wl.sales_order_line_no, wl.master_item_no,
    c.sub_item_no, c.sub_label_code, c.order_qty,
    c.component_source_hash
  from coldlion.intake_order_component c
  join winning_lines wl on wl.id = c.line_id
  left join coldlion.sync_run component_run on component_run.id=c.last_seen_run
  order by wl.sales_order_no, wl.sales_order_line_no, wl.master_item_no,
           c.sub_item_no asc nulls last, c.sub_label_code asc nulls last,
           component_run.started_at desc nulls last, c.last_seen_run desc,
           wl.line_source_hash, c.component_source_hash
),
existing_component_refs as (
  -- Component identity is (master_item_no, sub_item_no, sub_label_code),
  -- recorded on the coldlion line ref's own metadata — never a position.
  -- The ordinal in a ref's source_id is an opaque, permanent handle: it was
  -- once row_number() over the sorted component set, and renumbering when the
  -- set changed (2026-10-26, SO 7128092) pointed refs at the wrong SKU and
  -- silently dropped a component. A ref keeps its handle for life; only a
  -- component with no ref yet gets a fresh one (max existing + 1).
  select r.production_order_line_id, r.source_id,
         split_part(r.source_id, ':', 3)::bigint as sales_order_no,
         split_part(r.source_id, ':', 5)::integer as sales_order_line_no,
         split_part(r.source_id, ':', 7)::integer as component_ordinal,
         nullif(r.metadata ->> 'master_item_no', '') is not null as has_identity,
         r.metadata ->> 'master_item_no' as master_item_no,
         nullif(r.metadata ->> 'sub_item_no', '') as sub_item_no,
         nullif(r.metadata ->> 'sub_label_code', '') as sub_label_code,
         case when r.metadata->'orderlist_source_correction'->>'source_id'=r.source_id
           and r.metadata->'orderlist_source_correction'->>'canonical_sku'=pl.sku
           then r.metadata->'orderlist_source_correction'->>'original_sku'
           else pl.sku end as line_sku
  from plm.production_order_line_source_ref r
  join plm.production_order_line pl on pl.id = r.production_order_line_id
  where r.source_system = 'coldlion'
    and r.source_id ~ '^coldlion:so:[0-9]+:line:[0-9]+:component:[0-9]+$'
    and split_part(r.source_id, ':', 3)::bigint in (select sales_order_no from scope)
),
matched_components as (
  select wc.*, er.component_ordinal as existing_ordinal, er.line_sku as existing_sku
  from winning_components wc
  left join existing_component_refs er
    on er.has_identity
   and er.sales_order_no = wc.sales_order_no
   and er.sales_order_line_no = wc.sales_order_line_no
   and er.master_item_no = wc.master_item_no
   and er.sub_item_no is not distinct from nullif(wc.sub_item_no, '')
   and er.sub_label_code is not distinct from nullif(wc.sub_label_code, '')
),
ordinalled as (
  select mc.line_id, mc.sales_order_no, mc.sales_order_line_no, mc.master_item_no,
         mc.sub_item_no, mc.sub_label_code, mc.order_qty, mc.component_source_hash,
         mc.existing_sku,
         coalesce(mc.existing_ordinal,
                  coalesce((select max(er.component_ordinal) from existing_component_refs er
                             where er.sales_order_no = mc.sales_order_no
                               and er.sales_order_line_no = mc.sales_order_line_no), 0)
                  + row_number() over (partition by mc.sales_order_no, mc.sales_order_line_no,
                                                    mc.existing_ordinal is null
                                       order by mc.master_item_no,
                                                mc.sub_item_no asc nulls last,
                                                mc.sub_label_code asc nulls last)) as component_ordinal
  from matched_components mc
),
identity_problems as (
  -- Fail loud, never skip (§11): a ref with no recorded identity, two refs
  -- naming one component, a component matched to more than one ref, or a
  -- matched ref whose line now carries a different SKU all quarantine the
  -- whole order with the evidence, and the order writes nothing.
  select er.sales_order_no, 'ref-without-identity' as problem, er.source_id as detail
  from existing_component_refs er where not er.has_identity
  union all
  select er.sales_order_no, 'duplicate-identity-ref', string_agg(er.source_id, ' ' order by er.source_id)
  from existing_component_refs er where er.has_identity
  group by er.sales_order_no, er.sales_order_line_no, er.master_item_no, er.sub_item_no, er.sub_label_code
  having count(*) > 1
  union all
  select o.sales_order_no, 'sku-mismatch',
         'coldlion:so:' || o.sales_order_no::text || ':line:' || o.sales_order_line_no::text
           || ':component:' || o.component_ordinal::text || ' line=' || o.existing_sku
           || ' staged=' || coalesce(nullif(btrim(o.sub_item_no), ''), o.master_item_no)
  from ordinalled o
  where o.existing_sku is not null
    and o.existing_sku is distinct from coalesce(nullif(btrim(o.sub_item_no), ''), o.master_item_no)
),
identity_conflict as (
  insert into coldlion.intake_quarantine (reason, sales_order_no, detail, first_seen_run)
  select 'component-identity-conflict', ip.sales_order_no,
         jsonb_build_object('problems', jsonb_agg(jsonb_build_object('problem', ip.problem, 'detail', ip.detail)
                                                  order by ip.problem, ip.detail)),
         ${sqlUuid(runId)}
  from identity_problems ip
  where not exists (
    select 1 from coldlion.intake_quarantine q
    where q.reason = 'component-identity-conflict'
      and q.sales_order_no = ip.sales_order_no)
  group by ip.sales_order_no
  returning sales_order_no
),
case_pack as (
  -- Resolve the order's exact item label first, using the COMPONENT label
  -- for a component and the parent label only for a direct item line. If no
  -- matching label exists, every variant in the exact company/division/item
  -- scope must agree. Missing quantities and conflicts remain unknown; this
  -- quantity-only lookup never selects an arbitrary item identity.
  select l.id as line_id,
         coalesce(nullif(btrim(c.sub_item_no), ''), l.master_item_no) as sku,
         min(d.carton_qty) as carton_qty
  from winning_lines l
  join ordinalled c on c.line_id = l.id
  join coldlion.item_detail d
    on d.company_code = l.company_code
   and d.division_code = l.division_code
   and d.item_no = coalesce(nullif(btrim(c.sub_item_no), ''), l.master_item_no)
   and (d.label_code = case when nullif(btrim(c.sub_item_no), '') is null then nullif(btrim(l.label_code), '') else nullif(btrim(c.sub_label_code), '') end
        or not exists (
          select 1 from coldlion.item_detail exact_label
          where exact_label.company_code = l.company_code
            and exact_label.division_code = l.division_code
            and exact_label.item_no = coalesce(nullif(btrim(c.sub_item_no), ''), l.master_item_no)
            and exact_label.label_code = case when nullif(btrim(c.sub_item_no), '') is null then nullif(btrim(l.label_code), '') else nullif(btrim(c.sub_label_code), '') end))
  where nullif(btrim(c.sub_item_no), '') is null
  group by l.id, coalesce(nullif(btrim(c.sub_item_no), ''), l.master_item_no)
  having count(distinct d.carton_qty) = 1
     and count(d.carton_qty) = count(*)
  union all
  -- Owner ruling 2026-10-27 (relaying Yuchen): "It Should show the total
  -- total pieces in the whole carton." Every component of an assortment
  -- carries the WHOLE physical carton's piece count: the parent line's
  -- ColdLion prepackQty. When the assortment master item's exact prepack
  -- variant also records carton_qty, every such value must agree; missing,
  -- nonpositive or conflicting totals stay unknown (never guessed/divided).
  select l.id as line_id, nullif(btrim(c.sub_item_no), '') as sku,
         min(l.prepack_qty) as carton_qty
  from winning_lines l
  join ordinalled c on c.line_id = l.id
  where nullif(btrim(c.sub_item_no), '') is not null
    and l.prepack_qty > 0
    and not (l.line_qty > 0 and coalesce(l.line_cancelled_qty, 0) >= l.line_qty)
    and not exists (
      select 1 from coldlion.item_detail m
      where m.company_code = l.company_code
        and m.division_code = l.division_code
        and m.item_no = l.master_item_no
        and m.pre_pack_code is not distinct from nullif(btrim(l.pre_pack_code), '')
        and m.carton_qty is not null
        and m.carton_qty is distinct from l.prepack_qty)
  group by l.id, nullif(btrim(c.sub_item_no), '')
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
    and r.sales_order_no not in (select sales_order_no from identity_problems)
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
source_canonical_lines as (
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
         case d.division_desc
           when 'POP Creations (Licensed Products)' then 'licensed'
           when 'Spruce (Licensed Products)' then 'licensed'
           when 'Edge Home' then 'generic'
         end as source_style_type,
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
         -- A fully cancelled line is history: its saved Case Pack is never
         -- rewritten by a later item-master or prepack change.
         (wl.line_qty > 0 and coalesce(wl.line_cancelled_qty, 0) >= wl.line_qty) as line_fully_cancelled,
         ah.production_order_id,
         'coldlion:so:' || wl.sales_order_no::text || ':line:'
           || wl.sales_order_line_no::text || ':component:'
           || o.component_ordinal::text as line_source_id
  from winning_lines wl
  left join coldlion.division d
    on d.company_code = wl.company_code and d.division_code = wl.division_code
  join claimable c on c.sales_order_no = wl.sales_order_no
  join coldlion.routing_code_map m on m.code = c.warehouse_code
  join ordinalled o on o.line_id = wl.id
  left join case_pack cp
    on cp.line_id = wl.id
   and cp.sku = coalesce(nullif(btrim(o.sub_item_no), ''), wl.master_item_no)
  join all_headers ah on ah.sales_order_no = wl.sales_order_no
),
canonical_lines as (
  select raw.*, ${corrected.sku} as corrected_sku, ${corrected.po} as corrected_po
  from source_canonical_lines raw
  left join plm.production_order_line_source_ref r
    on r.source_system='coldlion' and r.source_id=raw.line_source_id
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
     cancel_date, metadata, source_system, source_id, source_style_type,
     master_data_match_status)
  select cl.production_order_id, cl.sales_order_line_no::text, cl.corrected_sku,
         cl.quantity_ordered, cl.sales_person_code1, cl.order_type,
         cl.corrected_po, cl.assortment_id, cl.assortment_component_ordinal,
         cl.case_pack, cl.ship_to, cl.start_date, cl.cancel_date,
         jsonb_build_object(
           'line_qty', cl.line_qty,
           'po_number_normalized', cl.po_number_normalized,
           'sub_item_no', cl.sub_item_no,
           'sub_label_code', cl.sub_label_code,
           'master_item_no', cl.master_item_no,
           'component_source_hash', cl.component_source_hash),
         'coldlion', cl.line_source_id, cl.source_style_type,
         case when nullif(btrim(cl.corrected_sku), '') is not null and cl.source_style_type is not null
              then 'unmatched' else 'not_applicable' end
  from canonical_lines cl
  where not exists (
    select 1 from plm.production_order_line_source_ref r
    where r.source_system = 'coldlion'
      and r.source_id = cl.line_source_id)
  returning id, source_id, source_style_type, sku, production_order_id
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
         jsonb_build_object('origin', 'coldlion_intake',
                            'master_item_no', cl.master_item_no,
                            'sub_item_no', nullif(cl.sub_item_no, ''),
                            'sub_label_code', nullif(cl.sub_label_code, ''))
  from line_inserts li
  join canonical_lines cl on cl.line_source_id = li.source_id
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
         sku = cl.corrected_sku,
         quantity_ordered = cl.quantity_ordered,
         order_person = cl.sales_person_code1,
         order_type = cl.order_type,
         customer_po_number = cl.corrected_po,
         assortment_id = cl.assortment_id,
         assortment_component_ordinal = cl.assortment_component_ordinal,
         case_pack = case when cl.line_fully_cancelled then pl.case_pack else cl.case_pack end,
         ship_to = cl.ship_to,
         start_ship_date = cl.start_date,
         cancel_date = cl.cancel_date,
         source_style_type = coalesce(pl.source_style_type, cl.source_style_type),
         metadata = coalesce(pl.metadata, '{}'::jsonb) || jsonb_build_object(
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
          pl.ship_to, pl.start_ship_date, pl.cancel_date, pl.source_style_type, pl.metadata)
       is distinct from
         (cl.production_order_id, cl.sales_order_line_no::text, cl.corrected_sku,
          cl.quantity_ordered, cl.sales_person_code1, cl.order_type,
          cl.corrected_po, cl.assortment_id, cl.assortment_component_ordinal,
          case when cl.line_fully_cancelled then pl.case_pack else cl.case_pack end,
          cl.ship_to, cl.start_date, cl.cancel_date,
          coalesce(pl.source_style_type, cl.source_style_type),
          coalesce(pl.metadata, '{}'::jsonb) || jsonb_build_object(
            'line_qty', cl.line_qty,
            'po_number_normalized', cl.po_number_normalized,
            'sub_item_no', cl.sub_item_no,
            'sub_label_code', cl.sub_label_code,
            'master_item_no', cl.master_item_no,
            'component_source_hash', cl.component_source_hash))
  returning pl.id
),
link_scope as (
  -- Read RETURNING for new lines; existing rows use the pre-statement snapshot.
  -- Never scan or relink an unrelated order, or a line moved to another header.
  insert into pg_temp.coldlion_orderlist_link_scope
    (line_id, expected_type, incoming_sku, prior_sku, prior_item_id, prior_status, prior_source_proof)
  select li.id, li.source_style_type, li.sku, null, null, null,
    jsonb_build_object('source_id', li.source_id, 'production_order_id', li.production_order_id) from line_inserts li
  union all
  select pl.id, cl.source_style_type, cl.corrected_sku, pl.sku, pl.item_id, pl.master_data_match_status,
    jsonb_build_object('source_id', pl.source_id, 'production_order_id', pl.production_order_id,
      'component_source_hash', pl.metadata->>'component_source_hash',
      'master_item_no', pl.metadata->>'master_item_no',
      'sub_item_no', pl.metadata->>'sub_item_no', 'sub_label_code', pl.metadata->>'sub_label_code')
  from canonical_lines cl
  join plm.production_order_line_source_ref ref
    on ref.source_system = 'coldlion' and ref.source_id = cl.line_source_id
  join plm.production_order_line pl on pl.id = ref.production_order_line_id
    and pl.production_order_id = cl.production_order_id
    and pl.source_system = 'coldlion' and pl.source_id = cl.line_source_id
  returning line_id
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
     union all
     select distinct sales_order_no, 'component-identity-conflict' from identity_problems
      where sales_order_no not in (select sales_order_no from claim_failure)
        and sales_order_no not in (select sales_order_no from resolution where quarantine_reason is not null)
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
              || ' identityConflicts=' || (select count(*) from identity_conflict)
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
  (select count(*) from scope where state = 'pending')
  - (select count(*) from created)
  - (select count(*) from quarantined) as orders_left_pending;
-- This separate statement sees all preceding CTE writes. Failure here rolls
-- back the entire intake, including classification, source refs and run counts.
do $link_intake$
declare
  batch uuid[];
  receipt jsonb;
begin
  -- Lock the exact source-owned cohort before inspecting or invalidating links.
  perform l.id from plm.production_order_line l
    join pg_temp.coldlion_orderlist_link_scope s on s.line_id = l.id
    order by l.id for update of l;
  if exists (select 1 from pg_temp.coldlion_orderlist_link_scope s
             left join plm.production_order_line l on l.id = s.line_id
             where s.expected_type is null
                or l.source_style_type is distinct from s.expected_type) then
    raise exception 'ColdLion intake division classification unknown or conflicts with existing line; no changes committed';
  end if;
  if exists (select 1 from pg_temp.coldlion_orderlist_link_scope s
      join plm.production_order_line l on l.id = s.line_id
      where l.metadata ? 'coldlion_intake_link_refreshes'
        and jsonb_typeof(l.metadata->'coldlion_intake_link_refreshes') <> 'array') then
    raise exception 'ColdLion intake link history is not an array; no changes committed';
  end if;

  -- CTE snapshots can precede another actor's move/rekey of an unchanged row.
  -- Re-prove all mutable authority AFTER locks, before helper or invalidation.
  if exists (select 1 from pg_temp.coldlion_orderlist_link_scope s
      left join plm.production_order_line l on l.id = s.line_id
      where l.id is null or l.source_system is distinct from 'coldlion'
        or l.source_id is distinct from s.prior_source_proof->>'source_id'
        or l.production_order_id is distinct from (s.prior_source_proof->>'production_order_id')::uuid
        or l.sku_normalized is distinct from nullif(btrim(lower(s.incoming_sku)), '')
        or l.source_style_type is distinct from s.expected_type) then
    raise exception 'ColdLion intake source authority changed under lock; no changes committed';
  end if;


  -- Both paths preserve manual/not-applicable and valid links. A changed
  -- nonblank SKU invalidates the old automatic link even without a new match;
  -- an unchanged SKU requires a positively proved unique replacement.
  with candidates as materialized (
    select s.line_id, count(distinct b.plm_item_id)::integer as candidate_count,
      (array_agg(distinct b.plm_item_id order by b.plm_item_id)
        filter (where b.plm_item_id is not null))[1] as candidate_item,
      nullif(btrim(lower(s.prior_sku)), '') is distinct from
        nullif(btrim(lower(s.incoming_sku)), '') as sku_changed
    from pg_temp.coldlion_orderlist_link_scope s
    join plm.production_order_line l on l.id = s.line_id
    left join public.style_tracker_rows r
      on nullif(btrim(lower(r.sku)), '') = l.sku_normalized
    left join plm.style_tracker_item_bridge b on b.style_tracker_row_id = r.id
      and b.tracker_type = s.expected_type
    where s.prior_status = 'matched' and s.prior_item_id is not null
      and l.master_data_match_status = 'matched' and l.item_id = s.prior_item_id
      and nullif(btrim(s.incoming_sku), '') is not null
    group by s.line_id, s.prior_sku, s.incoming_sku
  ), proved as materialized (
    select c.*, case when c.candidate_count = 1
      and (select f.facts->>'source'
        from dam.orderlist_product_facts(c.candidate_item, s.expected_type) f) = 'master_data'
      then c.candidate_item end as expected_item
    from candidates c join pg_temp.coldlion_orderlist_link_scope s on s.line_id = c.line_id
  ), refresh_scope as (
    update pg_temp.coldlion_orderlist_link_scope s
      set expected_replacement_id = p.expected_item
    from proved p
    where s.line_id = p.line_id
      and ((p.sku_changed and not (p.candidate_count = 1 and p.candidate_item = s.prior_item_id))
           or (p.expected_item is not null and p.expected_item <> s.prior_item_id))
    returning s.*, p.candidate_count, p.sku_changed
  )
  update plm.production_order_line l
    set item_id = null, master_data_match_status = 'unmatched', updated_at = now(),
      metadata = coalesce(l.metadata, '{}'::jsonb) || jsonb_build_object(
        'coldlion_intake_link_refreshes',
        coalesce(l.metadata->'coldlion_intake_link_refreshes', '[]'::jsonb) ||
          jsonb_build_array(jsonb_build_object(
            'prior_item_id', s.prior_item_id, 'prior_status', s.prior_status,
            'prior_sku', s.prior_sku, 'prior_source_proof', s.prior_source_proof,
            'source_sku', l.sku,
            'source_id', l.source_id, 'production_order_id', l.production_order_id,
            'source_style_type', s.expected_type,
            'component_source_hash', l.metadata->>'component_source_hash',
            'candidate_count', s.candidate_count, 'expected_item_id', s.expected_replacement_id,
            'workflow_source', case when s.expected_replacement_id is not null then 'master_data' end,
            'reason', case when s.sku_changed then 'source_sku_changed' else 'stale_automatic_item' end,
            'run', ${sqlJson(runId)}, 'at', now())))
    from refresh_scope s where l.id = s.line_id;

  for batch in
    select array_agg(line_id order by line_id)
    from (select line_id, (row_number() over (order by line_id) - 1) / 500 as chunk
          from pg_temp.coldlion_orderlist_link_scope) s
    group by chunk order by chunk
  loop
    receipt := public.link_dam_order_lines_scoped(batch);
    raise notice 'ColdLion intake Master Data links: %', receipt;
  end loop;
  if exists (select 1 from pg_temp.coldlion_orderlist_link_scope s
      join plm.production_order_line l on l.id = s.line_id
      where s.expected_replacement_id is not null
        and (l.item_id is distinct from s.expected_replacement_id
             or l.master_data_match_status <> 'matched')) then
    raise exception 'ColdLion intake verified link replacement changed or failed; no changes committed';
  end if;
end;
$link_intake$;
${write ? "commit;" : "rollback;"}
`;
}

/**
 * The recurring component-identity guard (2026-10-27, SO 7128092). Read-only.
 * For every created order it compares the latest staged observation — the
 * writer's own two-tier winner selection — with the coldlion component refs:
 * each staged component must have exactly one ref carrying its identity, and
 * that ref's line must carry the staged SKU, wherever a claim has moved it.
 * One summary row: missing | duplicate | sku_mismatch | without_identity |
 * expected | identity_quarantined | a sample of offenders. Anything non-zero fails the intake run loudly.
 */
export function buildIdentityGuardSql() {
  const correction = correctionExpressions({ sku: "s.sku", po: "s.po_number", metadata: "f.metadata", sourceId: "f.source_id" });
  return `with lv as (
  select l.id, l.sales_order_no, l.sales_order_line_no, l.master_item_no, l.po_number,
         rank() over (partition by l.sales_order_no, l.sales_order_line_no
                      order by r.started_at desc nulls last, l.last_seen_run desc) as run_rank
  from coldlion.intake_order_line l
  join coldlion.intake_new_order n on n.sales_order_no = l.sales_order_no and n.state = 'created'
  left join coldlion.sync_run r on r.id = l.last_seen_run
  where l.division_code is distinct from 'EP001'
),
staged as (
  select distinct lv.sales_order_no, lv.sales_order_line_no, lv.master_item_no, lv.po_number,
         nullif(c.sub_item_no, '') as sub_item_no, nullif(c.sub_label_code, '') as sub_label_code,
         coalesce(nullif(btrim(c.sub_item_no), ''), lv.master_item_no) as sku
  from lv join coldlion.intake_order_component c on c.line_id = lv.id
  where lv.run_rank = 1
),
refs as (
  select r.metadata, split_part(r.source_id, ':', 3)::bigint as sales_order_no,
         split_part(r.source_id, ':', 5)::integer as sales_order_line_no,
         nullif(r.metadata ->> 'master_item_no', '') is not null as has_identity,
         r.metadata ->> 'master_item_no' as master_item_no,
         nullif(r.metadata ->> 'sub_item_no', '') as sub_item_no,
         nullif(r.metadata ->> 'sub_label_code', '') as sub_label_code,
         r.source_id, pl.sku
  from plm.production_order_line_source_ref r
  join plm.production_order_line pl on pl.id = r.production_order_line_id
  where r.source_system = 'coldlion'
    and r.source_id ~ '^coldlion:so:[0-9]+:line:[0-9]+:component:[0-9]+$'
    and split_part(r.source_id, ':', 3)::bigint in
        (select sales_order_no from coldlion.intake_new_order where state = 'created')
),
checked as (
  select s.*, count(f.source_id) as refs,
         count(*) filter (where f.sku is distinct from (${correction.sku}) and f.source_id is not null) as wrong_sku,
         min(f.source_id) as source_id
  from staged s
  left join refs f
    on f.has_identity and f.sales_order_no = s.sales_order_no
   and f.sales_order_line_no = s.sales_order_line_no and f.master_item_no = s.master_item_no
   and f.sub_item_no is not distinct from s.sub_item_no
   and f.sub_label_code is not distinct from s.sub_label_code
  group by s.sales_order_no, s.sales_order_line_no, s.master_item_no, s.sub_item_no, s.sub_label_code, s.sku, s.po_number
)
select (select count(*) from checked where refs = 0) as missing,
       (select count(*) from checked where refs > 1) as duplicate,
       (select count(*) from checked where wrong_sku > 0) as sku_mismatch,
       (select count(*) from refs where not has_identity) as without_identity,
       (select count(*) from checked) as expected,
       (select count(*) from coldlion.intake_new_order n
         where n.state = 'quarantined'
           and n.claim_evidence ->> 'quarantine_reason' = 'component-identity-conflict') as identity_quarantined,
       coalesce((select string_agg(x, ' ') from (
          select sales_order_no || '/' || sales_order_line_no || '/' || sku || ':'
                 || case when refs = 0 then 'missing' when refs > 1 then 'duplicate' else 'sku' end as x
          from checked where refs <> 1 or wrong_sku > 0
          order by sales_order_no, sales_order_line_no, sku limit 20) t), '') as sample;`;
}

/**
 * Automatic merge onto the Import PO (owner ruling, Albert Hazan, 2026-10-27:
 * "ColdLion orders should merge automatically into matching Google rows for
 * all orders"). A placeholder line moves onto the Google OrderList line with
 * the same customer PO and SKU, the way SO 7128092 merged onto D3691: the
 * Google line keeps every value it has, a blank Google quantity takes the
 * ColdLion one, the coldlion refs and any snapshot move over, and the
 * placeholder line goes. Only an unambiguous pair merges: exactly one Google
 * line and exactly one placeholder line for the (PO, SKU), the PO compared
 * without surrounding spaces or leading zeros. A pair that
 * disagrees on quantity or Import PO still merges (owner ruling, 2026-10-28:
 * "One row, both values"): the Google values stay, and ColdLion's current
 * values ride metadata.coldlion_values for the screen to show beside them.
 * Anything ambiguous stays a placeholder, untouched. The full preimage,
 * including every moved coldlion ref row, rides the run's own sync_run row.
 */
export function buildAutoMergeSql({ runId, write = false } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId ?? "")) {
    throw new Error("buildAutoMergeSql requires a UUID run id");
  }
  return `begin;

${buildSourceCorrectionPreflightSql()}
${buildCancellationPreflightSql()}

create temporary table coldlion_auto_merge (placeholder_line uuid primary key, google_line uuid unique not null) on commit drop;

with ph as (
  select pl.id, pl.sku, nullif(ltrim(btrim(pl.customer_po_number), '0'), '') as po_key, pl.quantity_ordered as q,
         substr(p.production_order_number, 13)::bigint as sales_order_no,
         (select min(substring(r.source_id from '^coldlion:so:[0-9]+:line:([0-9]+):')::integer)
            from plm.production_order_line_source_ref r
           where r.production_order_line_id = pl.id and r.source_system = 'coldlion') as sales_order_line_no
  from plm.production_order_line pl
  join plm.production_order p on p.id = pl.production_order_id
  where pl.voided_at is null
    and p.metadata ->> 'production_order_number_origin' = 'coldlion_intake_placeholder'
    and p.production_order_number ~ '^COLDLION-SO-[0-9]+$'
    and exists (select 1 from plm.production_order_line_source_ref r
                where r.production_order_line_id = pl.id and r.source_system = 'coldlion')
    and not exists (select 1 from plm.production_order_line_source_ref r
                    where r.production_order_line_id = pl.id and r.source_system <> 'coldlion')
    -- A person chose "keep it as its own row" on the triage screen (#5004).
    and coalesce(pl.metadata ->> 'coldlion_kept_separate', '') <> 'true'
),
g as (
  select gl.id, gl.sku, nullif(ltrim(btrim(gl.customer_po_number), '0'), '') as po_key, gl.quantity_ordered as q,
         gp.production_order_number as import_po
  from plm.production_order_line gl
  join plm.production_order gp on gp.id = gl.production_order_id
  where gl.voided_at is null
    and gp.production_order_number !~ '^COLDLION-SO-'
    and exists (select 1 from plm.production_order_line_source_ref r
                where r.production_order_line_id = gl.id and r.source_system = 'google_order_list')
    and not exists (select 1 from plm.production_order_line_source_ref r
                    where r.production_order_line_id = gl.id and r.source_system = 'coldlion')
),
pairs as (
  select ph.id as placeholder_line, g.id as google_line, ph.q as pq, g.q as gq, ph.sales_order_no, ph.sales_order_line_no, g.import_po,
         count(*) over (partition by ph.id) as google_matches,
         count(*) over (partition by g.id) as placeholder_matches
  -- ColdLion pads some customer POs with leading zeros (0001220303) that the
  -- Google sheet does not (1220303): the PO compares trimmed and unpadded.
  from ph join g on g.po_key = ph.po_key and g.sku = ph.sku
)
insert into pg_temp.coldlion_auto_merge (placeholder_line, google_line)
select p.placeholder_line, p.google_line
from pairs p
where p.google_matches = 1 and p.placeholder_matches = 1
  and p.sales_order_line_no is not null;

insert into coldlion.sync_run (id, endpoint, company_code, request_params, status, requested_by, started_at, finished_at, notes)
select ${sqlUuid(runId)}, '/orderHistory', 'POP',
       jsonb_build_object('step', 'auto-merge', 'requestedBy', ${sqlText(REQUESTED_BY)}, 'preimage', jsonb_build_object(
         'pairs', (select jsonb_agg(to_jsonb(m)) from pg_temp.coldlion_auto_merge m),
         'lines', (select jsonb_agg(to_jsonb(pl)) from plm.production_order_line pl
                    where pl.id in (select placeholder_line from pg_temp.coldlion_auto_merge)
                       or pl.id in (select google_line from pg_temp.coldlion_auto_merge)),
         'coldlion_refs', (select jsonb_agg(to_jsonb(r)) from plm.production_order_line_source_ref r
                    where r.source_system = 'coldlion'
                      and r.production_order_line_id in (select placeholder_line from pg_temp.coldlion_auto_merge)),
         'snapshots', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'production_order_line_id', s.production_order_line_id)), '[]')
                    from dam.production_order_snapshot s
                    where s.production_order_line_id in (select placeholder_line from pg_temp.coldlion_auto_merge)))),
       'succeeded', ${sqlText(REQUESTED_BY)}, now(), now(), 'automatic merge onto Google OrderList lines'
where exists (select 1 from pg_temp.coldlion_auto_merge);

update plm.production_order_line g
   set quantity_ordered = pl.quantity_ordered
  from pg_temp.coldlion_auto_merge m
  join plm.production_order_line pl on pl.id = m.placeholder_line
 where g.id = m.google_line and g.quantity_ordered is null and pl.quantity_ordered is not null;

-- The quantity reader binds an order-time component recipe to its source
-- hash. Moving only the ref loses that provenance on an existing Google row.
-- Carry it only to the exact same SKU/assortment and only when no hash exists.
-- A conflicting saved hash is retained for explicit reconciliation.
update plm.production_order_line g
   set metadata=coalesce(g.metadata,'{}'::jsonb) ||
     jsonb_build_object('component_source_hash',pl.metadata->'component_source_hash')
  from pg_temp.coldlion_auto_merge m
  join plm.production_order_line pl on pl.id=m.placeholder_line
 where g.id=m.google_line and g.sku=pl.sku
   and g.assortment_id is not distinct from pl.assortment_id
   and not (coalesce(g.metadata,'{}'::jsonb) ? 'component_source_hash')
   and nullif(btrim(pl.metadata->>'component_source_hash'),'') is not null;

update plm.production_order_line_source_ref r
   set production_order_line_id = m.google_line
  from pg_temp.coldlion_auto_merge m
 where r.production_order_line_id = m.placeholder_line and r.source_system = 'coldlion';

update dam.production_order_snapshot s
   set production_order_line_id = m.google_line
  from pg_temp.coldlion_auto_merge m
 where s.production_order_line_id = m.placeholder_line;

delete from plm.production_order_line where id in (select placeholder_line from pg_temp.coldlion_auto_merge);

-- Owner ruling 2026-10-28 ("One row, both values"): every line whose coldlion
-- ref sits on a non-placeholder header carries ColdLion's CURRENT quantity and
-- Import PO in metadata.coldlion_values, refreshed every run so the screen can
-- show a disagreement next to the Google value. The quantity is the newest
-- staged version of the ref's own component identity; the Import PO is the
-- newest retained prod_reference_no of its own line.
with lv as (
  select l.id, l.sales_order_no, l.sales_order_line_no, l.master_item_no,
         rank() over (partition by l.sales_order_no, l.sales_order_line_no
                      order by r.started_at desc nulls last, l.last_seen_run desc) as run_rank
  from coldlion.intake_order_line l
  left join coldlion.sync_run r on r.id = l.last_seen_run
),
staged as (
  select lv.sales_order_no, lv.sales_order_line_no, lv.master_item_no,
         nullif(c.sub_item_no, '') as sub_item_no, nullif(c.sub_label_code, '') as sub_label_code,
         min(c.order_qty) as order_qty, count(distinct c.order_qty) as qtys
  from lv join coldlion.intake_order_component c on c.line_id = lv.id
  where lv.run_rank = 1
  group by 1, 2, 3, 4, 5
),
oh as (
  select distinct on (sales_order_no, sales_order_line_no) sales_order_no, sales_order_line_no,
         nullif(btrim(prod_reference_no), '') as import_po
  from coldlion.order_history_line
  order by sales_order_no, sales_order_line_no, fetched_at desc, created_at desc, id
),
cur as (
  select distinct on (r.production_order_line_id) r.production_order_line_id as id,
         jsonb_build_object('quantity_ordered', case when s.qtys = 1 then s.order_qty end,
                            'import_po', oh.import_po) as v
  from plm.production_order_line_source_ref r
  join plm.production_order_line pl on pl.id = r.production_order_line_id
  join plm.production_order p on p.id = pl.production_order_id
  left join staged s
    on s.sales_order_no = split_part(r.source_id, ':', 3)::bigint
   and s.sales_order_line_no = split_part(r.source_id, ':', 5)::integer
   and s.master_item_no = r.metadata ->> 'master_item_no'
   and s.sub_item_no is not distinct from nullif(r.metadata ->> 'sub_item_no', '')
   and s.sub_label_code is not distinct from nullif(r.metadata ->> 'sub_label_code', '')
  left join oh
    on oh.sales_order_no = split_part(r.source_id, ':', 3)::bigint
   and oh.sales_order_line_no = split_part(r.source_id, ':', 5)::integer
  where r.source_system = 'coldlion'
    and r.source_id ~ '^coldlion:so:[0-9]+:line:[0-9]+:component:[0-9]+$'
    and coalesce(p.metadata ->> 'production_order_number_origin', '') <> 'coldlion_intake_placeholder'
  order by r.production_order_line_id, r.source_id
)
update plm.production_order_line pl
   set metadata = coalesce(pl.metadata, '{}'::jsonb) || jsonb_build_object('coldlion_values', cur.v)
  from cur
 where pl.id = cur.id and pl.metadata -> 'coldlion_values' is distinct from cur.v;

select count(*) from pg_temp.coldlion_auto_merge;
${write ? "commit" : "rollback"};`;
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
  "public.style_tracker_rows",
  "plm.style_tracker_item_bridge",
  "plm.production_order_source_ref",
  "plm.production_order_line_source_ref",
  "core.company_source_ref",
  "plm.erp_customer",
  "coldlion.item_detail",
  "coldlion.division",
  // The automatic merge (buildAutoMergeSql) reads ColdLion's own Import PO
  // reference and moves line snapshots onto the Google line.
  "coldlion.order_history_line",
  "dam.production_order_snapshot",
]);

export const WRITE_REQUIRED_CONSTRAINTS = Object.freeze([
  { schema: "coldlion", table: "division", conname: "coldlion_division_pkey", definition: "PRIMARY KEY (company_code, division_code)" },
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
  { schema: "public", table: "style_tracker_rows", column: "id", type: "uuid" },
  { schema: "public", table: "style_tracker_rows", column: "sku", type: "text" },
  { schema: "plm", table: "style_tracker_item_bridge", column: "style_tracker_row_id", type: "uuid" },
  { schema: "plm", table: "style_tracker_item_bridge", column: "plm_item_id", type: "uuid" },
  { schema: "plm", table: "style_tracker_item_bridge", column: "tracker_type", type: "text" },
  { schema: "plm", table: "production_order_line", column: "sku_normalized", type: "text" },
  { schema: "plm", table: "production_order_line", column: "item_id", type: "uuid" },
  { schema: "plm", table: "production_order_line", column: "master_data_match_status", type: "text" },
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
  { schema: "coldlion", table: "item_detail", column: "pre_pack_code" },
  { schema: "coldlion", table: "item_detail", column: "label_code" },
  { schema: "coldlion", table: "division", column: "company_code" },
  { schema: "coldlion", table: "division", column: "division_code" },
  { schema: "coldlion", table: "division", column: "division_desc" },
  // The automatic merge's reads and its snapshot move.
  { schema: "coldlion", table: "order_history_line", column: "sales_order_no", type: "bigint" },
  { schema: "coldlion", table: "order_history_line", column: "sales_order_line_no", type: "integer" },
  { schema: "coldlion", table: "order_history_line", column: "prod_reference_no", type: "text" },
  { schema: "coldlion", table: "order_history_line", column: "fetched_at" },
  { schema: "coldlion", table: "order_history_line", column: "created_at" },
  { schema: "coldlion", table: "order_history_line", column: "id", type: "uuid" },
  { schema: "dam", table: "production_order_snapshot", column: "id", type: "uuid" },
  { schema: "dam", table: "production_order_snapshot", column: "production_order_line_id", type: "uuid" },
  { schema: "plm", table: "production_order_line", column: "source_style_type" },
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
    "  select 'dam.orderlist_product_facts(uuid,text)' as missing_object" + NL +
    "  where pg_catalog.to_regprocedure('dam.orderlist_product_facts(uuid,text)') is null" + NL +
    "  union all" + NL +
    "  select 'public.link_dam_order_lines_scoped(uuid[])' as missing_object" + NL +
    "  where pg_catalog.to_regprocedure('public.link_dam_order_lines_scoped(uuid[])') is null" + NL +
    "  union all" + NL +
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
