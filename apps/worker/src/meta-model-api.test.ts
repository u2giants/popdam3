import assert from "node:assert/strict";
import test from "node:test";
import { isMetaDirectModel, metaChatCompletion, metaModelId } from "./meta-model-api.js";

test("recognizes and unwraps explicit direct Meta model IDs", () => {
  assert.equal(isMetaDirectModel("meta-direct/muse-spark-1.3-contributor"), true);
  assert.equal(isMetaDirectModel("meta/muse-spark-1.3"), false);
  assert.equal(metaModelId("meta-direct/muse-spark-1.3-contributor"), "muse-spark-1.3-contributor");
});

test("calls Meta directly and parses tool arguments", async () => {
  const original = globalThis.fetch;
  let sent: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.meta.ai/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-meta-key");
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "meta-generation-1",
      model: "muse-spark-1.3-contributor",
      choices: [{ message: { tool_calls: [{ function: { name: "tag_asset", arguments: '{"tags":["art"]}' } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
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
  } finally {
    globalThis.fetch = original;
  }
});
