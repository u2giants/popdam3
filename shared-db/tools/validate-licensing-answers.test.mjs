import assert from "node:assert/strict";
import test from "node:test";
import { inspectAnswers } from "./validate-licensing-answers.mjs";

test("a blank answer is reported, not silently skipped", () => {
  const r = inspectAnswers([{ ref: "C004", options: "MV / AV", YOUR_ANSWER: "" }]);
  assert.deepEqual(r.blank, ["C004"]);
});

test("two codes where one is required is a problem (the DP, XM round-1 failure)", () => {
  const r = inspectAnswers([{ ref: "C016", options: "DP / XM", YOUR_ANSWER: "DP, XM " }]);
  assert.equal(r.multi.length, 1);
  assert.match(r.multi[0], /^C016:/);
  assert.deepEqual(r.codes, ["DP", "XM"]);
});

test("an answer outside the offered options is flagged (the JL round-1 failure)", () => {
  const r = inspectAnswers([{ ref: "C033", options: "JG / SG / SM / WW", YOUR_ANSWER: "JL" }]);
  assert.equal(r.offList.length, 1);
  assert.match(r.offList[0], /answered JL/);
});

test("NONE and DROP are valid non-code answers, not codes", () => {
  const r = inspectAnswers([
    { ref: "A002", options: "", YOUR_ANSWER: "NONE" },
    { ref: "B001", options: "", YOUR_ANSWER: "NOT CHARACTERS - DROP THE ROW" },
    { ref: "B002", options: "", YOUR_ANSWER: "REAL CHARACTERS - I LISTED THEM" },
  ]);
  assert.deepEqual(r.codes, []);
  assert.deepEqual(r.blank, []);
  assert.deepEqual(r.multi, []);
});

test("a single in-options code is clean", () => {
  const r = inspectAnswers([{ ref: "C001", options: "A9 / C3", YOUR_ANSWER: "A9" }]);
  assert.deepEqual(r.blank, []);
  assert.deepEqual(r.multi, []);
  assert.deepEqual(r.offList, []);
  assert.deepEqual(r.codes, ["A9"]);
});

test("options are matched case-insensitively and tolerate padding", () => {
  const r = inspectAnswers([{ ref: "C029", options: " GN / SG ", YOUR_ANSWER: "gn " }]);
  assert.deepEqual(r.offList, []);
  assert.deepEqual(r.codes, ["GN"]);
});

test("rows with no options list are not falsely flagged as off-list", () => {
  const r = inspectAnswers([{ ref: "B007", options: "", YOUR_ANSWER: "CR" }]);
  assert.deepEqual(r.offList, []);
  assert.deepEqual(r.codes, ["CR"]);
});
