import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, chmod, lstat, rm, rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { main, requireReadOnlyUrl } from "./measure-indexed-writes.mjs";

const DATABASE_URL = "postgresql://supabase_read_only_user.qsllyeztdwjgirsysgai:fixture-password@aws-1-us-east-1.pooler.supabase.com:5432/postgres";
const TEST_CA = "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n";
const TABLE = "public.style_guide_files";
const row = (id, version, indexed) => ({ id: `["${id}"]`, version, values: JSON.stringify({ id, indexed }) });

function harness(state = {}, dir) {
  const context = { phase: "before", role: "supabase_read_only_user", failCursor: false,
    rowsBefore: [row("1", "10", "old")], rowsAfter: [row("1", "11", "new")], ...state };
  class FakeCursor {
    constructor(sql) { this.sql = sql; this.offset = 0; }
    async read(size) {
      if (context.failCursor) throw new Error("fixture cursor failure containing private values");
      const rows = context.phase === "before" ? context.rowsBefore : context.rowsAfter;
      const part = rows.slice(this.offset, this.offset + size);
      this.offset += part.length;
      return part;
    }
    async close() {}
  }
  class FakeClient {
    constructor(config) { context.config = config; }
    async connect() { context.connected = true; }
    async end() { context.closed = true; }
    query(query) {
      if (query instanceof FakeCursor) return query;
      const sql = String(query);
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (sql.includes("pg_constraint")) return { rows: [{ columns: ["id"] }] };
      if (sql.includes("WITH indexes AS")) return { rows: [
        { index_name: "idx_partial_expr", definition: "CREATE INDEX idx_partial_expr ON t ((lower(indexed))) WHERE indexed IS NOT NULL",
          columns: ["id", "indexed"] },
      ] };
      if (sql.includes("current_database() AS database_name")) return { rows: [{
        database_name: "postgres", role_name: context.role, session_role: context.role, read_only: "on",
        server_started_at: "server", bgwriter_reset_at: "reset", database_reset_at: null,
        n_tup_ins: "1", n_tup_upd: context.phase === "before" ? "10" : "11",
        n_tup_hot_upd: "2", n_tup_newpage_upd: context.phase === "before" ? "3" : "4",
      }] };
      throw new Error("unexpected fixture query");
    }
  }
  const deps = { Client: FakeClient, CursorClass: FakeCursor,
    environment: { POP_MEASURE_READONLY_DATABASE_URL: DATABASE_URL,
      POP_MEASURE_SUPABASE_CA_FILE: join(dir, "ca.pem") }, log: () => {} };
  return { context, deps };
}

