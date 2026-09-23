import { DefinitiveBatchRejectionError } from "./batch-submission-error.js";
import { isGuardedEnvelope, type BulkOperationWriteEnvelope } from "./operation-lease.js";
import type { OpState } from "./types.js";

/** Minimal service-role RPC surface, injectable so the contract can be tested. */
export type RpcCall = (
  fn: string,
  params: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

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

  // The rejection is deterministic for this payload, so auto-resuming would
  // only repeat it. Carry the database's reset external_job forward exactly.
  const failedState: OpState = {
    ...resetOperation,
    status: "failed",
    interruption_reason_code: "provider_definitive_rejection",
    error: rejection.message,
    next_auto_resume_at: undefined,
    updated_at: now(),
  };
  const saved = await rpc("update_bulk_operation", {
    p_op_key: receipt.opKey,
    p_op_state: failedState,
    p_only_if_status: "running",
    p_expected_revision: envelope.state_revision,
  });
  if (saved.error) throw new Error(`Protected operation save failed: ${saved.error.message}`);
  if (!isGuardedEnvelope(saved.data) || !(saved.data as BulkOperationWriteEnvelope).ok) {
    throw new Error(`Protected provider rejection save refused: ${isGuardedEnvelope(saved.data) ? saved.data.reason : "no proof"}`);
  }
  return { state: failedState, stateRevision: (saved.data as BulkOperationWriteEnvelope).state_revision };
}
