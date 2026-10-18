import assert from "node:assert/strict";
import test from "node:test";
import { runningTagConflict } from "./operation-loop.js";
test("parallel tag conflict covers manual single retags in both directions", () => {
  assert.equal(runningTagConflict("ai-tag-parallel", ["ai-tag-single-123e4567-e89b-42d3-a456-426614174000"]), true);
  assert.equal(runningTagConflict("ai-tag-single-123e4567-e89b-42d3-a456-426614174000", ["ai-tag-parallel"]), true);
  assert.equal(runningTagConflict("ai-tag-parallel", ["ai-tag-all"]), true);
  assert.equal(runningTagConflict("ai-tag-parallel", ["rebuild-style-groups"]), true);
  assert.equal(runningTagConflict("ai-tag-parallel", ["ai-tag-bakeoff"]), false);
});
