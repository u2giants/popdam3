/**
 * Style group rebuild & reconcile handlers extracted from admin-api/index.ts.
 *
 * Covers: rebuild-style-groups, reconcile-style-group-stats
 */

import { extractSkuFolder } from "../style-grouping.ts";
import { unwrapConfigValue } from "../config-utils.ts";
import { err, formatPostgrestError, isStatementTimeout, json, serviceClient, withRetry } from "../admin-utils.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── rebuild-style-groups ────────────────────────────────────────────

export async function handleRebuildStyleGroups(body: Record<string, unknown>) {
  const offset = typeof body.offset === "number" ? body.offset : 0;
  const forceRestart = body.force_restart === true;
  const db = serviceClient();

  const STATE_KEY = "REBUILD_STYLE_GROUPS_STATE";
  const DEFAULT_CLEAR_BATCH = 50;
  const DEFAULT_CLEAR_MIN_BATCH = 25;
  const GROUP_DELETE_BATCH = 200;
  const DEFAULT_REBUILD_BATCH = 100;
  const DEFAULT_REBUILD_MAX_GROUPS_PER_CALL = 50;

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
    rebuild_offset?: number; // legacy compat
  };

  async function saveState(state: RebuildState) {
    const now = new Date().toISOString();
    await db.from("admin_config").upsert({
      key: STATE_KEY,
      value: state,
      updated_at: now,
      updated_by: null,
    });
  }

  async function clearState() {
    await db.from("admin_config").delete().eq("key", STATE_KEY);
  }

  const normalizeState = (state: RebuildState | null): RebuildState => ({
    stage: state?.stage ?? "clear_assets",
    last_asset_id: state?.last_asset_id ?? null,
    last_group_id: state?.last_group_id ?? null,
    last_rebuild_asset_id: state?.last_rebuild_asset_id ?? null,
    last_stats_group_id: state?.last_stats_group_id ?? null,
    total_assets: state?.total_assets,
    total_groups: state?.total_groups,
    total_processed: state?.total_processed ?? 0,
    started_at: state?.started_at ?? new Date().toISOString(),
  });

  const { data: existingStateRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", STATE_KEY)
    .maybeSingle();

  let state = (existingStateRow?.value as RebuildState | null) ?? null;

  if (offset === 0 && forceRestart) {
    state = normalizeState(null);
    await saveState(state);
  }

  state = normalizeState(state);

  if (typeof state.total_assets !== "number") {
    const { count, error: countErr } = await db
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false);
    if (countErr) return err(formatPostgrestError(countErr), 500);
    state.total_assets = count ?? 0;
    await saveState(state);
  }

  // Legacy state compatibility
  if (state.stage === "rebuild_assets" && state.last_rebuild_asset_id === undefined) {
    state = { ...state, stage: "rebuild_assets", last_rebuild_asset_id: null, last_stats_group_id: null };
    await saveState(state);
  }

  let clearBatch = DEFAULT_CLEAR_BATCH;
  let clearMinBatch = DEFAULT_CLEAR_MIN_BATCH;
  let rebuildBatch = DEFAULT_REBUILD_BATCH;
  let rebuildMaxGroupsPerCall = DEFAULT_REBUILD_MAX_GROUPS_PER_CALL;
  try {
    const { data: knobRows } = await db
      .from("admin_config")
      .select("key, value")
      .in("key", ["CLEAR_ASSET_BATCH_SIZE", "CLEAR_ASSET_MIN_BATCH_SIZE", "REBUILD_ASSET_BATCH_SIZE", "REBUILD_MAX_GROUPS_PER_CALL"]);

    for (const row of knobRows ?? []) {
      const raw = row?.value;
      const normalized = unwrapConfigValue(raw);
      const parsed = typeof normalized === "number" ? normalized : parseInt(String(normalized), 10);
      if (row.key === "CLEAR_ASSET_BATCH_SIZE" && Number.isFinite(parsed) && parsed > 0) clearBatch = parsed;
      if (row.key === "CLEAR_ASSET_MIN_BATCH_SIZE" && Number.isFinite(parsed) && parsed > 0) clearMinBatch = parsed;
      if (row.key === "REBUILD_ASSET_BATCH_SIZE" && Number.isFinite(parsed) && parsed > 0) rebuildBatch = parsed;
      if (row.key === "REBUILD_MAX_GROUPS_PER_CALL" && Number.isFinite(parsed) && parsed > 0) rebuildMaxGroupsPerCall = parsed;
    }
    clearMinBatch = Math.max(1, Math.min(clearMinBatch, clearBatch));
  } catch { /* defaults are fine */ }

  // ── Stage 1: clear style_group_id ─────────────────────────────────
  if (state.stage === "clear_assets") {
    let batchSize = Math.max(clearMinBatch, clearBatch);
    let result: { cleared_count?: number; last_id?: string | null; has_more?: boolean } | null = null;
    let lastErr: string | null = null;

    while (batchSize >= clearMinBatch) {
      await sleep(100);
      const { data: rpcResult, error: rpcErr } = await db.rpc("clear_style_group_batch", {
        p_last_id: state.last_asset_id ?? null,
        p_batch_size: batchSize,
      });

      if (!rpcErr) {
        result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
        break;
      }

      const msg = formatPostgrestError(rpcErr);
      lastErr = msg;
      if (!isStatementTimeout(msg) || batchSize === clearMinBatch) {
        return json({ ok: false, error: msg, stage: "clear_assets", substage: "rpc", attempted_batch_size: batchSize, min_batch_size: clearMinBatch }, 500);
      }

      const nextBatch = Math.max(clearMinBatch, Math.floor(batchSize / 2));
      console.warn(`clear_assets timeout at batch=${batchSize}, retrying with batch=${nextBatch}`);
      if (nextBatch === batchSize) break;
      batchSize = nextBatch;
    }

    if (!result) {
      return json({
        ok: false,
        error: lastErr || "clear_assets failed after adaptive retries",
        stage: "clear_assets",
        substage: "adaptive_retry",
        min_batch_size: clearMinBatch,
      }, 500);
    }

    const clearedCount = result?.cleared_count ?? 0;
    const lastId = result?.last_id ?? null;
    const hasMore = result?.has_more ?? false;

    let totalGroupsBeforeDelete: number | undefined;
    if (!hasMore) {
      try {
        const { count } = await db.from("style_groups").select("id", { count: "exact", head: true });
        totalGroupsBeforeDelete = count ?? undefined;
      } catch { /* non-fatal — UI just won't show Stage 2 denominator */ }
    }

    const nextState: RebuildState = !hasMore
      ? { ...state, stage: "delete_groups", last_asset_id: null, last_group_id: null, total_groups_before_delete: totalGroupsBeforeDelete, stage_started_at: new Date().toISOString() }
      : { ...state, stage: "clear_assets", last_asset_id: lastId };

    await saveState(nextState);

    return json({
      ok: true,
      stage: "clear_assets",
      substage: null,
      done: false,
      nextOffset: offset + 1,
      cleared_assets: clearedCount,
      clear_batch_size_used: batchSize,
      total_processed: nextState.total_processed ?? 0,
      total_assets: nextState.total_assets ?? 0,
      resumed: offset === 0 && !forceRestart && !!existingStateRow?.value,
    });
  }

  // ── Stage 2: delete existing style groups ─────────────────────────
  if (state.stage === "delete_groups") {
    let q = db.from("style_groups").select("id").order("id", { ascending: true }).limit(GROUP_DELETE_BATCH);
    if (state.last_group_id) q = q.gt("id", state.last_group_id);

    const { data: rows, error: fetchErr } = await q;
    if (fetchErr) return json({ ok: false, error: formatPostgrestError(fetchErr), stage: "delete_groups", substage: null }, 500);

    const ids = (rows ?? []).map((r) => r.id as string);
    if (ids.length > 0) {
      await withRetry(async () => {
        const { error: delErr } = await db.from("style_groups").delete().in("id", ids);
        if (delErr) throw new Error(`delete_groups batch failed: ${formatPostgrestError(delErr)}`);
        return true;
      });
    }

    const reachedEnd = ids.length < GROUP_DELETE_BATCH;
    const nextState: RebuildState = reachedEnd
      ? { ...state, stage: "rebuild_assets", last_group_id: null, last_rebuild_asset_id: null }
      : { ...state, stage: "delete_groups", last_group_id: ids[ids.length - 1] };

    const nextStageStarted = reachedEnd ? new Date().toISOString() : state.stage_started_at;
    if (reachedEnd) {
      nextState.stage_started_at = nextStageStarted;
    }
    await saveState(nextState);

    return json({
      ok: true,
      stage: "delete_groups",
      substage: null,
      done: false,
      nextOffset: offset + 1,
      groups_deleted: ids.length,
      total_groups_before_delete: state.total_groups_before_delete ?? 0,
      stage_started_at: state.stage_started_at,
      total_processed: nextState.total_processed ?? 0,
      total_assets: nextState.total_assets ?? 0,
      resumed: offset === 0 && !forceRestart && !!existingStateRow?.value,
    });
  }

  // ── Stage 3: assign assets → groups ───────────────────────────────
  if (state.stage === "rebuild_assets") {
    const FETCH_MAX_ATTEMPTS = 5;
    const WRITE_MAX_ATTEMPTS = 4;
    const cursorLabel = state.last_rebuild_asset_id ?? "start";

    try {
      const fetchResult = await withRetry(
        async () => {
          let q = db
            .from("assets")
            .select(
              "id, relative_path, filename, file_type, created_at, modified_at, workflow_status, is_licensed, licensor_id, licensor_code, licensor_name, property_id, property_code, property_name, product_category, division_code, division_name, mg01_code, mg01_name, mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name",
            )
            .eq("is_deleted", false)
            .order("id", { ascending: true })
            .limit(rebuildBatch);

          if (state.last_rebuild_asset_id) q = q.gt("id", state.last_rebuild_asset_id);

          const { data, error: fetchErr } = await q;
          if (fetchErr) throw new Error(formatPostgrestError(fetchErr));
          return data;
        },
        FETCH_MAX_ATTEMPTS,
        500,
        `rebuild_assets/fetch cursor=${cursorLabel}`,
      );

      const assets = fetchResult ?? [];
      if (assets.length === 0) {
        const nextState: RebuildState = { ...state, stage: "finalize_stats", last_stats_group_id: null };
        await saveState(nextState);
        return json({
          ok: true,
          stage: "rebuild_assets",
          groups_created: 0,
          assets_assigned: 0,
          assets_ungrouped: 0,
          total_processed: nextState.total_processed ?? 0,
          total_assets: nextState.total_assets ?? 0,
          done: false,
          nextOffset: offset + 1,
          resumed: offset === 0 && !forceRestart && !!existingStateRow?.value,
        });
      }

      let processUntil = assets.length;
      if (rebuildMaxGroupsPerCall > 0) {
        const seenSkus = new Set<string>();
        for (let i = 0; i < assets.length; i++) {
          const sku = extractSkuFolder(assets[i].relative_path);
          if (!sku) continue;
          if (!seenSkus.has(sku) && seenSkus.size >= rebuildMaxGroupsPerCall) {
            processUntil = i;
            break;
          }
          seenSkus.add(sku);
        }
      }

      const processBatch = assets.slice(0, Math.max(1, processUntil));
      const skuMap = new Map<string, typeof processBatch>();
      let ungrouped = 0;

      for (const asset of processBatch) {
        const sku = extractSkuFolder(asset.relative_path);
        if (!sku) {
          ungrouped++;
          continue;
        }
        if (!skuMap.has(sku)) skuMap.set(sku, []);
        skuMap.get(sku)!.push(asset);
      }

      const groupRows = Array.from(skuMap.entries()).map(([sku, members]) => {
        const skuUpper = sku.toUpperCase();
        const first = members.find((m) => m.filename.toUpperCase().includes(skuUpper)) ?? members[0];
        const pathParts = first.relative_path.split("/");
        const skuIdx = pathParts.lastIndexOf(sku);
        const folderPath = skuIdx >= 0 ? pathParts.slice(0, skuIdx + 1).join("/") : pathParts.slice(0, -1).join("/");

        return {
          sku,
          folder_path: folderPath,
          is_licensed: first.is_licensed ?? false,
          licensor_id: (first as { licensor_id?: string | null }).licensor_id ?? null,
          licensor_code: first.licensor_code,
          licensor_name: first.licensor_name,
          property_id: (first as { property_id?: string | null }).property_id ?? null,
          property_code: first.property_code,
          property_name: first.property_name,
          product_category: first.product_category,
          division_code: first.division_code,
          division_name: first.division_name,
          mg01_code: first.mg01_code,
          mg01_name: first.mg01_name,
          mg02_code: first.mg02_code,
          mg02_name: first.mg02_name,
          mg03_code: first.mg03_code,
          mg03_name: first.mg03_name,
          size_code: first.size_code,
          size_name: first.size_name,
        };
      });

      let groupsCreated = 0;
      let assetsAssigned = 0;

      if (groupRows.length > 0) {
        const allUpsertedGroups: Array<{ id: string; sku: string }> = [];
        let groupCursor = 0;
        let groupChunkSize = Math.min(100, groupRows.length);
        const GROUP_CHUNK_MIN = 10;

        while (groupCursor < groupRows.length) {
          await sleep(50);
          const chunk = groupRows.slice(groupCursor, groupCursor + groupChunkSize);
          const upsertResult = await withRetry(
            async () => {
              const { data: upsertedGroups, error: upsertErr } = await db
                .from("style_groups")
                .upsert(chunk, { onConflict: "sku" })
                .select("id, sku");
              if (upsertErr) throw new Error(formatPostgrestError(upsertErr));
              return upsertedGroups as Array<{ id: string; sku: string }>;
            },
            WRITE_MAX_ATTEMPTS,
            400,
            `rebuild_assets/upsert_groups cursor=${cursorLabel} chunk@${groupCursor}`,
          ).catch((e) => {
            const msg = ((e as Error).message || "").toLowerCase();
            if (isStatementTimeout(msg) && groupChunkSize > GROUP_CHUNK_MIN) return null;
            throw e;
          });

          if (upsertResult === null) {
            groupChunkSize = Math.max(GROUP_CHUNK_MIN, Math.ceil(groupChunkSize / 2));
            continue;
          }

          allUpsertedGroups.push(...(upsertResult ?? []));
          groupCursor += chunk.length;
        }

        const groupIdBySku = new Map<string, string>(allUpsertedGroups.map((g) => [g.sku, g.id]));

        const assignments: Array<{ asset_id: string; style_group_id: string }> = [];
        for (const [sku, members] of skuMap) {
          const groupId = groupIdBySku.get(sku);
          if (!groupId) continue;
          for (const m of members) assignments.push({ asset_id: m.id, style_group_id: groupId });
        }

        if (assignments.length > 0) {
          let assignCursor = 0;
          let assignChunkSize = Math.min(200, assignments.length);
          const ASSIGN_CHUNK_MIN = 25;

          while (assignCursor < assignments.length) {
            await sleep(50);
            const chunk = assignments.slice(assignCursor, assignCursor + assignChunkSize);
            const assignedCount = await withRetry(
              async () => {
                const { data, error: assignErr } = await db.rpc("bulk_assign_style_groups", { p_assignments: chunk });
                if (assignErr) throw new Error(formatPostgrestError(assignErr));
                return typeof data === "number" ? data : chunk.length;
              },
              WRITE_MAX_ATTEMPTS,
              400,
              `rebuild_assets/assign cursor=${cursorLabel} chunk@${assignCursor}`,
            ).catch((e) => {
              const msg = ((e as Error).message || "").toLowerCase();
              if (isStatementTimeout(msg) && assignChunkSize > ASSIGN_CHUNK_MIN) return null;
              throw e;
            });

            if (assignedCount === null) {
              assignChunkSize = Math.max(ASSIGN_CHUNK_MIN, Math.ceil(assignChunkSize / 2));
              continue;
            }

            assetsAssigned += assignedCount;
            assignCursor += chunk.length;
          }
        }

        groupsCreated = allUpsertedGroups.length;
      }

      const totalProcessed = (state.total_processed ?? 0) + processBatch.length;
      const reachedEnd = assets.length < rebuildBatch;
      const nextState: RebuildState = reachedEnd
        ? { ...state, stage: "finalize_stats", last_stats_group_id: null, total_processed: totalProcessed }
        : { ...state, stage: "rebuild_assets", last_rebuild_asset_id: processBatch[processBatch.length - 1].id, total_processed: totalProcessed };

      await saveState(nextState);

      return json({
        ok: true,
        stage: "rebuild_assets",
        substage: "complete_batch",
        groups_created: groupsCreated,
        assets_assigned: assetsAssigned,
        assets_ungrouped: ungrouped,
        total_processed: totalProcessed,
        total_assets: nextState.total_assets ?? 0,
        done: false,
        nextOffset: offset + 1,
        resumed: offset === 0 && !forceRestart && !!existingStateRow?.value,
      });
    } catch (e) {
      const msg = (e as Error).message || "Unknown error in rebuild stage 3";
      const isBodyRead = msg.toLowerCase().includes("error reading a body");
      const substage = isBodyRead ? "fetch_assets" : "unhandled";
      console.error(`rebuild-style-groups stage 3 error (${substage}):`, msg);
      return json({ ok: false, error: msg, stage: "rebuild_assets", substage }, 500);
    }
  }

  // ── Stage 4: finalize stats ───────────────────────────────────────
  if (state.stage === "finalize_stats") {
    let COUNTS_BATCH = 25;
    let PRIMARIES_BATCH = 5;
    try {
      const { data: knobRow } = await db
        .from("admin_config")
        .select("key, value")
        .in("key", ["REBUILD_FINALIZE_BATCH_SIZE", "REBUILD_PRIMARIES_BATCH_SIZE"]);
      for (const r of knobRow ?? []) {
        const raw = unwrapConfigValue(r.value);
        const num = typeof raw === "number" ? raw : parseInt(String(raw), 10);
        if (r.key === "REBUILD_FINALIZE_BATCH_SIZE" && Number.isFinite(num) && num > 0) COUNTS_BATCH = Math.min(num, 25);
        if (r.key === "REBUILD_PRIMARIES_BATCH_SIZE" && Number.isFinite(num) && num > 0) PRIMARIES_BATCH = Math.min(num, 5);
      }
    } catch { /* defaults */ }

    const subStage = state.finalize_sub ?? "counts";

    try {
      if (subStage === "counts") {
        if (typeof state.total_groups !== "number") {
          const { count: totalGroups, error: totalGroupsErr } = await db.from("style_groups").select("id", { count: "exact", head: true });
          if (totalGroupsErr) return json({ ok: false, error: formatPostgrestError(totalGroupsErr), stage: "finalize_stats", substage: "counts" }, 500);
          state.total_groups = totalGroups ?? 0;
          await saveState(state);
        }

        let q = db.from("style_groups").select("id").order("id", { ascending: true }).limit(COUNTS_BATCH);
        if (state.last_stats_group_id) q = q.gt("id", state.last_stats_group_id);

        const { data: groupIds, error: fetchErr } = await q;
        if (fetchErr) return json({ ok: false, error: formatPostgrestError(fetchErr), stage: "finalize_stats", substage: "counts" }, 500);

        if (!groupIds || groupIds.length === 0) {
          state.finalize_sub = "primaries";
          state.finalize_cursor = 0;
          state.last_stats_group_id = null;
          await saveState(state);
          return json({
            ok: true,
            stage: "finalize_stats",
            sub: "counts_done",
            counts_processed: state.total_groups ?? 0,
            finalize_total_groups: state.total_groups ?? 0,
            total_processed: state.total_processed ?? 0,
            total_assets: state.total_assets ?? 0,
            done: false,
            nextOffset: offset + 1,
          });
        }

        const ids = groupIds.map((g: { id: string }) => g.id);
        let batchIds = ids;
        while (batchIds.length > 0) {
          await sleep(100);
          try {
            const { error: countErr } = await db.rpc("refresh_style_group_counts_batch", { p_group_ids: batchIds });
            if (countErr) {
              const msg = formatPostgrestError(countErr);
              if (msg.includes("57014") && batchIds.length > 1) {
                batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
                continue;
              }
              return json({ ok: false, error: msg, stage: "finalize_stats", substage: "counts" }, 500);
            }
            break;
          } catch (e) {
            const msg = (e as Error).message || "";
            if (msg.includes("57014") && batchIds.length > 1) {
              batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
              continue;
            }
            throw e;
          }
        }

        const processedCount = batchIds.length;
        state.finalize_cursor = (state.finalize_cursor ?? 0) + processedCount;
        state.last_stats_group_id = batchIds[processedCount - 1] ?? state.last_stats_group_id ?? null;
        await saveState(state);

        return json({
          ok: true,
          stage: "finalize_stats",
          sub: "counts",
          counts_processed: state.finalize_cursor,
          finalize_total_groups: state.total_groups ?? 0,
          total_processed: state.total_processed ?? 0,
          total_assets: state.total_assets ?? 0,
          done: false,
          nextOffset: offset + 1,
        });
      }

      if (subStage === "primaries") {
        if (typeof state.total_groups !== "number") {
          const { count: totalGroups, error: totalGroupsErr } = await db.from("style_groups").select("id", { count: "exact", head: true });
          if (totalGroupsErr) return json({ ok: false, error: formatPostgrestError(totalGroupsErr), stage: "finalize_stats", substage: "primaries" }, 500);
          state.total_groups = totalGroups ?? 0;
          await saveState(state);
        }

        let q = db.from("style_groups").select("id").order("id", { ascending: true }).limit(PRIMARIES_BATCH);
        if (state.last_stats_group_id) q = q.gt("id", state.last_stats_group_id);

        const { data: groupIds, error: fetchErr } = await q;
        if (fetchErr) return json({ ok: false, error: formatPostgrestError(fetchErr), stage: "finalize_stats", substage: "primaries" }, 500);

        if (!groupIds || groupIds.length === 0) {
          await clearState();
          return json({
            ok: true,
            stage: "finalize_stats",
            sub: "complete",
            primaries_processed: state.total_groups ?? 0,
            finalize_total_groups: state.total_groups ?? 0,
            total_processed: state.total_processed ?? 0,
            total_assets: state.total_assets ?? 0,
            done: true,
            nextOffset: offset + 1,
          });
        }

        const ids = groupIds.map((g: { id: string }) => g.id);
        let batchIds = ids;
        while (batchIds.length > 0) {
          await sleep(100);
          try {
            const { error: primErr } = await db.rpc("refresh_style_group_primaries", { p_group_ids: batchIds });
            if (primErr) {
              const msg = formatPostgrestError(primErr);
              if (msg.includes("57014") && batchIds.length > 1) {
                batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
                continue;
              }
              return json({ ok: false, error: msg, stage: "finalize_stats", substage: "primaries" }, 500);
            }
            break;
          } catch (e) {
            const msg = (e as Error).message || "";
            if (msg.includes("57014") && batchIds.length > 1) {
              batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
              continue;
            }
            throw e;
          }
        }

        const processedCount = batchIds.length;
        state.finalize_cursor = (state.finalize_cursor ?? 0) + processedCount;
        state.last_stats_group_id = batchIds[processedCount - 1] ?? state.last_stats_group_id ?? null;
        await saveState(state);

        return json({
          ok: true,
          stage: "finalize_stats",
          sub: "primaries",
          primaries_processed: state.finalize_cursor,
          finalize_total_groups: state.total_groups ?? 0,
          total_processed: state.total_processed ?? 0,
          total_assets: state.total_assets ?? 0,
          done: false,
          nextOffset: offset + 1,
        });
      }

      return json({ ok: false, error: "Unknown finalize sub-stage", stage: "finalize_stats", substage: subStage }, 500);
    } catch (e) {
      const msg = (e as Error).message || "Unknown error in rebuild stage 4";
      console.error("rebuild-style-groups stage 4 error:", msg);
      return json({ ok: false, error: msg, stage: "finalize_stats", substage: subStage }, 500);
    }
  }

  return err("Unknown rebuild state", 500);
}

