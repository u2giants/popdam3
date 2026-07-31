// Backlog B14 — the cycle-state probe must not return the whole ColdLion mirror as one
// buffered document, and a CLIENT-SIDE tooling fault must not be recorded as a sync failure.
//
// WHY BOTH HALVES ARE HERE
// ------------------------
// PR #362 raised the spawnSync `maxBuffer` from Node's 1 MiB default to 256 MiB after the real
// probe returned 1,305,075 bytes on preview. That moved the cliff without removing it: an
// overflow still threw, still landed in the runner's catch, still wrote a durable failed
// `ingest.sync_run` row, and two consecutive failed rows still auto-trip the
// coldlion_licensor_property circuit breaker. Identical blast radius, better message.
//
//   Half 1 — tools/promote-coldlion-source-owned.mjs pages the probe, so the payload is bounded
//            by CYCLE_STATE_PAGE_SIZE instead of by the size of the mirror.
//   Half 2 — tools/coldlion-sync-common.mjs tags a spawn-level fault CLIENT_SPAWN_FAULT, and the
//            runner exits 4 for it WITHOUT recording a durable failure or an alert.
//
// FULLY OFFLINE. No database and no network. The paging tests inject a fake runSql. The
// breaker tests drive the REAL `main()` across the REAL spawn boundary, with PATH pointed
// either at an empty directory (genuine ENOENT) or at a fake `supabase` executable that is a
// copy of this Node binary driven by a NODE_OPTIONS preload — the same stub pattern as
// tools/coldlion-sync-common-runsql.test.mjs.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

import {
  CYCLE_STATE_MAX_ATTEMPTS,
  CYCLE_STATE_MAX_ROW_BYTES,
  CYCLE_STATE_PAGE_SIZE,
  CYCLE_STATE_PAGE_TARGET_BYTES,
  CYCLE_STATE_RACE_CODE,
  EXIT_CLIENT_TOOLING_FAULT,
  EXIT_CYCLE_STATE_RACE,
  EXIT_SKIPPED_ALREADY_RUNNING,
  buildCycleStateSql,
  isCycleStateRace,
  main,
  readCycleState,
} from "./promote-coldlion-source-owned.mjs";
import {
  CLIENT_SPAWN_FAULT_CODE,
  SPAWN_MAX_BUFFER_BYTES,
  isClientSpawnFault,
  runSql,
} from "./coldlion-sync-common.mjs";

// =======================================================================================
// Half 1 — the probe is paged
// =======================================================================================

test("the probe SQL always carries an explicit bounded window", () => {
  const sql = buildCycleStateSql();
  assert.match(
    sql,
    new RegExp(`offset 0 limit ${CYCLE_STATE_PAGE_SIZE}\\b`),
    "the default page must be an explicit offset/limit",
  );
  assert.match(sql, /'page_offset', 0::bigint/);
  assert.match(sql, new RegExp(`'page_limit', ${CYCLE_STATE_PAGE_SIZE}::bigint`));
  // The window has to sit on the mirror union, BEFORE the joins, or a page would still make
  // the database materialise every row.
  const windowAt = sql.indexOf(`offset 0 limit ${CYCLE_STATE_PAGE_SIZE}`);
  assert.ok(windowAt > 0 && windowAt < sql.indexOf("left join lateral"));
});

test("the probe SQL is parameterised by page, not fixed at page one", () => {
  const sql = buildCycleStateSql({ offset: 3000, limit: 500 });
  assert.match(sql, /offset 3000 limit 500/);
  assert.doesNotMatch(sql, /offset 0 limit/);
});

test("the probe refuses a nonsensical window instead of emitting broken SQL", () => {
  assert.throws(() => buildCycleStateSql({ offset: -1 }), /invalid probe offset/);
  assert.throws(() => buildCycleStateSql({ offset: 1.5 }), /invalid probe offset/);
  assert.throws(() => buildCycleStateSql({ limit: 0 }), /invalid probe limit/);
  assert.throws(() => buildCycleStateSql({ limit: "1000" }), /invalid probe limit/);
});

