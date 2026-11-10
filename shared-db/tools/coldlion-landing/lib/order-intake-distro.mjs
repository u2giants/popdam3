// Bulk (HFC) vs distro orders — owner rule 2026-11-10 (popdam docs/ORDER_LIST.md).
//
// Albert, 2026-11-10: "a 'distro' order (broken down by DC) replaces a bulk
// (sometimes called HFC) order." The salesman enters the bulk order in Google
// OrderList as one production line (often with no customer PO or quantity);
// the customer later sends one sales order per distribution center, which
// ColdLion lands as COLDLION-SO-<so> placeholder lines. Those distro lines
// REPLACE the bulk line; they are not additional goods.
//
// This step, run after the one-to-one auto-merge (2026-10-22 ruling):
//   * pairs each placeholder sales-order line with a Google bulk line by the
//     sales order line's ColdLion production reference (order_history_line.
//     prod_reference_no, the D-number) = the Google header number, and SKU;
//   * moves the distro lines onto the bulk line's header, so they carry its
//     production order number (D3651) and production tracking stays together
//     (the intake writer never moves a line back off a non-placeholder header);
//   * retires the Google bulk line: voided_at + void_reason, with
//     metadata.orderlist_replaced_by_distro linking its replacement lines.
//     Never deleted; a voided line is kept, shown struck through, and is out
//     of every live total.
//
// Narrow on purpose (never a guess):
//   * exactly one live Google line for the (reference, SKU) key, on a header
//     whose number is that reference;
//   * the Google line has no sales-order ref yet (a one-to-one merge already
//     made it the live line) and is not voided/cancelled/source-cancelled;
//   * the Google line has a blank customer PO, or at least two distinct
//     sales orders match (one order per distribution center). A single sales
//     order against a Google line with a different PO is left alone.
// Idempotent: moved lines are no longer placeholder lines, retired lines are
// voided, so a second run finds nothing.

import { sqlText, sqlUuid } from "./values.mjs";
import { REQUESTED_BY } from "./order-intake-write.mjs";

export const DISTRO_VOID_REASON = "Replaced by distro (per-distribution-center) orders — owner rule 2026-11-10";

/** The pairing CTEs shared by the write and its tests. */
export function buildDistroPairsSql() {
  return `oh as materialized (
  select distinct on (sales_order_no, sales_order_line_no) sales_order_no, sales_order_line_no,
         upper(nullif(btrim(prod_reference_no), '')) as ref
  from coldlion.order_history_line
  order by sales_order_no, sales_order_line_no, fetched_at desc, created_at desc, id
),
d as materialized (
  select pl.id, pl.sku, p.id as header_id, oh.ref,
         split_part(r.source_id, ':', 3)::bigint as sales_order_no
  from plm.production_order_line pl
  join plm.production_order p on p.id = pl.production_order_id
  join plm.production_order_line_source_ref r
    on r.production_order_line_id = pl.id and r.source_system = 'coldlion' and r.is_primary
   and r.source_id ~ '^coldlion:so:[0-9]+:line:[0-9]+:component:[0-9]+$'
  join oh on oh.sales_order_no = split_part(r.source_id, ':', 3)::bigint
         and oh.sales_order_line_no = split_part(r.source_id, ':', 5)::integer
  where pl.voided_at is null and p.voided_at is null
    and pl.status is distinct from 'cancelled'
    and not (coalesce(pl.metadata, '{}'::jsonb) ? 'orderlist_source_cancellation')
    and p.metadata ->> 'production_order_number_origin' = 'coldlion_intake_placeholder'
    and p.production_order_number ~ '^COLDLION-SO-[0-9]+$'
    and not exists (select 1 from plm.production_order_line_source_ref x
                    where x.production_order_line_id = pl.id and x.source_system <> 'coldlion')
    and oh.ref is not null
),
g as materialized (
  select gl.id, gl.sku, gp.id as header_id, upper(btrim(gp.production_order_number)) as ref,
         nullif(btrim(gl.customer_po_number), '') is null as po_blank
  from (select distinct ref from d) wanted
  join plm.production_order gp on upper(btrim(gp.production_order_number)) = wanted.ref
  join plm.production_order_line gl on gl.production_order_id = gp.id
  where gl.voided_at is null and gp.voided_at is null
    and gl.status is distinct from 'cancelled'
    and not (coalesce(gl.metadata, '{}'::jsonb) ? 'orderlist_source_cancellation')
    and exists (select 1 from plm.production_order_line_source_ref r
                where r.production_order_line_id = gl.id and r.source_system in ('google_order_list', 'popdam_buy_sheet'))
    and not exists (select 1 from plm.production_order_line_source_ref r
                    where r.production_order_line_id = gl.id and r.source_system = 'coldlion'
                      and r.source_id ~ '^coldlion:so:')
),
gkey as materialized (
  select ref, sku, min(id::text)::uuid as id, count(*) as n, bool_and(po_blank) as po_blank, min(header_id::text)::uuid as header_id
  from g group by ref, sku
),
dkey as materialized (
  select ref, sku, count(distinct sales_order_no) as sos from d group by ref, sku
),
pairs as (
  select d.id as distro_line, d.header_id as from_header, gk.id as bulk_line, gk.header_id as bulk_header, d.sales_order_no
  from d
  join gkey gk on gk.ref = d.ref and gk.sku = d.sku and gk.n = 1
  join dkey dk on dk.ref = d.ref and dk.sku = d.sku
  where gk.po_blank or dk.sos >= 2
)`;
}

