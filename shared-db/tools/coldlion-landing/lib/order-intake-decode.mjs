// Routing decode + quarantine for the ColdLion order intake (plan §9 C1).
//
// Order Type and Ship To are ONE ColdLion field — the routing code in
// warehouseCode — decoded through the curated coldlion.routing_code_map
// (Settled, live-solved 2026-09-17). warehouseCode, never prodTypeCode, is
// authoritative: the two disagree exactly on the orders that matter.
//
// NO COS/stock recognition exists here at all: the settled COS identity is a
// production-PO suffix with salesOrderNo = 0 on PRODUCTION lines; it is not on
// the /orderHistory payload, and inventing a sales-side detector is forbidden.
// Rows with salesOrderNo = 0 are quarantined and never mint COLDLION-SO-0.

import { sqlText, sqlUuid } from "./values.mjs";

/**
 * The decode step, as one transaction of set-based SQL:
 *   1. quarantine staged salesOrderNo = 0 rows (never COLDLION-SO-0);
 *   2. quarantine pending new orders whose warehouse_code has no map row
 *      (unknown code → visible row with the raw code, never a guess);
 *   3. decode everything decodable: stamp decoded_order_type/decoded_ship_to.
 * New-code counts are reported for the run summary.
 *
 * Preconditions: `runIds` are the coldlion.sync_run ids THIS poll inserted (one
 * per scanned window, every one already committed); the decode covers the SET,
 * never a single window's id — a poll that ends on the settled stop rule ends on
 * an EMPTY window, so a last-window-only scope would stage nothing and silently
 * quarantine nothing (round-3 H-1). `quarantineRunId` (the last id) carries the
 * intake_quarantine.first_seen_run FK.
 *
 * The two UPDATEs below touch disjoint row sets BY CONSTRUCTION — `quarantined`
 * takes pending orders whose code has NO map row (or is null), `decoded` takes
 * pending orders whose code HAS one — so both may safely run as data-modifying
 * CTEs against the same snapshot. A future edit that lets the predicates overlap
 * would make the winner arbitrary; keep them mutually exclusive.
 */
export function buildDecodeSql({ runIds, quarantineRunId }) {
  if (!Array.isArray(runIds) || runIds.length === 0) throw new Error("buildDecodeSql requires the poll's run ids");
  const runIdList = runIds.map((id) => sqlUuid(id)).join(", ");
  const quarantineRun = sqlUuid(quarantineRunId ?? runIds[runIds.length - 1]);
  return `begin;

with zero_so as (
  insert into coldlion.intake_quarantine
    (reason, sales_order_no, routing_code, detail, first_seen_run)
  select 'sales-order-no-zero', l.sales_order_no, l.warehouse_code,
         jsonb_build_object('stagedLines', count(*)),
         ${quarantineRun}
  from coldlion.intake_order_line l
  where l.sales_order_no = 0
    -- Scoped to THIS POLL's committed rows — every window's run id, not one (the
    -- decode is a separate transaction after staging, so it sees them all): the
    -- scan is bounded to one poll's lines and served by the leading-key
    -- last_seen_run index, instead of re-reading every historical zero-SO
    -- version on every poll.
    and l.last_seen_run in (${runIdList})
    -- Per-row idempotence, correlated to THIS sales order and code: a global
    -- "any zero-so quarantine from any intake run exists" guard would suppress
    -- every future salesOrderNo = 0 row after the first one, hiding rows the
    -- settled rules require to stay visible (§11: every quarantine is a visible
    -- row with a reason).
    -- Accepted, round-3 M-2a: the guard rides the quarantine's sales_order_no
    -- index with routing_code as a residual filter. intake_quarantine is a small
    -- operator-facing exception queue, so a composite index would be speculative;
    -- revisit only if its row count ever justifies one.
    and not exists (
      select 1 from coldlion.intake_quarantine q
      where q.reason = 'sales-order-no-zero'
        and q.sales_order_no = l.sales_order_no
        and q.routing_code is not distinct from l.warehouse_code)
  group by l.sales_order_no, l.warehouse_code
  returning reason
),
unknown_codes as (
  insert into coldlion.intake_quarantine
    (reason, sales_order_no, routing_code, detail, first_seen_run)
  select 'unknown-routing-code', n.sales_order_no, n.warehouse_code,
         jsonb_build_object('warehouseCode', n.warehouse_code),
         ${quarantineRun}
  from coldlion.intake_new_order n
  where n.state = 'pending'
    and (n.warehouse_code is null
         or not exists (
      select 1 from coldlion.routing_code_map m where m.code = n.warehouse_code))
    -- Correlated to THIS order AND code (like the zero-so guard): a NEW unknown
    -- code on an order quarantined earlier for a different code is a new event
    -- and must stay visible (round-3 L-5).
    and not exists (
      select 1 from coldlion.intake_quarantine q
      where q.reason = 'unknown-routing-code'
        and q.sales_order_no = n.sales_order_no
        and q.routing_code is not distinct from n.warehouse_code)
  returning sales_order_no
),
quarantined as (
  update coldlion.intake_new_order
     set state = 'quarantined', state_changed_at = now()
   where state = 'pending'
     and (warehouse_code is null
          or not exists (select 1 from coldlion.routing_code_map m
                          where m.code = coldlion.intake_new_order.warehouse_code))
   returning sales_order_no
),
decoded as (
  update coldlion.intake_new_order n
     set decoded_order_type = m.order_type,
         decoded_ship_to = m.ship_to
    from coldlion.routing_code_map m
   where m.code = n.warehouse_code
     and n.state = 'pending'
  -- state stays 'pending': decoding is not a claim-state change, so
  -- state_changed_at must not move here (it means "when the state changed").
  returning n.sales_order_no
)
select
  (select count(*) from zero_so) as zero_so_quarantined,
  -- NEW unknown-code EVENTS (the insert is idempotence-guarded, so this counts
  -- first-time quarantine rows only — the most likely operational signal in the
  -- first live weeks — without double-counting orders_quarantined, which counts
  -- the pending set that moved state).
  (select count(*) from unknown_codes) as new_unknown_codes,
  (select count(*) from quarantined) as orders_quarantined,
  (select count(*) from decoded) as orders_decoded;
commit;`;
}
