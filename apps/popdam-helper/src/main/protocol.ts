/**
 * Handles popdam:// deep links on both Windows and macOS.
 *
 * Windows: the app is registered as the URL protocol handler via electron-builder
 *          NSIS installer; deep links arrive via second-instance event.
 * macOS:   registered via LSSchemes in Info.plist (electron-builder handles this);
 *          deep links arrive via open-url event.
 *
 * All actions are dispatched to the checkout manager after the URL is parsed.
 */

import { app, Notification } from "electron";
import { log } from "./logger";
import { checkout, checkin, discard, revealFile, openFile } from "./checkoutManager";
import { showWindow, sendToRenderer } from "./tray";

/**
 * Surface a deep-link action failure to the user. A failed checkout/check-in
 * leaves nothing in the tray list (the checkout was never added or was already
 * released), so without this the window just says "no files checked out" and
 * the user has no idea what went wrong. Show a desktop notification with the
 * real reason and also push it to the renderer for the popup to display.
 */
function notifyActionError(action: string, message: string): void {
  const titles: Record<string, string> = {
    checkout: "Check out failed",
    checkin: "Check in failed",
    discard: "Discard failed",
  };
  const title = titles[action] ?? "POP DAM Helper";
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body: message }).show();
    }
  } catch (e) {
    log.warn("Could not show error notification:", (e as Error).message);
  }
  sendToRenderer("action-error", { action, message });
}

export interface ParsedLink {
  action: "checkout" | "checkin" | "open" | "reveal" | "discard";
  token: string | null;
  assetId: string | null;
  checkoutId: string | null;
}

export function parseDeepLink(url: string): ParsedLink | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "popdam:") return null;

    const action = parsed.hostname as ParsedLink["action"];
    if (!["checkout", "checkin", "open", "reveal", "discard"].includes(action)) return null;

    return {
      action,
      token: parsed.searchParams.get("token"),
      assetId: parsed.searchParams.get("assetId"),
      checkoutId: parsed.searchParams.get("checkoutId"),
    };
  } catch {
    return null;
  }
}

export async function handleDeepLink(url: string): Promise<void> {
  log.info("Deep link received:", url);
  showWindow();

  const link = parseDeepLink(url);
  if (!link) {
    log.warn("Unrecognized deep link:", url);
    return;
  }

  try {
    switch (link.action) {
      case "checkout":
        if (!link.token) throw new Error("checkout link missing token");
        await checkout(link.token, link.assetId ?? undefined);
        break;

      case "checkin":
        if (!link.checkoutId) throw new Error("checkin link missing checkoutId");
        await checkin(link.checkoutId);
        break;

      case "open":
        if (link.checkoutId) openFile(link.checkoutId);
        break;

      case "reveal":
        if (link.checkoutId) revealFile(link.checkoutId);
        break;

      case "discard":
        if (!link.checkoutId) throw new Error("discard link missing checkoutId");
        await discard(link.checkoutId);
        break;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`Deep link action "${link.action}" failed:`, msg);
    notifyActionError(link.action, msg);
  }
}

export function registerProtocol(): void {
  // On macOS, handle open-url events
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // On Windows, handle second-instance (app already running)
  app.on("second-instance", (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith("popdam://"));
    if (url) handleDeepLink(url);
  });

  // Handle the case where the app is launched directly with a deep link
  // (Windows: first launch with protocol URL in argv)
  const argv = process.argv;
  const deepLinkUrl = argv.find((arg) => arg.startsWith("popdam://"));
  if (deepLinkUrl) {
    // Defer until app is ready
    app.whenReady().then(() => handleDeepLink(deepLinkUrl));
  }
}
