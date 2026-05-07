/**
 * HTTP client for the helper-api edge function.
 * All requests are authenticated with the user's Supabase access token.
 */

import { getConfig } from "./config";
import { loadSession } from "./credentials";
import { log } from "./logger";

async function getHeaders(): Promise<Record<string, string>> {
  const session = await loadSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.accessToken) {
    headers["Authorization"] = `Bearer ${session.accessToken}`;
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
  const json = await res.json();
  if (!json.supabase_url) throw new Error("dam-config.json missing supabase_url");
  return {
    supabaseUrl: json.supabase_url as string,
    supabaseAnonKey: (json.supabase_anon_key ?? "") as string,
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const url = apiUrl(path);
  log.debug("POST", url);
  const res = await fetch(url, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function get<T>(path: string): Promise<T> {
  const url = apiUrl(path);
  log.debug("GET", url);
  const res = await fetch(url, {
    method: "GET",
    headers: await getHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
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
  root_mappings: Array<{ root_id: string; local_path?: string }>;
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
  upload_instructions: {
    method: string;
    synology_url: string | null;
    synology_port: string;
    relative_path: string;
    filename: string;
    temp_suffix: string;
  };
}> {
  return post("/checkouts/prepare-checkin", params);
}

export async function completeCheckin(params: {
  checkout_id: string;
  final_hash: string;
  final_size: number;
  upload_method: string;
  synology_upload_user?: string | null;
}): Promise<{ ok: boolean }> {
  return post("/checkouts/complete-checkin", params);
}

export async function discardCheckout(checkout_id: string): Promise<{ ok: boolean }> {
  return post("/checkouts/discard", { checkout_id });
}

export async function heartbeat(params: {
  checkout_id?: string;
  device_id?: string;
  status?: string;
}): Promise<{ ok: boolean }> {
  return post("/checkouts/heartbeat", params).catch((e) => {
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
    assets: {
      id: string;
      filename: string;
      relative_path: string;
    };
  }>;
}> {
  return get("/checkouts/open");
}

export async function sendLog(events: unknown[]): Promise<void> {
  await post("/logs", { events }).catch(() => {/* best-effort */});
}
