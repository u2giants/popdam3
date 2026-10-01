// Offline tests for the ColdLion order-intake decode step
// (plan_coldlion_order_intake.md §9 C1 / Phase E). No secrets, no database —
// the decode is SQL text built by lib/order-intake-decode.mjs, so these tests
// prove its shape: the routing join, the quarantine paths, and the ABSENCE of
// anything the settled rules forbid.

import test from "node:test";
import assert from "node:assert/strict";

import { buildDecodeSql } from "./coldlion-landing/lib/order-intake-decode.mjs";

const RUN = "11111111-2222-3333-4444-555555555555";
const RUN2 = "66666666-7777-8888-9999-000000000000";
// The decode covers the POLL's run ids (every window), never one window's id:
// a poll that ends on the settled stop rule ends on an EMPTY window whose id
// staged nothing, so a last-window-only scope would quarantine nothing (H-1).
const sql = buildDecodeSql({ runIds: [RUN, RUN2], quarantineRunId: RUN2 });
const singleRunSql = buildDecodeSql({ runIds: [RUN] });

test("the zero-SO scan covers EVERY run id of the poll", () => {
  assert.match(sql, /l\.last_seen_run in \(uuid '11111111-2222-3333-4444-555555555555', uuid '66666666-7777-8888-9999-000000000000'\)/);
  assert.match(singleRunSql, /l\.last_seen_run in \(uuid '11111111-2222-3333-4444-555555555555'\)/);
  assert.throws(() => buildDecodeSql({ runIds: [] }), /requires the poll's run ids/);
});

test("the decode joins the curated routing map on the exact code", () => {
  assert.match(sql, /from coldlion\.routing_code_map m\s+where m\.code = n\.warehouse_code/);
  assert.match(sql, /decoded_order_type = m\.order_type/);
  assert.match(sql, /decoded_ship_to = m\.ship_to/);
});

test("unknown and NULL routing codes quarantine; decodable orders never touch quarantine", () => {
  assert.match(sql, /'unknown-routing-code'/);
  assert.match(sql, /not exists \(\s*select 1 from coldlion\.routing_code_map m where m\.code = n\.warehouse_code\)/);
  // A NULL warehouse_code is as unknown as an unmapped one.
  assert.match(sql, /n\.warehouse_code is null/);
  // Quarantine is idempotent — the same order is not re-quarantined every run.
  assert.match(sql, /not exists \(\s*select 1 from coldlion\.intake_quarantine q/);
});

test("salesOrderNo = 0 rows quarantine and never mint a COLDLION-SO-0 header", () => {
  assert.match(sql, /'sales-order-no-zero'/);
  assert.match(sql, /l\.sales_order_no = 0/);
  // The zero-so scan is scoped to THIS run's committed rows: bounded to one
  // poll's lines and served by the leading-key last_seen_run index, never a
  // re-read of every historical zero-SO version on every poll.
  assert.doesNotMatch(sql, /select distinct/);
  // The zero-so quarantine idempotence guard is PER ROW (this sales order + this
  // code), never a global "any intake run already quarantined some zero row" —
  // a global guard would hide every later salesOrderNo = 0 row after the first.
  assert.match(sql, /q\.sales_order_no = l\.sales_order_no/);
  assert.match(sql, /q\.routing_code is not distinct from l\.warehouse_code/);
  assert.doesNotMatch(sql, /coldlion\.sync_run/);
  // The decode path never constructs a placeholder header key at all; the only
  // string even resembling one must not appear here.
  assert.doesNotMatch(sql, /COLDLION-SO/);
});

test("decoding stamps the decoded columns but never moves state or state_changed_at", () => {
  // Decode is not a claim-state change: state stays 'pending' and
  // state_changed_at keeps meaning "when the state changed" (only the
  // quarantined transition touches it).
  const decodedBlock = sql.slice(sql.indexOf("decoded as ("), sql.indexOf("select\n  (select count(*)"));
  assert.ok(decodedBlock.length > 0);
  assert.match(decodedBlock, /decoded_order_type = m\.order_type/);
  // No ASSIGNMENT of state_changed_at or state (the explanatory comment inside
  // the SQL names the column, so match the assignment shapes, not the bare word).
  assert.doesNotMatch(decodedBlock, /state_changed_at\s*=/);
  assert.doesNotMatch(decodedBlock, /set\s+state\b/);
});

test("COS/stock absence proven: no sales-side COS or stock detector exists in the decode", () => {
  // The settled COS identity is a production-PO suffix with salesOrderNo = 0 on
  // PRODUCTION lines; it is not on the /orderHistory payload, and inventing a
  // sales-side detector is forbidden (plan §8).
  assert.doesNotMatch(sql, /\bCOS\b/i);
  assert.doesNotMatch(sql, /stock[-_ ]?order/i);
  assert.doesNotMatch(sql, /contractual sample|david sample/i);
});

test("the decode reports counts for the run summary and commits atomically", () => {
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /as zero_so_quarantined/);
  // NEW unknown-code EVENTS are reported on their own (the insert is
  // idempotence-guarded, so this is first-time codes only) without
  // double-counting the quarantined pending set.
  assert.match(sql, /as new_unknown_codes/);
  assert.match(sql, /as orders_quarantined/);
  assert.match(sql, /as orders_decoded/);
});

test("the quarantined and decoded predicates are mutually exclusive (both filter state pending)", () => {
  // The two data-modifying CTEs run against one snapshot; they are safe only
  // because an order's code either has a map row (decoded) or does not
  // (quarantined) — never both. Pin the shape: quarantined requires NO map row,
  // decoded requires one.
  const quarantinedBlock = sql.slice(sql.indexOf("quarantined as ("), sql.indexOf("decoded as ("));
  const decodedBlock = sql.slice(sql.indexOf("decoded as ("), sql.indexOf("select\n  (select count(*)"));
  assert.match(quarantinedBlock, /not exists \(select 1 from coldlion\.routing_code_map m/);
  assert.match(decodedBlock, /from coldlion\.routing_code_map m\s+where m\.code = n\.warehouse_code/);
  assert.match(quarantinedBlock, /state = 'pending'/);
  assert.match(decodedBlock, /state = 'pending'/);
});

test("the decode carries the observing run id for quarantine evidence", () => {
  assert.ok(sql.includes(RUN));
});

test("the unknown-code guard is correlated per order AND code, so a NEW code on an old order stays visible", () => {
  assert.match(sql, /q\.reason = 'unknown-routing-code'/);
  assert.match(sql, /q\.sales_order_no = n\.sales_order_no/);
  assert.match(sql, /q\.routing_code is not distinct from n\.warehouse_code/);
});
