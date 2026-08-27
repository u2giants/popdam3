import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenRouterBatchPayload, chatCompletion, getOpenRouterBatch, isToolChoiceCompatibilityError, submitOpenRouterBatch, withExactoRouting } from "./openrouter.js";

test("appends :exacto to a bare model slug", () => {
  assert.equal(withExactoRouting("qwen/qwen3-vl-32b-instruct"), "qwen/qwen3-vl-32b-instruct:exacto");
  assert.equal(withExactoRouting("deepseek/deepseek-v4-pro"), "deepseek/deepseek-v4-pro:exacto");
});

test("leaves a model that already carries an explicit variant untouched", () => {
  assert.equal(withExactoRouting("minimax/minimax-m3:exacto"), "minimax/minimax-m3:exacto");
  assert.equal(withExactoRouting("qwen/qwen3-vl-32b-instruct:nitro"), "qwen/qwen3-vl-32b-instruct:nitro");
  assert.equal(withExactoRouting("some/model:free"), "some/model:free");
});

test("trims surrounding whitespace and no-ops on empty input", () => {
  assert.equal(withExactoRouting("  deepseek/deepseek-v4-flash  "), "deepseek/deepseek-v4-flash:exacto");
  assert.equal(withExactoRouting(""), "");
  assert.equal(withExactoRouting("   "), "");
});

test("tool choice compatibility fallback accepts provider 400 and 404 errors", () => {
  assert.equal(isToolChoiceCompatibilityError(400, 'only "auto" is supported for tool_choice'), true);
  assert.equal(isToolChoiceCompatibilityError(404, "unsupported tool_choice"), true);
  assert.equal(isToolChoiceCompatibilityError(400, "invalid image"), false);
  assert.equal(isToolChoiceCompatibilityError(422, "unsupported tool_choice"), false);
});

test("stateless submit performs one POST and returns without polling", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ id: "batch-1", status: "pending" }), { status: 200 });
  };
  try {
    const result = await submitOpenRouterBatch("key", [{ customId: "asset-1", request: { model: "google/gemini:batch", messages: [] } }]);
    assert.equal(result.id, "batch-1");
    assert.deepEqual(calls, ["https://openrouter.ai/api/beta/batches"]);
  } finally { globalThis.fetch = original; }
});

test("stateless get reads only the supplied saved batch", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ id: "batch-saved", status: "completed", results: [] }), { status: 200 });
  };
  try {
    assert.equal((await getOpenRouterBatch("key", "batch-saved")).id, "batch-saved");
    assert.deepEqual(calls, ["https://openrouter.ai/api/beta/batches/batch-saved"]);
  } finally { globalThis.fetch = original; }
});

test("batch builder enforces the 100 request provider limit", () => {
  const item = { customId: "asset", request: { model: "google/gemini:batch", messages: [] } };
  assert.throws(() => buildOpenRouterBatchPayload(Array.from({ length: 101 }, (_, index) => ({ ...item, customId: `asset-${index}` }))));
});

test("batch builder accepts public image URLs and rejects data URIs before submission", () => {
  const request = {
    model: "google/gemini:batch",
    messages: [{ role: "user" as const, content: [{ type: "image_url" as const, image_url: { url: "https://cdn.example.test/asset.jpg" } }] }],
  };
  const payload = buildOpenRouterBatchPayload([{ customId: "asset", request }]);
  assert.deepEqual(payload.requests[0].body.messages, request.messages);

  const dataUriRequest = {
    ...request,
    messages: [{ role: "user" as const, content: [{ type: "image_url" as const, image_url: { url: "data:image/jpeg;base64,AA==" } }] }],
  };
  assert.throws(
    () => buildOpenRouterBatchPayload([{ customId: "asset", request: dataUriRequest }]),
    /public http\(s\).*data URIs are not supported/,
  );
});

test("synchronous callers cannot use batch-only models", async () => {
  await assert.rejects(() => chatCompletion("key", {
    model: "google/gemini-3.7-flash:batch",
    messages: [{ role: "user", content: "blocked" }],
  }), /durable asynchronous Batch API path/);
});
