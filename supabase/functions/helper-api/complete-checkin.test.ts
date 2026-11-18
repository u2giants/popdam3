import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Execute the real /checkouts/complete-checkin handler against an in-memory db.
const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const route = source.slice(
  source.indexOf("async function handleCompleteCheckin"),
  source.indexOf("// Re-drive: the server asked"),
);
const compiled = ts.transpileModule(route, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

type Row = Record<string, unknown>;
interface Opts {
  checkout: Row;
  verification?: boolean;
  failTables?: string[];
}

function makeDb(opts: Opts) {
  const tables: Record<string, Row> = { asset_checkouts: { ...opts.checkout }, assets: { id: "a1", quick_hash: "old" } };
  const fail = new Set(opts.failTables ?? []);
  const db = {
    from: (table: string) => ({
      select: () => {
        const q = { eq: () => q, maybeSingle: async () => ({ data: { ...tables[table] }, error: null }) };
        return q;
      },
      update: (patch: Row) => ({
        eq: async () => {
          if (fail.has(table)) return { error: { message: `${table} write failed` } };
          Object.assign(tables[table], patch);
          return { error: null };
        },
      }),
    }),
  };
  return { db, tables };
}

async function run(opts: Opts, body: Row) {
  const { db, tables } = makeDb(opts);
  const handler = new Function(
    "getUserId", "serviceClient", "json", "err", "isCheckinVerificationEnabled", "VERIFY_FLAG_MS", "VERIFY_RESOLVE_MS",
    `${compiled};return handleCompleteCheckin;`,
  )(
    async () => "u1",
    () => db,
    (value: unknown) => ({ status: 200, value }),
    (error: string, status = 400) => ({ status, value: { ok: false, error } }),
    async () => opts.verification ?? false,
    1000,
    2000,
  );
  const res = await handler({ json: async () => body });
  return { res, tables };
}

const body = { checkout_id: "c1", final_hash: "h-new", final_quick_hash: "q-new", final_size: 10, upload_method: "smb_local" };
const queued = { id: "c1", asset_id: "a1", status: "checkin_queued", checkin_hash: null };

describe("complete-checkin", () => {
  it("completes and updates the asset when both writes succeed", async () => {
    const { res, tables } = await run({ checkout: queued }, body);
    expect(res.status).toBe(200);
    expect(res.value).toMatchObject({ ok: true, status: "complete" });
    expect(tables.asset_checkouts.status).toBe("complete");
    expect(tables.assets.quick_hash).toBe("q-new");
  });

  it("fails retryably and keeps the lock when the asset write fails", async () => {
    const { res, tables } = await run({ checkout: queued, failTables: ["assets"] }, body);
    expect(res.status).toBe(500);
    expect(res.value.ok).toBe(false);
    expect(tables.asset_checkouts.status).toBe("checkin_queued");
  });

  it("fails when the checkout write fails", async () => {
    const { res } = await run({ checkout: queued, failTables: ["asset_checkouts"] }, body);
    expect(res.status).toBe(500);
  });

  it("fails when the verification-route write fails", async () => {
    const { res, tables } = await run(
      { checkout: queued, verification: true, failTables: ["asset_checkouts"] },
      { ...body, source_provider: "seafile" },
    );
    expect(res.status).toBe(500);
    expect(tables.asset_checkouts.status).toBe("checkin_queued");
  });

  it("retry after an ambiguous response succeeds idempotently", async () => {
    const done = { ...queued, status: "complete", checkin_hash: "h-new" };
    const { res } = await run({ checkout: done }, body);
    expect(res.value).toMatchObject({ ok: true, status: "complete" });
    const ver = { ...queued, status: "verifying", checkin_hash: "h-new" };
    const r2 = await run({ checkout: ver, verification: true }, { ...body, source_provider: "seafile" });
    expect(r2.res.value).toMatchObject({ ok: true, status: "verifying" });
  });

  it("rejects completing a different upload on a finished checkout", async () => {
    const done = { ...queued, status: "complete", checkin_hash: "h-other" };
    const { res } = await run({ checkout: done }, body);
    expect(res.status).toBe(409);
  });
});
