import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRichPdfSystemPrompt,
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
