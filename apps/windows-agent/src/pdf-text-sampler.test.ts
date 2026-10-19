import test from "node:test";
import assert from "node:assert/strict";
import { callAiVision, PDF_SIZE_LIMIT_BYTES, exceedsPdfSizeLimit } from "./pdf-text-sampler.js";

test("PDF size guard skips only files larger than 100 MB", () => {
  assert.equal(exceedsPdfSizeLimit(PDF_SIZE_LIMIT_BYTES), false);
  assert.equal(exceedsPdfSizeLimit(PDF_SIZE_LIMIT_BYTES + 1), true);
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
