import test from "node:test";
import assert from "node:assert/strict";
import { createApi, reconcile, MAX_CANDIDATES } from "./reconcile-primary-thumbnail-cache.mjs";
const clone = (x) => structuredClone(x);
const row = () => ({ id: "group", primary_asset_id: "selected", primary_thumbnail_url: "old", primary_thumbnail_error: "old error", updated_at: "v1", title: "preserved", primary_asset: { id: "selected", style_group_id: "group", is_deleted: false, thumbnail_url: "new", thumbnail_error: null, updated_at: "a1" } });
function fixture() {
  let current = row(), writes = 0; const backups = [];
  const api = {
    list: async () => [clone(current)], read: async () => clone(current),
    patch: async (before, fields) => { writes++; assert.equal(before.primary_asset_id, current.primary_asset_id); Object.assign(current, fields, { updated_at: "v2" }); return [{ id: current.id }]; },
  };
  return { api, backups, backup: (r) => backups.push(clone(r)), get current() { return current; }, get writes() { return writes; } };
}
test("dry run never patches; private backup precedes a guarded repair and null clearing", async () => {
  const f = fixture(); const preview = await reconcile(f.api, { backup: f.backup });
  assert.equal(preview.dry_run, 1); assert.equal(f.writes, 0);
  const patch = f.api.patch; f.api.patch = async (...args) => { assert.equal(f.backups.at(-1).kind, "before_patch"); return patch(...args); };
  const result = await reconcile(f.api, { apply: true, backup: f.backup });
  assert.equal(result.ok, true); assert.equal(result.repaired, 1); assert.equal(f.current.primary_thumbnail_url, "new"); assert.equal(f.current.primary_thumbnail_error, null); assert.equal(f.current.primary_asset_id, "selected"); assert.equal(f.current.title, "preserved");
  assert.equal((await reconcile(f.api, { apply: true })).candidates, 0); assert.equal(f.writes, 1);
});
test("primary switch before repair is a conflict, never overwritten", async () => {
  const f = fixture(); f.api.read = async () => ({ ...clone(f.current), primary_asset_id: "other" });
  const result = await reconcile(f.api, { apply: true }); assert.equal(result.ok, false); assert.equal(result.conflict, 1); assert.equal(f.writes, 0);
});
test("zero-row optimistic PATCH is skipped as a failed conflict", async () => {
  const f = fixture(); f.api.patch = async () => [];
  const result = await reconcile(f.api, { apply: true }); assert.equal(result.conflict, 1); assert.equal(result.ok, false);
});
test("source change before PATCH retries from the fresh source rather than old cached values", async () => {
  const f = fixture(); let reads = 0; f.api.read = async () => { if (++reads === 2) { f.current.primary_asset.thumbnail_url = "newest"; f.current.primary_asset.updated_at = "a2"; } return clone(f.current); };
  const result = await reconcile(f.api, { apply: true }); assert.equal(result.ok, true); assert.equal(f.current.primary_thumbnail_url, "newest"); assert.equal(f.writes, 1);
});
test("source change after PATCH is read back and repaired, not silently accepted", async () => {
  const f = fixture(); const patch = f.api.patch; let first = true; f.api.patch = async (...args) => { const result = await patch(...args); if (first) { first = false; f.current.primary_asset.thumbnail_url = "newest"; } return result; };
  const result = await reconcile(f.api, { apply: true }); assert.equal(result.ok, true); assert.equal(f.writes, 2); assert.equal(f.current.primary_thumbnail_url, "newest");
});
test("continuous source churn exhausts three attempts and fails", async () => {
  const f = fixture(); const patch = f.api.patch; f.api.patch = async (...args) => { const result = await patch(...args); f.current.primary_asset.thumbnail_url += "changed"; return result; };
  const result = await reconcile(f.api, { apply: true }); assert.equal(result.ok, false); assert.equal(result.unresolved, 1); assert.equal(f.writes, 3);
});
test("null source URL and non-null error are preserved exactly", async () => {
  const f = fixture(); f.current.primary_asset.thumbnail_url = null; f.current.primary_asset.thumbnail_error = "no preview";
  const result = await reconcile(f.api, { apply: true }); assert.equal(result.ok, true); assert.equal(f.current.primary_thumbnail_url, null); assert.equal(f.current.primary_thumbnail_error, "no preview");
});
test("candidate cap refuses before any writes", async () => {
  const f = fixture(); f.api.list = async () => Array.from({ length: MAX_CANDIDATES + 1 }, row);
  await assert.rejects(reconcile(f.api, { apply: true }), /candidate cap/); assert.equal(f.writes, 0);
});
test("unrelated fields changed by a concurrent writer fail preservation proof", async () => {
  const f = fixture(); const patch = f.api.patch; f.api.patch = async (...args) => { const result = await patch(...args); f.current.title = "different"; return result; };
  const result = await reconcile(f.api, { apply: true }); assert.equal(result.ok, false); assert.equal(result.conflict, 1);
});
test("REST patch contains only cache fields and exact optimistic guards; mismatched target refuses", async () => {
  let call; const ref = "a".repeat(20);
  assert.throws(() => createApi({ url: "https://wrong.invalid", expectedRef: ref, key: "test" }), /target/);
  const api = createApi({ url: `https://${ref}.supabase.co`, expectedRef: ref, key: "test", fetchImpl: async (url, options) => { call = { url, options }; return { ok: true, json: async () => [{ id: "group" }] }; } });
  await api.patch(row(), { primary_thumbnail_url: "new", primary_thumbnail_error: null });
  const p = new URL(call.url).searchParams;
  for (const key of ["id", "primary_asset_id", "updated_at", "primary_thumbnail_url", "primary_thumbnail_error"]) assert.ok(p.has(key));
  assert.deepEqual(JSON.parse(call.options.body), { primary_thumbnail_url: "new", primary_thumbnail_error: null });
});
test("outside-scope primary references refuse before writing", async () => {
  const f = fixture(); f.current.primary_asset.style_group_id = "another-group";
  await assert.rejects(reconcile(f.api, { apply: true }), /outside approved/); assert.equal(f.writes, 0);
});
test("a newly drifted group in the final census refuses success", async () => {
  const f = fixture(); let lists = 0; f.api.list = async () => ++lists === 1 ? [clone(f.current)] : [clone(f.current), { ...row(), id: "new-group", primary_asset: { ...row().primary_asset, style_group_id: "new-group" } }];
  const result = await reconcile(f.api, { apply: true }); assert.equal(result.final_drift, 1); assert.equal(result.ok, false);
});
