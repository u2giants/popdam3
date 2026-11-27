import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { addCount, classifyAttempt, healthKey, hourOf, mergeBuckets, recordProviderAttempt, pendingProviderHealthForTests, resetProviderHealthForTests, RETAIN_HOURS } from "./provider-health.js";

describe("provider health", () => {
  beforeEach(() => resetProviderHealthForTests());
  it("classifies attempts", () => {
    assert.equal(classifyAttempt({ status: "success" }), "ok");
    assert.equal(classifyAttempt({ status: "failed", validation: "failed" }), "invalid");
    assert.equal(classifyAttempt({ status: "failed", parse: "failed" }), "parse");
    assert.equal(classifyAttempt({ status: "failed", error: "The operation was aborted due to timeout" }), "timeout");
    assert.equal(classifyAttempt({ status: "failed", error: "OpenRouter 503" }), "transport");
  });
  it("records endpoint and upstream provider", () => {
    const now = new Date("2026-11-27T20:10:00Z");
    recordProviderAttempt("z-ai/glm-5.3-flash", { status: "success", providerInfo: { provider: "straitly" } }, now);
    recordProviderAttempt("z-ai/glm-5.3-flash", { status: "failed", validation: "failed", providerInfo: { provider: "DeepInfra" } }, now);
    recordProviderAttempt("z-ai/glm-5.3-flash", { status: "failed", endpoint: "straitly", error: "timeout" }, now);
    const b = pendingProviderHealthForTests()["2026-11-27T20"];
    assert.deepEqual(b["z-ai/glm-5.3-flash|straitly|straitly"], { ok: 1 });
    assert.deepEqual(b["z-ai/glm-5.3-flash|openrouter|DeepInfra"], { invalid: 1 });
    assert.deepEqual(b["z-ai/glm-5.3-flash|straitly|unknown"], { timeout: 1 });
  });
  it("merges and drops hours past retention", () => {
    const now = new Date("2026-11-27T20:00:00Z");
    const old = hourOf(new Date(now.getTime() - (RETAIN_HOURS + 2) * 3_600_000));
    const base: Record<string, Record<string, Record<string, number>>> = {}; addCount(base, old, healthKey("m", "e", "p"), "ok"); addCount(base, "2026-11-27T19", "k", "ok", 2);
    const add: Record<string, Record<string, Record<string, number>>> = {}; addCount(add, "2026-11-27T19", "k", "ok", 3);
    const out = mergeBuckets(base, add, now);
    assert.equal(out[old], undefined);
    assert.equal(out["2026-11-27T19"].k.ok, 5);
  });
});
