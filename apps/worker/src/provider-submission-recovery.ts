import { DEFINITIVE_REJECTION_STATUSES, DefinitiveBatchRejectionError } from "./batch-submission-error.js";
import { isGuardedEnvelope, type BulkOperationWriteEnvelope } from "./operation-lease.js";
import type { OpState } from "./types.js";

/** Minimal service-role RPC surface, injectable so the contract can be tested. */
export type RpcCall = (
  fn: string,
  params: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

/**
 * The governed reset RPC is not deployed to this database (PostgREST
 * PGRST202 / HTTP 404). The migration is merged in popcre/shared-db #3426 and
 * promoted by its production lane; until then the worker fails the operation
 * visibly under this name instead of leaving it silently ambiguous.
 */
export class ResetContractUnavailableError extends Error {
  constructor() {
    super("Submission lease reset RPC reset_bulk_operation_submission_lease is not deployed (PGRST202); the provider rejected the batch and the operation was failed for operator review");
    this.name = "ResetContractUnavailableError";
  }
}

export function isMissingRpcError(error: { message: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || /PGRST202|could not find the function/i.test(error.message);
}

export const DEFINITIVE_REJECTION_REASON = "provider_definitive_rejection";

/**
 * The worker failed before any provider POST (nothing usable left to submit,
 * insufficient remaining lease, etc.), so no durable batch exists. Reset the
 * receipt under this reason with a NULL http status and the fixed provider
 * error category below (shared-db #3464).
 */
export const NOT_SUBMITTED_REASON = "not_submitted";
export const NOT_SUBMITTED_PROVIDER_ERROR = { category: "not_submitted" } as const;

export interface SubmissionReceipt {
  opKey: string;
  /** Revision returned by the claim that minted the receipt. */
  expectedRevision: number;
  submissionOwner: string;
  leaseToken: string;
}

export interface DefinitiveRejectionOutcome {
  /** The durable failed state written after the lease reset. */
  state: OpState;
  stateRevision: number;
}

/**
 * Call the governed reset RPC for the given reason, verify its receipt-free
 * proof, and return the reset operation and its new revision. Shared by both
 * reset reasons; every guard (live unbound receipt, matching revision, no bound
 * job) lives in the SQL function, not here.
 */
async function resetSubmissionLease(
  rpc: RpcCall,
  receipt: SubmissionReceipt,
  reason: typeof DEFINITIVE_REJECTION_REASON | typeof NOT_SUBMITTED_REASON,
  httpStatus: number | null,
  providerError: Record<string, unknown>,
): Promise<{ operation: OpState; stateRevision: number }> {
  const reset = await rpc("reset_bulk_operation_submission_lease", {
    p_op_key: receipt.opKey,
    p_expected_revision: receipt.expectedRevision,
    p_submission_owner: receipt.submissionOwner,
    p_lease_token: receipt.leaseToken,
    p_reason: reason,
    p_http_status: httpStatus,
    p_provider_error: providerError,
  });
  if (isMissingRpcError(reset.error)) throw new ResetContractUnavailableError();
  if (reset.error) throw new Error(`Submission lease reset refused: ${reset.error.message}`);
  const envelope = reset.data as Record<string, unknown> | null;
  if (
    !envelope || envelope.ok !== true
    || typeof envelope.state_revision !== "number"
    || envelope.lease_receipt_issued !== false
    || !envelope.operation || typeof envelope.operation !== "object"
  ) {
    throw new Error("Submission lease reset returned no proof");
  }
  const operation = envelope.operation as OpState;
  if (operation.external_job?.phase !== "prepared" || operation.external_job?.provider_batch_id) {
    throw new Error("Submission lease reset returned an unexpected provider job state");
  }
  return { operation, stateRevision: envelope.state_revision };
}

/**
 * Consume the current submission receipt after a parsed, provider-origin
 * definitive rejection (HTTP 400/401/402/403/422/429; shared-db #3464,
 * reset_bulk_operation_submission_lease), then durably fail the operation on the
 * next revision.
 *
 * Only DefinitiveBatchRejectionError reaches here. Timeouts, disconnects, 5xx
 * and every other status must stay on the ambiguous-submission path.
 */
export async function failOperationAfterDefinitiveRejection(
  rpc: RpcCall,
  receipt: SubmissionReceipt,
  rejection: DefinitiveBatchRejectionError,
  now = () => new Date().toISOString(),
): Promise<DefinitiveRejectionOutcome> {
  if (!(rejection instanceof DefinitiveBatchRejectionError)
    || !(DEFINITIVE_REJECTION_STATUSES as readonly number[]).includes(rejection.status)) {
    throw new Error("Only a parsed definitive provider rejection may reset a submission lease");
  }
  const { operation, stateRevision } = await resetSubmissionLease(
    rpc, receipt, DEFINITIVE_REJECTION_REASON, rejection.status, rejection.providerError,
  );
  return persistDefinitiveRejectionFailure(rpc, receipt.opKey, operation, stateRevision, rejection.message, now);
}

/**
 * Consume the current submission receipt after a terminal never-submitted
 * failure — the worker gave up before any provider POST (nothing usable left to
 * submit, or too little lease time remained), so no durable batch exists
 * (shared-db #3464, reason `not_submitted`). Then durably fail the operation on
 * the next revision. The RPC still requires the current live unbound receipt, so
 * an expired lease is refused and left to ordinary lease reconciliation.
 */
export async function failOperationAfterNotSubmitted(
  rpc: RpcCall,
  receipt: SubmissionReceipt,
  message: string,
  now = () => new Date().toISOString(),
): Promise<DefinitiveRejectionOutcome> {
  const { operation, stateRevision } = await resetSubmissionLease(
    rpc, receipt, NOT_SUBMITTED_REASON, null, { ...NOT_SUBMITTED_PROVIDER_ERROR },
  );
  return persistNotSubmittedFailure(rpc, receipt.opKey, operation, stateRevision, message, now);
}

/**
 * A reset operation left `running`/`prepared` with the database's rejection
 * marker. This happens between the two writes if the worker crashed or the
 * second write failed; it must be failed, never resubmitted.
 */
export function awaitsDefinitiveRejectionFailure(state: OpState): boolean {
  const job = state.external_job;
  return state.status === "running" && job?.phase === "prepared" && !job.provider_batch_id
    && typeof job.last_definitive_rejection_at === "string" && job.last_definitive_rejection_at.length > 0;
}

/**
 * Second, idempotent half of a reset path: fail the reset operation on its
 * current revision under the given terminal reason code. Safe to repeat after a
 * crash; the revision guard makes it apply exactly once. Carries the database's
 * reset external_job forward exactly, and never auto-resumes.
 */
async function persistResetFailure(
  rpc: RpcCall,
  opKey: string,
  resetOperation: OpState,
  stateRevision: number,
  reasonCode: string,
  error: string,
  now: () => string,
): Promise<DefinitiveRejectionOutcome> {
  const failedState: OpState = {
    ...resetOperation,
    status: "failed",
    interruption_reason_code: reasonCode,
    error,
    next_auto_resume_at: undefined,
    updated_at: now(),
  };
  const saved = await rpc("update_bulk_operation", {
    p_op_key: opKey,
    p_op_state: failedState,
    p_only_if_status: "running",
    p_expected_revision: stateRevision,
  });
  if (saved.error) throw new Error(`Protected operation save failed: ${saved.error.message}`);
  if (!isGuardedEnvelope(saved.data) || !(saved.data as BulkOperationWriteEnvelope).ok) {
    throw new Error(`Protected ${reasonCode} save refused: ${isGuardedEnvelope(saved.data) ? saved.data.reason : "no proof"}`);
  }
  return { state: failedState, stateRevision: (saved.data as BulkOperationWriteEnvelope).state_revision };
}

/** Idempotent finisher for the definitive-rejection reset. */
export async function persistDefinitiveRejectionFailure(
  rpc: RpcCall,
  opKey: string,
  resetOperation: OpState,
  stateRevision: number,
  message?: string,
  now = () => new Date().toISOString(),
): Promise<DefinitiveRejectionOutcome> {
  const status = resetOperation.external_job?.last_definitive_rejection_status;
  return persistResetFailure(
    rpc, opKey, resetOperation, stateRevision, "provider_definitive_rejection",
    message ?? `Provider rejected the batch submission${typeof status === "number" ? ` (HTTP ${status})` : ""}`,
    now,
  );
}

/** Idempotent finisher for the never-submitted reset. */
export async function persistNotSubmittedFailure(
  rpc: RpcCall,
  opKey: string,
  resetOperation: OpState,
  stateRevision: number,
  message?: string,
  now = () => new Date().toISOString(),
): Promise<DefinitiveRejectionOutcome> {
  return persistResetFailure(
    rpc, opKey, resetOperation, stateRevision, "provider_not_submitted",
    message ?? "Provider batch was never sent; the operation was failed for operator review",
    now,
  );
}

/**
 * Route a reset operation left mid-finish (crash between the two writes) to the
 * finisher matching the reason the database recorded. Returns null when the
 * state is not an awaiting reset.
 */
export function finishInterruptedReset(
  rpc: RpcCall,
  opKey: string,
  resetOperation: OpState,
  stateRevision: number,
  now = () => new Date().toISOString(),
): Promise<DefinitiveRejectionOutcome> | null {
  if (!awaitsDefinitiveRejectionFailure(resetOperation)) return null;
  return resetOperation.external_job?.last_definitive_rejection_reason === NOT_SUBMITTED_REASON
    ? persistNotSubmittedFailure(rpc, opKey, resetOperation, stateRevision, undefined, now)
    : persistDefinitiveRejectionFailure(rpc, opKey, resetOperation, stateRevision, undefined, now);
}

/**
 * Fail a still-claimed operation visibly on its current revision, carrying the
 * stored external_job forward unchanged (the database keeps its lease fields).
 * Terminal: the operation is never resubmitted automatically.
 */
export async function failClaimedOperation(
  rpc: RpcCall,
  opKey: string,
  claimedState: OpState,
  revision: number,
  reasonCode: string,
  message: string,
  now = () => new Date().toISOString(),
): Promise<OpState> {
  const { lease_token: _leaseToken, ...storedJob } = claimedState.external_job ?? ({} as NonNullable<OpState["external_job"]>);
  const failedState: OpState = {
    ...claimedState,
    status: "failed",
    interruption_reason_code: reasonCode,
    error: message,
    next_auto_resume_at: undefined,
    external_job: claimedState.external_job ? storedJob as OpState["external_job"] : undefined,
    updated_at: now(),
  };
  delete (failedState as { transient_prepared_batch?: unknown }).transient_prepared_batch;
  const saved = await rpc("update_bulk_operation", {
    p_op_key: opKey,
    p_op_state: failedState,
    p_only_if_status: "running",
    p_expected_revision: revision,
  });
  if (saved.error) throw new Error(`Protected operation save failed: ${saved.error.message}`);
  if (!isGuardedEnvelope(saved.data) || !(saved.data as BulkOperationWriteEnvelope).ok) {
    throw new Error(`Protected ${reasonCode} failure save refused: ${isGuardedEnvelope(saved.data) ? saved.data.reason : "no proof"}`);
  }
  return failedState;
}

/** Fallback when the reset RPC is missing (PGRST202) on a definitive rejection. */
export function failOperationWithoutResetContract(
  rpc: RpcCall,
  opKey: string,
  claimedState: OpState,
  claimRevision: number,
  rejection: DefinitiveBatchRejectionError,
  now = () => new Date().toISOString(),
): Promise<OpState> {
  return failClaimedOperation(rpc, opKey, claimedState, claimRevision, "reset_contract_unavailable",
    `${new ResetContractUnavailableError().message} (${rejection.message})`, now);
}

/** Fallback when the reset RPC is missing (PGRST202) on a never-submitted failure. */
export function failOperationWithoutResetContractNotSubmitted(
  rpc: RpcCall,
  opKey: string,
  claimedState: OpState,
  claimRevision: number,
  message: string,
  now = () => new Date().toISOString(),
): Promise<OpState> {
  return failClaimedOperation(rpc, opKey, claimedState, claimRevision, "reset_contract_unavailable",
    `${new ResetContractUnavailableError().message} (${message})`, now);
}
