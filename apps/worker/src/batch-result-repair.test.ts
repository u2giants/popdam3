import assert from "node:assert/strict";
import test from "node:test";
import { RepairUnavailableError, sameModelRepairCompletion, structuredBatchResult } from "./batch-result-repair.js";
import { chatCompletion, parseOpenRouterBatchResult, type ChatCompletionRequest } from "./openrouter.js";
import { geminiGenerateContent } from "./gemini-batch.js";

const schema = { type: "object", properties: { tags: { type: "array", items: { type: "string" } } }, required: ["tags"] };
const validate = (value: Record<string, unknown>) => {
  if (!Array.isArray(value.tags)) throw new Error("tags must be an array");
  return value as { tags: string[] };
};

test("repair uses the SAME model's synchronous endpoint, never another model", () => {
  const openRouter = sameModelRepairCompletion("google/gemini-3.7-flash:batch");
  assert.equal(openRouter.model, "google/gemini-3.7-flash");
  assert.equal(openRouter.completion, chatCompletion);
  const direct = sameModelRepairCompletion("google-direct/gemini-3.8-flash:batch");
  assert.equal(direct.model, "google-direct/gemini-3.8-flash:batch");
  assert.equal(direct.completion, geminiGenerateContent);
});

test("a valid batch answer is applied without any repair call", async () => {
  let calls = 0;
  const result = await structuredBatchResult({
    apiKey: "k", model: "m:batch", result: { content: "{\"tags\":[\"red\"]}" }, toolName: "tag_asset", schema, validate,
    repair: { model: "m", completion: async () => { calls++; return { content: "{}" }; } },
  });
  assert.deepEqual(result, { value: { tags: ["red"] }, repaired: false });
  assert.equal(calls, 0);
});

test("malformed and schema-invalid answers are repaired once on the same model, text only", async () => {
  for (const content of ["tags: red, blue", "{\"tags\":\"red\"}"]) {
    const requests: ChatCompletionRequest[] = [];
    const result = await structuredBatchResult({
      apiKey: "k", model: "m:batch", result: { content }, toolName: "tag_asset", schema, validate,
      repair: { model: "m", completion: async (_key, request) => { requests.push(request); return { content: "{\"tags\":[\"red\",\"blue\"]}" }; } },
    });
    assert.deepEqual(result, { value: { tags: ["red", "blue"] }, repaired: true });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, "m");
    assert.deepEqual(requests[0].response_format, { type: "json_object" });
    assert.ok(requests[0].messages.every((message) => typeof message.content === "string"), "repair sends no images");
  }
});

test("an answer that still cannot be repaired fails with its reason", async () => {
  await assert.rejects(structuredBatchResult({
    apiKey: "k", model: "m:batch", result: { content: "not json" }, toolName: "tag_asset", schema, validate,
    repair: { model: "m", completion: async () => ({ content: "still not json" }) },
  }), /Unrepairable batch result: No parsable structured output; repair failed: No parsable JSON after repair/);
  await assert.rejects(structuredBatchResult({
    apiKey: "k", model: "m:batch", result: { content: "" }, toolName: "tag_asset", schema, validate,
    repair: { model: "m", completion: async () => { throw new Error("must not be called"); } },
  }), /no content to repair/);
  await assert.rejects(structuredBatchResult({
    apiKey: "k", model: "m:batch", result: { content: "bad" }, toolName: "tag_asset", schema, validate,
    repair: { model: "m", completion: async () => { throw Object.assign(new Error("OpenRouter 400 bad request"), { status: 400 }); } },
  }), /repair failed: OpenRouter 400/);
});

test("repair infrastructure failures pause the apply instead of failing the item", async () => {
  for (const error of [
    Object.assign(new Error("OpenRouter 401"), { status: 401 }),
    Object.assign(new Error("OpenRouter 402"), { status: 402 }),
    Object.assign(new Error("OpenRouter 429"), { status: 429 }),
    Object.assign(new Error("OpenRouter 503"), { status: 503 }),
    new DOMException("timed out", "TimeoutError"),
    new TypeError("fetch failed"),
  ]) {
    await assert.rejects(structuredBatchResult({
      apiKey: "k", model: "m:batch", result: { content: "bad" }, toolName: "tag_asset", schema, validate,
      repair: { model: "m", completion: async () => { throw error; } },
    }), RepairUnavailableError);
  }
});

test("malformed OpenRouter tool-call arguments reach the same-model repair", async () => {
  const parsed = await parseOpenRouterBatchResult("k", {
    custom_id: "a",
    response: { status_code: 200, body: { choices: [{ message: { tool_calls: [{ function: { name: "tag_asset", arguments: "{\"tags\": [\"red\"" } }] } }] } },
  } as never);
  assert.match(parsed.content ?? "", /"tags"/);
  const result = await structuredBatchResult({
    apiKey: "k", model: "m:batch", result: parsed, toolName: "tag_asset", schema, validate,
    repair: { model: "m", completion: async () => ({ content: "{\"tags\":[\"red\"]}" }) },
  });
  assert.deepEqual(result, { value: { tags: ["red"] }, repaired: true });
});

test("direct Gemini repair calls generateContent on the same model and never a batch endpoint", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"tags\":[\"ok\"]}" }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await structuredBatchResult({
      apiKey: "k", model: "google-direct/gemini-3.8-flash:batch", result: { content: "oops" }, toolName: "tag_asset", schema, validate,
    });
    assert.deepEqual(result.value, { tags: ["ok"] });
    assert.deepEqual(urls, ["https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"]);
  } finally {
    globalThis.fetch = original;
  }
});
