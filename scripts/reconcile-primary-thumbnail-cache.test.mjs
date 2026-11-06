import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createApi, reconcile, MAX_CANDIDATES, executeRepair, SafeRepairFailure } from "./reconcile-primary-thumbnail-cache.mjs";
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
  await assert.rejects(reconcile(f.api, { apply: true }), /CANDIDATE_CAP/); assert.equal(f.writes, 0);
});
test("unrelated fields changed by a concurrent writer fail preservation proof", async () => {
  const f = fixture(); const patch = f.api.patch; f.api.patch = async (...args) => { const result = await patch(...args); f.current.title = "different"; return result; };
  const result = await reconcile(f.api, { apply: true }); assert.equal(result.ok, false); assert.equal(result.conflict, 1);
});
test("REST patch contains only cache fields and exact optimistic guards; mismatched target refuses", async () => {
  let call; const ref = "a".repeat(20);
  assert.throws(() => createApi({ url: "https://wrong.invalid", expectedRef: ref, key: "test" }), /TARGET_OR_CREDENTIAL_CONFIGURATION/);
  const api = createApi({ url: `https://${ref}.supabase.co`, expectedRef: ref, key: "test", fetchImpl: async (url, options) => { call = { url, options }; return { ok: true, json: async () => [{ id: "group" }] }; } });
  await api.patch(row(), { primary_thumbnail_url: "new", primary_thumbnail_error: null });
  const p = new URL(call.url).searchParams;
  for (const key of ["id", "primary_asset_id", "updated_at", "primary_thumbnail_url", "primary_thumbnail_error"]) assert.ok(p.has(key));
  assert.deepEqual(JSON.parse(call.options.body), { primary_thumbnail_url: "new", primary_thumbnail_error: null });
});
test("outside-scope primary references refuse before writing", async () => {
  const f = fixture(); f.current.primary_asset.style_group_id = "another-group";
  await assert.rejects(reconcile(f.api, { apply: true }), /OUTSIDE_SCOPE_PRIMARY/); assert.equal(f.writes, 0);
});
test("a newly drifted group in the final census refuses success", async () => {
  const f = fixture(); let lists = 0; f.api.list = async () => ++lists === 1 ? [clone(f.current)] : [clone(f.current), { ...row(), id: "new-group", primary_asset: { ...row().primary_asset, style_group_id: "new-group" } }];
  const result = await reconcile(f.api, { apply: true }); assert.equal(result.final_drift, 1); assert.equal(result.ok, false);
});
test("initial scan failure returns safe zero-write diagnostics without provider text", async () => {
  const f = fixture(); f.api.list = async () => { throw new SafeRepairFailure("REST_HTTP_FAILURE", 500, "57014"); };
  const receipt = await executeRepair(f.api, { apply: true });
  assert.equal(receipt.ok, false); assert.equal(receipt.phase, "initial_scan"); assert.equal(receipt.attempted_patches, 0); assert.equal(receipt.confirmed_patches, 0);
  assert.deepEqual(receipt.failure, { phase: "initial_scan", code: "REST_HTTP_FAILURE", http_status: 500, provider_code: "57014" });
});
test("failure after a confirmed repair retains partial counts and preimages, never claims rollback", async () => {
  const f = fixture(); let lists = 0; f.api.list = async () => { if (++lists === 2) throw Error("private provider body and credential MUST NOT LEAK"); return [clone(f.current)]; };
  const receipt = await executeRepair(f.api, { apply: true, backup: f.backup });
  assert.equal(receipt.ok, false); assert.equal(receipt.phase, "final_scan"); assert.equal(receipt.repaired, 1); assert.equal(receipt.attempted_patches, 1); assert.equal(receipt.confirmed_patches, 1); assert.equal(receipt.mutation_outcome_complete, false);
  assert.equal(f.backups[0].kind, "before_patch"); assert.ok(!JSON.stringify(receipt).includes("MUST NOT LEAK"));
});
test("unconfirmed PATCH transport failure is distinguished from confirmed writes", async () => {
  const f = fixture(); f.api.patch = async () => { throw new TypeError("private network detail"); };
  const receipt = await executeRepair(f.api, { apply: true });
  assert.equal(receipt.attempted_patches, 1); assert.equal(receipt.confirmed_patches, 0); assert.equal(receipt.failure.code, "NETWORK_FAILURE"); assert.equal(receipt.phase, "conditional_patch");
});
test("HTTP diagnostics retain only a safe code and status, never message or details", async () => {
  const ref = "a".repeat(20); const api = createApi({ url: `https://${ref}.supabase.co`, expectedRef: ref, key: "test", fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ code: "PGRST200", message: "licensed private provider data", details: "secret" }) }) });
  const receipt = await executeRepair(api);
  assert.equal(receipt.failure.provider_code, "PGRST200"); assert.equal(receipt.failure.http_status, 400); assert.ok(!JSON.stringify(receipt).includes("licensed")); assert.ok(!JSON.stringify(receipt).includes("secret"));
});

