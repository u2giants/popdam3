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
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  parseCsv,
  buildSnapshot,
  summarise,
  resolveShrinkFraction,
  resolveSupabaseTarget,
  resolveMinRows,
  assertIsoDate,
  assertSourceUrlIsNotACredential,
  decodeUtf8Strict,
  applySnapshot,
} from "./sync-opa-property-character.mjs";

// Invented project refs. Both are 20 chars, neither is a real project.
const REF_A = "aaaabbbbccccddddeeee";
const REF_B = "zzzzyyyyxxxxwwwwvvvv";

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

// ---------------------------------------------------------------------------
// SENTINEL FILTERING -- owner ruling, Albert Hazan, 2026-08-07.
//
// This REPLACES an earlier test that asserted the sentinel row must SURVIVE.
// The ruling reversed that: the sentinel is not a real licensed property and must
// never reach the mirror. Both directions are covered, because the obvious way to
// get a threshold rule wrong is at its boundary.
// ---------------------------------------------------------------------------

test("POSITIVE: a sentinel row with negative IDs is DROPPED, not loaded", () => {
  const snap = buildSnapshot(parseCsv(good), opts);
  assert.equal(
    snap.rows.find((r) => r.licensedPropertyID === -9999),
    undefined,
    "the -9999/-9998 sentinel must NOT survive into the snapshot"
  );
  assert.ok(
    snap.rows.every((r) => r.licensedPropertyID >= 0 && r.characterID >= 0),
    "no negative id of any kind may survive"
  );
});

test("POSITIVE: the drop is COUNTED and located, never silent", () => {
  const snap = buildSnapshot(parseCsv(good), opts);
  assert.equal(snap.rows_read, 4, "four data rows were read");
  assert.equal(snap.rows_rejected_sentinel, 1);
  assert.equal(snap.rows.length, 3, "three rows survive");
  // The sentinel is the 3rd data row => line 4 of the file.
  assert.deepEqual(snap.rejected_row_ordinals, [4]);
});

test("NEGATIVE (BOUNDARY): id 0 -- the smallest legitimate id -- is NOT dropped", () => {
  // The rule is strictly `< 0`. Zero is a plausible real id and an off-by-one here
  // would silently delete a genuine Disney record.
  const csv = [
    HEADER,
    '0,0,"Zero Prop","Zero Char",0,1007',
    '1,1,"One Prop","One Char",1,1007',
    "",
  ].join("\n");
  const snap = buildSnapshot(parseCsv(csv), opts);
  assert.equal(snap.rows_rejected_sentinel, 0, "nothing may be rejected here");
  assert.equal(snap.rows.length, 2);
  assert.ok(snap.rows.some((r) => r.licensedPropertyID === 0 && r.characterID === 0));
});

test("NEGATIVE: a row is dropped if EITHER id is negative, not only when both are", () => {
  const csv = [
    HEADER,
    '-1,500,"Neg Prop","Ok Char",1,1007', // only the property id is negative
    '500,-1,"Ok Prop","Neg Char",1,1007', // only the character id is negative
    '500,500,"Ok Prop","Ok Char",1,1007', // keeper
    "",
  ].join("\n");
  const snap = buildSnapshot(parseCsv(csv), opts);
  assert.equal(snap.rows_rejected_sentinel, 2);
  assert.equal(snap.rows.length, 1);
  assert.equal(snap.rows[0].licensedPropertyID, 500);
});

test("the sentinel rule is a RULE, not the hard-coded -9999/-9998 pair", () => {
  // If Disney changes its sentinel values, the filter must still work. This is the
  // whole reason the rule is `< 0` rather than an equality test on two magic numbers.
  const csv = [
    HEADER,
    '-4242,-777,"Other Sentinel","Other",1,1007',
    '7,7,"Real","Real",1,1007',
    "",
  ].join("\n");
  const snap = buildSnapshot(parseCsv(csv), opts);
  assert.equal(snap.rows_rejected_sentinel, 1);
  assert.equal(snap.rows.length, 1);
});

