// ColdLion production orders that have NO linked sales order yet
// (coldlion.prod_history_line.sales_order_no = 0, no cust_po_number).
//
// Owner ruling 2026-11-09: an order can legitimately reach production before
// the customer's official PO exists. ColdLion then holds a production order
// with no sales order, and the sales-order intake (which is keyed by sales
// order and quarantines salesOrderNo = 0) never sees it. The salesman's
// Google OrderList line for the same order carries the production reference
// (the D-number, = prod_reference_no) as its production_order_number.
//
// This step attaches each such ColdLion production line to its Google line
// as a coldlion source ref — the same-order merge of the owner ruling
// 2026-10-22 — so the row shows as ColdLion-backed and no duplicate is made.
//
// Ref grammar: coldlion:prod:<prod_order_no>:line:<prod_line_seq>:component:<k>
// Seven numeric-castable parts on purpose: older readers split coldlion refs
// with split_part(...)::bigint/::integer; every one of them is gated on the
// '^coldlion:so:' grammar, and prod order numbers (< 1,000,000) never collide
// with sales order numbers (>= 7,000,000) even where a cast runs unguarded.
// k is 1 for a plain line and the component's ordinal (by sub item) for a
// prepack component.
//
// Matching is deliberately narrow (never a guess):
//   * key = (production reference, SKU); Google header number compared
//     case-insensitively, the SKU exactly;
//   * a Google line is a candidate only when it carries NO coldlion ref yet,
//     is not voided, cancelled, or source-cancelled;
//   * exactly one candidate Google line for the key → every unattached
//     ColdLion item of that key attaches to it (one order, possibly split
//     across ColdLion production orders, e.g. Lidl distribution centers);
//   * several candidates → pair only by equal quantity, unique both ways;
//   * no candidate → nothing written (reported as unmatched).
// Idempotent: refs already present are never re-inserted or moved.
//
// When a sales order later arrives for the same goods, buildAutoMergeSql
// treats a Google line that carries only coldlion:prod refs as still
// mergeable, and the sales-order ref becomes the primary one.

import { sqlText, sqlUuid } from "./values.mjs";
import { PROD_REF_PATTERN, REQUESTED_BY } from "./order-intake-write.mjs";

export { PROD_REF_PATTERN };

export function prodLineSourceId(prodOrderNo, prodLineSeq, componentOrdinal) {
  for (const [name, value] of [["prodOrderNo", prodOrderNo], ["prodLineSeq", prodLineSeq], ["componentOrdinal", componentOrdinal]]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  }
  if (prodOrderNo === 0) throw new Error("prodOrderNo must be positive");
  return `coldlion:prod:${prodOrderNo}:line:${prodLineSeq}:component:${componentOrdinal}`;
}

/** The candidate-pairing CTEs shared by the write and the read-only report. */
export function buildProdOnlyPairsSql() {
  return `cur as materialized (
  select distinct on (h.prod_order_no, h.prod_line_seq) h.*
  from coldlion.prod_history_line h
  order by h.prod_order_no, h.prod_line_seq, h.source_observed_at desc nulls last, h.source_version_seq desc nulls last, h.fetched_at desc, h.created_at desc, h.id
),
z as materialized (
  select * from cur
  where sales_order_no = 0
    and division_code is distinct from 'EP001'
    and nullif(btrim(prod_reference_no), '') is not null
),
items as materialized (
  -- Every landed line, plain or prepack, carries component rows; a plain
  -- line's single component is the item itself. Lines landed without any
  -- component row fall back to the line's own item.
  select z.prod_order_no, z.prod_line_seq, 1 as component_ordinal,
         upper(btrim(z.prod_reference_no)) as ref, btrim(z.item_no) as sku,
         z.prod_order_qty as qty
  from z
  where not exists (select 1 from coldlion.prod_history_component c where c.line_id = z.id)
  union all
  select z.prod_order_no, z.prod_line_seq,
         row_number() over (partition by z.id order by c.sub_item_no, c.prepack_item_pkey, c.id)::integer,
         upper(btrim(z.prod_reference_no)), btrim(c.sub_item_no),
         case when btrim(c.sub_item_no) = btrim(z.item_no) then z.prod_order_qty end
  from z join coldlion.prod_history_component c on c.line_id = z.id
  where nullif(btrim(c.sub_item_no), '') is not null
),
ids as materialized (
  select i.*, 'coldlion:prod:' || i.prod_order_no || ':line:' || i.prod_line_seq || ':component:' || i.component_ordinal as source_id
  from items i
),
open_items as materialized (
  select i.* from ids i
  where not exists (select 1 from plm.production_order_line_source_ref r
                    where r.source_system = 'coldlion' and r.source_id = i.source_id)
),
g as materialized (
  select gl.id, upper(btrim(gp.production_order_number)) as ref, gl.sku, gl.quantity_ordered as qty
  from (select distinct ref from open_items) wanted
  join plm.production_order gp on upper(btrim(gp.production_order_number)) = wanted.ref
  join plm.production_order_line gl on gl.production_order_id = gp.id
  where gl.voided_at is null and gp.voided_at is null
    and gl.status is distinct from 'cancelled'
    and not (coalesce(gl.metadata, '{}'::jsonb) ? 'orderlist_source_cancellation')
    and exists (select 1 from plm.production_order_line_source_ref r
                where r.production_order_line_id = gl.id and r.source_system = 'google_order_list')
    and not exists (select 1 from plm.production_order_line_source_ref r
                    where r.production_order_line_id = gl.id and r.source_system = 'coldlion')
),
gcount as materialized (select ref, sku, count(*) as n from g group by ref, sku),
single as (
  select i.source_id, g.id as google_line
  from open_items i
  join gcount gc on gc.ref = i.ref and gc.sku = i.sku and gc.n = 1
  join g on g.ref = i.ref and g.sku = i.sku
),
qty_pairs as (
  select i.source_id, g.id as google_line,
         count(*) over (partition by i.source_id) as gm,
         count(*) over (partition by g.id) as im
  from open_items i
  join gcount gc on gc.ref = i.ref and gc.sku = i.sku and gc.n > 1
  join g on g.ref = i.ref and g.sku = i.sku and i.qty is not null and g.qty = i.qty
),
pairs as (
  select source_id, google_line from single
  union all
  select source_id, google_line from qty_pairs where gm = 1 and im = 1
)`;
}

