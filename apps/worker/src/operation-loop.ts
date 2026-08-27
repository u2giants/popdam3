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
import { handleCleanupMegaGroupTags, handleRebuildStyleGroups, handleReconcileStyleGroupStats } from "./handlers/style-groups.js";
import { handleRelinkOrphanedAssets } from "./handlers/relink-orphaned.js";
import { handlePropagateGroupTags } from "./handlers/tag-propagation.js";
import { handleRefreshGroupMetadata } from "./handlers/group-metadata-refresh.js";
import { handleApplyErpEnrichment, handleClassifyErpCategories } from "./handlers/erp.js";
import { handleRichPdfExtract } from "./handlers/rich-pdf.js";
import { handlePopSGFileTags, processPendingPopSGTags } from "./handlers/popsg-tags.js";
import { maybeMirrorSeaDrive } from "./handlers/seadrive-mirror.js";
import {
  getNextAutoResumeAt,
  isTransientInterruption,
  isValidAutoResumeCursor,
} from "./operation-retry.js";

const CONFIG_KEY = "BULK_OPERATIONS";
const STALE_RUN_MINUTES = 10;
const INTERRUPT_CHECK_EVERY = 10;
const AUTO_RESUME_MAX_ATTEMPTS = 10;
const submissionLeaseTokens = new Map<string, string>();
const submissionLeaseRetryAfter = new Map<string, number>();
/** Yield after this many batches so the round-robin can serve other operations.
 *  Under the old 45s edge function, 5 was the max that fit safely. The persistent
 *  worker has no timeout, so 50 keeps ops running hot while still yielding often
 *  enough to check for user interruptions and serve other lanes. */
const MAX_BATCHES_PER_TICK = 50;

// Lane isolation — operations in the same lane are mutually exclusive
const OP_LANES: Record<string, string> = {
  "ai-tag-untagged": "ai-tagging",
  "ai-tag-all": "ai-tagging",
  "ai-tag-groups": "ai-tagging",
  "ai-tag-group-profiles": "ai-tagging",
  "ai-tag-bakeoff": "ai-tagging",
  "rebuild-style-groups": "style-groups",
  "reconcile-style-group-stats": "style-groups",
  "reprocess-metadata": "metadata",
  "backfill-sku-names": "metadata",
  "erp-enrichment": "erp",
  "erp-classify": "erp",
  "propagate-group-tags": "style-groups",
  "refresh-group-metadata": "style-groups",
  "cleanup-mega-group-tags": "style-groups",
  "relink-orphaned-assets": "style-groups",
  "tag-popsg-files": "popsg-tags",
  "rich-pdf-extract": "rich-pdf",
};

// Cross-lane conflicts — operations in DIFFERENT lanes that still cannot run simultaneously.
// Root cause: speculative-insert index locks on asset_tags B-tree index when both ai-tag and
// propagate-group-tags INSERT the same (asset_id, tag) pair. SKIP LOCKED only fixes UPDATE
// locks, not INSERT index locks. Must be kept in sync with:
//   supabase/functions/_shared/operation-constants.ts  (backend enforcement)
//   src/components/settings/diagnostics/types.ts       (UI pre-flight check)
const OP_CONFLICTS: Readonly<Record<string, readonly string[]>> = {
  "ai-tag-untagged":      ["rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-group-profiles", "refresh-group-metadata"],
  "ai-tag-all":           ["rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-group-profiles", "refresh-group-metadata"],
  "ai-tag-groups":        ["rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-group-profiles", "refresh-group-metadata"],
  "ai-tag-group-profiles": ["rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-bakeoff", "refresh-group-metadata"],
  "ai-tag-bakeoff":       ["rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-group-profiles", "refresh-group-metadata"],
  "propagate-group-tags": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-bakeoff", "ai-tag-group-profiles"],
  "refresh-group-metadata": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-bakeoff", "ai-tag-group-profiles"],
  "rebuild-style-groups": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-bakeoff", "rich-pdf-extract", "ai-tag-group-profiles"],
  "rich-pdf-extract":     ["rebuild-style-groups"],
  "reprocess-metadata":   ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-bakeoff", "erp-enrichment", "ai-tag-group-profiles"],
  "backfill-sku-names":   ["erp-enrichment"],
  "erp-enrichment":       ["reprocess-metadata", "backfill-sku-names"],
};

function getLane(opKey: string): string {
  if (opKey.startsWith("ai-tag-single-")) return "ai-tagging";
  return OP_LANES[opKey] ?? opKey;
}

function detectStaleRun(op: OpState): boolean {
  if (op.status !== "running") return false;
  if (!op.updated_at) return false;
  const ageMs = Date.now() - new Date(op.updated_at).getTime();
  return ageMs > STALE_RUN_MINUTES * 60 * 1000;
}

