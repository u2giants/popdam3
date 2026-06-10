/**
 * helper-api — all communication between the POP DAM Helper (Electron app)
 * and the cloud. Also used by the web DAM to generate popdam:// URL tokens.
 *
 * Routes (method + path suffix after /helper-api):
 *
 *   POST  /register-device          Helper on first run / version change
 *   GET   /config                   Helper on startup — root mappings + DAM URL
 *   POST  /tokens                   Web DAM — generate a short-lived popdam:// token
 *   POST  /checkouts/start          Helper — validate token, create checkout lock
 *   POST  /checkouts/prepare-checkin  Helper — validate snapshot, get upload instructions
 *   POST  /checkouts/complete-checkin Helper — record final hash, unlock asset
 *   POST  /checkouts/discard        Helper or web — abandon a checkout
 *   POST  /checkouts/heartbeat      Helper — keep checkout alive, report status
 *   GET   /checkouts/open           Helper on startup — list user's active checkouts
 *   POST  /logs                     Helper — store audit / error events
 */

import { corsServe, err, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/service-client.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Stuck-check-in lifecycle timing (Seafile only). Both deadlines are measured
// from when the checkout entered 'verifying' but are pushed forward by the
// agent whenever the verifier was offline, so an agent/Synology outage does not
// burn the clock (see report-checkin-verification freeze logic).
//   T1 (flag): surface to designer + admin and start re-driving the upload.
//   T2 (resolve): if still unverified after re-drives, release the lock into an
//                 'error' state with diagnostics — the asset is never tied up
//                 indefinitely, and the designer's snapshot is preserved so they
//                 can simply check in again.
const VERIFY_FLAG_MS = 30 * 60 * 1000; // T1: 30 minutes
const VERIFY_RESOLVE_MS = 2 * 60 * 60 * 1000; // T2: 2 hours

// Feature flag (admin_config). Ships OFF so the receipt-verification flow can be
// deployed dark and activated only once the bridge agent that does the verifying
// is confirmed live on the Synology — otherwise check-ins would park in
// 'verifying' with nothing to confirm them. When off, Seafile check-ins complete
// immediately, exactly as before.
async function isCheckinVerificationEnabled(
  db: ReturnType<typeof serviceClient>,
): Promise<boolean> {
  const { data } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "CHECKIN_VERIFICATION_ENABLED")
    .maybeSingle();
  const v = data?.value as unknown;
  return v === true || v === "true" || (typeof v === "object" && v !== null && (v as { enabled?: boolean }).enabled === true);
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) return null;
  return user.id;
}

function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleRegisterDevice(req: Request): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return err("Unauthorized", 401);

  const body = await req.json();
  const { device_name, device_os, helper_version, device_id } = body;
  if (!device_name || !device_os || !helper_version) {
    return err("Missing required fields: device_name, device_os, helper_version");
  }
  if (!["windows", "macos"].includes(device_os)) {
    return err("device_os must be 'windows' or 'macos'");
  }

  const db = serviceClient();

  if (device_id) {
    // Update existing device
    const { data, error } = await db
      .from("helper_devices")
      .update({ device_name, helper_version, last_seen_at: new Date().toISOString() })
      .eq("id", device_id)
      .eq("user_id", userId)
      .select("id")
      .single();
    if (error || !data) {
      // Not found — fall through to insert
    } else {
      return json({ ok: true, device_id: data.id });
    }
  }

  // Insert new device
  const { data, error } = await db
    .from("helper_devices")
    .insert({ user_id: userId, device_name, device_os, helper_version })
    .select("id")
    .single();
  if (error) return err(`Failed to register device: ${error.message}`, 500);
  return json({ ok: true, device_id: data.id });
}