/**
 * Attach every unambiguous no-sales-order ColdLion production item to its
 * Google OrderList line, then refresh coldlion_values on every line that
 * carries coldlion:prod refs. One transaction; without write it rolls back.
 * Prints one row: refs_attached, lines_touched.
 */
export function buildProdOnlyClaimSql({ runId, write = false } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId ?? "")) {
    throw new Error("buildProdOnlyClaimSql requires a UUID run id");
  }
  return `begin isolation level repeatable read;
-- The landing tables have no statistics shaped for these CTEs; nested loops
-- over ~25k rows estimated as ~30 never finish. Hash joins do in seconds.
set local enable_nestloop = off;

create temporary table coldlion_prod_claim (source_id text primary key, google_line uuid not null) on commit drop;

with ${buildProdOnlyPairsSql()}
insert into pg_temp.coldlion_prod_claim (source_id, google_line)
select source_id, google_line from pairs;

insert into coldlion.sync_run (id, endpoint, company_code, request_params, status, requested_by, started_at, finished_at, notes)
select ${sqlUuid(runId)}, '/prodHistory', 'POP',
       jsonb_build_object('step', 'prod-only-claim', 'requestedBy', ${sqlText(REQUESTED_BY)},
         'claims', (select jsonb_agg(to_jsonb(c)) from pg_temp.coldlion_prod_claim c)),
       'succeeded', ${sqlText(REQUESTED_BY)}, now(), now(),
       'no-sales-order production lines attached to Google OrderList lines'
where exists (select 1 from pg_temp.coldlion_prod_claim);

insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary, metadata)
select c.google_line, 'coldlion', c.source_id,
       c.source_id = min(c.source_id) over (partition by c.google_line),
       jsonb_build_object('linked_by', 'coldlion-prod-only-claim', 'run_id', ${sqlText(runId)},
         'prod_order_no', split_part(c.source_id, ':', 3)::bigint,
         'prod_line_seq', split_part(c.source_id, ':', 5)::bigint)
from pg_temp.coldlion_prod_claim c
on conflict (source_system, source_id) do nothing;

-- ColdLion's current values beside the Google ones (owner ruling 2026-10-28,
-- "One row, both values"): the production reference, and the summed quantity
-- when every attached item is a plain (non-prepack) line.
with cur as (
  select distinct on (h.prod_order_no, h.prod_line_seq) h.id, h.prod_order_no, h.prod_line_seq, h.prod_order_qty, h.prod_reference_no, h.item_no
  from coldlion.prod_history_line h
  order by h.prod_order_no, h.prod_line_seq, h.source_observed_at desc nulls last, h.source_version_seq desc nulls last, h.fetched_at desc, h.created_at desc, h.id
),
refs as (
  select r.production_order_line_id as id, split_part(r.source_id, ':', 7)::integer as k,
         cur.prod_order_qty, nullif(btrim(cur.prod_reference_no), '') as import_po,
         exists (select 1 from coldlion.prod_history_component c
                 where c.line_id = cur.id and btrim(c.sub_item_no) is distinct from btrim(cur.item_no)) as is_prepack
  from plm.production_order_line_source_ref r
  join cur on cur.prod_order_no = split_part(r.source_id, ':', 3)::bigint
          and cur.prod_line_seq = split_part(r.source_id, ':', 5)::bigint
  where r.source_system = 'coldlion' and r.source_id ~ '${PROD_REF_PATTERN}'
    and not exists (select 1 from plm.production_order_line_source_ref s
                    where s.production_order_line_id = r.production_order_line_id
                      and s.source_system = 'coldlion' and s.source_id ~ '^coldlion:so:')
),
v as (
  select id, jsonb_build_object(
           'quantity_ordered', case when bool_and(not is_prepack) then sum(prod_order_qty) end,
           'import_po', min(import_po)) as v
  from refs group by id
)
update plm.production_order_line pl
   set metadata = coalesce(pl.metadata, '{}'::jsonb) || jsonb_build_object('coldlion_values', v.v)
  from v
 where pl.id = v.id and pl.metadata -> 'coldlion_values' is distinct from v.v;

select (select count(*) from pg_temp.coldlion_prod_claim), (select count(distinct google_line) from pg_temp.coldlion_prod_claim);
${write ? "commit" : "rollback"};`;
}
