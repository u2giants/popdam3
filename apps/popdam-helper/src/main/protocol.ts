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

import { app } from "electron";
import { log } from "./logger";
import { checkout, checkin, discard, revealFile, openFile, loadActiveCheckouts } from "./checkoutManager";
import { showWindow, sendToRenderer } from "./tray";
import { storeSession } from "./credentials";
import { getConfig, saveConfig } from "./config";
import { registerDevice } from "./damClient";
import { HELPER_VERSION } from "@shared/constants";

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

async function handleAuthCallback(url: string): Promise<void> {
  // URL format: popdam://auth#access_token=...&refresh_token=...&token_type=bearer&expires_in=3600
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) {
    log.warn("Auth callback missing tokens — check Supabase redirect URL config");
    return;
  }

  storeSession(accessToken, refreshToken);
  log.info("Session stored from OAuth callback");

  const config = getConfig();
  try {
    const result = await registerDevice({
      device_name: config.deviceName,
      device_os: config.deviceOs,
      helper_version: HELPER_VERSION,
      device_id: config.deviceId,
    });
    if (result.ok && result.device_id !== config.deviceId) {
      saveConfig({ deviceId: result.device_id });
      log.info("Device registered:", result.device_id);
    }
  } catch (e) {
    log.warn("Device registration failed after login:", e);
  }

  await loadActiveCheckouts().catch(() => {});
  sendToRenderer("auth-changed");
  sendToRenderer("checkouts-changed");
}

export async function handleDeepLink(url: string): Promise<void> {
  log.info("Deep link received:", url);

  // OAuth callback — popdam://auth#access_token=...
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "auth") {
      await handleAuthCallback(url);
      showWindow();
      return;
    }
  } catch {
    // fall through to normal deep link handling
  }

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
    // The tray window will show the error via the checkout state
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
