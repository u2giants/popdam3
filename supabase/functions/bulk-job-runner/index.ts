import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/http.ts";
import { unwrapConfigValue } from "../_shared/config-utils.ts";
import type { BulkOperationsMap, OpState, OpStatus } from "../_shared/types.ts";

// ── Constants ───────────────────────────────────────────────────────

const CONFIG_KEY = "BULK_OPERATIONS";
const MAX_RUN_MS = 45_000;
const DEFAULT_PERSIST_EVERY = 1;
const INTERRUPT_CHECK_EVERY = 10;
const MAX_TRANSIENT_RETRIES = 5;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Per-operation persist frequency overrides (rebuild needs more frequent saves)
const PERSIST_EVERY_OVERRIDES: Record<string, number> = {
  "rebuild-style-groups": 1,
};

// Auto-resume defaults
const AUTO_RESUME_DEFAULTS = {
  enabled: true,
  maxAttempts: 5,
  cooldownMs: 30_000,
  staleRunMinutes: 10,
};

// Maps operation key → admin-api action name
const OP_ACTIONS: Record<string, string> = {
  "reprocess-metadata": "reprocess-asset-metadata",
  "backfill-sku-names": "backfill-sku-names",
  "rebuild-style-groups": "rebuild-style-groups",
  "ai-tag-untagged": "bulk-ai-tag",
  "ai-tag-all": "bulk-ai-tag-all",
  "ai-tag-groups": "bulk-ai-tag-all",
  "reconcile-style-group-stats": "reconcile-style-group-stats",
  "erp-enrichment": "apply-erp-enrichment",
  "erp-classify": "classify-erp-categories",
};

// ── Interruption reason codes ───────────────────────────────────────

function classifyInterruptionReason(statusCode: number | null, errorMsg: string): string {
  if (!errorMsg && !statusCode) return "unknown";
  const msg = (errorMsg || "").toLowerCase();
  if (statusCode === 429 || msg.includes("rate limit exceeded")) return "rate_limited";
  if (statusCode && [502, 503, 504].includes(statusCode)) return "gateway_timeout";
  if (msg.includes("57014") || msg.includes("statement timeout")) return "statement_timeout";
  if (msg.includes("user_stop") || msg.includes("stopped by user")) return "user_stop";
  if (msg.includes("connection reset") || msg.includes("connection error")) return "connection_error";
  return "unknown";
}

// ── Progress accumulators ───────────────────────────────────────────

