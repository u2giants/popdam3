export interface BulkOperationWriteEnvelope {
  ok: boolean;
  state_revision: number;
  submission_owner: string | null;
  lease_expires_at: string | null;
  lease_token: string | null;
  lease_receipt_issued: boolean;
  provider_batch_id?: string | null;
  reason: string;
  operation?: unknown;
}

export function isGuardedEnvelope(value: unknown): value is BulkOperationWriteEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.ok === "boolean"
    && typeof row.state_revision === "number"
    && typeof row.lease_receipt_issued === "boolean"
    && typeof row.reason === "string";
}

/** Only a newly issued, non-empty receipt authorizes the provider POST. */
export function hasSubmissionLeaseReceipt(value: unknown): value is BulkOperationWriteEnvelope {
  return isGuardedEnvelope(value)
    && value.ok
    && value.lease_receipt_issued
    && typeof value.lease_token === "string"
    && value.lease_token.length > 0;
}