async function handleGetConfig(_req: Request): Promise<Response> {
  // No user auth required — root mappings are the same for all users and not sensitive.
  // The Supabase anon key (enforced by the edge function invocation layer) is sufficient.
  const db = serviceClient();

  // Load config from admin_config — root_mappings derived from SCAN_ROOTS (same source the bridge agent uses)
  const { data: rows } = await db
    .from("admin_config")
    .select("key, value")
    .in("key", [
      "SCAN_ROOTS",
      "HELPER_SYNOLOGY_URL",
      "HELPER_SYNOLOGY_PORT",
      "HELPER_DAM_URL",
      "HELPER_SEAFILE_PREFERRED",
      "HELPER_SEAFILE_LIBRARIES",
      "HELPER_SEAFILE_SERVER_URL",
      "HELPER_SYNOLOGY_FALLBACK_ALLOWED",
    ]);

  const cfg: Record<string, unknown> = {};
  for (const row of rows ?? []) {
    cfg[row.key] = row.value;
  }

  const scanRoots: string[] = Array.isArray(cfg["SCAN_ROOTS"]) ? (cfg["SCAN_ROOTS"] as string[]) : [];
  const rootMappings = scanRoots.map((r) => {
    const name = r.replace(/\/+$/, "").split("/").pop() || r;
    return { root_id: name, display_name: name, server_path: r };
  });

  // HELPER_SEAFILE_LIBRARIES is stored as a JSON string (array of mappings).
  let seafileLibraries: unknown[] = [];
  const rawLibs = cfg["HELPER_SEAFILE_LIBRARIES"];
  if (Array.isArray(rawLibs)) {
    seafileLibraries = rawLibs;
  } else if (typeof rawLibs === "string" && rawLibs.trim()) {
    try {
      const parsed = JSON.parse(rawLibs);
      if (Array.isArray(parsed)) seafileLibraries = parsed;
    } catch {
      // malformed config — return empty rather than failing the whole request
    }
  }

  const truthy = (v: unknown) => v === true || v === "true";

  return json({
    ok: true,
    dam_url: (cfg["HELPER_DAM_URL"] as string) ?? null,
    synology_url: (cfg["HELPER_SYNOLOGY_URL"] as string) ?? null,
    synology_port: (cfg["HELPER_SYNOLOGY_PORT"] as string) ?? "5001",
    root_mappings: rootMappings,
    // ── Seafile config (no secrets here — API tokens stay client-side) ──
    seafile_preferred: truthy(cfg["HELPER_SEAFILE_PREFERRED"]),
    synology_fallback_allowed: truthy(cfg["HELPER_SYNOLOGY_FALLBACK_ALLOWED"]),
    seafile_server_url: (cfg["HELPER_SEAFILE_SERVER_URL"] as string) ?? null,
    seafile_libraries: seafileLibraries,
  });
}

async function handleCreateToken(req: Request): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return err("Unauthorized", 401);

  const body = await req.json();
  const { action, asset_id, checkout_id } = body;

  if (!action || !["checkout", "checkin", "open", "reveal", "discard"].includes(action)) {
    return err("Invalid action");
  }
  if (action === "checkout" && !asset_id) return err("asset_id required for checkout");
  if (["checkin", "open", "reveal", "discard"].includes(action) && !checkout_id && !asset_id) {
    return err("checkout_id or asset_id required");
  }

  const db = serviceClient();

  // For checkout, verify asset exists and is not already locked
  if (action === "checkout" && asset_id) {
    const { data: asset } = await db
      .from("assets")
      .select("id, filename, relative_path, quick_hash, file_size")
      .eq("id", asset_id)
      .eq("is_deleted", false)
      .single();
    if (!asset) return err("Asset not found or deleted");

    const { data: existing } = await db
      .from("asset_checkouts")
      .select("id, user_id")
      .eq("asset_id", asset_id)
      .in("status", ["active", "checkin_queued", "uploading", "verifying"])
      .maybeSingle();

    if (existing && existing.user_id !== userId) {
      return err("Asset is currently checked out by another user", 409);
    }
  }

  const tokenId = randomHex(16); // 32 hex chars
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

  const { error } = await db.from("helper_tokens").insert({
    id: tokenId,
    user_id: userId,
    action,
    asset_id: asset_id ?? null,
    checkout_id: checkout_id ?? null,
    expires_at: expiresAt,
  });
  if (error) return err(`Failed to create token: ${error.message}`, 500);

  // Build the popdam:// URL
  const params = new URLSearchParams({ token: tokenId });
  if (asset_id) params.set("assetId", asset_id);
  if (checkout_id) params.set("checkoutId", checkout_id);
  const url = `popdam://${action}?${params.toString()}`;

  return json({ ok: true, token: tokenId, url, expires_at: expiresAt });
}

