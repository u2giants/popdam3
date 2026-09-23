import { DefinitiveBatchRejectionError } from "./batch-submission-error.js";
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
 * Consume the current submission receipt after a parsed, provider-origin
 * 400/422 rejection (shared-db #3418, reset_bulk_operation_submission_lease),
 * then durably fail the operation on the next revision.
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
  if (!(rejection instanceof DefinitiveBatchRejectionError)) {
    throw new Error("Only a parsed definitive provider rejection may reset a submission lease");
  }
  const reset = await rpc("reset_bulk_operation_submission_lease", {
    p_op_key: receipt.opKey,
    p_expected_revision: receipt.expectedRevision,
    p_submission_owner: receipt.submissionOwner,
    p_lease_token: receipt.leaseToken,
    p_reason: DEFINITIVE_REJECTION_REASON,
    p_http_status: rejection.status,
    p_provider_error: rejection.providerError,
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
  const resetOperation = envelope.operation as OpState;
  if (resetOperation.external_job?.phase !== "prepared" || resetOperation.external_job?.provider_batch_id) {
    throw new Error("Submission lease reset returned an unexpected provider job state");
  }

  return persistDefinitiveRejectionFailure(rpc, receipt.opKey, resetOperation, envelope.state_revision, rejection.message, now);
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
 * Second, idempotent half of the rejection path: fail the reset operation on
 * its current revision. Safe to repeat after a crash; the guard makes it apply
 * exactly once.
 */
export async function persistDefinitiveRejectionFailure(
  rpc: RpcCall,
  opKey: string,
  resetOperation: OpState,
  stateRevision: number,
  message?: string,
  now = () => new Date().toISOString(),
): Promise<DefinitiveRejectionOutcome> {
  const status = resetOperation.external_job?.last_definitive_rejection_status;
  // The rejection is deterministic for this payload, so auto-resuming would
  // only repeat it. Carry the database's reset external_job forward exactly.
  const failedState: OpState = {
    ...resetOperation,
    status: "failed",
    interruption_reason_code: "provider_definitive_rejection",
    error: message ?? `Provider rejected the batch submission${typeof status === "number" ? ` (HTTP ${status})` : ""}`,
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
    throw new Error(`Protected provider rejection save refused: ${isGuardedEnvelope(saved.data) ? saved.data.reason : "no proof"}`);
  }
  return { state: failedState, stateRevision: (saved.data as BulkOperationWriteEnvelope).state_revision };
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

/** Fallback when the reset RPC is missing (PGRST202). */
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
