import { describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

vi.mock("../http.ts", () => ({
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  err: (error: string, status = 400) => new Response(JSON.stringify({ ok: false, error }), { status }),
}));

function makeDb(state: { assets: Row[]; history: Row[] }) {
  let seq = 0;
  const db = {
    from: (table: string) => {
      const rows = () => (table === "assets" ? state.assets : state.history);
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: Row | Row[] | null = null;
      let cap = Infinity;
      const match = () => rows().filter((r) => filters.every((f) => f(r)));
      const api: Row = {
        select: () => api,
        insert: (insertRows: Row[]) => { op = "insert"; payload = insertRows; return api; },
        update: (patch: Row) => { op = "update"; payload = patch; return api; },
        delete: () => { op = "delete"; return api; },
        eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return api; },
        neq: (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return api; },
        in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return api; },
        limit: (n: number) => { cap = n; return api; },
        then: (resolve: (v: unknown) => unknown) => {
          let result: unknown;
          if (op === "select") result = { data: match().slice(0, cap).map((r) => ({ ...r })), error: null };
          else if (op === "insert") {
            const inserted = (payload as Row[]).map((r) => ({ ...r, id: `h${++seq}` }));
            rows().push(...inserted);
            result = { data: inserted.map((r) => ({ id: r.id })), error: null };
          } else if (op === "update") {
            const matched = match();
            for (const r of matched) Object.assign(r, payload as Row);
            result = { data: matched.map((r) => ({ id: r.id })), error: null };
          } else {
            const matched = new Set(match());
            const table = rows();
            for (let i = table.length - 1; i >= 0; i--) if (matched.has(table[i])) table.splice(i, 1);
            result = { data: [], error: null };
          }
          return Promise.resolve(result).then(resolve);
        },
      };
      return api;
    },
  };
  return db;
}

const harness = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../service-client.ts", () => ({ serviceClient: () => harness.db }));

async function run(state: { assets: Row[]; history: Row[] }, assetIds: string[]) {
  harness.db = makeDb(state);
  const { handleRestoreMissingAssets } = await import("./restore-missing-handlers.ts");
  const res = await handleRestoreMissingAssets({ asset_ids: assetIds });
  return await (res as Response).json() as { ok: boolean; restored: number; skipped: Record<string, number> };
}

const hidden = (id: string, path: string, extra: Row = {}) => ({
  id, relative_path: path, filename: "a.pdf", file_size: 10, quick_hash: "h", is_deleted: true, ...extra,
});
const marker = (id: string) => ({ id: `m-${id}`, asset_id: id, new_relative_path: "retired-missing-from-nas" });

describe("handleRestoreMissingAssets (#1198)", () => {
  it("restores a hidden record whose file has no surviving copy", async () => {
    const state = { assets: [hidden("a1", "old/a.pdf")], history: [marker("a1")] };
    const result = await run(state, ["a1"]);
    expect(result).toMatchObject({ ok: true, restored: 1, skipped: {} });
    expect(state.assets[0].is_deleted).toBe(false);
    expect(state.history.some((h) => h.new_relative_path === "restored-no-surviving-copy")).toBe(true);
  });

  it("never restores a record whose file survives at another live path", async () => {
    const state = {
      assets: [hidden("a1", "old/a.pdf"), { id: "s1", relative_path: "new/a.pdf", filename: "a.pdf", file_size: 10, quick_hash: "h", is_deleted: false }],
      history: [marker("a1")],
    };
    const result = await run(state, ["a1"]);
    expect(result.restored).toBe(0);
    expect(result.skipped.surviving_copy).toBe(1);
    expect(state.assets[0].is_deleted).toBe(true);
  });

  it("skips records the missing-file step did not hide and records without its marker", async () => {
    const state = {
      assets: [hidden("a1", "old/a.pdf", { is_deleted: false }), hidden("a2", "old/b.pdf")],
      history: [{ id: "m2", asset_id: "a2", new_relative_path: "Decor/other.psd" }],
    };
    const result = await run(state, ["a1", "a2"]);
    expect(result.restored).toBe(0);
    expect(result.skipped).toEqual({ not_hidden: 1, no_marker: 1 });
  });

  it("restores only one record per identity within one request", async () => {
    const state = {
      assets: [hidden("a1", "old/a.pdf"), hidden("b1", "older/a.pdf")],
      history: [marker("a1"), marker("b1")],
    };
    const result = await run(state, ["a1", "b1"]);
    expect(result.restored).toBe(1);
    expect(result.skipped.duplicate_in_request).toBe(1);
    expect(state.assets.filter((a) => a.is_deleted === false)).toHaveLength(1);
  });
});
