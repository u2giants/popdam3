import { synchronizeMetaReservations, observePausedMetaResponse, MetaCapabilityRejectionError } from "./meta-model-api.js";
import { getMetaApiKey } from "./provider-api-key.js";
import { metaCompletedTransition, advanceMetaCapabilityRejection } from "./handlers/meta-tag-response-state.js";
/**
 * Operation loop — polls admin_config.BULK_OPERATIONS, dispatches to handlers,
 * persists state after each batch.
 *
 * Ports orchestration logic from supabase/functions/bulk-job-runner/index.ts.
 *
 * Key differences from bulk-job-runner:
 *   - No 45s time budget — processes until done or stopped
 *   - Bounded, persisted auto-resume backoff for transient failures
 *   - No HTTP round-trips to admin-api or ai-tag edge functions
 *   - Checks for user interruption every 10 batches (same threshold)
 *   - Stale lock detection: same 10-minute threshold
 */

import { db } from "./supabase.js";
import { logger } from "./logger.js";
import type { BatchResult, OpState } from "./types.js";
import { hasSubmissionLeaseReceipt, isGuardedEnvelope } from "./operation-lease.js";
import { handleBulkAiTag } from "./handlers/ai-tagging.js";
import { handleAiTagBakeoff } from "./handlers/ai-tag-bakeoff.js";
import { handleStyleGroupProfiles } from "./handlers/ai-style-group-profile.js";
import { handleCleanupMegaGroupTags, handleRebuildStyleGroups, handleReconcileStyleGroupStats, hashCursorCheckpoint, safeRebuildWatermark } from "./handlers/style-groups.js";
import { handleRelinkOrphanedAssets } from "./handlers/relink-orphaned.js";
import { handleLegacyPropagationAlias, handleRefreshGroupMetadata } from "./handlers/group-metadata-refresh.js";
import { handleApplyErpEnrichment, handleClassifyErpCategories } from "./handlers/erp.js";
import { handleShortenItemDescriptions } from "./handlers/item-short-description.js";
import { handleRichPdfExtract } from "./handlers/rich-pdf.js";
import { handlePopSGFileTags, processPendingPopSGTags } from "./handlers/popsg-tags.js";
import { maybeMirrorSeaDrive } from "./handlers/seadrive-mirror.js";
import { handleEmbedSearch } from "./handlers/embed-search.js";
import { handleReprocessMetadata } from "./handlers/metadata-reprocess.js";
import { isDeepStrictEqual } from "node:util";
import { withDependencyTimeout } from "./bounded-dependency.js";
import { AmbiguousBatchSubmissionError, DefinitiveBatchRejectionError, PreSubmissionError } from "./batch-submission-error.js";
import { alreadyBoundAcceptedAcknowledgement, createSubmissionOwnerFactory, persistAcceptedProviderAcknowledgement, type AcceptedProviderAcknowledgement, awaitsDefinitiveRejectionFailure, failOperationAfterDefinitiveRejection, failOperationAfterNotSubmitted, failClaimedOperation, failOperationWithoutResetContract, failOperationWithoutResetContractNotSubmitted, finishInterruptedReset, ResetContractUnavailableError, type RpcCall } from "./provider-submission-recovery.js";
import { alertTerminalFailure, appendTerminalRun, type TerminalRun } from "./terminal-outcomes.js";
import {
  getNextAutoResumeAt,
  isTransientInterruption,
  isValidAutoResumeCursor,
} from "./operation-retry.js";

const CONFIG_KEY = "BULK_OPERATIONS";
export const STALE_RUN_MINUTES = 10;
export const STALE_RUN_MS = STALE_RUN_MINUTES * 60 * 1000;
/**
 * While an operation only waits (a provider batch that is not yet due, or a
 * paused apply), refresh its updated_at at least this often so the stale guard
 * never mistakes a healthy wait for a dead run. Well under STALE_RUN_MS.
 */
export const WAIT_HEARTBEAT_MS = 2 * 60 * 1000;
const INTERRUPT_CHECK_EVERY = 10;
const AUTO_RESUME_MAX_ATTEMPTS = 10;

export function rebuildCursorReceipt(opKey: string, state: OpState, cursor: number | string | null | undefined, lastSuccessful: number | string | null | undefined) {
  if (opKey !== "rebuild-style-groups") return {};
  const safeWatermark = safeRebuildWatermark(state);
  return {
    ...safeWatermark,
    operation_cursor_sha256: hashCursorCheckpoint("operation", opKey, "cursor", cursor ?? null),
    operation_last_successful_cursor_sha256: hashCursorCheckpoint("operation", opKey, "last_successful_cursor", lastSuccessful ?? null),
  };
}
const submissionLeaseTokens = new Map<string, string>();
export const submissionOwnerForRun = createSubmissionOwnerFactory();
// RAM only; a known acknowledgement may never return to the submission path.
const acceptedAcknowledgements = new Map<string, AcceptedProviderAcknowledgement>();
// Accepted receipts prove only this exact bound job; they cannot authorize creation.
const acceptedBindingReceipts = new Map<string, AcceptedProviderAcknowledgement>();
function boundGroupIdentity(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== "object" || typeof item.style_group_id !== "string" || typeof item.custom_id !== "string")) return null;
  return value.map(item => [item.style_group_id, item.custom_id, item.sku]);
}
export function boundProviderReceipt(opKey: string, current: OpState): string | undefined {
  const ack = acceptedBindingReceipts.get(opKey);
  const original = ack?.submitted;
  const job = current.external_job;
  const bound = original?.external_job;
  if (!ack || !original || !job?.provider_batch_id || job.provider_batch_id !== bound?.provider_batch_id ||
      current.run_id !== original.run_id || current.started_at !== original.started_at ||
      (current.cursor !== original.cursor && !(job.phase === "completed" && bound.next_cursor !== undefined && current.cursor === bound.next_cursor)) ||
      !isDeepStrictEqual(current.params, original.params) || !isDeepStrictEqual(current.meta_tag_attempt, original.meta_tag_attempt) ||
      job.provider !== bound.provider || job.model !== bound.model || job.prepared_at !== bound.prepared_at ||
      job.page_cursor !== bound.page_cursor || job.submission_owner !== ack.claimed.external_job?.submission_owner ||
      job.lease_proof !== ack.claimed.external_job?.lease_proof ||
      job.account_fingerprint !== bound.account_fingerprint || job.output_method !== bound.output_method ||
      job.next_cursor !== bound.next_cursor || job.provider_pin !== bound.provider_pin ||
      boundGroupIdentity(job.group_items) === null || boundGroupIdentity(bound.group_items) === null ||
      !isDeepStrictEqual(boundGroupIdentity(job.group_items), boundGroupIdentity(bound.group_items)) ||
      !isDeepStrictEqual(job.meta_character_catalog_ids, bound.meta_character_catalog_ids) ||
      !isDeepStrictEqual(job.items?.map(item => [item.asset_id, item.custom_id]), bound.items?.map(item => [item.asset_id, item.custom_id]))) return undefined;
  return ack.leaseToken;
}
/** Called exclusively after a successful receipt-proven guarded phase write. */
export function refreshBoundProviderAccount(opKey: string, before: OpState, offered: OpState, saved: { ok: boolean; operation?: unknown }): boolean {
  const ack = acceptedBindingReceipts.get(opKey);
  const token = boundProviderReceipt(opKey, before);
  const next = offered.external_job?.account_fingerprint;
  const stored = saved.operation as OpState | undefined;
  if (!ack || !token || (ack.submitted.external_job?.provider !== undefined && ack.submitted.external_job.provider !== "openrouter") || !saved.ok || offered.external_job?.lease_token !== token || typeof next !== "string" || !next || !stored) return false;
  const check = (state: OpState) => boundProviderReceipt(opKey, { ...state, external_job: { ...state.external_job!, account_fingerprint: ack.submitted.external_job?.account_fingerprint } }) === token;
  if (!check(offered) || !check(stored) || stored.external_job?.account_fingerprint !== next) return false;
  ack.submitted = { ...ack.submitted, external_job: { ...ack.submitted.external_job!, account_fingerprint: next } };
  return true;
}
function retainBoundAcknowledgement(ack: AcceptedProviderAcknowledgement): void {
  acceptedBindingReceipts.set(ack.opKey, ack);
  submissionLeaseTokens.delete(ack.opKey);
  submissionLeaseRetryAfter.delete(ack.opKey);
  preSubmissionRetries.delete(ack.opKey);
  acceptedAcknowledgements.delete(ack.opKey);
}
export function holdsAcceptedAcknowledgement(opKey: string): boolean { return acceptedAcknowledgements.has(opKey); }
export function reconcileHeldAcknowledgement(opKey: string, current: OpState): boolean {
  const held = acceptedAcknowledgements.get(opKey);
  if (held && alreadyBoundAcceptedAcknowledgement(held, current)) retainBoundAcknowledgement(held);
  return acceptedAcknowledgements.has(opKey);
}
export async function saveAcceptedAcknowledgement(
  ack: AcceptedProviderAcknowledgement,
  rpc: RpcCall,
  read: () => Promise<OpState | null>,
) {
  const held = acceptedAcknowledgements.get(ack.opKey);
  if (held && held !== ack) return { saved: false, reason: "acknowledgement_already_held" };
  acceptedAcknowledgements.set(ack.opKey, ack);
  submissionLeaseTokens.delete(ack.opKey); // One-time creation authority is consumed.
  submissionLeaseRetryAfter.delete(ack.opKey);
  const result = await persistAcceptedProviderAcknowledgement(rpc, read, ack);
  if (result.saved) retainBoundAcknowledgement(ack);
  return result;
}
const submissionLeaseRetryAfter = new Map<string, number>();
// Pre-POST local failures while this worker holds a live receipt (count only
// for logging). The receipt is never discarded for these: nothing was sent, so
// giving it up would let the lease lapse into a false ambiguous_submission.
const preSubmissionRetries = new Map<string, number>();
// A never-sent submission whose governed not_submitted reset has not landed yet
// (e.g. a temporary RPC failure). The receipt is kept and the reset retried on
// the next tick while the lease is live; it is never silently discarded.
type PendingReset =
  | { kind: "not_submitted"; message: string }
  | { kind: "definitive_rejection"; rejection: DefinitiveBatchRejectionError };
const pendingNotSubmittedResets = new Map<string, PendingReset>();
// The provider payload built together with a new prepared job, handed to the
// very next submission claim in memory so the normal path never rebuilds it.
const preparedPayloads = new Map<string, { preparedAt: string; payload: unknown }>();

/** After any provider POST attempt, the receipt may never drive another POST. */
export function releaseReceiptAfterPost(opKey: string, leaseExpiresAt: string | undefined): void {
  preSubmissionRetries.delete(opKey);
  submissionLeaseTokens.delete(opKey);
  const leaseEnd = leaseExpiresAt ? new Date(leaseExpiresAt).getTime() : Number.NaN;
  submissionLeaseRetryAfter.set(opKey, Number.isFinite(leaseEnd) ? leaseEnd + 250 : Date.now() + 120_000);
}

