/**
 * Offline tests for the Warner Bros. STARLABS loader.
 * Connects to no database and reads no external file: `git` is injected.
 * Run: node --test tools/sync-warner-starlabs.test.mjs
 *
 * ALL FIXTURE DATA IS INVENTED. Not one Warner franchise, property, style
 * guide, character, asset ID, filename or relationship row appears here. The
 * real extract is confidential and lives in the PRIVATE repo
 * u2giants/licensor-source-data; this repository is PUBLIC.
 *     SCHEMA IN GIT. DATA OUT OF GIT.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPTURE_FILES,
  MAX_CHUNK_ROWS,
  parseCsv,
  csvToObjects,
  decodeUtf8Strict,
  sha256,
  resolveTarget,
  buildChunks,
  chainDigest,
  assertPinnedCleanCheckout,
  readPinnedCsv,
  assertCaptureHeaders,
  resolvePinnedBlob,
  prepareCaptures,
  summarise,
  resolveRunConfig,
  loadCapture,
} from "./sync-warner-starlabs.mjs";

// Invented project refs. Both are 20 chars; neither is a real project.
const REF_A = "aaaabbbbccccddddeeee";
const REF_B = "zzzzyyyyxxxxwwwwvvvv";
// Invented full commit SHAs.
const SHA_PINNED = "1".repeat(40);
const SHA_OTHER = "2".repeat(40);

/** A blob object id per capture file, invented and stable. */
function oidFor(file) {
  const n = CAPTURE_FILES.findIndex((c) => c.file === file);
  return String(n + 3).repeat(40).slice(0, 40);
}

/**
 * A minimal but VALID default body for one capture file: the required header
 * row from CAPTURE_FILES plus a single invented data row. Header names are
 * structural metadata, not Warner data.
 */
function defaultBody(file) {
  const header = CAPTURE_FILES.find((c) => c.file === file).requiredHeaders;
  return `${header.join(",")}\n${header.map((_, i) => `v${i + 1}`).join(",")}\n`;
}

/**
 * A fake `git` that serves invented CSVs from an in-memory tree.
 *
 * It models `ls-tree` and `cat-file` rather than `show`, because the loader now
 * resolves the MODE before reading the content -- see resolvePinnedBlob.
 * `modes` overrides one file's tree mode so the symlink/tree/gitlink refusals
 * can be exercised.
 */
function fakeGit({ status = "", head = SHA_PINNED, files = {}, missing = [], modes = {} } = {}) {
  const calls = [];
  const byOid = new Map();
  for (const { file } of CAPTURE_FILES) {
    byOid.set(oidFor(file), files[file] ?? defaultBody(file));
  }
  return {
    calls,
    run: async (repoDir, args) => {
      calls.push(args.join(" "));
      if (args[0] === "status") return status;
      if (args[0] === "rev-parse") return `${head}\n`;
      if (args[0] === "ls-tree") {
        const [, , commit, dashdash, path] = args;
        assert.equal(commit, SHA_PINNED, "must read at the pinned commit, never HEAD");
        assert.equal(dashdash, "--", "the path must be given after -- so it cannot read as a rev");
        const m = /^warner-bros\/(.+)$/.exec(path);
        assert.ok(m, "ls-tree must address a warner-bros/ path");
        const file = m[1];
        if (missing.includes(file)) return "";
        const mode = modes[file] ?? "100644";
        const type = mode === "040000" ? "tree" : mode === "160000" ? "commit" : "blob";
        return `${mode} ${type} ${oidFor(file)}\t${path}\0`;
      }
      if (args[0] === "cat-file") {
        assert.equal(args[1], "blob", "content must be read as a blob, by object id");
        const body = byOid.get(args[2]);
        assert.ok(body !== undefined, `unexpected object id ${args[2]}`);
        return Buffer.from(body, "utf8");
      }
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    },
  };
}

/** Swallows the drift NOTE so a test's expected stderr stays empty. */
const quiet = () => {};

const baseEnv = {
  WB_SOURCE_REPO: "/invented/checkout",
  WB_PINNED_COMMIT: SHA_PINNED,
  WB_SOURCE_URL: "https://portal.invalid",
  WB_CAPTURED_AT: "2026-08-07",
  WB_CAPTURED_BY: "test-operator",
  WB_EXPECTED_PROJECT_REF: REF_A,
  // Direct-host form on purpose: the pooler form `postgres.<ref>:pw@<host>` reads as an
  // email address to the repo's PII forward guard. Both forms are covered by resolveTarget.
  DATABASE_URL: `postgres://db.${REF_A}.supabase.co:5432/postgres`,
};

