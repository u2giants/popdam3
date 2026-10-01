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

/**
 * PopSG jobs read from their own share when one is configured; otherwise they
 * fall back to the main share, so they are ready only when the main share is.
 */
export async function sgReadyForClaim(
  sgShareConfigured: boolean,
  mainReady: boolean,
  ensureSg: () => Promise<boolean>,
): Promise<boolean> {
  if (!sgShareConfigured) return mainReady;
  return ensureSg();
}
