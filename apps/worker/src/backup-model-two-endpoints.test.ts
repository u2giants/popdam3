import test from "node:test";
import assert from "node:assert/strict";
import { executeStructuredOutput, failedEndpoints, isEndpointFailure } from "./structured-output.js";
import { OpenRouterError } from "./openrouter.js";
import { shouldUseBackupModel } from "./handlers/ai-tagging.js";
import type { ModelCapabilities } from "./model-capabilities.js";

const capabilities: ModelCapabilities = { modelId: "z-ai/glm-5.3-flash", imageInput: true, tools: false, toolChoice: false, toolChoiceModes: [], structuredOutputs: true, jsonObject: false, prefer: ["json_schema"], source: "override", fetchedAt: new Date().toISOString() };
const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const validate = (v: Record<string, unknown>) => { if (typeof v.answer !== "string") throw new Error("answer required"); return v.answer; };
const fail = (status: number, endpoint: string) => Object.assign(new OpenRouterError(status, "upstream down"), { endpoint });
const run = (completion: (key: string, req: { provider?: { ignore?: string[] } }) => Promise<unknown>) =>
  executeStructuredOutput({ apiKey: "k", model: "z-ai/glm-5.3-flash", messages: [], schemaName: "answer", schema, validate, capabilities, completion: completion as never });

test("a Straitly outage retries the same model on OpenRouter, even for 5xx", async () => {
  const seen: string[] = [];
  const result = await run(async (_k, req) => {
    const skip = req.provider?.ignore?.includes("straitly");
    seen.push(skip ? "openrouter" : "straitly");
    if (!skip) throw fail(503, "straitly");
    return { content: '{"answer":"ok"}' };
  });
  assert.equal(result.value, "ok");
  assert.deepEqual(seen, ["straitly", "openrouter"]);
});

test("failing on two different endpoints is recorded as two endpoints", async () => {
  let error: unknown;
  try {
    await run(async (_k, req) => { throw fail(503, req.provider?.ignore?.includes("straitly") ? "openrouter" : "straitly"); });
  } catch (e) { error = e; }
  const endpoints = failedEndpoints((error as { attempts?: never }).attempts);
  assert.deepEqual(endpoints.sort(), ["openrouter", "straitly"]);
  assert.equal(shouldUseBackupModel("AI call error: upstream down", endpoints), "two_endpoints_failed");
});

test("the same endpoint failing twice does not allow the backup model", () => {
  assert.equal(shouldUseBackupModel("AI call error", ["openrouter", "openrouter"]), null);
  assert.equal(shouldUseBackupModel("AI call error", ["straitly"]), null);
});

test("non-endpoint failures never count as endpoint failures", () => {
  assert.equal(isEndpointFailure(fail(401, "straitly")), false);
  assert.equal(isEndpointFailure(fail(400, "openrouter")), false);
  assert.equal(isEndpointFailure(new Error("Structured output failed: bad tags")), false);
  assert.equal(isEndpointFailure(Object.assign(new Error("timed out"), { endpoint: "straitly" })), true);
  assert.equal(isEndpointFailure(fail(429, "openrouter")), true);
  assert.deepEqual(failedEndpoints([{ method: "json_schema", status: "failed", latencyMs: 1, endpoint: "straitly", validation: "failed" }]), []);
});

test("too few tags still allows the backup model", () => {
  assert.equal(shouldUseBackupModel("asset_tags must contain 1-18 items", []), "too_few_tags");
});
