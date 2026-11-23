import { test } from "node:test";
import assert from "node:assert/strict";
import { taggingImageUrl } from "./ai-tagging.js";

// popdam3#1272: taggers prefer the agent's hi-res rendition.
test("tagging prefers hires_url and falls back to thumbnail_url", () => {
  assert.equal(taggingImageUrl({ thumbnail_url: "t", hires_url: "h" }), "h");
  assert.equal(taggingImageUrl({ thumbnail_url: "t", hires_url: null }), "t");
  assert.equal(taggingImageUrl({ thumbnail_url: null }), null);
});