// ---------------------------------------------------------------------------
// The hard-coded file list. This is the defect the whole design exists to stop.
// ---------------------------------------------------------------------------
test("the eight capture files are hard-coded, frozen, and cover the eight mirrors", () => {
  assert.equal(CAPTURE_FILES.length, 8);
  assert.ok(Object.isFrozen(CAPTURE_FILES));
  assert.deepEqual(
    CAPTURE_FILES.map((c) => c.target).sort(),
    [
      "wb_asset",
      "wb_asset_character",
      "wb_asset_franchise_property",
      "wb_asset_style_guide",
      "wb_character",
      "wb_franchise_property",
      "wb_property_character",
      "wb_style_guide",
    ]
  );
  // Every target is distinct: two files must never feed one mirror.
  assert.equal(new Set(CAPTURE_FILES.map((c) => c.target)).size, 8);
  assert.equal(new Set(CAPTURE_FILES.map((c) => c.file)).size, 8);
});

test("the loader source contains no readdir and no glob", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./sync-warner-starlabs.mjs", import.meta.url), "utf8");
  // Split the needles so this assertion does not match itself if the test file
  // is ever concatenated into the source during a build.
  const code = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
  assert.ok(!/\bread" \+ "dir\b/.test(code));
  assert.ok(!/\breaddir\b/.test(code), "readdir must never appear in the loader's code");
  assert.ok(!/\bglob\b/.test(code), "glob must never appear in the loader's code");
});

test("a missing capture file is a loud failure, never a silent zero", async () => {
  // This is the observed defect: links-property-character.csv had a staged
  // deletion in a live checkout. A directory listing would load zero of those
  // links and report success.
  const g = fakeGit({ missing: ["links-property-character.csv"] });
  await assert.rejects(
    prepareCaptures(resolveRunConfig(baseEnv), { git: g.run }),
    (e) => {
      assert.match(e.message, /REFUSING TO LOAD/);
      assert.match(e.message, /links-property-character\.csv/);
      assert.match(e.message, /never a silent zero/);
      return true;
    }
  );
});

test("an empty capture file is refused rather than treated as an empty population", async () => {
  // A header-only file: correctly SHAPED, so it gets past the header refusal
  // and must then be caught as an empty population.
  const header = CAPTURE_FILES.find((c) => c.file === "characters.csv").requiredHeaders.join(",");
  const g = fakeGit({ files: { "characters.csv": `${header}\n` } });
  await assert.rejects(prepareCaptures(resolveRunConfig(baseEnv), { git: g.run }), /parsed to ZERO rows/);
});

// ---------------------------------------------------------------------------
// REFUSAL 1 -- dirty tree / wrong HEAD
// ---------------------------------------------------------------------------
test("a dirty working tree is refused, and no source path is printed", async () => {
  const g = fakeGit({ status: " M warner-bros/characters.csv\nD  warner-bros/links-property-character.csv\n" });
  await assert.rejects(assertPinnedCleanCheckout("/invented/checkout", SHA_PINNED, g.run), (e) => {
    assert.match(e.message, /REFUSING TO LOAD/);
    assert.match(e.message, /2 uncommitted change\(s\)/);
    // Confidential filenames must not leak into an error message or a log.
    assert.ok(!e.message.includes("characters.csv"));
    assert.ok(!e.message.includes("links-property-character.csv"));
    return true;
  });
  // It must refuse BEFORE reading anything.
  assert.deepEqual(g.calls, ["status --porcelain"]);
});

test("HEAD that is not the pinned commit is refused", async () => {
  const g = fakeGit({ head: SHA_OTHER });
  await assert.rejects(
    assertPinnedCleanCheckout("/invented/checkout", SHA_PINNED, g.run),
    /HEAD of .* is 2{40} but WB_PINNED_COMMIT is 1{40}/
  );
});

test("a short commit SHA is refused as ambiguous", async () => {
  const g = fakeGit();
  await assert.rejects(assertPinnedCleanCheckout("/x", "1234567", g.run), /not a full 40-character commit SHA/);
  // It must refuse before even asking git anything.
  assert.deepEqual(g.calls, []);
});

test("a clean checkout at the pinned commit is accepted and returns HEAD", async () => {
  const g = fakeGit();
  assert.equal(await assertPinnedCleanCheckout("/invented/checkout", SHA_PINNED, g.run), SHA_PINNED);
  assert.deepEqual(g.calls, ["status --porcelain", "rev-parse HEAD"]);
});

