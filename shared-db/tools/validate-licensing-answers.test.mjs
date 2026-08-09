import assert from "node:assert/strict";
import test from "node:test";
import { inspectAnswers, classifyCodePresence } from "./validate-licensing-answers.mjs";

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

// ---------------------------------------------------------------------------
// Licensor scoping (issue #522).
//
// core.property is unique per (licensor_id, code), so a code that exists only
// under a DIFFERENT licensor must never be reported as usable. Fixture licensors
// and codes below are invented; this repo is public.
// ---------------------------------------------------------------------------

const owned = (code, name, licensor, licensor_code) => ({ code, name, licensor, licensor_code });

test("#522 inspectAnswers carries each code's row licensor through as a pair", () => {
  const r = inspectAnswers([
    { ref: "C001", licensor: "Northwind Media", options: "Q1 / Q2", YOUR_ANSWER: "Q1" },
  ]);
  assert.deepEqual(r.pairs, [{ ref: "C001", code: "Q1", licensor: "Northwind Media" }]);
});

test("#522 a code under the row's own licensor passes", () => {
  const r = classifyCodePresence(
    [{ ref: "C001", code: "Q1", licensor: "Northwind Media" }],
    [owned("Q1", "Fixture Property", "Northwind Media", "NW")],
  );
  assert.deepEqual(r, { missing: [], wrongLicensor: [], unresolvableLicensor: [] });
});

test("#522 REFUSES a code that exists only under a different licensor", () => {
  const r = classifyCodePresence(
    [{ ref: "C002", code: "Q1", licensor: "Northwind Media" }],
    [
      owned("Q1", "Fixture Property", "Southport Studios", "SP"),
      owned("Z9", "Other Fixture", "Northwind Media", "NW"),
    ],
  );
  assert.deepEqual(r.missing, []);
  assert.equal(r.wrongLicensor.length, 1);
  assert.match(r.wrongLicensor[0], /^C002: code Q1 exists, but under Southport Studios/);
  assert.deepEqual(r.unresolvableLicensor, []);
});

test("#522 the same code under two licensors passes only for the right row", () => {
  const found = [
    owned("Q1", "Fixture A", "Northwind Media", "NW"),
    owned("Q1", "Fixture B", "Southport Studios", "SP"),
  ];
  const r = classifyCodePresence(
    [
      { ref: "C003", code: "Q1", licensor: "Northwind Media" },
      { ref: "C004", code: "Q1", licensor: "Eastvale Group" },
    ],
    found.concat(owned("Z9", "Other", "Eastvale Group", "EV")),
  );
  assert.equal(r.wrongLicensor.length, 1);
  assert.match(r.wrongLicensor[0], /^C004:/);
});

test("#522 a code absent everywhere is still reported as absent, not as a licensor mismatch", () => {
  const r = classifyCodePresence(
    [{ ref: "C005", code: "ZZ9", licensor: "Northwind Media" }],
    [owned("Q1", "Fixture Property", "Northwind Media", "NW")],
  );
  assert.deepEqual(r.missing, ["ZZ9"]);
  assert.deepEqual(r.wrongLicensor, []);
});

test("#522 licensor labels match on letters and digits, so punctuation differences pass", () => {
  const r = classifyCodePresence(
    [{ ref: "C006", code: "Q1", licensor: "Northwind Media" }],
    [owned("Q1", "Fixture Property", "Northwind-Media.", "NW")],
  );
  assert.deepEqual(r.wrongLicensor, []);
});

test("#522 a row may name its licensor by code instead of by name", () => {
  const r = classifyCodePresence(
    [{ ref: "C007", code: "Q1", licensor: "NW" }],
    [owned("Q1", "Fixture Property", "Northwind Media", "NW")],
  );
  assert.deepEqual(r.wrongLicensor, []);
});

test("#522 NO SILENT PASS: a row with no licensor is a loud failure, not a pass", () => {
  const r = classifyCodePresence(
    [{ ref: "C008", code: "Q1", licensor: "" }],
    [owned("Q1", "Fixture Property", "Northwind Media", "NW")],
  );
  assert.equal(r.unresolvableLicensor.length, 1);
  assert.match(r.unresolvableLicensor[0], /C008: code Q1 answered on a row that carries no licensor/);
  assert.deepEqual(r.wrongLicensor, []);
});

test("#522 NO SILENT PASS: an unrecognised licensor label is a loud failure", () => {
  const r = classifyCodePresence(
    [{ ref: "C009", code: "Q1", licensor: "Uncharted Holdings" }],
    [owned("Q1", "Fixture Property", "Northwind Media", "NW")],
  );
  assert.equal(r.unresolvableLicensor.length, 1);
  assert.match(r.unresolvableLicensor[0], /matches no core\.licensor name or code/);
});