/** Record the one-time receipt this worker was issued (never persisted). */
export function rememberSubmissionReceipt(opKey: string, leaseToken: string): void {
  // A same-owner renewal keeps the incumbent receipt: its retry count and any
  // pending reset carry over, so the retry ceiling cannot be reset by renewing.
  if (submissionLeaseTokens.get(opKey) === leaseToken) return;
  submissionLeaseTokens.set(opKey, leaseToken);
  // A newly minted receipt starts clean: no earlier reset or retry state applies.
  pendingNotSubmittedResets.delete(opKey);
  preSubmissionRetries.delete(opKey);
}

/** Drop every in-memory submission artifact for an operation that has ended. */
export function forgetSubmissionState(opKey: string): void {
  acceptedBindingReceipts.delete(opKey);
  submissionLeaseTokens.delete(opKey);
  submissionLeaseRetryAfter.delete(opKey);
  pendingNotSubmittedResets.delete(opKey);
  preSubmissionRetries.delete(opKey);
  preparedPayloads.delete(opKey);
}

/** True while this worker holds an in-memory receipt for the operation. */
export function holdsSubmissionReceipt(opKey: string): boolean {
  return submissionLeaseTokens.has(opKey);
}

/**
 * Phases the guarded writer treats as a live provider job. Mirrors c_live_phases
 * in shared-db migration 20260824004025 (popdam_terminal_external_job_clear).
 */
const PROTECTED_EXTERNAL_JOB_PHASES = ["prepared", "submitting", "pending", "applying"] as const;
const EXTERNAL_JOB_AMBIGUITY_MARKERS = ["ambiguous_since", "ambiguous_reason", "ambiguous_prior_phase", "ambiguous_prior_owner"] as const;

/**
 * True when the database would refuse to drop this external_job: it names a
 * provider job, is in a live phase, or carries an unresolved ambiguity verdict.
 * Clearing such a job through any writer is a permanent no-op, so the caller
 * must never attempt it.
 */
export function isProtectedExternalJob(job: OpState["external_job"] | undefined): boolean {
  if (!job) return false;
  if (typeof job.provider_batch_id === "string" && job.provider_batch_id.length > 0) return true;
  if (typeof job.phase === "string" && (PROTECTED_EXTERNAL_JOB_PHASES as readonly string[]).includes(job.phase)) return true;
  return EXTERNAL_JOB_AMBIGUITY_MARKERS.some((marker) => (job as Record<string, unknown>)[marker] != null);
}

/**
 * Keep the receipt after a failure that provably happened before any provider
 * request. Returns true while retries remain.
 */
export const MAX_PRE_SUBMISSION_RETRIES = 3;
/**
 * A pre-POST retry rebuilds the payload under the CURRENT lease and then renews
 * it. Retry only while this much lease remains (a bounded rebuild plus the
 * renewal fit well inside it); otherwise take the governed not_submitted reset
 * while the receipt is still live, never let the lease lapse into a false
 * ambiguous_submission.
 */
export const PRE_SUBMISSION_RETRY_MIN_LEASE_MS = 75_000;

/** Remaining submission lease, or 0 when unknown/expired. */
export function remainingLeaseMs(leaseExpiresAt: string | undefined, nowMs = Date.now()): number {
  const deadline = leaseExpiresAt ? new Date(leaseExpiresAt).getTime() : Number.NaN;
  return Number.isFinite(deadline) ? Math.max(0, deadline - nowMs) : 0;
}

/** True when the held lease can still cover one more bounded pre-POST attempt. */
export function leaseCoversAnotherAttempt(leaseExpiresAt: string | undefined, nowMs = Date.now()): boolean {
  return remainingLeaseMs(leaseExpiresAt, nowMs) >= PRE_SUBMISSION_RETRY_MIN_LEASE_MS;
}

/**
 * Decide what a proven pre-POST failure does. true: keep the receipt and retry
 * through the same-owner renewal. false: the failure is permanent (or has
 * repeated too often); the caller fails the operation visibly on its current
 * revision. The receipt is never silently discarded into a false ambiguity.
 */
export function holdReceiptAfterPreSubmissionFailure(
  opKey: string,
  error: unknown,
  leaseExpiresAt: string | undefined,
  nowMs = Date.now(),
): boolean {
  const attempts = (preSubmissionRetries.get(opKey) ?? 0) + 1;
  const message = normalizeBatchError(error, "Pre-submission failure without an error message").slice(0, 300);
  const permanent = error instanceof PreSubmissionError && error.permanent;
  if (!permanent && attempts <= MAX_PRE_SUBMISSION_RETRIES && leaseCoversAnotherAttempt(leaseExpiresAt, nowMs)) {
    preSubmissionRetries.set(opKey, attempts);
    logger.warn("tick: provider batch not sent; keeping the receipt and retrying after a same-owner lease renewal", { opKey, attempts, error: message });
    return true;
  }
  preSubmissionRetries.delete(opKey);
  // The receipt stays held until the governed reset lands (failNeverSentSubmission).
  logger.error("tick: provider batch was never sent and cannot be prepared; failing the operation visibly", { opKey, attempts, error: message });
  return false;
}

/** True while a never-sent reset for this operation still has to land. */
export function awaitsNotSubmittedReset(opKey: string): boolean {
  return pendingNotSubmittedResets.has(opKey);
}

/**
 * Fail a never-sent submission through the governed not_submitted reset. The
 * receipt is released only once a terminal write has landed; if the reset
 * fails transiently while the lease is still live, the receipt is kept and the
 * reset is retried on the next tick instead of letting the lease lapse into a
 * false ambiguous_submission.
 */
export async function failNeverSentSubmission(
  opKey: string,
  state: OpState,
  revision: number,
  owner: string,
  leaseToken: string | undefined,
  error: unknown,
  rpc: RpcCall = (fn, params) => db().rpc(fn, params),
): Promise<void> {
  const pending = pendingNotSubmittedResets.get(opKey);
  const message = pending?.kind === "not_submitted"
    ? pending.message
    : `Provider batch was never sent: ${normalizeBatchError(error, "pre-submission failure").slice(0, 200)}`;
  try {
    await failNeverSentSubmissionOnce(opKey, state, revision, owner, leaseToken, message, rpc);
  } catch (resetError) {
    if (leaseToken && remainingLeaseMs(state.external_job?.lease_expires_at) > 0) {
      pendingNotSubmittedResets.set(opKey, { kind: "not_submitted", message });
      logger.error("tick: never-sent reset did not land; keeping the receipt to retry it", {
        opKey, error: normalizeBatchError(resetError, "reset failed").slice(0, 200),
      });
    } else {
      pendingNotSubmittedResets.delete(opKey);
      submissionLeaseTokens.delete(opKey);
    }
    throw resetError;
  }
  pendingNotSubmittedResets.delete(opKey);
  preSubmissionRetries.delete(opKey);
  submissionLeaseTokens.delete(opKey);
}

/**
 * Consume the receipt after a parsed definitive provider rejection and fail the
 * operation. Like the never-sent path, the receipt is released only once a
 * terminal write lands; a transient reset failure while the lease is live keeps
 * it and retries next tick.
 */
export async function failDefinitivelyRejectedSubmission(
  opKey: string,
  state: OpState,
  revision: number,
  owner: string,
  leaseToken: string,
  rejection: DefinitiveBatchRejectionError,
  rpc: RpcCall = (fn, params) => db().rpc(fn, params),
): Promise<OpState> {
  let outcome: { state: OpState };
  try {
    try {
      const advanced = rejection instanceof MetaCapabilityRejectionError ? await advanceMetaCapabilityRejection(rpc, { opKey, expectedRevision: revision, submissionOwner: owner, leaseToken }, state, rejection) : null;
      if (advanced) outcome = { state: advanced };
      else outcome = await failOperationAfterDefinitiveRejection(
        rpc,
        { opKey, expectedRevision: revision, submissionOwner: owner, leaseToken },
        rejection,
      );
    } catch (resetError) {
      if (!(resetError instanceof ResetContractUnavailableError)) throw resetError;
      // Deploy-ordering gap: the governed RPC is not live yet. Fail the
      // operation visibly under a named reason rather than sit ambiguous.
      outcome = { state: await failOperationWithoutResetContract(rpc, opKey, state, revision, rejection) };
    }
  } catch (resetError) {
    if (remainingLeaseMs(state.external_job?.lease_expires_at) > 0) {
      pendingNotSubmittedResets.set(opKey, { kind: "definitive_rejection", rejection });
      logger.error("tick: definitive-rejection reset did not land; keeping the receipt to retry it", {
        opKey, error: normalizeBatchError(resetError, "reset failed").slice(0, 200),
      });
    } else {
      pendingNotSubmittedResets.delete(opKey);
      submissionLeaseTokens.delete(opKey);
    }
    throw resetError;
  }
  pendingNotSubmittedResets.delete(opKey);
  preSubmissionRetries.delete(opKey);
  submissionLeaseTokens.delete(opKey);
  return outcome.state;
}

async function failNeverSentSubmissionOnce(
  opKey: string,
  state: OpState,
  revision: number,
  owner: string,
  leaseToken: string | undefined,
  message: string,
  rpc: RpcCall,
): Promise<void> {
  // Nothing was POSTed, so the governed reset accepts this as `not_submitted`
  // (NULL http status, fixed category) and returns the job to `prepared` on the
  // next revision; we then fail it durably. The RPC still requires the current
  // live unbound receipt, so a lost or expired lease falls back to a plain
  // visible failure that carries the stored job forward unchanged.
  if (leaseToken && state.external_job?.phase === "submitting" && !state.external_job.provider_batch_id) {
    try {
      const outcome = await failOperationAfterNotSubmitted(
        rpc,
        { opKey, expectedRevision: revision, submissionOwner: owner, leaseToken },
        message,
      );
      await recordStyleGroupTerminalOutcome(opKey, outcome.state, "failed");
      logger.error("tick: provider batch was never sent; failed the operation after a governed lease reset", { opKey });
      return;
    } catch (resetError) {
      if (!(resetError instanceof ResetContractUnavailableError)) throw resetError;
      const failed = await failOperationWithoutResetContractNotSubmitted(rpc, opKey, state, revision, message);
      await recordStyleGroupTerminalOutcome(opKey, failed, "failed");
      return;
    }
  }
  const failed = await failClaimedOperation(rpc, opKey, state, revision, "pre_submission_failed", message);
  await recordStyleGroupTerminalOutcome(opKey, failed, "failed");
}
/** Yield after this many batches so the round-robin can serve other operations.
 *  Under the old 45s edge function, 5 was the max that fit safely. The persistent
 *  worker has no timeout, so 50 keeps ops running hot while still yielding often
 *  enough to check for user interruptions and serve other lanes. */
const MAX_BATCHES_PER_TICK = 50;
export function operationBatchLimit(opKey: string): number {
  // Yield after one persisted benchmark page (up to two assets/five models).
  // Tagging keeps its normal full turn so slow benchmarks cannot dominate it.
  return opKey === "ai-tag-bakeoff" ? 1 : MAX_BATCHES_PER_TICK;
}

