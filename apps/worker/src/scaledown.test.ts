import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isScaleDownModel, normalizeScaleDownTagData } from "./scaledown.js";

describe("scaledown", () => {
  it("recognizes scaledown model ids", () => {
    assert.equal(isScaleDownModel("scaledown/summarize"), true);
    assert.equal(isScaleDownModel("openai/gpt-5"), false);
  });

  it("accepts string or object tags", () => {
    const out = normalizeScaleDownTagData({ ai_description: "Mickey pattern", asset_tags: ["mickey", { tag: "christmas" }, ""] });
    assert.deepEqual(out.asset_tags, [{ tag: "mickey" }, { tag: "christmas" }]);
  });

  it("rejects output without a description", () => {
    assert.throws(() => normalizeScaleDownTagData({ asset_tags: ["x"] }), /ai_description/);
  });
});
