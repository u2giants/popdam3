import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/http.ts";
import { unwrapConfigValue } from "../_shared/config-utils.ts";
import { handleRebuildStyleGroups } from "../_shared/admin-handlers/style-group-handlers.ts";
import type { OpState, OpStatus } from "../_shared/types.ts";
import { classifyInterruptionReason, getLane, OP_ACTIONS } from "../_shared/operation-constants.ts";

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

// Inter-call delay (ms) per operation to avoid Edge Function rate limits.
// Supabase allows ~60 admin-api calls/minute. These delays keep us safely under.
const INTER_CALL_DELAY_MS: Record<string, number> = {
  "rebuild-style-groups": 500, // Balance between speed and rate-limit avoidance
  "reconcile-style-group-stats": 100, // Now runs via DB function — minimal delay needed
  "erp-classify": 1000, // 5 AI calls per batch (~40s), give breathing room between batches
  "propagate-group-tags": 100, // Now runs via DB function — minimal delay needed
  "ai-tag-untagged": 0, // Direct edge path — no admin-api rate limit to respect
  "ai-tag-all": 0,
  "ai-tag-groups": 0,
};

// Operations that bypass admin-api HTTP and call db.rpc() directly
const RPC_DIRECT_OPS = new Set(["propagate-group-tags", "reconcile-style-group-stats"]);
// Operations that run locally in-process to avoid an extra Edge gateway hop
const LOCAL_HANDLER_OPS = new Set(["rebuild-style-groups"]);
// Operations that bypass admin-api HTTP and call their edge function directly
const DIRECT_EDGE_OPS = new Set(["ai-tag-untagged", "ai-tag-all", "ai-tag-groups"]);

const AUTO_RESUME_DEFAULTS = {
  enabled: true,
  maxAttempts: 5,
  cooldownMs: 30_000,
  staleRunMinutes: 10,
};

