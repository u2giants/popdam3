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
import ws from "ws";
import { logger } from "./logger.js";

// @supabase/realtime-js >= 2.11 requires globalThis.WebSocket on Node.js < 22
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as Record<string, unknown>).WebSocket = ws;
}

// Keys whose pending state should trigger an immediate heartbeat rather than
// waiting up to 30s for the next scheduled poll.
const WATCHED_KEYS = ["SCAN_REQUEST", "DIR_BROWSE_REQUEST", "PATH_TEST_REQUEST"];

export function startRealtimeWatcher(
  supabaseUrl: string,
  anonKey: string,
  agentId: string,
  onCommandPending: () => void,
): () => Promise<void> {
  if (!anonKey) {
    logger.info(
      "SUPABASE_ANON_KEY not set — Realtime watcher disabled (heartbeat-only mode, commands up to 30s delayed)",
    );
    return () => Promise.resolve();
  }

  const client = createClient(supabaseUrl, anonKey, {
    realtime: { params: { eventsPerSecond: 2 } },
    auth: { persistSession: false },
  });

  // Use separate eq filters per key — the `in` operator is less reliable in
  // Postgres Changes than chained eq subscriptions on the same channel.
  let channel = client.channel("agent-command-watcher");
  for (const watchedKey of WATCHED_KEYS) {
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "admin_config", filter: `key=eq.${watchedKey}` },
      (payload) => {
        const row = (payload.new ?? {}) as Record<string, unknown>;
        const key = row.key as string | undefined;
        const value = row.value as Record<string, unknown> | undefined;
        if (!value) return;

        const status = value.status as string | undefined;
        const targetAgentId = value.target_agent_id as string | undefined;

        // Only react to freshly-pending requests that target this agent (or all agents).
        if (status !== "pending") return;
        if (targetAgentId && targetAgentId !== agentId) return;

        logger.info(`Realtime: ${key} detected — triggering immediate heartbeat`);
        onCommandPending();
      },
    );
  }
  channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        logger.info(`Realtime watcher active — commands (${WATCHED_KEYS.join(", ")}) will be delivered instantly`);
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
