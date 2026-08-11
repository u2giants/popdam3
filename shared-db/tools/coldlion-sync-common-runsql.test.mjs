// Contract tests for `runSql` in tools/coldlion-sync-common.mjs — the shared database helper
// that the REAL production ColdLion feed runs through
// (.github/workflows/coldlion-licensor-property-production-yml -> promote-coldlion-source-owned.mjs
// -> runSql). Before this file, nothing pinned the arguments it hands to the Supabase CLI, so a
// future edit dropping `--output json` would have left CI fully green while silently breaking
// the production feed: the default box-table renderer wraps the 1.3 MB JSON cell across
// box-drawn lines and interleaves `|` borders into the payload, which is not recoverable.
//
// FULLY OFFLINE. No database, no network. The spawn boundary is stubbed by putting a fake
// `supabase` executable on PATH: a copy of (or symlink to) this very Node binary, driven by a
// preload script via NODE_OPTIONS. It records the exact argv it was handed and emits whatever
// stdout the test asks for. Node does NOT resolve `.cmd`/`.sh` shims from PATH in spawnSync,
// so an alias of the Node binary is the only stub that behaves identically on Windows and on
// the Ubuntu CI runner.
//
// PATH manipulation as a spawn stub follows the existing sibling pattern in
// tools/sync-coldlion-licensors-properties.test.mjs.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { runSql, SPAWN_TIMEOUT_MS } from "./coldlion-sync-common.mjs";
import { parseHealthResult, parseComparisonResult } from "./phase6-cli-result-parse.mjs";

// ---------------------------------------------------------------------------------------
// The fake `supabase` executable
// ---------------------------------------------------------------------------------------

// The stub's canned response is passed through FILES, never through the environment. Linux caps
// a single environment variable at 128 KiB (MAX_ARG_STRLEN), so handing the 2 MiB maxBuffer
// fixture over as an env var fails with E2BIG on the Ubuntu CI runner while working fine on
// Windows — and it poisons the NEXT spawn too, which then reports E2BIG instead of the ENOENT
// the spawn-fault test is asserting on. Files behave identically on both platforms.
const PRELOAD = `
const fs = require("node:fs");
fs.writeFileSync(process.env.FAKE_SUPABASE_ARGV, JSON.stringify(process.argv.slice(1)));
const emit = (envVar, stream) => {
  const file = process.env[envVar];
  if (!file) return;
  const buf = fs.readFileSync(file);
  if (buf.length) fs.writeSync(stream, buf);
};
emit("FAKE_SUPABASE_STDOUT_FILE", 1);
emit("FAKE_SUPABASE_STDERR_FILE", 2);
process.exit(Number(process.env.FAKE_SUPABASE_EXIT || 0));
`;

let stubDir = null;
let argvFile = null;
let stdoutFile = null;
let stderrFile = null;
let emptyDir = null;

