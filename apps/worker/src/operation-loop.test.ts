import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildResultMessage, classifyError, interruptionReason, mergeProgress, nextAutoResumeAt, normalizeBatchError, normalizeProviderSubmissionError, resetDefinitivelyRejectedSubmission, scopeSingleAssetTag } from "./operation-loop.js";
import { DefinitiveBatchSubmissionError } from "./batch-submission-error.js";
import { OpenRouterError } from "./openrouter.js";

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

test("definitive rejection resets only a live matching receipt and refuses a reminted receipt", async () => {
  const evidence = new DefinitiveBatchSubmissionError("Gemini", 422, { message: "invalid field" });
  const state = {
    status: "running" as const,
    external_job: { phase: "submitting" as const, submission_owner: "railway:run", lease_expires_at: new Date(Date.now() + 60000).toISOString(), items: [] },
  };
  let calls = 0;
  const invoke = async (params: Record<string, unknown>) => {
    calls++;
    assert.equal(params.p_expected_revision, 7);
    assert.equal(params.p_submission_owner, "railway:run");
    assert.equal(params.p_lease_token, "receipt");
    assert.equal(params.p_http_status, 422);
    assert.deepEqual(params.p_provider_error, { message: "invalid field" });
    return { data: { ok: true, reason: "provider_definitive_rejection", state_revision: 8, lease_receipt_issued: false, lease_token: null, operation: { external_job: { phase: "prepared" } } }, error: null };
  };
  assert.equal(await resetDefinitivelyRejectedSubmission("ai-tag-all", state, "railway:run", "receipt", 7, evidence, invoke), true);
  assert.equal(await resetDefinitivelyRejectedSubmission("ai-tag-all", state, "wrong", "receipt", 7, evidence, invoke), false);
  assert.equal(await resetDefinitivelyRejectedSubmission("ai-tag-all", { ...state, external_job: { ...state.external_job, lease_expires_at: new Date(Date.now() - 1).toISOString() } }, "railway:run", "receipt", 7, evidence, invoke), false);
  assert.equal(calls, 1);
  assert.equal(await resetDefinitivelyRejectedSubmission("ai-tag-all", state, "railway:run", "receipt", 7, evidence,
    async () => ({ data: { ok: true, reason: "provider_definitive_rejection", state_revision: 8, lease_receipt_issued: true, lease_token: "new", operation: { external_job: { phase: "prepared" } } }, error: null })), false);
});

test("OpenRouter submission bodies are redacted before operation persistence or logs", () => {
  const message = normalizeProviderSubmissionError(new OpenRouterError(400, "private prompt https://signed.example/key=secret"));
  assert.equal(message, "OpenRouter batch submission failed (HTTP 400)");
  assert.doesNotMatch(message, /private prompt|signed\.example|secret/);
});
