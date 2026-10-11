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
