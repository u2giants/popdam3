import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildResultMessage, classifyError, interruptionReason, isProtectedExternalJob, mergeProgress, nextAutoResumeAt, normalizeBatchError, scopeSingleAssetTag } from "./operation-loop.js";
import type { OpState } from "./types.js";

const ASSET_ID = "123e4567-e89b-42d3-a456-426614174000";

test("a live provider job is protected from being cleared; an idle one is not", () => {
  // Live phases the guarded writer refuses to drop (shared-db migration
  // 20260824004025 c_live_phases), a bound provider ID, and an ambiguity verdict.
  for (const phase of ["prepared", "submitting", "pending", "applying"]) {
    assert.equal(isProtectedExternalJob({ phase } as never), true, phase);
  }
  assert.equal(isProtectedExternalJob({ phase: "done", provider_batch_id: "batches/x" } as never), true);
  assert.equal(isProtectedExternalJob({ phase: "done", ambiguous_since: "2026-09-25T00:00:00Z" } as never), true);
  // Nothing to protect: no job, or an idle/terminal phase with no bound ID.
  assert.equal(isProtectedExternalJob(undefined), false);
  assert.equal(isProtectedExternalJob({} as never), false);
  assert.equal(isProtectedExternalJob({ phase: "done" } as never), false);
  assert.equal(isProtectedExternalJob({ phase: "prepared", provider_batch_id: "" } as never), true);
});

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

test("pre-POST failures keep the receipt only for a bounded number of retries that fit inside the lease", async () => {
  const { holdReceiptAfterPreSubmissionFailure, MAX_PRE_SUBMISSION_RETRIES, PRE_SUBMISSION_RETRY_MIN_LEASE_MS } = await import("./operation-loop.js");
  const { PreSubmissionError } = await import("./batch-submission-error.js");
  const { assertProviderSubmissionLeaseBudget } = await import("./batch-provider.js");
  assert.throws(() => assertProviderSubmissionLeaseBudget(new Date(Date.now() + 10_000).toISOString()), PreSubmissionError);
  // The claim grants a 120 s lease; retries must fit well inside it.
  assert.ok(PRE_SUBMISSION_RETRY_MIN_LEASE_MS < 120_000);
  assert.ok(MAX_PRE_SUBMISSION_RETRIES <= 5);
  const error = new PreSubmissionError("transient pre-POST failure");
  const lease = new Date(Date.now() + 110_000).toISOString();
  const { rememberSubmissionReceipt, holdsSubmissionReceipt } = await import("./operation-loop.js");
  rememberSubmissionReceipt("op-pre", "receipt");
  for (let attempt = 0; attempt < MAX_PRE_SUBMISSION_RETRIES; attempt++) {
    assert.equal(holdReceiptAfterPreSubmissionFailure("op-pre", error, lease), true);
    assert.equal(holdsSubmissionReceipt("op-pre"), true);
  }
  // Repeating past the bound, or a permanent failure, fails visibly instead.
  assert.equal(holdReceiptAfterPreSubmissionFailure("op-pre", error, lease), false);
  rememberSubmissionReceipt("op-perm", "receipt");
  assert.equal(holdReceiptAfterPreSubmissionFailure("op-perm", new PreSubmissionError("no usable requests", true), lease), false);
  assert.equal(classifyError("Style group thumbnail fetch temporarily failed before submission"), "dependency_timeout");
});

test("a pre-POST failure with too little lease left takes the not_submitted reset instead of retrying", async () => {
  const { holdReceiptAfterPreSubmissionFailure, rememberSubmissionReceipt, holdsSubmissionReceipt, leaseCoversAnotherAttempt, remainingLeaseMs, PRE_SUBMISSION_RETRY_MIN_LEASE_MS } = await import("./operation-loop.js");
  const { PreSubmissionError } = await import("./batch-submission-error.js");
  const now = Date.parse("2026-09-25T12:00:00Z");
  const short = new Date(now + PRE_SUBMISSION_RETRY_MIN_LEASE_MS - 1).toISOString();
  rememberSubmissionReceipt("op-short", "receipt");
  assert.equal(holdReceiptAfterPreSubmissionFailure("op-short", new PreSubmissionError("transient"), short, now), false);
  assert.equal(holdsSubmissionReceipt("op-short"), true, "the receipt is kept for the governed reset, never dropped first");
  assert.equal(leaseCoversAnotherAttempt(new Date(now + PRE_SUBMISSION_RETRY_MIN_LEASE_MS).toISOString(), now), true);
  assert.equal(leaseCoversAnotherAttempt(undefined, now), false);
  assert.equal(remainingLeaseMs(new Date(now - 1).toISOString(), now), 0);
});

test("provider retry backoff stays strictly below the stale-run guard and waits heartbeat", async () => {
  const { STALE_RUN_MS, WAIT_HEARTBEAT_MS, needsWaitHeartbeat } = await import("./operation-loop.js");
  const { MAX_PROVIDER_RETRY_DELAY_MS, transientPollDelayMs } = await import("./handlers/ai-tagging-batch-state.js");
  assert.ok(MAX_PROVIDER_RETRY_DELAY_MS < STALE_RUN_MS);
  for (let failures = 0; failures < 60; failures++) assert.ok(transientPollDelayMs(failures) < STALE_RUN_MS);
  assert.ok(WAIT_HEARTBEAT_MS < STALE_RUN_MS);
  const now = Date.parse("2026-09-25T12:00:00Z");
  const running = (ageMs: number) => ({ status: "running", updated_at: new Date(now - ageMs).toISOString() }) as OpState;
  assert.equal(needsWaitHeartbeat(running(30_000), now), false);
  assert.equal(needsWaitHeartbeat(running(WAIT_HEARTBEAT_MS), now), true);
  assert.equal(needsWaitHeartbeat({ status: "interrupted", updated_at: new Date(now - STALE_RUN_MS).toISOString() } as OpState, now), false);
});

