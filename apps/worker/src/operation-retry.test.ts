import assert from "node:assert/strict";
import test from "node:test";
import { getAiRetryPageSize, getAutoResumeDelayMs, isTransientInterruption, isValidAutoResumeCursor } from "./operation-retry.js";

const CURSOR = "ai1:2:123e4567-e89b-42d3-a456-426614174000";

test("auto-resume accepts only known AI string cursors", () => {
  assert.equal(isValidAutoResumeCursor("ai-tag-untagged", CURSOR), true);
  assert.equal(isValidAutoResumeCursor("ai-tag-all", "uuid-only"), false);
  // #630: erp-enrichment apply checkpoints a bare UUID keyset cursor over
  // api.plm_item_list.id; its statement-timeout interruptions must auto-resume.
  assert.equal(isValidAutoResumeCursor("erp-enrichment", "123e4567-e89b-42d3-a456-426614174000"), true);
  assert.equal(isValidAutoResumeCursor("erp-enrichment", CURSOR), false);
  assert.equal(isValidAutoResumeCursor("erp-enrichment", 10), true);
  assert.equal(isValidAutoResumeCursor("reprocess-metadata", "123e4567-e89b-42d3-a456-426614174000"), true);
  assert.equal(isValidAutoResumeCursor("reprocess-metadata", "not-a-uuid"), false);
});

test("backoff is bounded and jittered around the configured schedule", () => {
  assert.equal(getAutoResumeDelayMs(0, () => 0.5), 15_000);
  assert.equal(getAutoResumeDelayMs(1, () => 0.5), 30_000);
  assert.equal(getAutoResumeDelayMs(4, () => 0.5), 300_000);
  assert.equal(getAutoResumeDelayMs(99, () => 0.5), 300_000);
});

test("only transient interruption reasons retry", () => {
  assert.equal(isTransientInterruption("statement_timeout"), true);
  assert.equal(isTransientInterruption("dependency_timeout"), true);
  assert.equal(isTransientInterruption("connection_error"), true);
  assert.equal(isTransientInterruption("legacy_cursor"), false);
  assert.equal(isTransientInterruption("unknown"), false);
});

test("candidate timeout fallback keeps first retry full sized then reduces", () => {
  assert.equal(getAiRetryPageSize(50, 0), 50);
  assert.equal(getAiRetryPageSize(50, 1), 25);
  assert.equal(getAiRetryPageSize(50, 2), 10);
});

test("shorten-item-descriptions resumes from its style_groups.id cursor", () => {
  assert.equal(isValidAutoResumeCursor("shorten-item-descriptions", "03466df3-8f50-4c49-98d8-5525201c95a7"), true);
  assert.equal(isValidAutoResumeCursor("shorten-item-descriptions", "not-a-uuid"), false);
});

// Whole-library parallel tagging persists the same keyset cursor as ordinary AI
// tagging. Its interrupted checkpoint must resume without starting a new run.
test("parallel tagging resumes valid keysets and rejects malformed checkpoints", () => {
  assert.equal(isValidAutoResumeCursor("ai-tag-parallel", CURSOR), true);
  assert.equal(isValidAutoResumeCursor("ai-tag-parallel", "ai1:1:900529a4-0441-420c-aa2b-a59695eed750"), true);
  assert.equal(isValidAutoResumeCursor("ai-tag-parallel", "uuid-only"), false);
  assert.equal(isValidAutoResumeCursor("ai-tag-parallel", "ai1:-1:123e4567-e89b-42d3-a456-426614174000"), false);
  assert.equal(isValidAutoResumeCursor("ai-tag-parallel", undefined), false);
});