test("CYCLE_STATE_PAGE_SIZE is DERIVED from the byte budget, not hand-tuned", () => {
  assert.equal(
    CYCLE_STATE_PAGE_SIZE,
    Math.floor(CYCLE_STATE_PAGE_TARGET_BYTES / CYCLE_STATE_MAX_ROW_BYTES),
    "the page size must stay a function of the two budget constants",
  );
  // The worst-case page must fit under Node's 1 MiB DEFAULT, not merely under the raised
  // ceiling — that is what makes the ceiling a second line of defence rather than the only one.
  assert.ok(
    CYCLE_STATE_PAGE_SIZE * CYCLE_STATE_MAX_ROW_BYTES <= 1024 * 1024,
    "a worst-case full page must fit inside the 1 MiB spawnSync default",
  );
});

// ---------------------------------------------------------------------------------------
// The row-byte budget is MEASURED against real ColdLion data, never estimated
// ---------------------------------------------------------------------------------------
//
// The first version of this fix sized the page from a guessed "~700 bytes/row" and said so in
// the PR. That is exactly the kind of unverified constant that becomes wrong silently. The
// repo already contains 570 REAL ColdLion mirror rows captured during phase 2b, so the budget
// is measured from them here and re-measured on every CI run. If ColdLion's names grow enough
// to invalidate the budget, this test fails BEFORE the page size is wrong in production.

const PHASE2B = "docs/verification/coldlion-licensor-property-phase2b-20260724";

/** Minimal RFC4180 CSV reader — the fixtures are quoted and contain commas inside values. */
function parseCsv(text) {
  const rows = [];
  let field = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      field.push(cur);
      cur = "";
    } else if (c === "\n") {
      field.push(cur);
      rows.push(field);
      field = [];
      cur = "";
    } else if (c !== "\r") cur += c;
  }
  if (cur || field.length) {
    field.push(cur);
    rows.push(field);
  }
  const head = rows.shift();
  return rows
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/** Rebuild the EXACT row shape buildCycleStateSql emits, from a real captured ColdLion row. */
function probeRowFrom(r) {
  const UUID = "00000000-0000-0000-0000-000000000000"; // uuids are fixed-width
  return {
    entityType: r.entity_type,
    company: r.company_code,
    division: r.division_code,
    mgTypeCode: r.mg_type_code,
    mgCode: r.mg_code,
    name: r.source_name,
    resolution_status: "manually_matched", // the longest value the enum takes
    present_this_cycle: true,
    canonical_id: r.candidate_canonical_id || UUID,
    canonical_name: r.candidate_name || r.source_name,
    canonical_code: r.candidate_code || r.mg_code,
    canonical_status: r.candidate_status || "active",
    canonical_licensor_id: UUID,
    source_ref_id: UUID,
    source_ref_name: r.source_name,
    source_ref_code: r.mg_code,
  };
}

function measuredRowBytes() {
  const sizes = [];
  for (const file of ["licensors.csv", "properties.csv"]) {
    const text = readFileSync(join(REPO_ROOT, PHASE2B, file), "utf8");
    for (const r of parseCsv(text)) {
      sizes.push(Buffer.byteLength(JSON.stringify(probeRowFrom(r)), "utf8"));
    }
  }
  sizes.sort((a, b) => a - b);
  return {
    count: sizes.length,
    max: sizes[sizes.length - 1],
    mean: sizes.reduce((a, b) => a + b, 0) / sizes.length,
  };
}

test("the row-byte budget covers the LARGEST real ColdLion row, with headroom", () => {
  const m = measuredRowBytes();
  assert.ok(m.count >= 500, `expected the real phase-2b fixtures, measured only ${m.count} rows`);
  assert.ok(
    m.max < CYCLE_STATE_MAX_ROW_BYTES,
    `the largest real row is ${m.max} bytes, which does not fit the ${CYCLE_STATE_MAX_ROW_BYTES}-byte budget`,
  );
  // Headroom, stated as a ratio so shrinking the budget toward the real data fails here first.
  assert.ok(
    CYCLE_STATE_MAX_ROW_BYTES >= m.max * 2,
    `the budget (${CYCLE_STATE_MAX_ROW_BYTES}) must leave at least 2x headroom over the largest real row (${m.max})`,
  );
});

