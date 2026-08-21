import test from "node:test";
import assert from "node:assert/strict";
import { resolveOpenRouterApiKey, resetOpenRouterKeyCache } from "./openrouter-key.js";

test("admin_config wins over the env var, so a UI rotation takes effect", async () => {
  resetOpenRouterKeyCache();
  const key = await resolveOpenRouterApiKey(async () => "sk-or-new", "sk-or-old-env");
  assert.equal(key, "sk-or-new");
});

test("falls back to the env var only when admin_config is empty", async () => {
  resetOpenRouterKeyCache();
  assert.equal(await resolveOpenRouterApiKey(async () => "", "sk-or-old-env"), "sk-or-old-env");
});

test("falls back to the env var when the admin_config read fails", async () => {
  resetOpenRouterKeyCache();
  const key = await resolveOpenRouterApiKey(async () => { throw new Error("db down"); }, "sk-or-old-env");
  assert.equal(key, "sk-or-old-env");
});

test("returns empty when neither source has a key", async () => {
  resetOpenRouterKeyCache();
  assert.equal(await resolveOpenRouterApiKey(async () => "", ""), "");
});

test("caches, then re-reads after the cache is reset", async () => {
  resetOpenRouterKeyCache();
  let reads = 0;
  const loader = async () => { reads += 1; return `sk-${reads}`; };
  assert.equal(await resolveOpenRouterApiKey(loader, ""), "sk-1");
  assert.equal(await resolveOpenRouterApiKey(loader, ""), "sk-1");
  assert.equal(reads, 1);
  resetOpenRouterKeyCache();
  assert.equal(await resolveOpenRouterApiKey(loader, ""), "sk-2");
});
