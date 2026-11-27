import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRichPdfSystemPrompt,
  normalizeMaterialList,
  parseRichPdfData,
  richPdfSourceKey,
  RICH_PDF_PROMPT_VERSION,
  splitMainMaterials,
  batchOverdue,
  messageText,
  richPdfRequestParams,
  RICH_PDF_MODEL,
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
  assert.equal(RICH_PDF_PROMPT_VERSION, "rich-pdf-v2");
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

test("main material keeps the body and moves call-outs aside (HSR57PNUT04 sheet)", () => {
  const r = splitMainMaterials(
    ["Sawtooth hanger", "•", "backing board", "paper print", "insert", "glass covering", "MDF frame"],
    [],
  );
  assert.deepEqual(r.materials, ["PAPER PRINT", "MDF FRAME"]);
  assert.deepEqual(r.component_materials, ["SAWTOOTH HANGER", "BACKING BOARD", "INSERT", "GLASS COVERING"]);
});

test("main material leaves real body materials alone", () => {
  const r = splitMainMaterials(["100% woven cotton blend"], ["hanging rope", "wooden dowel rod"]);
  assert.deepEqual(r.materials, ["100% WOVEN COTTON BLEND"]);
  assert.deepEqual(r.component_materials, ["HANGING ROPE", "WOODEN DOWEL ROD"]);
});

test("source key changes with the prompt version so old reads are redone once", () => {
  assert.notEqual(richPdfSourceKey("abc", "rich-pdf-v1"), richPdfSourceKey("abc", "rich-pdf-v2"));
  assert.equal(richPdfSourceKey("abc"), richPdfSourceKey("abc"));
});

test("prompt separates main material from component call-outs", () => {
  const p = buildRichPdfSystemPrompt();
  assert.match(p, /component_materials/);
  assert.match(p, /ONLY the main body material/);
});

test("reads with Claude Haiku 5.5 at low effort", () => {
  const p = richPdfRequestParams("x") as any;
  assert.equal(RICH_PDF_MODEL, "claude-haiku-5-5");
  assert.equal(p.model, "claude-haiku-5-5");
  assert.deepEqual(p.output_config, { effort: "low" });
  assert.equal(p.system, buildRichPdfSystemPrompt());
});

test("a batch is abandoned for direct reads after 30 minutes", () => {
  const now = Date.parse("2026-11-27T20:00:00Z");
  assert.equal(batchOverdue({ submitted_at: "2026-11-27T19:31:00Z" }, now), false);
  assert.equal(batchOverdue({ submitted_at: "2026-11-27T19:30:00Z" }, now), true);
  assert.equal(batchOverdue({ submitted_at: "not a date" }, now), true);
});

test("refusals and cut-off replies are failures, not data", () => {
  assert.throws(() => messageText({ stop_reason: "refusal", content: [] } as any), /refused/);
  assert.throws(() => messageText({ stop_reason: "max_tokens", content: [] } as any), /cut off/);
  assert.equal(messageText({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] } as any), "{}");
});
