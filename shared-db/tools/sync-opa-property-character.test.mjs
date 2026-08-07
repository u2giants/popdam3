/**
 * Offline tests for the Disney OPA property->character runner.
 * Does not connect to a database and reads no external file.
 * Run: node --test tools/sync-opa-property-character.test.mjs
 *
 * ALL FIXTURE DATA IS INVENTED. Not one Disney row, name or ID appears here. The real
 * extract is confidential and lives in the PRIVATE repo u2giants/licensor-source-data;
 * this repository is PUBLIC. Schema in git, data out of git.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCsv,
  buildSnapshot,
  summarise,
  resolveShrinkFraction,
} from "./sync-opa-property-character.mjs";

const HEADER =
  "licensedPropertyID,characterID,property,character,brandPropertyID,optionSourceID";

const good = [
  HEADER,
  '1,101,"Fixture Alpha","Fix One",1,1007',
  '2,102,"Fixture Alpha","Fix One",2,1007', // same NAME pair, different ID pair
  '-9999,-9998,"Fixture Sentinel","Sent Char",-9999,1007', // Disney negative sentinels
  '3,103,"Quote ""Q"" Prop","Comma, Char",3,1007', // quoted + embedded comma
  "",
].join("\n");

const opts = { capturedAt: "2026-08-06", sourceUrl: "https://example.invalid/x" };

test("parseCsv handles quotes, embedded commas and doubled quotes", () => {
  const rows = parseCsv(good);
  assert.equal(rows.length, 5); // header + 4 data rows, blank line dropped
  assert.deepEqual(rows[4], ["3", "103", 'Quote "Q" Prop', "Comma, Char", "3", "1007"]);
});

test("parseCsv strips a UTF-8 BOM so the first header is not corrupted", () => {
  const rows = parseCsv("﻿" + good);
  assert.equal(rows[0][0], "licensedPropertyID");
});

test("parseCsv handles a newline inside a quoted field", () => {
  const rows = parseCsv([HEADER, '4,104,"Multi\nLine","C",4,1007'].join("\n"));
  assert.equal(rows.length, 2);
  assert.equal(rows[1][2], "Multi\nLine");
});

test("buildSnapshot accepts the negative Disney sentinels", () => {
  const snap = buildSnapshot(parseCsv(good), opts);
  const sentinel = snap.rows.find((r) => r.licensedPropertyID === -9999);
  assert.ok(sentinel, "the -9999 sentinel row must survive");
  assert.equal(sentinel.characterID, -9998);
});

test("buildSnapshot preserves Disney strings verbatim", () => {
  const snap = buildSnapshot(parseCsv(good), opts);
  const row = snap.rows.find((r) => r.licensedPropertyID === 3);
  assert.equal(row.property, 'Quote "Q" Prop');
  assert.equal(row.character, "Comma, Char");
});

test("THE NATURAL KEY IS THE ID PAIR: an identical name pair under different IDs is kept", () => {
  const snap = buildSnapshot(parseCsv(good), opts);
  const dupes = snap.rows.filter(
    (r) => r.property === "Fixture Alpha" && r.character === "Fix One"
  );
  assert.equal(dupes.length, 2, "both name-pair collisions must be retained");

  const s = summarise(snap);
  assert.equal(s.rows, 4);
  assert.equal(s.distinct_name_pairs, 3);
  assert.equal(s.name_pair_collisions, 1, "collisions must be reported, not silently dropped");
});

test("buildSnapshot rejects a duplicate ID pair", () => {
  const csv = [HEADER, '1,101,"A","B",1,1007', '1,101,"A","B",1,1007'].join("\n");
  assert.throws(() => buildSnapshot(parseCsv(csv), opts), /duplicate/i);
});

test("buildSnapshot rejects optionSourceID other than 1007", () => {
  const csv = [HEADER, '1,101,"A","B",1,1008'].join("\n");
  assert.throws(() => buildSnapshot(parseCsv(csv), opts), /1007/);
});

test("buildSnapshot rejects a missing or non-ISO captured_at", () => {
  const rows = parseCsv(good);
  assert.throws(() => buildSnapshot(rows, { ...opts, capturedAt: undefined }), /captured/i);
  assert.throws(() => buildSnapshot(rows, { ...opts, capturedAt: "6 Aug 2026" }), /captured/i);
});

test("buildSnapshot rejects a blank source_url", () => {
  assert.throws(() => buildSnapshot(parseCsv(good), { ...opts, sourceUrl: "  " }), /source_url/i);
});

test("buildSnapshot rejects a missing required column", () => {
  const csv = ["licensedPropertyID,characterID,property,character,brandPropertyID", "1,1,a,b,1"].join("\n");
  assert.throws(() => buildSnapshot(parseCsv(csv), opts), /optionSourceID/);
});

test("buildSnapshot rejects a blank name and a non-integer id", () => {
  assert.throws(
    () => buildSnapshot(parseCsv([HEADER, '1,101,"A","   ",1,1007'].join("\n")), opts),
    /blank/i
  );
  assert.throws(
    () => buildSnapshot(parseCsv([HEADER, '1,x,"A","B",1,1007'].join("\n")), opts),
    /not an integer/i
  );
});

test("buildSnapshot rejects an empty extract so a failure cannot look like success", () => {
  assert.throws(() => buildSnapshot(parseCsv(HEADER), opts), /no data rows/i);
});

test("summarise reports counts only and never a row", () => {
  const s = summarise(buildSnapshot(parseCsv(good), opts));
  const text = JSON.stringify(s);
  assert.ok(!text.includes("Fixture Alpha"), "summary must not contain any name");
  assert.ok(!text.includes("Sent Char"), "summary must not contain any name");
  assert.deepEqual(Object.keys(s).sort(), [
    "captured_at",
    "distinct_character_id",
    "distinct_licensed_property_id",
    "distinct_name_pairs",
    "line_of_business",
    "name_pair_collisions",
    "rows",
  ]);
});

// ---------------------------------------------------------------------------
// The shrink fraction. A NaN here serialises to JSON null, and Postgres
// LEAST/GREATEST IGNORE NULL -- which silently disables the truncated-extract
// guard in the database. It must fail here, loudly, before anything is sent.
// ---------------------------------------------------------------------------
test("resolveShrinkFraction defaults when unset or blank", () => {
  assert.equal(resolveShrinkFraction(undefined), 0.1);
  assert.equal(resolveShrinkFraction(null), 0.1);
  assert.equal(resolveShrinkFraction("   "), 0.1);
});

test("resolveShrinkFraction accepts valid fractions", () => {
  assert.equal(resolveShrinkFraction("0"), 0);
  assert.equal(resolveShrinkFraction("0.25"), 0.25);
  assert.equal(resolveShrinkFraction("1"), 1);
});

test("resolveShrinkFraction REJECTS non-numeric values (the NaN -> null -> guard-off path)", () => {
  for (const bad of ["abc", "0.1x", "NaN", "Infinity", "-Infinity", {}]) {
    assert.throws(
      () => resolveShrinkFraction(bad),
      /finite number|between 0 and 1/,
      `expected ${JSON.stringify(String(bad))} to be rejected`
    );
  }
  // Prove the failure mode this guard exists to prevent.
  assert.equal(JSON.stringify(Number("abc")), "null");
});

test("resolveShrinkFraction rejects out-of-range values", () => {
  assert.throws(() => resolveShrinkFraction("-0.5"), /between 0 and 1/);
  assert.throws(() => resolveShrinkFraction("2"), /between 0 and 1/);
});