test("the PARSER must still ACCEPT negative integers, so sentinels are counted not fatal", () => {
  // Load-bearing: if parsing rejected a leading minus, the sentinel would throw and
  // abort the whole run instead of being filtered and reported.
  const csv = [HEADER, '-5,-6,"S","S",1,1007', "" ].join("\n");
  const snap = buildSnapshot(parseCsv(csv), { ...opts, minRows: undefined });
  assert.equal(snap.rows_rejected_sentinel, 1);
  assert.equal(snap.rows.length, 0, "it is filtered, not an exception");
});

test("the row floor counts rows that will LOAD, not rows that were READ", () => {
  // 4 rows read, 1 sentinel, 3 loadable. A floor of 4 must FAIL even though the file
  // does contain 4 data rows -- otherwise the sentinel rule silently eats one row of
  // the operator's safety margin.
  assert.throws(
    () => buildSnapshot(parseCsv(good), { ...opts, minRows: 4 }),
    (err) => {
      assert.match(err.message, /yields 3 loadable data row/);
      assert.match(err.message, /4 read/);
      assert.match(err.message, /1 rejected as sentinels/);
      return true;
    }
  );
  // A floor of 3 is satisfied.
  assert.equal(buildSnapshot(parseCsv(good), { ...opts, minRows: 3 }).rows.length, 3);
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
  // 3, not 4: the sentinel row is filtered out (owner ruling 2026-08-07).
  assert.equal(s.rows, 3);
  assert.equal(s.rows_read, 4);
  assert.equal(s.rows_rejected_sentinel, 1);
  assert.equal(s.distinct_name_pairs, 2);
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
    "rejected_row_ordinals",
    "rows",
    "rows_read",
    "rows_rejected_sentinel",
  ]);
  // The reject reporting must be ordinals only -- never an id, never a name.
  assert.deepEqual(s.rejected_row_ordinals, [4]);
  assert.ok(!text.includes("Fixture Sentinel"), "the dropped row's name must not leak either");
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

// ---------------------------------------------------------------------------
// W1 -- THE WRONG-TARGET GATE. Every database guard runs inside whichever
// project you reached, so nothing on the database side can catch a wrong-project
// load. This is the only place it can be caught, and it must ABORT BEFORE THE
// FIRST BYTE IS SENT -- not warn, and not fail after the request.
// ---------------------------------------------------------------------------
test("resolveSupabaseTarget accepts a URL whose ref matches the expected ref", () => {
  const t = resolveSupabaseTarget(`https://${REF_A}.supabase.co`, REF_A);
  assert.equal(t.ref, REF_A);
  assert.equal(t.origin, `https://${REF_A}.supabase.co`);
});

test("resolveSupabaseTarget REFUSES a URL pointing at a different project", () => {
  assert.throws(
    () => resolveSupabaseTarget(`https://${REF_B}.supabase.co`, REF_A),
    /REFUSING TO SEND/
  );
});

test("resolveSupabaseTarget REQUIRES an explicit expected ref -- there is no default", () => {
  for (const missing of [undefined, null, "", "   "]) {
    assert.throws(
      () => resolveSupabaseTarget(`https://${REF_A}.supabase.co`, missing),
      /must be stated EXPLICITLY/,
      `expected ${JSON.stringify(missing)} to be rejected`
    );
  }
  assert.throws(() => resolveSupabaseTarget(`https://${REF_A}.supabase.co`, "short"), /shaped like/);
});

test("applySnapshot aborts on a ref mismatch WITHOUT attempting any network call", async () => {
  let called = 0;
  const fetchImpl = () => {
    called += 1;
    throw new Error("NETWORK CALL ATTEMPTED");
  };

  await assert.rejects(
    () =>
      applySnapshot(
        { rows: [] },
        {
          url: `https://${REF_B}.supabase.co`,
          key: "invented-not-a-real-key",
          expectedRef: REF_A,
          fetchImpl,
          log: () => {},
        }
      ),
    /REFUSING TO SEND/
  );
  assert.equal(called, 0, "fetch must not be reached at all when the ref does not match");
});

