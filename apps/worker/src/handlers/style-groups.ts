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
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

function isStatementTimeout(msg: string): boolean {
  return msg.includes("57014") || msg.toLowerCase().includes("statement timeout") || msg.toLowerCase().includes("lock timeout");
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
      const { data: rpcResult, error: rpcErr } = await client.rpc("clear_style_group_batch", {
        p_last_id: state.last_asset_id ?? null,
        p_batch_size: batchSize,
      });

      if (!rpcErr) {
        result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
        break;
      }

      const msg = formatError(rpcErr);
      if (!isStatementTimeout(msg) || batchSize === clearMinBatch) {
        return { ok: false, done: false, error: msg, stage: "clear_assets" };
      }

      const nextBatch = Math.max(clearMinBatch, Math.floor(batchSize / 2));
      logger.warn("rebuild: clear_assets timeout, reducing batch", { batchSize, nextBatch });
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
    const { data: rpcResult, error: rpcErr } = await client.rpc("rebuild_style_groups_batch", {
      p_last_asset_id: state.last_rebuild_asset_id ?? null,
      p_batch_size: rebuildBatch,
    });

    if (rpcErr) {
      return { ok: false, done: false, error: rpcErr.message, stage: "rebuild_assets" };
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

  // ── Stage 4: finalize stats (counts then primaries) ───────────────
  if (state.stage === "finalize_stats") {
    const subStage = state.finalize_sub ?? "counts";

    // Count total groups once
    if (typeof state.total_groups !== "number") {
      const { count } = await client.from("style_groups").select("id", { count: "exact", head: true });
      state.total_groups = count ?? 0;
      await saveState(state);
    }

    if (subStage === "counts") {
      let q = client.from("style_groups").select("id").order("id", { ascending: true }).limit(COUNTS_BATCH);
      if (state.last_stats_group_id) q = q.gt("id", state.last_stats_group_id);

      const { data: groupRows, error: fetchErr } = await q;
      if (fetchErr) return { ok: false, done: false, error: fetchErr.message, stage: "finalize_stats", sub: "counts" };

      if (!groupRows || groupRows.length === 0) {
        // Transition to primaries sub-stage
        state.finalize_sub = "primaries";
        state.finalize_cursor = 0;
        state.last_stats_group_id = null;
        await saveState(state);
        return {
          ok: true,
          done: false,
          stage: "finalize_stats",
          sub: "counts_done",
          counts_processed: state.total_groups ?? 0,
          nextOffset: (typeof opState.cursor === "number" ? opState.cursor : 0) + 1,
        };
      }

      let batchIds = groupRows.map((g: { id: string }) => g.id);
      while (batchIds.length > 0) {
        const { error: countErr } = await client.rpc("refresh_style_group_counts_batch", { p_group_ids: batchIds });
        if (!countErr) break;
        const msg = formatError(countErr);
        if (isStatementTimeout(msg) && batchIds.length > 1) {
          batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
          continue;
        }
        return { ok: false, done: false, error: msg, stage: "finalize_stats", sub: "counts" };
      }

      state.finalize_cursor = (state.finalize_cursor ?? 0) + batchIds.length;
      state.last_stats_group_id = batchIds[batchIds.length - 1] ?? state.last_stats_group_id ?? null;
      await saveState(state);

      return {
        ok: true,
        done: false,
        stage: "finalize_stats",
        sub: "counts",
        counts_processed: state.finalize_cursor,
        finalize_total_groups: state.total_groups ?? 0,
        nextOffset: (typeof opState.cursor === "number" ? opState.cursor : 0) + 1,
      };
    }

    if (subStage === "primaries") {
      let q = client.from("style_groups").select("id").order("id", { ascending: true }).limit(PRIMARIES_BATCH);
      if (state.last_stats_group_id) q = q.gt("id", state.last_stats_group_id);

      const { data: groupRows, error: fetchErr } = await q;
      if (fetchErr) return { ok: false, done: false, error: fetchErr.message, stage: "finalize_stats", sub: "primaries" };

      if (!groupRows || groupRows.length === 0) {
        // All done — clear state
        await clearState();
        return {
          ok: true,
          done: true,
          stage: "finalize_stats",
          sub: "complete",
          primaries_processed: state.total_groups ?? 0,
          finalize_total_groups: state.total_groups ?? 0,
          total_assets: state.total_assets ?? 0,
          nextOffset: (typeof opState.cursor === "number" ? opState.cursor : 0) + 1,
        };
      }

      let batchIds = groupRows.map((g: { id: string }) => g.id);
      while (batchIds.length > 0) {
        const { error: primErr } = await client.rpc("refresh_style_group_primaries", { p_group_ids: batchIds });
        if (!primErr) break;
        const msg = formatError(primErr);
        if (isStatementTimeout(msg) && batchIds.length > 1) {
          batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
          continue;
        }
        return { ok: false, done: false, error: msg, stage: "finalize_stats", sub: "primaries" };
      }

      state.finalize_cursor = (state.finalize_cursor ?? 0) + batchIds.length;
      state.last_stats_group_id = batchIds[batchIds.length - 1] ?? state.last_stats_group_id ?? null;
      await saveState(state);

      return {
        ok: true,
        done: false,
        stage: "finalize_stats",
        sub: "primaries",
        primaries_processed: state.finalize_cursor,
        finalize_total_groups: state.total_groups ?? 0,
        nextOffset: (typeof opState.cursor === "number" ? opState.cursor : 0) + 1,
      };
    }

    return { ok: false, done: false, error: `Unknown finalize sub-stage: ${subStage}`, stage: "finalize_stats" };
  }

  return { ok: false, done: false, error: "Unknown rebuild state" };
}

// ── Reconcile stats — single DB call that handles both phases internally ──

export async function handleReconcileStyleGroupStats(_opState: OpState): Promise<BatchResult> {
  const client = db();

  const { data, error: rpcErr } = await client.rpc("run_full_reconcile_style_group_stats");
  if (rpcErr) return { ok: false, done: false, error: rpcErr.message };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, done: false, error: "No result from run_full_reconcile_style_group_stats" };

  return {
    ok: true,
    done: true,
    counts_processed: row.counts_updated ?? 0,
    primaries_processed: row.primaries_updated ?? 0,
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
