/**
 * Keeps the Supabase sign-in alive (#1396).
 *
 * Supabase access tokens expire after one hour. The refresh token stored at
 * sign-in is exchanged for a new pair before expiry, or after a 401, so the
 * Helper stays signed in until the user signs out or the refresh token is
 * revoked.
 */

import { getConfig } from "./config";
import { clearSession, loadSession, storeSession } from "./credentials";
import { log } from "./logger";

/** Refresh when the access token has less than this long left. */
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

export function tokenExpiresAt(accessToken: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf-8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

let inFlight: Promise<string | null> | null = null;

/**
 * Exchange the stored refresh token for a new session. Returns the new access
 * token, or null when signed out. A rejected refresh token clears the session
 * (normal signed-out state); a network failure keeps it so a later try can work.
 * Concurrent callers share one request because Supabase refresh tokens are single-use.
 */
export function refreshSession(): Promise<string | null> {
  if (!inFlight) {
    inFlight = doRefresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function doRefresh(): Promise<string | null> {
  const session = loadSession();
  if (!session) return null;
  const { supabaseUrl, supabaseAnonKey, damUrl } = getConfig();
  const base = (supabaseUrl || damUrl).replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: supabaseAnonKey || "" },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
  } catch (e) {
    log.warn("Session refresh failed (network):", e instanceof Error ? e.message : String(e));
    return null;
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      log.warn(`Session refresh rejected (${res.status}); signing out.`);
      clearSession();
    } else {
      log.warn(`Session refresh failed (${res.status}); will retry later.`);
    }
    return null;
  }
  const accessToken = json.access_token as string | undefined;
  const refreshToken = json.refresh_token as string | undefined;
  if (!accessToken || !refreshToken) {
    log.warn("Session refresh returned no tokens.");
    return null;
  }
  storeSession(accessToken, refreshToken);
  log.info("Session refreshed.");
  return accessToken;
}

/** Current access token, refreshed first if it is expired or about to expire. */
export async function getValidAccessToken(): Promise<string | null> {
  const session = loadSession();
  if (!session) return null;
  const exp = tokenExpiresAt(session.accessToken);
  if (exp !== null && exp - Date.now() < EXPIRY_MARGIN_MS) {
    return (await refreshSession()) ?? (exp > Date.now() ? session.accessToken : null);
  }
  return session.accessToken;
}
