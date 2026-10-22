import test from "node:test";
import assert from "node:assert/strict";
import { executeStructuredOutput, isStrictCompatibleSchema } from "./structured-output.js";
import type { ModelCapabilities } from "./model-capabilities.js";

const capabilities: ModelCapabilities = { modelId: "test/model", imageInput: true, tools: true, toolChoice: true, toolChoiceModes: ["required"], structuredOutputs: true, jsonObject: true, prefer: [], source: "live", fetchedAt: new Date().toISOString() };
const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const validate = (value: Record<string, unknown>) => { if (typeof value.answer !== "string") throw new Error("answer required"); return value.answer; };
function response(message: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(status === 200 ? { choices: [{ message }], usage: { total_tokens: 1 } } : message), { status, headers: { "content-type": "application/json" } }); }

test("strict schema is used only when every property is required", () => {
  assert.equal(isStrictCompatibleSchema(schema), true);
  assert.equal(isStrictCompatibleSchema({ ...schema, properties: { ...schema.properties, optional: { type: "string" } } }), false);
});

test("executor continues after invalid schema output and succeeds with JSON object", async () => {
  const original = globalThis.fetch; const seen: unknown[] = [];
  globalThis.fetch = async (_url, init) => { seen.push(JSON.parse(String(init?.body))); return seen.length === 1 ? response({ content: "{}" }) : response({ content: '{"answer":"ok"}' }); };
  try {
    const result = await executeStructuredOutput({ apiKey: "key", model: "test/model:exacto", messages: [{ role: "user", content: "test" }], schemaName: "answer", schema, validate, capabilities });
    assert.equal(result.value, "ok"); assert.deepEqual(result.attempts.map((a) => a.method), ["json_schema", "json_object"]);
  } finally { globalThis.fetch = original; }
});

test("executor stops immediately on authentication failure", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ error: "invalid API key" }, 401); };
  try {
    await assert.rejects(() => executeStructuredOutput({ apiKey: "bad", model: "test/model", messages: [], schemaName: "answer", schema, validate, capabilities }), /OpenRouter 401/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("tools-only executor does not make an unsupported JSON repair call", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ content: "not structured" }); };
  try {
    await assert.rejects(() => executeStructuredOutput({
      apiKey: "key", model: "test/model", messages: [], schemaName: "answer", schema, validate,
      capabilities: { ...capabilities, structuredOutputs: false, jsonObject: false, toolChoiceModes: ["required"] },
    }), /Structured output failed/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("JSON object fallback and repair carry the complete contract without changing the model or timeout", async () => {
  const seen: import("./openrouter.js").ChatCompletionRequest[] = [];
  const result = await executeStructuredOutput({
    apiKey: "key", model: "meta-direct/muse-spark-1.3-contributor", messages: [], schemaName: "answer", schema, validate,
    capabilities: { ...capabilities, tools: false, structuredOutputs: false }, timeoutMs: 1234,
    completion: async (_key, request, timeout) => {
      seen.push(request);
      assert.equal(request.model, "meta-direct/muse-spark-1.3-contributor");
      assert.equal(timeout, 1234);
      assert.match(String(request.messages.at(-1)?.content), /"answer"/);
      assert.match(String(request.messages.at(-1)?.content), /"required"/);
      return { content: seen.length === 1 ? "{}" : '{"answer":"corrected"}' };
    },
  });
  assert.equal(result.value, "corrected");
  assert.equal(result.repairCount, 1);
  assert.equal(seen.length, 2);
});