function buildProgress(
  opKey: string,
  batch: Record<string, unknown>,
  prev: Record<string, unknown>,
): Record<string, unknown> {
  switch (opKey) {
    case "reprocess-metadata":
      return {
        updated: ((prev.updated as number) || 0) + ((batch.updated as number) || 0),
        total: ((prev.total as number) || 0) + ((batch.total as number) || 0),
      };
    case "backfill-sku-names":
      return {
        assets_updated: (batch.assets_updated as number) || 0,
        groups_updated: (batch.groups_updated as number) || 0,
        assets_checked: (batch.assets_checked as number) || 0,
      };
    case "rebuild-style-groups":
      return {
        groups: ((prev.groups as number) || 0) + ((batch.groups_created as number) || 0),
        assigned: ((prev.assigned as number) || 0) + ((batch.assets_assigned as number) || 0),
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
        stage: batch.sub || prev.stage,
      };
    case "ai-tag-untagged":
    case "ai-tag-all":
    case "ai-tag-groups":
      return {
        tagged: ((prev.tagged as number) || 0) + ((batch.tagged as number) || 0),
        skipped: ((prev.skipped as number) || 0) + ((batch.skipped as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        total: prev.total || 0,
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
        total: Math.max((prev.total as number) || 0, (batch.total as number) || 0),
      };
    default:
      return { ...prev, ...batch };
  }
}

function buildResultMessage(opKey: string, progress: Record<string, unknown>): string {
  switch (opKey) {
    case "reprocess-metadata":
      return `Reprocessed ${progress.updated} assets`;
    case "backfill-sku-names":
      return `Backfilled ${progress.assets_updated} assets, ${progress.groups_updated} groups`;
    case "rebuild-style-groups":
      return `Created ${progress.groups} style groups, assigned ${progress.assigned} assets, processed ${progress.total_processed || 0}/${
        progress.total_assets || 0
      }`;
    case "reconcile-style-group-stats":
      return `Reconciled counts for ${progress.counts_processed || 0} groups, primaries for ${progress.primaries_processed || 0} groups`;
    case "ai-tag-untagged":
    case "ai-tag-all":
    case "ai-tag-groups":
      return `Tagged ${progress.tagged}. ${progress.skipped || 0} skipped. ${progress.failed || 0} failed.`;
    case "erp-enrichment":
      return `Enriched ${progress.assets_updated || 0} assets, ${progress.groups_updated || 0} groups`;
    case "erp-classify":
      return `AI-classified ${progress.classified || 0} items`;
    default:
      return "Operation completed";
  }
}

// ── Auto-resume configuration loader ────────────────────────────────

interface AutoResumeConfig {
  enabled: boolean;
  maxAttempts: number;
  cooldownMs: number;
  staleRunMinutes: number;
}

// deno-lint-ignore no-explicit-any
async function loadAutoResumeConfig(db: any): Promise<AutoResumeConfig> {
  const config = { ...AUTO_RESUME_DEFAULTS };
  try {
    const { data: rows } = await db
      .from("admin_config")
      .select("key, value")
      .in("key", [
        "REBUILD_AUTO_RESUME_ENABLED",
        "REBUILD_AUTO_RESUME_MAX_ATTEMPTS",
        "REBUILD_AUTO_RESUME_COOLDOWN_MS",
        "REBUILD_STALE_RUN_MINUTES",
      ]);
    for (const row of (rows ?? []) as Array<{ key: string; value: unknown }>) {
      const raw = row?.value;
      const val = unwrapConfigValue(raw);
      switch (row.key) {
        case "REBUILD_AUTO_RESUME_ENABLED":
          config.enabled = val !== false && val !== "false";
          break;
        case "REBUILD_AUTO_RESUME_MAX_ATTEMPTS": {
          const n = typeof val === "number" ? val : parseInt(String(val), 10);
          if (Number.isFinite(n) && n > 0) config.maxAttempts = n;
          break;
        }
        case "REBUILD_AUTO_RESUME_COOLDOWN_MS": {
          const n = typeof val === "number" ? val : parseInt(String(val), 10);
          if (Number.isFinite(n) && n > 0) config.cooldownMs = n;
          break;
        }
        case "REBUILD_STALE_RUN_MINUTES": {
          const n = typeof val === "number" ? val : parseInt(String(val), 10);
          if (Number.isFinite(n) && n > 0) config.staleRunMinutes = n;
          break;
        }
      }
    }
  } catch { /* defaults are fine */ }
  return config;
}

// ── Stale-lock detection ────────────────────────────────────────────

function detectStaleRun(opState: OpState, staleRunMinutes: number): boolean {
  if (opState.status !== "running") return false;
  if (!opState.updated_at) return false;
  const ageMs = Date.now() - new Date(opState.updated_at).getTime();
  return ageMs > staleRunMinutes * 60 * 1000;
}

// ── Main handler ────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("bulk-job-runner: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  const db = createClient(supabaseUrl, serviceRoleKey);
  const startTime = Date.now();

  try {
    // Load auto-resume config
    const autoResumeConfig = await loadAutoResumeConfig(db);

    // Read current BULK_OPERATIONS
    const { data: configRow } = await db
      .from("admin_config")
      .select("value")
      .eq("key", CONFIG_KEY)
      .maybeSingle();

    const allOps = (configRow?.value as Record<string, OpState>) || {};

    // ── Stale-lock detection ────────────────────────────────────────
    for (const [key, op] of Object.entries(allOps)) {
      if (detectStaleRun(op, autoResumeConfig.staleRunMinutes)) {
        console.warn(`bulk-job-runner: stale lock detected for '${key}' (last update: ${op.updated_at})`);
        allOps[key] = {
          ...op,
          status: "interrupted",
          interruption_reason_code: "stale_run",
          error: `No progress for ${autoResumeConfig.staleRunMinutes}+ minutes — marked as stale`,
          updated_at: new Date().toISOString(),
        };
      }
    }

    // ── Auto-resume interrupted operations ──────────────────────────
    if (autoResumeConfig.enabled) {
      for (const [key, op] of Object.entries(allOps)) {
        if (op.status !== "interrupted") continue;
        if (op.interruption_reason_code === "user_stop") continue; // respect manual stops

        const attempts = op.auto_resume_attempts ?? 0;
        if (attempts >= autoResumeConfig.maxAttempts) continue;

        // Check cooldown
        const lastResumeAt = op.last_auto_resume_at ? new Date(op.last_auto_resume_at).getTime() : 0;
        const updatedAt = op.updated_at ? new Date(op.updated_at).getTime() : 0;
        const lastEventAt = Math.max(lastResumeAt, updatedAt);
        if (Date.now() - lastEventAt < autoResumeConfig.cooldownMs) continue;

        console.log(`bulk-job-runner: auto-resuming '${key}' (attempt ${attempts + 1}/${autoResumeConfig.maxAttempts})`);
        allOps[key] = {
          ...op,
          status: "running",
          auto_resume_attempts: attempts + 1,
          last_auto_resume_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
    }

    // Find first operation with status "running"
    let runningEntry = Object.entries(allOps).find(([_, op]) => op.status === "running");

    if (!runningEntry) {
      // Check for queued operations to promote
      const queuedEntries = Object.entries(allOps).filter(([_, op]) => op.status === "queued");
      if (queuedEntries.length > 0) {
        queuedEntries.sort((a, b) => {
          const posA = a[1].queue_position ?? Number.MAX_SAFE_INTEGER;
          const posB = b[1].queue_position ?? Number.MAX_SAFE_INTEGER;
          if (posA !== posB) return posA - posB;
          return new Date(a[1].updated_at || 0).getTime() - new Date(b[1].updated_at || 0).getTime();
        });

        const [nextOpKey, nextOp] = queuedEntries[0];
        console.log(`bulk-job-runner: Promoting '${nextOpKey}' from queue to running.`);
        allOps[nextOpKey] = {
          ...nextOp,
          status: "running",
          updated_at: new Date().toISOString(),
        };
        runningEntry = [nextOpKey, allOps[nextOpKey]];
      }
    }

    if (!runningEntry) {
      // Save any stale-lock or auto-resume state changes atomically
      if (configRow) {
        const updates: Record<string, OpState> = {};
        for (const [key, op] of Object.entries(allOps)) {
          const original = (configRow?.value as Record<string, OpState>)?.[key];
          if (JSON.stringify(op) !== JSON.stringify(original)) {
            updates[key] = op;
          }
        }
        if (Object.keys(updates).length > 0) {
          await db.rpc("update_bulk_operations_batch", { p_updates: updates });
        }
      }
      return json({ ok: true, message: "No running operations" });
    }

    const [opKey, opState] = runningEntry;
    const persistEvery = PERSIST_EVERY_OVERRIDES[opKey] ?? DEFAULT_PERSIST_EVERY;

    // Legacy client-driven ops (no cursor field) — mark as interrupted, don't process
    if (opState.cursor === undefined && opState.cursor !== 0) {
      const now = new Date().toISOString();
      allOps[opKey] = { ...opState, status: "interrupted", interruption_reason_code: "legacy_format", updated_at: now };
      await db.rpc("update_bulk_operation", {
        p_op_key: opKey,
        p_op_state: allOps[opKey],
      });
      console.log(`bulk-job-runner: legacy op '${opKey}' marked as interrupted`);
      return json({ ok: true, message: `Legacy op ${opKey} marked as interrupted` });
    }

    const action = OP_ACTIONS[opKey] || opState.params?.type as string;
    if (!action) {
      const now = new Date().toISOString();
      allOps[opKey] = {
        ...opState,
        status: "failed",
        error: `Unknown operation type: ${opKey}`,
        interruption_reason_code: "unknown_action",
        updated_at: now,
      };
      await db.rpc("update_bulk_operation", {
        p_op_key: opKey,
        p_op_state: allOps[opKey],
      });
      return json({ ok: true, message: `Unknown op: ${opKey}` });
    }

    // Ensure run_id exists
    if (!opState.run_id) {
      opState.run_id = crypto.randomUUID();
    }

    let cursor = opState.cursor ?? 0;
    let progress = opState.progress ?? {};
    let batchCount = 0;
    let done = false;
    let lastError: string | null = null;
    let lastErrorStatus: number | null = null;
    let transientRetries = 0;
    let isTransientFailure = false;
    let lastStage: string | undefined = opState.last_stage;
    let lastSubstage: string | undefined = opState.last_substage;

    console.log(`bulk-job-runner: processing '${opKey}' action='${action}' cursor=${cursor} run_id=${opState.run_id}`);

    // Process batches until time budget exhausted or done
    while (Date.now() - startTime < MAX_RUN_MS) {
      // Check for user interruption periodically
      if (batchCount > 0 && batchCount % INTERRUPT_CHECK_EVERY === 0) {
        const { data: freshConfig } = await db
          .from("admin_config")
          .select("value")
          .eq("key", CONFIG_KEY)
          .maybeSingle();
        const freshOps = (freshConfig?.value as Record<string, OpState>) || {};
        if (freshOps[opKey]?.status !== "running") {
          console.log(`bulk-job-runner: op '${opKey}' was stopped by user`);
          allOps[opKey] = {
            ...freshOps[opKey],
            progress,
            cursor,
            interruption_reason_code: "user_stop",
            last_stage: lastStage,
            last_substage: lastSubstage,
            updated_at: new Date().toISOString(),
          };
          await db.rpc("update_bulk_operation", {
            p_op_key: opKey,
            p_op_state: allOps[opKey],
          });
          return json({ ok: true, message: `Operation ${opKey} stopped by user`, batches: batchCount });
        }
      }

      try {
        const requestBody: Record<string, unknown> = {
          action,
          offset: cursor,
        };

        if (opState.params) {
          for (const [k, v] of Object.entries(opState.params)) {
            if (k !== "type" && k !== "total") {
              requestBody[k] = v;
            }
          }
        }

        const res = await fetch(`${supabaseUrl}/functions/v1/admin-api`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          const isRateLimit = res.status === 429;
          const isTransientStatus = [502, 503, 504].includes(res.status) || isRateLimit;
          lastErrorStatus = res.status;
          const text = await res.text();
          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(text);
          } catch { /* not JSON */ }
          const stageInfo = parsed?.stage ? ` [stage=${parsed.stage}${parsed.substage ? `/substage=${parsed.substage}` : ""}]` : "";
          lastError = `admin-api returned ${res.status}:${stageInfo} ${(parsed?.error as string) || text.slice(0, 500)}`;

          // Capture stage info from error response
          if (parsed?.stage) lastStage = parsed.stage as string;
          if (parsed?.substage) lastSubstage = parsed.substage as string;

          const isRateLimitMessage = /rate limit exceeded/i.test(lastError);
          const isTransient = isTransientStatus || isRateLimitMessage;

          if (isTransient && transientRetries < MAX_TRANSIENT_RETRIES) {
            transientRetries++;
            const delayMs = (isRateLimit || isRateLimitMessage)
              ? Math.min(5000 * transientRetries, 30000)
              : 1000 * transientRetries;
            console.warn(`bulk-job-runner: transient ${res.status} for '${opKey}' (retry ${transientRetries}/${MAX_TRANSIENT_RETRIES}), waiting ${delayMs}ms`);
            await sleep(delayMs);
            continue; // retry same cursor
          }
...
          const isRateLimitMessage = /rate limit exceeded/i.test(String(result.error || ""));
          if (isRateLimitMessage && transientRetries < MAX_TRANSIENT_RETRIES) {
            transientRetries++;
            const delayMs = Math.min(5000 * transientRetries, 30000);
            console.warn(`bulk-job-runner: transient rate-limit for '${opKey}' (retry ${transientRetries}/${MAX_TRANSIENT_RETRIES}), waiting ${delayMs}ms`);
            await sleep(delayMs);
            continue; // retry same cursor
          }

          isTransientFailure = isRateLimitMessage;
          console.error(`bulk-job-runner: ${lastError}`);
          break;
        }

        // Capture stage/substage from success response
        if (result.stage) lastStage = result.stage;
        if (result.sub || result.substage) lastSubstage = result.sub || result.substage;

        progress = buildProgress(opKey, result, progress);
        batchCount++;

        if (result.done !== false) {
          done = true;
          break;
        }

        cursor = result.nextOffset ?? cursor + 1;

        if (batchCount % persistEvery === 0) {
          // Atomic mid-batch persist — only updates if status is still "running"
          const midState: OpState = {
            ...opState,
            status: "running",
            cursor,
            progress,
            run_id: opState.run_id,
            last_stage: lastStage,
            last_substage: lastSubstage,
            updated_at: new Date().toISOString(),
          };
          const result = await db.rpc("update_bulk_operation", {
            p_op_key: opKey,
            p_op_state: midState,
            p_only_if_status: "running",
          });
          // If the RPC returned unchanged state (status != running), user stopped
          const afterOps = result.data as Record<string, OpState> | null;
          if (afterOps?.[opKey]?.status && afterOps[opKey].status !== "running") {
            console.log(
              `bulk-job-runner: op '${opKey}' status changed to ${afterOps[opKey].status} by UI. Aborting loop.`,
            );
            break;
          }
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Unknown batch error";
        // Network-level errors (connection reset, fetch failed) are transient
        const errMsg = lastError.toLowerCase();
        if (errMsg.includes("connection") || errMsg.includes("fetch failed") || errMsg.includes("error reading a body") || errMsg.includes("tcp")) {
          isTransientFailure = true;
        }
        console.error(`bulk-job-runner: batch error in '${opKey}':`, lastError);
        break;
      }
    }

    // Final state update
    const now = new Date().toISOString();
    const reasonCode = lastError ? classifyInterruptionReason(lastErrorStatus, lastError) : undefined;

    if (done) {
      // Post-completion integrity check for rebuild-style-groups
      let completionStatus: OpStatus = "completed";
      let resultMessage = buildResultMessage(opKey, progress);

      if (opKey === "rebuild-style-groups") {
        try {
          const { data: anomalyRows } = await db.rpc("execute_readonly_query", {
            query_text: `
              SELECT
                (SELECT COUNT(*) FROM style_groups WHERE (asset_count IS NULL OR asset_count = 0) AND id IN (SELECT DISTINCT style_group_id FROM assets WHERE is_deleted = false AND style_group_id IS NOT NULL)) AS orphan_counts,
                (SELECT COUNT(*) FROM style_groups WHERE primary_asset_id IS NULL AND id IN (SELECT DISTINCT style_group_id FROM assets WHERE is_deleted = false AND style_group_id IS NOT NULL)) AS missing_primaries
            `,
          });
          const anomalies = Array.isArray(anomalyRows) ? anomalyRows[0] : null;
          const orphanCounts = Number(anomalies?.orphan_counts ?? 0);
          const missingPrimaries = Number(anomalies?.missing_primaries ?? 0);

          if (orphanCounts > 0 || missingPrimaries > 0) {
            completionStatus = "completed_with_repair";
            resultMessage += ` | ${orphanCounts} groups need count repair, ${missingPrimaries} need primary repair`;
            console.warn(`bulk-job-runner: rebuild completed with anomalies — orphan_counts=${orphanCounts}, missing_primaries=${missingPrimaries}`);

            // Auto-queue reconcile if anomalies detected
            if (!allOps["reconcile-style-group-stats"] || allOps["reconcile-style-group-stats"].status !== "running") {
              allOps["reconcile-style-group-stats"] = {
                status: "running",
                cursor: 0,
                run_id: crypto.randomUUID(),
                started_at: now,
                updated_at: now,
                progress: {},
                params: {},
              };
              console.log("bulk-job-runner: auto-queued reconcile-style-group-stats due to post-rebuild anomalies");
            }
          }
        } catch (e) {
          console.warn("bulk-job-runner: post-rebuild integrity check failed:", e);
        }
      }

      allOps[opKey] = {
        ...opState,
        status: completionStatus,
        cursor,
        progress,
        result_message: resultMessage,
        run_id: opState.run_id,
        last_stage: lastStage,
        last_substage: lastSubstage,
        auto_resume_attempts: 0,
        updated_at: now,
      };
      console.log(`bulk-job-runner: '${opKey}' ${completionStatus} — ${resultMessage}`);
    } else if (lastError && (isTransientFailure || reasonCode === "gateway_timeout")) {
      // Transient errors (502/503/504, connection resets) → interrupted (auto-resumable)
      allOps[opKey] = {
        ...opState,
        status: "interrupted",
        cursor,
        progress,
        error: `Transient error (resumable): ${lastError}`,
        interruption_reason_code: reasonCode || "gateway_timeout",
        run_id: opState.run_id,
        last_stage: lastStage,
        last_substage: lastSubstage,
        updated_at: now,
      };
      console.warn(`bulk-job-runner: '${opKey}' interrupted (${reasonCode}) — ${lastError}`);
    } else if (lastError) {
      allOps[opKey] = {
        ...opState,
        status: "failed",
        cursor,
        progress,
        error: lastError,
        interruption_reason_code: reasonCode,
        run_id: opState.run_id,
        last_stage: lastStage,
        last_substage: lastSubstage,
        updated_at: now,
      };
      console.error(`bulk-job-runner: '${opKey}' failed (${reasonCode}) — ${lastError}`);
    } else {
      // Time budget exhausted, still running — save cursor for next invocation
      allOps[opKey] = {
        ...opState,
        status: "running",
        cursor,
        progress,
        run_id: opState.run_id,
        last_stage: lastStage,
        last_substage: lastSubstage,
        updated_at: now,
      };
      console.log(`bulk-job-runner: '${opKey}' paused after ${batchCount} batches, cursor=${cursor}`);
    }

    // Atomic final write using batch RPC — eliminates race conditions
    const finalUpdates: Record<string, OpState> = { [opKey]: allOps[opKey] };

    // Also carry over any auto-queued reconcile from post-rebuild integrity check
    if (
      opKey !== "reconcile-style-group-stats" &&
      allOps["reconcile-style-group-stats"]?.status === "running" &&
      allOps["reconcile-style-group-stats"]?.run_id
    ) {
      finalUpdates["reconcile-style-group-stats"] = allOps["reconcile-style-group-stats"];
    }

    await db.rpc("update_bulk_operations_batch", { p_updates: finalUpdates });

    return json({
      ok: true,
      op: opKey,
      batches: batchCount,
      done,
      error: lastError,
      interruption_reason_code: reasonCode,
      elapsed_ms: Date.now() - startTime,
    });
  } catch (e) {
    console.error("bulk-job-runner unhandled error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
