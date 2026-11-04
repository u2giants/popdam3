import assert from "node:assert/strict";
import test from "node:test";
import { scoreSearch, summarize, trustWarning } from "./score.mjs";

const judged = { relevant: ["a", "b"], irrelevant: ["x", "y", "z"] };

test("a mostly relevant top ten passes", () => {
  assert.equal(scoreSearch({ id: "1", kind: "character" }, judged, ["a", "b", "x"]).pass, true);
});

test("a mostly irrelevant top ten fails", () => {
  assert.equal(scoreSearch({ id: "1", kind: "character" }, judged, ["a", "x", "y", "z"]).pass, false);
});

test("an exact code must rank first", () => {
  const testCase = { id: "1", kind: "code", exact: true };
  assert.equal(scoreSearch(testCase, judged, ["a"]).pass, true);
  assert.equal(scoreSearch(testCase, judged, ["x", "a"]).pass, false);
});

test("nonsense must return nothing", () => {
  const testCase = { id: "1", kind: "nonsense", expect_empty: true };
  assert.equal(scoreSearch(testCase, {}, [], { total: 0 }).pass, true);
  assert.equal(scoreSearch(testCase, {}, ["x"], { total: 2000 }).pass, false);
});

test("a misspelling must find at least half of what the right spelling finds", () => {
  const testCase = { id: "1", kind: "misspelling" };
  const withTotal = { ...judged, expected_total: 100 };
  assert.equal(scoreSearch(testCase, withTotal, ["a"], { total: 20 }).pass, false);
  assert.equal(scoreSearch(testCase, withTotal, ["a"], { total: 60 }).pass, true);
});

test("errors fail and too many unjudged results warn", () => {
  const rows = [scoreSearch({ id: "1", kind: "character" }, judged, [], { error: "HTTP 503" }), scoreSearch({ id: "2", kind: "character" }, judged, ["new"])];
  const summary = summarize(rows);
  assert.equal(summary.overall.errors, 1);
  assert.equal(summary.overall.passed, 0);
  assert.ok(trustWarning(summary));
});
