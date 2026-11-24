import { setStraitlyApiKeyForTests } from "./provider-api-key.js";
import assert from "node:assert/strict";
import test from "node:test";
import { chatCompletion } from "./openrouter.js";
import { parseOpenAiRoute, setOpenAiRoutingLoaderForTests } from "./openai-route.js";

function capture(reply: Record<string, unknown>) {
  const calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), auth: headers.get("authorization") ?? "", body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const ok = { id: "x", model: "m", choices: [{ message: { content: "hi" } }] };

test("route defaults to direct; only 'openrouter' switches", () => {
  assert.equal(parseOpenAiRoute(undefined), "direct");
  assert.equal(parseOpenAiRoute("direct"), "direct");
  assert.equal(parseOpenAiRoute("openrouter"), "openrouter");
  assert.equal(parseOpenAiRoute({ value: "OpenRouter" }), "openrouter");
});

test("openai models go to api.openai.com by default", async () => {
  setOpenAiRoutingLoaderForTests(async () => ({ route: "direct", apiKey: "sk-direct" }));
  const f = capture(ok);
  try {
    const r = await chatCompletion("or-key", { model: "openai/gpt-6-luna", messages: [{ role: "user", content: "x" }], max_tokens: 50, provider: { only: ["a"] } });
    assert.equal(r.content, "hi");
    assert.equal(f.calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(f.calls[0].auth, "Bearer sk-direct");
    assert.equal(f.calls[0].body.model, "gpt-6-luna");
    assert.equal(f.calls[0].body.max_completion_tokens, 50);
    assert.equal("max_tokens" in f.calls[0].body, false);
    assert.equal("provider" in f.calls[0].body, false);
    assert.equal(f.calls.length, 1);
  } finally { f.restore(); setOpenAiRoutingLoaderForTests(null); }
});

test("switch set to openrouter keeps the OpenRouter path", async () => {
  setOpenAiRoutingLoaderForTests(async () => ({ route: "openrouter", apiKey: "sk-direct" }));
  const f = capture(ok);
  try {
    await chatCompletion("or-key", { model: "openai/gpt-6-luna", messages: [{ role: "user", content: "x" }] });
    assert.equal(f.calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(f.calls[0].auth, "Bearer or-key");
    assert.equal(f.calls[0].body.model, "openai/gpt-6-luna:exacto");
  } finally { f.restore(); setOpenAiRoutingLoaderForTests(null); }
});

test("non-openai models never consult the switch and go to Straitly", async () => {
  setOpenAiRoutingLoaderForTests(async () => { throw new Error("must not be read"); });
  setStraitlyApiKeyForTests("st-key");
  const f = capture(ok);
  try {
    await chatCompletion("or-key", { model: "z-ai/glm-5.3-flash", messages: [{ role: "user", content: "x" }], provider: { only: ["x"] } });
    assert.equal(f.calls[0].url, "https://api.straitly.ai/v1/chat/completions");
    assert.equal(f.calls[0].auth, "Bearer st-key");
    assert.equal(f.calls[0].body.model, "z-ai/glm-5.3-flash");
    assert.equal(f.calls[0].body.provider, undefined);
  } finally { f.restore(); setOpenAiRoutingLoaderForTests(null); setStraitlyApiKeyForTests(null); }
});

test("anthropic models stay on OpenRouter", async () => {
  const f = capture(ok);
  try {
    await chatCompletion("or-key", { model: "anthropic/claude-haiku-5-5", messages: [{ role: "user", content: "x" }] });
    assert.equal(f.calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  } finally { f.restore(); }
});

test("Straitly without a key fails instead of silently using OpenRouter", async () => {
  setStraitlyApiKeyForTests("");
  const f = capture(ok);
  try {
    await assert.rejects(chatCompletion("or-key", { model: "z-ai/glm-5.3-flash", messages: [{ role: "user", content: "x" }] }), /STRAITLY_API_KEY/);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); setStraitlyApiKeyForTests(null); }
});

test("direct mode without a key fails instead of silently using OpenRouter", async () => {
  setOpenAiRoutingLoaderForTests(async () => ({ route: "direct", apiKey: "" }));
  const f = capture(ok);
  try {
    await assert.rejects(chatCompletion("or-key", { model: "openai/gpt-6-luna", messages: [{ role: "user", content: "x" }] }), /OPENAI_API_KEY/);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); setOpenAiRoutingLoaderForTests(null); }
});

test("unsupported parameter is dropped once and retried", async () => {
  setOpenAiRoutingLoaderForTests(async () => ({ route: "direct", apiKey: "k" }));
  const original = globalThis.fetch; const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_i, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1
      ? new Response(JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0 with this model." } }), { status: 400 })
      : new Response(JSON.stringify(ok), { status: 200 });
  };
  try {
    await chatCompletion("or", { model: "openai/gpt-6-luna", messages: [{ role: "user", content: "x" }], temperature: 0 });
    assert.equal(bodies.length, 2);
    assert.equal("temperature" in bodies[1], false);
  } finally { globalThis.fetch = original; setOpenAiRoutingLoaderForTests(null); }
});
