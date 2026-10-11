import test from "node:test";
import assert from "node:assert/strict";
import type { DB } from "../supabase.js";
import { handleRelinkOrphanedAssets, matchGroup } from "./relink-orphaned.js";

type Row = Record<string, unknown>;

function fakeClient(orphans: Row[], groups: Row[], failGroups: string[] = []) {
  const updates: Array<{ ids: unknown; style_group_id: unknown }> = [];
  const calls: string[] = [];
  const from = (table: string) => {
    let patch: Row | null = null;
    let ids: unknown;
    let after: string | null = null;
    let max = Infinity;
    const q: any = {
      select: () => q, is: () => q, not: () => q, order: () => q, eq: () => q,
      in: (_c: string, v: unknown) => { ids = v; return q; },
      gt: (_c: string, v: string) => { after = v; calls.push(`${table}:gt:${v}`); return q; },
      limit: (n: number) => { max = n; return q; },
      update: (p: Row) => { patch = p; return q; },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        let res: unknown;
        const page = (rows: Row[]) => rows.filter((o) => after === null || (o.id as string) > after).slice(0, max);
        if (patch) {
          updates.push({ ids, style_group_id: patch.style_group_id });
          res = { error: failGroups.includes(patch.style_group_id as string) ? { message: "boom" } : null };
        } else if (table === "style_groups") {
          res = { data: page(groups), error: null };
        } else {
          res = { data: page(orphans), error: null };
        }
        return Promise.resolve(res).then(resolve, reject);
      },
    };
    return q;
  };
  return { client: { from } as unknown as DB, updates, calls };
}

test("matchGroup picks the longest prefixing folder", () => {
  const m = new Map([["Disney/", "broad"], ["Disney/Mugs/", "narrow"]]);
  assert.equal(matchGroup("Disney/Mugs/a.psd", m), "narrow");
  assert.equal(matchGroup("Disney/b.psd", m), "broad");
  assert.equal(matchGroup("Marvel/c.psd", m), null);
});

test("relinks orphans with one update per target group and skips unmatched", async () => {
  const { client, updates } = fakeClient(
    [
      { id: "a1", relative_path: "Disney/Mugs/Floral/x.psd" },
      { id: "a2", relative_path: "Disney/Other/y.psd" },
      { id: "a3", relative_path: "Marvel/z.psd" },
      { id: "a4", relative_path: "Disney/Mugs/Floral/w.psd" },
    ],
    [
      { id: "g-broad", folder_path: "Disney/" },
      { id: "g-narrow", folder_path: "Disney/Mugs/Floral/" },
      { id: "g-null", folder_path: null },
    ],
  );
  const result = await handleRelinkOrphanedAssets({ status: "running", cursor: 0 }, client);
  assert.deepEqual(updates, [
    { ids: ["a1", "a4"], style_group_id: "g-narrow" },
    { ids: ["a2"], style_group_id: "g-broad" },
  ]);
  assert.deepEqual(result, { ok: true, done: true, relinked: 3, errors: 0, nextOffset: null });
});

test("pages through more than 1000 style groups (no silent row cap)", async () => {
  const groups = Array.from({ length: 1500 }, (_, i) => ({ id: `g${String(i).padStart(5, "0")}`, folder_path: `F${i}/` }));
  const { client, updates, calls } = fakeClient([{ id: "a1", relative_path: "F1499/x" }], groups);
  const result = await handleRelinkOrphanedAssets({ status: "running", cursor: 0 }, client);
  assert.ok(calls.includes("style_groups:gt:g00999"));
  assert.deepEqual(updates, [{ ids: ["a1"], style_group_id: "g01499" }]);
  assert.equal(result.relinked, 1);
});

test("counts a failed group update as errors for every asset in it", async () => {
  const { client } = fakeClient(
    [{ id: "a1", relative_path: "A/x" }, { id: "a2", relative_path: "A/y" }, { id: "a3", relative_path: "B/z" }],
    [{ id: "gA", folder_path: "A/" }, { id: "gB", folder_path: "B/" }],
    ["gA"],
  );
  const result = await handleRelinkOrphanedAssets({ status: "running", cursor: undefined }, client);
  assert.equal(result.relinked, 1);
  assert.equal(result.errors, 2);
});

test("resumes strictly after the cursor and finishes when nothing is left", async () => {
  const { client, calls } = fakeClient([{ id: "a1", relative_path: "A/x" }], []);
  const result = await handleRelinkOrphanedAssets({ status: "running", cursor: "a1" }, client);
  assert.deepEqual(calls, ["assets:gt:a1"]);
  assert.deepEqual(result, { ok: true, done: true, relinked: 0, errors: 0 });
});
