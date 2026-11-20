import assert from "node:assert/strict";
import test from "node:test";
import { deepSeekChat, DeepSeekError } from "./deepseek.js";

function stubFetch(status: number, body: unknown): { calls: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("posts to the DeepSeek direct endpoint when no baseUrl is given", async () => {
  const { calls, restore } = stubFetch(200, {
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
    assert.equal(result.content, '{"ok":true}');
    assert.equal(result.model, "deepseek-chat");
  } finally {
    restore();
  }
});

test("posts to the configured baseUrl when provided (OpenRouter routing)", async () => {
  const { calls, restore } = stubFetch(200, {
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: { total_tokens: 1 },
    model: "deepseek/deepseek-v4.1-flash-1017",
  });
  try {
    const result = await deepSeekChat({
      apiKey: "or-key",
      model: "deepseek/deepseek-v4.1-flash-1017",
      system: "prefix",
      user: "text",
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    });
    assert.deepEqual(calls, ["https://openrouter.ai/api/v1/chat/completions"]);
    assert.equal(result.model, "deepseek/deepseek-v4.1-flash-1017");
  } finally {
    restore();
  }
});

test("throws DeepSeekError when no api key is configured", async () => {
  await assert.rejects(
    () => deepSeekChat({ apiKey: "", model: "m", system: "s", user: "u" }),
    DeepSeekError,
  );
});
