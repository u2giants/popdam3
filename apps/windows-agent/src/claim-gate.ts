/**
 * Decide whether the agent may claim a PopDAM render job, based on whether the
 * main NAS share (Z:) is reachable. `ensure` is called on every decision so it
 * always uses the credentials most recently delivered by the heartbeat.
 */
export async function nasReadyForClaim(
  host: string,
  ensure: () => Promise<{ ok: boolean; error?: string }>,
): Promise<{ ready: boolean; error?: string }> {
  if (!host) return { ready: true };
  const result = await ensure();
  return result.ok ? { ready: true } : { ready: false, error: result.error };
}