test("every CSV is read from the pinned commit, never from the filesystem", async () => {
  const g = fakeGit();
  await prepareCaptures(resolveRunConfig(baseEnv), { git: g.run });
  const lookups = g.calls.filter((c) => c.startsWith("ls-tree "));
  const reads = g.calls.filter((c) => c.startsWith("cat-file "));
  assert.equal(lookups.length, 8);
  assert.equal(reads.length, 8);
  for (const c of lookups) assert.match(c, new RegExp(`^ls-tree -z ${SHA_PINNED} -- warner-bros/`));
  // `git show` renders symlinks, trees and gitlinks as text. It must not come back.
  assert.equal(g.calls.filter((c) => c.startsWith("show ")).length, 0);
});

// ---------------------------------------------------------------------------
// REFUSAL 0 -- column identity and object type (issue #671)
// ---------------------------------------------------------------------------
test("every capture file declares a non-empty required-header list", () => {
  assert.equal(CAPTURE_FILES.length, 8);
  for (const c of CAPTURE_FILES) {
    assert.ok(Array.isArray(c.requiredHeaders) && c.requiredHeaders.length > 0, c.file);
    assert.equal(new Set(c.requiredHeaders).size, c.requiredHeaders.length, `${c.file} dupes`);
  }
});

test("a renamed column is refused, naming the column and the file", () => {
  assert.throws(
    () => assertCaptureHeaders("characters.csv", ["source_term", "name", "captured_date", "source_url"], quiet),
    (e) => {
      assert.match(e.message, /REFUSING TO LOAD/);
      assert.match(e.message, /characters\.csv/);
      assert.match(e.message, /missing required column\(s\) \[label\]/);
      return true;
    }
  );
});

test("a duplicated column is refused, because only the last one survives", () => {
  const cols = ["source_term", "label", "label", "captured_date", "source_url"];
  assert.throws(() => assertCaptureHeaders("characters.csv", cols, quiet), /duplicated column name\(s\) \[label\]/);
});

test("a blank column name is refused", () => {
  const cols = ["source_term", "label", "", "captured_date", "source_url"];
  assert.throws(() => assertCaptureHeaders("characters.csv", cols, quiet), /1 blank column name\(s\)/);
});

test("column ORDER is not a refusal, because rows are keyed by name", () => {
  const cols = ["source_url", "captured_date", "label", "source_term"];
  assert.deepEqual(assertCaptureHeaders("characters.csv", cols, quiet).unknown, []);
});

test("an unknown extra column is reported but not refused", () => {
  const warnings = [];
  const cols = ["source_term", "label", "captured_date", "source_url", "brand_new"];
  const res = assertCaptureHeaders("characters.csv", cols, (m) => warnings.push(m));
  assert.deepEqual(res.unknown, ["brand_new"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /brand_new/);
});

test("a BOM on the first column name does not break header matching", () => {
  const cols = ["﻿source_term", "label", "captured_date", "source_url"];
  assert.deepEqual(assertCaptureHeaders("characters.csv", cols, quiet).unknown, []);
});

test("a symlink entry is refused, not rendered as its target text", async () => {
  const g = fakeGit({ modes: { "characters.csv": "120000" } });
  await assert.rejects(
    readPinnedCsv("/invented/checkout", SHA_PINNED, "characters.csv", g.run, quiet),
    (e) => {
      assert.match(e.message, /is mode 120000 \(blob\)/);
      assert.match(e.message, /only a regular-file blob \(100644\)/);
      return true;
    }
  );
  // It must refuse BEFORE reading any content.
  assert.equal(g.calls.filter((c) => c.startsWith("cat-file")).length, 0);
});

test("a gitlink entry is refused, not rendered as a commit", async () => {
  const g = fakeGit({ modes: { "characters.csv": "160000" } });
  await assert.rejects(
    readPinnedCsv("/invented/checkout", SHA_PINNED, "characters.csv", g.run, quiet),
    /is mode 160000 \(commit\)/
  );
});

test("a path that resolves to no tree entry is a loud failure, never a silent zero", async () => {
  const g = fakeGit({ missing: ["characters.csv"] });
  await assert.rejects(
    readPinnedCsv("/invented/checkout", SHA_PINNED, "characters.csv", g.run, quiet),
    /resolves to 0 tree entries .* exactly 1 is required/s
  );
});

test("a file whose header is another capture file's header is refused", async () => {
  const wrong = CAPTURE_FILES.find((c) => c.file === "assets.csv").requiredHeaders.join(",");
  const g = fakeGit({ files: { "characters.csv": `${wrong}\nx,x,x,x,x,x,x,x\n` } });
  await assert.rejects(
    readPinnedCsv("/invented/checkout", SHA_PINNED, "characters.csv", g.run, quiet),
    /missing required column\(s\)/
  );
});

// ---------------------------------------------------------------------------
// REFUSAL 2 -- wrong project ref
// ---------------------------------------------------------------------------
test("a DATABASE_URL pointing at another project is refused before connecting", () => {
  assert.throws(
    () =>
      resolveTarget({
        databaseUrl: `postgres://db.${REF_B}.supabase.co:5432/postgres`,
        expectedRef: REF_A,
      }),
    (e) => {
      assert.match(e.message, /REFUSING TO CONNECT/);
      assert.match(e.message, /Nothing has been sent/);
      return true;
    }
  );
});

test("a matching project ref is accepted", () => {
  assert.equal(resolveTarget({ databaseUrl: baseEnv.DATABASE_URL, expectedRef: REF_A }), REF_A);
});

test("an omitted expected ref is refused -- it is a gate, not a warning", () => {
  assert.throws(
    () => resolveTarget({ databaseUrl: baseEnv.DATABASE_URL, expectedRef: "" }),
    /WB_EXPECTED_PROJECT_REF is required/
  );
});

test("a DATABASE_URL with no recognisable ref is refused rather than trusted", () => {
  assert.throws(
    () => resolveTarget({ databaseUrl: "postgres://localhost:5432/postgres", expectedRef: REF_A }),
    /unverifiable target/
  );
});

test("a malformed expected ref is refused", () => {
  assert.throws(() => resolveTarget({ databaseUrl: baseEnv.DATABASE_URL, expectedRef: "nope" }), /not a 20-character project ref/);
});

// ---------------------------------------------------------------------------
// Chunking and the digest chain
// ---------------------------------------------------------------------------
test("chunks respect the row bound and are numbered from 1 with no gap", () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ a: i }));
  const chunks = buildChunks(rows, { maxRows: 10 });
  assert.deepEqual(chunks.map((c) => c.chunkNumber), [1, 2, 3]);
  assert.deepEqual(chunks.map((c) => c.rowCount), [10, 10, 5]);
});

