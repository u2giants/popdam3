import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRichPdfSystemPrompt,
  normalizeMaterialList,
  parseRichPdfData,
  RICH_PDF_PROMPT_VERSION,
} from "./rich-pdf.js";

test("system prompt is stable and carries the schema + json instruction", () => {
  const a = buildRichPdfSystemPrompt();
  const b = buildRichPdfSystemPrompt();
  assert.equal(a, b, "prompt must be identical across calls (DeepSeek cache prefix)");
  assert.match(a, /source_files/);
  assert.match(a, /production_specs/);
  assert.match(a, /json object only/i, "must instruct json-only for DeepSeek JSON mode");
});

test("prompt version pinned", () => {
  assert.equal(RICH_PDF_PROMPT_VERSION, "rich-pdf-v1");
});

test("parses a clean JSON object", () => {
  const data = parseRichPdfData('{"style_guide_reference":"Encanto","colors":[{"pantone":"186 C"}]}');
  assert.equal(data.style_guide_reference, "Encanto");
});

test("tolerates ```json code fences", () => {
  const data = parseRichPdfData('```json\n{"season":"FW25"}\n```');
  assert.equal(data.season, "FW25");
});

test("salvages an object wrapped in stray prose", () => {
  const data = parseRichPdfData('Sure, here it is: {"retailer_program":"Target"} — hope that helps');
  assert.equal(data.retailer_program, "Target");
});

test("rejects non-object JSON", () => {
  assert.throws(() => parseRichPdfData("[1,2,3]"), /non-object/);
});

test("rejects unusable output", () => {
  assert.throws(() => parseRichPdfData("no json here"), /did not return JSON/);
});

test("normalizeMaterialList uppercases, trims, collapses ws, dedupes casing", () => {
  assert.deepEqual(
    normalizeMaterialList(["canvas", "Canvas", " CANVAS ", "MDF", "plain  canvas"]),
    ["CANVAS", "MDF", "PLAIN CANVAS"],
  );
});

test("normalizeMaterialList preserves distinct materials + drops junk", () => {
  assert.deepEqual(
    normalizeMaterialList(["MDF", "Glass", "glass", "", "  ", 42, null, "DIY Canvas"]),
    ["MDF", "GLASS", "DIY CANVAS"],
  );
});

test("normalizeMaterialList handles non-arrays", () => {
  assert.deepEqual(normalizeMaterialList(undefined), []);
  assert.deepEqual(normalizeMaterialList("canvas"), []);
});


test("failed rich PDF hashes retry only after the bounded cooldown", async () => {
  const { shouldExtractRichPdf } = await import("./rich-pdf.js");
  const now = Date.parse("2026-01-02T12:00:00Z");
  const success = { source_text_sha256: "same", parse_error: null, extracted_at: "2026-01-01T00:00:00Z" };
  const failure = { ...success, parse_error: "temporary provider outage" };
  assert.equal(shouldExtractRichPdf(success, "same", now), false);
  assert.equal(shouldExtractRichPdf(failure, "same", now), true);
  assert.equal(shouldExtractRichPdf({ ...failure, extracted_at: "2026-01-02T11:59:00Z" }, "same", now), false);
  assert.equal(shouldExtractRichPdf({ ...failure, extracted_at: "2026-01-03T00:00:00Z" }, "same", now), false);
  assert.equal(shouldExtractRichPdf({ ...failure, extracted_at: null }, "same", now), false);
  assert.equal(shouldExtractRichPdf({ ...failure, extracted_at: "invalid" }, "same", now), false);
  assert.equal(shouldExtractRichPdf(failure, "changed", now), true);
  assert.equal(shouldExtractRichPdf(undefined, "same", now), true);
  assert.equal(shouldExtractRichPdf(failure, "same", now, NaN), true);
  const recent = { ...failure, extracted_at: "2026-01-02T10:00:00Z" };
  assert.equal(shouldExtractRichPdf(recent, "same", now, NaN), false);
  assert.equal(shouldExtractRichPdf(recent, "same", now, 0), false);
  assert.equal(shouldExtractRichPdf(recent, "same", now, 1), true);
});
