import test from "node:test";
import assert from "node:assert/strict";
import { PromptCache, buildImageTaggingPrompt, type TaggingPromptAsset } from "./ai-tagging-shared.js";

function fixture() {
  const calls = new Map<string, number>();
  const table = (name: string) => {
    calls.set(name, (calls.get(name) ?? 0) + 1);
    const data = name === "admin_config" ? { value: "Synthetic instructions" }
      : name === "property_character_associations" ? [{ character: { id: "00000000-0000-4000-8000-000000000001", name: "Synthetic character" } }]
      : name === "property_character_source_edge" ? []
      : name === "property" || name === "licensor" ? { name: "Synthetic licensing" } : null;
    const chain = { select: () => chain, eq: () => chain, in: () => chain, not: () => chain,
      order: () => chain, limit: () => chain, maybeSingle: () => Promise.resolve({ data, error: null }),
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data, error: null }).then(resolve) };
    return chain;
  };
  return { client: { from: table, schema: () => ({ from: table }) } as never, calls };
}
const asset: TaggingPromptAsset = { id: "asset-a", filename: "a.png", relative_path: null, file_type: "png", tags: null, sku: null, licensor_id: "lic", property_id: "prop" };

test("prompt reads static config once per run for many assets while asset facts and callbacks remain fresh", async () => {
  const { client, calls } = fixture(); const cache = new PromptCache(); const catalogs: string[][] = [];
  const options = { client, cache, requireCharacterReadSuccess: true, onCharacterCatalog: (ids: string[]) => catalogs.push(ids) };
  const first = await buildImageTaggingPrompt(asset, options);
  const second = await buildImageTaggingPrompt({ ...asset, id: "asset-b", filename: "b.png" }, options);
  for (const name of ["admin_config", "property_character_associations", "property_character_source_edge"]) assert.equal(calls.get(name), 1, name);
  assert.equal(calls.get("pdf_text_samples"), 4);
  assert.equal(catalogs.length, 2); assert.deepEqual(catalogs[0], catalogs[1]);
  assert.notEqual(first, second);
  assert.equal(first, await buildImageTaggingPrompt(asset, { ...options, cache: new PromptCache() }));
});

test("prompt cache expires at five minutes and separates properties", async () => {
  let now = 0; const cache = new PromptCache(() => now); const { client, calls } = fixture();
  await buildImageTaggingPrompt(asset, { client, cache });
  now = 299_999; await buildImageTaggingPrompt(asset, { client, cache });
  assert.equal(calls.get("admin_config"), 1);
  await buildImageTaggingPrompt({ ...asset, property_id: "different" }, { client, cache });
  assert.equal(calls.get("property_character_associations"), 2);
  now = 300_000; await buildImageTaggingPrompt(asset, { client, cache });
  assert.equal(calls.get("admin_config"), 2);
  assert.equal(calls.get("property_character_associations"), 3);
});

test("clear for a new run discards cached and in-flight context", async () => {
  const cache = new PromptCache(); let finish!: (value: { data: string; error: null }) => void;
  const old = cache.read("key", () => new Promise<{ data: string; error: null }>(resolve => { finish = resolve; }));
  await Promise.resolve(); cache.clear(); finish({ data: "old", error: null }); await old;
  assert.equal((await cache.read("key", async () => ({ data: "new", error: null }))).data, "new");
  cache.clear(); assert.equal((await cache.read("key", async () => ({ data: "next run", error: null }))).data, "next run");
});

test("concurrent static reads coalesce and failed or missing reads are never cached", async () => {
  const cache = new PromptCache(); let calls = 0;
  const read = () => cache.read("static", async () => { calls++; return { data: [], error: null }; });
  await Promise.all([read(), read(), read()]); assert.equal(calls, 1);
  for (const response of [{ data: null, error: null }, { data: [], error: { code: "denied" } }]) {
    let attempts = 0; const load = async () => { attempts++; return response; };
    await cache.read("bad", load); await cache.read("bad", load); assert.equal(attempts, 2);
  }
});

test("absent optional custom instructions are cached without caching catalog failures", async () => {
  const cache = new PromptCache(); let reads = 0;
  const load = async () => { reads++; return { data: null, error: null }; };
  await cache.read("TAGGING_INSTRUCTIONS", load, true);
  await cache.read("TAGGING_INSTRUCTIONS", load, true);
  assert.equal(reads, 1);
});

test("a strict prompt sharing a failed non-strict in-flight read still reports a catalog dependency", async () => {
  const cache = new PromptCache(); const { client } = fixture();
  let fail!: (reason: Error) => void;
  const waiting = cache.read("property:prop:associations", () => new Promise<{ data: []; error: null }>((_resolve, reject) => { fail = reject; }));
  const ignored = waiting.catch(() => undefined);
  await Promise.resolve();
  const prompt = buildImageTaggingPrompt(asset, { client, cache, requireCharacterReadSuccess: true });
  // Reach the shared pending catalog read after the optional instructions read.
  await new Promise(resolve => setImmediate(resolve));
  fail(new Error("synthetic transport"));
  await assert.rejects(prompt, { name: "CharacterCatalogDependencyError" });
  await ignored;
});