test("the byte budget can bind before the row bound", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ a: "x".repeat(100), i }));
  const chunks = buildChunks(rows, { maxRows: 1000, maxBytes: 300 });
  assert.ok(chunks.length > 1, "a tight byte budget must split the stream");
  assert.equal(chunks.reduce((n, c) => n + c.rowCount, 0), 10);
});

test("a chunk's digest is over the exact JSON text that will be sent", () => {
  const rows = [{ a: 1 }, { a: 2 }];
  const [chunk] = buildChunks(rows);
  assert.equal(chunk.json, JSON.stringify(rows));
  assert.equal(chunk.sha256, sha256(chunk.json));
  assert.match(chunk.sha256, /^[0-9a-f]{64}$/);
});

test("the chain digest changes if ANY chunk's content changes", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ a: i }));
  const chunks = buildChunks(rows, { maxRows: 2 });
  const before = chainDigest(chunks);
  const tampered = chunks.map((c, i) => (i === 1 ? { ...c, sha256: sha256(c.json + " ") } : c));
  assert.notEqual(chainDigest(tampered), before);
});

test("the chain digest changes if the chunk ORDER changes", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ a: i }));
  const chunks = buildChunks(rows, { maxRows: 2 });
  const swapped = [chunks[1], chunks[0], chunks[2]];
  assert.notEqual(chainDigest(swapped), chainDigest(chunks));
});

test("a chunk row bound above the database's own ceiling is refused here too", () => {
  assert.throws(() => buildChunks([{ a: 1 }], { maxRows: MAX_CHUNK_ROWS + 1 }), /between 1 and 25000/);
});

// ---------------------------------------------------------------------------
// CSV handling
// ---------------------------------------------------------------------------
test("CSV quoting, doubled quotes, embedded commas and newlines round-trip", () => {
  const rows = parseCsv('a,b\n"x,1","he said ""hi"""\n"multi\nline",2\n');
  assert.deepEqual(rows, [
    ["a", "b"],
    ["x,1", 'he said "hi"'],
    ["multi\nline", "2"],
  ]);
});

test("CSV keys are passed through UNRENAMED", () => {
  const objs = csvToObjects("source_term,source_id,label\nA,1,B\n");
  assert.deepEqual(objs, [{ source_term: "A", source_id: "1", label: "B" }]);
});

test("a BOM is stripped rather than becoming part of the first header name", () => {
  assert.deepEqual(csvToObjects("﻿source_id,label\n1,B\n"), [{ source_id: "1", label: "B" }]);
});

test("invalid UTF-8 is refused, never silently replaced with U+FFFD", () => {
  assert.throws(() => decodeUtf8Strict(Buffer.from([0x61, 0xff, 0x62])), /not valid UTF-8/);
});