async function recordStyleGroupTerminalOutcome(
  opKey: string,
  state: OpState,
  status: "succeeded" | "failed",
): Promise<void> {
  if (opKey !== "rebuild-style-groups" || !state.run_id || !state.started_at) return;
  const run: TerminalRun = {
    operation: opKey,
    run_id: state.run_id,
    status: status === "succeeded" ? "completed" : "failed",
    source_status: status === "succeeded" ? "completed" : "failed",
    stage: state.last_stage,
    error: state.error,
    reason_code: state.interruption_reason_code,
    // The live schema classifies `completed` as successful only when the
    // terminal row carries an explicit numeric zero-failure counter.
    progress: status === "succeeded"
      ? { ...(state.progress ?? {}), failed: Number(state.progress?.failed ?? 0) }
      : (state.progress ?? {}),
    started_at: state.started_at,
    ended_at: state.updated_at ?? new Date().toISOString(),
  };
  await appendTerminalRun(db(), run);
  await alertTerminalFailure(run);
}

// Lane isolation — operations in the same lane are mutually exclusive
const OP_LANES: Record<string, string> = {
  "ai-tag-untagged": "ai-tagging",
  "ai-tag-all": "ai-tagging",
  "ai-tag-groups": "ai-tagging",
  "ai-tag-parallel": "ai-parallel",
  "ai-tag-group-profiles": "ai-tagging",
  "ai-tag-bakeoff": "ai-tagging",
  "rebuild-style-groups": "style-groups",
  "reconcile-style-group-stats": "style-groups",
  "reprocess-metadata": "metadata",
  "backfill-sku-names": "metadata",
  "erp-enrichment": "erp",
  "erp-classify": "erp",
  "shorten-item-descriptions": "item-descriptions",
  "propagate-group-tags": "style-groups",
  "refresh-group-metadata": "style-groups",
  "cleanup-mega-group-tags": "style-groups",
  "relink-orphaned-assets": "style-groups",
  "tag-popsg-files": "popsg-tags",
  "rich-pdf-extract": "rich-pdf",
  "embed-dam-search": "search-index",
};

// Cross-lane conflicts — operations in DIFFERENT lanes that still cannot run simultaneously.
// Root cause: speculative-insert index locks on asset_tags B-tree index when both ai-tag and
// propagate-group-tags INSERT the same (asset_id, tag) pair. SKIP LOCKED only fixes UPDATE
// locks, not INSERT index locks. Must be kept in sync with:
//   supabase/functions/_shared/operation-constants.ts  (backend enforcement)
//   src/components/settings/diagnostics/types.ts       (UI pre-flight check)
const OP_CONFLICTS: Readonly<Record<string, readonly string[]>> = {
  "ai-tag-untagged":      ["ai-tag-parallel", "rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-group-profiles", "refresh-group-metadata"],
  "ai-tag-all":           ["ai-tag-parallel", "rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-group-profiles", "refresh-group-metadata"],
  "ai-tag-groups":        ["ai-tag-parallel", "rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-group-profiles", "refresh-group-metadata"],
  "ai-tag-parallel":        ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-group-profiles", "refresh-group-metadata"],
  "ai-tag-group-profiles": ["rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-parallel", "ai-tag-bakeoff", "refresh-group-metadata"],
  "ai-tag-bakeoff":       ["rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-group-profiles", "refresh-group-metadata"],
  "propagate-group-tags": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-parallel", "ai-tag-bakeoff", "ai-tag-group-profiles"],
  "refresh-group-metadata": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-parallel", "ai-tag-bakeoff", "ai-tag-group-profiles"],
  "rebuild-style-groups": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-parallel", "ai-tag-bakeoff", "rich-pdf-extract", "ai-tag-group-profiles"],
  "rich-pdf-extract":     ["rebuild-style-groups"],
  "reprocess-metadata":   ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-parallel", "ai-tag-bakeoff", "erp-enrichment", "ai-tag-group-profiles"],
  "backfill-sku-names":   ["erp-enrichment"],
  "erp-enrichment":       ["reprocess-metadata", "backfill-sku-names"],
};

export function runningTagConflict(opKey: string, running: Iterable<string>): boolean {
  const normalized = opKey.startsWith("ai-tag-single-") ? "ai-tag-all" : opKey;
  const keys = [...running];
  return (normalized === "ai-tag-parallel" && keys.some(key => key.startsWith("ai-tag-single-"))) ||
    (OP_CONFLICTS[normalized] ?? []).some(key => keys.includes(key));
}

function getLane(opKey: string): string {
  if (opKey.startsWith("ai-tag-single-")) return "ai-tagging";
  return OP_LANES[opKey] ?? opKey;
}

function detectStaleRun(op: OpState): boolean {
  if (op.status !== "running") return false;
  if (!op.updated_at) return false;
  const ageMs = Date.now() - new Date(op.updated_at).getTime();
  return ageMs > STALE_RUN_MS;
}

// ── Progress accumulator — mirrors buildProgress() in bulk-job-runner ────────

function isRebuildRowCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function qualifyRebuildRowCounts(batch: BatchResult, op: OpState): BatchResult {
  if (!batch.ok || batch.stage !== "rebuild_assets") return batch;
  // The legacy handler estimates selected rows from its configured batch size.
  // Only the scheduled watermark contract returns actual selected candidates;
  // these counts do not describe physical database reads.
  const exact = op.params?.watermark_protocol === 1
    && isRebuildRowCount(batch.rows_examined)
    && isRebuildRowCount(batch.assets_assigned)
    && isRebuildRowCount(batch.assets_ungrouped)
    && Number.isSafeInteger(batch.assets_assigned + batch.assets_ungrouped)
    && batch.assets_assigned + batch.assets_ungrouped <= batch.rows_examined;
  return { ...batch, rebuild_counts_exact: exact };
}

