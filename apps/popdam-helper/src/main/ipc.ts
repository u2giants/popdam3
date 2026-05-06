/**
 * IPC handlers — the bridge between the renderer (React UI) and the main process.
 * The renderer never calls Node APIs directly; it goes through these handlers.
 */

import { ipcMain, dialog } from "electron";
import { getConfig, saveConfig } from "./config";
import { clearSession, storeToken, loadToken } from "./credentials";
import {
  getActiveCheckouts,
  checkin,
  discard,
  revealFile,
  openFile,
} from "./checkoutManager";
import { getPendingJobs } from "./uploadQueue";
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
  ipcMain.handle("get-auth-state", async () => {
    const accessToken = await loadToken("access_token");
    return {
      ok: true,
      data: {
        loggedIn: !!accessToken,
        accessToken,
      },
    };
  });

  ipcMain.handle("logout", async () => {
    await clearSession();
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
}
