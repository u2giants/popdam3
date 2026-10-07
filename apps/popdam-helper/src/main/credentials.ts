/**
 * OS credential storage using Electron's built-in safeStorage API.
 *
 * safeStorage uses the OS credential store under the hood:
 *  - Windows: DPAPI (Data Protection API)
 *  - macOS: Keychain
 *  - Linux: Secret Service / fallback encryption
 *
 * Encrypted blobs are stored in a JSON file in userData.
 * No native module compilation needed — safeStorage is part of Electron.
 */

import { safeStorage, app } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "fs";
import { log } from "./logger";

const STORE_PATH = join(app.getPath("userData"), "credentials.enc.json");

/** Thrown when credentials cannot be saved; callers surface the message to the UI. */
export class CredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialStoreError";
  }
}

function loadStore(): Record<string, string> {
  if (!existsSync(STORE_PATH)) return {};
  let raw: string;
  try {
    raw = readFileSync(STORE_PATH, "utf-8");
  } catch (e) {
    log.error(`Credential store could not be read: ${e instanceof Error ? e.message : String(e)}`);
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    throw new Error("not a JSON object");
  } catch (e) {
    // Keep the unreadable file for diagnosis instead of silently overwriting it.
    const backup = `${STORE_PATH}.corrupt-${Date.now()}`;
    try {
      renameSync(STORE_PATH, backup);
    } catch {
      /* best effort */
    }
    log.error(
      `Credential store was corrupt (${e instanceof Error ? e.message : String(e)}); moved to ${backup}. Saved sign-ins must be re-entered.`,
    );
    return {};
  }
}

/** Atomic write: temp file in the same directory, then rename over the target. */
function saveStore(store: Record<string, string>): void {
  mkdirSync(app.getPath("userData"), { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(store), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmp, STORE_PATH);
  } catch (e) {
    throw new CredentialStoreError(
      `Could not save credentials to disk: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function storeToken(account: string, token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    log.error(`safeStorage encryption not available — cannot store "${account}"`);
    throw new CredentialStoreError(
      "Secure credential storage is not available on this computer, so your sign-in cannot be saved. " +
        "On Linux, install/unlock a keyring (Secret Service); otherwise restart the Helper and try again.",
    );
  }
  const store = loadStore();
  store[account] = safeStorage.encryptString(token).toString("base64");
  saveStore(store);
}

export function loadToken(account: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const store = loadStore();
  const enc = store[account];
  if (!enc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, "base64"));
  } catch {
    return null;
  }
}

export function deleteToken(account: string): void {
  const store = loadStore();
  delete store[account];
  saveStore(store);
}

export function storeSession(accessToken: string, refreshToken: string): void {
  storeToken("access_token", accessToken);
  storeToken("refresh_token", refreshToken);
}

export function loadSession(): { accessToken: string; refreshToken: string } | null {
  const accessToken = loadToken("access_token");
  const refreshToken = loadToken("refresh_token");
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export function clearSession(): void {
  deleteToken("access_token");
  deleteToken("refresh_token");
}
