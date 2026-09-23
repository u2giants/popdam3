import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { classifySubmissionHttpFailure, DefinitiveBatchRejectionError } from "./batch-submission-error.js";
import { awaitsDefinitiveRejectionFailure, failOperationAfterDefinitiveRejection, persistDefinitiveRejectionFailure, type RpcCall } from "./provider-submission-recovery.js";
import { providerJobErrorState } from "./operation-loop.js";

const MIGRATION = new URL(
  "../../../shared-db/supabase/migrations/20260923040630_popdam_definitive_rejection_lease_reset.sql",
  import.meta.url,
);
const md5 = (value: string) => createHash("md5").update(value).digest("hex");
const AMBIGUITY_MARKERS = ["ambiguous_since", "ambiguous_reason", "ambiguous_prior_phase", "ambiguous_prior_owner"];

/**
 * In-memory BULK_OPERATIONS row that mirrors the governed SQL contracts:
 * reset_bulk_operation_submission_lease exactly as written in shared-db #3418,
 * and the revision/status guard of update_bulk_operation's guarded path.
 */
function fakeDatabase(initial: Record<string, Record<string, unknown>>, nowMs = Date.parse("2026-09-23T12:00:00Z")) {
  const operations: Record<string, Record<string, unknown>> = structuredClone(initial);
  const calls: string[] = [];
  const rpc: RpcCall = async (fn, params) => {
    calls.push(fn);
    if (fn === "reset_bulk_operation_submission_lease") {
      const p = params as Record<string, unknown>;
      if (!p.p_op_key || typeof p.p_expected_revision !== "number" || !p.p_submission_owner || !p.p_lease_token) {
        return { data: null, error: { message: "22023 key, current revision, owner and receipt are required" } };
      }
      const providerError = p.p_provider_error;
      if (p.p_reason !== "provider_definitive_rejection" || ![400, 422].includes(p.p_http_status as number)
        || !providerError || typeof providerError !== "object" || Array.isArray(providerError)
        || Object.keys(providerError).length === 0) {
        return { data: null, error: { message: "22023 parsed definitive 4xx rejection evidence is required" } };
      }
      const op = operations[p.p_op_key as string];
      const job = op?.external_job as Record<string, unknown> | undefined;
      const revision = Number(op?.state_revision ?? 0);
      const leaseExpires = job?.lease_expires_at ? Date.parse(String(job.lease_expires_at)) : Number.NaN;
      if (!op || !job || revision !== p.p_expected_revision || op.status !== "running"
        || job.phase !== "submitting" || job.provider_batch_id
        || job.submission_owner !== p.p_submission_owner
        || !Number.isFinite(leaseExpires) || leaseExpires <= nowMs
        || job.lease_proof !== md5(String(p.p_lease_token))
        || AMBIGUITY_MARKERS.some((marker) => marker in job)) {
        return { data: null, error: { message: "55000 current live unbound submission receipt was not proven" } };
      }
      const resetJob: Record<string, unknown> = { ...job };
      for (const key of ["submission_owner", "lease_expires_at", "lease_claimed_at", "lease_proof", "lease_token", "submitted_at", "next_poll_at"]) {
        delete resetJob[key];
      }
      Object.assign(resetJob, {
        phase: "prepared",
        last_definitive_rejection_status: p.p_http_status,
        last_definitive_rejection_at: new Date(nowMs).toISOString(),
      });
      const resetOperation = { ...op, external_job: resetJob, state_revision: revision + 1 };
      operations[p.p_op_key as string] = resetOperation;
      return {
        data: { ok: true, reason: "provider_definitive_rejection", op_key: p.p_op_key, state_revision: revision + 1, lease_receipt_issued: false, lease_token: null, operation: structuredClone(resetOperation) },
        error: null,
      };
    }
    if (fn === "update_bulk_operation") {
      const p = params as Record<string, unknown>;
      const op = operations[p.p_op_key as string];
      const revision = Number(op?.state_revision ?? 0);
      const envelope = (ok: boolean, reason: string, rev: number) => ({
        data: { ok, reason, state_revision: rev, submission_owner: null, lease_expires_at: null, lease_token: null, lease_receipt_issued: false },
        error: null,
      });
      if (!op || revision !== p.p_expected_revision) return envelope(false, "revision_conflict", revision);
      if (p.p_only_if_status === "running" && op.status !== "running") return envelope(false, "not_running", revision);
      const offered = p.p_op_state as Record<string, unknown>;
      if (JSON.stringify(offered.external_job) !== JSON.stringify(op.external_job)) return envelope(false, "external_job_protected", revision);
      operations[p.p_op_key as string] = { ...offered, state_revision: revision + 1 };
      return envelope(true, "applied", revision + 1);
    }
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  };
  return { rpc, operations, calls };
}

