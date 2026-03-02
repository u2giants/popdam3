import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS ────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, " +
    "x-supabase-client-platform, x-supabase-client-platform-version, " +
    "x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Constants ───────────────────────────────────────────────────────

const CONFIG_KEY = "BULK_OPERATIONS";
const MAX_RUN_MS = 50_000; // 50 seconds — leave headroom for 60s edge timeout
const PERSIST_EVERY = 5; // persist progress every N batches
const INTERRUPT_CHECK_EVERY = 10; // check for user stop every N batches

interface OpState {
  status: string;
  cursor?: number;
  params?: Record<string, unknown>;
  progress?: Record<string, unknown>;
  started_at?: string;
  updated_at?: string;
  result_message?: string;
  error?: string;
}

// Maps operation key → admin-api action name
const OP_ACTIONS: Record<string, string> = {
  "reprocess-metadata": "reprocess-asset-metadata",
  "backfill-sku-names": "backfill-sku-names",
  "rebuild-style-groups": "rebuild-style-groups",
  "ai-tag-untagged": "bulk-ai-tag",
  "ai-tag-all": "bulk-ai-tag-all",
  "ai-tag-groups": "bulk-ai-tag-all",
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
      return `Created ${progress.groups} style groups, assigned ${progress.assigned} assets`;
    case "ai-tag-untagged":
    case "ai-tag-all":
    case "ai-tag-groups":
      return `Tagged ${progress.tagged}. ${progress.skipped || 0} skipped. ${progress.failed || 0} failed.`;
    default:
      return "Operation completed";
  }
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
    // Read current BULK_OPERATIONS
    const { data: configRow } = await db
      .from("admin_config")
      .select("value")
      .eq("key", CONFIG_KEY)
      .maybeSingle();

    const allOps = (configRow?.value as Record<string, OpState>) || {};

    // Find first operation with status "running"
    const runningEntry = Object.entries(allOps).find(([_, op]) => op.status === "running");

    if (!runningEntry) {
      return json({ ok: true, message: "No running operations" });
    }

    const [opKey, opState] = runningEntry;

    // Legacy client-driven ops (no cursor field) — mark as interrupted, don't process
    if (opState.cursor === undefined && opState.cursor !== 0) {
      const now = new Date().toISOString();
      allOps[opKey] = { ...opState, status: "interrupted", updated_at: now };
      await db.from("admin_config").upsert({
        key: CONFIG_KEY,
        value: allOps,
        updated_at: now,
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
        updated_at: now,
      };
      await db.from("admin_config").upsert({
        key: CONFIG_KEY,
        value: allOps,
        updated_at: now,
      });
      return json({ ok: true, message: `Unknown op: ${opKey}` });
    }

    let cursor = opState.cursor ?? 0;
    let progress = opState.progress ?? {};
    let batchCount = 0;
    let done = false;
    let lastError: string | null = null;

    console.log(`bulk-job-runner: processing '${opKey}' action='${action}' cursor=${cursor}`);

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
          // Save our latest progress with the user's chosen status
          allOps[opKey] = {
            ...freshOps[opKey],
            progress,
            cursor,
            updated_at: new Date().toISOString(),
          };
          await db.from("admin_config").upsert({
            key: CONFIG_KEY,
            value: allOps,
            updated_at: new Date().toISOString(),
          });
          return json({ ok: true, message: `Operation ${opKey} stopped by user`, batches: batchCount });
        }
      }

      try {
        // Build request body: action + offset + any extra params
        const requestBody: Record<string, unknown> = {
          action,
          offset: cursor,
        };

        // Pass through operation params (e.g., group_ids for ai-tag-groups)
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
          const text = await res.text();
          lastError = `admin-api returned ${res.status}: ${text.slice(0, 500)}`;
          console.error(`bulk-job-runner: ${lastError}`);
          break;
        }

        const result = await res.json();
        if (!result.ok) {
          lastError = result.error || "admin-api returned error";
          console.error(`bulk-job-runner: ${lastError}`);
          break;
        }

        // Accumulate progress
        progress = buildProgress(opKey, result, progress);
        batchCount++;

        // Check if operation is complete
        // `done: true` or `done` not present (single-call actions like backfill)
        if (result.done !== false) {
          done = true;
          break;
        }

        cursor = result.nextOffset ?? cursor + 1;

        // Persist progress periodically
        if (batchCount % PERSIST_EVERY === 0) {
          allOps[opKey] = {
            ...opState,
            status: "running",
            cursor,
            progress,
            updated_at: new Date().toISOString(),
          };
          await db.from("admin_config").upsert({
            key: CONFIG_KEY,
            value: allOps,
            updated_at: new Date().toISOString(),
          });
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Unknown batch error";
        console.error(`bulk-job-runner: batch error in '${opKey}':`, lastError);
        break;
      }
    }

    // Final state update
    const now = new Date().toISOString();
    if (done) {
      allOps[opKey] = {
        ...opState,
        status: "completed",
        cursor,
        progress,
        result_message: buildResultMessage(opKey, progress),
        updated_at: now,
      };
      console.log(`bulk-job-runner: '${opKey}' completed — ${buildResultMessage(opKey, progress)}`);
    } else if (lastError) {
      allOps[opKey] = {
        ...opState,
        status: "failed",
        cursor,
        progress,
        error: lastError,
        updated_at: now,
      };
      console.error(`bulk-job-runner: '${opKey}' failed — ${lastError}`);
    } else {
      // Time budget exhausted, still running — save cursor for next invocation
      allOps[opKey] = {
        ...opState,
        status: "running",
        cursor,
        progress,
        updated_at: now,
      };
      console.log(`bulk-job-runner: '${opKey}' paused after ${batchCount} batches, cursor=${cursor}`);
    }

    await db.from("admin_config").upsert({
      key: CONFIG_KEY,
      value: allOps,
      updated_at: now,
    });

    return json({
      ok: true,
      op: opKey,
      batches: batchCount,
      done,
      error: lastError,
      elapsed_ms: Date.now() - startTime,
    });
  } catch (e) {
    console.error("bulk-job-runner unhandled error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
