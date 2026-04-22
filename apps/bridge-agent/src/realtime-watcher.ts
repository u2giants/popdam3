/**
 * Realtime watcher — subscribes to admin_config Postgres Changes so the bridge
 * agent reacts to SCAN_REQUEST instantly instead of waiting for the next
 * heartbeat (up to 30s latency).
 *
 * Requires SUPABASE_ANON_KEY env var.  If absent, this is a no-op and the agent
 * falls back to heartbeat-only command delivery (functional, just slower).
 *
 * Security: the anon key can only see the SCAN_REQUEST row (RLS policy added in
 * migration 20260325120000).  That row holds only non-secret metadata: request_id,
 * status, requested_at, requested_by (uuid), target_agent_id.
 */

import { createClient } from "@supabase/supabase-js";
import { logger } from "./logger.js";

export function startRealtimeWatcher(
  supabaseUrl: string,
  anonKey: string,
  agentId: string,
  onScanRequested: () => void,
): () => Promise<void> {
  if (!anonKey) {
    logger.info(
      "SUPABASE_ANON_KEY not set — Realtime watcher disabled (heartbeat-only mode, scan triggers up to 30s delayed)",
    );
    return () => Promise.resolve();
  }

  const client = createClient(supabaseUrl, anonKey, {
    realtime: { params: { eventsPerSecond: 2 } },
    auth: { persistSession: false },
  });

  client
    .channel("agent-scan-watcher")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "admin_config",
        filter: "key=eq.SCAN_REQUEST",
      },
      (payload) => {
        const row = (payload.new ?? {}) as Record<string, unknown>;
        const value = row.value as Record<string, unknown> | undefined;
        if (!value) return;

        const status = value.status as string | undefined;
        const targetAgentId = value.target_agent_id as string | undefined;

        // Only react to a freshly-pending request that targets this agent (or all agents).
        if (status !== "pending") return;
        if (targetAgentId && targetAgentId !== agentId) return;

        logger.info("Realtime: SCAN_REQUEST detected — triggering immediate heartbeat");
        onScanRequested();
      },
    )
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        logger.info("Realtime watcher active — scan requests will be delivered instantly");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        logger.warn("Realtime watcher connection issue — falling back to heartbeat polling", {
          status,
          error: (err as Error | undefined)?.message,
        });
      }
    });

  return async () => {
    try {
      await client.removeAllChannels();
    } catch (e) {
      logger.warn("Realtime cleanup error (non-fatal)", { error: (e as Error).message });
    }
  };
}