test("the measured mean row size reproduces the recorded incident payload", () => {
  // 1,305,075 bytes was measured on the real preview probe (docs/verification/
  // 2026-07-31-coldlion-recurring-promotion-rehearsal.md). Dividing it by the mean row size
  // measured here must yield a believable mirror row count — that cross-check is what makes
  // the measurement trustworthy rather than a coincidence, and it is the evidence the page
  // size now rests on instead of a guess.
  const m = measuredRowBytes();
  const impliedRows = 1305075 / m.mean;
  assert.ok(
    impliedRows > 1500 && impliedRows < 5000,
    `mean ${m.mean.toFixed(0)} B/row implies ${impliedRows.toFixed(0)} mirror rows, which is not a plausible mirror size`,
  );
  // And the whole mirror at that size must now take several pages — i.e. paging really is load
  // bearing here, not a no-op that never triggers.
  assert.ok(
    impliedRows / CYCLE_STATE_PAGE_SIZE > 2,
    "the real mirror must span multiple pages, otherwise the paging is never exercised",
  );
});

/** Build the exact stdout shape `supabase db query --output json` returns for the probe. */
function pageStdout({ snapshot = "run-1", rows = [] }) {
  return JSON.stringify([{ jsonb_build_object: { ok: true, snapshot_run_id: snapshot, rows } }]);
}

function row(n, over = {}) {
  return {
    entityType: "property",
    company: "01",
    division: "D1",
    mgTypeCode: "T",
    mgCode: `MG${String(n).padStart(4, "0")}`,
    name: `Prop ${n}`,
    resolution_status: "manually_matched",
    present_this_cycle: true,
    ...over,
  };
}

test("readCycleState stitches successive bounded pages into the whole cycle", () => {
  const seen = [];
  const pages = [[row(1), row(2)], [row(3), row(4)], [row(5)]];
  const runSqlImpl = (sql) => {
    const m = /offset (\d+) limit (\d+)/.exec(sql);
    seen.push([Number(m[1]), Number(m[2])]);
    return pageStdout({ rows: pages[seen.length - 1] ?? [] });
  };

  const cycle = readCycleState({ linked: true, pageSize: 2, runSqlImpl });

  assert.deepEqual(seen, [[0, 2], [2, 2], [4, 2]], "each page must advance by exactly pageSize");
  assert.equal(cycle.pages_fetched, 3);
  assert.equal(cycle.rows.length, 5, "no row may be lost or duplicated in the stitch");
  assert.deepEqual(
    cycle.rows.map((r) => r.mgCode),
    ["MG0001", "MG0002", "MG0003", "MG0004", "MG0005"],
    "the pages must be concatenated in order",
  );
  assert.equal(cycle.snapshot_run_id, "run-1");
  assert.equal(cycle.ok, true);
});

test("readCycleState stops on the first SHORT page and asks for nothing more", () => {
  let calls = 0;
  const cycle = readCycleState({
    pageSize: 10,
    runSqlImpl: () => {
      calls += 1;
      return pageStdout({ rows: [row(1), row(2)] });
    },
  });
  assert.equal(calls, 1, "a short page ends the read; a second call is a wasted round trip");
  assert.equal(cycle.rows.length, 2);
});

// ---------------------------------------------------------------------------------------
// A mid-read snapshot change is a BENIGN RACE — bounded retry, never a recorded failure
// ---------------------------------------------------------------------------------------
//
// The first version of this fix threw a plain Error here, which the runner's catch recorded as
// a durable failed sync_run plus a critical alert — so two unlucky overlaps with the mirror
// lane in consecutive cycles would auto-trip the breaker on a completely healthy feed. That is
// the same defect class B14 exists to fix, arriving through a different door.

