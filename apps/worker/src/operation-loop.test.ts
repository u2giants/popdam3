import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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

test("style-group rebuild progress sums deletions and preserves the largest pre-delete total", () => {
  const progress = mergeProgress(
    "rebuild-style-groups",
    { groups_deleted: 200, total_groups_before_delete: 10_868 },
    { ok: true, done: false, groups_deleted: 200, total_groups_before_delete: 0 },
  );

  assert.equal(progress.groups_deleted, 400);
  assert.equal(progress.total_groups_before_delete, 10_868);
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

test("pre-submission thumbnail timeouts remain auto-resumable", () => {
  const reason = classifyError("Gemini thumbnail fetch timed out before submission");
  assert.equal(reason, "dependency_timeout");
  assert.ok(nextAutoResumeAt(reason, { status: "interrupted", auto_resume_attempts: 0 }));
});

test("vendored lease contract keeps ambiguity database-owned and phase changes receipt-protected", () => {
  const migration = readFileSync(new URL("../../../shared-db/supabase/migrations/20260824004025_popdam_terminal_external_job_clear.sql", import.meta.url), "utf8");
  assert.match(migration, /Only this function ever declares a submission ambiguous/);
  assert.match(migration, /v_in_phase[\s\S]*ambiguous_submission[\s\S]*phase_protected/);
  assert.match(migration, /v_token_ok[\s\S]*lease_token/);
});

test("pre-POST failures always keep the held receipt", async () => {
  const { holdReceiptAfterPreSubmissionFailure } = await import("./operation-loop.js");
  const { PreSubmissionError } = await import("./batch-submission-error.js");
  const { assertProviderSubmissionLeaseBudget } = await import("./batch-provider.js");
  assert.throws(() => assertProviderSubmissionLeaseBudget(new Date(Date.now() + 10_000).toISOString()), PreSubmissionError);
  const error = new PreSubmissionError("Provider batch preparation left insufficient submission lease time");
  const lease = new Date(Date.now() + 60_000).toISOString();
  const { rememberSubmissionReceipt, holdsSubmissionReceipt } = await import("./operation-loop.js");
  rememberSubmissionReceipt("op-pre", "receipt");
  // Nothing was sent, so the receipt is never given up, however many retries.
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal(holdReceiptAfterPreSubmissionFailure("op-pre", error, lease), true);
    assert.equal(holdsSubmissionReceipt("op-pre"), true);
  }
  assert.equal(classifyError("Style group thumbnail fetch temporarily failed before submission"), "dependency_timeout");
});

test("a provider POST whose ID save fails releases the receipt so no rebuild can resubmit", async () => {
  const { releaseReceiptAfterPost, holdsSubmissionReceipt, holdReceiptAfterPreSubmissionFailure, rememberSubmissionReceipt } = await import("./operation-loop.js");
  rememberSubmissionReceipt("op-post", "receipt");
  holdReceiptAfterPreSubmissionFailure("op-post", new Error("pre"), new Date(Date.now() + 60_000).toISOString());
  assert.equal(holdsSubmissionReceipt("op-post"), true, "pre-POST failure keeps the receipt");
  releaseReceiptAfterPost("op-post", new Date(Date.now() + 60_000).toISOString());
  assert.equal(holdsSubmissionReceipt("op-post"), false);
});