test("image-unusable per-item failures are counted but never trip the failure kill switch", async () => {
  const { detectFailureKillSwitch } = await import("./operation-loop.js");
  const at = new Date().toISOString();
  const unusable = Array.from({ length: 60 }, () => ({ at, error: "Image unusable for visual analysis: no thumbnail", reason_category: "image_unusable" }));
  let progress: Record<string, unknown> = {};
  progress = mergeProgress("ai-tag-untagged", progress, { ok: true, done: false, failed: 60, image_unusable: 60, failure_samples: unusable });
  assert.equal(progress.failed, 60);
  assert.equal(progress.image_unusable, 60);
  assert.equal(detectFailureKillSwitch(progress), null);
  const real = Array.from({ length: 20 }, () => ({ at, error: "DB write failed: boom" }));
  progress = mergeProgress("ai-tag-untagged", progress, { ok: true, done: false, failed: 20, failure_samples: real });
  assert.match(detectFailureKillSwitch(progress) ?? "", /same error/);
  const groups = mergeProgress("ai-tag-group-profiles", {}, { ok: true, done: false, failed: 2, image_unusable: 2 });
  assert.equal(groups.image_unusable, 2);
});

test("a provider POST whose ID save fails releases the receipt so no rebuild can resubmit", async () => {
  const { releaseReceiptAfterPost, holdsSubmissionReceipt, holdReceiptAfterPreSubmissionFailure, rememberSubmissionReceipt } = await import("./operation-loop.js");
  rememberSubmissionReceipt("op-post", "receipt");
  holdReceiptAfterPreSubmissionFailure("op-post", new Error("pre"), new Date(Date.now() + 110_000).toISOString());
  assert.equal(holdsSubmissionReceipt("op-post"), true, "pre-POST failure keeps the receipt");
  releaseReceiptAfterPost("op-post", new Date(Date.now() + 60_000).toISOString());
  assert.equal(holdsSubmissionReceipt("op-post"), false);
});

test("a temporarily failing not_submitted reset keeps the receipt and lands on retry", async () => {
  const { failNeverSentSubmission, rememberSubmissionReceipt, holdsSubmissionReceipt, awaitsNotSubmittedReset } = await import("./operation-loop.js");
  const lease = new Date(Date.now() + 100_000).toISOString();
  const state = {
    status: "running", cursor: 0, run_id: "r1", state_revision: 4,
    external_job: { phase: "submitting", submission_owner: "railway:r1", lease_expires_at: lease },
  } as unknown as OpState;
  let resetCalls = 0;
  const calls: string[] = [];
  const rpc = async (fn: string) => {
    calls.push(fn);
    if (fn === "reset_bulk_operation_submission_lease") {
      resetCalls++;
      if (resetCalls === 1) return { data: null, error: { message: "upstream connect error" } };
      return { data: { ok: true, state_revision: 5, lease_receipt_issued: false, operation: { status: "running", cursor: 0, external_job: { phase: "prepared" } } }, error: null };
    }
    return { data: { ok: true, state_revision: 6, lease_receipt_issued: false, reason: "applied" }, error: null };
  };
  rememberSubmissionReceipt("op-reset", "receipt-1");
  await assert.rejects(failNeverSentSubmission("op-reset", state, 4, "railway:r1", "receipt-1", new Error("no usable requests"), rpc), /upstream connect error/);
  assert.equal(holdsSubmissionReceipt("op-reset"), true, "a transient reset failure never discards the only receipt");
  assert.equal(awaitsNotSubmittedReset("op-reset"), true, "the next tick retries the reset");
  await failNeverSentSubmission("op-reset", state, 4, "railway:r1", "receipt-1", new Error("no usable requests"), rpc);
  assert.equal(holdsSubmissionReceipt("op-reset"), false);
  assert.equal(awaitsNotSubmittedReset("op-reset"), false);
  assert.deepEqual(calls, ["reset_bulk_operation_submission_lease", "reset_bulk_operation_submission_lease", "update_bulk_operation"]);
});

test("a reset attempted after the lease lapsed releases the receipt to lease reconciliation", async () => {
  const { failNeverSentSubmission, rememberSubmissionReceipt, holdsSubmissionReceipt, awaitsNotSubmittedReset } = await import("./operation-loop.js");
  const state = {
    status: "running", cursor: 0, state_revision: 4,
    external_job: { phase: "submitting", lease_expires_at: new Date(Date.now() - 1_000).toISOString() },
  } as unknown as OpState;
  rememberSubmissionReceipt("op-lapsed", "receipt-1");
  const rpc = async () => ({ data: null, error: { message: "receipt_invalid" } });
  await assert.rejects(failNeverSentSubmission("op-lapsed", state, 4, "railway:r1", "receipt-1", new Error("x"), rpc));
  assert.equal(holdsSubmissionReceipt("op-lapsed"), false);
  assert.equal(awaitsNotSubmittedReset("op-lapsed"), false);
});
