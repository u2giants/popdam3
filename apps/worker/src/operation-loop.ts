/**
 * Operation loop — polls admin_config.BULK_OPERATIONS, dispatches to handlers,
 * persists state after each batch.
 *
 * Ports orchestration logic from supabase/functions/bulk-job-runner/index.ts.
 *
 * Key differences from bulk-job-runner:
 *   - No 45s time budget — processes until done or stopped
 *   - No AUTO_RESUME_MAX_ATTEMPTS ceiling — worker handles ops directly
 *   - No HTTP round-trips to admin-api or ai-tag edge functions
 *   - Checks for user interruption every 10 batches (same threshold)
 *   - Stale lock detection: same 10-minute threshold
 */

import { db } from "./supabase.js";
import { logger } from "./logger.js";
import type { BatchResult, OpState } from "./types.js";
import { handleBulkAiTag } from "./handlers/ai-tagging.js";
import { handleRebuildStyleGroups, handleReconcileStyleGroupStats } from "./handlers/style-groups.js";
import { handlePropagateGroupTags } from "./handlers/tag-propagation.js";
import { handleApplyErpEnrichment, handleClassifyErpCategories } from "./handlers/erp.js";

const CONFIG_KEY = "BULK_OPERATIONS";
const STALE_RUN_MINUTES = 10;
const INTERRUPT_CHECK_EVERY = 10;
/** Yield after this many batches so the round-robin can serve other operations */
const MAX_BATCHES_PER_TICK = 5;

// Lane isolation — operations in the same lane are mutually exclusive
const OP_LANES: Record<string, string> = {
  "ai-tag-untagged": "ai-tagging",
  "ai-tag-all": "ai-tagging",
  "ai-tag-groups": "ai-tagging",
  "rebuild-style-groups": "style-groups",
  "reconcile-style-group-stats": "style-groups",
  "reprocess-metadata": "metadata",
  "backfill-sku-names": "metadata",
  "erp-enrichment": "erp",
  "erp-classify": "erp",
  "propagate-group-tags": "style-groups",
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

function mergeProgress(opKey: string, prev: Record<string, unknown>, batch: BatchResult): Record<string, unknown> {
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
        total: prev.total || 0,
        failure_samples: [...prevFail, ...batchFail].slice(-200),
        skip_samples: [...prevSkip, ...batchSkip].slice(-200),
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
      return {
        propagated: ((prev.propagated as number) || 0) + ((batch.propagated as number) || 0),
        skipped: ((prev.skipped as number) || 0) + ((batch.skipped as number) || 0),
        total: prev.total || 0,
      };
    default:
      return { ...prev, ...batch };
  }
}

function buildResultMessage(opKey: string, progress: Record<string, unknown>): string {
  const normalizedKey = opKey.startsWith("ai-tag-single-") ? "ai-tag-all" : opKey;
  switch (normalizedKey) {
    case "ai-tag-untagged":
    case "ai-tag-all":
    case "ai-tag-groups":
      return `Tagged ${progress.tagged}. ${progress.skipped || 0} skipped. ${progress.failed || 0} failed.`;
    case "rebuild-style-groups":
      return `Created ${progress.groups} style groups, assigned ${progress.assigned} assets`;
    case "reconcile-style-group-stats":
      return `Reconciled counts for ${progress.counts_processed || 0} groups, primaries for ${progress.primaries_processed || 0} groups`;
    case "erp-enrichment":
      return `Enriched ${progress.assets_updated || 0} assets, ${progress.groups_updated || 0} groups`;
    case "erp-classify":
      return `AI-classified ${progress.classified || 0} items (${progress.skipped_unclassifiable || 0} unclassifiable)`;
    case "propagate-group-tags":
      return `Propagated tags across ${progress.propagated || 0} groups (${progress.skipped || 0} skipped)`;
    default:
      return "Operation completed";
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

async function dispatch(opKey: string, opState: OpState): Promise<BatchResult> {
  // Handle dynamic single-asset tagging keys (ai-tag-single-{uuid})
  if (opKey.startsWith("ai-tag-single-")) {
    return handleBulkAiTag(opState, true);
  }

  switch (opKey) {
    case "ai-tag-untagged":
      return handleBulkAiTag(opState, false);
    case "ai-tag-all":
    case "ai-tag-groups":
      return handleBulkAiTag(opState, true);
    case "rebuild-style-groups":
      return handleRebuildStyleGroups(opState);
    case "reconcile-style-group-stats":
      return handleReconcileStyleGroupStats(opState);
    case "propagate-group-tags":
      return handlePropagateGroupTags(opState);
    case "erp-enrichment":
      return handleApplyErpEnrichment(opState);
    case "erp-classify":
      return handleClassifyErpCategories(opState);
    default:
      return { ok: false, done: false, error: `Unknown operation: ${opKey}` };
  }
}

// ── Persist single op state ───────────────────────────────────────────────────

async function persistOpState(opKey: string, opState: OpState): Promise<void> {
  const client = db();
  await client.rpc("update_bulk_operation", {
    p_op_key: opKey,
    p_op_state: opState,
  });
}

// ── Main tick — called every POLL_INTERVAL_MS ─────────────────────────────────

export async function tick(): Promise<void> {
  const client = db();

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
        updated_at: new Date().toISOString(),
      };
      staleUpdates[key] = allOps[key];
    }
  }

  // Persist stale lock changes
  for (const [key, op] of Object.entries(staleUpdates)) {
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

  for (const [nextOpKey, nextOp] of queuedEntries) {
    const lane = getLane(nextOpKey);
    if (!activeLanes.has(lane)) {
      logger.info("tick: promoting queued op", { opKey: nextOpKey, lane });
      allOps[nextOpKey] = {
        ...nextOp,
        status: "running",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      runningEntries.push([nextOpKey, allOps[nextOpKey]]);
      activeLanes.add(lane);
      await persistOpState(nextOpKey, allOps[nextOpKey]);
    }
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

  if (!opState.run_id) {
    opState.run_id = Math.random().toString(36).slice(2);
  }

  let cursor = opState.cursor ?? 0;
  let progress = { ...(opState.progress ?? {}) };
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
      result = await dispatch(opKey, { ...opState, cursor, progress });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error("tick: dispatch threw", { opKey, error: errMsg });
      await persistOpState(opKey, {
        ...opState,
        cursor,
        progress,
        status: "interrupted",
        interruption_reason_code: "unknown",
        error: errMsg,
        updated_at: new Date().toISOString(),
      });
      return;
    }

    progress = mergeProgress(opKey, progress, result);
    batchCount++;

    if (!result.ok) {
      logger.error("tick: batch failed", { opKey, error: result.error, batchCount });
      await persistOpState(opKey, {
        ...opState,
        cursor,
        progress,
        status: "interrupted",
        interruption_reason_code: "unknown",
        error: result.error ?? "Batch failed",
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // Advance cursor
    if (result.nextOffset !== undefined && result.nextOffset !== null) {
      cursor = result.nextOffset as number | string;
    } else if (typeof cursor === "number") {
      cursor = cursor + 1;
    }

    // Save progress after every batch
    await persistOpState(opKey, {
      ...opState,
      cursor,
      progress,
      status: "running",
      updated_at: new Date().toISOString(),
    });

    if (result.done) {
      logger.info("tick: op completed", { opKey, batches: batchCount, progress });
      await persistOpState(opKey, {
        ...opState,
        cursor,
        progress,
        status: "completed",
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
