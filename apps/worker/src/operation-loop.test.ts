import assert from "node:assert/strict";
import test from "node:test";
import { buildResultMessage, classifyError, interruptionReason, mergeProgress, nextAutoResumeAt, normalizeBatchError, scopeSingleAssetTag } from "./operation-loop.js";

const ASSET_ID = "123e4567-e89b-42d3-a456-426614174000";

test("single-asset operation derives its scope from the operation key", () => {
  const scoped = scopeSingleAssetTag(`ai-tag-single-${ASSET_ID}`, { status: "running" });

  assert.deepEqual(scoped?.params?.asset_ids, [ASSET_ID]);
});

test("single-asset operation key remains authoritative when params disagree", () => {
  const scoped = scopeSingleAssetTag(`ai-tag-single-${ASSET_ID}`, {
    status: "running",
    params: { asset_ids: ["223e4567-e89b-42d3-a456-426614174001"] },
  });

  assert.deepEqual(scoped?.params?.asset_ids, [ASSET_ID]);
});

test("malformed single-asset operation keys are rejected", () => {
  assert.equal(scopeSingleAssetTag("ai-tag-single-not-a-uuid", { status: "running" }), null);
});

test("AI progress persists and reports visual-analysis-unavailable outcomes", () => {
  const progress = mergeProgress(
    "ai-tag-all",
    { tagged: 2, visual_analysis_unavailable: 1 },
    { ok: true, done: false, tagged: 3, visual_analysis_unavailable: 2 },
  );

  assert.equal(progress.tagged, 5);
  assert.equal(progress.visual_analysis_unavailable, 3);
  assert.match(buildResultMessage("ai-tag-all", progress), /3 visual analyses unavailable/);
});

test("blank handler errors are made explicit and are not classified as unknown", () => {
  const error = normalizeBatchError("   ");

  assert.equal(error, "Batch failed (handler supplied no message)");
  assert.equal(classifyError(error), "missing_error_message");
});

test("Postgres timeout codes classify even when the database message is blank", () => {
  const reason = interruptionReason({ ok: false, done: false, error: "code=57014" });

  assert.equal(reason, "statement_timeout");
  assert.ok(nextAutoResumeAt(reason, { status: "interrupted", auto_resume_attempts: 0 }));
});

test("configuration reads fail into a resumable dependency timeout", () => {
  const reason = classifyError("AI task model config read timed out after 10000ms");

  assert.equal(reason, "dependency_timeout");
  assert.ok(nextAutoResumeAt(reason, { status: "interrupted", auto_resume_attempts: 0 }));
});
