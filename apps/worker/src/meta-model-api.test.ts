import assert from "node:assert/strict";
import test from "node:test";
import { buildMetaResponsesBody, isMetaDirectModel, metaChatCompletion, metaModelId } from "./meta-model-api.js";

test("recognizes and unwraps explicit direct Meta model IDs", () => {
  assert.equal(isMetaDirectModel("meta-direct/muse-spark-1.3-contributor"), true);
  assert.equal(isMetaDirectModel("meta/muse-spark-1.3"), false);
  assert.equal(metaModelId("meta-direct/muse-spark-1.3-contributor"), "muse-spark-1.3-contributor");
});

test("calls Meta directly and parses tool arguments", async () => {
  const original = globalThis.fetch;
  let sent: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.meta.ai/v1/responses");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-meta-key");
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "meta-generation-1",
      model: "muse-spark-1.3-contributor",
      status: "completed",
      output: [{ type: "reasoning" }, { type: "function_call", name: "tag_asset", arguments: '{"tags":["art"]}' }],
      usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
    }));
  };
  try {
    const result = await metaChatCompletion("test-meta-key", {
      model: "meta-direct/muse-spark-1.3-contributor",
      messages: [{ role: "user", content: "tag it" }],
      provider: { only: ["ignored-openrouter-pin"] },
      tool_choice: "auto",
    });
    const requestBody = sent as Record<string, unknown> | null;
    assert.equal(requestBody?.model, "muse-spark-1.3-contributor");
    assert.equal("provider" in (requestBody ?? {}), false);
    assert.deepEqual(result.toolCalls, [{ name: "tag_asset", arguments: { tags: ["art"] } }]);
    assert.equal(result.providerInfo?.provider, "meta-model-api");
    assert.equal(result.usage?.prompt_tokens, 10);
  } finally {
    globalThis.fetch = original;
  }
});

test("maps chat requests onto the Responses API shape", () => {
  const body = buildMetaResponsesBody({
    model: "meta-direct/muse-spark-1.3-contributor",
    messages: [
      { role: "system", content: "rules" },
      { role: "user", content: [{ type: "text", text: "tag" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] },
    ],
    response_format: { type: "json_schema", json_schema: { name: "tag", strict: true, schema: { type: "object" } } },
    tools: [{ type: "function", function: { name: "tag_asset", parameters: { type: "object" } } }],
    tool_choice: { type: "function", function: { name: "tag_asset" } },
    max_tokens: 1000,
  });
  assert.equal(body.model, "muse-spark-1.3-contributor");
  assert.deepEqual(body.input, [
    { role: "system", content: "rules" },
    { role: "user", content: [{ type: "input_text", text: "tag" }, { type: "input_image", image_url: "data:image/png;base64,AA" }] },
  ]);
  assert.deepEqual(body.text, { format: { type: "json_schema", name: "tag", strict: true, schema: { type: "object" } } });
  assert.deepEqual(body.tools, [{ type: "function", name: "tag_asset", description: undefined, parameters: { type: "object" } }]);
  assert.deepEqual(body.tool_choice, { type: "function", name: "tag_asset" });
  assert.ok((body.max_output_tokens as number) > 1000);
});

test("parses structured text and rejects incomplete responses", async () => {
  const original = globalThis.fetch;
  const request = { model: "meta-direct/muse-spark-1.3-contributor", messages: [{ role: "user" as const, content: "x" }] };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: '{"a":1}' }] }],
    }));
    assert.equal((await metaChatCompletion("k", request)).content, '{"a":1}');
    globalThis.fetch = async () => new Response(JSON.stringify({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }));
    await assert.rejects(metaChatCompletion("k", request), /incomplete: max_output_tokens/);
  } finally {
    globalThis.fetch = original;
  }
});

test("retries intermittent model_not_found, then gives up with a named error", async () => {
  const original = globalThis.fetch;
  const request = { model: "meta-direct/muse-spark-1.3-contributor", messages: [{ role: "user" as const, content: "x" }] };
  const notFound = () => new Response('{"error":{"code":"model_not_found"}}', { status: 404 });
  const ok = () => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] }));
  try {
    let calls = 0;
    globalThis.fetch = async () => (++calls < 3 ? notFound() : ok());
    assert.equal((await metaChatCompletion("k", request, 1000, [0, 0, 0])).content, "ok");
    assert.equal(calls, 3);
    calls = 0;
    globalThis.fetch = async () => { calls++; return notFound(); };
    await assert.rejects(metaChatCompletion("k", request, 1000, [0, 0]), /unavailable after 3 attempts/);
    assert.equal(calls, 3);
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("bad", { status: 400 }); };
    await assert.rejects(metaChatCompletion("k", request, 1000, [0, 0]), /400/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