async function handleStartCheckout(req: Request): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return err("Unauthorized", 401);

  const body = await req.json();
  const { token, asset_id, device_id, helper_version, computer_id } = body;
  if (!token) return err("token required");

  const db = serviceClient();

  // Validate and consume token
  const { data: tok, error: tokErr } = await db
    .from("helper_tokens")
    .select("*")
    .eq("id", token)
    .eq("user_id", userId)
    .eq("action", "checkout")
    .single();

  if (tokErr || !tok) return err("Invalid or expired token", 401);
  if (tok.consumed_at) return err("Token already used", 401);
  if (new Date(tok.expires_at) < new Date()) return err("Token expired", 401);
  if (tok.asset_id && asset_id && tok.asset_id !== asset_id) {
    return err("Token asset mismatch", 401);
  }

  const resolvedAssetId = tok.asset_id ?? asset_id;
  if (!resolvedAssetId) return err("asset_id required");

  // Load asset
  const { data: asset } = await db
    .from("assets")
    .select("id, filename, relative_path, quick_hash, file_size, is_deleted")
    .eq("id", resolvedAssetId)
    .single();
  if (!asset || asset.is_deleted) return err("Asset not found");

  // Check for conflicting active checkout
  const { data: existing } = await db
    .from("asset_checkouts")
    .select("id, user_id")
    .eq("asset_id", resolvedAssetId)
    .in("status", ["active", "checkin_queued", "uploading", "verifying"])
    .maybeSingle();

  if (existing && existing.user_id !== userId) {
    return err("Asset is checked out by another user", 409);
  }
  if (existing && existing.user_id === userId) {
    // Already checked out by this user — mark token consumed and return existing checkout
    await db
      .from("helper_tokens")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", token);
    return json({ ok: true, checkout_id: existing.id, already_open: true, asset });
  }

  // Create checkout record
  const { data: checkout, error: coErr } = await db
    .from("asset_checkouts")
    .insert({
      asset_id: resolvedAssetId,
      user_id: userId,
      device_id: device_id ?? null,
      status: "active",
      source_hash: asset.quick_hash ?? "",
      source_size: asset.file_size ?? 0,
    })
    .select("id")
    .single();

  if (coErr) {
    // Unique constraint violation — race with another user
    if (coErr.code === "23505") return err("Asset was just checked out by another user", 409);
    return err(`Failed to create checkout: ${coErr.message}`, 500);
  }

  // Consume token and link it to the checkout
  await db
    .from("helper_tokens")
    .update({ consumed_at: new Date().toISOString(), checkout_id: checkout.id })
    .eq("id", token);

  // Load root mapping from admin_config so helper knows where to look
  const { data: cfgRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "HELPER_ROOT_MAPPINGS")
    .maybeSingle();
  const rootMappings = cfgRow?.value ? JSON.parse(cfgRow.value) : [];

  return json({
    ok: true,
    checkout_id: checkout.id,
    asset: {
      asset_id: asset.id,
      filename: asset.filename,
      relative_path: asset.relative_path,
      expected_hash: asset.quick_hash,
      expected_size: asset.file_size,
    },
    root_mappings: rootMappings,
    open_after_checkout: true,
  });
}

