import test from "node:test";
import assert from "node:assert/strict";
import { validateTagAssetData, isRetryableTagTransportError } from "./ai-tagging-shared.js";
import { executeStructuredOutput } from "../structured-output.js";

function valid() {
  return { asset_tags: ["red", "blue", "green", "yellow"].map(tag => ({ tag, category: "color", confidence: 0.9, evidence: ["Visible color"] })), ai_description: "Four colors", scene_description: "Four colored areas", content_type: "other" };
}

test("nullable database enums reject invented and string-null values before any save", () => {
  for (const field of ["art_source", "asset_type"]) {
    for (const value of ["null", "invented", 42]) assert.throws(() => validateTagAssetData({ ...valid(), [field]: value }, "structured"), new RegExp(field));
    assert.doesNotThrow(() => validateTagAssetData({ ...valid(), [field]: null }, "structured"));
  }
  assert.doesNotThrow(() => validateTagAssetData(valid(), "structured"));
});

test("invalid confidence and missing evidence are rejected rather than fabricated", () => {
  for (const confidence of [NaN, Infinity, 90, -1]) {
    const data = valid(); data.asset_tags[0].confidence = confidence;
    assert.throws(() => validateTagAssetData(data, "structured"), /confidence/);
  }
  const data = valid(); data.asset_tags[0].evidence = [];
  assert.throws(() => validateTagAssetData(data, "structured"), /evidence/);
});

test("Meta transport timeout ends the output ladder immediately without repair or alternate modes", async () => {
  let calls = 0;
  const error = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  await assert.rejects(executeStructuredOutput({
    apiKey: "key", model: "meta-direct/muse-spark-1.3-contributor", messages: [], schemaName: "tag_asset", schema: {}, validate: value => value,
    capabilities: { modelId: "meta-direct/muse-spark-1.3-contributor", imageInput: true, tools: true, toolChoice: true, toolChoiceModes: ["auto"], structuredOutputs: true, jsonObject: true, prefer: [], source: "override", fetchedAt: "test" },
    isTerminalError: isRetryableTagTransportError,
    completion: async () => { calls++; throw error; },
  }), error);
  assert.equal(calls, 1);
  assert.equal(isRetryableTagTransportError(new Error("fetch failed")), true);
  assert.equal(isRetryableTagTransportError(new Error("invalid art_source")), false);
});
