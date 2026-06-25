/**
 * Electron main process entry point.
 *
 * Startup sequence:
 *  1. Single-instance lock (prevent multiple copies)
 *  2. Register popdam:// protocol (Windows needs this before app.ready)
 *  3. App ready → create tray, init queue, load active checkouts
 *  4. Start heartbeat timer
 */

import { app, BrowserWindow, dialog } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { autoUpdater } from "electron-updater";
import { createTray, updateTrayIcon, showWindow, showNotification } from "./tray";
import { registerIpcHandlers } from "./ipc";
import { registerProtocol } from "./protocol";
import { initQueue, setProgressCallback, setVerifyingCallback, setFailedCallback, processQueue } from "./uploadQueue";
import { loadActiveCheckouts, onCheckoutsChanged, updateUploadProgress, markVerifying, markUploadFailed, reconcileVerifyingCheckouts, getActiveCheckouts } from "./checkoutManager";
import { heartbeat } from "./damClient";
import { seaDriveBaseRoots, findLibraryDir } from "./seafileAdapter";
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

// ── Stale-checkout reminders (#3) ─────────────────────────────────────────────
const REMINDER_AGE_MS = 60 * 60 * 1000;         // remind once a file is 60 min old
const REMINDER_CHECK_INTERVAL_MS = 10 * 60 * 1000; // re-check every 10 min
const lastRemindedAt = new Map<string, number>();

function remindStaleCheckouts(): void {
  const now = Date.now();
  for (const co of getActiveCheckouts()) {
    // Only plain "active" (open & editable) checkouts — uploading/verifying/error
    // already have their own loud surfacing.
    if (co.status !== "active") continue;
    const age = now - new Date(co.checkedOutAt).getTime();
    if (age < REMINDER_AGE_MS) continue;
    if (now - (lastRemindedAt.get(co.id) ?? 0) < REMINDER_AGE_MS) continue;
    lastRemindedAt.set(co.id, now);
    const hrs = Math.max(1, Math.floor(age / 3600000));
    showNotification(
      "Don't forget to check in",
      `"${co.filename}" has been checked out for ${hrs}h and is NOT on the server yet. Open POP DAM Helper and click Check In when you're done.`,
    );
  }
}

// ── Proactive SeaDrive library warning (#4) ───────────────────────────────────
function warnIfSeaDriveLibrariesMissing(): void {
  const cfg = getConfig();
  if (cfg.preferredProvider && cfg.preferredProvider !== "seafile") return;
  const libs = cfg.seafileLibraries ?? [];
  if (libs.length === 0) return;

  if (seaDriveBaseRoots(cfg).length === 0) {
    showNotification(
      "SeaDrive not detected",
      "POP DAM Helper can't find SeaDrive. Install it and sign in — otherwise checking out work-from-home files won't work.",
    );
    return;
  }
  // Only warn when NONE are found: a user may legitimately have access to just
  // some libraries, so a per-library nag would be a false alarm. The Settings
  // panel shows the per-library mounted/missing breakdown.
  const missing = libs.filter((l) => findLibraryDir(l.seaDriveFolder, cfg) === null);
  if (missing.length === libs.length) {
    showNotification(
      "PopDAM libraries not found in SeaDrive",
      `None of your PopDAM libraries are visible in SeaDrive yet (${missing.map((m) => m.displayName).join(", ")}). Open SeaDrive and make sure they're synced/enabled.`,
    );
  }
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
  // Permanent upload failure → this means the user's work did NOT reach the
  // server. Make it impossible to miss: persist it on the checkout, fire a
  // desktop notification, open the popup so the error card is visible, AND pop a
  // modal dialog. A single toast can be missed; "your file isn't saved" must not.
  setFailedCallback((checkoutId, message) => {
    markUploadFailed(checkoutId, message);
    sendToRenderer("checkouts-changed");
    updateTrayIcon();
    showWindow();
    // Missing Synology credentials → take the user straight to the field.
    if (/credential/i.test(message)) {
      showNotification("Check-in needs your Synology credentials", message);
      sendToRenderer("open-settings", "credentials");
      return;
    }
    showNotification("Check-in failed — file NOT saved to the server", message);
    dialog.showMessageBox({
      type: "error",
      title: "Check-in failed — file NOT saved to the server",
      message: "Your edited file could not be uploaded to the server.",
      detail: `${message}\n\nYour edits are still safe in your workspace. Open POP DAM Helper and click "Check In" again to retry.`,
      buttons: ["OK"],
    });
  });

  // Resume any queued uploads from before restart
  processQueue();

  // Load active checkouts from server
  await loadActiveCheckouts();
  updateTrayIcon();

  // Proactive startup check: if the user is on the Seafile/WFH path but SeaDrive
  // (or all of their PopDAM libraries) can't be found, tell them now — don't
  // wait for a checkout to fail.
  warnIfSeaDriveLibrariesMissing();

  // Periodic reminder: a file checked out and edited but never checked in is the
  // classic "worked for hours, never saved to the server" trap. Nudge hourly.
  setInterval(remindStaleCheckouts, REMINDER_CHECK_INTERVAL_MS);

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
app.on("window-all-closed", () => {});

// ── Quit guard ────────────────────────────────────────────────────────────────
// Don't let the user quit (and walk away) while files are checked out and not
// yet confirmed on the server. Their edits live only in the local workspace
// until a check-in finishes uploading — quitting silently here is exactly how
// someone loses hours of work without knowing. Warn, and require confirmation.
let quitConfirmed = false;
app.on("before-quit", (event) => {
  const outstanding = getActiveCheckouts().filter(
    (c) => !["complete", "discarded"].includes(c.status),
  );
  if (outstanding.length === 0 || quitConfirmed) {
    log.info("POP DAM Helper shutting down");
    return;
  }

  event.preventDefault();
  const unsaved = outstanding.filter((c) =>
    ["uploading", "verifying", "checkin_queued", "error"].includes(c.status),
  );
  const detail = unsaved.length
    ? `${unsaved.length} file(s) are NOT yet confirmed on the server. If you quit now they will not finish uploading until you reopen the Helper and check in again.`
    : `${outstanding.length} file(s) are checked out. Your edits are safe in your workspace, but they are NOT on the server until you check them in.`;

  const choice = dialog.showMessageBoxSync({
    type: "warning",
    buttons: ["Stay open", "Quit anyway"],
    defaultId: 0,
    cancelId: 0,
    title: "Files not yet saved to the server",
    message: "POP DAM Helper has checked-out files that aren't on the server yet.",
    detail,
  });
  if (choice === 1) {
    quitConfirmed = true;
    app.quit();
  }
});