test("CLI persists a private failure receipt when the initial read throws before any mutation", () => {
  const dir = mkdtempSync(join(tmpdir(), "5609-diagnostics-test-"));
  const preload = join(dir, "mock-fetch.mjs");
  writeFileSync(preload, 'globalThis.fetch = async () => ({ok:false,status:500,json:async()=>({code:"57014",message:"fixture-private-data"})});');
  const packet = join(dir, "packet"); let stdout;
  try {
    execFileSync(process.execPath, ["--import", preload, "scripts/reconcile-primary-thumbnail-cache.mjs", "--apply"], { env: { ...process.env, SUPABASE_URL: `https://${"a".repeat(20)}.supabase.co`, SUPABASE_EXPECTED_PROJECT_REF: "a".repeat(20), SUPABASE_SERVICE_ROLE_KEY: "fixture-only", PRIMARY_CACHE_REPAIR_PACKET: packet }, encoding: "utf8" });
    assert.fail("failed scan must exit nonzero");
  } catch (error) { assert.equal(error.status, 1); stdout = error.stdout; }
  const receipt = JSON.parse(readFileSync(join(packet, "receipt.json"), "utf8"));
  assert.equal(receipt.phase, "initial_scan"); assert.equal(receipt.attempted_patches, 0); assert.equal(receipt.confirmed_patches, 0); assert.equal(receipt.failure.provider_code, "57014");
  assert.equal(readFileSync(join(packet, "before-and-after.jsonl"), "utf8"), "");
  assert.equal(statSync(packet).mode & 0o777, 0o700); assert.equal(statSync(join(packet, "receipt.json")).mode & 0o777, 0o600);
  assert.ok(!stdout.includes("fixture-private-data")); assert.ok(!stdout.includes("fixture-only"));
});
test("read UUID scalar is raw eq value, never a quoted UUID cast", async () => {
  const ref = "a".repeat(20), id = "11111111-2222-4333-8444-555555555555"; let seen;
  const api = createApi({ url: `https://${ref}.supabase.co`, expectedRef: ref, key: "test", fetchImpl: async (url) => { seen = new URL(url).searchParams; return { ok: true, json: async () => [] }; } });
  await api.read(id);
  assert.equal(seen.get("id"), `eq.${id}`); assert.ok(!seen.get("id").includes('"'));
});
test("PATCH guards retain exact UUID/timestamp/text/null values with special URL punctuation", async () => {
  const ref = "a".repeat(20); let seen, payload;
  const api = createApi({ url: `https://${ref}.supabase.co`, expectedRef: ref, key: "test", fetchImpl: async (url, options) => { seen = new URL(url).searchParams; payload = JSON.parse(options.body); return { ok: true, json: async () => [{ id: "group" }] }; } });
  const before = { ...row(), id: "11111111-2222-4333-8444-555555555555", primary_asset_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", updated_at: "2026-11-06T09:01:02.123456-05:00", primary_thumbnail_url: 'https://example.invalid/a,b(c).jpg?x=a+b&token="quoted"#fragment', primary_thumbnail_error: null };
  await api.patch(before, { primary_thumbnail_url: null, primary_thumbnail_error: 'new,error (with) "quotes"' });
  for (const k of ["id", "primary_asset_id", "updated_at", "primary_thumbnail_url"]) assert.equal(seen.get(k), `eq.${before[k]}`);
  assert.equal(seen.get("primary_thumbnail_error"), "is.null");
  assert.equal([...seen.keys()].length, 6); assert.equal(seen.has("token"), false);
  assert.deepEqual(payload, { primary_thumbnail_url: null, primary_thumbnail_error: 'new,error (with) "quotes"' });
  before.primary_thumbnail_error = 'old,error "quoted"';
  await api.patch(before, { primary_thumbnail_url: "next", primary_thumbnail_error: null });
  assert.equal(seen.get("primary_thumbnail_error"), `eq.${before.primary_thumbnail_error}`);
});
