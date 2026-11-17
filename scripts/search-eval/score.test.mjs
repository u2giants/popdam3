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

test("PopSG guides pass when a guide named for the search is first, even with containing guides after it", () => {
  const judged = { relevant: ["a"], irrelevant: ["x", "y", "z"] };
  const testCase = { id: "1", kind: "character" };
  assert.equal(scoreSearch(testCase, judged, ["a", "x", "y", "z"], { engine: "sg_guides" }).pass, true);
  assert.equal(scoreSearch(testCase, judged, ["x", "a", "y", "z"], { engine: "sg_guides" }).pass, false);
  assert.equal(scoreSearch(testCase, judged, ["a", "x", "y", "z"], { engine: "sg_files" }).pass, false);
});

test("PopSG guides pass on order but still need must-find recall", () => {
  const g = { relevant: ["a"], irrelevant: ["x", "y", "z"], must_find: ["a", "m1", "m2"] };
  const opts = { engine: "sg_guides" };
  assert.equal(scoreSearch({ id: "1", kind: "character" }, { ...g, must_find: [] }, ["a", "x", "y", "z"], opts).pass, true);
  assert.equal(scoreSearch({ id: "1", kind: "character" }, g, ["a", "x", "y", "z"], opts).pass, false);
  assert.equal(scoreSearch({ id: "1", kind: "character" }, g, ["a", "m1", "x"], opts).pass, true);
});

test("the PopSG guides order rule does not apply to code or nonsense cases", () => {
  const g = { relevant: ["a"], irrelevant: ["x", "y", "z"] };
  assert.equal(scoreSearch({ id: "1", kind: "code" }, g, ["a", "x", "y", "z"], { engine: "sg_guides" }).pass, false);
});

test("must_find_all needs every must-find result within the first 50", () => {
  const testCase = { id: "1", kind: "meaning", must_find_all: true };
  const g = { relevant: ["a", "m1", "m2"], irrelevant: [], must_find: ["m1", "m2"] };
  const filler = Array.from({ length: 49 }, (_, i) => `f${i}`);
  assert.equal(scoreSearch(testCase, g, ["a", "m1", "m2"]).pass, true);
  assert.equal(scoreSearch(testCase, g, ["a", "m1"]).pass, false);
  assert.equal(scoreSearch(testCase, g, ["a", "m1", ...filler, "m2"]).pass, false);
  assert.equal(scoreSearch(testCase, g, ["a", "m1", ...filler, "m2"]).must_found_top50, 1);
  assert.equal(scoreSearch({ id: "1", kind: "meaning" }, g, ["a", "m1"]).pass, true);
});

test("must_not_contain_other_character fails when a top-20 result lacks the character", () => {
  const testCase = { id: "1", kind: "meaning", must_not_contain_other_character: true };
  const g = { relevant: ["a", "b"], irrelevant: ["x"], with_character: ["a", "b", "x"] };
  assert.equal(scoreSearch(testCase, g, ["a", "b", "x"]).pass, true);
  assert.equal(scoreSearch(testCase, g, ["a", "b", "other"]).pass, false);
  assert.equal(scoreSearch(testCase, g, ["a", "b", "other"]).other_character_top20, 1);
  const tail = Array.from({ length: 18 }, () => "a");
  assert.equal(scoreSearch(testCase, g, ["a", "b", ...tail, "other"]).pass, true);
  assert.equal(scoreSearch(testCase, { relevant: ["a"] }, ["a"]).pass, false);
  assert.equal(scoreSearch({ id: "1", kind: "meaning" }, g, ["a", "b", "other"]).pass, true);
});
