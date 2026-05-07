/**
 * IPC handlers — the bridge between the renderer (React UI) and the main process.
 * The renderer never calls Node APIs directly; it goes through these handlers.
 */

import { ipcMain, dialog } from "electron";
import { getConfig, saveConfig } from "./config";
import { clearSession, storeToken, loadToken, loadSession } from "./credentials";
import {
  getActiveCheckouts,
  checkin,
  discard,
  revealFile,
  openFile,
} from "./checkoutManager";
import { getPendingJobs } from "./uploadQueue";
import { fetchConfig, discoverSupabaseConfig } from "./damClient";
import { validateRoot } from "./rootValidator";
import { shell } from "electron";
import { log } from "./logger";
import type { LocalConfig } from "@shared/types";

export function registerIpcHandlers(): void {
  // ── Config ──────────────────────────────────────────────────────────────────
  ipcMain.handle("get-config", () => {
    return { ok: true, data: getConfig() };
  });

  ipcMain.handle("save-config", (_event, updates: Partial<LocalConfig>) => {
    try {
      const saved = saveConfig(updates);
      return { ok: true, data: saved };
    } catch (e: unknown) {
      return { ok: false, error: String(e) };
    }
  });

  // ── Checkout state ──────────────────────────────────────────────────────────
  ipcMain.handle("get-checkouts", () => {
    return {
      ok: true,
      data: {
        checkouts: getActiveCheckouts(),
        uploadJobs: getPendingJobs(),
      },
    };
  });

  // ── File actions ────────────────────────────────────────────────────────────
  ipcMain.handle("open-file", (_event, checkoutId: string) => {
    openFile(checkoutId);
    return { ok: true };
  });

  ipcMain.handle("reveal-file", (_event, checkoutId: string) => {
    revealFile(checkoutId);
    return { ok: true };
  });

  ipcMain.handle("checkin", async (_event, checkoutId: string) => {
    try {
      await checkin(checkoutId);
      return { ok: true };
    } catch (e: unknown) {
      log.error("Check-in failed:", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("discard", async (_event, checkoutId: string) => {
    try {
      await discard(checkoutId);
      return { ok: true };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── DAM link ────────────────────────────────────────────────────────────────
  ipcMain.handle("open-dam", () => {
    const { damUrl } = getConfig();
    shell.openExternal(damUrl);
    return { ok: true };
  });

  // ── Auth ────────────────────────────────────────────────────────────────────
  ipcMain.handle("get-auth-state", () => {
    const session = loadSession();
    if (!session) {
      return { ok: true, data: { loggedIn: false, userId: null, email: null, accessToken: null } };
    }
    // Decode JWT payload to extract sub (userId) and email without a crypto library
    let userId: string | null = null;
    let email: string | null = null;
    try {
      const payloadB64 = session.accessToken.split(".")[1];
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
      userId = (payload.sub as string) ?? null;
      email = (payload.email as string) ?? null;
    } catch {
      // JWT decode failed — session still valid, just no email display
    }
    return { ok: true, data: { loggedIn: true, userId, email, accessToken: session.accessToken } };
  });

  ipcMain.handle("sign-in", async (_event, { email, password }: { email: string; password: string }) => {
    const { supabaseUrl, supabaseAnonKey, damUrl } = getConfig();
    const base = (supabaseUrl || damUrl).replace(/\/$/, "");
    if (!base) return { ok: false, error: "Set your DAM URL in Settings first" };
    const anonKey = supabaseAnonKey || "";
    try {
      const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": anonKey,
        },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        const msg = (json.error_description ?? json.message ?? "Sign-in failed") as string;
        return { ok: false, error: msg };
      }
      const accessToken = json.access_token as string;
      const refreshToken = json.refresh_token as string;
      storeSession(accessToken, refreshToken);

      const config = getConfig();
      const { registerDevice } = await import("./damClient");
      const { loadActiveCheckouts } = await import("./checkoutManager");
      const { sendToRenderer } = await import("./tray");
      try {
        const reg = await registerDevice({
          device_name: config.deviceName,
          device_os: config.deviceOs,
          helper_version: (await import("@shared/constants")).HELPER_VERSION,
          device_id: config.deviceId,
        });
        if (reg.ok && reg.device_id !== config.deviceId) saveConfig({ deviceId: reg.device_id });
      } catch (e) {
        log.warn("Device registration failed after sign-in:", e);
      }
      await loadActiveCheckouts().catch(() => {});
      sendToRenderer("auth-changed");
      sendToRenderer("checkouts-changed");
      return { ok: true };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("logout", () => {
    clearSession();
    return { ok: true };
  });

  // ── Folder picker ──────────────────────────────────────────────────────────
  ipcMain.handle("browse-for-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select the local folder for this NAS root",
    });
    return { ok: true, data: result.canceled ? null : (result.filePaths[0] ?? null) };
  });

  // ── Synology credentials ────────────────────────────────────────────────────
  ipcMain.handle("save-synology-credentials", async (
    _event,
    { username, password }: { username: string; password: string },
  ) => {
    await storeToken("synology_username", username);
    await storeToken("synology_password", password);
    return { ok: true };
  });

  ipcMain.handle("has-synology-credentials", async () => {
    const u = await loadToken("synology_username");
    return { ok: true, data: !!u };
  });

  // ── Root path validation ────────────────────────────────────────────────────
  ipcMain.handle("validate-root", (_event, { path, rootId }: { path: string; rootId: string }) => {
    try {
      const result = validateRoot(path, rootId);
      return { ok: true, data: result };
    } catch (e: unknown) {
      return { ok: false, error: String(e) };
    }
  });

  // ── Supabase URL discovery ──────────────────────────────────────────────────
  ipcMain.handle("discover-supabase-url", async (_event, damUrl: string) => {
    try {
      const { supabaseUrl, supabaseAnonKey } = await discoverSupabaseConfig(damUrl);
      saveConfig({ supabaseUrl, supabaseAnonKey });
      return { ok: true, data: supabaseUrl };
    } catch (e: unknown) {
      return { ok: false, error: String(e) };
    }
  });

  // ── Server root mappings ────────────────────────────────────────────────────
  ipcMain.handle("fetch-server-roots", async () => {
    try {
      const res = await fetchConfig();
      return { ok: true, data: res.root_mappings };
    } catch (e: unknown) {
      return { ok: false, error: String(e) };
    }
  });
}
