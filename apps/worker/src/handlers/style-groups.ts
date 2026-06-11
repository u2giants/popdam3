/**
 * Style group rebuild, reconcile, and cleanup handlers — persistent worker version.
 *
 * Ports logic from:
 *   supabase/functions/_shared/admin-handlers/style-group-handlers.ts
 *
 * Key differences from edge function version:
 *   - No MAX_AUTO_RESUME_ATTEMPTS ceiling — worker runs until done
 *   - No 45s time budget — each stage runs to completion before returning
 *   - Same Supabase RPCs (they already exist in the DB)
 *   - Same REBUILD_STYLE_GROUPS_STATE schema in admin_config
 */

import { db } from "../supabase.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState } from "../types.js";

const STATE_KEY = "REBUILD_STYLE_GROUPS_STATE";
const DEFAULT_CLEAR_BATCH = 1000;
const DEFAULT_CLEAR_MIN_BATCH = 200;
const GROUP_DELETE_BATCH = 200;
const DEFAULT_REBUILD_BATCH = 100;
// These were 25 and 5 under the old 45s edge function. The persistent worker
// has no timeout constraint, so larger batches reduce DB round-trips significantly.
const COUNTS_BATCH = 100;
const PRIMARIES_BATCH = 25;

type RebuildState = {
  stage: "clear_assets" | "delete_groups" | "rebuild_assets" | "finalize_stats";
  last_asset_id?: string | null;
  last_group_id?: string | null;
  last_rebuild_asset_id?: string | null;
  last_stats_group_id?: string | null;
  total_assets?: number;
  total_groups?: number;
  total_groups_before_delete?: number;
  total_processed?: number;
  started_at?: string;
  stage_started_at?: string;
  finalize_sub?: string;
  finalize_cursor?: number;
};

function formatError(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts = [
      err.message ? String(err.message) : null,
      err.code ? `code=${String(err.code)}` : null,
      err.details ? `details=${String(err.details)}` : null,
      err.hint ? `hint=${String(err.hint)}` : null,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" | ");
  }
  return String(e);
}

function isStatementTimeout(msg: string): boolean {
  return msg.includes("57014") || msg.toLowerCase().includes("statement timeout") || msg.toLowerCase().includes("lock timeout");
}

function formatBatchError(context: {
  rpc: string;
  stage: RebuildState["stage"] | "reconcile_stats";
  substage?: string;
  cursor?: string | number | null;
  batchSize?: number;
  elapsedMs?: number;
  rawError: string;
}): string {
  const fields = [
    `rpc=${context.rpc}`,
    `stage=${context.stage}`,
    context.substage ? `substage=${context.substage}` : null,
    context.cursor !== undefined ? `cursor=${context.cursor ?? "null"}` : null,
    context.batchSize !== undefined ? `batch_size=${context.batchSize}` : null,
    context.elapsedMs !== undefined ? `elapsed_ms=${context.elapsedMs}` : null,
  ].filter(Boolean);

  return `Database RPC batch failed (${fields.join(", ")})\n${context.rawError}`;
}

async function saveState(state: RebuildState): Promise<void> {
  const client = db();
  await client.from("admin_config").upsert({
    key: STATE_KEY,
    value: state,
    updated_at: new Date().toISOString(),
    updated_by: null,
  });
}

async function clearState(): Promise<void> {
  const client = db();
  await client.from("admin_config").delete().eq("key", STATE_KEY);
}

function normalizeState(state: RebuildState | null): RebuildState {
  return {
    stage: state?.stage ?? "clear_assets",
    last_asset_id: state?.last_asset_id ?? null,
    last_group_id: state?.last_group_id ?? null,
    last_rebuild_asset_id: state?.last_rebuild_asset_id ?? null,
    last_stats_group_id: state?.last_stats_group_id ?? null,
    total_assets: state?.total_assets,
    total_groups: state?.total_groups,
    total_processed: state?.total_processed ?? 0,
    started_at: state?.started_at ?? new Date().toISOString(),
    finalize_sub: state?.finalize_sub,
    finalize_cursor: state?.finalize_cursor,
  };
}