async function handlePrepareCheckin(req: Request): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return err("Unauthorized", 401);

  const body = await req.json();
  const { checkout_id, snapshot_hash, snapshot_size } = body;
  if (!checkout_id) return err("checkout_id required");

  const db = serviceClient();

  const { data: checkout } = await db
    .from("asset_checkouts")
    .select("*, assets(id, filename, relative_path, quick_hash, file_size)")
    .eq("id", checkout_id)
    .eq("user_id", userId)
    .single();

  if (!checkout) return err("Checkout not found or not owned by you", 404);
  if (!["active", "error"].includes(checkout.status)) {
    return err(`Checkout is in status '${checkout.status}', cannot prepare check-in`);
  }

  // Mark as checkin_queued
  await db
    .from("asset_checkouts")
    .update({ status: "checkin_queued", checkin_hash: snapshot_hash ?? null, checkin_size: snapshot_size ?? null })
    .eq("id", checkout_id);

  // Load Synology config
  const { data: cfgRows } = await db
    .from("admin_config")
    .select("key, value")
    .in("key", ["HELPER_SYNOLOGY_URL", "HELPER_SYNOLOGY_PORT"]);
  const cfg: Record<string, string> = {};
  for (const r of cfgRows ?? []) cfg[r.key] = r.value;

  const asset = (checkout as any).assets;

  return json({
    ok: true,
    checkout_id,
    upload_instructions: {
      method: "synology_file_station",
      synology_url: cfg["HELPER_SYNOLOGY_URL"] ?? null,
      synology_port: cfg["HELPER_SYNOLOGY_PORT"] ?? "5001",
      relative_path: asset.relative_path,
      filename: asset.filename,
      temp_suffix: `.__pop_uploading_${checkout_id.slice(0, 8)}.tmp`,
    },
  });
}

async function handleCompleteCheckin(req: Request): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return err("Unauthorized", 401);

  const body = await req.json();
  const {
    checkout_id,
    final_hash,
    final_quick_hash,
    final_size,
    upload_method,
    synology_upload_user,
    source_provider,
    source_version,
  } = body;
  if (!checkout_id) return err("checkout_id required");

  const db = serviceClient();

  const { data: checkout } = await db
    .from("asset_checkouts")
    .select("id, asset_id, status, source_hash")
    .eq("id", checkout_id)
    .eq("user_id", userId)
    .single();

  if (!checkout) return err("Checkout not found", 404);
  if (!["checkin_queued", "uploading", "verifying"].includes(checkout.status)) {
    return err(`Checkout is in status '${checkout.status}', cannot complete`);
  }

  const now = new Date().toISOString();

  // Seafile-sourced check-ins take an extra hop to reach the NYC Synology, so the
  // helper's HTTP upload returning does NOT prove the fully-synced file landed
  // intact. Park them in 'verifying' (lock stays held — 'verifying' is in the
  // one-active-per-asset index) until the bridge agent on the Synology confirms
  // receipt. The helper's post-upload full hash/size become the EXPECTED values
  // the agent will match against; the asset's quick_hash is NOT updated until the
  // file is confirmed. Synology direct uploads complete immediately as before.
  if (source_provider === "seafile" && await isCheckinVerificationEnabled(db)) {
    const nowMs = Date.now();
    await db.from("asset_checkouts").update({
      status: "verifying",
      checkin_hash: final_hash ?? null, // full content hash (forensic record)
      expected_quick_hash: final_quick_hash ?? null, // what the bridge agent verifies against
      checkin_size: final_size ?? null,
      upload_method: upload_method ?? null,
      synology_upload_user: synology_upload_user ?? null,
      source_provider,
      source_version: source_version ?? null,
      verify_attempts: 0,
      verify_deadline_at: new Date(nowMs + VERIFY_FLAG_MS).toISOString(),
      verify_resolve_at: new Date(nowMs + VERIFY_RESOLVE_MS).toISOString(),
      verify_last_attempt_at: null,
      verify_failed_at: null,
      verify_error: null,
      verified_at: null,
      final_hash: null,
      final_size: null,
      redrive_count: 0,
      redrive_requested: false,
      resolution: null,
    }).eq("id", checkout_id);

    return json({ ok: true, checkout_id, status: "verifying" });
  }

  // Update checkout to complete
  await db.from("asset_checkouts").update({
    status: "complete",
    checked_in_at: now,
    checkin_hash: final_hash ?? null,
    checkin_size: final_size ?? null,
    upload_method: upload_method ?? null,
    synology_upload_user: synology_upload_user ?? null,
    source_provider: source_provider ?? null,
    source_version: source_version ?? null,
  }).eq("id", checkout_id);

  // Update asset quick_hash and file_size if provided
  if (final_hash || final_size) {
    const assetUpdate: Record<string, unknown> = { updated_at: now };
    if (final_hash) assetUpdate.quick_hash = final_hash;
    if (final_size) assetUpdate.file_size = final_size;
    await db.from("assets").update(assetUpdate).eq("id", checkout.asset_id);
  }

  return json({ ok: true, checkout_id, status: "complete" });
}