const AUTO_RESUME_MAX_ATTEMPTS_BY_OP: Record<string, number> = {
  // Long-running ERP classification can hit intermittent gateway timeouts at scale.
  // Allow substantially more resumptions so very large runs (e.g. 90k+) don't stall.
  "erp-classify": 1000,
  // AI tagging at 81k+ assets will run for many hours; allow unlimited auto-resumes.
  // Without this, the default limit of 5 causes permanent stall after ~30 minutes.
  "ai-tag-untagged": 1000,
  "ai-tag-all": 1000,
  "ai-tag-groups": 1000,
  // Propagation iterates many groups with heavy per-group queries; transient WORKER_LIMIT is common.
  "propagate-group-tags": 50,
  // Rebuild processes 90k+ assets across 4 stages; rate limits and timeouts are expected.
  "rebuild-style-groups": 50,
};

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
        grand_total: (batch.grand_total as number) || (prev.grand_total as number) || 0,
        assets_checked: Math.max((prev.assets_checked as number) || 0, (batch.assets_checked as number) || 0),
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
        stage_started_at: (batch.stage_started_at as string) || (prev.stage_started_at as string),
      };
    case "reconcile-style-group-stats":
      return {
        counts_processed: Math.max((prev.counts_processed as number) || 0, (batch.counts_processed as number) || 0),
        primaries_processed: Math.max((prev.primaries_processed as number) || 0, (batch.primaries_processed as number) || 0),
        total_groups: Math.max((prev.total_groups as number) || 0, (batch.total_groups as number) || 0),
        stage: batch.sub || prev.stage,
      };
    case "ai-tag-untagged":
    case "ai-tag-all":
    case "ai-tag-groups": {
      const prevFailSamples = Array.isArray(prev.failure_samples) ? (prev.failure_samples as unknown[]) : [];
      const batchFailSamples = Array.isArray(batch.failure_samples) ? (batch.failure_samples as unknown[]) : [];
      const mergedFailSamples = [...prevFailSamples, ...batchFailSamples].slice(-200);

      const prevSkipSamples = Array.isArray(prev.skip_samples) ? (prev.skip_samples as unknown[]) : [];
      const batchSkipSamples = Array.isArray(batch.skip_samples) ? (batch.skip_samples as unknown[]) : [];
      const mergedSkipSamples = [...prevSkipSamples, ...batchSkipSamples].slice(-200);

      return {
        tagged: ((prev.tagged as number) || 0) + ((batch.tagged as number) || 0),
        skipped: ((prev.skipped as number) || 0) + ((batch.skipped as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        total: prev.total || 0,
        failure_samples: mergedFailSamples,
        skip_samples: mergedSkipSamples,
      };
    }
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
      return `AI-classified ${progress.classified || 0} items (${progress.skipped_unclassifiable || 0} unclassifiable)`;
    case "propagate-group-tags":
      return `Propagated tags across ${progress.propagated || 0} groups (${progress.skipped || 0} skipped)`;
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
        // Skip operations that shouldn't be auto-resumed
        if (op.interruption_reason_code === "user_stop") continue; // respect manual stops
        if (op.interruption_reason_code === "legacy_format") continue; // needs manual restart with proper cursor

        const attempts = op.auto_resume_attempts ?? 0;
        const maxAttemptsForOp = AUTO_RESUME_MAX_ATTEMPTS_BY_OP[key] ?? autoResumeConfig.maxAttempts;
        if (attempts >= maxAttemptsForOp) continue;

        // Check cooldown
        const lastResumeAt = op.last_auto_resume_at ? new Date(op.last_auto_resume_at).getTime() : 0;
        const updatedAt = op.updated_at ? new Date(op.updated_at).getTime() : 0;
        const lastEventAt = Math.max(lastResumeAt, updatedAt);
        if (Date.now() - lastEventAt < autoResumeConfig.cooldownMs) continue;

        console.log(`bulk-job-runner: auto-resuming '${key}' (attempt ${attempts + 1}/${maxAttemptsForOp})`);
        allOps[key] = {
          ...op,
          status: "running",
          started_at: new Date().toISOString(),
          auto_resume_attempts: attempts + 1,
          last_auto_resume_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
    }

    // Find ALL running operations, grouped by lane
    const runningEntries = Object.entries(allOps).filter(([_, op]) => op.status === "running");

    // Promote queued ops into lanes that have no running op
    const activeLanes = new Set(runningEntries.map(([k]) => getLane(k)));
    const queuedEntries = Object.entries(allOps)
      .filter(([_, op]) => op.status === "queued")
      .sort((a, b) => {
        const posA = a[1].queue_position ?? Number.MAX_SAFE_INTEGER;
        const posB = b[1].queue_position ?? Number.MAX_SAFE_INTEGER;
        if (posA !== posB) return posA - posB;
        return new Date(a[1].updated_at || 0).getTime() - new Date(b[1].updated_at || 0).getTime();
      });

    for (const [nextOpKey, nextOp] of queuedEntries) {
      const lane = getLane(nextOpKey);
      if (!activeLanes.has(lane)) {
        console.log(`bulk-job-runner: Promoting '${nextOpKey}' from queue to running (lane: ${lane}).`);
        allOps[nextOpKey] = {
          ...nextOp,
          status: "running",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        runningEntries.push([nextOpKey, allOps[nextOpKey]]);
        activeLanes.add(lane);
      }
    }

    // Pick one running op to process this invocation (round-robin by least-recently-updated)
    let runningEntry: [string, OpState] | undefined;
    if (runningEntries.length > 0) {
      runningEntries.sort((a, b) => {
        const aTime = a[1].updated_at ? new Date(a[1].updated_at).getTime() : 0;
        const bTime = b[1].updated_at ? new Date(b[1].updated_at).getTime() : 0;
        return aTime - bTime; // oldest update first = most starved
      });
      runningEntry = runningEntries[0] as [string, OpState];
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
        let result: Record<string, unknown>;

        // ── Direct RPC path (bypasses admin-api HTTP entirely) ──────
        if (RPC_DIRECT_OPS.has(opKey)) {
          if (opKey === "propagate-group-tags") {
            const rpcCursor = (typeof cursor === "string" && cursor !== "0" && cursor !== 0) ? cursor as string : null;
            const { data, error: rpcErr } = await db.rpc("propagate_group_tags_batch", {
              p_cursor: rpcCursor,
              p_batch_size: 200,
            });
            if (rpcErr) {
              lastError = `rpc error: ${rpcErr.message}`;
              const msg = rpcErr.message.toLowerCase();
              isTransientFailure = msg.includes("timeout") || msg.includes("57014");
              break;
            }
            const row = Array.isArray(data) ? data[0] : data;
            if (!row) {
              lastError = "No result from propagate_group_tags_batch";
              break;
            }
            result = {
              ok: true,
              propagated: row.propagated ?? 0,
              skipped: row.skipped ?? 0,
              done: row.done ?? true,
              nextOffset: row.next_cursor ?? rpcCursor,
            };
          } else if (opKey === "reconcile-style-group-stats") {
            // Fetch total_groups once for progress display
            if (!progress.total_groups) {
              const { count } = await db.from("style_groups").select("id", { count: "exact", head: true });
              progress.total_groups = count ?? 0;
            }
            // Determine sub-stage from progress
            const currentSub = (progress.stage as string) || "counts";
            const rpcSub = currentSub === "counts_done" ? "primaries" : (currentSub === "complete" ? "counts" : currentSub);
            const rpcCursor = (typeof cursor === "string" && cursor !== "0" && cursor !== "") ? cursor as string : null;
            const { data, error: rpcErr } = await db.rpc("reconcile_style_group_stats_batch", {
              p_cursor: rpcCursor,
              p_batch_size: 200,
              p_sub: rpcSub,
            });
            if (rpcErr) {
              lastError = `rpc error: ${rpcErr.message}`;
              const msg = rpcErr.message.toLowerCase();
              isTransientFailure = msg.includes("timeout") || msg.includes("57014");
              break;
            }
            const row = Array.isArray(data) ? data[0] : data;
            if (!row) {
              lastError = "No result from reconcile_style_group_stats_batch";
              break;
            }
            const returnedSub = row.sub ?? rpcSub;
            const isDone = row.done ?? false;
            // Track counts/primaries processed based on sub-stage
            const batchResult: Record<string, unknown> = {
              ok: true,
              done: isDone,
              sub: returnedSub,
              nextOffset: row.next_cursor ?? null,
              total_groups: (progress.total_groups as number) || 0,
            };
            if (rpcSub === "counts") {
              batchResult.counts_processed = ((progress.counts_processed as number) || 0) + (row.processed ?? 0);
            } else if (rpcSub === "primaries") {
              batchResult.primaries_processed = ((progress.primaries_processed as number) || 0) + (row.processed ?? 0);
            }
            result = batchResult;
          } else {
            lastError = `No RPC handler for ${opKey}`;
            break;
          }
          // Reset transient retry counter on RPC success
          transientRetries = 0;
        } else if (LOCAL_HANDLER_OPS.has(opKey)) {
          if (opKey === "rebuild-style-groups") {
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

            const localResponse = await handleRebuildStyleGroups(requestBody);
            const responseText = await localResponse.text();
            let parsed: Record<string, unknown> | null = null;
            try {
              parsed = JSON.parse(responseText);
            } catch {
              parsed = null;
            }

            if (!localResponse.ok) {
              const isRateLimit = localResponse.status === 429;
              const isTransientStatus = [502, 503, 504].includes(localResponse.status) || isRateLimit;
              lastErrorStatus = localResponse.status;
              const stageInfo = parsed?.stage ? ` [stage=${parsed.stage}${parsed.substage ? `/substage=${parsed.substage}` : ""}]` : "";
              lastError = `local rebuild handler returned ${localResponse.status}:${stageInfo} ${(parsed?.error as string) || responseText.slice(0, 500)}`;

              if (parsed?.stage) lastStage = parsed.stage as string;
              if (parsed?.substage) lastSubstage = parsed.substage as string;

              const isRateLimitMessage = /rate limit exceeded/i.test(lastError);
              const isTransient = isTransientStatus || isRateLimitMessage;

              if (isTransient && transientRetries < MAX_TRANSIENT_RETRIES) {
                transientRetries++;
                const delayMs = (isRateLimit || isRateLimitMessage) ? Math.min(5000 * transientRetries, 30000) : 1000 * transientRetries;
                console.warn(
                  `bulk-job-runner: transient ${localResponse.status} for '${opKey}' (retry ${transientRetries}/${MAX_TRANSIENT_RETRIES}), waiting ${delayMs}ms`,
                );
                await sleep(delayMs);
                continue;
              }

              console.error(`bulk-job-runner: ${lastError}`);
              isTransientFailure = isTransient;
              break;
            }

            transientRetries = 0;
            result = parsed ?? { ok: false, error: "Local rebuild handler returned invalid JSON" };

            if (!result.ok) {
              const stageInfo = result.stage ? ` [stage=${result.stage}${result.substage ? `/substage=${result.substage}` : ""}]` : "";
              lastError = `${stageInfo} ${result.error || "Local rebuild handler returned error"}`;
              if (result.stage) lastStage = result.stage as string;
              if (result.substage) lastSubstage = result.substage as string;

              const isRateLimitMessage = /rate limit exceeded/i.test(String(result.error || ""));
              if (isRateLimitMessage && transientRetries < MAX_TRANSIENT_RETRIES) {
                transientRetries++;
                const delayMs = Math.min(5000 * transientRetries, 30000);
                console.warn(`bulk-job-runner: transient rate-limit for '${opKey}' (retry ${transientRetries}/${MAX_TRANSIENT_RETRIES}), waiting ${delayMs}ms`);
                await sleep(delayMs);
                continue;
              }

              isTransientFailure = isRateLimitMessage;
              console.error(`bulk-job-runner: ${lastError}`);
              break;
            }
          } else {
            lastError = `No local handler for ${opKey}`;
            break;
          }
        } else if (DIRECT_EDGE_OPS.has(opKey)) {
          // ── Direct Edge Function path (smart-skip, 4-wide concurrency) ──────
          const AI_TAG_CONCURRENCY = 4;
          const AI_TAG_REQUEST_TIMEOUT_MS = 25_000;
          const force = opKey === "ai-tag-all" || opKey === "ai-tag-groups";
          const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey;

          // Build smart asset query with representative priority
          // Smart-skip: for "untagged" mode, skip assets whose style group already has a tagged sibling
          // Priority: tech_pack filenames > mockup > generic > art > packaging (via primary_sort_tier)
          const groupIds = opState.params?.group_ids;

          // Use RPC-style raw query for the smart-skip NOT EXISTS clause
          // Since PostgREST can't do NOT EXISTS subqueries, we use a two-step approach:
          // 1. If smart-skip is active, first get style_group_ids that already have a tagged asset
          // 2. Exclude those from the main query
          let excludeGroupIds: string[] = [];
          if (opKey === "ai-tag-untagged" && !groupIds) {
            // Find style groups that already have at least one tagged asset
            const { data: taggedGroups } = await db
              .from("assets")
              .select("style_group_id")
              .eq("is_deleted", false)
              .eq("status", "tagged")
              .not("style_group_id", "is", null)
              .not("ai_tagged_at", "is", null)
              .limit(1000);
            if (taggedGroups) {
              excludeGroupIds = [...new Set(taggedGroups.map((r: { style_group_id: string }) => r.style_group_id))];
            }
          }

          let query = db
            .from("assets")
            .select("id, thumbnail_url, filename, relative_path, style_group_id")
            .eq("is_deleted", false)
            .not("thumbnail_url", "is", null)
            // Skip packaging files — if a group only has packaging, it stays "waiting for siblings"
            .not("primary_sort_tier", "in", "(4,8)");

          if (Array.isArray(groupIds) && groupIds.length > 0) {
            query = query.in("style_group_id", groupIds);
          }

          if (opKey !== "ai-tag-all" && !groupIds) {
            query = query.neq("status", "tagged");
          }

          // Exclude groups that already have a tagged representative
          // PostgREST doesn't support NOT IN for large arrays, so we chunk if needed
          if (excludeGroupIds.length > 0 && excludeGroupIds.length <= 200) {
            // Use .not().in() for reasonable-sized exclusion lists
            query = query.not("style_group_id", "in", `(${excludeGroupIds.join(",")})`);
          }
          // For >200 excluded groups, we skip the filter and let the ai-tag function handle dedup via its own "already tagged" check

          const { data: assets, error: fetchErr } = await query
            .order("primary_sort_tier", { ascending: true })
            .order("id", { ascending: true })
            .range(cursor, cursor + AI_TAG_CONCURRENCY - 1);

          if (fetchErr) {
            lastError = `fetch error: ${fetchErr.message}`;
            break;
          }

          if (!assets || assets.length === 0) {
            // If we were excluding groups, there might be ungrouped assets left
            // Try without the exclusion filter
            if (excludeGroupIds.length > 0) {
              const { data: ungrouped } = await db
                .from("assets")
                .select("id")
                .eq("is_deleted", false)
                .not("thumbnail_url", "is", null)
                .neq("status", "tagged")
                .is("style_group_id", null)
                .limit(1);
              if (ungrouped && ungrouped.length > 0) {
                // There are ungrouped assets — remove the exclusion and re-query
                const { data: fallbackAssets } = await db
                  .from("assets")
                  .select("id, thumbnail_url, filename, relative_path, style_group_id")
                  .eq("is_deleted", false)
                  .not("thumbnail_url", "is", null)
                  .neq("status", "tagged")
                  .is("style_group_id", null)
                  .order("primary_sort_tier", { ascending: true })
                  .order("id", { ascending: true })
                  .range(0, AI_TAG_CONCURRENCY - 1);
                if (fallbackAssets && fallbackAssets.length > 0) {
                  // Process these ungrouped assets
                  // (fall through to the parallel processing below by reassigning)
                  assets.push(...fallbackAssets);
                }
              }
            }
            if (!assets || assets.length === 0) {
              result = {
                ok: true,
                tagged: 0,
                skipped: 0,
                failed: 0,
                failure_samples: [],
                skip_samples: [],
                done: true,
                nextOffset: cursor,
              };
            }
          }

          // Process batch in parallel if we have assets
          if (assets && assets.length > 0) {
            const results = await Promise.allSettled(
              assets.map(async (asset: { id: string; thumbnail_url: string; filename: string; relative_path: string }) => {
                const res = await fetch(`${supabaseUrl}/functions/v1/ai-tag`, {
                  signal: AbortSignal.timeout(AI_TAG_REQUEST_TIMEOUT_MS),
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${anonKey}`,
                  },
                  body: JSON.stringify({ asset_id: asset.id, force }),
                });

                if (res.ok) {
                  const resData = await res.json();
                  return { outcome: "ok" as const, asset, resData };
                }
                const text = await res.text().catch(() => "");
                return { outcome: "error" as const, asset, status: res.status, text };
              }),
            );

            let batchTagged = 0, batchSkipped = 0, batchFailed = 0;
            const batchFailSamples: unknown[] = [];
            const batchSkipSamples: unknown[] = [];
            let hitRateLimit = false;

            for (const r of results) {
              if (r.status === "fulfilled") {
                const v = r.value;
                if (v.outcome === "ok") {
                  if (v.resData.skipped) {
                    batchSkipped++;
                    batchSkipSamples.push({
                      at: new Date().toISOString(),
                      asset_id: v.asset.id,
                      filename: v.asset.filename || "(unknown)",
                      relative_path: v.asset.relative_path || "(unknown)",
                      thumbnail_url: v.asset.thumbnail_url,
                      reason: v.resData.reason || "Already tagged",
                    });
                  } else {
                    batchTagged++;
                  }
                } else {
                  if (v.status === 429) hitRateLimit = true;
                  batchFailed++;
                  batchFailSamples.push({
                    at: new Date().toISOString(),
                    asset_id: v.asset.id,
                    filename: v.asset.filename || "(unknown)",
                    relative_path: v.asset.relative_path || "(unknown)",
                    thumbnail_url: v.asset.thumbnail_url,
                    http_status: v.status,
                    error: (v.text || "").substring(0, 500) || `HTTP ${v.status}`,
                  });
                }
              } else {
                batchFailed++;
                batchFailSamples.push({
                  at: new Date().toISOString(),
                  asset_id: "(unknown)",
                  filename: "(unknown)",
                  relative_path: "(unknown)",
                  error: (r.reason instanceof Error ? r.reason.message : String(r.reason || "Unknown")).slice(0, 500),
                });
              }
            }

            if (hitRateLimit && transientRetries < MAX_TRANSIENT_RETRIES) {
              transientRetries++;
              const delayMs = Math.min(5000 * transientRetries, 30000);
              console.warn(`bulk-job-runner: rate-limit in parallel ai-tag batch (retry ${transientRetries}), waiting ${delayMs}ms`);
              await sleep(delayMs);
              continue;
            }

            result = {
              ok: true,
              done: false,
              nextOffset: cursor + assets.length,
              tagged: batchTagged,
              skipped: batchSkipped,
              failed: batchFailed,
              failure_samples: batchFailSamples,
              skip_samples: batchSkipSamples,
            };
          } else {
            // Already set result above in the empty-assets branch
            result = result!;
          }
          transientRetries = 0;
        } else {
          // ── HTTP path (admin-api) ─────────────────────────────────
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

            if (parsed?.stage) lastStage = parsed.stage as string;
            if (parsed?.substage) lastSubstage = parsed.substage as string;

            const isRateLimitMessage = /rate limit exceeded/i.test(lastError);
            const isTransient = isTransientStatus || isRateLimitMessage;

            if (isTransient && transientRetries < MAX_TRANSIENT_RETRIES) {
              transientRetries++;
              const delayMs = (isRateLimit || isRateLimitMessage) ? Math.min(5000 * transientRetries, 30000) : 1000 * transientRetries;
              console.warn(
                `bulk-job-runner: transient ${res.status} for '${opKey}' (retry ${transientRetries}/${MAX_TRANSIENT_RETRIES}), waiting ${delayMs}ms`,
              );
              await sleep(delayMs);
              continue;
            }

            console.error(`bulk-job-runner: ${lastError}`);
            isTransientFailure = isTransient;
            break;
          }

          transientRetries = 0;

          result = await res.json();
          if (!result.ok) {
            const stageInfo = result.stage ? ` [stage=${result.stage}${result.substage ? `/substage=${result.substage}` : ""}]` : "";
            lastError = `${stageInfo} ${result.error || "admin-api returned error"}`;
            if (result.stage) lastStage = result.stage as string;
            if (result.substage) lastSubstage = result.substage as string;

            const isRateLimitMessage = /rate limit exceeded/i.test(String(result.error || ""));
            if (isRateLimitMessage && transientRetries < MAX_TRANSIENT_RETRIES) {
              transientRetries++;
              const delayMs = Math.min(5000 * transientRetries, 30000);
              console.warn(`bulk-job-runner: transient rate-limit for '${opKey}' (retry ${transientRetries}/${MAX_TRANSIENT_RETRIES}), waiting ${delayMs}ms`);
              await sleep(delayMs);
              continue;
            }

            isTransientFailure = isRateLimitMessage;
            console.error(`bulk-job-runner: ${lastError}`);
            break;
          }
        }

        // Capture stage/substage from success response
        if (result.stage) lastStage = result.stage as string;
        if (result.sub || result.substage) lastSubstage = (result.sub || result.substage) as string;

        progress = buildProgress(opKey, result, progress);
        batchCount++;

        if (result.done !== false) {
          done = true;
          break;
        }

        cursor = Number((result.nextOffset as string | number) ?? (typeof cursor === "number" ? cursor + 1 : cursor));

        // Throttle calls to avoid Supabase Edge Function rate limits
        const interCallDelay = INTER_CALL_DELAY_MS[opKey];
        if (interCallDelay) await sleep(interCallDelay);

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
          // Get active style group IDs from assets
          const { data: activeGroupIds } = await db.from("assets")
            .select("style_group_id")
            .eq("is_deleted", false)
            .not("style_group_id", "is", null);
          const uniqueGroupIds = [...new Set((activeGroupIds || []).map((r: { style_group_id: string }) => r.style_group_id))];

          let orphanCounts = 0;
          let missingPrimaries = 0;
          if (uniqueGroupIds.length > 0) {
            // Check for groups with zero/null asset_count
            const { count: orphanCount } = await db.from("style_groups")
              .select("id", { count: "exact", head: true })
              .in("id", uniqueGroupIds.slice(0, 200))
              .or("asset_count.is.null,asset_count.eq.0");
            orphanCounts = orphanCount ?? 0;

            // Check for groups with no primary asset
            const { count: missingCount } = await db.from("style_groups")
              .select("id", { count: "exact", head: true })
              .in("id", uniqueGroupIds.slice(0, 200))
              .is("primary_asset_id", null);
            missingPrimaries = missingCount ?? 0;
          }

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
      // But first, check if user stopped the operation while we were processing
      const { data: freshCheck } = await db
        .from("admin_config")
        .select("value")
        .eq("key", CONFIG_KEY)
        .maybeSingle();
      const freshOps = (freshCheck?.value as Record<string, OpState>) || {};
      const freshStatus = freshOps[opKey]?.status;

      if (freshStatus && freshStatus !== "running") {
        // User (or another process) changed status — respect it, just merge progress
        console.log(`bulk-job-runner: op '${opKey}' status changed to '${freshStatus}' during run. Preserving.`);
        allOps[opKey] = {
          ...freshOps[opKey],
          cursor,
          progress,
          last_stage: lastStage,
          last_substage: lastSubstage,
          updated_at: now,
        };
      } else {
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
    }

    // Atomic final write
    // IMPORTANT: never resurrect a user-stopped op from interrupted -> running on time-slice persists.
    if (!done && !lastError) {
      // "paused" branch: only persist if status is still running.
      const conditionalResult = await db.rpc("update_bulk_operation", {
        p_op_key: opKey,
        p_op_state: allOps[opKey],
        p_only_if_status: "running",
      });
      const afterOps = conditionalResult.data as Record<string, OpState> | null;
      if (afterOps?.[opKey]?.status && afterOps[opKey].status !== "running") {
        console.log(
          `bulk-job-runner: final paused persist skipped because '${opKey}' is now '${afterOps[opKey].status}'.`,
        );
      }
    } else {
      // Completion/error branches can use batched atomic merge.
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
    }

    // Self-continue: when the time budget is exhausted with work still remaining, immediately
    // fire the next invocation so there's no ~15s idle gap waiting for the next pg_cron tick.
    // The per-op atomic lock (p_only_if_status:"running") prevents double-processing if pg_cron
    // also fires during the overlap.
    if (!done && !lastError) {
      const selfFetch = fetch(`${supabaseUrl}/functions/v1/bulk-job-runner`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
      if (typeof (globalThis as any).EdgeRuntime !== "undefined") {
        (globalThis as any).EdgeRuntime.waitUntil(selfFetch);
      }
    }

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
