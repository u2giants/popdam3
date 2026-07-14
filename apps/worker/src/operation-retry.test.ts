import assert from "node:assert/strict";
import test from "node:test";
import { getAiRetryPageSize, getAutoResumeDelayMs, isTransientInterruption, isValidAutoResumeCursor } from "./operation-retry.js";

const CURSOR = "ai1:2:123e4567-e89b-42d3-a456-426614174000";

test("auto-resume accepts only known AI string cursors", () => {
  assert.equal(isValidAutoResumeCursor("ai-tag-untagged", CURSOR), true);
  assert.equal(isValidAutoResumeCursor("ai-tag-all", "uuid-only"), false);
  assert.equal(isValidAutoResumeCursor("erp-enrichment", CURSOR), false);
  assert.equal(isValidAutoResumeCursor("erp-enrichment", 10), true);
});

test("backoff is bounded and jittered around the configured schedule", () => {
  assert.equal(getAutoResumeDelayMs(0, () => 0.5), 15_000);
  assert.equal(getAutoResumeDelayMs(1, () => 0.5), 30_000);
  assert.equal(getAutoResumeDelayMs(4, () => 0.5), 300_000);
  assert.equal(getAutoResumeDelayMs(99, () => 0.5), 300_000);
});

test("only transient interruption reasons retry", () => {
  assert.equal(isTransientInterruption("statement_timeout"), true);
  assert.equal(isTransientInterruption("connection_error"), true);
  assert.equal(isTransientInterruption("legacy_cursor"), false);
  assert.equal(isTransientInterruption("unknown"), false);
});

test("candidate timeout fallback keeps first retry full sized then reduces", () => {
  assert.equal(getAiRetryPageSize(50, 0), 50);
  assert.equal(getAiRetryPageSize(50, 1), 25);
  assert.equal(getAiRetryPageSize(50, 2), 10);
});
