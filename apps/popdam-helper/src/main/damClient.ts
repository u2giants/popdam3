import type { UploadInstructions } from "@shared/types";
/**
 * HTTP client for the helper-api edge function.
 * All requests are authenticated with the user's Supabase access token.
 */

import { getConfig } from "./config";
import { getValidAccessToken, refreshSession } from "./session";
import { log } from "./logger";

function headersFor(accessToken: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  return headers;
}

function apiUrl(path: string): string {
  const { supabaseUrl, damUrl } = getConfig();
  // supabaseUrl is the Supabase project URL (e.g. https://xyz.supabase.co)
  // discovered from ${damUrl}/dam-config.json on first setup.
  const base = (supabaseUrl || damUrl).replace(/\/$/, "");
  return `${base}/functions/v1/helper-api${path}`;
}

export async function discoverSupabaseConfig(damUrl: string): Promise<{ supabaseUrl: string; supabaseAnonKey: string }> {
  const base = damUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/dam-config.json`);
  if (!res.ok) throw new Error(`Could not fetch dam-config.json (${res.status})`);
  const json = await res.json() as { supabase_url?: unknown; supabase_anon_key?: unknown };
  if (!json.supabase_url) throw new Error("dam-config.json missing supabase_url");
  return {
    supabaseUrl: json.supabase_url as string,
    supabaseAnonKey: (json.supabase_anon_key ?? "") as string,
  };
}

/** Send a request; on 401 refresh the sign-in once and retry (#1396). */
async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const url = apiUrl(path);
  log.debug(method, url);
  const send = (token: string | null) =>
    fetch(url, {
      method,
      headers: headersFor(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let res = await send(await getValidAccessToken());
  if (res.status === 401) {
    const fresh = await refreshSession();
    if (fresh) res = await send(fresh);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${method} ${path} failed (${res.status}): ${text}`);
  }
  return await res.json() as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>("POST", path, body);
}

function get<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

// ── API calls ─────────────────────────────────────────────────────────────────

export interface DeviceRegistration {
  ok: boolean;
  device_id: string;
}

export async function registerDevice(params: {
  device_name: string;
  device_os: string;
  helper_version: string;
  device_id?: string | null;
}): Promise<DeviceRegistration> {
  return post("/register-device", params);
}

export async function fetchConfig(): Promise<{
  ok: boolean;
  dam_url: string | null;
  synology_url: string | null;
  synology_port: string;
  root_mappings: Array<{ root_id: string; display_name: string; server_path: string }>;
  seafile_preferred?: boolean;
  synology_fallback_allowed?: boolean;
  seafile_server_url?: string | null;
  seafile_libraries?: Array<{
    libraryId: string;
    displayName: string;
    seaDriveFolder: string;
    rootId: string;
    pathPrefix: string;
  }>;
}> {
  return get("/config");
}

export async function startCheckout(params: {
  token: string;
  asset_id?: string;
  device_id: string | null;
  helper_version: string;
  computer_id: string;
}): Promise<{
  ok: boolean;
  checkout_id: string;
  already_open?: boolean;
  asset: {
    asset_id: string;
    filename: string;
    relative_path: string;
    expected_hash: string | null;
    expected_size: number | null;
  };
  // Server-side roots derived from SCAN_ROOTS. There is no local_path here —
  // that is a helper-local concept, merged in by checkoutManager.
  root_mappings: Array<{ root_id: string; display_name: string; server_path: string }>;
  open_after_checkout: boolean;
}> {
  return post("/checkouts/start", params);
}

export async function prepareCheckin(params: {
  checkout_id: string;
  snapshot_hash: string;
  snapshot_size: number;
}): Promise<{
  ok: boolean;
  checkout_id: string;
  upload_instructions: UploadInstructions;
}> {
  return post("/checkouts/prepare-checkin", params);
}

export async function completeCheckin(params: {
  checkout_id: string;
  final_hash: string;
  final_quick_hash?: string;
  final_size: number;
  upload_method: string;
  synology_upload_user?: string | null;
  source_provider?: string;
  source_version?: string | null;
}): Promise<{ ok: boolean; status?: "verifying" | "complete" }> {
  return post("/checkouts/complete-checkin", params);
}

export async function discardCheckout(checkout_id: string): Promise<{ ok: boolean }> {
  return post("/checkouts/discard", { checkout_id });
}

export async function redrive(checkout_id: string): Promise<{
  ok: boolean;
  checkout_id: string;
  upload_instructions: UploadInstructions;
}> {
  return post("/checkouts/redrive", { checkout_id });
}

export async function redriveComplete(checkout_id: string): Promise<{ ok: boolean }> {
  return post("/checkouts/redrive-complete", { checkout_id });
}

export async function heartbeat(params: {
  checkout_id?: string;
  device_id?: string;
  status?: string;
  hydration_bytes_done?: number;
  hydration_bytes_total?: number;
}): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>("/checkouts/heartbeat", params).catch((e) => {
    log.warn("Heartbeat failed:", e.message);
    return { ok: false };
  });
}

export async function getOpenCheckouts(): Promise<{
  ok: boolean;
  checkouts: Array<{
    id: string;
    status: string;
    checked_out_at: string;
    source_hash: string;
    source_size: number;
    verify_deadline_at?: string | null;
    verify_failed_at?: string | null;
    verify_error?: string | null;
    redrive_requested?: boolean;
    resolution?: string | null;
    // Embedded join — absent/null if the asset row was removed.
    assets?: {
      id: string;
      filename: string;
      relative_path: string;
    } | null;
  }>;
}> {
  return get("/checkouts/open");
}


