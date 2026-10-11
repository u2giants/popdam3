import test from "node:test";
import assert from "node:assert/strict";
import type { DB } from "../supabase.js";
import { handleRelinkOrphanedAssets } from "./relink-orphaned.js";

type Row = Record<string, unknown>;

function fakeClient(orphans: Row[], groups: Row[], failIds: string[] = []) {
  const updates: Array<{ id: unknown; style_group_id: unknown }> = [];
  const calls: string[] = [];
  const from = (table: string) => {
    let patch: Row | null = null;
    let id: unknown;
    let after: string | null = null;
    let max = Infinity;
    const q: any = {
      select: () => q, is: () => q, not: () => q, order: () => q,
      eq: (col: string, v: unknown) => { if (col === "id") id = v; return q; },
      gt: (_c: string, v: string) => { after = v; calls.push(`gt:${v}`); return q; },
      limit: (n: number) => { max = n; return q; },
      update: (p: Row) => { patch = p; return q; },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        let res: unknown;
        if (patch) {
          updates.push({ id, style_group_id: patch.style_group_id });
          res = { error: failIds.includes(id as string) ? { message: "boom" } : null };
        } else if (table === "style_groups") {
          res = { data: groups, error: null };
        } else {
          res = { data: orphans.filter((o) => after === null || (o.id as string) > after).slice(0, max), error: null };
        }
        return Promise.resolve(res).then(resolve, reject);
      },
    };
    return q;
  };
  return { client: { from } as unknown as DB, updates, calls };
}

test("relinks orphans to the longest matching group folder and skips unmatched", async () => {
  const { client, updates } = fakeClient(
    [
      { id: "a1", relative_path: "Disney/Mugs/Floral/x.psd" },
      { id: "a2", relative_path: "Disney/Other/y.psd" },
      { id: "a3", relative_path: "Marvel/z.psd" },
    ],
    [
      { id: "g-broad", folder_path: "Disney/" },
      { id: "g-narrow", folder_path: "Disney/Mugs/Floral/" },
      { id: "g-null", folder_path: null },
    ],
  );
  const result = await handleRelinkOrphanedAssets({ status: "running", cursor: 0 }, client);
  assert.deepEqual(updates, [
    { id: "a1", style_group_id: "g-narrow" },
    { id: "a2", style_group_id: "g-broad" },
  ]);
  assert.deepEqual(result, { ok: true, done: true, relinked: 2, errors: 0, nextOffset: null });
});

test("counts update failures as errors without aborting the batch", async () => {
  const { client } = fakeClient(
    [{ id: "a1", relative_path: "A/x" }, { id: "a2", relative_path: "A/y" }],
    [{ id: "g", folder_path: "A/" }],
    ["a1"],
  );
  const result = await handleRelinkOrphanedAssets({ status: "running", cursor: undefined }, client);
  assert.equal(result.relinked, 1);
  assert.equal(result.errors, 1);
});

test("resumes strictly after the cursor and finishes when nothing is left", async () => {
  const { client, calls } = fakeClient([{ id: "a1", relative_path: "A/x" }], []);
  const result = await handleRelinkOrphanedAssets({ status: "running", cursor: "a1" }, client);
  assert.deepEqual(calls, ["gt:a1"]);
  assert.deepEqual(result, { ok: true, done: true, relinked: 0, errors: 0 });
});
