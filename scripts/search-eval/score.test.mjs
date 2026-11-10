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

test("unknown-code policy proves semantic execution without inventing relevance", () => {
  const testCase = { id: "policy", kind: "unknown_code", expect_semantic: true };
  assert.equal(scoreSearch(testCase, {}, ["unjudged"], { semantic: "siglip2" }).pass, true);
  assert.equal(scoreSearch(testCase, {}, [], { semantic: "skipped" }).pass, false);
  assert.equal(scoreSearch(testCase, {}, [], { semantic: "siglip2" }).pass, false);
  assert.equal(scoreSearch(testCase, {}, [], { semantic: "siglip2", error: "HTTP 503" }).pass, false);
  assert.equal(scoreSearch(testCase, {}, ["unjudged"], { semantic: "siglip2" }).unjudged_top10, 1);
});

test("a canonical spelling policy requires the actual returned correction", () => {
  const testCase = { id: "spelling", kind: "misspelling", expected_correction: "example" };
  assert.equal(scoreSearch(testCase, judged, ["a"], { corrected_query: "example" }).pass, true);
  assert.equal(scoreSearch(testCase, judged, ["a"], { corrected_query: null }).pass, false);
});

test("PopSG guides pass when a guide named for the search is first, even with irrelevant guides after it", () => {
  const judged = { relevant: ["a"], irrelevant: ["x", "y", "z"] };
  const testCase = { id: "1", kind: "character" };
  assert.equal(scoreSearch(testCase, judged, ["a", "x", "y", "z"], { engine: "sg_guides" }).pass, true);
  assert.equal(scoreSearch(testCase, judged, ["x", "a", "y", "z"], { engine: "sg_guides" }).pass, false);
  assert.equal(scoreSearch(testCase, judged, ["a", "x", "y", "z"], { engine: "sg_files" }).pass, false);
});


test("PopSG guides still require at least half the must-find hits", () => {
  const testCase = { id: "required", kind: "character" };
  const judgments = { relevant: ["a"], must_find: ["b", "c"] };
  const missing = scoreSearch(testCase, judgments, ["a"], { engine: "sg_guides" });
  assert.equal(missing.pass, false);
  assert.equal(summarize([missing]).overall.must_find_recall, 0);
  assert.equal(scoreSearch(testCase, judgments, ["a", "b"], { engine: "sg_guides" }).pass, true);
});

test("code and nonsense guide cases retain their existing rules", () => {
  for (const kind of ["code", "nonsense"]) {
    assert.equal(scoreSearch({ id: kind, kind }, judged, ["a", "x", "y", "z"], { engine: "sg_guides" }).pass, false);
    assert.equal(scoreSearch({ id: kind, kind }, judged, ["x", "a", "b"], { engine: "sg_guides" }).pass, true);
  }
  assert.equal(scoreSearch({ id: "exact", kind: "code", exact: true }, judged, ["a", "x", "y", "z"], { engine: "sg_guides" }).pass, true);
  assert.equal(scoreSearch({ id: "empty", kind: "nonsense", expect_empty: true }, judged, ["a"], { engine: "sg_guides" }).pass, false);
});