const SAVED = {};
function saveEnv(...names) {
  for (const n of names) SAVED[n] = process.env[n];
}
function restoreEnv() {
  for (const [n, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
}

before(() => {
  stubDir = mkdtempSync(join(tmpdir(), "runsql-stub-"));
  argvFile = join(stubDir, "argv.json");
  stdoutFile = join(stubDir, "stdout.bin");
  stderrFile = join(stubDir, "stderr.bin");
  emptyDir = mkdtempSync(join(tmpdir(), "runsql-empty-"));
  const preloadPath = join(stubDir, "fake-supabase-preload.cjs");
  writeFileSync(preloadPath, PRELOAD, "utf8");

  const exe = join(stubDir, process.platform === "win32" ? "supabase.exe" : "supabase");
  try {
    if (process.platform === "win32") copyFileSync(process.execPath, exe);
    else symlinkSync(process.execPath, exe);
  } catch {
    copyFileSync(process.execPath, exe);
  }

  saveEnv(
    "PATH",
    "Path",
    "NODE_OPTIONS",
    "DATABASE_URL",
    "SUPABASE_DB_URL",
    "FAKE_SUPABASE_ARGV",
    "FAKE_SUPABASE_STDOUT_FILE",
    "FAKE_SUPABASE_STDERR_FILE",
    "FAKE_SUPABASE_EXIT",
  );

  // PATH holds ONLY the stub dir. That also removes `psql`, which deterministically exercises
  // the documented ENOENT fall-through from psql to the Supabase CLI without depending on
  // whether psql happens to be installed on the machine running the tests.
  process.env.PATH = stubDir;
  if (process.platform === "win32") process.env.Path = stubDir;
  // NODE_OPTIONS treats a backslash inside quotes as an escape, so the preload path is
  // written with forward slashes — accepted by Node on Windows as well as POSIX.
  process.env.NODE_OPTIONS = `--require "${preloadPath.replace(/\\/g, "/")}"`;
  process.env.FAKE_SUPABASE_ARGV = argvFile;
  process.env.FAKE_SUPABASE_STDOUT_FILE = stdoutFile;
  process.env.FAKE_SUPABASE_STDERR_FILE = stderrFile;
  stubResponds();
});

after(() => {
  restoreEnv();
  if (stubDir) rmSync(stubDir, { recursive: true, force: true });
  if (emptyDir) rmSync(emptyDir, { recursive: true, force: true });
});

/** Configure the stub's response for the next runSql call. */
function stubResponds({ stdout = "", stderr = "", exit = 0 } = {}) {
  writeFileSync(stdoutFile, stdout, "utf8");
  writeFileSync(stderrFile, stderr, "utf8");
  process.env.FAKE_SUPABASE_EXIT = String(exit);
}

/**
 * The argv the fake was handed. Node rewrites process.argv[1] into an absolute path, so the
 * first element is compared by basename; everything after it is byte-exact.
 */
function capturedArgv() {
  const raw = JSON.parse(readFileSync(argvFile, "utf8"));
  return [basename(raw[0]), ...raw.slice(1)];
}

// ---------------------------------------------------------------------------------------
// 1. The exact argument vector — including `--output json`
// ---------------------------------------------------------------------------------------

test("runSql passes `--output json` to the Supabase CLI on the --db-url path", () => {
  stubResponds({ stdout: "[]" });
  process.env.DATABASE_URL = "postgresql://fixture-user@fixture-host:5432/fixture";
  delete process.env.SUPABASE_DB_URL;

  runSql("select 1;");
  const argv = capturedArgv();

  // Byte-exact vector. `--output json` is NOT the CLI default; losing it silently corrupts a
  // large JSON payload into an unrecoverable box-drawn table.
  assert.deepEqual(argv.slice(0, 6), [
    "db",
    "query",
    "--db-url",
    "postgresql://fixture-user@fixture-host:5432/fixture",
    "--output",
    "json",
  ]);
  assert.equal(argv[6], "--file");
  assert.ok(argv[7] && argv[7].endsWith("query.sql"), `expected a --file argument, got ${argv[7]}`);
  assert.equal(argv.length, 8);
  // Stated twice on purpose: this is the assertion whose removal reopens the defect.
  const outputIdx = argv.indexOf("--output");
  assert.notEqual(outputIdx, -1, "`--output` must be passed");
  assert.equal(argv[outputIdx + 1], "json", "`--output` must be `json`");
});

test("runSql passes `--output json` on the --linked path too", () => {
  stubResponds({ stdout: "[]" });
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_DB_URL;

  runSql("select 1;", { linked: true });
  const argv = capturedArgv();

  assert.deepEqual(argv.slice(0, 5), ["db", "query", "--linked", "--output", "json"]);
  assert.equal(argv[5], "--file");
  assert.ok(argv[6] && argv[6].endsWith("query.sql"));
  assert.equal(argv.length, 7);
  assert.equal(argv.indexOf("--db-url"), -1, "the linked path must never leak a --db-url");
});

test("runSql writes the SQL to the --file argument rather than passing it inline", () => {
  stubResponds({ stdout: "[]" });
  delete process.env.DATABASE_URL;
  const sql = "select coldlion_fixture_marker();";
  runSql(sql, { linked: true });
  const argv = capturedArgv();
  const fileIdx = argv.indexOf("--file");
  assert.notEqual(fileIdx, -1, "the SQL must be handed over via `--file`");
  const seen = argv[fileIdx + 1];
  assert.ok(seen && seen.endsWith("query.sql"), `expected a --file path, got ${seen}`);
  assert.ok(!argv.includes(sql), "the SQL text must never be passed as a bare CLI argument");
});

// ---------------------------------------------------------------------------------------
// 2. maxBuffer — the raised ceiling
// ---------------------------------------------------------------------------------------

test("runSql survives a payload larger than Node's DEFAULT 1 MiB spawnSync maxBuffer", () => {
  // Node's default spawnSync maxBuffer is exactly 1 MiB. The real cycle-state probe returned
  // 1,305,075 bytes on the preview clone, which overflowed it: `error` was ENOBUFS, `status`
  // was null and `stderr` was EMPTY, so the failure was misreported as a database failure and
  // two in a row auto-tripped the coldlion_licensor_property circuit breaker.
  //
  // 2 MiB is deliberately just over the default: if `maxBuffer` is ever removed or lowered
  // back to the default, this test fails with ENOBUFS instead of returning the payload.
  const big = `[{"jsonb_build_object":{"ok":true,"pad":"${"x".repeat(2 * 1024 * 1024)}"}}]`;
  assert.ok(big.length > 1024 * 1024, "the fixture must exceed the 1 MiB default");

  stubResponds({ stdout: big });
  delete process.env.DATABASE_URL;

  // Asserted on the RAW string, not through the parser: this test must fail for exactly one
  // reason (the buffer ceiling) and never be knocked over by an unrelated parser change.
  const out = runSql("select 1;", { linked: true });
  assert.equal(out.length, big.length);
  assert.equal(out, big);
});

// ---------------------------------------------------------------------------------------
// 3. The result.error branch — a spawn fault must be diagnosable, never empty
// ---------------------------------------------------------------------------------------

test("a spawn-level fault reports its error code instead of the empty generic message", () => {
  // ENOBUFS, ENOENT and timeout all arrive the same way: `result.error` set, `status` null and
  // `stderr` empty. Without the `result.error` branch, control reached
  // `throw new Error(result.stderr || "supabase db query failed")` and produced the bare,
  // undiagnosable "supabase db query failed" — a client-side fault misread as a SQL failure.
  // ENOENT is used to reach the branch because a genuine ENOBUFS would need a 256 MiB payload;
  // the branch, and the message it produces, are identical for every spawn fault.
  const origPath = process.env.PATH;
  const origWinPath = process.env.Path;
  // An EMPTY DIRECTORY, not an empty PATH string. With PATH="" glibc's execvp falls back to a
  // built-in default search path, which found something unexecutable and produced EACCES on the
  // Ubuntu CI runner while producing ENOENT on Windows. Searching a directory that exists and
  // contains nothing is ENOENT on both.
  process.env.PATH = emptyDir;
  if (process.platform === "win32") process.env.Path = emptyDir;
  delete process.env.DATABASE_URL;
  try {
    assert.throws(
      () => runSql("select 1;", { linked: true }),
      (err) => {
        assert.match(err.message, /supabase db query could not be executed/);
        // The failing CONDITION must be named. This is the whole point of the branch.
        assert.match(err.message, /ENOENT/);
        assert.doesNotMatch(
          err.message,
          /^supabase db query failed$/,
          "a spawn fault must never surface as the bare generic SQL-failure message",
        );
        return true;
      },
    );
  } finally {
    process.env.PATH = origPath;
    if (process.platform === "win32") process.env.Path = origWinPath;
  }
});

test("a real non-zero CLI exit still reports the CLI stderr (the branch is not swallowing it)", () => {
  stubResponds({ stdout: "", stderr: "ERROR:  relation \"nope\" does not exist", exit: 1 });
  delete process.env.DATABASE_URL;
  assert.throws(() => runSql("select 1;", { linked: true }), /relation "nope" does not exist/);
});

test("runSql refuses with NO_DB_TARGET when neither a URL nor --linked is given", () => {
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_DB_URL;
  assert.throws(
    () => runSql("select 1;"),
    (err) => err.code === "NO_DB_TARGET",
  );
});

// ---------------------------------------------------------------------------------------
// 4. The column-name unwrap in phase6-cli-result-parse.mjs
// ---------------------------------------------------------------------------------------
//
// `supabase db query --output json` returns rows keyed by COLUMN NAME, so
// `select jsonb_build_object('ok', true, ...)` arrives one level deeper than the pre-existing
// `{rows:[…]}` envelope. Without the unwrap the probe was reported UNPARSEABLE (exit 2) even
// though the database had answered correctly — a green database reported as a failure, which
// is exactly what auto-trips the breaker.

test("column-name-keyed row from `--output json` unwraps to the health result", () => {
  const stdout = '[{"jsonb_build_object":{"ok":true,"licensor_count":26}}]';
  const parsed = parseHealthResult(stdout);
  assert.ok(parsed, "the column-name wrapper must be unwrapped, not reported unparseable");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.licensor_count, 26);
});

test("column-name-keyed row unwraps for the comparison probe, including ok:false", () => {
  assert.equal(parseComparisonResult('[{"record_taxonomy_parallel_observation":{"pass":false}}]').pass, false);
  assert.equal(
    parseHealthResult('[{"check_taxonomy_sync_health":{"ok":false,"reason":"drift"}}]').ok,
    false,
  );
});

test("the unwrap only fires for a SINGLE-column row that lacks the discriminator itself", () => {
  // A row that already carries the discriminator must NOT be unwrapped past it.
  const direct = parseHealthResult('[{"ok":true,"extra":1}]');
  assert.equal(direct.ok, true);
  assert.equal(direct.extra, 1);

  // Two columns and no discriminator at the top level: ambiguous, so fail closed rather than
  // guessing which column is the result.
  assert.equal(parseHealthResult('[{"a":{"ok":true},"b":{"ok":false}}]'), null);
});

test("a single-column row whose value is a JSON STRING is unwrapped too", () => {
  const parsed = parseHealthResult('[{"jsonb_build_object":"{\\"ok\\": true, \\"n\\": 3}"}]');
  assert.ok(parsed, "a stringified JSON cell must still unwrap");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.n, 3);
});

