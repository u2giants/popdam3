/**
 * OS credential storage — uses Windows Credential Manager on Windows,
 * macOS Keychain on Mac. Never stores tokens in plain JSON config.
 */

import { log } from "./logger";

const SERVICE = "POP DAM Helper";

// Lazy-load keytar so the app doesn't crash if native module is missing during dev
let _keytar: typeof import("keytar") | null = null;
async function keytar() {
  if (!_keytar) {
    try {
      _keytar = await import("keytar");
    } catch (e) {
      log.error("keytar not available:", e);
    }
  }
  return _keytar;
}

export async function storeToken(account: string, token: string): Promise<void> {
  const kt = await keytar();
  if (!kt) return;
  await kt.setPassword(SERVICE, account, token);
}

export async function loadToken(account: string): Promise<string | null> {
  const kt = await keytar();
  if (!kt) return null;
  return kt.getPassword(SERVICE, account);
}

export async function deleteToken(account: string): Promise<void> {
  const kt = await keytar();
  if (!kt) return;
  await kt.deletePassword(SERVICE, account);
}

// Convenience wrappers for Supabase session
export async function storeSession(accessToken: string, refreshToken: string): Promise<void> {
  await storeToken("access_token", accessToken);
  await storeToken("refresh_token", refreshToken);
}

export async function loadSession(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const [accessToken, refreshToken] = await Promise.all([
    loadToken("access_token"),
    loadToken("refresh_token"),
  ]);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export async function clearSession(): Promise<void> {
  await deleteToken("access_token");
  await deleteToken("refresh_token");
}
