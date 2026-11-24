import test from "node:test";
import assert from "node:assert/strict";
import { callAiVision, PDF_SIZE_LIMIT_BYTES, exceedsPdfSizeLimit } from "./pdf-text-sampler.js";

test("PDF size guard skips only files larger than 100 MB", () => {
  assert.equal(exceedsPdfSizeLimit(PDF_SIZE_LIMIT_BYTES), false);
  assert.equal(exceedsPdfSizeLimit(PDF_SIZE_LIMIT_BYTES + 1), true);
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

test("PopSG direct Meta selection uses its leased server route before OpenRouter", async () => {
  const page = Buffer.from("fixture");
  let received: Buffer | null = null;
  const config = { models: [], pdf_extraction: null, googleApiKey: "", anthropicApiKey: "", openRouterApiKey: "fixture-router-key",
    aiTaskModels: { pdf_extraction: "meta-direct/muse-spark-1.3-contributor" },
    directPdfVision: async (image: Buffer) => { received = image; return "literal fixture text"; } };
  assert.equal(await callAiVision(page, config), "literal fixture text");
  assert.equal(received, page);
  await assert.rejects(callAiVision(page, { ...config, directPdfVision: undefined }), /server-side content lease/);
});

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

test("ScaleDown truncation envelope is rejected instead of stored as page text", async () => {
  const page = Buffer.from("fixture");
  const originalFetch = globalThis.fetch;
  const config = { models: [], pdf_extraction: null, googleApiKey: "", anthropicApiKey: "",
    openRouterApiKey: "fixture-router-key", scaleDownApiKey: "fixture-scale-key",
    aiTaskModels: { pdf_extraction: "scaledown/summarize" } };
  const respondWith = (content: Record<string, unknown>) => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
      { status: 200 },
    )) as typeof fetch;
  };
  try {
    // Realistic truncation: a partial summary that arrives with finish_reason "length".
    respondWith({ finish_reason: "length", summary: "PARTIAL TEXT" });
    await assert.rejects(callAiVision(page, config), /token limit/);
    // An empty summary is still not page text.
    respondWith({ summary: "" });
    await assert.rejects(callAiVision(page, config), /no transcription text/);
    // An error envelope with text must not be indexed either.
    respondWith({ error: "rate limited", summary: "PARTIAL TEXT" });
    await assert.rejects(callAiVision(page, config), /error envelope/);
    // A healthy envelope still unwraps.
    respondWith({ summary: "transcribed page text" });
    assert.equal(await callAiVision(page, config), "transcribed page text");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
