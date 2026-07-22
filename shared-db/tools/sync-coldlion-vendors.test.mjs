import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPull, SHORT_PULL_FLOOR } from "./sync-coldlion-vendors.mjs";

test("classifyPull: 0 rows is a hard abort (never wipe the mirror)", () => {
  const d = classifyPull([]);
  assert.equal(d.action, "abort");
});

test("classifyPull: non-array is a hard abort", () => {
  assert.equal(classifyPull(null).action, "abort");
  assert.equal(classifyPull(undefined).action, "abort");
  assert.equal(classifyPull({ content: [] }).action, "abort");
});

test("classifyPull: a short pull warns but still applies (no permanent freeze)", () => {
  const rows = Array.from({ length: Math.max(1, SHORT_PULL_FLOOR - 1) }, (_, i) => ({ vendorCode: `C${i}` }));
  const d = classifyPull(rows);
  assert.equal(d.action, "warn");
});

test("classifyPull: a full pull is ok", () => {
  const rows = Array.from({ length: SHORT_PULL_FLOOR + 47 }, (_, i) => ({ vendorCode: `C${i}` }));
  assert.equal(classifyPull(rows).action, "ok");
});
