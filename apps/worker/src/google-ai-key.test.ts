import assert from "node:assert/strict";
import test from "node:test";
import { resetGoogleAiKeyCacheForTests, resolveGoogleAiApiKey } from "./google-ai-key.js";

test("database-managed Google key wins over the environment fallback", async () => {
  resetGoogleAiKeyCacheForTests();
  assert.equal(await resolveGoogleAiApiKey(async () => "google-db", "google-env"), "google-db");
});

test("Google key resolver falls back without exposing provider configuration", async () => {
  resetGoogleAiKeyCacheForTests();
  assert.equal(await resolveGoogleAiApiKey(async () => "", "google-env"), "google-env");
  resetGoogleAiKeyCacheForTests();
  assert.equal(await resolveGoogleAiApiKey(async () => { throw new Error("unavailable"); }, "google-env"), "google-env");
});

test("Google key resolver caches and can be reset", async () => {
  resetGoogleAiKeyCacheForTests();
  let reads = 0;
  const loader = async () => `google-${++reads}`;
  assert.equal(await resolveGoogleAiApiKey(loader, ""), "google-1");
  assert.equal(await resolveGoogleAiApiKey(loader, ""), "google-1");
  assert.equal(reads, 1);
  resetGoogleAiKeyCacheForTests();
  assert.equal(await resolveGoogleAiApiKey(loader, ""), "google-2");
});
