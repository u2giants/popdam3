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
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { log } from "./logger";

const STORE_PATH = join(app.getPath("userData"), "credentials.enc.json");

function loadStore(): Record<string, string> {
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveStore(store: Record<string, string>): void {
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store), "utf-8");
}

export function storeToken(account: string, token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn("safeStorage encryption not available — skipping credential store");
    return;
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
