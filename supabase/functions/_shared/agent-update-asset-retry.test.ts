import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { type DbWriteResult, writeWithRetry } from "./sg-render-completion.ts";

// Execute the actual route against an in-memory Supabase query interface.
const source = readFileSync(new URL("../agent-api/index.ts", import.meta.url), "utf8");
const route = source.slice(source.indexOf("const ALLOWED_UPDATE_FIELDS"), source.indexOf("// ── Route: move-asset"));
const compiled = ts.transpileModule(route, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
async function run(results: Array<DbWriteResult | Error>, body: Record<string, unknown> = { asset_id: "exact-asset", thumbnail_url: "https://example.invalid/original.jpg", thumbnail_error: null, relative_path: "must-not-write" }) {
  const writes: unknown[] = [];
  const db = { from: (table: string) => ({ update: (updates: unknown) => ({ eq: async (field: string, id: string) => {
    writes.push({ table, updates, field, id });
    const result = results[Math.min(writes.length - 1, results.length - 1)];
    if (result instanceof Error) throw result;
    return result;
  } }) }) };
  const handler = new Function("serviceClient", "requireString", "json", "err", "writeWithRetry", `${compiled};return handleUpdateAsset;`)(
    () => db, (b: Record<string, unknown>, key: string) => b[key], (value: unknown) => ({ status: 200, value }),
    (error: string, status = 400) => ({ status, error }),
    (write: () => PromiseLike<DbWriteResult>) => writeWithRetry(write, { sleep: async () => {} }),
  );
  return { response: await handler(body), writes };
}
describe("agent update-asset real handler retry", () => {
  it("retries a statement timeout and saves only allowed fields on the exact asset", async () => {
    const { response, writes } = await run([{ error: { code: "57014", message: "canceling statement due to statement timeout" } }, { error: null }]);
    expect(response).toEqual({ status: 200, value: { ok: true, asset_id: "exact-asset" } });
    expect(writes).toEqual(Array(2).fill({ table: "assets", updates: { thumbnail_url: "https://example.invalid/original.jpg", thumbnail_error: null }, field: "id", id: "exact-asset" }));
  });
  it("reports the actual timeout after the bounded five attempts", async () => {
    const { response, writes } = await run([{ error: { code: "57014", message: "statement timeout" } }]);
    expect(response).toEqual({ status: 500, error: "statement timeout" });expect(writes).toHaveLength(5);
  });
  it("never retries a permanent constraint error", async () => {
    const { response, writes } = await run([{ error: { code: "23514", message: "constraint failure" } }]);
    expect(response).toEqual({ status: 500, error: "constraint failure" });expect(writes).toHaveLength(1);
  });
  it("recovers a thrown connection failure", async () => {
    const { response, writes } = await run([new Error("connection reset"), { error: null }]);
    expect(response.status).toBe(200);expect(writes).toHaveLength(2);
  });
  it("still rejects requests without allowed fields before any write", async () => {
    const { response, writes } = await run([{ error: null }], { asset_id: "exact-asset", relative_path: "ignored" });
    expect(response).toEqual({ status: 400, error: "No valid fields to update" });expect(writes).toEqual([]);
  });
});