/**
 * Move every unambiguous distro line onto its bulk line's header and retire
 * the bulk line. One transaction; without write it rolls back.
 * Prints one row: distro_lines_moved, bulk_lines_retired.
 */
export function buildDistroReplaceSql({ runId, write = false } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId ?? "")) {
    throw new Error("buildDistroReplaceSql requires a UUID run id");
  }
  return `begin isolation level repeatable read;
set local enable_nestloop = off;

create temporary table coldlion_distro (distro_line uuid primary key, from_header uuid not null,
  bulk_line uuid not null, bulk_header uuid not null, sales_order_no bigint not null) on commit drop;

with ${buildDistroPairsSql()}
insert into pg_temp.coldlion_distro select distro_line, from_header, bulk_line, bulk_header, sales_order_no from pairs;

insert into coldlion.sync_run (id, endpoint, company_code, request_params, status, requested_by, started_at, finished_at, notes)
select ${sqlUuid(runId)}, '/orderHistory', 'POP',
       jsonb_build_object('step', 'distro-replaces-bulk', 'requestedBy', ${sqlText(REQUESTED_BY)}, 'preimage', jsonb_build_object(
         'pairs', (select jsonb_agg(to_jsonb(c)) from pg_temp.coldlion_distro c),
         'lines', (select jsonb_agg(to_jsonb(pl)) from plm.production_order_line pl
                    where pl.id in (select distro_line from pg_temp.coldlion_distro)
                       or pl.id in (select bulk_line from pg_temp.coldlion_distro)))),
       'succeeded', ${sqlText(REQUESTED_BY)}, now(), now(), 'distro orders replace Google bulk (HFC) lines'
where exists (select 1 from pg_temp.coldlion_distro);

update plm.production_order_line pl
   set production_order_id = c.bulk_header,
       metadata = coalesce(pl.metadata, '{}'::jsonb) || jsonb_build_object('orderlist_distro_of', jsonb_build_object(
         'bulk_line_id', c.bulk_line, 'from_production_order_id', c.from_header,
         'rule', 'owner 2026-11-10 distro replaces bulk', 'run_id', ${sqlText(runId)}, 'at', now())),
       updated_at = now()
  from pg_temp.coldlion_distro c
 where pl.id = c.distro_line;

update plm.production_order_line pl
   set voided_at = now(), void_reason = ${sqlText(DISTRO_VOID_REASON)}, updated_at = now(),
       metadata = coalesce(pl.metadata, '{}'::jsonb) || jsonb_build_object('orderlist_replaced_by_distro', jsonb_build_object(
         'line_ids', r.line_ids, 'sales_orders', r.sales_orders,
         'rule', 'owner 2026-11-10 distro replaces bulk', 'run_id', ${sqlText(runId)}, 'at', now()))
  from (select bulk_line, jsonb_agg(distro_line order by sales_order_no, distro_line) as line_ids,
               jsonb_agg(distinct sales_order_no) as sales_orders
          from pg_temp.coldlion_distro group by bulk_line) r
 where pl.id = r.bulk_line;

select (select count(*) from pg_temp.coldlion_distro), (select count(distinct bulk_line) from pg_temp.coldlion_distro);
${write ? "commit" : "rollback"};`;
}