export function mergeProgress(opKey: string, prev: Record<string, unknown>, batch: BatchResult): Record<string, unknown> {
  // Normalize dynamic keys for matching
  const normalizedKey = opKey.startsWith("ai-tag-single-") ? "ai-tag-all" : opKey;
  switch (normalizedKey) {
    case "ai-tag-untagged":
    case "ai-tag-all":
    case "ai-tag-groups":
    case "ai-tag-parallel": {
      const prevFail = Array.isArray(prev.failure_samples) ? prev.failure_samples as unknown[] : [];
      const batchFail = Array.isArray(batch.failure_samples) ? batch.failure_samples as unknown[] : [];
      const prevSkip = Array.isArray(prev.skip_samples) ? prev.skip_samples as unknown[] : [];
      const batchSkip = Array.isArray(batch.skip_samples) ? batch.skip_samples as unknown[] : [];
      return {
        tagged: ((prev.tagged as number) || 0) + ((batch.tagged as number) || 0),
        skipped: ((prev.skipped as number) || 0) + ((batch.skipped as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        visual_analysis_unavailable: ((prev.visual_analysis_unavailable as number) || 0) + ((batch.visual_analysis_unavailable as number) || 0),
        image_unusable: ((prev.image_unusable as number) || 0) + ((batch.image_unusable as number) || 0),
        // Prefer previously-set total; fall back to batch-supplied count (set by handler when total is unknown)
        total: (prev.total as number) || (batch.total_count as number) || 0,
        failure_samples: [...prevFail, ...batchFail].slice(-200),
        skip_samples: [...prevSkip, ...batchSkip].slice(-200),
      };
    }
    case "ai-tag-group-profiles": {
      const prevFail = Array.isArray(prev.failure_samples) ? prev.failure_samples as unknown[] : [];
      const batchFail = Array.isArray(batch.failure_samples) ? batch.failure_samples as unknown[] : [];
      return {
        profiled: ((prev.profiled as number) || 0) + ((batch.profiled as number) || 0),
        skipped: ((prev.skipped as number) || 0) + ((batch.skipped as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        visual_analysis_unavailable: ((prev.visual_analysis_unavailable as number) || 0) + ((batch.visual_analysis_unavailable as number) || 0),
        image_unusable: ((prev.image_unusable as number) || 0) + ((batch.image_unusable as number) || 0),
        total: (prev.total as number) || (batch.total_count as number) || 0,
        failure_samples: [...prevFail, ...batchFail].slice(-200),
      };
    }
    case "ai-tag-bakeoff": {
      const prevFail = Array.isArray(prev.failure_samples) ? prev.failure_samples as unknown[] : [];
      const batchFail = Array.isArray(batch.failure_samples) ? batch.failure_samples as unknown[] : [];
      return {
        evaluated: ((prev.evaluated as number) || 0) + ((batch.evaluated as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        total: (prev.total as number) || (batch.total_count as number) || 0,
        failure_samples: [...prevFail, ...batchFail].slice(-100),
      };
    }
    case "rebuild-style-groups": {
      let rowCounts = {
        rows_examined: prev.rows_examined,
        rows_written: prev.rows_written,
        rebuild_counts_exact: prev.rebuild_counts_exact,
      };
      if (batch.ok && batch.stage === "rebuild_assets") {
        const freshPrefix = prev.rebuild_counts_exact === undefined
          && prev.rows_examined === undefined && prev.rows_written === undefined
          && (prev.total_processed === undefined || prev.total_processed === 0);
        const exactPrefix = prev.rebuild_counts_exact === true
          && isRebuildRowCount(prev.rows_examined) && isRebuildRowCount(prev.rows_written);
        const selected = batch.rows_examined;
        const assigned = batch.assets_assigned;
        const ungrouped = batch.assets_ungrouped;
        if (batch.rebuild_counts_exact === true && (freshPrefix || exactPrefix)
          && isRebuildRowCount(selected) && isRebuildRowCount(assigned) && isRebuildRowCount(ungrouped)) {
          const examined = (freshPrefix ? 0 : Number(prev.rows_examined)) + selected;
          const written = (freshPrefix ? 0 : Number(prev.rows_written)) + assigned + ungrouped;
          // The handler commits its cursor/total before this separate progress
          // write. A crash between them must not label an incomplete sum exact.
          const reconciled = isRebuildRowCount(batch.total_processed) && batch.total_processed === examined;
          rowCounts = reconciled && Number.isSafeInteger(examined) && Number.isSafeInteger(written)
            ? { rows_examined: examined, rows_written: written, rebuild_counts_exact: true }
            : { rows_examined: null, rows_written: null, rebuild_counts_exact: false };
        } else {
          // A resumed legacy prefix cannot be reconstructed from total_processed.
          rowCounts = { rows_examined: null, rows_written: null, rebuild_counts_exact: false };
        }
      }
      const successful: Partial<BatchResult> = batch.ok ? batch : {};
      return {
        ...rowCounts,
        groups: ((prev.groups as number) || 0) + ((successful.groups_created as number) || 0),
        assigned: ((prev.assigned as number) || 0) + ((successful.assets_assigned as number) || 0),
        cleared: ((prev.cleared as number) || 0) + ((successful.cleared_assets as number) || 0),
        groups_deleted: ((prev.groups_deleted as number) || 0) + ((successful.groups_deleted as number) || 0),
        total_groups_before_delete: Math.max((prev.total_groups_before_delete as number) || 0, (successful.total_groups_before_delete as number) || 0),
        total_processed: Math.max((prev.total_processed as number) || 0, (successful.total_processed as number) || 0),
        total_assets: Math.max((prev.total_assets as number) || 0, (successful.total_assets as number) || 0),
        counts_processed: Math.max((prev.counts_processed as number) || 0, (successful.counts_processed as number) || 0),
        primaries_processed: Math.max((prev.primaries_processed as number) || 0, (successful.primaries_processed as number) || 0),
        finalize_total_groups: Math.max((prev.finalize_total_groups as number) || 0, (successful.finalize_total_groups as number) || 0),
        stage: batch.stage || prev.stage,
        substage: batch.sub || batch.substage || prev.substage,
      };
    }
    case "reconcile-style-group-stats":
      return {
        counts_processed: Math.max((prev.counts_processed as number) || 0, (batch.counts_processed as number) || 0),
        primaries_processed: Math.max((prev.primaries_processed as number) || 0, (batch.primaries_processed as number) || 0),
        total_groups: Math.max((prev.total_groups as number) || 0, (batch.total_groups as number) || 0),
        stage: batch.sub || prev.stage,
      };
    case "erp-enrichment":
      return {
        updated: ((prev.updated as number) || 0) + ((batch.updated as number) || 0),
        total: Math.max((prev.total as number) || 0, (batch.total as number) || 0),
        assets_updated: ((prev.assets_updated as number) || 0) + ((batch.assets_updated as number) || 0),
        groups_updated: ((prev.groups_updated as number) || 0) + ((batch.groups_updated as number) || 0),
      };
    case "shorten-item-descriptions":
      return {
        shortened: ((prev.shortened as number) || 0) + ((batch.shortened as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        scanned: ((prev.scanned as number) || 0) + ((batch.scanned as number) || 0),
        failure_samples: [
          ...(Array.isArray(prev.failure_samples) ? prev.failure_samples : []),
          ...(Array.isArray(batch.failure_samples) ? batch.failure_samples : []),
        ].slice(-100),
      };
    case "erp-classify":
      return {
        classified: ((prev.classified as number) || 0) + ((batch.classified as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        skipped_unclassifiable: ((prev.skipped_unclassifiable as number) || 0) + ((batch.skipped_unclassifiable as number) || 0),
        total: ((prev.total as number) || 0) + ((batch.total as number) || 0),
      };
    case "propagate-group-tags":
    case "refresh-group-metadata": {
      // Terminology deliberately changed from "assets propagated" to "groups
      // refreshed": nothing is copied between files any more.
      const prevFail = Array.isArray(prev.failure_samples) ? prev.failure_samples as unknown[] : [];
      const batchFail = Array.isArray(batch.failure_samples) ? batch.failure_samples as unknown[] : [];
      return {
        refreshed: ((prev.refreshed as number) || 0) + ((batch.refreshed as number) || 0),
        unchanged: ((prev.unchanged as number) || 0) + ((batch.unchanged as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        total: prev.total || 0,
        failure_samples: [...prevFail, ...batchFail].slice(-200),
        ...(batch.deprecated ? { deprecated: true, deprecation_notice: batch.deprecation_notice } : {}),
      };
    }
    case "cleanup-mega-group-tags":
      return {
        groups_processed: ((prev.groups_processed as number) || 0) + ((batch.groups_processed as number) || 0),
        tags_deleted: ((prev.tags_deleted as number) || 0) + ((batch.tags_deleted as number) || 0),
        characters_deleted: ((prev.characters_deleted as number) || 0) + ((batch.characters_deleted as number) || 0),
        metadata_cleared: ((prev.metadata_cleared as number) || 0) + ((batch.metadata_cleared as number) || 0),
      };
    case "relink-orphaned-assets":
      return {
        relinked: ((prev.relinked as number) || 0) + ((batch.relinked as number) || 0),
        errors: ((prev.errors as number) || 0) + ((batch.errors as number) || 0),
      };
    case "tag-popsg-files":
      return {
        processed: ((prev.processed as number) || 0) + ((batch.processed as number) || 0),
        tags_written: ((prev.tags_written as number) || 0) + ((batch.tags_written as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        licensor_present: ((prev.licensor_present as number) || 0) + ((batch.licensor_present as number) || 0),
        licensor_unmatched: ((prev.licensor_unmatched as number) || 0) + ((batch.licensor_unmatched as number) || 0),
        property_present: ((prev.property_present as number) || 0) + ((batch.property_present as number) || 0),
        property_unmatched: ((prev.property_unmatched as number) || 0) + ((batch.property_unmatched as number) || 0),
        consensus_folders: ((prev.consensus_folders as number) || 0) + ((batch.consensus_folders as number) || 0),
        consensus_relationships: ((prev.consensus_relationships as number) || 0) + ((batch.consensus_relationships as number) || 0),
        failure_samples: [
          ...(Array.isArray(prev.failure_samples) ? prev.failure_samples : []),
          ...(Array.isArray(batch.failure_samples) ? batch.failure_samples : []),
        ].slice(-100),
      };
    case "embed-dam-search":
      return {
        claimed: ((prev.claimed as number) || 0) + ((batch.claimed as number) || 0),
        embedded: ((prev.embedded as number) || 0) + ((batch.embedded as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        stale: ((prev.stale as number) || 0) + ((batch.stale as number) || 0),
        total_documents: (batch.total_documents as number) || (prev.total_documents as number) || 0,
        embedded_documents: (batch.embedded_documents as number) || (prev.embedded_documents as number) || 0,
        pending_documents: (batch.pending_documents as number) ?? (prev.pending_documents as number) ?? 0,
        exhausted_documents: (batch.exhausted_documents as number) ?? (prev.exhausted_documents as number) ?? 0,
      };
    default:
      return { ...prev, ...batch };
  }
}

// ── Error classifier ─────────────────────────────────────────────────────────

/** Map a raw error message to a known reason_code. */
export function normalizeBatchError(error: unknown, fallback = "Batch failed (handler supplied no message)"): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

/**
 * State for a provider-batch handler error. A provider batch that finished as
 * failed/cancelled/expired (`provider_terminal`) will never produce results, so
 * the operation fails durably instead of being left resumable to re-poll the
 * same dead batch forever. Other errors stay interrupted.
 */
export function providerJobErrorState(
  currentState: OpState,
  result: BatchResult,
  resultJob: OpState["external_job"] | undefined,
  cursor: OpState["cursor"],
  progress: OpState["progress"],
): OpState {
  const terminal = result.error_code === "provider_terminal";
  return {
    ...currentState,
    status: terminal ? "failed" : "interrupted",
    cursor,
    progress,
    error: result.error ?? "Provider batch failed",
    interruption_reason_code: terminal ? "provider_terminal" : interruptionReason(result),
    ...(terminal ? { next_auto_resume_at: undefined } : {}),
    external_job: resultJob ?? currentState.external_job,
    updated_at: new Date().toISOString(),
  };
}

export function classifyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("thumbnail fetch timed out before submission")) return "dependency_timeout";
  if (m.includes("thumbnail fetch temporarily failed before submission")) return "dependency_timeout";
  if (m.includes("config read timed out") || m.includes("dependency timed out")) return "dependency_timeout";
  if (m.includes("57014") || m.includes("statement timeout")) return "statement_timeout";
  if (m.includes("handler supplied no message")) return "missing_error_message";
  if (m.includes("bad gateway") || m.includes("502") || m.includes("503") || m.includes("504")) return "gateway_timeout";
  if (m.includes("too many connections") || m.includes("connection refused")) return "connection_error";
  if (m.includes("rate limit") || m.includes("429")) return "rate_limited";
  return "unknown";
}

export function interruptionReason(result: BatchResult): string {
  if (result.error_code === "legacy_cursor" || result.error_code === "invalid_cursor" || result.error_code === "meta_inference_deadline") {
    return result.error_code;
  }
  return classifyError(normalizeBatchError(result.error));
}

export function nextAutoResumeAt(reason: string, op: OpState): string | undefined {
  if (!isTransientInterruption(reason)) return undefined;
  if ((op.auto_resume_attempts ?? 0) >= AUTO_RESUME_MAX_ATTEMPTS) return undefined;
  return getNextAutoResumeAt(Date.now(), op.auto_resume_attempts ?? 0);
}

// ── Failure kill switch ───────────────────────────────────────────────────────

// Tier 1: if the last N failures are all the same error, stop immediately.
// Catches systematic breakage (missing column, bad API key) without waiting
// for a large sample. Does not require failures to be consecutive — skips
// and successes in between don't reset it.
const KILL_SAME_ERROR_COUNT = 20;

// Tier 2: if the overall failure rate exceeds this threshold once a minimum
// number of assets have been processed, stop. Catches high-rate mixed errors
// that tier 1 misses (e.g. several different timeout messages).
const KILL_RATE_THRESHOLD = 0.80;   // 80% failure rate
const KILL_RATE_MIN_SAMPLE = 50;    // need at least this many processed first

/**
 * Returns a human-readable reason string if the kill switch should fire,
 * otherwise null. Two independent tiers — either can trigger.
 * Only considers failures that occurred on or after startedAt (current run).
 */
export function detectFailureKillSwitch(progress: Record<string, unknown>, startedAt?: string): string | null {
  const allSamples = progress.failure_samples as Array<{ at?: string; error?: string; reason_category?: string }> | undefined;
  const startMs = startedAt ? new Date(startedAt).getTime() : 0;

  // Only consider failures from the current run (filter by started_at). Items
  // whose image is unusable are per-item data problems, not systematic
  // breakage: they are recorded and skipped past, never a reason to stop.
  const samples = allSamples?.filter((s) => (!s.at || new Date(s.at).getTime() >= startMs) && s.reason_category !== "image_unusable");

  const failed  = Math.max(0, ((progress.failed as number) || 0) - ((progress.image_unusable as number) || 0));
  const tagged  = (progress.tagged  as number) || 0;
  const skipped = (progress.skipped as number) || 0;
  const total   = tagged + skipped + failed;

  // Tier 1: last N failures share the same error (non-consecutive — just the last N in the sample list)
  if (samples && samples.length >= KILL_SAME_ERROR_COUNT) {
    const recent = samples.slice(-KILL_SAME_ERROR_COUNT);
    const normalize = (e?: string) => (e ?? "").slice(0, 120).trim();
    const first = normalize(recent[0].error);
    if (first && recent.every((s) => normalize(s.error) === first)) {
      return `Last ${KILL_SAME_ERROR_COUNT} failures share the same error: "${first.slice(0, 200)}"`;
    }
  }

  // Tier 2: overall failure rate too high across a meaningful sample
  if (total >= KILL_RATE_MIN_SAMPLE && failed / total >= KILL_RATE_THRESHOLD) {
    return `Failure rate ${Math.round((failed / total) * 100)}% (${failed} failed out of ${total} processed)`;
  }

  return null;
}

export function buildResultMessage(opKey: string, progress: Record<string, unknown>): string {
  const normalizedKey = opKey.startsWith("ai-tag-single-") ? "ai-tag-all" : opKey;
  switch (normalizedKey) {
    case "ai-tag-untagged":
    case "ai-tag-all":
    case "ai-tag-groups":
    case "ai-tag-parallel":
      return `Tagged ${progress.tagged}. ${(Number(progress.visual_analysis_unavailable) || 0) + (Number(progress.image_unusable) || 0)} visual analyses unavailable. ${progress.skipped || 0} skipped. ${progress.failed || 0} failed${progress.image_unusable ? ` (${progress.image_unusable} with unusable images)` : ""}.`;
    case "ai-tag-group-profiles":
      return `Profiled ${progress.profiled || 0} style groups. ${(Number(progress.visual_analysis_unavailable) || 0) + (Number(progress.image_unusable) || 0)} without usable representative images. ${progress.failed || 0} failed${progress.image_unusable ? ` (${progress.image_unusable} with unusable images)` : ""}.`;
    case "ai-tag-bakeoff":
      return `Evaluated ${progress.evaluated || 0} model responses. ${progress.failed || 0} failed.`;
    case "rebuild-style-groups": {
      const counts = progress.rebuild_counts_exact === true
        && isRebuildRowCount(progress.rows_examined) && isRebuildRowCount(progress.rows_written)
        ? `${progress.rows_examined} assets checked, ${progress.rows_written} assignments changed`
        : "Asset check/change counts unavailable for this run";
      return `Created ${progress.groups} style groups, assigned ${progress.assigned} assets. ${counts}`;
    }
    case "reconcile-style-group-stats":
      return `Reconciled counts for ${progress.counts_processed || 0} groups, primaries for ${progress.primaries_processed || 0} groups`;
    case "erp-enrichment":
      return `Enriched ${progress.assets_updated || 0} assets, ${progress.groups_updated || 0} groups`;
    case "shorten-item-descriptions":
      return `Shortened ${progress.shortened || 0} item descriptions. ${progress.failed || 0} failed.`;
    case "erp-classify":
      return `AI-classified ${progress.classified || 0} items (${progress.skipped_unclassifiable || 0} unclassifiable)`;
    case "propagate-group-tags":
    case "refresh-group-metadata":
      return `Refreshed ${progress.refreshed || 0} style groups (${progress.unchanged || 0} already current, ${progress.failed || 0} failed)`;
    case "cleanup-mega-group-tags":
      return `Cleaned ${progress.groups_processed || 0} mega-groups: ${progress.tags_deleted || 0} tags deleted, ${progress.characters_deleted || 0} characters removed, ${progress.metadata_cleared || 0} assets metadata cleared`;
    case "relink-orphaned-assets":
      return `Relinked ${progress.relinked || 0} orphaned assets${progress.errors ? `, ${progress.errors} errors` : ""}`;
    case "tag-popsg-files":
      return `Tagged ${progress.processed || 0} PopSG files with ${progress.tags_written || 0} direct relationships and ${progress.consensus_relationships || 0} folder-consensus relationships. ${progress.failed || 0} failed.`;
    case "embed-dam-search":
      return `Embedded ${progress.embedded || 0} search documents. ${progress.pending_documents || 0} pending, ${progress.exhausted_documents || 0} terminal.`;
    default:
      return "Operation completed";
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

const SINGLE_AI_TAG_PREFIX = "ai-tag-single-";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function scopeSingleAssetTag(opKey: string, opState: OpState): OpState | null {
  if (!opKey.startsWith(SINGLE_AI_TAG_PREFIX)) return null;
  const assetId = opKey.slice(SINGLE_AI_TAG_PREFIX.length);
  if (!UUID_PATTERN.test(assetId)) return null;
  return {
    ...opState,
    params: { ...opState.params, asset_ids: [assetId] },
  };
}

export async function dispatch(opKey: string, opState: OpState): Promise<BatchResult> {
  // Handle dynamic single-asset tagging keys (ai-tag-single-{uuid})
  if (opKey.startsWith("ai-tag-single-")) {
    const scopedState = scopeSingleAssetTag(opKey, opState);
    if (!scopedState) {
      return { ok: false, done: true, error: "Single-asset tag operation has an invalid asset ID" };
    }
    return handleBulkAiTag(scopedState, true, {}, true);
  }

  switch (opKey) {
    case "ai-tag-untagged":
      return handleBulkAiTag(opState, false);
    case "ai-tag-all":
    case "ai-tag-groups":
      return handleBulkAiTag(opState, true);
    case "ai-tag-parallel":
      return handleBulkAiTag(opState, true, {}, true, true);
    case "ai-tag-bakeoff":
      return handleAiTagBakeoff(opState);
    case "ai-tag-group-profiles":
      return handleStyleGroupProfiles(opState);
    case "rebuild-style-groups":
      return qualifyRebuildRowCounts(await handleRebuildStyleGroups(opState), opState);
    case "reconcile-style-group-stats":
      return handleReconcileStyleGroupStats(opState);
    case "propagate-group-tags":
      return handleLegacyPropagationAlias(opState);
    case "refresh-group-metadata":
      return handleRefreshGroupMetadata(opState);
    case "cleanup-mega-group-tags":
      return handleCleanupMegaGroupTags(opState);
    case "relink-orphaned-assets":
      return handleRelinkOrphanedAssets(opState);
    case "erp-enrichment":
      return handleApplyErpEnrichment(opState);
    case "erp-classify":
      return handleClassifyErpCategories(opState);
    case "shorten-item-descriptions":
      return handleShortenItemDescriptions(opState);
    case "rich-pdf-extract":
      return handleRichPdfExtract(opState);
    case "tag-popsg-files":
      return handlePopSGFileTags(opState);
    case "embed-dam-search":
      return handleEmbedSearch(opState);
    case "reprocess-metadata":
      return handleReprocessMetadata(opState);
    default:
      return { ok: false, done: false, error: `Unknown operation: ${opKey}` };
  }
}

// ── Persist single op state ───────────────────────────────────────────────────

/**
 * Persist op state. When onlyIfRunning=true, passes p_only_if_status="running"
 * so the write is a no-op if the user has stopped the op in the meantime.
 * Returns true if the state was successfully written (or if onlyIfRunning=false).
 * Returns false if the write was rejected because the op is no longer "running".
 */
interface PersistOptions {
  onlyIfRunning?: boolean;
  expectedRevision?: number;
  submissionOwner?: string;
  leaseSeconds?: number;
  requireLeaseReceipt?: boolean;
}

async function guardedPersistOpState(
  opKey: string,
  opState: OpState,
  options: { expectedRevision: number; submissionOwner?: string; leaseSeconds?: number },
) {
  const params: Record<string, unknown> = {
    p_op_key: opKey,
    p_op_state: opState,
    p_only_if_status: "running",
    p_expected_revision: options.expectedRevision,
  };
  if (options.submissionOwner) params.p_submission_owner = options.submissionOwner;
  if (options.leaseSeconds) params.p_lease_seconds = options.leaseSeconds;
  const { data, error } = await db().rpc("update_bulk_operation", params);
  if (error) throw new Error(`Protected operation save failed: ${error.message}`);
  if (!isGuardedEnvelope(data)) throw new Error("Protected operation save returned no proof");
  return data;
}

export async function persistOpState(
  opKey: string,
  opState: OpState,
  onlyIfRunningOrOptions: boolean | PersistOptions = false,
): Promise<boolean> {
  const options: PersistOptions = typeof onlyIfRunningOrOptions === "boolean"
    ? { onlyIfRunning: onlyIfRunningOrOptions }
    : onlyIfRunningOrOptions;
  const client = db();
  const params: Record<string, unknown> = {
    p_op_key: opKey,
    p_op_state: opState,
  };
  if (options.onlyIfRunning) {
    params.p_only_if_status = "running";
  }
  if (options.expectedRevision !== undefined) params.p_expected_revision = options.expectedRevision;
  if (options.submissionOwner !== undefined) params.p_submission_owner = options.submissionOwner;
  if (options.leaseSeconds !== undefined) params.p_lease_seconds = options.leaseSeconds;
  const { data, error } = await client.rpc("update_bulk_operation", params);
  if (error) {
    logger.error("persist operation failed", { opKey, error: error.message });
    return false;
  }

  const guarded = options.expectedRevision !== undefined || options.submissionOwner !== undefined;
  if (guarded) {
    if (!isGuardedEnvelope(data) || !data.ok) return false;
    // A successful lease extension is not proof of ownership. Only the one caller
    // receiving the one-time receipt may submit a provider job.
    if (options.requireLeaseReceipt && !hasSubmissionLeaseReceipt(data)) return false;
    return true;
  }

  if (!data) return false;
  if (!options.onlyIfRunning) return true;
  // Check if our write was applied: the returned state should have status="running"
  const allOps = data as Record<string, OpState>;
  return allOps[opKey]?.status === "running";
}

/**
 * Second half of finishing a provider job: the receipt-proven terminal clear of
 * the exact stored "completed" job, issued immediately after it was saved.
 * Returns true when the job was cleared.
 */
export async function clearCompletedJobNow(
  opKey: string,
  saved: { ok: boolean; state_revision: number; operation?: unknown },
  leaseToken: string,
  persist: typeof guardedPersistOpState = guardedPersistOpState,
): Promise<boolean> {
  const stored = saved.operation as OpState | undefined;
  const storedJob = stored?.external_job;
  if (!stored || storedJob?.phase !== "completed" || !storedJob.provider_batch_id) return false;
  const metaTransition = storedJob.provider === "meta-responses" ? metaCompletedTransition(stored) : {};
  if (!metaTransition) return false;
  const clearState: OpState = {
    ...stored,
    status: storedJob.operation_done_after_clear === true ? "completed" : "running",
    ...metaTransition,
    external_job: { ...storedJob, lease_token: leaseToken, clear_after_reconciliation: true },
    updated_at: new Date().toISOString(),
  };
  try {
    const cleared = await persist(opKey, clearState, { expectedRevision: saved.state_revision });
    if (!cleared.ok) {
      logger.warn("tick: immediate clear of a completed provider job was refused; the next tick retries it", { opKey, reason: cleared.reason });
      return false;
    }
  } catch (error) {
    logger.warn("tick: immediate clear of a completed provider job failed; the next tick retries it", { opKey, error: normalizeBatchError(error, "clear failed").slice(0, 200) });
    return false;
  }
  submissionLeaseTokens.delete(opKey);
  acceptedBindingReceipts.delete(opKey);
  return true;
}

/** True when a waiting running operation needs a heartbeat to stay clear of the stale guard. */
export function needsWaitHeartbeat(op: OpState, nowMs = Date.now()): boolean {
  if (op.status !== "running" || !op.updated_at) return false;
  const updated = new Date(op.updated_at).getTime();
  return !Number.isFinite(updated) || nowMs - updated >= WAIT_HEARTBEAT_MS;
}

/**
 * Keep a waiting operation alive. A revision-guarded, non-claiming save that
 * carries the stored state (and its external_job) forward unchanged except for
 * updated_at; the database refuses it if anything moved underneath us.
 */
async function heartbeatWhileWaiting(opKey: string, state: OpState): Promise<void> {
  if (!needsWaitHeartbeat(state)) return;
  try {
    // A handler may have saved several pages since this snapshot was read.
    // Heartbeat only the latest exact-run checkpoint, never the caller's copy.
    const { data, error } = await withDependencyTimeout("Waiting operation checkpoint read", db().from("admin_config").select("value").eq("key", CONFIG_KEY).maybeSingle());
    if (error) throw new Error("Waiting operation checkpoint unavailable");
    const fresh = (data?.value as Record<string, OpState> | undefined)?.[opKey];
    if (!fresh || fresh.run_id !== state.run_id || !needsWaitHeartbeat(fresh)) return;
    state = fresh;
    const { lease_token: _leaseToken, ...storedJob } = state.external_job ?? ({} as NonNullable<OpState["external_job"]>);
    const heartbeat: OpState = {
      ...state,
      external_job: state.external_job ? storedJob as OpState["external_job"] : undefined,
      updated_at: new Date().toISOString(),
    };
    delete (heartbeat as { transient_prepared_batch?: unknown }).transient_prepared_batch;
    const saved = await guardedPersistOpState(opKey, heartbeat, { expectedRevision: state.state_revision ?? 0 });
    if (!saved.ok) logger.info("tick: wait heartbeat not applied", { opKey, reason: saved.reason });
  } catch (error) {
    logger.warn("tick: wait heartbeat failed", { opKey, error: normalizeBatchError(error, "heartbeat failed").slice(0, 200) });
  }
}

// ── Main tick — called every POLL_INTERVAL_MS ─────────────────────────────────

export async function tick(): Promise<void> {
  const client = db();

  // Best-effort, self-throttled (weekly) — never blocks or breaks the op loop.
  try {
    await withDependencyTimeout("SeaDrive mirror maintenance", maybeMirrorSeaDrive());
  } catch (error) {
    logger.warn("tick: SeaDrive maintenance exceeded its budget; continuing to queued operations", { error: String(error) });
  }
  try {
    await withDependencyTimeout("PopSG pending-tag maintenance", processPendingPopSGTags());
  } catch (error) {
    logger.warn("tick: PopSG maintenance exceeded its budget; continuing to queued operations", { error: String(error) });
  }

  // Load all operations
  const { data: configRow, error: configErr } = await withDependencyTimeout("Bulk operation acknowledgement reconciliation", client
    .from("admin_config")
    .select("value")
    .eq("key", CONFIG_KEY)
    .maybeSingle());

  if (configErr) {
    logger.error("tick: failed to load BULK_OPERATIONS", { error: configErr.message });
    return;
  }

  const allOps = (configRow?.value as Record<string, OpState>) || {};
  for (const [key, state] of Object.entries(allOps)) reconcileHeldAcknowledgement(key, state);
  synchronizeMetaReservations(allOps);
  await observePausedMetaResponse(allOps, await getMetaApiKey());
  const originalOps: Record<string, OpState> = { ...allOps };

  // Stale lock detection
  const staleUpdates: Record<string, OpState> = {};
  for (const [key, op] of Object.entries(allOps)) {
    if (detectStaleRun(op)) {
      logger.warn("tick: stale lock detected", { opKey: key, last_updated: op.updated_at });
      allOps[key] = {
        ...op,
        status: "interrupted",
        interruption_reason_code: "stale_run",
        error: `No progress for ${STALE_RUN_MINUTES}+ minutes — marked as stale`,
        next_auto_resume_at: nextAutoResumeAt("stale_run", op),
        updated_at: new Date().toISOString(),
      };
      staleUpdates[key] = allOps[key];
    }
  }

  // Persist stale lock changes
  // Revision-guarded: a newer save (e.g. a user Stop) must not be clobbered.
  for (const [key, op] of Object.entries(staleUpdates)) {
    const original = originalOps[key];
    const saved = await persistOpState(key, op, { expectedRevision: original?.state_revision ?? 0 });
    if (!saved) {
      logger.info("tick: stale-run save refused; state changed underneath", { opKey: key });
      allOps[key] = original;
    }
  }

  // Auto-resume interrupted ops (e.g. after a deploy killed the previous worker).
  // Only resume ops that were NOT stopped by the user and have a valid cursor.
  // Cap at AUTO_RESUME_MAX_ATTEMPTS to prevent infinite crash loops.
  const autoResumeUpdates: Record<string, OpState> = {};
  const autoResumeRunningKeys = new Set(
    Object.entries(allOps).filter(([, op]) => op.status === "running").map(([key]) => key),
  );
  for (const [key, op] of Object.entries(allOps)) {
    const lane = getLane(key);
    const laneBusy = [...autoResumeRunningKeys].some((runningKey) => getLane(runningKey) === lane);
    const crossLaneBusy = runningTagConflict(key, autoResumeRunningKeys);
    if (
      op.status === "interrupted" &&
      op.interruption_reason_code !== "user_stop" &&
      isTransientInterruption(op.interruption_reason_code) &&
      isValidAutoResumeCursor(key, op.cursor) &&
      (!op.next_auto_resume_at || new Date(op.next_auto_resume_at).getTime() <= Date.now()) &&
      (op.auto_resume_attempts ?? 0) < AUTO_RESUME_MAX_ATTEMPTS &&
      !laneBusy &&
      !crossLaneBusy
    ) {
      const attempts = (op.auto_resume_attempts ?? 0) + 1;
      logger.info("tick: auto-resuming interrupted op", {
        opKey: key,
        attempts,
        reason: op.interruption_reason_code,
        ...(key === "rebuild-style-groups" ? { run_id: op.run_id, ...rebuildCursorReceipt(key, op, op.cursor, op.last_successful_cursor) } : {}),
      });
      allOps[key] = {
        ...op,
        status: "running",
        auto_resume_attempts: attempts,
        last_auto_resume_at: new Date().toISOString(),
        next_auto_resume_at: undefined,
        updated_at: new Date().toISOString(),
      };
      autoResumeUpdates[key] = allOps[key];
      autoResumeRunningKeys.add(key);
    }
  }
  for (const [key, op] of Object.entries(autoResumeUpdates)) {
    const original = originalOps[key];
    const saved = await persistOpState(key, op, { expectedRevision: original?.state_revision ?? 0 });
    if (!saved) {
      logger.info("tick: auto-resume save refused; state changed underneath", { opKey: key });
      allOps[key] = original;
    }
  }

  // Promote queued ops into empty lanes
  const runningEntries = Object.entries(allOps).filter(([, op]) => op.status === "running");
  const activeLanes = new Set(runningEntries.map(([k]) => getLane(k)));

  const queuedEntries = Object.entries(allOps)
    .filter(([, op]) => op.status === "queued")
    .sort((a, b) => {
      const posA = a[1].queue_position ?? Number.MAX_SAFE_INTEGER;
      const posB = b[1].queue_position ?? Number.MAX_SAFE_INTEGER;
      if (posA !== posB) return posA - posB;
      return new Date(a[1].updated_at || 0).getTime() - new Date(b[1].updated_at || 0).getTime();
    });

  const runningKeys = new Set(runningEntries.map(([k]) => k));

  for (const [nextOpKey, nextOp] of queuedEntries) {
    const lane = getLane(nextOpKey);
    if (activeLanes.has(lane)) continue;

    // Cross-lane conflict check: skip if any currently-running op conflicts with this one
    const hasConflict = runningTagConflict(nextOpKey, runningKeys);
    if (hasConflict) continue;

    logger.info("tick: promoting queued op", { opKey: nextOpKey, lane });
    const promoted: OpState = {
      ...nextOp,
      status: "running",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const saved = await persistOpState(nextOpKey, promoted, { expectedRevision: nextOp.state_revision ?? 0 });
    if (!saved) {
      logger.info("tick: queue promotion refused; state changed underneath", { opKey: nextOpKey });
      continue;
    }
    allOps[nextOpKey] = promoted;
    runningEntries.push([nextOpKey, promoted]);
    runningKeys.add(nextOpKey);
    activeLanes.add(lane);
  }

  if (runningEntries.length === 0) {
    return; // Nothing to do — idle
  }

  // Round-robin: pick least-recently-updated running op
  runningEntries.sort((a, b) => {
    const aTime = a[1].updated_at ? new Date(a[1].updated_at).getTime() : 0;
    const bTime = b[1].updated_at ? new Date(b[1].updated_at).getTime() : 0;
    return aTime - bTime;
  });

  const [opKey, opState] = runningEntries[0] as [string, OpState];

  // Old UI bundles can create an already-running manual tag through the RPC.
  // Queue it before any dispatch; it promotes normally after the parallel run.
  if (opKey.startsWith("ai-tag-single-") && runningKeys.has("ai-tag-parallel")) {
    await persistOpState(opKey, {...opState, status: "queued", updated_at: new Date().toISOString()}, {
      onlyIfRunning: true, expectedRevision: opState.state_revision ?? 0,
    });
    return;
  }

  // A failed known-ID save is never re-dispatched or re-POSTed. Keep its original
  // receipt/acknowledgement in RAM for owned reconciliation, even after three CASes.
  if (acceptedAcknowledgements.has(opKey)) {
    await heartbeatWhileWaiting(opKey, opState);
    return;
  }

  // Legacy op: no cursor — it cannot be resumed safely.
  if (opState.cursor === undefined) {
    const failedState: OpState = {
      ...opState,
      run_id: opState.run_id ?? crypto.randomUUID(),
      status: "failed",
      interruption_reason_code: "legacy_format",
      error: "Operation state has no cursor and cannot be resumed safely",
      updated_at: new Date().toISOString(),
    };
    if (await persistOpState(opKey, failedState)) await recordStyleGroupTerminalOutcome(opKey, failedState, "failed");
    logger.warn("tick: legacy op failed", { opKey });
    return;
  }

  // Create a mutable copy of opState to avoid mutating the original
  let currentState = { ...opState };
  if (!currentState.run_id) {
    currentState = { ...currentState, run_id: Math.random().toString(36).slice(2) };
  }

  let cursor = currentState.cursor ?? 0;
  let progress = { ...(currentState.progress ?? {}) };
  let batchCount = 0;

  logger.info("tick: processing op", { opKey, cursor, run_id: opState.run_id });

  // Process batches until done or user stops
  while (true) {
    // Periodic interrupt check (every 10 batches)
    if (batchCount > 0 && batchCount % INTERRUPT_CHECK_EVERY === 0) {
      const { data: freshConfig, error: freshErr } = await client
        .from("admin_config")
        .select("value")
        .eq("key", CONFIG_KEY)
        .maybeSingle();
      if (freshErr) {
        // A failed read is not a Stop; keep going and re-check next interval.
        logger.warn("tick: stop-check read failed; continuing", { opKey, error: freshErr.message });
      } else if (((freshConfig?.value as Record<string, OpState>) || {})[opKey]?.status !== "running") {
        logger.info("tick: op stopped by user", { opKey, batches: batchCount });
        return;
      }
    }

    if (awaitsDefinitiveRejectionFailure(currentState)) {
      // The receipt was reset (provider rejection or never-submitted) but the
      // failure write did not land (crash or refused save). Finish it under the
      // reason the database recorded, instead of resubmitting a payload that is
      // known to be rejected or a batch we already gave up preparing.
      const outcome = await finishInterruptedReset(
        (fn, params) => db().rpc(fn, params),
        opKey,
        { ...currentState, cursor, progress },
        currentState.state_revision ?? 0,
      )!;
      // The receipt was consumed by the reset; nothing in memory may carry over.
      forgetSubmissionState(opKey);
      await recordStyleGroupTerminalOutcome(opKey, outcome.state, "failed");
      logger.error("tick: completed the durable failure for a reset batch submission", { opKey });
      return;
    }

    const heldRetryToken = submissionLeaseTokens.get(opKey);
    const heldSubmittingJob = currentState.external_job;
    if (heldRetryToken && heldSubmittingJob?.phase === "submitting" && !heldSubmittingJob.provider_batch_id
      && (pendingNotSubmittedResets.has(opKey) || !leaseCoversAnotherAttempt(heldSubmittingJob.lease_expires_at))) {
      preSubmissionRetries.delete(opKey);
      if (remainingLeaseMs(heldSubmittingJob.lease_expires_at) === 0) {
        submissionLeaseTokens.delete(opKey);
        pendingNotSubmittedResets.delete(opKey);
        // Already lapsed: the governed reset requires a live receipt, so only
        // the database's lease reconciliation can resolve it now.
        logger.error("tick: held submission lease lapsed before a pre-POST retry; leaving it to lease reconciliation", { opKey });
        return;
      }
      const pendingReset = pendingNotSubmittedResets.get(opKey);
      if (pendingReset?.kind === "definitive_rejection") {
        const failed = await failDefinitivelyRejectedSubmission(
          opKey, currentState, currentState.state_revision ?? 0,
          submissionOwnerForRun(currentState.run_id), heldRetryToken, pendingReset.rejection,
        );
        await recordStyleGroupTerminalOutcome(opKey, failed, "failed");
        return;
      }
      // A pre-POST retry is pending but the held lease can no longer cover a
      // rebuild plus renewal. Reset it as never-submitted while it is live.
      await failNeverSentSubmission(
        opKey, currentState, currentState.state_revision ?? 0,
        submissionOwnerForRun(currentState.run_id), heldRetryToken,
        new PreSubmissionError("Submission lease cannot cover another preparation attempt"),
      );
      return;
    }

    let result: BatchResult;
    try {
      const retryAfter = submissionLeaseRetryAfter.get(opKey) ?? 0;
      if (currentState.external_job && !submissionLeaseTokens.has(opKey) && !boundProviderReceipt(opKey, currentState) && retryAfter > Date.now()) {
        await heartbeatWhileWaiting(opKey, currentState);
        return;
      }
      const rememberedLeaseToken = boundProviderReceipt(opKey, currentState) ?? submissionLeaseTokens.get(opKey);
      const cachedPayload = preparedPayloads.get(opKey);
      preparedPayloads.delete(opKey);
      const reusablePayload = cachedPayload && currentState.external_job?.phase === "prepared"
        && cachedPayload.preparedAt === currentState.external_job.prepared_at
        ? cachedPayload.payload
        : undefined;
      result = await dispatch(opKey, {
        ...currentState,
        cursor,
        progress,
        external_job: currentState.external_job && rememberedLeaseToken
          ? { ...currentState.external_job, lease_token: rememberedLeaseToken }
          : currentState.external_job,
        ...(reusablePayload ? { transient_prepared_batch: reusablePayload } : {}),
      });
    } catch (e) {
      const heldJob = currentState.external_job;
      const heldReceiptToken = submissionLeaseTokens.get(opKey);
      if (heldReceiptToken && heldJob?.phase === "submitting" && !heldJob.provider_batch_id) {
        // With a held receipt on an unbound submitting job, this dispatch only
        // rebuilds the payload; no provider request was sent.
        if (!holdReceiptAfterPreSubmissionFailure(opKey, e, heldJob.lease_expires_at)) {
          await failNeverSentSubmission(
            opKey, currentState, currentState.state_revision ?? 0,
            submissionOwnerForRun(currentState.run_id), heldReceiptToken, e,
          );
        }
        return;
      }
      const errMsg = normalizeBatchError(e, "Dispatch failed without an error message");
      const reason = classifyError(errMsg);
      logger.error("tick: dispatch threw", { opKey, error: errMsg });
      const failureState: OpState = {
        ...currentState,
        cursor,
        progress,
        status: isTransientInterruption(reason) ? "interrupted" : "failed",
        interruption_reason_code: reason,
        error: errMsg,
        last_stage: currentState.last_stage,
        last_stage_started_at: currentState.last_stage_started_at,
        last_successful_cursor: cursor,
        next_auto_resume_at: nextAutoResumeAt(reason, currentState),
        updated_at: new Date().toISOString(),
      };
      const persisted = await persistOpState(opKey, failureState);
      if (persisted && failureState.status === "failed") await recordStyleGroupTerminalOutcome(opKey, failureState, "failed");
      return;
    }

    if (result.state_transition === "claim_submission") {
      const owner = submissionOwnerForRun(currentState.run_id);
      const claimState: OpState = {
        ...currentState,
        cursor,
        progress,
        external_job: {
          ...currentState.external_job!,
          phase: currentState.external_job?.phase === "prepared" ? "submitting" : currentState.external_job!.phase,
        },
        updated_at: new Date().toISOString(),
      };
      const claim = await guardedPersistOpState(opKey, claimState, {
        expectedRevision: currentState.state_revision ?? 0,
        submissionOwner: owner,
        leaseSeconds: 120,
      });
      // A same-owner renewal over our own live lease keeps the incumbent receipt
      // (the database never re-mints it); only the worker that still holds that
      // receipt in memory may continue with it.
      const heldToken = submissionLeaseTokens.get(opKey);
      const renewedHeldReceipt = Boolean(claim.ok && !claim.lease_receipt_issued && heldToken
        && claim.submission_owner === owner && !claim.provider_batch_id
        && currentState.external_job?.phase === "submitting");
      const leaseToken = renewedHeldReceipt ? heldToken! : claim.lease_token;
      if (!leaseToken || (!renewedHeldReceipt && (!claim.ok || !claim.lease_receipt_issued))) {
        const retryAt = claim.lease_expires_at ? new Date(claim.lease_expires_at).getTime() : Date.now() + 30_000;
        submissionLeaseRetryAfter.set(opKey, Number.isFinite(retryAt) ? retryAt + 250 : Date.now() + 30_000);
        logger.info("tick: submission lease was not issued to this worker", { opKey, reason: claim.reason });
        return;
      }
      const claimedState = claim.operation as OpState;
      submissionLeaseRetryAfter.delete(opKey);
      rememberSubmissionReceipt(opKey, leaseToken);
      try {
        result = await dispatch(opKey, {
          ...claimedState,
          external_job: { ...claimedState.external_job!, lease_token: leaseToken },
          // This payload was fully built before claiming the one-time receipt.
          // It exists only for this in-process dispatch and is never persisted.
          transient_prepared_batch: result.transient_prepared_batch,
        });
      } catch (error) {
        if (error instanceof PreSubmissionError) {
          if (!holdReceiptAfterPreSubmissionFailure(opKey, error, claimedState.external_job?.lease_expires_at)) {
            await failNeverSentSubmission(opKey, claimedState, claim.state_revision, owner, leaseToken, error);
          }
          return;
        }
        if (error instanceof DefinitiveBatchRejectionError) {
          // The provider itself parsed and refused the payload (validation 400/
          // 422 or auth/billing/rate-limit 401/402/403/429), so no batch exists.
          // Consume this receipt through the governed reset RPC, then fail the
          // operation durably on the next revision (exactly once: both writes are
          // revision- and receipt-guarded). The receipt is kept until that lands.
          preSubmissionRetries.delete(opKey);
          const failed = await failDefinitivelyRejectedSubmission(opKey, claimedState, claim.state_revision, owner, leaseToken, error);
          if (failed.status === "failed") {
            await recordStyleGroupTerminalOutcome(opKey, failed, "failed");
            logger.error("tick: provider definitively rejected the batch submission", { opKey, error: failed.error });
          } else {
            logger.info("tick: advancing Meta structured-output method after a definitive rejection", { opKey });
          }
          return;
        }
        submissionLeaseTokens.delete(opKey);
        preSubmissionRetries.delete(opKey);
        // Everything else -- a timeout, disconnect, 5xx, any other status, an
        // unparseable response, or an unexpected error that is not a proven
        // pre-POST failure -- cannot prove the provider created nothing.
        // Never reset the lease here.
        if (!(error instanceof AmbiguousBatchSubmissionError)) {
          logger.error("tick: provider submission failed after the receipt was minted; treating as ambiguous", {
            opKey,
            error: normalizeBatchError(error, "Provider batch submission failed without an error message").slice(0, 300),
          });
        }
        const leaseEnd = claimedState.external_job?.lease_expires_at
          ? new Date(claimedState.external_job.lease_expires_at).getTime()
          : Date.now() + 120_000;
        submissionLeaseRetryAfter.set(opKey, Number.isFinite(leaseEnd) ? leaseEnd + 250 : Date.now() + 120_000);
        // Preserve the database-owned `submitting` state. After this receipt's
        // lease expires, the next guarded claim is what durably transitions it
        // to ambiguous_submission; callers are forbidden from creating it.
        logger.error("tick: provider batch submission outcome indeterminate; waiting for database lease reconciliation", { opKey });
        return;
      }
      if (!result.ok) {
        // Previously this threw straight out of tick(). index.ts only logs, so
        // the operation stayed "running" in admin_config with no error visible
        // in the UI and with this worker still holding the submission lease.
        // Persist the same interrupted state the dispatch-throw path writes.
        const errMsg = normalizeBatchError(result.error, "Provider batch submission failed without an error message");
        const reason = classifyError(errMsg);
        submissionLeaseTokens.delete(opKey);
        logger.error("tick: provider batch submission failed", { opKey, error: errMsg });
        await persistOpState(opKey, {
          ...claimedState,
          cursor,
          progress,
          status: "interrupted",
          interruption_reason_code: reason,
          error: errMsg,
          last_successful_cursor: cursor,
          next_auto_resume_at: nextAutoResumeAt(reason, claimedState),
          updated_at: new Date().toISOString(),
        });
        return;
      }
      if (claimedState.external_job?.provider_batch_id) {
        // A reattached known-ID job was polled/applied, not submitted. Its
        // returned phase may already be completed, so it must use the normal
        // receipt-proven phase writer below, not the new-POST acknowledgement
        // binder (which requires the old state to be unbound/submitting).
        // Continue from the freshly claimed revision; never reuse the pre-claim
        // revision or mint another submission acknowledgement for this job.
        currentState = claimedState;
      } else {
        const submittedState: OpState = {
          ...claimedState,
          status: result.done ? "completed" : "running",
          cursor: (result.nextOffset as number | string | undefined) ?? claimedState.cursor,
          progress: mergeProgress(opKey, progress, result),
          external_job: result.external_job as OpState["external_job"],
          updated_at: new Date().toISOString(),
        };
        const acknowledgement: AcceptedProviderAcknowledgement = { opKey, claimed: structuredClone(claimedState), submitted: structuredClone(submittedState), leaseToken, owner, attempts: 0 };
        const savedAcknowledgement = await saveAcceptedAcknowledgement(acknowledgement,
          (fn, params) => db().rpc(fn, params),
          async () => {
            const { data, error } = await db().from("admin_config").select("value").eq("key", CONFIG_KEY).maybeSingle();
            if (error) throw new Error("Accepted acknowledgement read failed");
            return (data?.value as Record<string, OpState> | undefined)?.[opKey] ?? null;
          });
        if (!savedAcknowledgement.saved) {
          logger.error("tick: accepted provider acknowledgement remains held in memory; no new submission is authorized", { attempts: acknowledgement.attempts, reason: savedAcknowledgement.reason });
          return;
        }
        preSubmissionRetries.delete(opKey);
        if (result.done) submissionLeaseTokens.delete(opKey);
        logger.info("tick: durable provider batch saved", {
          opKey,
          batchId: submittedState.external_job?.provider_batch_id,
        });
        return;
      }
    }
    if (result.state_transition === "yield_without_save") {
      await heartbeatWhileWaiting(opKey, currentState);
      return;
    }

    const resultJob = result.external_job as OpState["external_job"] | undefined;
    if (!result.ok && currentState.external_job) {
      // Items applied before the stop are checkpointed on the job; count them.
      const protectedErrorState = providerJobErrorState(currentState, result, resultJob, cursor, mergeProgress(opKey, progress, result));
      const saved = await guardedPersistOpState(opKey, protectedErrorState, {
        expectedRevision: currentState.state_revision ?? 0,
      });
      if (!saved.ok) throw new Error(`Protected provider failure save refused: ${saved.reason}`);
      refreshBoundProviderAccount(opKey, currentState, protectedErrorState, saved);
      // The guarded write only applies to a still-running operation at the
      // expected revision, so the terminal outcome is recorded exactly once.
      if (protectedErrorState.status === "failed") await recordStyleGroupTerminalOutcome(opKey, protectedErrorState, "failed");
      return;
    }
    // A receipt-proven write, or the governed receipt-less clear of a completed
    // job whose lease expired after a crash (shared-db #3543).
    if ((resultJob?.lease_token || resultJob?.clear_after_reconciliation) && currentState.external_job) {
      const guardedState: OpState = {
        ...currentState,
        status: result.done ? "completed" : "running",
        cursor: (result.nextOffset as number | string | undefined) ?? cursor,
        progress: mergeProgress(opKey, progress, result),
        meta_tag_attempt: result.meta_tag_attempt !== undefined ? result.meta_tag_attempt as OpState["meta_tag_attempt"] : currentState.meta_tag_attempt,
        external_job: resultJob,
        updated_at: new Date().toISOString(),
      };
      const saved = await guardedPersistOpState(opKey, guardedState, {
        expectedRevision: currentState.state_revision ?? 0,
      });
      if (!saved.ok && saved.reason === "already_cleared" && resultJob.clear_after_reconciliation) {
        acceptedBindingReceipts.delete(opKey);
        // Idempotent repeat clear: another tick already cleared this job.
        submissionLeaseTokens.delete(opKey);
        return;
      }
      if (!saved.ok) throw new Error(`Protected provider state save refused: ${saved.reason}`);
      refreshBoundProviderAccount(opKey, currentState, guardedState, saved);
      if (result.done || resultJob.clear_after_reconciliation) {
        acceptedBindingReceipts.delete(opKey);
        submissionLeaseTokens.delete(opKey);
        return;
      }
      if (resultJob.phase === "completed" && resultJob.lease_token) {
        // Clear right away while this worker still holds the receipt. The
        // database only clears a stored "completed" job with a live receipt and
        // never re-issues one for it, so waiting for the next tick would leave a
        // restart in between with a job that can never be cleared.
        await clearCompletedJobNow(opKey, saved, resultJob.lease_token);
      }
      return;
    }

    progress = mergeProgress(opKey, progress, result);
    batchCount++;

    // Kill switch: stop automatically on systematic or high-rate failures.
    // Scoped to the current run via started_at so restarting resets the window.
    const killReason = detectFailureKillSwitch(progress, currentState.started_at);
    if (killReason) {
      logger.error("tick: failure kill switch triggered", { opKey, reason: killReason, batchCount });
      const failureState: OpState = {
        ...currentState,
        cursor,
        progress,
        status: "failed",
        interruption_reason_code: "repeated_failure",
        error: `Auto-stopped: ${killReason}`,
        updated_at: new Date().toISOString(),
      };
      if (await persistOpState(opKey, failureState)) await recordStyleGroupTerminalOutcome(opKey, failureState, "failed");
      return;
    }

    if (!result.ok) {
      const batchErr = normalizeBatchError(result.error);
      const reason = interruptionReason(result);
      logger.error("tick: batch failed", {
        opKey,
        run_id: currentState.run_id,
        error: batchErr,
        reason,
        stage: result.error_stage,
        batchCount,
        page_size: result.retry_page_size ?? currentState.retry_page_size,
        cursor_version: typeof cursor === "string" ? cursor.split(":", 1)[0] : "numeric",
        elapsed_ms: result.elapsed_ms,
        postgres_code: result.postgres_code,
        // The loop cursor reflects the latest operation checkpoint whose save returned true;
        // currentState still holds the prior persisted snapshot until the next iteration.
        ...rebuildCursorReceipt(opKey, currentState, cursor, cursor),
      });
      const failureState: OpState = {
        ...currentState,
        cursor,
        progress,
        status: isTransientInterruption(reason) ? "interrupted" : "failed",
        interruption_reason_code: reason,
        error: batchErr,
        last_stage: result.error_stage,
        last_stage_started_at: result.last_stage_started_at,
        last_successful_cursor: cursor,
        retry_page_size: result.retry_page_size ?? currentState.retry_page_size,
        next_auto_resume_at: nextAutoResumeAt(reason, currentState),
        updated_at: new Date().toISOString(),
      };
      const persisted = await persistOpState(opKey, failureState);
      if (persisted && failureState.status === "failed") await recordStyleGroupTerminalOutcome(opKey, failureState, "failed");
      return;
    }

    // The guarded writer refuses to drop a protected external_job (a live
    // provider job it believes exists: a prepared/submitting/pending/applying
    // phase, a bound provider_batch_id, or an unresolved ambiguity). A handler
    // that asks to clear such a job would make the save a permanent no-op and
    // leave the operation running forever on the same page, so fail it visibly
    // instead of silently stalling.
    //
    // Before this check, persistOpState's refused save read as an external stop,
    // the loop returned, and the next tick re-ran the identical page: a silent
    // infinite loop. Advancing past the page is impossible without dropping the
    // pointer, which shared-db forbids (external_job_protected), so a visible
    // failure is the only safe outcome available to the worker.
    if (result.clear_external_job && isProtectedExternalJob(currentState.external_job)) {
      logger.error("tick: refused to clear a protected external_job; failing the operation", {
        opKey,
        phase: currentState.external_job?.phase,
        provider_batch_id: currentState.external_job?.provider_batch_id,
      });
      const failed = await failClaimedOperation(
        (fn, params) => db().rpc(fn, params),
        opKey,
        { ...currentState, cursor, progress },
        currentState.state_revision ?? 0,
        "protected_external_job_clear_refused",
        "The batch handler asked to clear a live provider job; the operation was failed for operator review instead of stalling",
      );
      await recordStyleGroupTerminalOutcome(opKey, failed, "failed");
      return;
    }

    const operationCursorBeforeBatch = cursor;
    const wasAutoResumed = opKey === "rebuild-style-groups" && (currentState.auto_resume_attempts ?? 0) > 0;
    const autoResumeAttempts = currentState.auto_resume_attempts ?? 0;
    currentState = {
      ...currentState,
      meta_tag_attempt: result.meta_tag_attempt !== undefined ? result.meta_tag_attempt as OpState["meta_tag_attempt"] : currentState.meta_tag_attempt,
      external_job: result.clear_external_job
        ? undefined
        : (result.external_job as OpState["external_job"] | undefined) ?? currentState.external_job,
      error: undefined,
      interruption_reason_code: undefined,
      next_auto_resume_at: undefined,
      retry_page_size: undefined,
      last_stage: result.last_stage,
      last_stage_started_at: result.last_stage_started_at,
    };

    // Advance cursor
    if (result.nextOffset !== undefined && result.nextOffset !== null) {
      cursor = result.nextOffset as number | string;
    } else if (typeof cursor === "number") {
      cursor = cursor + 1;
    }

    // Save progress after every batch — conditional on status still being "running"
    // so a user stop isn't silently overwritten by the worker's next persist.
    const stillRunning = await persistOpState(opKey, {
      ...currentState,
      cursor,
      progress,
      status: "running",
      error: undefined,
      interruption_reason_code: undefined,
      next_auto_resume_at: undefined,
      retry_page_size: undefined,
      last_stage: result.last_stage,
      last_stage_started_at: result.last_stage_started_at,
      last_successful_cursor: cursor,
      updated_at: new Date().toISOString(),
    }, true);
    if (!stillRunning) {
      logger.info("tick: op stopped externally — aborting after batch", { opKey, batchCount });
      return;
    }

    if (wasAutoResumed) {
      logger.info("tick: resumed rebuild batch persisted", {
        opKey,
        run_id: currentState.run_id,
        attempts: autoResumeAttempts,
        ...rebuildCursorReceipt(opKey, currentState, cursor, cursor),
        operation_cursor_before_sha256: hashCursorCheckpoint("operation", opKey, "cursor", operationCursorBeforeBatch ?? null),
        operation_cursor_after_sha256: hashCursorCheckpoint("operation", opKey, "cursor", cursor ?? null),
      });
    }

    // Reload the database-assigned revision before attempting the submission
    // lease. Continuing in this same loop would claim with the old revision.
    if (result.external_job) {
      const preparedJob = result.external_job as OpState["external_job"];
      if (preparedJob?.phase === "prepared" && preparedJob.prepared_at && result.transient_prepared_batch) {
        preparedPayloads.set(opKey, { preparedAt: preparedJob.prepared_at, payload: result.transient_prepared_batch });
      }
      return;
    }

    if (result.done) {
      logger.info("tick: op completed", { opKey, batches: batchCount, progress });
      const completedState: OpState = {
        ...currentState,
        cursor,
        progress,
        status: "completed",
        error: undefined,
        interruption_reason_code: undefined,
        next_auto_resume_at: undefined,
        retry_page_size: undefined,
        last_stage: result.last_stage,
        last_stage_started_at: result.last_stage_started_at,
        last_successful_cursor: cursor,
        result_message: buildResultMessage(opKey, progress),
        updated_at: new Date().toISOString(),
      };
      if (await persistOpState(opKey, completedState)) await recordStyleGroupTerminalOutcome(opKey, completedState, "succeeded");
      return;
    }

    // Yield after MAX_BATCHES_PER_TICK so other operations get a turn
    if (batchCount >= operationBatchLimit(opKey)) {
      logger.info("tick: yielding after max batches", { opKey, batches: batchCount, cursor });
      return; // State already saved above; main loop re-enters tick()
    }
  }
}
