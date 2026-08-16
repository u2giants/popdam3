import test from "node:test";
import assert from "node:assert/strict";
import { buildStructuredOutputPlan, getModelCapabilities, resetCapabilityCacheForTests, type ModelCapabilities } from "./model-capabilities.js";

test("model capabilities merge live metadata and variant IDs with explicit overrides", async () => {
  resetCapabilityCacheForTests();
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: "vendor/model", architecture: { input_modalities: ["image"] }, supported_parameters: ["tools", "tool_choice", "structured_outputs", "response_format"] }] }), { status: 200 });
  try {
    const profile = await getModelCapabilities("key", "vendor/model:exacto", { "vendor/model": { tool_choice_modes: ["auto"] } });
    assert.equal(profile.imageInput, true); assert.equal(profile.source, "override"); assert.deepEqual(profile.toolChoiceModes, ["auto"]);
    assert.deepEqual(buildStructuredOutputPlan(profile), ["json_schema", "json_object", "tool_auto"]);
  } finally { globalThis.fetch = original; }
});

test("strategy never sends unsupported methods", () => {
  const base: ModelCapabilities = { modelId: "x", imageInput: true, tools: false, toolChoice: false, toolChoiceModes: [], structuredOutputs: true, jsonObject: false, source: "live", fetchedAt: new Date().toISOString() };
  assert.deepEqual(buildStructuredOutputPlan(base), ["json_schema"]);
  assert.deepEqual(buildStructuredOutputPlan({ ...base, tools: true, structuredOutputs: false, toolChoiceModes: ["required"] }), ["tool_required"]);
});
