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

import { parsePgUri, runSql, SPAWN_TIMEOUT_MS } from "./coldlion-sync-common.mjs";
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

  // PATH holds ONLY the stub dir. That also removes `psql`, which deterministically
  // exercises the psql branch's fail-closed CLIENT_SPAWN_FAULT refusal (no fall-through
  // to the CLI exists any more) without depending on whether psql happens to be
  // installed on the machine running the tests.
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

test("runSql refuses to fall through to --linked when a database URL is supplied and psql is missing", () => {
  stubResponds({ stdout: "[]" });
  process.env.DATABASE_URL = "postgresql://fixture-user:fixture-pass@fixture-host:5432/fixture";
  delete process.env.SUPABASE_DB_URL;

  // psql is absent (PATH holds only the stub dir), so the old behavior fell through
  // to --linked and could hit an unrelated project. Fail closed instead.
  assert.throws(
    () => runSql("select 1;"),
    (error) => error.code === "CLIENT_SPAWN_FAULT" && error.spawnErrorCode === "ENOENT",
  );
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
// 5. The psql branch's own transport — argv byte-exact, connection only in PG* env
// ---------------------------------------------------------------------------------------
//
// The PATH-stub tests above exercise the --linked branch end to end; this module's
// psql branch (the one DATABASE_URL selects) had NO test that observed its argv or
// its environment, so reverting the connection back into argv would have left every
// test green (2026-10-05 review, H2). The spawn is injected for capture; the psql
// branch builds its argv/env before spawning, which is exactly the surface pinned
// here.

test("the psql branch carries the connection ONLY in PG* env, on a swept and floored environment", () => {
  process.env.DATABASE_URL = "postgresql://user:secret@host1:5432,host2:5433/mydb?application_name=myapp";
  delete process.env.SUPABASE_DB_URL;
  process.env.PGHOST = "ambient-evil-host";
  process.env.PGSSLMODE = "disable";
  process.env.PGOPTIONS = "-c statement_timeout=9999";
  let seen;
  try {
    runSql("select 1;", {
      spawn: (cmd, args, opts) => {
        seen = { cmd, args, env: opts.env };
        return { status: 0, stdout: "ok", stderr: "" };
      },
    });
  } finally {
    delete process.env.PGHOST;
    delete process.env.PGSSLMODE;
    delete process.env.PGOPTIONS;
  }
  assert.equal(seen.cmd, "psql");
  assert.deepEqual(
    seen.args,
    ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--single-transaction"],
    "the psql argv is pinned byte-exact: any new flag or any connection material fails here",
  );
  for (const a of seen.args) {
    assert.ok(!String(a).includes("secret"), "argv must not carry the password");
    assert.ok(!String(a).includes("://"), "argv must not carry a connection URL");
    assert.ok(!String(a).includes("host1"), "argv must not carry the host");
  }
  assert.equal(seen.env.PGHOST, "host1,host2");
  assert.equal(seen.env.PGPORT, "5432,5433");
  assert.equal(seen.env.PGDATABASE, "mydb");
  assert.equal(seen.env.PGUSER, "user");
  assert.equal(seen.env.PGPASSWORD, "secret");
  assert.equal(seen.env.PGAPPNAME, "myapp");
  assert.equal(
    seen.env.PGSSLMODE,
    "require",
    "a URL with no sslmode must floor to require, never inherit an ambient value",
  );
  assert.notEqual(seen.env.PGHOST, "ambient-evil-host", "ambient PG* must be swept");
  assert.equal(seen.env.PGOPTIONS, undefined, "ambient non-target PG* must not survive (sweep deletion fails here)");
});

test("the --linked child env sweeps ambient PG* and never receives SUPABASE_DB_URL", () => {
  delete process.env.DATABASE_URL;
  // SET, not deleted: the previous form deleted it first, so the assertion
  // could not fail against any implementation (2026-10-05 review, M3).
  process.env.SUPABASE_DB_URL = "postgresql://inherited-override@evil/db";
  process.env.PGHOST = "ambient-evil-host";
  let seen;
  try {
    runSql("select 1;", {
      linked: true,
      spawn: (cmd, args, opts) => {
        seen = { env: opts.env };
        return { status: 0, stdout: "[]", stderr: "" };
      },
    });
  } finally {
    delete process.env.PGHOST;
    delete process.env.SUPABASE_DB_URL;
  }
  assert.equal(seen.env.PGHOST, undefined, "ambient PG* must be swept from the CLI child too");
  assert.equal(
    seen.env.SUPABASE_DB_URL,
    undefined,
    "neither minted nor inherited: the CLI child must never receive a URL under the name it uses to override its link state",
  );
});

test("a URI-validation refusal is a CLIENT fault routed away from the durable-failure path", async () => {
  const { main } = await import("./promote-coldlion-source-owned.mjs");
  const previous = process.env.DATABASE_URL;
  // WHATWG-valid, strictly-parser-REFUSED: sslmode=disable (and a preview
  // identity so assertPreviewApplyTarget lets --apply through).
  process.env.DATABASE_URL = "postgresql://postgres.rjyboqwcdzcocqgmsyel:fixture@127.0.0.1:5432/postgres?sslmode=disable";
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  const err = [];
  process.stdout.write = (c) => true;
  process.stderr.write = (c) => (err.push(String(c)), true);
  let code = null;
  try {
    code = main(["--apply"], process.env);
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
  const text = err.join("");
  assert.equal(code, 4, "a URI-validation refusal must take the tooling-fault exit, not the database-failure exit");
  assert.match(text, /CLIENT TOOLING FAULT|failed validation/);
  assert.doesNotMatch(text, /FAILED at stage/, "it must not be reported as a database failure");
  assert.doesNotMatch(text, /could not record durable failure/, "no durable-record attempt may happen");
});

// The strict-URI parser's fail-closed rules (shared with coldlion-landing/lib/db.mjs,
// which re-exports it from this module).

test("parsePgUri rejects what it cannot safely represent", () => {
  const reject = (uri, note) =>
    assert.throws(() => parsePgUri(uri), { constructor: Error }, note);
  reject("postgresql://u:p@h/db?hostaddr=10.0.0.9", "hostaddr bypasses host validation");
  reject("postgresql://u:p@h/db?keepalives=1", "keepalives has no env var: refusing, not dropping");
  reject("postgresql://u:p@h/db?tcp_user_timeout=9", "tcp_user_timeout has no env var");
  reject("postgresql://u:p@h/db?sslsni=1", "sslsni has no env var");
  reject("postgresql://u:p@h/db?fallback_application_name=x", "no env var exists for it");
  reject("postgresql://u:p@h:5432/db?port=6543", "query port must not fight authority ports");
  reject("postgresql://u:p@h/db?sslmode=disable", "sslmode=disable can send the password in cleartext");
  reject("postgresql://u:p@h/db?sslmode=allow", "sslmode=allow can fall back to cleartext");
  reject("postgresql://u:p@h/db?ssl=false", "ssl=false is rejected");
  reject("postgresql://u:p@h/db?sslmode=prefer", "sslmode=prefer can fall back to cleartext");
  reject("postgresql://u:p@h/db?options=-c%20search_path%3Dx", "options changes server-side semantics");
  reject("postgresql://u:p@host:5432evil/db", "a malformed port must not become a second failover host");
  reject("postgresql://u:p@h1:6543,h2/db", "mixed port presence is refused, not defaulted");
});

test("parsePgUri floors an absent sslmode to require and keeps verified params", () => {
  const env = parsePgUri("postgresql://u:p@h:5432/db");
  assert.equal(env.PGSSLMODE, "require");
  const rich = parsePgUri("postgresql://u:p@h/db?sslmode=verify-full&sslnegotiation=direct&require_auth=scram-sha-256&load_balance_hosts=random");
  assert.equal(rich.PGSSLMODE, "verify-full");
  assert.equal(rich.PGSSLNEGOTIATION, "direct");
  assert.equal(rich.PGREQUIREAUTH, "scram-sha-256");
  assert.equal(rich.PGLOADBALANCEHOSTS, "random");
});

test("urlToPgEnv never downgrades TLS and never lets ambient beat a declared sslmode", async () => {
  const { urlToPgEnv, parsePgUri } = await import("./coldlion-sync-common.mjs");
  assert.equal(urlToPgEnv("postgresql://u:p@h/db", { PGSSLMODE: "verify-full", PATH: "x" }).PGSSLMODE, "verify-full",
    "a stricter operator sslmode survives when the URL declares none");
  assert.equal(urlToPgEnv("postgresql://u:p@h/db", { PGSSLMODE: "prefer", PATH: "x" }).PGSSLMODE, "require",
    "a weaker ambient sslmode is swept to the floor");
  assert.equal(urlToPgEnv("postgresql://u:p@h/db?sslmode=require", { PGSSLMODE: "verify-full", PATH: "x" }).PGSSLMODE, "require",
    "a URL-declared sslmode wins verbatim, even over a stricter ambient value");
  assert.equal(urlToPgEnv("postgresql://u:p@h/db?ssl=true", { PGSSLMODE: "verify-full", PATH: "x" }).PGSSLMODE, "require",
    "the legacy ssl alias counts as the URL declaring its sslmode");
  assert.equal(parsePgUri("postgresql://u:p@h/db?sslmode=verify-full").PGSSLMODE, "verify-full");
});

test("round-5 refusals: TLS handshake material, query-port cardinality, fragments", async () => {
  const { parsePgUri } = await import("./coldlion-sync-common.mjs");
  for (const u of [
    "postgresql://u:p@h/db?sslpassword=x",
    "postgresql://u:p@h/db?sslcert=/x",
    "postgresql://u:p@h/db?sslkey=/x",
    "postgresql://u:p@h/db?sslrootcert=/x",
    "postgresql://u:p@h/db?sslcrl=/x",
    "postgresql://u:p@h/db?sslcrldir=/x",
    "postgresql://u:p@h/db?port=5432,5433",
    "postgresql://u:p@h/db?port=abc",
    "postgresql://u:p@h/db#frag",
  ]) {
    assert.throws(() => parsePgUri(u), undefined, `must refuse: ${u}`);
  }
  assert.equal(parsePgUri("postgresql://u:p@h1,h2/db?port=1,2").PGPORT, "1,2",
    "a matching-cardinality query port list is accepted");
  assert.equal(parsePgUri("postgresql://u:p@h/db?port=6543").PGPORT, "6543");
});

test("all five sibling durable recorders guard client faults at the record call", () => {
  const siblings = [
    "sync-coldlion-licensors-properties.mjs",
    "run-coldlion-licensor-property-phase4.mjs",
    "sync-merchgroup-headers.mjs",
    "sync-coldlion-items.mjs",
    "sync-clickup-tasks.mjs",
  ];
  const guardAtRecord = /if \(isClientSpawnFault\(error\) \|\| isClientUriFault\(error\)\) \{[\s\S]{0,400}?\} else(?: try \{)? runSql\(buildFailedSyncRunSql\(/;
  for (const sibling of siblings) {
    const source = readFileSync(new URL(`./${sibling}`, import.meta.url), "utf8");
    assert.match(source, guardAtRecord, `${sibling} must guard immediately before its durable record call`);
  }
});

test("host entries with whitespace or @ are refused", async () => {
  const { parsePgUri } = await import("./coldlion-sync-common.mjs");
  assert.throws(() => parsePgUri("postgresql://u:p@ host:5432/db"), /whitespace or @/);
  assert.throws(() => parsePgUri("postgresql://u:p@h@st/db"), /whitespace or @/);
  assert.throws(() => parsePgUri("postgresql://u:p@h%20evil/db"), /whitespace or @/);
  assert.throws(() => parsePgUri("postgresql://u:p@h%09evil/db"), /whitespace or @/);
});

test("the LANDING transport tags URI-validation faults and its recorders skip them", async () => {
  const dbMod = await import("./coldlion-landing/lib/db.mjs");
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  let caught = null;
  try {
    dbMod.runSql("select 1;", {
      url: "postgresql://postgres.rjyboqwcdzcocqgmsyel:fixture@127.0.0.1:5432/postgres?sslmode=disable",
      spawn: () => { throw new Error("must not spawn"); },
    });
  } catch (error) {
    caught = error;
  } finally {
    if (previous !== undefined) process.env.DATABASE_URL = previous;
  }
  assert.ok(caught, "the landing runSql must refuse a parser-refused URL");
  assert.equal(caught.code, "CLIENT_URI_FAULT", "the refusal must be tagged as a client URI fault");
  assert.equal(
    dbMod.recordFailure({
      scope: { endpoint: "/fixture" }, window: { from: "2026-01-01", to: "2026-01-07" },
      runId: "fixture", companyCode: "FIX", requestedBy: "test", error: caught,
      options: { spawn: () => { throw new Error("recorder must not spawn for a client fault"); } },
    }),
    false,
    "a tagged URI fault must skip the durable recorder entirely",
  );
});

test("the landing lib re-exports the SAME parser object, not a copy", async () => {
  const dbMod = await import("./coldlion-landing/lib/db.mjs");
  const syncMod = await import("./coldlion-sync-common.mjs");
  assert.equal(dbMod.parsePgUri, syncMod.parsePgUri, "db.mjs must re-export the shared parser (a local copy is drift)");
  assert.equal(dbMod.urlToPgEnv, syncMod.urlToPgEnv, "the sweep+floor builder is shared too");
  assert.equal(dbMod.redactPsqlError, syncMod.redactPsqlError, "one redactor for both transports");
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
