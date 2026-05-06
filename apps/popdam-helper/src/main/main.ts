/**
 * Electron main process entry point.
 *
 * Startup sequence:
 *  1. Single-instance lock (prevent multiple copies)
 *  2. Register popdam:// protocol (Windows needs this before app.ready)
 *  3. App ready → create tray, init queue, load active checkouts
 *  4. Start heartbeat timer
 */

import { app, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createTray, updateTrayIcon } from "./tray";
import { registerIpcHandlers } from "./ipc";
import { registerProtocol } from "./protocol";
import { initQueue, setProgressCallback, processQueue } from "./uploadQueue";
import { loadActiveCheckouts, onCheckoutsChanged, updateUploadProgress } from "./checkoutManager";
import { heartbeat } from "./damClient";
import { getConfig, loadConfig } from "./config";
import { log } from "./logger";
import { HEARTBEAT_INTERVAL_MS, HELPER_VERSION } from "@shared/constants";
import { sendToRenderer } from "./tray";

// ── Single instance lock ──────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ── Protocol registration (must happen before app.ready on Windows) ───────────
if (process.defaultApp) {
  // Dev mode — register with electron executable
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("popdam", process.execPath, [process.argv[1]]);
  }
} else {
  app.setAsDefaultProtocolClient("popdam");
}

registerProtocol();

// ── macOS: hide dock icon (we're a menu-bar app) ──────────────────────────────
if (process.platform === "darwin") {
  app.dock?.hide();
}

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.popcreations.popdam-helper");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  loadConfig();
  registerIpcHandlers();
  createTray();

  // Init SQLite upload queue
  initQueue();
  setProgressCallback((checkoutId, percent) => {
    updateUploadProgress(checkoutId, percent);
    sendToRenderer("checkouts-changed");
    updateTrayIcon();
  });

  // Resume any queued uploads from before restart
  processQueue();

  // Load active checkouts from server
  await loadActiveCheckouts();
  updateTrayIcon();

  // Notify renderer whenever checkout state changes
  onCheckoutsChanged(() => {
    sendToRenderer("checkouts-changed");
    updateTrayIcon();
  });

  // Heartbeat timer
  const config = getConfig();
  if (config.deviceId) {
    setInterval(async () => {
      await heartbeat({ device_id: config.deviceId ?? undefined });
    }, HEARTBEAT_INTERVAL_MS);
  }

  log.info(`POP DAM Helper v${HELPER_VERSION} started`);
});

// ── macOS: don't quit when all windows close ──────────────────────────────────
app.on("window-all-closed", (e) => {
  e.preventDefault();
});

// ── Clean shutdown ────────────────────────────────────────────────────────────
app.on("before-quit", () => {
  log.info("POP DAM Helper shutting down");
});