// Re-drive: the server asked the helper to re-upload a stuck check-in from its
// retained snapshot. Returns fresh Synology upload instructions (allowed while
// 'verifying', unlike prepare-checkin) and clears the request flag so it isn't
// double-driven. Deadlines are intentionally NOT reset — re-drive gives the file
// a fresh chance to land without extending the overall resolve ceiling.
async function handleRedrive(req: Request): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return err("Unauthorized", 401);

  const body = await req.json();
  const { checkout_id } = body;
  if (!checkout_id) return err("checkout_id required");

  const db = serviceClient();

  const { data: checkout } = await db
    .from("asset_checkouts")
    .select("id, status, assets(relative_path, filename)")
    .eq("id", checkout_id)
    .eq("user_id", userId)
    .single();

  if (!checkout) return err("Checkout not found", 404);
  if (checkout.status !== "verifying") {
    return err(`Checkout is in status '${checkout.status}', cannot re-drive`);
  }

  await db.from("asset_checkouts")
    .update({ redrive_requested: false })
    .eq("id", checkout_id);

  const { data: cfgRows } = await db
    .from("admin_config")
    .select("key, value")
    .in("key", ["HELPER_SYNOLOGY_URL", "HELPER_SYNOLOGY_PORT"]);
  const cfg: Record<string, string> = {};
  for (const r of cfgRows ?? []) cfg[r.key] = r.value;

  const asset = (checkout as any).assets;

  return json({
    ok: true,
    checkout_id,
    upload_instructions: {
      method: "synology_file_station",
      synology_url: cfg["HELPER_SYNOLOGY_URL"] ?? null,
      synology_port: cfg["HELPER_SYNOLOGY_PORT"] ?? "5001",
      relative_path: asset.relative_path,
      filename: asset.filename,
      temp_suffix: `.__pop_uploading_${checkout_id.slice(0, 8)}.tmp`,
    },
  });
}

// The helper finished re-uploading the snapshot. Count the re-drive and clear the
// flagged state so verification gets a clean shot at the freshly-pushed file.
// Deadlines are left as-is.
async function handleRedriveComplete(req: Request): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return err("Unauthorized", 401);

  const body = await req.json();
  const { checkout_id } = body;
  if (!checkout_id) return err("checkout_id required");

  const db = serviceClient();

  const { data: checkout } = await db
    .from("asset_checkouts")
    .select("id, status, redrive_count")
    .eq("id", checkout_id)
    .eq("user_id", userId)
    .single();

  if (!checkout) return err("Checkout not found", 404);
  if (checkout.status !== "verifying") {
    return json({ ok: true, checkout_id, status: checkout.status, noop: true });
  }

  await db.from("asset_checkouts").update({
    redrive_count: (checkout.redrive_count ?? 0) + 1,
    redrive_requested: false,
    verify_failed_at: null,
    verify_error: null,
  }).eq("id", checkout_id);

  return json({ ok: true, checkout_id });
}

async function handleDiscard(req: Request): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return err("Unauthorized", 401);

  const body = await req.json();
  const { checkout_id } = body;
  if (!checkout_id) return err("checkout_id required");

  const db = serviceClient();

  const { data: checkout } = await db
    .from("asset_checkouts")
    .select("id, status")
    .eq("id", checkout_id)
    .eq("user_id", userId)
    .single();

  if (!checkout) return err("Checkout not found", 404);
  if (checkout.status === "complete") return err("Cannot discard a completed checkout");
  if (checkout.status === "discarded") return json({ ok: true, checkout_id });

  await db.from("asset_checkouts").update({ status: "discarded" }).eq("id", checkout_id);

  return json({ ok: true, checkout_id });
}

