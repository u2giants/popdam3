import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isStale, validateShortDescription, buildShortDescriptionMessages } from "./item-short-description.js";

describe("item short description", () => {
  it("trims and accepts a short label", () => {
    assert.equal(validateShortDescription({ short_description: '  "Snoopy Easter Plaque." ' }), "Snoopy Easter Plaque");
  });
  it("rejects empty or overlong output", () => {
    assert.throws(() => validateShortDescription({ short_description: "" }));
    assert.throws(() => validateShortDescription({ short_description: "x".repeat(41) }));
  });
  it("never treats a manual short description as stale", () => {
    assert.equal(isStale({ id: "a", item_description: "New", item_short_description_source: "manual", item_short_description_input: "Old" }), false);
  });
  it("is stale when the full description changed or was never shortened", () => {
    assert.equal(isStale({ id: "a", item_description: "New", item_short_description_source: "ai", item_short_description_input: "Old" }), true);
    assert.equal(isStale({ id: "a", item_description: "New", item_short_description_source: null, item_short_description_input: null }), true);
    assert.equal(isStale({ id: "a", item_description: "Same", item_short_description_source: "ai", item_short_description_input: "Same" }), false);
  });
  it("includes the full description in the prompt", () => {
    assert.match(JSON.stringify(buildShortDescriptionMessages("Peanuts MDF plaque")), /Peanuts MDF plaque/);
  });
});
