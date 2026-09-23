import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGeminiBatchPayload,
  directGeminiModelId,
  getGeminiBatch,
  isDirectGeminiBatchModel,
  parseGeminiBatchResult,
  submitGeminiBatch,
  toGeminiJsonSchema,
  type GeminiBatchResultItem,
} from "./gemini-batch.js";
import { indexBatchResults, nextBatchAction } from "./handlers/ai-tagging-batch-state.js";
import type { ChatCompletionRequest } from "./openrouter.js";
import { AmbiguousBatchSubmissionError, DefinitiveBatchSubmissionError } from "./batch-submission-error.js";
import { TAG_ASSET_SCHEMA } from "./handlers/ai-tagging-shared.js";
import { TAG_STYLE_GROUP_SCHEMA } from "./tag-style-group-contract.js";
import { assertProviderSubmissionLeaseBudget, providerBatchPageLimit } from "./batch-provider.js";

const originalFetch = globalThis.fetch;
const model = "google-direct/gemini-3.8-flash:batch";

function request(imageUrl = "https://cdn.designflow.app/art.jpg"): ChatCompletionRequest {
  return {
    model,
    messages: [
      { role: "system", content: "Return licensed-art metadata." },
      { role: "user", content: [{ type: "text", text: "Analyze this image." }, { type: "image_url", image_url: { url: imageUrl } }] },
    ],
    max_tokens: 1000,
    response_format: {
      type: "json_schema",
      json_schema: { name: "tag_asset", schema: { type: "object", properties: { tags: { type: "array", items: { type: "string" } } }, required: ["tags"] } },
    },
  };
}

test.afterEach(() => { globalThis.fetch = originalFetch; });

test("recognizes only explicit direct Gemini batch model IDs", () => {
  assert.equal(isDirectGeminiBatchModel(model), true);
  assert.equal(isDirectGeminiBatchModel("google/gemini-3.8-flash:batch"), false);
  assert.equal(directGeminiModelId(model), "gemini-3.8-flash");
});

test("builds an inline multimodal request without retaining its public URL", async () => {
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
  const payload = await buildGeminiBatchPayload([{ customId: "asset-1", request: request() }]);
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /cdn\.designflow\.app/);
  assert.match(serialized, /AQID/);
  assert.match(serialized, /"displayName":"popdam-image-tagging"/);
  assert.match(serialized, /"inputConfig"/);
  assert.match(serialized, /"inlineData":\{"mimeType":"image\/jpeg"/);
  assert.match(serialized, /"systemInstruction"/);
  assert.match(serialized, /"generationConfig":\{"maxOutputTokens":1000,"responseMimeType":"application\/json","responseJsonSchema"/);
  assert.doesNotMatch(serialized, /display_name|input_config|inline_data|mime_type|system_instruction|generation_config|max_output_tokens|response_mime_type|response_schema/);
  assert.match(serialized, /"key":"asset-1"/);
});

test("converts the real production asset and group schemas for Gemini JSON Schema", () => {
  const assetSchema = toGeminiJsonSchema(TAG_ASSET_SCHEMA);
  const groupSchema = toGeminiJsonSchema(TAG_STYLE_GROUP_SCHEMA);
  const assetType = ((assetSchema.properties as Record<string, unknown>).asset_type as Record<string, unknown>);
  assert.deepEqual(assetType.anyOf, [
    { type: "string", enum: ["art_piece", "product"] },
    { type: "null" },
  ]);
  assert.equal(((groupSchema.properties as Record<string, unknown>).group_tags as Record<string, unknown>).maxItems, 18);
  assert.doesNotMatch(JSON.stringify(assetSchema), /"enum":\[[^\]]*null/);
  assert.doesNotMatch(JSON.stringify(groupSchema), /"enum":\[[^\]]*null/);
});

test("accepts transient inline images for the group-profile path", async () => {
  const payload = await buildGeminiBatchPayload([{ customId: "group-1", request: request("data:image/png;base64,AQID") }]);
  assert.match(JSON.stringify(payload), /"mimeType":"image\/png","data":"AQID"/);
});

test("direct Gemini page ceilings are three assets and one style group", () => {
  assert.equal(providerBatchPageLimit("google-gemini", "asset"), 3);
  assert.equal(providerBatchPageLimit("google-gemini", "style_group"), 1);
  assert.equal(providerBatchPageLimit("openrouter", "asset"), 100);
});

test("refuses a provider POST unless payload prep leaves a safe lease budget", () => {
  const now = Date.parse("2026-09-20T12:00:00Z");
  assert.doesNotThrow(() => assertProviderSubmissionLeaseBudget("2026-09-20T12:01:30Z", 90_000, now));
  assert.throws(() => assertProviderSubmissionLeaseBudget("2026-09-20T12:01:29.999Z", 90_000, now), /insufficient submission lease time/);
  assert.throws(() => assertProviderSubmissionLeaseBudget(undefined, 90_000, now), /insufficient submission lease time/);
});

test("enforces request-count and exact aggregate payload boundaries", async () => {
  const items = [1, 2, 3].map((id) => ({ customId: `asset-${id}`, request: request("data:image/jpeg;base64,AQID") }));
  const payload = await buildGeminiBatchPayload(items);
  const exactBytes = Buffer.byteLength(JSON.stringify(payload));
  await assert.doesNotReject(buildGeminiBatchPayload(items, "popdam-image-tagging", exactBytes));
  await assert.rejects(buildGeminiBatchPayload(items, "popdam-image-tagging", exactBytes - 1), /19 MB safety ceiling/);
  await assert.rejects(buildGeminiBatchPayload([...items, items[0]]), /1-3 requests/);
});

test("fetches the bounded thumbnail set in parallel", async () => {
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    started++;
    await gate;
    return new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/jpeg" } });
  };
  const pending = buildGeminiBatchPayload([1, 2, 3].map((id) => ({ customId: `asset-${id}`, request: request(`https://cdn.designflow.app/${id}.jpg`) })));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 3);
  release();
  await pending;
});