function claimedOperation(token = "receipt-1") {
  return {
    ai_tag: {
      status: "running",
      state_revision: 7,
      external_job: {
        provider: "google-gemini",
        phase: "submitting",
        submission_owner: "railway:run-1",
        lease_claimed_at: "2026-09-23T11:59:30Z",
        lease_expires_at: "2026-09-23T12:01:30Z",
        lease_proof: md5(token),
        items: [{ custom_id: "a1", asset_id: "a1" }],
      },
    },
  };
}

const receipt = { opKey: "ai_tag", expectedRevision: 7, submissionOwner: "railway:run-1", leaseToken: "receipt-1" };
const rejection = () => classifySubmissionHttpFailure(
  "google-gemini", 400, JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "secret prompt" } }),
) as DefinitiveBatchRejectionError;

test("vendored shared-db migration still carries the reset contract this worker calls", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  assert.match(sql, /reset_bulk_operation_submission_lease\(\s*p_op_key text,\s*p_expected_revision bigint,\s*p_submission_owner text,\s*p_lease_token text,\s*p_reason text,\s*p_http_status integer,\s*p_provider_error jsonb/);
  assert.match(sql, /p_reason is distinct from 'provider_definitive_rejection'/);
  assert.match(sql, /p_http_status <> all\(array\[400, 422\]\)/);
  assert.match(sql, /lease_proof', ''\) is distinct from md5\(p_lease_token\)/);
  assert.match(sql, /'phase', 'prepared'/);
  assert.match(sql, /'lease_receipt_issued', false/);
});

test("definitive rejection consumes the receipt and fails the operation durably, once", async () => {
  const database = fakeDatabase(claimedOperation());
  const outcome = await failOperationAfterDefinitiveRejection(database.rpc, receipt, rejection(), () => "2026-09-23T12:00:01Z");
  assert.deepEqual(database.calls, ["reset_bulk_operation_submission_lease", "update_bulk_operation"]);
  const stored = database.operations.ai_tag;
  assert.equal(stored.status, "failed");
  assert.equal(stored.state_revision, 9);
  assert.equal(outcome.stateRevision, 9);
  assert.equal(stored.interruption_reason_code, "provider_definitive_rejection");
  assert.equal(stored.next_auto_resume_at, undefined);
  const job = stored.external_job as Record<string, unknown>;
  assert.equal(job.phase, "prepared");
  for (const key of ["lease_proof", "submission_owner", "lease_expires_at", "lease_token"]) assert.equal(key in job, false);
  assert.doesNotMatch(JSON.stringify(stored), /secret prompt/);

  // Replaying the same receipt (duplicate tick/restart) is refused by the DB.
  await assert.rejects(failOperationAfterDefinitiveRejection(database.rpc, receipt, rejection()), /receipt was not proven/);
  assert.equal(database.operations.ai_tag.state_revision, 9);
});

test("reset is refused for a wrong receipt, stale revision, expired lease, bound ID or ambiguity", async () => {
  const variants: Array<[string, (op: Record<string, unknown>) => void, Partial<typeof receipt>]> = [
    ["wrong receipt", () => {}, { leaseToken: "someone-else" }],
    ["wrong owner", () => {}, { submissionOwner: "railway:run-2" }],
    ["stale revision", () => {}, { expectedRevision: 6 }],
    ["expired lease", (op) => { (op.external_job as Record<string, unknown>).lease_expires_at = "2026-09-23T11:59:59Z"; }, {}],
    ["bound provider ID", (op) => { (op.external_job as Record<string, unknown>).provider_batch_id = "batches/x"; }, {}],
    ["ambiguity marker", (op) => { (op.external_job as Record<string, unknown>).ambiguous_since = "2026-09-23T11:00:00Z"; }, {}],
  ];
  for (const [label, mutate, override] of variants) {
    const initial = claimedOperation();
    mutate(initial.ai_tag as Record<string, unknown>);
    const database = fakeDatabase(initial);
    await assert.rejects(
      failOperationAfterDefinitiveRejection(database.rpc, { ...receipt, ...override }, rejection()),
      /receipt was not proven/,
      label,
    );
    assert.equal(database.operations.ai_tag.status, "running", label);
    assert.deepEqual(database.calls, ["reset_bulk_operation_submission_lease"], label);
  }
});

test("only a DefinitiveBatchRejectionError may reach the reset RPC", async () => {
  const database = fakeDatabase(claimedOperation());
  for (const error of [
    classifySubmissionHttpFailure("google-gemini", 503, "{}"),
    classifySubmissionHttpFailure("google-gemini", 400, "<html>proxy</html>"),
    new Error("timeout"),
  ]) {
    await assert.rejects(
      failOperationAfterDefinitiveRejection(database.rpc, receipt, error as DefinitiveBatchRejectionError),
      /Only a parsed definitive provider rejection/,
    );
  }
  assert.deepEqual(database.calls, []);
});

test("failed, cancelled and expired provider batches fail the operation instead of staying resumable", () => {
  for (const providerStatus of ["failed", "cancelled", "expired"]) {
    const state = providerJobErrorState(
      { status: "running", state_revision: 3, next_auto_resume_at: "2026-09-23T13:00:00Z", external_job: { phase: "pending", provider_batch_id: "batches/x" } },
      { ok: false, done: false, error: `Provider batch batches/x ${providerStatus}`, error_code: "provider_terminal" },
      { phase: "pending", provider_batch_id: "batches/x", provider_status: providerStatus },
      0,
      {},
    );
    assert.equal(state.status, "failed", providerStatus);
    assert.equal(state.interruption_reason_code, "provider_terminal");
    assert.equal(state.next_auto_resume_at, undefined);
    assert.equal(state.external_job?.provider_batch_id, "batches/x");
  }
  const other = providerJobErrorState(
    { status: "running", external_job: { phase: "pending", provider_batch_id: "batches/x" } },
    { ok: false, done: false, error: "Provider batch result missing" },
    undefined,
    0,
    {},
  );
  assert.equal(other.status, "interrupted");
});

test("a crash between the reset and the failure write is finished on the next tick, never resubmitted", async () => {
  const database = fakeDatabase(claimedOperation());
  let failSecondWrite = true;
  const flaky: RpcCall = async (fn, params) => {
    if (fn === "update_bulk_operation" && failSecondWrite) {
      failSecondWrite = false;
      return { data: null, error: { message: "connection reset" } };
    }
    return database.rpc(fn, params);
  };
  await assert.rejects(failOperationAfterDefinitiveRejection(flaky, receipt, rejection()), /connection reset/);
  const interim = database.operations.ai_tag as Record<string, unknown>;
  assert.equal(interim.status, "running");
  assert.equal(awaitsDefinitiveRejectionFailure(interim as never), true);

  const outcome = await persistDefinitiveRejectionFailure(flaky, "ai_tag", interim as never, interim.state_revision as number);
  assert.equal(database.operations.ai_tag.status, "failed");
  assert.match(String(outcome.state.error), /HTTP 400/);
  assert.equal(awaitsDefinitiveRejectionFailure(database.operations.ai_tag as never), false);
  // A duplicate finisher (second worker) is refused by the revision guard.
  await assert.rejects(persistDefinitiveRejectionFailure(flaky, "ai_tag", interim as never, interim.state_revision as number), /refused/);
  // An ordinary prepared job is not mistaken for a rejected one.
  assert.equal(awaitsDefinitiveRejectionFailure({ status: "running", external_job: { phase: "prepared" } }), false);
});