// ── Progress accumulator — mirrors buildProgress() in bulk-job-runner ────────

export function mergeProgress(opKey: string, prev: Record<string, unknown>, batch: BatchResult): Record<string, unknown> {
  // Normalize dynamic keys for matching
  const normalizedKey = opKey.startsWith("ai-tag-single-") ? "ai-tag-all" : opKey;
  switch (normalizedKey) {
    case "ai-tag-untagged":
    case "ai-tag-all":
    case "ai-tag-groups": {
      const prevFail = Array.isArray(prev.failure_samples) ? prev.failure_samples as unknown[] : [];
      const batchFail = Array.isArray(batch.failure_samples) ? batch.failure_samples as unknown[] : [];
      const prevSkip = Array.isArray(prev.skip_samples) ? prev.skip_samples as unknown[] : [];
      const batchSkip = Array.isArray(batch.skip_samples) ? batch.skip_samples as unknown[] : [];
      return {
        tagged: ((prev.tagged as number) || 0) + ((batch.tagged as number) || 0),
        skipped: ((prev.skipped as number) || 0) + ((batch.skipped as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        visual_analysis_unavailable: ((prev.visual_analysis_unavailable as number) || 0) + ((batch.visual_analysis_unavailable as number) || 0),
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
    case "rebuild-style-groups":
      return {
        groups: ((prev.groups as number) || 0) + ((batch.groups_created as number) || 0),
        assigned: ((prev.assigned as number) || 0) + ((batch.assets_assigned as number) || 0),
        cleared: ((prev.cleared as number) || 0) + ((batch.cleared_assets as number) || 0),
        groups_deleted: ((prev.groups_deleted as number) || 0) + ((batch.groups_deleted as number) || 0),
        total_groups_before_delete: Math.max((prev.total_groups_before_delete as number) || 0, (batch.total_groups_before_delete as number) || 0),
        total_processed: Math.max((prev.total_processed as number) || 0, (batch.total_processed as number) || 0),
        total_assets: Math.max((prev.total_assets as number) || 0, (batch.total_assets as number) || 0),
        counts_processed: Math.max((prev.counts_processed as number) || 0, (batch.counts_processed as number) || 0),
        primaries_processed: Math.max((prev.primaries_processed as number) || 0, (batch.primaries_processed as number) || 0),
        finalize_total_groups: Math.max((prev.finalize_total_groups as number) || 0, (batch.finalize_total_groups as number) || 0),
        stage: batch.stage || prev.stage,
        substage: batch.sub || batch.substage || prev.substage,
      };
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
    case "erp-classify":
      return {
        classified: ((prev.classified as number) || 0) + ((batch.classified as number) || 0),
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
    default:
      return { ...prev, ...batch };
  }
}

// ── Error classifier ─────────────────────────────────────────────────────────

/** Map a raw error message to a known reason_code. */
function classifyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("canceling statement due to statement timeout")) return "statement_timeout";
  if (m.includes("bad gateway") || m.includes("502") || m.includes("503") || m.includes("504")) return "gateway_timeout";
  if (m.includes("too many connections") || m.includes("connection refused")) return "connection_error";
  if (m.includes("rate limit") || m.includes("429")) return "rate_limited";
  return "unknown";
}

function interruptionReason(result: BatchResult): string {
  if (result.error_code === "legacy_cursor" || result.error_code === "invalid_cursor") {
    return result.error_code;
  }
  return classifyError(result.error ?? "Batch failed");
}

function nextAutoResumeAt(reason: string, op: OpState): string | undefined {
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
function detectFailureKillSwitch(progress: Record<string, unknown>, startedAt?: string): string | null {
  const allSamples = progress.failure_samples as Array<{ at?: string; error?: string }> | undefined;
  const startMs = startedAt ? new Date(startedAt).getTime() : 0;

  // Only consider failures from the current run (filter by started_at)
  const samples = allSamples?.filter((s) => !s.at || new Date(s.at).getTime() >= startMs);

  const failed  = (progress.failed  as number) || 0;
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
      return `Tagged ${progress.tagged}. ${progress.visual_analysis_unavailable || 0} visual analyses unavailable. ${progress.skipped || 0} skipped. ${progress.failed || 0} failed.`;
    case "ai-tag-group-profiles":
      return `Profiled ${progress.profiled || 0} style groups. ${progress.visual_analysis_unavailable || 0} without usable representative images. ${progress.failed || 0} failed.`;
    case "ai-tag-bakeoff":
      return `Evaluated ${progress.evaluated || 0} model responses. ${progress.failed || 0} failed.`;
    case "rebuild-style-groups":
      return `Created ${progress.groups} style groups, assigned ${progress.assigned} assets`;
    case "reconcile-style-group-stats":
      return `Reconciled counts for ${progress.counts_processed || 0} groups, primaries for ${progress.primaries_processed || 0} groups`;
    case "erp-enrichment":
      return `Enriched ${progress.assets_updated || 0} assets, ${progress.groups_updated || 0} groups`;
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
    case "ai-tag-bakeoff":
      return handleAiTagBakeoff(opState);
    case "ai-tag-group-profiles":
      return handleStyleGroupProfiles(opState);
    case "rebuild-style-groups":
      return handleRebuildStyleGroups(opState);
    case "reconcile-style-group-stats":
      return handleReconcileStyleGroupStats(opState);
    case "propagate-group-tags":
      return handlePropagateGroupTags(opState);
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
    case "rich-pdf-extract":
      return handleRichPdfExtract(opState);
    case "tag-popsg-files":
      return handlePopSGFileTags(opState);
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

// ── Main tick — called every POLL_INTERVAL_MS ─────────────────────────────────

export async function tick(): Promise<void> {
  const client = db();

  // Best-effort, self-throttled (weekly) — never blocks or breaks the op loop.
  await maybeMirrorSeaDrive();
  await processPendingPopSGTags();

  // Load all operations
  const { data: configRow, error: configErr } = await client
    .from("admin_config")
    .select("value")
    .eq("key", CONFIG_KEY)
    .maybeSingle();

  if (configErr) {
    logger.error("tick: failed to load BULK_OPERATIONS", { error: configErr.message });
    return;
  }

  const allOps = (configRow?.value as Record<string, OpState>) || {};

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
  for (const [key, op] of Object.entries(staleUpdates)) {
    await persistOpState(key, op);
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
    const crossLaneBusy = (OP_CONFLICTS[key] ?? []).some((conflictKey) => autoResumeRunningKeys.has(conflictKey));
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
      logger.info("tick: auto-resuming interrupted op", { opKey: key, attempts, reason: op.interruption_reason_code });
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
    await persistOpState(key, op);
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
    const crossConflicts = OP_CONFLICTS[nextOpKey] ?? [];
    const hasConflict = crossConflicts.some((conflictKey) => runningKeys.has(conflictKey));
    if (hasConflict) continue;

    logger.info("tick: promoting queued op", { opKey: nextOpKey, lane });
    allOps[nextOpKey] = {
      ...nextOp,
      status: "running",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    runningEntries.push([nextOpKey, allOps[nextOpKey]]);
    runningKeys.add(nextOpKey);
    activeLanes.add(lane);
    await persistOpState(nextOpKey, allOps[nextOpKey]);
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

  // Legacy op: no cursor — mark interrupted
  if (opState.cursor === undefined) {
    await persistOpState(opKey, {
      ...opState,
      status: "interrupted",
      interruption_reason_code: "legacy_format",
      updated_at: new Date().toISOString(),
    });
    logger.warn("tick: legacy op interrupted", { opKey });
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
      const { data: freshConfig } = await client
        .from("admin_config")
        .select("value")
        .eq("key", CONFIG_KEY)
        .maybeSingle();
      const freshOps = (freshConfig?.value as Record<string, OpState>) || {};
      if (freshOps[opKey]?.status !== "running") {
        logger.info("tick: op stopped by user", { opKey, batches: batchCount });
        return;
      }
    }

    let result: BatchResult;
    try {
      const retryAfter = submissionLeaseRetryAfter.get(opKey) ?? 0;
      if (currentState.external_job && !submissionLeaseTokens.has(opKey) && retryAfter > Date.now()) return;
      const rememberedLeaseToken = submissionLeaseTokens.get(opKey);
      result = await dispatch(opKey, {
        ...currentState,
        cursor,
        progress,
        external_job: currentState.external_job && rememberedLeaseToken
          ? { ...currentState.external_job, lease_token: rememberedLeaseToken }
          : currentState.external_job,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const reason = classifyError(errMsg);
      logger.error("tick: dispatch threw", { opKey, error: errMsg });
      await persistOpState(opKey, {
        ...currentState,
        cursor,
        progress,
        status: "interrupted",
        interruption_reason_code: reason,
        error: errMsg,
        last_stage: currentState.last_stage,
        last_stage_started_at: currentState.last_stage_started_at,
        last_successful_cursor: cursor,
        next_auto_resume_at: nextAutoResumeAt(reason, currentState),
        updated_at: new Date().toISOString(),
      });
      return;
    }

    if (result.state_transition === "claim_submission") {
      const owner = `railway:${currentState.run_id ?? "unknown"}`;
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
      if (!claim.ok || !claim.lease_receipt_issued || !claim.lease_token) {
        const retryAt = claim.lease_expires_at ? new Date(claim.lease_expires_at).getTime() : Date.now() + 30_000;
        submissionLeaseRetryAfter.set(opKey, Number.isFinite(retryAt) ? retryAt + 250 : Date.now() + 30_000);
        logger.info("tick: submission lease was not issued to this worker", { opKey, reason: claim.reason });
        return;
      }
      const claimedState = claim.operation as OpState;
      submissionLeaseRetryAfter.delete(opKey);
      submissionLeaseTokens.set(opKey, claim.lease_token);
      result = await dispatch(opKey, {
        ...claimedState,
        external_job: { ...claimedState.external_job!, lease_token: claim.lease_token ?? undefined },
      });
      if (!result.ok) throw new Error(result.error ?? "OpenRouter submission failed");
      const submittedState: OpState = {
        ...claimedState,
        status: result.done ? "completed" : "running",
        cursor: (result.nextOffset as number | string | undefined) ?? claimedState.cursor,
        progress: mergeProgress(opKey, progress, result),
        external_job: result.external_job as OpState["external_job"],
        updated_at: new Date().toISOString(),
      };
      const saved = await guardedPersistOpState(opKey, submittedState, {
        expectedRevision: claim.state_revision,
      });
      if (!saved.ok || saved.provider_batch_id !== submittedState.external_job?.provider_batch_id) {
        throw new Error("OpenRouter accepted the batch but its ID could not be safely saved");
      }
      if (result.done) submissionLeaseTokens.delete(opKey);
      logger.info("tick: durable OpenRouter batch saved", {
        opKey,
        batchId: submittedState.external_job?.provider_batch_id,
      });
      return;
    }
    if (result.state_transition === "yield_without_save") return;

    const resultJob = result.external_job as OpState["external_job"] | undefined;
    if (!result.ok && currentState.external_job) {
      const protectedErrorState: OpState = {
        ...currentState,
        status: "interrupted",
        cursor,
        progress,
        error: result.error ?? "OpenRouter batch failed",
        interruption_reason_code: interruptionReason(result),
        external_job: resultJob ?? currentState.external_job,
        updated_at: new Date().toISOString(),
      };
      const saved = await guardedPersistOpState(opKey, protectedErrorState, {
        expectedRevision: currentState.state_revision ?? 0,
      });
      if (!saved.ok) throw new Error(`Protected OpenRouter failure save refused: ${saved.reason}`);
      return;
    }
    if (resultJob?.lease_token && currentState.external_job) {
      const guardedState: OpState = {
        ...currentState,
        status: result.done ? "completed" : "running",
        cursor: (result.nextOffset as number | string | undefined) ?? cursor,
        progress: mergeProgress(opKey, progress, result),
        external_job: resultJob,
        updated_at: new Date().toISOString(),
      };
      const saved = await guardedPersistOpState(opKey, guardedState, {
        expectedRevision: currentState.state_revision ?? 0,
      });
      if (!saved.ok) throw new Error(`Protected OpenRouter state save refused: ${saved.reason}`);
      if (result.done || resultJob.clear_after_reconciliation) submissionLeaseTokens.delete(opKey);
      return;
    }

    progress = mergeProgress(opKey, progress, result);
    batchCount++;

    // Kill switch: stop automatically on systematic or high-rate failures.
    // Scoped to the current run via started_at so restarting resets the window.
    const killReason = detectFailureKillSwitch(progress, currentState.started_at);
    if (killReason) {
      logger.error("tick: failure kill switch triggered", { opKey, reason: killReason, batchCount });
      await persistOpState(opKey, {
        ...currentState,
        cursor,
        progress,
        status: "interrupted",
        interruption_reason_code: "repeated_failure",
        error: `Auto-stopped: ${killReason}`,
        updated_at: new Date().toISOString(),
      });
      return;
    }

    if (!result.ok) {
      const batchErr = result.error ?? "Batch failed";
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
      });
      await persistOpState(opKey, {
        ...currentState,
        cursor,
        progress,
        status: "interrupted",
        interruption_reason_code: reason,
        error: batchErr,
        last_stage: result.error_stage,
        last_stage_started_at: result.last_stage_started_at,
        last_successful_cursor: cursor,
        retry_page_size: result.retry_page_size ?? currentState.retry_page_size,
        next_auto_resume_at: nextAutoResumeAt(reason, currentState),
        updated_at: new Date().toISOString(),
      });
      return;
    }

    currentState = {
      ...currentState,
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

    // Reload the database-assigned revision before attempting the submission
    // lease. Continuing in this same loop would claim with the old revision.
    if (result.external_job) return;

    if (result.done) {
      logger.info("tick: op completed", { opKey, batches: batchCount, progress });
      await persistOpState(opKey, {
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
      });
      return;
    }

    // Yield after MAX_BATCHES_PER_TICK so other operations get a turn
    if (batchCount >= MAX_BATCHES_PER_TICK) {
      logger.info("tick: yielding after max batches", { opKey, batches: batchCount, cursor });
      return; // State already saved above; main loop re-enters tick()
    }
  }
}
