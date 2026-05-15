/**
 * Utility for enforcing a minimum bridge agent version before dispatching
 * commands that require functionality added in a specific release.
 *
 * Usage:
 *   const versionErr = await requireBridgeVersion("1.15.0", db);
 *   if (versionErr) return versionErr;
 */

import { err } from "./http.ts";
import { serviceClient } from "./service-client.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Semver comparison: returns true if `a` >= `b`. */
function semverGte(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPatch >= bPatch;
}

/**
 * Checks the active bridge agent's reported version against `minVersion`.
 * Returns an error Response if the bridge is outdated or unreachable,
 * or null if the version requirement is satisfied.
 */
export async function requireBridgeVersion(
  minVersion: string,
  db?: SupabaseClient,
): Promise<Response | null> {
  const client = db ?? serviceClient();

  // Find the most-recently-heartbeating bridge agent
  const { data: agents } = await client
    .from("agent_registrations")
    .select("metadata, last_heartbeat")
    .eq("agent_type", "bridge")
    .order("last_heartbeat", { ascending: false })
    .limit(1);

  const agent = agents?.[0];
  if (!agent) {
    return err("No bridge agent is registered. Connect one before running this operation.", 409);
  }

  const meta = (agent.metadata as Record<string, unknown>) || {};
  const versionInfo = (meta.version_info as Record<string, unknown>) || {};
  const runningVersion = (versionInfo.version as string) || null;

  if (!runningVersion) {
    return err(
      "Bridge agent version is unknown — it may need to check in once more. Retry in a few seconds.",
      409,
    );
  }

  if (!semverGte(runningVersion, minVersion)) {
    // Also fetch the latest published version so the message is useful
    const { data: buildRow } = await client
      .from("admin_config")
      .select("value")
      .eq("key", "BRIDGE_LATEST_BUILD")
      .maybeSingle();
    const latestVersion = (buildRow?.value as Record<string, unknown>)?.version as string | null;

    const latestNote = latestVersion ? ` (v${latestVersion} is available)` : "";
    return err(
      `Bridge agent v${runningVersion} is too old for this operation — v${minVersion} or newer is required${latestNote}. ` +
        `Update it from Settings → Bridge Agent before continuing.`,
      409,
    );
  }

  return null;
}
