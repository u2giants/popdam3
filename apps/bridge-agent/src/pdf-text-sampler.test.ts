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

test("ScaleDown truncation is an error, not a transcription", async () => {
  const page = Buffer.from("fixture");
  const originalFetch = globalThis.fetch;
  const config = { models: [], pdf_extraction: null, googleApiKey: "", anthropicApiKey: "",
    openRouterApiKey: "fixture-router-key", scaleDownApiKey: "fixture-scale-key",
    aiTaskModels: { pdf_extraction: "scaledown/summarize" } };
  const respondWith = (payload: Record<string, unknown>) => {
    globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
  };
  try {
    // Truncation reported by the API itself.
    respondWith({ choices: [{ finish_reason: "length", message: { content: "partial page text" } }] });
    await assert.rejects(callAiVision(page, config), /token limit/);
    // Truncation reported inside the envelope, alongside a partial summary.
    respondWith({ choices: [{ message: { content: JSON.stringify({ finish_reason: "length", summary: "PARTIAL TEXT" }) } }] });
    await assert.rejects(callAiVision(page, config), /token limit/);
    // An envelope with no text at all.
    respondWith({ choices: [{ message: { content: JSON.stringify({ summary: "" }) } }] });
    await assert.rejects(callAiVision(page, config), /no transcription text/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI selection uses the configured route and requires its key for direct calls", async (t) => {
  const page = Buffer.from("fixture");
  const calls: Array<{ url: string; model: string; authorization: string | null }> = [];
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      model: JSON.parse(String(init?.body)).model,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return new Response(JSON.stringify({ choices: [{ message: { content: "fixture transcription" } }] }));
  });

  const config = { models: [], pdf_extraction: null, googleApiKey: "", anthropicApiKey: "",
    openAiApiKey: "fixture-openai-key", openRouterApiKey: "fixture-router-key",
    aiTaskModels: { pdf_extraction: "openai/gpt-6-luna" } };
  assert.equal(await callAiVision(page, config), "fixture transcription");
  assert.equal(await callAiVision(page, { ...config, openAiRoute: "direct" }), "fixture transcription");
  assert.equal(await callAiVision(page, { ...config, openAiRoute: "openrouter" }), "fixture transcription");
  await assert.rejects(callAiVision(page, { ...config, openAiApiKey: undefined }), /OPENAI_API_KEY/);

  const directRequest = {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-6-luna",
    authorization: "Bearer fixture-openai-key",
  };
  assert.deepEqual(calls, [directRequest, directRequest, {
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "openai/gpt-6-luna",
    authorization: "Bearer fixture-router-key",
  }]);
});

test("a meta-direct selection fails closed instead of reaching OpenRouter", async () => {
  const page = Buffer.from("fixture");
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ choices: [{ message: { content: "should never be used" } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const config = { models: [], pdf_extraction: null, googleApiKey: "", anthropicApiKey: "",
      openRouterApiKey: "fixture-router-key",
      aiTaskModels: { pdf_extraction: "meta-direct/some-model" } };
    await assert.rejects(callAiVision(page, config), /Windows agent/);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
