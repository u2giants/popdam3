import assert from "node:assert/strict";
import test from "node:test";
import { bestCandidateResolution, buildRowsUrl, digest } from "./reconcile-coldlion-items.mjs";

test("identity fingerprints are order-independent and change with membership", () => {
  assert.equal(digest(["b", "a"]), digest(["a", "b"]));
  assert.notEqual(digest(["a", "b"]), digest(["a", "b", "c"]));
});

test("content reconciliation accepts one positive winner and refuses ties or zero evidence", () => {
  const legacy = { item_description: "MATCH", mg01_code: "A" };
  const winner = { itemDesc: "MATCH", merchGroup01: "A" };
  const loser = { itemDesc: "OTHER", merchGroup01: "B" };
  assert.equal(bestCandidateResolution(legacy, [winner, loser]).candidate, winner);
  assert.equal(bestCandidateResolution(legacy, [winner, { ...winner }]).candidate, null);
  assert.equal(bestCandidateResolution(legacy, [loser, { itemDesc: "NONE", merchGroup01: "C" }]).candidate, null);
});

test("PostgREST paging URL always carries a stable explicit order", () => {
  const url = new URL(buildRowsUrl("erp_items_current", "id,external_id", "id", 1000, 1000));
  assert.equal(url.searchParams.get("order"), "id.asc");
  assert.equal(url.searchParams.get("offset"), "1000");
  assert.equal(url.searchParams.get("limit"), "1000");
});
