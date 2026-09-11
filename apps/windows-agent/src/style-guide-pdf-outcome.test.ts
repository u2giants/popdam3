import assert from "node:assert/strict";
import test from "node:test";
import { toStyleGuidePdfOutcome } from "./style-guide-pdf-outcome";

test("records extracted text with its method", () => {
  assert.deepEqual(toStyleGuidePdfOutcome({ extraction_method: "ocr_text", extracted_text: "searchable", page_count: 2, extraction_error: null }), {
    status: "extracted", extraction_method: "ocr_text", extracted_text: "searchable", page_count: 2, terminal_reason: null,
  });
});

test("records an explicit terminal skip reason", () => {
  assert.equal(toStyleGuidePdfOutcome({ extraction_method: "skipped", extracted_text: null, page_count: null, extraction_error: null }).terminal_reason, "File exceeds the bounded extraction size limit");
});

test("records a terminal failure when extraction produces no text", () => {
  const outcome = toStyleGuidePdfOutcome({ extraction_method: "failed", extracted_text: null, page_count: 1, extraction_error: "renderer failed" });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.terminal_reason, "renderer failed");
});
