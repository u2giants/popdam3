/**
 * System tray (Windows) / menu-bar (macOS) setup.
 * Creates the icon and manages the popup window.
 */

import { app, Tray, BrowserWindow, nativeImage, screen, Menu, shell, Notification } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { getActiveCheckouts } from "./checkoutManager";
import { getConfig } from "./config";
import { log } from "./logger";

/**
 * Show a desktop notification. The single place errors become visible when the
 * tray popup isn't open — used for deep-link action failures and background
 * upload (check-in) failures so nothing fails silently.
 */
export function showNotification(title: string, body: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (e) {
    log.warn("Could not show notification:", (e as Error).message);
  }
}

let tray: Tray | null = null;
let popup: BrowserWindow | null = null;

export function createTray(): void {
  // In packaged app, resources/ is at process.resourcesPath.
  // In dev, it's two levels up from out/main/.
  const resourcesPath = app.isPackaged
    ? process.resourcesPath
    : join(__dirname, "../../resources");
  const iconPath = join(resourcesPath, "icon.png");
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("POP DAM Helper");

  if (process.platform === "darwin") {
    // macOS: clicking the menu-bar icon toggles the popup
    tray.on("click", togglePopup);
  } else {
    // Windows: left-click toggles popup, right-click shows context menu
    tray.on("click", togglePopup);
    tray.on("right-click", showContextMenu);
  }
}

function showContextMenu(): void {
  const menu = Menu.buildFromTemplate([
    { label: "Open DAM", click: () => shell.openExternal(getConfig().damUrl) },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray?.popUpContextMenu(menu);
}

export function showWindow(): void {
  if (!popup || popup.isDestroyed()) {
    createPopup();
  } else {
    popup.show();
    popup.focus();
  }
}

export function hideWindow(): void {
  popup?.hide();
}

function togglePopup(): void {
  if (popup && !popup.isDestroyed() && popup.isVisible()) {
    hideWindow();
  } else {
    showWindow();
  }
}

function createPopup(): void {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;

  const winWidth = 380;
  const winHeight = 520;
  const margin = 12;

  // Position bottom-right (Windows) or top-right (macOS)
  const x = sw - winWidth - margin;
  const y = process.platform === "darwin" ? margin : sh - winHeight - margin;

  popup = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x,
    y,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    roundedCorners: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  popup.on("blur", () => {
    // Hide when user clicks away (unless in dev mode)
    if (!is.dev) hideWindow();
  });

  popup.on("closed", () => {
    popup = null;
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    popup.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    popup.webContents.openDevTools({ mode: "detach" });
  } else {
    popup.loadFile(join(__dirname, "../renderer/index.html"));
  }

  popup.once("ready-to-show", () => {
    popup?.show();
    popup?.focus();
  });
}

export function updateTrayIcon(): void {
  if (!tray) return;
  const checkouts = getActiveCheckouts();
  const uploading = checkouts.some((c) => c.status === "uploading");
  const hasError = checkouts.some((c) => c.status === "error");

  // Icon state: normal / uploading / error
  // For now we use the same icon and rely on tooltip text
  const count = checkouts.length;
  const tooltip = count === 0
    ? "POP DAM Helper — Idle"
    : uploading
    ? `POP DAM Helper — Uploading (${count} checked out)`
    : hasError
    ? `POP DAM Helper — Error (${count} checked out)`
    : `POP DAM Helper — ${count} file${count === 1 ? "" : "s"} checked out`;

  tray?.setToolTip(tooltip);
}

export function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (popup && !popup.isDestroyed()) {
    popup.webContents.send(channel, ...args);
  }
}