// ── Rebuild handler — called from operation-loop per batch ───────────────────

export async function handleRebuildStyleGroups(opState: OpState): Promise<BatchResult> {
  const client = db();
  const forceRestart = opState.cursor === 0 && !opState.params?.resumed;

  // Load tunable knobs from admin_config
  let clearBatch = DEFAULT_CLEAR_BATCH;
  let clearMinBatch = DEFAULT_CLEAR_MIN_BATCH;
  let rebuildBatch = DEFAULT_REBUILD_BATCH;
  try {
    const { data: knobRows } = await client
      .from("admin_config")
      .select("key, value")
      .in("key", ["CLEAR_ASSET_BATCH_SIZE", "CLEAR_ASSET_MIN_BATCH_SIZE", "REBUILD_ASSET_BATCH_SIZE"]);

    for (const row of knobRows ?? []) {
      const val = row?.value;
      const num = typeof val === "number" ? val : (typeof val === "object" && val !== null && "value" in val ? Number((val as { value: unknown }).value) : parseInt(String(val), 10));
      if (row.key === "CLEAR_ASSET_BATCH_SIZE" && Number.isFinite(num) && num > 0) clearBatch = num;
      if (row.key === "CLEAR_ASSET_MIN_BATCH_SIZE" && Number.isFinite(num) && num > 0) clearMinBatch = num;
      if (row.key === "REBUILD_ASSET_BATCH_SIZE" && Number.isFinite(num) && num > 0) rebuildBatch = num;
    }
    clearMinBatch = Math.max(1, Math.min(clearMinBatch, clearBatch));
  } catch { /* defaults are fine */ }

  // Load existing state
  const { data: existingStateRow } = await client
    .from("admin_config")
    .select("value")
    .eq("key", STATE_KEY)
    .maybeSingle();

  let state = (existingStateRow?.value as RebuildState | null) ?? null;

  if (forceRestart || !state) {
    state = normalizeState(null);
    await saveState(state);
  }

  state = normalizeState(state);

  // Count total assets once
  if (typeof state.total_assets !== "number") {
    const { count, error: countErr } = await client
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false);
    if (countErr) return { ok: false, done: false, error: countErr.message, stage: "clear_assets" };
    state.total_assets = count ?? 0;
    await saveState(state);
  }

  // Legacy compat
  if (state.stage === "rebuild_assets" && state.last_rebuild_asset_id === undefined) {
    state = { ...state, stage: "rebuild_assets", last_rebuild_asset_id: null, last_stats_group_id: null };
    await saveState(state);
  }

  logger.info("rebuild-style-groups: batch start", { stage: state.stage, total_assets: state.total_assets, total_processed: state.total_processed });

  // ── Stage 1: clear style_group_id ─────────────────────────────────
  if (state.stage === "clear_assets") {
    let batchSize = Math.max(clearMinBatch, clearBatch);
    let result: { cleared_count?: number; last_id?: string | null; has_more?: boolean } | null = null;

    while (batchSize >= clearMinBatch) {
      const started = Date.now();
      let rpcResult: unknown;
      let rpcErr: unknown;
      try {
        const res = await client.rpc("clear_style_group_batch", {
          p_last_id: state.last_asset_id ?? null,
          p_batch_size: batchSize,
        });
        rpcResult = res.data;
        rpcErr = res.error;
      } catch (e) {
        rpcErr = e;
      }
      const elapsedMs = Date.now() - started;

      if (!rpcErr) {
        result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
        break;
      }

      const msg = formatError(rpcErr);
      const detailedError = formatBatchError({
        rpc: "clear_style_group_batch",
        stage: "clear_assets",
        cursor: state.last_asset_id ?? null,
        batchSize,
        elapsedMs,
        rawError: msg,
      });
      if (!isStatementTimeout(msg) || batchSize === clearMinBatch) {
        logger.error("rebuild-style-groups: RPC batch failed", {
          rpc: "clear_style_group_batch",
          stage: "clear_assets",
          cursor: state.last_asset_id ?? null,
          batchSize,
          elapsedMs,
          error: msg,
        });
        return { ok: false, done: false, error: detailedError, stage: "clear_assets" };
      }

      const nextBatch = Math.max(clearMinBatch, Math.floor(batchSize / 2));
      logger.warn("rebuild: clear_assets timeout, reducing batch", {
        rpc: "clear_style_group_batch",
        cursor: state.last_asset_id ?? null,
        batchSize,
        nextBatch,
        elapsedMs,
        error: msg,
      });
      if (nextBatch === batchSize) break;
      batchSize = nextBatch;
    }

    if (!result) {
      return { ok: false, done: false, error: "clear_assets failed after adaptive retries", stage: "clear_assets" };
    }

    const hasMore = result.has_more ?? false;

    let totalGroupsBeforeDelete: number | undefined;
    if (!hasMore) {
      const { count } = await client.from("style_groups").select("id", { count: "exact", head: true });
      totalGroupsBeforeDelete = count ?? undefined;
    }

    const nextState: RebuildState = !hasMore
      ? { ...state, stage: "delete_groups", last_asset_id: null, last_group_id: null, total_groups_before_delete: totalGroupsBeforeDelete, stage_started_at: new Date().toISOString() }
      : { ...state, stage: "clear_assets", last_asset_id: result.last_id ?? null };

    await saveState(nextState);

    return {
      ok: true,
      done: false,
      stage: "clear_assets",
      cleared_assets: result.cleared_count ?? 0,
      nextOffset: (typeof opState.cursor === "number" ? opState.cursor : 0) + 1,
      total_processed: nextState.total_processed ?? 0,
      total_assets: nextState.total_assets ?? 0,
    };
  }

  // ── Stage 2: delete existing style groups ─────────────────────────
  if (state.stage === "delete_groups") {
    let q = client.from("style_groups").select("id").order("id", { ascending: true }).limit(GROUP_DELETE_BATCH);
    if (state.last_group_id) q = q.gt("id", state.last_group_id);

    const { data: rows, error: fetchErr } = await q;
    if (fetchErr) return { ok: false, done: false, error: fetchErr.message, stage: "delete_groups" };

    const ids = (rows ?? []).map((r: { id: string }) => r.id);
    if (ids.length > 0) {
      const { error: delErr } = await client.from("style_groups").delete().in("id", ids);
      if (delErr) return { ok: false, done: false, error: delErr.message, stage: "delete_groups" };
    }

    const reachedEnd = ids.length < GROUP_DELETE_BATCH;
    const nextState: RebuildState = reachedEnd
      ? { ...state, stage: "rebuild_assets", last_group_id: null, last_rebuild_asset_id: null, stage_started_at: new Date().toISOString() }
      : { ...state, stage: "delete_groups", last_group_id: ids[ids.length - 1] };

    await saveState(nextState);

    return {
      ok: true,
      done: false,
      stage: "delete_groups",
      groups_deleted: ids.length,
      total_groups_before_delete: state.total_groups_before_delete ?? 0,
      nextOffset: (typeof opState.cursor === "number" ? opState.cursor : 0) + 1,
      total_processed: nextState.total_processed ?? 0,
      total_assets: nextState.total_assets ?? 0,
    };
  }

  // ── Stage 3: assign assets → groups via DB RPC ────────────────────
  if (state.stage === "rebuild_assets") {
    const started = Date.now();
    let rpcResult: unknown;
    let rpcErr: unknown;
    try {
      const res = await client.rpc("rebuild_style_groups_batch", {
        p_last_asset_id: state.last_rebuild_asset_id ?? null,
        p_batch_size: rebuildBatch,
      });
      rpcResult = res.data;
      rpcErr = res.error;
    } catch (e) {
      rpcErr = e;
    }
    const elapsedMs = Date.now() - started;

    if (rpcErr) {
      const msg = formatError(rpcErr);
      logger.error("rebuild-style-groups: RPC batch failed", {
        rpc: "rebuild_style_groups_batch",
        stage: "rebuild_assets",
        cursor: state.last_rebuild_asset_id ?? null,
        batchSize: rebuildBatch,
        elapsedMs,
        error: msg,
      });
      return {
        ok: false,
        done: false,
        error: formatBatchError({
          rpc: "rebuild_style_groups_batch",
          stage: "rebuild_assets",
          cursor: state.last_rebuild_asset_id ?? null,
          batchSize: rebuildBatch,
          elapsedMs,
          rawError: msg,
        }),
        stage: "rebuild_assets",
      };
    }

    const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    if (!row) return { ok: false, done: false, error: "No result from rebuild_style_groups_batch", stage: "rebuild_assets" };

    const reachedEnd = row.done ?? true;
    const totalProcessed = (state.total_processed ?? 0) + rebuildBatch;

    const nextState: RebuildState = reachedEnd
      ? { ...state, stage: "finalize_stats", last_stats_group_id: null, total_processed: totalProcessed, stage_started_at: new Date().toISOString() }
      : { ...state, stage: "rebuild_assets", last_rebuild_asset_id: row.next_cursor ?? null, total_processed: totalProcessed };

    await saveState(nextState);

    return {
      ok: true,
      done: false,
      stage: "rebuild_assets",
      groups_created: row.groups_created ?? 0,
      assets_assigned: row.assets_assigned ?? 0,
      total_processed: totalProcessed,
      total_assets: nextState.total_assets ?? 0,
      nextOffset: (typeof opState.cursor === "number" ? opState.cursor : 0) + 1,
    };
  }

  // ── Stage 4: finalize stats — batched via reconcile_style_group_stats_batch ──
  if (state.stage === "finalize_stats") {
    const sub = state.finalize_sub ?? "counts";
    const cursor = state.last_stats_group_id ?? null;
    const batchSize = sub === "primaries" ? PRIMARIES_BATCH : COUNTS_BATCH;

    const started = Date.now();
    let data: unknown;
    let rpcErr: unknown;
    try {
      const res = await client.rpc("reconcile_style_group_stats_batch", {
        p_cursor: cursor,
        p_batch_size: batchSize,
        p_sub: sub,
      });
      data = res.data;
      rpcErr = res.error;
    } catch (e) {
      rpcErr = e;
    }
    const elapsedMs = Date.now() - started;
    if (rpcErr) {
      const msg = formatError(rpcErr);
      logger.error("rebuild-style-groups: RPC batch failed", {
        rpc: "reconcile_style_group_stats_batch",
        stage: "finalize_stats",
        substage: sub,
        cursor,
        batchSize,
        elapsedMs,
        error: msg,
      });
      return {
        ok: false,
        done: false,
        error: formatBatchError({
          rpc: "reconcile_style_group_stats_batch",
          stage: "finalize_stats",
          substage: sub,
          cursor,
          batchSize,
          elapsedMs,
          rawError: msg,
        }),
        stage: "finalize_stats",
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, done: false, error: "No result from reconcile_style_group_stats_batch", stage: "finalize_stats" };

    const returnedSub = (row.sub as string) ?? sub;
    const isDone = (row.done as boolean) ?? false;
    const nextCursor = (row.next_cursor as string | null) ?? null;
    const processed = (row.processed as number) ?? 0;

    if (isDone || returnedSub === "complete") {
      await clearState();
      return {
        ok: true,
        done: true,
        stage: "finalize_stats",
        sub: "complete",
        counts_processed: processed,
        primaries_processed: processed,
        finalize_total_groups: processed,
        total_assets: state.total_assets ?? 0,
        nextOffset: (typeof opState.cursor === "number" ? opState.cursor : 0) + 1,
      };
    }

    // counts_done signals: switch to primaries sub-stage
    const nextSub = returnedSub === "counts_done" ? "primaries" : sub;
    const nextStatsCursor: string | null = returnedSub === "counts_done" ? null : nextCursor;

    const nextState: RebuildState = {
      ...state,
      finalize_sub: nextSub,
      last_stats_group_id: nextStatsCursor,
    };
    await saveState(nextState);

    return {
      ok: true,
      done: false,
      stage: "finalize_stats",
      sub: returnedSub,
      counts_processed: processed,
      total_assets: state.total_assets ?? 0,
      nextOffset: (typeof opState.cursor === "number" ? opState.cursor : 0) + 1,
    };
  }

  return { ok: false, done: false, error: "Unknown rebuild state" };
}

