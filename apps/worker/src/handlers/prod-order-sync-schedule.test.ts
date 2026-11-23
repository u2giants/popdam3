import { test } from "node:test";
import assert from "node:assert/strict";
import { prodOrderSyncAction, SYNC_INTERVAL_MS } from "./prod-order-sync-schedule.js";

// popdam3#1272: continue a running sync; start one when none ran recently.
test("prod order sync schedule decisions", () => {
  const now = Date.parse("2026-11-23T20:00:00Z");
  assert.equal(prodOrderSyncAction(null, now), "start");
  assert.equal(prodOrderSyncAction({ status: "running", started_at: new Date(now).toISOString() }, now), "continue");
  assert.equal(prodOrderSyncAction({ status: "completed", started_at: new Date(now - 60_000).toISOString() }, now), null);
  assert.equal(prodOrderSyncAction({ status: "failed", started_at: new Date(now - SYNC_INTERVAL_MS).toISOString() }, now), "start");
});