async function scratch(fn) {
  const dir = await mkdtemp(join(tmpdir(), "popdam169-fixture-"));
  try {
    await writeFile(join(dir, "ca.pem"), TEST_CA, { mode: 0o600 });
    await fn(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function privateFile(path, content) {
  await writeFile(path, content, { mode: 0o600, flag: "wx" });
  return createHash("sha256").update(content).digest("hex");
}

async function receipts(dir, observedAt, overrides = {}) {
  const resultPath = join(dir, "result-receipt.json");
  const resultContent = JSON.stringify({ events: [{ observed_at: observedAt, table: TABLE,
    path: "crawl-upsert", attempted_rows: 1, succeeded_rows: 1 }] });
  const resultHash = await privateFile(resultPath, resultContent);
  const singleWriterPath = join(dir, "single-writer-receipt.txt");
  const singleWriterHash = await privateFile(singleWriterPath, "fixture exclusive writer attestation");
  const operationPath = join(dir, "operation.json");
  await privateFile(operationPath, JSON.stringify({
    name: "fixture crawl", path: "crawl-upsert", source_commit: "a".repeat(40),
    attempted_rows: 1, succeeded_rows: 1,
    result_receipt_path: resultPath, result_receipt_sha256: resultHash,
    single_writer_receipt_path: singleWriterPath, single_writer_receipt_sha256: singleWriterHash,
    ...overrides,
  }));
  return { operationPath, resultPath, singleWriterPath };
}

test("accepts only the exact production host, role, database, and verified TLS", () => {
  const config = requireReadOnlyUrl(DATABASE_URL, TEST_CA);
  assert.equal(config.host, "aws-1-us-east-1.pooler.supabase.com");
  assert.deepEqual(config.ssl, { ca: TEST_CA, rejectUnauthorized: true, servername: config.host });
  for (const invalid of [
    DATABASE_URL.replace("aws-1-us-east-1.pooler.supabase.com", "aws-1-us-east-1.pooler.supabase.com.evil.test"),
    DATABASE_URL.replace("supabase_read_only_user.qsllyeztdwjgirsysgai:", "postgres.qsllyeztdwjgirsysgai:"),
    DATABASE_URL.replace("/postgres", "/other"),
    `${DATABASE_URL}?sslmode=disable`,
  ]) assert.throws(() => requireReadOnlyUrl(invalid, TEST_CA), /exact production host/);
  assert.throws(() => requireReadOnlyUrl(DATABASE_URL, ""), /CA certificate/);
});

test("mocked before/after writes private files and a value-free aggregate report", async () => {
  await scratch(async (dir) => {
    const { context, deps } = harness({}, dir);
    await main(["before", "--table", TABLE, "--dir", dir], deps);
    assert.equal((await lstat(join(dir, "before.rows.ndjson"))).mode & 0o077, 0);
    assert.equal((await lstat(join(dir, "before.json"))).mode & 0o077, 0);
    assert.equal(context.config.ssl.rejectUnauthorized, true);
    await delay(12);
    const { operationPath } = await receipts(dir, new Date().toISOString());
    await delay(12);
    context.phase = "after";
    await main(["after", "--dir", dir, "--operation", operationPath], deps);
    const reportText = await readFile(join(dir, "report.json"), "utf8");
    const report = JSON.parse(reportText);
    assert.equal(report.indexed_value_changed, 1);
    assert.equal(report.succeeded_rows, 1);
    assert.equal(report.attribution_requires_receipt_review, true);
    assert.equal((await lstat(join(dir, "report.json"))).mode & 0o077, 0);
    assert.ok(!reportText.includes('"indexed":"old"') && !reportText.includes('"indexed":"new"') &&
      !reportText.includes('[\\"1\\"]'));
  });
});

test("wrong read-only role and cursor failures leave no conclusive report", async () => {
  await scratch(async (dir) => {
    const { deps } = harness({ role: "postgres" }, dir);
    await assert.rejects(main(["before", "--table", TABLE, "--dir", dir], deps), /read-only target/);
    await assert.rejects(lstat(join(dir, "before.json")), { code: "ENOENT" });
  });
  await scratch(async (dir) => {
    const { deps } = harness({ failCursor: true }, dir);
    await assert.rejects(main(["before", "--table", TABLE, "--dir", dir], deps), /cursor failure/);
    await assert.rejects(lstat(join(dir, "before.json")), { code: "ENOENT" });
  });
});

test("row bound, receipt timing, and missing or changed receipts fail closed", async () => {
  await scratch(async (dir) => {
    const { deps } = harness({ rowsBefore: [row("1", "10", "a"), row("2", "20", "b")] }, dir);
    await assert.rejects(main(["before", "--table", TABLE, "--dir", dir, "--max-rows", "1"], deps), /row bound/);
    await assert.rejects(lstat(join(dir, "before.json")), { code: "ENOENT" });
  });
  for (const fault of ["outside-time", "missing-result", "changed-result", "missing-single", "changed-single"]) {
    await scratch(async (dir) => {
      const { context, deps } = harness({}, dir);
      await main(["before", "--table", TABLE, "--dir", dir], deps);
      await delay(12);
      const before = JSON.parse(await readFile(join(dir, "before.json"), "utf8"));
      const observed = fault === "outside-time" ? before.finished_at : new Date().toISOString();
      const { operationPath, resultPath, singleWriterPath } = await receipts(dir, observed);
      if (fault === "missing-result") await rm(resultPath);
      if (fault === "changed-result") await writeFile(resultPath, "changed", { mode: 0o600 });
      if (fault === "missing-single") await rm(singleWriterPath);
      if (fault === "changed-single") await writeFile(singleWriterPath, "changed", { mode: 0o600 });
      await delay(12);
      context.phase = "after";
      await assert.rejects(main(["after", "--dir", dir, "--operation", operationPath], deps));
      await assert.rejects(lstat(join(dir, "report.json")), { code: "ENOENT" });
    });
  }
});

test("symlinked or loose-permission snapshot is refused before opening", async () => {
  for (const fault of ["symlink", "loose"]) {
    await scratch(async (dir) => {
      const { context, deps } = harness({}, dir);
      await main(["before", "--table", TABLE, "--dir", dir], deps);
      const original = join(dir, "before.rows.ndjson");
      if (fault === "symlink") {
        const saved = join(dir, "saved.rows.ndjson");
        await rename(original, saved);
        await symlink(saved, original);
      } else await chmod(original, 0o644);
      await delay(12);
      const { operationPath } = await receipts(dir, new Date().toISOString());
      await delay(12);
      context.phase = "after";
      await assert.rejects(main(["after", "--dir", dir, "--operation", operationPath], deps), /not private/);
    });
  }
});
