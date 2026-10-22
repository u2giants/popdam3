import assert from "node:assert/strict";
import test from "node:test";
import { resetDirectProviderApiKeyCacheForTests, resolveDirectProviderApiKey } from "./provider-api-key.js";

test("saved direct-provider keys take priority over environment fallbacks", async () => {
  resetDirectProviderApiKeyCacheForTests();
  assert.equal(await resolveDirectProviderApiKey("META_API_KEY", "meta-env", async () => ({ found: true, value: "meta-settings" })), "meta-settings");
  resetDirectProviderApiKeyCacheForTests();
  assert.equal(await resolveDirectProviderApiKey("SCALEDOWN_API_KEY", "scaledown-env", async () => ({ found: true, value: "scaledown-settings" })), "scaledown-settings");
});

test("an explicitly cleared database key does not reactivate the environment fallback", async () => {
  resetDirectProviderApiKeyCacheForTests();
  assert.equal(await resolveDirectProviderApiKey("META_API_KEY", "meta-env", async () => ({ found: true, value: "" })), "");
});

test("legacy environment values are used only when a database row is missing or unreadable", async () => {
  resetDirectProviderApiKeyCacheForTests();
  assert.equal(await resolveDirectProviderApiKey("META_API_KEY", "meta-env", async () => ({ found: false, value: "" })), "meta-env");
  resetDirectProviderApiKeyCacheForTests();
  assert.equal(await resolveDirectProviderApiKey("SCALEDOWN_API_KEY", "scaledown-env", async () => { throw new Error("unavailable"); }), "scaledown-env");
});

test("direct-provider keys are cached and can be refreshed", async () => {
  resetDirectProviderApiKeyCacheForTests();
  let reads = 0;
  const load = async () => ({ found: true, value: `key-${++reads}` });
  assert.equal(await resolveDirectProviderApiKey("META_API_KEY", "", load), "key-1");
  assert.equal(await resolveDirectProviderApiKey("META_API_KEY", "", load), "key-1");
  assert.equal(reads, 1);
  resetDirectProviderApiKeyCacheForTests();
  assert.equal(await resolveDirectProviderApiKey("META_API_KEY", "", load), "key-2");
});