async function handleHeartbeat(req: Request): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return err("Unauthorized", 401);

  const body = await req.json();
  // hydration_bytes_done / hydration_bytes_total are accepted for forward-compat
  // (Seafile hydration progress) but not persisted to dedicated columns yet.
  const { checkout_id, device_id, status } = body;

  const db = serviceClient();

  if (checkout_id) {
    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      updated_at: now,
      last_helper_heartbeat_at: now,
    };
    // NOTE: "hydrating" is a reported state, not a DB status enum value — do not
    // write it to the status column. Only real lifecycle statuses are persisted.
    if (status && ["uploading", "verifying"].includes(status)) {
      update.status = status;
    }
    await db
      .from("asset_checkouts")
      .update(update)
      .eq("id", checkout_id)
      .eq("user_id", userId);
  }

  if (device_id) {
    await db
      .from("helper_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", device_id)
      .eq("user_id", userId);
  }

  return json({ ok: true });
}

async function handleGetOpenCheckouts(req: Request): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return err("Unauthorized", 401);

  const db = serviceClient();

  const { data, error } = await db
    .from("asset_checkouts")
    .select(`
      id, status, checked_out_at, source_hash, source_size,
      verify_deadline_at, verify_failed_at, verify_error, redrive_requested, resolution,
      assets (id, filename, relative_path, quick_hash, file_size)
    `)
    .eq("user_id", userId)
    .in("status", ["active", "checkin_queued", "uploading", "verifying", "error"])
    .order("checked_out_at", { ascending: false });

  if (error) return err("Failed to load checkouts", 500);

  return json({ ok: true, checkouts: data ?? [] });
}

async function handleLogs(req: Request): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return err("Unauthorized", 401);

  // Accept log events but don't store them for now (future: helper_logs table)
  // Just acknowledge receipt so the helper doesn't queue up indefinitely
  return json({ ok: true });
}

// ── Admin: force-unlock a checkout (admin only) ───────────────────────────────

async function handleAdminForceDiscard(req: Request): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return err("Unauthorized", 401);

  const db = serviceClient();

  // Check admin role
  const { data: role } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();
  if (!role || role.role !== "admin") return err("Admin only", 403);

  const body = await req.json();
  const { checkout_id } = body;
  if (!checkout_id) return err("checkout_id required");

  await db
    .from("asset_checkouts")
    .update({ status: "discarded", error_message: "Force-discarded by admin" })
    .eq("id", checkout_id);

  return json({ ok: true });
}

// ── Router ────────────────────────────────────────────────────────────────────

corsServe(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/helper-api/, "");
  const method = req.method;

  if (method === "POST" && path === "/register-device") return handleRegisterDevice(req);
  if (method === "GET" && path === "/config") return handleGetConfig(req);
  if (method === "POST" && path === "/tokens") return handleCreateToken(req);
  if (method === "POST" && path === "/checkouts/start") return handleStartCheckout(req);
  if (method === "POST" && path === "/checkouts/prepare-checkin") return handlePrepareCheckin(req);
  if (method === "POST" && path === "/checkouts/complete-checkin") return handleCompleteCheckin(req);
  if (method === "POST" && path === "/checkouts/redrive") return handleRedrive(req);
  if (method === "POST" && path === "/checkouts/redrive-complete") return handleRedriveComplete(req);
  if (method === "POST" && path === "/checkouts/discard") return handleDiscard(req);
  if (method === "POST" && path === "/checkouts/heartbeat") return handleHeartbeat(req);
  if (method === "GET" && path === "/checkouts/open") return handleGetOpenCheckouts(req);
  if (method === "POST" && path === "/logs") return handleLogs(req);
  if (method === "POST" && path === "/admin/force-discard") return handleAdminForceDiscard(req);

  return err("Not found", 404);
});