test("a mid-read snapshot change RESTARTS the read from page 0 and then succeeds", () => {
  const asked = [];
  let snapshot = "run-1";
  const runSqlImpl = (sql) => {
    const [, offset] = /offset (\d+) limit/.exec(sql);
    asked.push(Number(offset));
    // Page 2 of the FIRST attempt lands after the mirror lane committed a new snapshot.
    if (asked.length === 2) {
      snapshot = "run-2";
      return pageStdout({ snapshot, rows: [row(3), row(4)] });
    }
    const o = Number(offset);
    const all = [row(1), row(2), row(3)];
    return pageStdout({ snapshot, rows: all.slice(o, o + 2) });
  };

  const cycle = readCycleState({ pageSize: 2, runSqlImpl });

  assert.deepEqual(asked, [0, 2, 0, 2], "the retry must start again at page 0, not resume mid-read");
  assert.equal(cycle.snapshot_run_id, "run-2", "the retry reads the NEW snapshot, coherently");
  assert.deepEqual(cycle.rows.map((r) => r.mgCode), ["MG0001", "MG0002", "MG0003"]);
});

test("a PERSISTENT snapshot race aborts as a tagged BENIGN race, not a failure", () => {
  let calls = 0;
  let caught = null;
  try {
    readCycleState({
      pageSize: 2,
      runSqlImpl: () => {
        calls += 1;
        // A new snapshot on literally every page — the retry can never win.
        return pageStdout({ snapshot: `run-${calls}`, rows: [row(calls * 10), row(calls * 10 + 1)] });
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "it must still abort — never proceed on partial data");
  assert.equal(caught.code, CYCLE_STATE_RACE_CODE, "a benign race must be TAGGED, not a plain Error");
  assert.ok(isCycleStateRace(caught));
  assert.match(caught.message, /NOT recorded as a sync failure/);
  assert.equal(calls, CYCLE_STATE_MAX_ATTEMPTS * 2, "the retry must be BOUNDED, not an open loop");
  // Pinned as an ABSOLUTE bound, not merely against the constant itself: asserting only
  // `calls === CYCLE_STATE_MAX_ATTEMPTS * 2` would still pass if the constant were raised to a
  // million, which is an unbounded loop wearing a bound's clothing.
  assert.ok(
    CYCLE_STATE_MAX_ATTEMPTS >= 2 && CYCLE_STATE_MAX_ATTEMPTS <= 3,
    `the retry budget must stay small (one retry); it is ${CYCLE_STATE_MAX_ATTEMPTS}`,
  );
});

test("a duplicate key that clears on the retry is not treated as a fault", () => {
  let attempt = 0;
  const runSqlImpl = (sql) => {
    const o = Number(/offset (\d+) limit/.exec(sql)[1]);
    if (o === 0) attempt += 1;
    // The first attempt's second page repeats MG0002; the second attempt is clean.
    if (attempt === 1) return pageStdout({ rows: o === 0 ? [row(1), row(2)] : [row(2), row(3)] });
    return pageStdout({ rows: [row(1), row(2), row(3)].slice(o, o + 2) });
  };
  const cycle = readCycleState({ pageSize: 2, runSqlImpl });
  assert.deepEqual(cycle.rows.map((r) => r.mgCode), ["MG0001", "MG0002", "MG0003"]);
});

test("a PERSISTENT duplicate key IS a real fault — untagged, so it is recorded", () => {
  // Deliberately different from the snapshot race: the snapshot held still and the window
  // shifted anyway, which means the read itself is broken and a row was silently skipped.
  // That must stay loud and durable.
  let caught = null;
  try {
    readCycleState({
      pageSize: 2,
      runSqlImpl: (sql) => {
        const o = Number(/offset (\d+) limit/.exec(sql)[1]);
        return pageStdout({ rows: o === 0 ? [row(1), row(2)] : [row(2), row(3)] });
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.notEqual(caught.code, CYCLE_STATE_RACE_CODE, "a broken read must NOT be excused as a race");
  assert.ok(!isCycleStateRace(caught));
  assert.match(caught.message, /duplicate typed key on all/);
  assert.match(caught.message, /at least one other row/);
});

test("readCycleState returns null (exit 2, unparseable) rather than throwing", () => {
  assert.equal(readCycleState({ runSqlImpl: () => "not json at all" }), null);
});

test("readCycleState refuses to loop forever on endlessly full pages", () => {
  let calls = 0;
  assert.throws(
    () =>
      readCycleState({
        pageSize: 1,
        runSqlImpl: () => {
          calls += 1;
          return pageStdout({ rows: [row(calls)] });
        },
      }),
    /refusing to loop/,
  );
});

// =======================================================================================
// Half 2 — a client-side tooling fault can NEVER trip the circuit breaker
// =======================================================================================

const PRELOAD = `
const fs = require("node:fs");
const argv = process.argv.slice(1);
const fileIdx = argv.indexOf("--file");
const sql = fileIdx >= 0 ? fs.readFileSync(argv[fileIdx + 1], "utf8") : "";
fs.appendFileSync(process.env.FAKE_SUPABASE_LOG, JSON.stringify({ argv, sql }) + "\\n");

if (process.env.FAKE_SUPABASE_MODE === "race") {
  // A FULL page (so the caller always asks for another) carrying a BRAND-NEW snapshot id on
  // every call (so the bounded retry can never win). The worst case for the race guard.
  const call = fs.readFileSync(process.env.FAKE_SUPABASE_LOG, "utf8").trim().split("\\n").length;
  const size = Number(process.env.FAKE_PAGE_SIZE);
  const rows = [];
  for (let i = 0; i < size; i++) {
    rows.push({
      entityType: "property", company: "01", division: "D1", mgTypeCode: "T",
      mgCode: "MG" + call + "_" + i, name: "P", resolution_status: "manually_matched",
      present_this_cycle: true,
    });
  }
  fs.writeSync(1, JSON.stringify([{ jsonb_build_object: {
    ok: true, snapshot_run_id: "run-" + call, rows,
  } }]));
  process.exit(0);
}

fs.writeSync(2, "ERROR:  simulated database failure\\n");
process.exit(1);
`;

let stubDir = null;
let emptyDir = null;
let logFile = null;
const SAVED = {};

before(() => {
  stubDir = mkdtempSync(join(tmpdir(), "b14-stub-"));
  emptyDir = mkdtempSync(join(tmpdir(), "b14-empty-"));
  logFile = join(stubDir, "calls.log");
  const preloadPath = join(stubDir, "preload.cjs");
  writeFileSync(preloadPath, PRELOAD, "utf8");
  const exe = join(stubDir, process.platform === "win32" ? "supabase.exe" : "supabase");
  try {
    if (process.platform === "win32") copyFileSync(process.execPath, exe);
    else symlinkSync(process.execPath, exe);
  } catch {
    copyFileSync(process.execPath, exe);
  }
  for (const n of ["PATH", "Path", "NODE_OPTIONS", "DATABASE_URL", "SUPABASE_DB_URL", "FAKE_SUPABASE_LOG", "FAKE_PAGE_SIZE", "FAKE_SUPABASE_MODE", "FAKE_PSQL_PAYLOAD"]) {
    SAVED[n] = process.env[n];
  }
  process.env.NODE_OPTIONS = `--require "${preloadPath.replace(/\\/g, "/")}"`;
  process.env.FAKE_SUPABASE_LOG = logFile;
  process.env.FAKE_PAGE_SIZE = String(CYCLE_STATE_PAGE_SIZE);
  // The preview project ref, so assertPreviewApplyTarget lets --apply through. Nothing ever
  // connects to it: PATH decides which (fake) executable is reached.
  process.env.DATABASE_URL = "postgresql://postgres.rjyboqwcdzcocqgmsyel@127.0.0.1:5432/postgres";
  delete process.env.SUPABASE_DB_URL;
});

after(() => {
  for (const [n, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
  if (stubDir) rmSync(stubDir, { recursive: true, force: true });
  if (emptyDir) rmSync(emptyDir, { recursive: true, force: true });
});

function usePath(dir) {
  process.env.PATH = dir;
  if (process.platform === "win32") process.env.Path = dir;
}

/** Run main() with stdout/stderr captured. */
function runMain(argv) {
  writeFileSync(logFile, "");
  const out = [];
  const err = [];
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = (c) => (out.push(String(c)), true);
  process.stderr.write = (c) => (err.push(String(c)), true);
  try {
    return { code: main(argv, process.env), out: out.join(""), err: err.join("") };
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
  }
}

/** Every SQL statement the fake CLI was actually asked to run. */
function sqlSent() {
  const raw = readFileSync(logFile, "utf8").trim();
  return raw ? raw.split("\n").map((l) => JSON.parse(l).sql) : [];
}

test("runSql tags a real spawn-level fault CLIENT_SPAWN_FAULT, not a SQL error", () => {
  usePath(emptyDir); // neither psql nor supabase exists -> a genuine ENOENT from the OS
  let caught = null;
  try {
    readCycleState({ linked: true });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "an unreachable CLI must throw");
  assert.equal(caught.code, CLIENT_SPAWN_FAULT_CODE);
  assert.ok(isClientSpawnFault(caught));
  assert.equal(caught.spawnErrorCode, "ENOENT");
  assert.match(caught.message, /CLIENT-SIDE tooling fault, not a database failure/);
});

test("a client tooling fault exits 4 and records NOTHING — the breaker is untouched", () => {
  usePath(emptyDir);
  const { code, err } = runMain(["--apply"]);

  assert.equal(code, EXIT_CLIENT_TOOLING_FAULT, "must not take the failure path (1)");
  assert.notEqual(code, 0, "and must not be reported as success either");
  assert.match(err, /CLIENT TOOLING FAULT/);
  assert.match(err, /does NOT count toward the two-consecutive-failure circuit breaker/);

  // The proof: the durable-failure path was never even attempted. Had it been, its own runSql
  // calls would have failed too and printed these warnings.
  assert.doesNotMatch(err, /could not record the durable promotion alert/);
  assert.doesNotMatch(err, /could not record durable failure/);
  assert.deepEqual(sqlSent(), [], "no SQL of any kind may be sent after a spawn fault");
});

test("a REAL database failure still records both durable rows — the guard is not too wide", () => {
  usePath(stubDir); // the fake CLI runs and exits 1 with a SQL error on stderr
  const { code, err } = runMain(["--apply"]);

  assert.equal(code, 1, "a genuine SQL failure must still take the failure path");
  const sent = sqlSent();
  assert.ok(
    sent.some((s) => s.includes("record_taxonomy_sync_alert")),
    "the critical alert that trips the breaker autotrip must still be attempted",
  );
  assert.ok(
    sent.some((s) => s.includes("insert into ingest.sync_run")),
    "the durable failed sync_run row must still be attempted",
  );
  assert.match(err, /ColdLion recurring promotion FAILED at stage read-cycle-state/);
});

test("the tooling-fault exit code is distinct from every other outcome", () => {
  assert.equal(EXIT_CLIENT_TOOLING_FAULT, 4);
  for (const other of [0, 1, 2, EXIT_SKIPPED_ALREADY_RUNNING, EXIT_CYCLE_STATE_RACE]) {
    assert.notEqual(EXIT_CLIENT_TOOLING_FAULT, other);
  }
});

test("the cycle-state-race exit code is distinct from every other outcome", () => {
  assert.equal(EXIT_CYCLE_STATE_RACE, 5);
  for (const other of [0, 1, 2, EXIT_SKIPPED_ALREADY_RUNNING, EXIT_CLIENT_TOOLING_FAULT]) {
    assert.notEqual(EXIT_CYCLE_STATE_RACE, other);
  }
});

test("a persistent snapshot race exits 5 and records NOTHING — breaker untouched", () => {
  // End to end through the REAL main() and the REAL spawn boundary. The fake CLI hands back a
  // FULL page carrying a brand-new snapshot id on every single call, so the bounded retry can
  // never win — the worst case for this guard.
  usePath(stubDir);
  process.env.FAKE_SUPABASE_MODE = "race";
  try {
    const { code, err } = runMain(["--apply"]);

    assert.equal(code, EXIT_CYCLE_STATE_RACE, "a benign overlap must not take the failure path");
    assert.notEqual(code, 1);
    assert.match(err, /CYCLE-STATE RACE/);
    assert.match(err, /does NOT count toward the two-consecutive-failure circuit breaker/);

    // The proof it cannot contribute to an auto-trip: neither durable write was even attempted.
    const sent = sqlSent();
    assert.ok(
      !sent.some((s) => s.includes("insert into ingest.sync_run")),
      "a benign race must never write a durable failed sync_run row",
    );
    assert.ok(
      !sent.some((s) => s.includes("record_taxonomy_sync_alert")),
      "a benign race must never record the critical alert that trips the autotrip",
    );
    assert.doesNotMatch(err, /could not record durable failure/);
    // It must genuinely have retried, and genuinely have stopped retrying.
    assert.equal(sent.length, CYCLE_STATE_MAX_ATTEMPTS * 2, "bounded retry: 2 pages x 2 attempts");
  } finally {
    delete process.env.FAKE_SUPABASE_MODE;
  }
});

// ---------------------------------------------------------------------------------------
// Both spawn paths must behave identically — the psql branch had NO maxBuffer at all
// ---------------------------------------------------------------------------------------
//
// `maxBuffer` was applied only to the Supabase-CLI spawn, so wherever DATABASE_URL is set and
// the psql path is taken, Node's 1 MiB default still applied and the original ENOBUFS cliff was
// completely untouched. An asymmetry between two branches doing the same job is how this defect
// survived in the first place.

test("the two spawn paths share ONE ceiling constant, so they cannot drift apart", () => {
  const source = readFileSync(join(REPO_ROOT, "tools", "coldlion-sync-common.mjs"), "utf8");
  const uses = source.match(/maxBuffer: SPAWN_MAX_BUFFER_BYTES/g) ?? [];
  assert.equal(uses.length, 2, "both the psql and the Supabase-CLI spawn must set the ceiling");
  assert.ok(SPAWN_MAX_BUFFER_BYTES > 1024 * 1024, "the ceiling must exceed the 1 MiB default");
  // No hand-written literal may reappear on either spawn.
  assert.doesNotMatch(source, /maxBuffer: \d+ \* 1024/, "the ceiling must come from the constant");
});

test("the PSQL path survives a payload larger than the 1 MiB default (it used to not)", () => {
  // Behavioural, across the real spawn boundary: a fake `psql` emits > 1 MiB on stdout. Before
  // the ceiling was added to this branch, this threw ENOBUFS.
  const psqlDir = mkdtempSync(join(tmpdir(), "b14-psql-"));
  try {
    const big = `[{"jsonb_build_object":{"ok":true,"pad":"${"x".repeat(2 * 1024 * 1024)}"}}]`;
    assert.ok(big.length > 1024 * 1024, "the fixture must exceed the 1 MiB default");
    const payloadFile = join(psqlDir, "payload.txt");
    writeFileSync(payloadFile, big, "utf8");
    writeFileSync(
      join(psqlDir, "preload.cjs"),
      `const fs=require("node:fs");fs.writeSync(1,fs.readFileSync(process.env.FAKE_PSQL_PAYLOAD));process.exit(0);`,
      "utf8",
    );
    const exe = join(psqlDir, process.platform === "win32" ? "psql.exe" : "psql");
    copyFileSync(process.execPath, exe);

    usePath(psqlDir);
    process.env.NODE_OPTIONS = `--require "${join(psqlDir, "preload.cjs").replace(/\\/g, "/")}"`;
    process.env.FAKE_PSQL_PAYLOAD = payloadFile;
    try {
      const out = runSql("select 1;");
      assert.equal(out.length, big.length, "the psql branch must return the payload, not ENOBUFS");
    } finally {
      delete process.env.FAKE_PSQL_PAYLOAD;
    }
  } finally {
    rmSync(psqlDir, { recursive: true, force: true });
  }
});
