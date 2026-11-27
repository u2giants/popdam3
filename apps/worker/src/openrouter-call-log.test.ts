import test from "node:test";
import assert from "node:assert/strict";
import { classifyOpenRouterError, flushOpenRouterCallLog, recordOpenRouterCall, recordOpenRouterSchema } from "./openrouter-call-log.js";
import { OpenRouterError } from "./openrouter.js";

test("openrouter-call tally aggregates by task, model and host with latency percentiles", () => {
  const t = Date.now() + 10 * 60_000;
  flushOpenRouterCallLog(t - 30_000, true);
  for (const ms of [100, 200, 300, 400]) recordOpenRouterCall({ task: "tag_asset", model: "m", host: "HostA", ok: true, latencyMs: ms }, t - 1);
  recordOpenRouterCall({ task: "tag_asset", model: "m", host: null, ok: false, latencyMs: 50, httpStatus: 429, errorClass: "http_429" }, t - 1);
  recordOpenRouterSchema({ task: "tag_asset", model: "m", host: "HostA", ok: false }, t - 1);
  const calls = flushOpenRouterCallLog(t, true)!;
  const a = calls.find((c) => c.host === "HostA")!;
  assert.equal(a.ok, 4); assert.equal(a.schema_failed, 1); assert.equal(a.p50_latency_ms, 200); assert.equal(a.p95_latency_ms, 400);
  assert.deepEqual(a.error_class, { schema_invalid: 1 });
  const u = calls.find((c) => c.host === "unknown")!;
  assert.equal(u.failed, 1); assert.deepEqual(u.error_class, { http_429: 1 }); assert.deepEqual(u.http_status, { "429": 1 });
});

test("classifies errors", () => {
  assert.equal(classifyOpenRouterError(new OpenRouterError(503, "x")), "http_5xx");
  assert.equal(classifyOpenRouterError(Object.assign(new Error("t"), { name: "TimeoutError" })), "timeout");
  assert.equal(classifyOpenRouterError(new Error("Malformed tool call JSON: x")), "invalid_json");
  assert.equal(classifyOpenRouterError(new Error("OpenRouter returned no choices")), "empty");
});