// ── Reconcile stats — batched via reconcile_style_group_stats_batch ──

export async function handleReconcileStyleGroupStats(opState: OpState): Promise<BatchResult> {
  const client = db();

  // Decode sub-stage and UUID cursor from the string cursor (e.g. "counts:uuid" or "primaries:uuid").
  // Initial cursor is numeric 0.
  let sub = "counts";
  let cursor: string | null = null;
  if (typeof opState.cursor === "string" && opState.cursor.includes(":")) {
    const colonIdx = opState.cursor.indexOf(":");
    sub = opState.cursor.slice(0, colonIdx);
    const rest = opState.cursor.slice(colonIdx + 1);
    cursor = rest === "null" || rest === "" ? null : rest;
  }

  const batchSize = sub === "primaries" ? PRIMARIES_BATCH : COUNTS_BATCH;

  const started = Date.now();
  let data: unknown;
  let rpcErr: unknown;
  try {
    const res = await client.rpc("reconcile_style_group_stats_batch", {
      p_cursor: cursor,
      p_batch_size: batchSize,
      p_sub: sub,
    });
    data = res.data;
    rpcErr = res.error;
  } catch (e) {
    rpcErr = e;
  }
  const elapsedMs = Date.now() - started;
  if (rpcErr) {
    const msg = formatError(rpcErr);
    logger.error("reconcile-style-group-stats: RPC batch failed", {
      rpc: "reconcile_style_group_stats_batch",
      stage: "reconcile_stats",
      substage: sub,
      cursor,
      batchSize,
      elapsedMs,
      error: msg,
    });
    return {
      ok: false,
      done: false,
      error: formatBatchError({
        rpc: "reconcile_style_group_stats_batch",
        stage: "reconcile_stats",
        substage: sub,
        cursor,
        batchSize,
        elapsedMs,
        rawError: msg,
      }),
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, done: false, error: "No result from reconcile_style_group_stats_batch" };

  const returnedSub = (row.sub as string) ?? sub;
  const isDone = (row.done as boolean) ?? false;
  const nextCursor = (row.next_cursor as string | null) ?? null;
  const processed = (row.processed as number) ?? 0;

  if (isDone || returnedSub === "complete") {
    return {
      ok: true,
      done: true,
      counts_processed: processed,
      primaries_processed: processed,
    };
  }

  // counts_done → switch to primaries
  const nextSub = returnedSub === "counts_done" ? "primaries" : sub;
  const nextCursorVal = returnedSub === "counts_done" ? null : nextCursor;
  const nextOffset = `${nextSub}:${nextCursorVal ?? "null"}`;

  return {
    ok: true,
    done: false,
    counts_processed: sub === "counts" ? processed : 0,
    primaries_processed: sub === "primaries" ? processed : 0,
    nextOffset,
  };
}

// ── Cleanup mega-group tags — calls the DB function per batch ────────────────

export async function handleCleanupMegaGroupTags(opState: OpState): Promise<BatchResult> {
  const client = db();
  const cursor = typeof opState.cursor === "string" && opState.cursor !== "0" && opState.cursor !== "" ? opState.cursor : null;
  const minGroupSize = (opState.params?.min_group_size as number) || 50;

  const { data: rpcResult, error: rpcErr } = await client.rpc("cleanup_mega_group_tags_batch", {
    p_cursor: cursor,
    p_batch_size: 5,
    p_min_group_size: minGroupSize,
  });

  if (rpcErr) {
    return { ok: false, done: false, error: rpcErr.message };
  }

  const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
  if (!row) return { ok: false, done: false, error: "No result from cleanup_mega_group_tags_batch" };

  return {
    ok: true,
    done: row.done ?? false,
    nextOffset: row.next_cursor ?? null,
    groups_processed: row.groups_processed ?? 0,
    tags_deleted: row.tags_deleted ?? 0,
    characters_deleted: row.characters_deleted ?? 0,
    metadata_cleared: row.metadata_cleared ?? 0,
  };
}
