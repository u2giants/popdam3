import test from "node:test";
import assert from "node:assert/strict";

// The sampler's import chain loads the agent config, which refuses to load
// without a server URL. Fixture it before the dynamic import; static imports
// would run first and fail.
process.env.POPDAM_SERVER_URL ??= "https://fixture.supabase.co";

const { callAiVision } = await import("./pdf-text-sampler.js");

test("ScaleDown selection calls ScaleDown instead of OpenRouter and unwraps the summary envelope", async () => {
  const page = Buffer.from("fixture");
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "transcribed page text" }) } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const config = { models: [], pdf_extraction: null, googleApiKey: "", anthropicApiKey: "",
      openRouterApiKey: "fixture-router-key", scaleDownApiKey: "fixture-scale-key",
      aiTaskModels: { pdf_extraction: "scaledown/summarize" } };
    assert.equal(await callAiVision(page, config), "transcribed page text");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /api\.scaledown\.xyz/);
    assert.equal(calls[0].body.model, "summarize");
    assert.equal(typeof calls[0].body.document, "string");
    await assert.rejects(callAiVision(page, { ...config, scaleDownApiKey: undefined }), /SCALEDOWN_API_KEY/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a non-ScaleDown selection still routes through OpenRouter when its key is saved", async () => {
  const page = Buffer.from("fixture");
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ choices: [{ message: { content: "openrouter transcription" } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const config = { models: [], pdf_extraction: null, googleApiKey: "", anthropicApiKey: "",
      openRouterApiKey: "fixture-router-key",
      aiTaskModels: { pdf_extraction: "openai/gpt-6-luna" } };
    assert.equal(await callAiVision(page, config), "openrouter transcription");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /openrouter\.ai/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