test("rejects untrusted hosts and validates every redirect", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private.jpg" } }); };
  await assert.rejects(buildGeminiBatchPayload([{ customId: "asset-1", request: request("https://cdn.designflow.app/redirect.jpg") }]), /approved public thumbnail host/);
  assert.equal(calls, 1);
  await assert.rejects(buildGeminiBatchPayload([{ customId: "asset-1", request: request("http://localhost/private.jpg") }]), /approved public thumbnail host/);
  assert.equal(calls, 1);
});

test("turns a pre-submission thumbnail timeout into a resumable error", async () => {
  globalThis.fetch = async () => { throw new DOMException("request expired", "TimeoutError"); };
  await assert.rejects(
    buildGeminiBatchPayload([{ customId: "asset-1", request: request() }]),
    /thumbnail fetch timed out before submission/,
  );
});

test("stream-enforces the five-megabyte image ceiling", async () => {
  let pulls = 0;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(3 * 1024 * 1024));
      if (pulls === 2) controller.close();
    },
  }), { status: 200, headers: { "content-type": "image/jpeg" } });
  await assert.rejects(buildGeminiBatchPayload([{ customId: "asset-1", request: request() }]), /1-5242880 bytes/);
  assert.equal(pulls, 2);
});

test("restart polls the saved Gemini ID and never issues a duplicate POST", async () => {
  const calls: Array<{ method: string; url: string; body?: string; apiKey?: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const requestHeaders = new Headers(init?.headers);
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined, apiKey: requestHeaders.get("x-goog-api-key") });
    if (method === "POST") return new Response(JSON.stringify({ name: "batches/saved-123" }), { status: 200 });
    return new Response(JSON.stringify({
      done: false,
      metadata: { state: "BATCH_STATE_RUNNING" },
    }), { status: 200 });
  };

  const submitted = await submitGeminiBatch("AIza-test-secret", [{ customId: "asset-1", request: request("data:image/jpeg;base64,AQID") }]);
  const restored = JSON.parse(JSON.stringify({ phase: "pending", provider: "google-gemini", provider_batch_id: submitted.id }));
  assert.equal(nextBatchAction(restored).type, "claim");
  const action = nextBatchAction({ ...restored, lease_token: "receipt" });
  assert.equal(action.type, "poll");
  if (action.type === "poll") await getGeminiBatch("AIza-test-secret", action.batchId);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(calls.filter((call) => call.method === "GET").length, 1);
  assert.ok(calls.every((call) => !call.url.includes("AIza-test-secret")));
  const post = calls.find((call) => call.method === "POST")!;
  assert.equal(post.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:batchGenerateContent");
  assert.equal(post.apiKey, "AIza-test-secret");
  assert.deepEqual(Object.keys(JSON.parse(post.body!).batch), ["displayName", "inputConfig"]);
});

test("normalizes terminal states and maps inline results by provider metadata", async () => {
  for (const [providerState, expected] of [
    ["BATCH_STATE_SUCCEEDED", "completed"],
    ["BATCH_STATE_FAILED", "failed"],
    ["BATCH_STATE_CANCELLED", "cancelled"],
    ["BATCH_STATE_EXPIRED", "expired"],
  ] as const) {
    globalThis.fetch = async () => new Response(JSON.stringify({
      name: "batches/saved-123",
      done: true,
      metadata: { state: providerState },
      response: { output: { inlinedResponses: { inlinedResponses: [{ metadata: { key: "asset-1" }, response: { candidates: [{ content: { parts: [{ text: "{\"tags\":[\"red\"]}" }] } }] } }] } } },
    }), { status: 200 });
    const record = await getGeminiBatch("key", "batches/saved-123");
    assert.equal(record.status, expected);
    if (expected === "completed") {
      const indexed = indexBatchResults<GeminiBatchResultItem>(["asset-1"], record.results ?? []);
      assert.ok(indexed.has("asset-1"));
      assert.equal(parseGeminiBatchResult(indexed.get("asset-1")!).content, "{\"tags\":[\"red\"]}");
    }
  }
});