// ---------------------------------------------------------------------------
// Required inputs
// ---------------------------------------------------------------------------
test("captured_at is required and must be a plain date", () => {
  assert.throws(() => resolveRunConfig({ ...baseEnv, WB_CAPTURED_AT: "" }), /WB_CAPTURED_AT is required/);
  assert.throws(
    () => resolveRunConfig({ ...baseEnv, WB_CAPTURED_AT: "2026-08-07T00:00:00Z" }),
    /must be YYYY-MM-DD/
  );
});

test("source_url must be an origin, so a signed URL or token cannot be stored", () => {
  assert.throws(
    () => resolveRunConfig({ ...baseEnv, WB_SOURCE_URL: "https://portal.invalid/x?token=abc" }),
    /must be an ORIGIN only/
  );
});

test("every other required input is required", () => {
  for (const k of ["WB_SOURCE_REPO", "WB_PINNED_COMMIT", "WB_CAPTURED_BY"]) {
    assert.throws(() => resolveRunConfig({ ...baseEnv, [k]: "" }), new RegExp(`${k} is required`));
  }
});

// ---------------------------------------------------------------------------
// Streaming behaviour against a fake client
// ---------------------------------------------------------------------------
function fakeClient(overrides = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, args) => {
      queries.push({ sql, args });
      if (overrides.on) {
        const r = await overrides.on(sql, args);
        if (r !== undefined) return r;
      }
      if (sql.includes("begin_wb_capture")) return { rows: [{ id: "00000000-0000-4000-8000-000000000001" }] };
      if (sql.includes("load_wb_chunk")) return { rows: [{ n: JSON.parse(args[2]).length }] };
      if (sql.includes("finalize_wb_capture")) {
        return { rows: [{ rows_seen: 3, rows_landed: 3, rows_inserted: 3, rows_updated: 0, rows_unchanged: 0, rows_collapsed: 0, rows_missing: 0 }] };
      }
      if (sql.includes("fail_wb_capture")) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
}

const oneCapture = () => {
  const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
  const chunks = buildChunks(rows, { maxRows: 2 });
  return { file: "characters.csv", target: "wb_character", rowCount: 3, chunks, manifestSha256: chainDigest(chunks) };
};

test("a capture streams begin, every chunk in order, then finalize", async () => {
  const c = fakeClient();
  const cfg = resolveRunConfig(baseEnv);
  await loadCapture(c, cfg, oneCapture(), () => {});
  const kinds = c.queries.map((q) => q.sql.match(/plm\.\w+/)[0]);
  assert.deepEqual(kinds, ["plm.begin_wb_capture", "plm.load_wb_chunk", "plm.load_wb_chunk", "plm.finalize_wb_capture"]);
  // The chunk numbers must be sent in order.
  assert.deepEqual(c.queries.filter((q) => q.sql.includes("load_wb_chunk")).map((q) => q.args[1]), [1, 2]);
  // The manifest presented at finalize is the one begin was given.
  assert.equal(c.queries[0].args[3], c.queries[3].args[1]);
  // The declared row count is sent up front.
  assert.equal(c.queries[0].args[4], 3);
});

test("a chunk whose reported row count differs is treated as a silent drop and fails the run", async () => {
  const c = fakeClient({ on: (sql) => (sql.includes("load_wb_chunk") ? { rows: [{ n: 1 }] } : undefined) });
  await assert.rejects(loadCapture(c, resolveRunConfig(baseEnv), oneCapture(), () => {}), /sent 2 rows, database reported 1/);
});

test("any failure marks the capture FAILED rather than leaving it in flight", async () => {
  const c = fakeClient({
    on: (sql) => {
      if (sql.includes("finalize_wb_capture")) throw new Error("finalize refused for a test reason");
      return undefined;
    },
  });
  await assert.rejects(loadCapture(c, resolveRunConfig(baseEnv), oneCapture(), () => {}), /finalize refused for a test reason/);
  const failed = c.queries.find((q) => q.sql.includes("fail_wb_capture"));
  assert.ok(failed, "a failed run must mark the capture failed so it is not left blocking the target");
  assert.match(failed.args[1], /finalize refused for a test reason/);
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
test("the summary reports counts only and never a row", async () => {
  const g = fakeGit();
  const captures = await prepareCaptures(resolveRunConfig(baseEnv), { git: g.run });
  const s = summarise(captures);
  assert.equal(s.length, 8);
  for (const row of s) {
    assert.deepEqual(Object.keys(row).sort(), ["bytes", "chunks", "file", "rows", "target"]);
    assert.equal(typeof row.rows, "number");
  }
});
