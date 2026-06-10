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
import { autoUpdater } from "electron-updater";
import { createTray, updateTrayIcon, showWindow } from "./tray";
import { registerIpcHandlers } from "./ipc";
import { registerProtocol } from "./protocol";
import { initQueue, setProgressCallback, setVerifyingCallback, processQueue } from "./uploadQueue";
import { loadActiveCheckouts, onCheckoutsChanged, updateUploadProgress, markVerifying, reconcileVerifyingCheckouts } from "./checkoutManager";
import { heartbeat } from "./damClient";
import { loadConfig, getConfig } from "./config";
import { log } from "./logger";
import { startLocalServer } from "./localServer";
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

  const config = loadConfig();
  registerIpcHandlers();
  createTray();
  startLocalServer();

  // First run: open the popup automatically so the user knows the app is running
  // and can complete setup (root mappings, workspace folder).
  if (!config.deviceId || config.rootMappings.length === 0) {
    setTimeout(() => showWindow(), 600);
  }

  // Init SQLite upload queue
  initQueue();
  setProgressCallback((checkoutId, percent) => {
    updateUploadProgress(checkoutId, percent);
    sendToRenderer("checkouts-changed");
    updateTrayIcon();
  });
  // Seafile check-ins stay in 'verifying' after upload until the bridge agent
  // confirms receipt on the Synology — keep them visible, don't mark complete.
  setVerifyingCallback((checkoutId) => {
    markVerifying(checkoutId);
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

  // Heartbeat — reads deviceId dynamically so it works after OAuth sign-in
  setInterval(async () => {
    const cfg = getConfig();
    if (cfg.deviceId) {
      await heartbeat({ device_id: cfg.deviceId });
    }
    // Pick up bridge-agent verification results: 'verifying' → complete (lock
    // released) or flagged if the file never arrived intact before the deadline.
    await reconcileVerifyingCheckouts();
  }, HEARTBEAT_INTERVAL_MS);

  // Auto-update check — silently checks GitHub for a newer release
  autoUpdater.logger = log;
  autoUpdater.checkForUpdatesAndNotify().catch((e: unknown) => {
    log.debug("Auto-update check skipped:", (e as Error).message);
  });

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
