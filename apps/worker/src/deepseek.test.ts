import assert from "node:assert/strict";
import test from "node:test";
import { deepSeekChat, DeepSeekError, resolveDeepSeekApiKey, resolveDeepSeekModel } from "./deepseek.js";

function stubFetch(status: number, body: unknown): { calls: string[]; bodies: Record<string, unknown>[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, bodies, restore: () => { globalThis.fetch = original; } };
}

test("posts to the DeepSeek direct endpoint when no baseUrl is given", async () => {
  const { calls, bodies, restore } = stubFetch(200, {
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: { total_tokens: 1 },
    model: "deepseek-chat",
  });
  try {
    const result = await deepSeekChat({
      apiKey: "k",
      model: "deepseek-chat",
      system: "prefix",
      user: "text",
    });
    assert.deepEqual(calls, ["https://api.deepseek.com/chat/completions"]);
    assert.equal(bodies[0].model, "deepseek-chat");
    assert.equal(result.content, '{"ok":true}');
    assert.equal(result.model, "deepseek-chat");
  } finally {
    restore();
  }
});

test("uses an OpenRouter model slug for bare DeepSeek model IDs", async () => {
  const { calls, bodies, restore } = stubFetch(200, {
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: { total_tokens: 1 },
    model: "deepseek/deepseek-v4.1-flash-1017",
  });
  try {
    const result = await deepSeekChat({
      apiKey: "or-key",
      model: "deepseek-chat",
      system: "prefix",
      user: "text",
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    });
    assert.deepEqual(calls, ["https://openrouter.ai/api/v1/chat/completions"]);
    assert.equal(bodies[0].model, "deepseek/deepseek-chat");
    assert.equal(result.model, "deepseek/deepseek-v4.1-flash-1017");
  } finally {
    restore();
  }
});

test("preserves an already namespaced OpenRouter model ID", () => {
  assert.equal(
    resolveDeepSeekModel("deepseek/deepseek-chat", "https://openrouter.ai/api/v1/chat/completions"),
    "deepseek/deepseek-chat",
  );
});

test("selects the key that matches the configured endpoint", () => {
  assert.equal(resolveDeepSeekApiKey("https://api.deepseek.com/chat/completions", "direct", "router"), "direct");
  assert.equal(resolveDeepSeekApiKey("https://openrouter.ai/api/v1/chat/completions", "direct", "router"), "router");
});

test("throws DeepSeekError when no api key is configured", async () => {
  await assert.rejects(
    () => deepSeekChat({ apiKey: "", model: "m", system: "s", user: "u" }),
    DeepSeekError,
  );
});