test("the unwrap stays fail-closed when the inner object has no boolean discriminator", () => {
  assert.equal(parseHealthResult('[{"jsonb_build_object":{"ok":"true"}}]'), null);
  assert.equal(parseHealthResult('[{"jsonb_build_object":{"status":"green"}}]'), null);
});

// ---------------------------------------------------------------------------------------
// 6. SPAWN_TIMEOUT_MS — the orphaned-process leak stopper (#550, backlog B12)
// ---------------------------------------------------------------------------------------
//
// Neither spawn had a wall-clock timeout, so a wedged child hung the parent forever and
// outlived the session that started it. Four to six orphans accumulated across 2026-07-29
// and 2026-07-31. The asserts below are deliberately on BOTH spawn sites: every asymmetry
// between the psql branch and the Supabase-CLI branch has so far turned into a defect, and
// a timeout applied to only one of them would leak exactly as before through the other.

test("SPAWN_TIMEOUT_MS is generous enough that only a wedged child can trip it", () => {
  assert.equal(typeof SPAWN_TIMEOUT_MS, "number");
  // A REAL ClickUp importer run took 52 minutes the same day the orphans were found. A
  // ceiling at or below that would kill legitimate work, which is worse than the leak.
  assert.ok(
    SPAWN_TIMEOUT_MS > 52 * 60 * 1000,
    `must exceed the real 52-minute run; got ${SPAWN_TIMEOUT_MS} ms`,
  );
  // And it must still be finite and bounded — "no timeout" and "a timeout of a week" are the
  // same defect wearing different clothes.
  assert.ok(Number.isFinite(SPAWN_TIMEOUT_MS) && SPAWN_TIMEOUT_MS <= 4 * 60 * 60 * 1000);
});

test("BOTH database spawns pass the timeout and a SIGKILL, not just one of them", () => {
  const src = readFileSync(new URL("./coldlion-sync-common.mjs", import.meta.url), "utf8");
  const timeoutSites = src.match(/timeout:\s*SPAWN_TIMEOUT_MS/g) ?? [];
  const killSites = src.match(/killSignal:\s*"SIGKILL"/g) ?? [];
  assert.equal(timeoutSites.length, 2, "expected the timeout on the psql AND the CLI spawn");
  assert.equal(killSites.length, 2, "a timeout without a kill signal still leaves the child");
  // One constant, two uses. A literal at either site is how the two paths drift apart.
  assert.ok(
    !/timeout:\s*\d/.test(src),
    "use SPAWN_TIMEOUT_MS at both sites — never an inline number",
  );
});