test("accepts the JOB_STATE enums returned by the current polling guide", async () => {
  for (const [providerState, expected] of [
    ["JOB_STATE_SUCCEEDED", "completed"],
    ["JOB_STATE_FAILED", "failed"],
    ["JOB_STATE_CANCELLED", "cancelled"],
    ["JOB_STATE_EXPIRED", "expired"],
  ] as const) {
    globalThis.fetch = async () => new Response(JSON.stringify({ done: true, metadata: { state: providerState } }), { status: 200 });
    assert.equal((await getGeminiBatch("key", "batches/saved-123")).status, expected);
  }
});

test("tolerates the documented operation-output and SDK destination wrappers", async () => {
  const result = { metadata: { key: "asset-1" }, response: { candidates: [{ content: { parts: [{ text: "{}" }] } }] } };
  for (const body of [
    { done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" }, response: { inlinedResponses: { inlinedResponses: [result] } } },
    { done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" }, dest: { inlinedResponses: [result] } },
  ]) {
    globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 });
    const record = await getGeminiBatch("key", "batches/saved-123");
    assert.equal(record.status, "completed");
    assert.equal(record.results?.[0]?.custom_id, "asset-1");
  }
});

test("result mismatches and item errors fail closed", () => {
  assert.throws(() => indexBatchResults(["asset-1"], [{ custom_id: "asset-2" }]), /unknown result ID/);
  assert.throws(() => indexBatchResults<GeminiBatchResultItem>(["asset-1"], [{ response: {} }]), /unknown result ID/);
  assert.throws(() => parseGeminiBatchResult({ custom_id: "asset-1", error: { message: "bad prompt echoed" } }), /one batch request failed/);
});

test("provider failures redact credentials, media, and request text", async () => {
  const secret = "AIzaabcdefghijklmnopqrstuvwxyz123456";
  const prompt = "private licensed prompt";
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: `${secret} ${prompt} data:image/jpeg;base64,AQID` } }), { status: 400 });
  await assert.rejects(
    submitGeminiBatch(secret, [{ customId: "asset-1", request: { ...request("data:image/jpeg;base64,AQID"), messages: [{ role: "user", content: prompt }] } }]),
    (error: unknown) => {
      const message = String(error);
      assert.doesNotMatch(message, new RegExp(secret));
      assert.doesNotMatch(message, new RegExp(prompt));
      assert.doesNotMatch(message, /AQID/);
      return true;
    },
  );
});

test("pre-submit image failures are definitive and do not issue a POST", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("should not fetch"); };
  await assert.rejects(
    submitGeminiBatch("key", [{ customId: "asset-1", request: request("file:///private/art.jpg") }]),
    (error: unknown) => error instanceof Error && !(error instanceof AmbiguousBatchSubmissionError) && /approved public thumbnail host/.test(error.message),
  );
  assert.equal(calls, 0);
});

test("Gemini accepts only provider-origin JSON HTTP 400/422 validation refusal", async () => {
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:batchGenerateContent";
  const response = (status: number, body: string, type = "application/json", url = endpoint) => {
    const result = new Response(body, { status, headers: { "content-type": type } });
    Object.defineProperty(result, "url", { value: url });
    return result;
  };
  globalThis.fetch = async () => response(400, JSON.stringify({ error: { message: "invalid request" } }));
  await assert.rejects(
    submitGeminiBatch("key", [{ customId: "asset-1", request: request("data:image/jpeg;base64,AQID") }]),
    (error: unknown) => error instanceof DefinitiveBatchSubmissionError && error.status === 400,
  );

  for (const [status, body, type, url] of [
    [422, JSON.stringify({ error: { message: "invalid" } }), "application/json", endpoint],
    [400, "bad request", "text/plain", endpoint],
    [400, "{bad", "application/json", endpoint],
    [400, JSON.stringify({ error: {} }), "application/json", endpoint],
    [400, JSON.stringify({ error: { message: "invalid" } }), "application/json", "https://other.example"],
    [401, JSON.stringify({ error: { message: "invalid" } }), "application/json", endpoint],
    [500, JSON.stringify({ error: { message: "invalid" } }), "application/json", endpoint],
  ] as const) {
    globalThis.fetch = async () => response(status, body, type, url);
    await assert.rejects(
      submitGeminiBatch("key", [{ customId: "asset-1", request: request("data:image/jpeg;base64,AQID") }]),
      status === 422 ? DefinitiveBatchSubmissionError : AmbiguousBatchSubmissionError,
    );
  }
  globalThis.fetch = async () => { const result = response(400, "{}", "application/json"); result.text = async () => { throw new Error("unreadable"); }; return result; };
  await assert.rejects(submitGeminiBatch("key", [{ customId: "asset-1", request: request("data:image/jpeg;base64,AQID") }]), AmbiguousBatchSubmissionError);

  globalThis.fetch = async () => { throw new TypeError("connection reset after write"); };
  await assert.rejects(
    submitGeminiBatch("key", [{ customId: "asset-1", request: request("data:image/jpeg;base64,AQID") }]),
    AmbiguousBatchSubmissionError,
  );
});