// ── reconcile-style-group-stats ─────────────────────────────────────

export async function handleReconcileStyleGroupStats(body: Record<string, unknown>) {
  try {
    const offset = typeof body.offset === "number" ? body.offset : 0;
    const db = serviceClient();
    const STATE_KEY = "RECONCILE_STYLE_GROUPS_STATE";

    type ReconcileState = {
      sub: "counts" | "primaries";
      cursor: number;
      total_groups?: number;
    };

    const { data: stateRow } = await db
      .from("admin_config")
      .select("value")
      .eq("key", STATE_KEY)
      .maybeSingle();

    let state = (stateRow?.value as ReconcileState | null) ?? { sub: "counts", cursor: 0 };

    if (offset === 0 && !stateRow) {
      state = { sub: "counts", cursor: 0 };
    }

    const BATCH = 100;

    async function saveRecState(s: ReconcileState) {
      await db.from("admin_config").upsert({
        key: STATE_KEY,
        value: s,
        updated_at: new Date().toISOString(),
        updated_by: null,
      });
    }

    if (state.sub === "counts") {
      // Fetch total once and cache it in state
      if (typeof state.total_groups !== "number") {
        try {
          const { count } = await db.from("style_groups").select("id", { count: "exact", head: true });
          state.total_groups = count ?? 0;
          await saveRecState(state);
        } catch { /* Non-fatal — UI will show count without denominator */ }
      }

      const { data: groupIds, error: fetchErr } = await db
        .from("style_groups")
        .select("id")
        .order("id")
        .range(state.cursor, state.cursor + BATCH - 1);

      if (fetchErr) return json({ ok: false, error: formatPostgrestError(fetchErr), stage: "reconcile", substage: "counts" }, 500);

      if (!groupIds || groupIds.length === 0) {
        state = { sub: "primaries", cursor: 0 };
        await saveRecState(state);
        return json({ ok: true, sub: "counts_done", counts_processed: state.cursor, total_groups: state.total_groups ?? 0, done: false, nextOffset: offset + 1 });
      }

      const ids = groupIds.map((g: { id: string }) => g.id);
      let batchIds = ids;
      while (batchIds.length > 0) {
        await sleep(100);
        const { error: countErr } = await db.rpc("refresh_style_group_counts_batch", { p_group_ids: batchIds });
        if (!countErr) break;

        const msg = formatPostgrestError(countErr);
        if (isStatementTimeout(msg) && batchIds.length > 1) {
          batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
          continue;
        }

        return json({ ok: false, error: msg, stage: "reconcile", substage: "counts", attempted_batch_size: batchIds.length }, 500);
      }

      state.cursor += batchIds.length;
      await saveRecState(state);
      return json({ ok: true, sub: "counts", counts_processed: state.cursor, total_groups: state.total_groups ?? 0, done: false, nextOffset: offset + 1 });
    }

    if (state.sub === "primaries") {
      const { data: groupIds, error: fetchErr } = await db
        .from("style_groups")
        .select("id")
        .order("id")
        .range(state.cursor, state.cursor + BATCH - 1);

      if (fetchErr) return json({ ok: false, error: formatPostgrestError(fetchErr), stage: "reconcile", substage: "primaries" }, 500);

      if (!groupIds || groupIds.length === 0) {
        await db.from("admin_config").delete().eq("key", STATE_KEY);
        return json({ ok: true, sub: "complete", primaries_processed: state.cursor, total_groups: state.total_groups ?? 0, done: true, nextOffset: offset + 1 });
      }

      const ids = groupIds.map((g: { id: string }) => g.id);
      let batchIds = ids;
      while (batchIds.length > 0) {
        await sleep(100);
        const { error: primErr } = await db.rpc("refresh_style_group_primaries", { p_group_ids: batchIds });
        if (!primErr) break;

        const msg = formatPostgrestError(primErr);
        if (isStatementTimeout(msg) && batchIds.length > 1) {
          batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
          continue;
        }

        return json({ ok: false, error: msg, stage: "reconcile", substage: "primaries", attempted_batch_size: batchIds.length }, 500);
      }

      state.cursor += batchIds.length;
      await saveRecState(state);
      return json({ ok: true, sub: "primaries", primaries_processed: state.cursor, total_groups: state.total_groups ?? 0, done: false, nextOffset: offset + 1 });
    }

    return json({ ok: false, error: "Unknown reconcile sub-stage", stage: "reconcile", substage: "unknown" }, 500);
  } catch (e) {
    const msg = e instanceof Error ? e.message : formatPostgrestError(e);
    console.error("reconcile-style-group-stats unhandled:", msg);
    return json({ ok: false, error: msg || "Internal server error", stage: "reconcile", substage: "unhandled" }, 500);
  }
}