test("applySnapshot does reach fetch when the ref matches (proves the guard is the only blocker)", async () => {
  let seenUrl = null;
  const fetchImpl = (u) => {
    seenUrl = u;
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  };

  const res = await applySnapshot(
    { rows: [] },
    {
      url: `https://${REF_A}.supabase.co`,
      key: "invented-not-a-real-key",
      expectedRef: REF_A,
      fetchImpl,
      log: () => {},
    }
  );
  assert.equal(res.ref, REF_A);
  assert.equal(seenUrl, `https://${REF_A}.supabase.co/rest/v1/rpc/sync_opa_property_character`);
});

test("applySnapshot never prints the response body on failure", async () => {
  const fetchImpl = () => ({ ok: false, status: 400, text: async () => "SECRET ROW CONTENT" });
  await assert.rejects(
    () =>
      applySnapshot(
        { rows: [] },
        {
          url: `https://${REF_A}.supabase.co`,
          key: "invented-not-a-real-key",
          expectedRef: REF_A,
          fetchImpl,
          log: () => {},
        }
      ),
    (err) => {
      assert.match(err.message, /HTTP 400/);
      assert.ok(!err.message.includes("SECRET ROW CONTENT"), "body must never be echoed");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// W2 -- SUPABASE_URL validation. An unvalidated URL sends the SERVICE-ROLE KEY
// and the whole confidential extract to whatever host it names.
// ---------------------------------------------------------------------------
test("resolveSupabaseTarget rejects a non-https, non-Supabase, ported or path-bearing URL", () => {
  const cases = [
    [`http://${REF_A}.supabase.co`, /https/],
    [`https://${REF_A}.supabase.co.example.invalid`, /not a Supabase project host/],
    ["https://example.invalid", /not a Supabase project host/],
    [`https://${REF_A}.supabase.co:8443`, /port/],
    [`https://${REF_A}.supabase.co/rest/v1`, /no path/],
    [`https://${REF_A}.supabase.co/?x=1`, /query string/],
    ["not-a-url", /not a valid URL/],
    ["", /not a valid URL/],
  ];
  for (const [url, re] of cases) {
    assert.throws(() => resolveSupabaseTarget(url, REF_A), re, `expected ${url} to be rejected`);
  }
});

// ---------------------------------------------------------------------------
// W3 -- THE FIRST LOAD HAS NO FLOOR without this. The database shrink band only
// fires when rows are ALREADY stored, so a one-row snapshot into an empty mirror
// passes every database guard.
// ---------------------------------------------------------------------------
test("buildSnapshot rejects an extract smaller than the expected minimum", () => {
  const csv = [HEADER, '1,101,"A","B",1,1007'].join("\n");
  assert.throws(
    () => buildSnapshot(parseCsv(csv), { ...opts, minRows: 100 }),
    /fewer than the expected minimum of 100/
  );
  const snap = buildSnapshot(parseCsv(csv), { ...opts, minRows: 1 });
  assert.equal(snap.rows.length, 1);
});

test("resolveMinRows rejects anything that is not a whole number of at least 1", () => {
  for (const bad of ["0", "-1", "1.5", "abc", "", "1e400"]) {
    assert.throws(() => resolveMinRows(bad), /whole number of at least 1/, `expected ${bad} rejected`);
  }
  assert.equal(resolveMinRows("10262"), 10262);
});

// ---------------------------------------------------------------------------
// W5 -- MALFORMED QUOTING IS REJECTED, NOT REPAIRED.
// ---------------------------------------------------------------------------
test("parseCsv rejects text after a closing quote instead of silently appending it", () => {
  assert.throws(
    () => parseCsv([HEADER, '1,101,"A"junk,"B",1,1007'].join("\n")),
    /after a closing quote/
  );
});

test("parseCsv rejects a bare quote in an unquoted field (it used to MERGE fields)", () => {
  // Old behaviour: the quote flipped quote mode and swallowed the following
  // commas, so several values collapsed into one field and every later value
  // shifted a column.
  assert.throws(() => parseCsv([HEADER, '1,101,A"B,C,1,1007'].join("\n")), /unescaped/);
});

test("parseCsv rejects a file that ends inside a quoted field -- a TRUNCATED download", () => {
  assert.throws(() => parseCsv([HEADER, '1,101,"A","Unter'].join("\n")), /TRUNCATED/);
});

test("buildSnapshot rejects a row whose field count disagrees with the header", () => {
  assert.throws(
    () => buildSnapshot(parseCsv([HEADER, '1,101,"A","B",1,1007,extra'].join("\n")), opts),
    /7 field\(s\) but the header has 6/
  );
  assert.throws(
    () => buildSnapshot(parseCsv([HEADER, '1,101,"A","B",1'].join("\n")), opts),
    /5 field\(s\) but the header has 6/
  );
});

test("decodeUtf8Strict refuses invalid UTF-8 instead of substituting U+FFFD", () => {
  const bad = Buffer.from([0x41, 0xff, 0x42]);
  assert.throws(() => decodeUtf8Strict(bad), /not valid UTF-8/);
  // Prove the failure mode this guard exists to prevent.
  assert.ok(bad.toString("utf8").includes("�"));
  assert.equal(decodeUtf8Strict(Buffer.from("ok", "utf8")), "ok");
});

// ---------------------------------------------------------------------------
// Lows.
// ---------------------------------------------------------------------------
test("buildSnapshot rejects an id beyond the safe integer range", () => {
  const csv = [HEADER, '9007199254740993,101,"A","B",1,1007'].join("\n");
  assert.throws(() => buildSnapshot(parseCsv(csv), opts), /safe integer range/);
  // Prove the failure mode: two distinct id strings round to the same Number.
  assert.equal(Number("9007199254740993"), Number("9007199254740992"));
});

test("assertIsoDate rejects a date-SHAPED string that is not a real date", () => {
  for (const bad of ["2026-99-99", "2026-02-30", "2026-13-01", "6 Aug 2026", "", undefined]) {
    assert.throws(() => assertIsoDate(bad), /REAL ISO date/, `expected ${bad} rejected`);
  }
  assert.equal(assertIsoDate("2026-08-06"), "2026-08-06");
});

test("assertSourceUrlIsNotACredential FAILS CLOSED on a scheme-less URL", () => {
  // THE BUG THIS REPLACES: `new URL()` throws on a scheme-less string, and the old
  // code returned it UNCHECKED. A paste straight out of a browser address bar is
  // exactly that shape, and the token then landed on every one of ~10,262 rows.
  const SECRET = "CANARY-SESSION-SECRET";
  for (const bad of [
    `opa.example.invalid/x?session_token=${SECRET}`,
    `//opa.example.invalid/x?session_token=${SECRET}`,
    "not a url at all",
    "",
  ]) {
    assert.throws(
      () => assertSourceUrlIsNotACredential(bad),
      /absolute URL/,
      `expected ${JSON.stringify(bad)} to be rejected, not silently accepted`
    );
  }
  // Canary: the secret must not survive into the message.
  try {
    assertSourceUrlIsNotACredential(`opa.example.invalid/x?session_token=${SECRET}`);
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(!err.message.includes(SECRET), `secret leaked into the message: ${err.message}`);
  }
});

test("assertSourceUrlIsNotACredential refuses ANY query string or fragment, however named", () => {
  const SECRET = "CANARY-QUERY-SECRET";
  // Named like a credential...
  assert.throws(() => assertSourceUrlIsNotACredential("https://x.invalid/p?session_token=a"), /query string/);
  assert.throws(() => assertSourceUrlIsNotACredential("https://x.invalid/p?apiKey=a"), /query string/);
  // ...and NOT named like one. A blocklist missed these; refusing the whole class does not.
  assert.throws(() => assertSourceUrlIsNotACredential("https://x.invalid/p?t=a"), /query string/);
  assert.throws(() => assertSourceUrlIsNotACredential("https://x.invalid/p?page=2"), /query string/);
  // A SHORT fragment used to pass: the old check only fired above 40 characters.
  assert.throws(() => assertSourceUrlIsNotACredential("https://x.invalid/p#abc123"), /fragment/);
  assert.throws(() => assertSourceUrlIsNotACredential(`https://x.invalid/p#${"a".repeat(60)}`), /fragment/);
  // Userinfo.
  assert.throws(() => assertSourceUrlIsNotACredential("https://u:p@x.invalid/page"), /userinfo/);
  // Non-http scheme.
  assert.throws(() => assertSourceUrlIsNotACredential("ftp://x.invalid/page"), /http\(s\)/);

  for (const url of [
    `https://x.invalid/p?session_token=${SECRET}`,
    `https://x.invalid/p#${SECRET}`,
  ]) {
    try {
      assertSourceUrlIsNotACredential(url);
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(!err.message.includes(SECRET), `secret leaked: ${err.message}`);
    }
  }
});

test("assertSourceUrlIsNotACredential refuses a token in the PATH, and reports position not content", () => {
  // A token in the path passed the old check entirely -- only query NAMES were read.
  const cases = [
    ["https://x.invalid/session/abc", /path segment 1/],          // credential-ish word
    ["https://x.invalid/p/eyJhbGciOiJIUzI1NiJ9", /path segment 2/], // a JWT
    [`https://x.invalid/p/${"a1b2c3d4".repeat(4)}`, /path segment 2/], // 32-char hex digest
    [`https://x.invalid/p/${"Ab1".repeat(20)}`, /path segment 2/],  // long opaque
  ];
  for (const [url, re] of cases) {
    assert.throws(() => assertSourceUrlIsNotACredential(url), re, `expected ${url} rejected`);
  }
  // The offending segment must never be echoed.
  try {
    assertSourceUrlIsNotACredential("https://x.invalid/p/eyJhbGciOiJIUzI1NiJ9");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(!err.message.includes("eyJhbGciOiJIUzI1NiJ9"), `token leaked: ${err.message}`);
  }
});

test("assertSourceUrlIsNotACredential still accepts ordinary page URLs", () => {
  for (const ok of [
    "https://example.invalid/page",
    "https://example.invalid",
    "https://example.invalid/licensing/licensed-properties-2026",
    "https://example.invalid/OPA-Characters-Export2026",
    "http://example.invalid/a/b/c",
  ]) {
    assert.doesNotThrow(() => assertSourceUrlIsNotACredential(ok), `expected ${ok} accepted`);
  }
});

test("buildSnapshot refuses a snapshot whose provenance URL carries a credential", () => {
  assert.throws(
    () =>
      buildSnapshot(parseCsv(good), {
        ...opts,
        sourceUrl: "https://example.invalid/x?auth=abc",
      }),
    /credential/
  );
});

// ---------------------------------------------------------------------------
// The auto-run guard. The old check fired whenever argv[1] merely ENDED WITH the
// filename, so a NEIGHBOURING file whose name ends the same way would trigger a
// REAL RUN just by importing the module. This spawns exactly that file.
// ---------------------------------------------------------------------------
test("importing from a file named *sync-opa-property-character.mjs does NOT start a run", () => {
  const dir = mkdtempSync(join(tmpdir(), "opa-entrypoint-"));
  const modUrl = pathToFileURL(
    join(dirname(fileURLToPath(import.meta.url)), "sync-opa-property-character.mjs")
  ).href;
  // The name is the whole point: it ENDS WITH the module's filename.
  const probe = join(dir, "test-sync-opa-property-character.mjs");
  writeFileSync(probe, `await import(${JSON.stringify(modUrl)});\nconsole.log("IMPORTED-ONLY");\n`);

  const run = spawnSync(process.execPath, [probe], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });

  assert.equal(
    run.status,
    0,
    `importing must not run main(). stderr was: ${run.stderr}`
  );
  assert.match(run.stdout, /IMPORTED-ONLY/);
  assert.ok(
    !/OPA_CSV_PATH is required/.test(run.stderr),
    "main() ran on import -- the entry-point check is too broad"
  );
});

// ---------------------------------------------------------------------------
// COUNTS, ORDINALS AND STATUS -- NEVER A VALUE. These two messages used to echo
// extract field content into terminals and CI logs for a PUBLIC repository. The
// old defence was that a non-integer in a numeric column could only be numeric
// junk -- which fails on exactly the failure parseCsv now detects: if the columns
// SHIFT, a character name lands in a numeric column and gets printed. Each test
// uses a canary value and asserts the message does NOT contain it.
// ---------------------------------------------------------------------------
const CANARY = "CANARY-LEAKED-VALUE";

test("the non-integer message reports row and column but NEVER the value", () => {
  const csv = [HEADER, `1,${CANARY},"A","B",1,1007`].join("\n");
  try {
    buildSnapshot(parseCsv(csv), opts);
    assert.fail("should have thrown");
  } catch (err) {
    assert.match(err.message, /row 2/, "the row ordinal must be reported");
    assert.match(err.message, /characterID/, "the column name must be reported");
    assert.ok(
      !err.message.includes(CANARY),
      `the offending value must never appear in the message: ${err.message}`
    );
  }
});

test("the duplicate-pair message reports row ordinals but NEVER the id values", () => {
  // Distinctive ids so a leak is unmistakable.
  const row = '123454321,987656789,"A","B",1,1007';
  const csv = [HEADER, row, row].join("\n");
  try {
    buildSnapshot(parseCsv(csv), opts);
    assert.fail("should have thrown");
  } catch (err) {
    assert.match(err.message, /duplicate/i);
    assert.match(err.message, /row 3 repeats the ID pair first seen at row 2/);
    assert.ok(!err.message.includes("123454321"), `licensedPropertyID leaked: ${err.message}`);
    assert.ok(!err.message.includes("987656789"), `characterID leaked: ${err.message}`);
  }
});

test("parseCsv rejects a BARE carriage return that is not part of a CRLF", () => {
  // Measured on the old parser: 'a,b\r1,2' parsed to the single row ["a","b1","2"],
  // joining the end of one line to the start of the next.
  assert.throws(() => parseCsv("a,b\r1,2"), /bare carriage return/);
  assert.throws(() => parseCsv([HEADER, '1,101,"A","B",1,1007\r'].join("\n")), /bare carriage return/);
});

test("parseCsv still accepts CRLF line endings unchanged", () => {
  const rows = parseCsv([HEADER, '1,101,"A","B",1,1007'].join("\r\n"));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ["1", "101", "A", "B", "1", "1007"]);
});

test("resolveSupabaseTarget treats the expected ref case-insensitively", () => {
  // `new URL` lowercases the hostname, so an UPPERCASE host was already accepted
  // while an UPPERCASE expected ref was rejected as malformed. Same answer now.
  const t = resolveSupabaseTarget(`https://${REF_A.toUpperCase()}.supabase.co`, REF_A.toUpperCase());
  assert.equal(t.ref, REF_A);
  // and a genuine mismatch is still refused regardless of case
  assert.throws(
    () => resolveSupabaseTarget(`https://${REF_B}.supabase.co`, REF_A.toUpperCase()),
    /REFUSING TO SEND/
  );
});
