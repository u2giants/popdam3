/**
 * Blocks an admin operation if the bridge agent is not on the latest
 * published version (BRIDGE_LATEST_BUILD in admin_config).
 *
 * Usage:
 *   const versionErr = await requireBridgeLatest(db);
 *   if (versionErr) return versionErr;
 */

import { err } from "./http.ts";
import { serviceClient } from "./service-client.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function requireBridgeLatest(db?: SupabaseClient): Promise<Response | null> {
  const client = db ?? serviceClient();

  const [agentRes, buildRes] = await Promise.all([
    client
      .from("agent_registrations")
      .select("metadata, last_heartbeat")
      .eq("agent_type", "bridge")
      .order("last_heartbeat", { ascending: false })
      .limit(1),
    client
      .from("admin_config")
      .select("value")
      .eq("key", "BRIDGE_LATEST_BUILD")
      .maybeSingle(),
  ]);

  const agent = agentRes.data?.[0];
  if (!agent) {
    return err("No bridge agent is registered. Connect one before running this operation.", 409);
  }

  const meta = (agent.metadata as Record<string, unknown>) ?? {};
  const versionInfo = (meta.version_info as Record<string, unknown>) ?? {};
  const running = (versionInfo.version as string) || null;

  if (!running) {
    return err("Bridge agent version is unknown — wait for its next heartbeat and retry.", 409);
  }

  const latestVersion = (buildRes.data?.value as Record<string, unknown>)?.version as string | null;

  if (latestVersion && running !== latestVersion) {
    return err(
      `Bridge agent v${running} is outdated (latest: v${latestVersion}). ` +
        `Update it in Settings → Bridge Agent before continuing.`,
      409,
    );
  }

  return null;
}
