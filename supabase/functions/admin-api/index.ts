import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseSku } from "../_shared/sku-parser.ts";
import { extractSkuFolder, selectPrimaryAsset } from "../_shared/style-grouping.ts";

// ── CORS ────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, " +
    "x-supabase-client-platform, x-supabase-client-platform-version, " +
    "x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Helpers ─────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return json({ ok: false, error: message }, status);
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`Missing required string field: ${key}`);
  }
  return v.trim();
}

function optionalString(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new Error(`Field ${key} must be a string`);
  return v.trim() || null;
}

// ── Auth: JWT validation + admin role check ─────────────────────────

async function authenticateAdmin(
  req: Request,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return err("Missing or invalid Authorization header", 401);
  }

  const token = authHeader.replace("Bearer ", "");
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !user) {
    console.error("Token validation error:", userError);
    return err("Invalid or expired token", 401);
  }

  const userId = user.id;
  if (!userId) return err("Invalid token: no subject", 401);

  // Check admin role using service client (bypasses RLS)
  const db = serviceClient();
  const { data: roleRow } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (!roleRow) {
    return err("Forbidden: admin role required", 403);
  }

  return { userId };
}

// ── Route: get-config ───────────────────────────────────────────────

async function handleGetConfig(body: Record<string, unknown>) {
  const keys = body.keys;
  const db = serviceClient();

  let query = db.from("admin_config").select("key, value, updated_at");
  if (Array.isArray(keys) && keys.length > 0) {
    query = query.in("key", keys as string[]);
  }

  const { data, error } = await query;
  if (error) return err(error.message, 500);

  const config: Record<string, unknown> = {};
  for (const row of data || []) {
    config[row.key] = { value: row.value, updated_at: row.updated_at };
  }
  return json({ ok: true, config });
}

// ── Route: set-config ───────────────────────────────────────────────

async function handleSetConfig(
  body: Record<string, unknown>,
  userId: string,
) {
  const entries = body.entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return err("entries must be an object of { key: value } pairs");
  }

  const db = serviceClient();
  const now = new Date().toISOString();
  const upserts = Object.entries(entries as Record<string, unknown>).map(
    ([key, value]) => ({
      key,
      value: value,
      updated_at: now,
      updated_by: userId,
    }),
  );

  for (const row of upserts) {
    const { error } = await db.from("admin_config").upsert(row);
    if (error) return err(`Failed to set ${row.key}: ${error.message}`, 500);
  }

  return json({ ok: true });
}

// ── Route: invite-user ──────────────────────────────────────────────

async function handleInviteUser(
  body: Record<string, unknown>,
  userId: string,
) {
  const email = requireString(body, "email").toLowerCase();
  const roleStr = optionalString(body, "role") ?? "user";

  if (!["admin", "user"].includes(roleStr)) {
    return err("role must be 'admin' or 'user'");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return err("Invalid email format");
  }

  const db = serviceClient();

  const { data: existing } = await db
    .from("invitations")
    .select("id, accepted_at")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    if (existing.accepted_at) {
      return err("This email has already accepted an invitation");
    }
    return err("An invitation for this email is already pending");
  }

  const { data, error } = await db
    .from("invitations")
    .insert({ email, role: roleStr, invited_by: userId })
    .select("id, email, role, created_at")
    .single();

  if (error) return err(error.message, 500);

  // Fire-and-forget invite email
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    await fetch(`${supabaseUrl}/functions/v1/send-invite-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, invitation_id: data.id }),
    });
  } catch (e) {
    console.error("Failed to trigger invite email:", e);
  }

  return json({ ok: true, invitation: data });
}

// ── Route: list-invites ─────────────────────────────────────────────

async function handleListInvites() {
  const db = serviceClient();
  const { data, error } = await db
    .from("invitations")
    .select("id, email, role, created_at, accepted_at, invited_by")
    .order("created_at", { ascending: false });

  if (error) return err(error.message, 500);
  return json({ ok: true, invitations: data });
}

// ── Route: revoke-invite ────────────────────────────────────────────

async function handleRevokeInvite(body: Record<string, unknown>) {
  const invitationId = requireString(body, "invitation_id");
  const db = serviceClient();

  const { data: invite } = await db
    .from("invitations")
    .select("accepted_at")
    .eq("id", invitationId)
    .single();

  if (!invite) return err("Invitation not found", 404);
  if (invite.accepted_at) {
    return err("Cannot revoke an already accepted invitation");
  }

  const { error } = await db
    .from("invitations")
    .delete()
    .eq("id", invitationId);

  if (error) return err(error.message, 500);
  return json({ ok: true });
}

// ── Route: generate-agent-key ───────────────────────────────────────

async function handleGenerateAgentKey(
  body: Record<string, unknown>,
  userId: string,
) {
  const agentName = requireString(body, "agent_name");
  const agentType = optionalString(body, "agent_type") ?? "bridge";

  if (!["bridge", "windows-render"].includes(agentType)) {
    return err("agent_type must be 'bridge' or 'windows-render'");
  }

  // Generate 64-char hex key
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const rawKey = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Hash for storage
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(rawKey),
  );
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const db = serviceClient();
  const { data, error } = await db
    .from("agent_registrations")
    .insert({
      agent_name: agentName,
      agent_type: agentType,
      agent_key_hash: hashHex,
    })
    .select("id")
    .single();

  if (error) return err(error.message, 500);

  return json({
    ok: true,
    agent_id: data.id,
    agent_key: rawKey,
    warning: "Store this key securely. It cannot be retrieved again.",
  });
}

// ── Route: list-agents ──────────────────────────────────────────────

async function handleListAgents() {
  const db = serviceClient();
  const { data, error } = await db
    .from("agent_registrations")
    .select("id, agent_name, agent_type, last_heartbeat, metadata, created_at")
    .order("created_at", { ascending: false });

  if (error) return err(error.message, 500);

  const now = Date.now();
  const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000;

  const agents = (data || []).map((a) => {
    const lastHb = a.last_heartbeat
      ? new Date(a.last_heartbeat).getTime()
      : 0;
    const metadata = (a.metadata as Record<string, unknown>) || {};
    return {
      id: a.id,
      name: a.agent_name,
      type: a.agent_type,
      status:
        lastHb > 0 && now - lastHb < OFFLINE_THRESHOLD_MS
          ? "online"
          : "offline",
      last_heartbeat: a.last_heartbeat,
      last_counters: metadata.last_counters || null,
      last_error: metadata.last_error || null,
      heartbeat_history: metadata.heartbeat_history || [],
      key_preview: a.agent_key_hash
        ? `${a.agent_key_hash.substring(0, 8)}...`
        : null,
      created_at: a.created_at,
      force_stop: metadata.force_stop === true,
      scan_abort: metadata.scan_abort === true,
    };
  });

  return json({ ok: true, agents });
}

// ── Route: revoke-agent ─────────────────────────────────────────────

async function handleRevokeAgent(body: Record<string, unknown>) {
  const agentId = requireString(body, "agent_id");
  const db = serviceClient();

  const { data: agent } = await db
    .from("agent_registrations")
    .select("id")
    .eq("id", agentId)
    .maybeSingle();

  if (!agent) return err("Agent not found", 404);

  const { error } = await db
    .from("agent_registrations")
    .delete()
    .eq("id", agentId);

  if (error) return err(error.message, 500);
  return json({ ok: true });
}

// ── Route: doctor ───────────────────────────────────────────────────

async function handleDoctor() {
  const db = serviceClient();

  // 1) Effective config
  const { data: configRows } = await db
    .from("admin_config")
    .select("key, value, updated_at");

  const config: Record<string, unknown> = {};
  for (const row of configRows || []) {
    config[row.key] = row.value;
  }

  // 2) Agent statuses
  const { data: agents } = await db
    .from("agent_registrations")
    .select(
      "id, agent_name, agent_type, last_heartbeat, metadata, created_at",
    );

  const now = Date.now();
  const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000;

  const agentStatuses = (agents || []).map((a) => {
    const lastHb = a.last_heartbeat
      ? new Date(a.last_heartbeat).getTime()
      : 0;
    const metadata = (a.metadata as Record<string, unknown>) || {};
    return {
      id: a.id,
      name: a.agent_name,
      type: a.agent_type,
      status:
        lastHb > 0 && now - lastHb < OFFLINE_THRESHOLD_MS
          ? "online"
          : "offline",
      last_heartbeat: a.last_heartbeat,
      last_counters: metadata.last_counters || null,
      last_error: metadata.last_error || null,
      scan_roots: metadata.scan_roots || [],
      created_at: a.created_at,
    };
  });

  // 3) Scan progress
  const scanProgress = config.SCAN_PROGRESS || null;

  // 4) Recent errors
  const { data: recentErrors } = await db
    .from("processing_queue")
    .select("id, asset_id, job_type, error_message, completed_at")
    .eq("status", "failed")
    .order("completed_at", { ascending: false })
    .limit(20);

  // 5) Asset counts
  const { count: totalAssets } = await db
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("is_deleted", false);

  const { count: pendingAssets } = await db
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending")
    .eq("is_deleted", false);

  const { count: errorAssets } = await db
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("status", "error")
    .eq("is_deleted", false);

  const { count: pendingJobs } = await db
    .from("processing_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  const { count: pendingRenders } = await db
    .from("render_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  return json({
    ok: true,
    diagnostic: {
      timestamp: new Date().toISOString(),
      config,
      agents: agentStatuses,
      scan_progress: scanProgress,
      recent_errors: recentErrors || [],
      counts: {
        total_assets: totalAssets ?? 0,
        pending_assets: pendingAssets ?? 0,
        error_assets: errorAssets ?? 0,
        pending_jobs: pendingJobs ?? 0,
        pending_renders: pendingRenders ?? 0,
      },
    },
  });
}

// ── Route: trigger-scan ─────────────────────────────────────────────

async function handleTriggerScan(
  body: Record<string, unknown>,
  userId: string,
) {
  const targetAgentId = optionalString(body, "agent_id");
  const db = serviceClient();
  const requestId = crypto.randomUUID();

  const { error } = await db.from("admin_config").upsert({
    key: "SCAN_REQUEST",
    value: {
      request_id: requestId,
      status: "pending",
      requested_at: new Date().toISOString(),
      requested_by: userId,
      target_agent_id: targetAgentId,
    },
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, request_id: requestId });
}

// ── Route: stop-scan ────────────────────────────────────────────────

async function handleStopScan(_body: Record<string, unknown>) {
  const db = serviceClient();
  const now = new Date().toISOString();

  const { data: agents, error: agentsErr } = await db
    .from("agent_registrations")
    .select("id, metadata");
  if (agentsErr) return err(agentsErr.message, 500);

  for (const a of agents || []) {
    const metadata = (a.metadata as Record<string, unknown>) || {};
    const { error: updateErr } = await db
      .from("agent_registrations")
      .update({
        metadata: {
          ...metadata,
          scan_requested: false,
          scan_abort: true,
          force_stop: true,
        },
      })
      .eq("id", a.id);

    if (updateErr) return err(updateErr.message, 500);
  }

  // Force progress out of stale "running" state immediately
  const { data: progressRow, error: progressFetchErr } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "SCAN_PROGRESS")
    .maybeSingle();
  if (progressFetchErr) return err(progressFetchErr.message, 500);

  const progressVal = (progressRow?.value as Record<string, unknown>) || {};
  const counters =
    typeof progressVal.counters === "object" && progressVal.counters !== null
      ? progressVal.counters
      : {};

  const { error: progressErr } = await db.from("admin_config").upsert({
    key: "SCAN_PROGRESS",
    value: {
      ...(typeof progressVal.session_id === "string"
        ? { session_id: progressVal.session_id }
        : {}),
      status: "failed",
      counters,
      current_path:
        typeof progressVal.current_path === "string"
          ? progressVal.current_path
          : null,
      updated_at: now,
    },
    updated_at: now,
  });
  if (progressErr) return err(progressErr.message, 500);

  // Cancel any pending/claimed request so stale claims don't linger
  const { data: reqRow, error: reqFetchErr } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "SCAN_REQUEST")
    .maybeSingle();
  if (reqFetchErr) return err(reqFetchErr.message, 500);

  if (reqRow) {
    const reqVal = (reqRow.value as Record<string, unknown>) || {};
    if (reqVal.status === "pending" || reqVal.status === "claimed") {
      const { error: reqUpdateErr } = await db
        .from("admin_config")
        .update({
          value: { ...reqVal, status: "canceled", canceled_at: now },
          updated_at: now,
        })
        .eq("key", "SCAN_REQUEST");

      if (reqUpdateErr) return err(reqUpdateErr.message, 500);
    }
  }

  return json({ ok: true });
}

// ── Route: resume-scanning ──────────────────────────────────────────

async function handleResumeScanning() {
  const db = serviceClient();
  const { data: agents } = await db
    .from("agent_registrations")
    .select("id, metadata");

  for (const a of agents || []) {
    const metadata = (a.metadata as Record<string, unknown>) || {};
    await db
      .from("agent_registrations")
      .update({
        metadata: {
          ...metadata,
          scan_abort: false,
          force_stop: false,
        },
      })
      .eq("id", a.id);
  }

  return json({ ok: true });
}

// ── Route: reset-scan-state ──────────────────────────────────────────

async function handleResetScanState() {
  const db = serviceClient();
  const now = new Date().toISOString();

  // 1. Set SCAN_PROGRESS to idle
  const { error: progressErr } = await db.from("admin_config").upsert({
    key: "SCAN_PROGRESS",
    value: { status: "idle", updated_at: now },
    updated_at: now,
  });
  if (progressErr) return err(progressErr.message, 500);

  // 2. Cancel any pending/claimed SCAN_REQUEST
  const { data: reqRow, error: reqFetchErr } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "SCAN_REQUEST")
    .maybeSingle();
  if (reqFetchErr) return err(reqFetchErr.message, 500);

  if (reqRow) {
    const reqVal = (reqRow.value as Record<string, unknown>) || {};
    if (reqVal.status === "pending" || reqVal.status === "claimed") {
      const { error: reqUpdateErr } = await db.from("admin_config").update({
        value: { ...reqVal, status: "canceled", canceled_at: now },
        updated_at: now,
      }).eq("key", "SCAN_REQUEST");
      if (reqUpdateErr) return err(reqUpdateErr.message, 500);
    }
  }

  // 3. Clear resumable checkpoint to avoid reusing stale session state
  const { error: checkpointErr } = await db
    .from("admin_config")
    .delete()
    .eq("key", "SCAN_CHECKPOINT");
  if (checkpointErr) return err(checkpointErr.message, 500);

  // 4. Clear legacy flags in agent_registrations metadata
  const { data: agents, error: agentsErr } = await db
    .from("agent_registrations")
    .select("id, metadata");
  if (agentsErr) return err(agentsErr.message, 500);

  for (const a of agents || []) {
    const metadata = (a.metadata as Record<string, unknown>) || {};
    if (metadata.scan_abort || metadata.scan_requested || metadata.force_stop) {
      const { error: updateErr } = await db
        .from("agent_registrations")
        .update({
          metadata: {
            ...metadata,
            scan_abort: false,
            scan_requested: false,
            force_stop: false,
          },
        })
        .eq("id", a.id);

      if (updateErr) return err(updateErr.message, 500);
    }
  }

  return json({ ok: true });
}

// ── Route: get-filter-options ────────────────────────────────────────

async function handleGetFilterOptions(body: Record<string, unknown>) {
  const licensorId = optionalString(body, "licensor_id");
  const db = serviceClient();

  // Licensors with asset counts (only those with non-deleted assets)
  const { data: licensorRows, error: lErr } = await db.rpc("get_filter_options_licensors");
  if (lErr) {
    // Fallback: raw query via from()
    console.error("RPC not found, using fallback query for licensors");
  }

  // Use direct SQL approach via service client
  const { data: rawLicensors, error: lErr2 } = await db
    .from("assets")
    .select("licensor_id")
    .eq("is_deleted", false)
    .not("licensor_id", "is", null);

  // Aggregate licensor counts
  const licensorCounts: Record<string, number> = {};
  for (const row of rawLicensors || []) {
    const lid = row.licensor_id as string;
    licensorCounts[lid] = (licensorCounts[lid] || 0) + 1;
  }

  // Fetch licensor names
  const licensorIds = Object.keys(licensorCounts);
  let licensors: { id: string; name: string; asset_count: number }[] = [];
  if (licensorIds.length > 0) {
    const { data: licensorNames } = await db
      .from("licensors")
      .select("id, name")
      .in("id", licensorIds)
      .order("name");
    licensors = (licensorNames || []).map((l) => ({
      id: l.id,
      name: l.name,
      asset_count: licensorCounts[l.id] || 0,
    }));
  }

  // Properties with asset counts
  let propertyQuery = db
    .from("assets")
    .select("property_id, licensor_id")
    .eq("is_deleted", false)
    .not("property_id", "is", null);

  if (licensorId) {
    propertyQuery = propertyQuery.eq("licensor_id", licensorId);
  }

  const { data: rawProperties } = await propertyQuery;

  const propertyCounts: Record<string, number> = {};
  for (const row of rawProperties || []) {
    const pid = row.property_id as string;
    propertyCounts[pid] = (propertyCounts[pid] || 0) + 1;
  }

  const propertyIds = Object.keys(propertyCounts);
  let properties: { id: string; name: string; licensor_id: string; asset_count: number }[] = [];
  if (propertyIds.length > 0) {
    const { data: propertyNames } = await db
      .from("properties")
      .select("id, name, licensor_id")
      .in("id", propertyIds)
      .order("name");
    properties = (propertyNames || []).map((p) => ({
      id: p.id,
      name: p.name,
      licensor_id: p.licensor_id,
      asset_count: propertyCounts[p.id] || 0,
    }));
  }

  return json({ ok: true, licensors, properties });
}

// ── Route: render-queue-stats ────────────────────────────────────────

async function handleRenderQueueStats() {
  const db = serviceClient();
  const { count, error } = await db
    .from("render_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) return err(error.message, 500);
  return json({ ok: true, pending_count: count ?? 0 });
}

// ── Route: list-render-jobs ─────────────────────────────────────────

async function handleListRenderJobs(body: Record<string, unknown>) {
  const db = serviceClient();
  const statusFilter = optionalString(body, "status_filter");

  let query = db
    .from("render_queue")
    .select("id, asset_id, status, created_at, completed_at, error_message, claimed_by")
    .order("created_at", { ascending: false })
    .limit(50);

  if (statusFilter && ["pending", "completed", "failed", "claimed", "processing"].includes(statusFilter)) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) return err(error.message, 500);

  // Join asset filenames + thumbnail_url
  const assetIds = [...new Set((data || []).map((r) => r.asset_id))];
  let assetMap: Record<string, { filename: string; thumbnail_url: string | null }> = {};
  if (assetIds.length > 0) {
    const { data: assets } = await db
      .from("assets")
      .select("id, filename, thumbnail_url")
      .in("id", assetIds);
    for (const a of assets || []) {
      assetMap[a.id] = { filename: a.filename, thumbnail_url: a.thumbnail_url };
    }
  }

  const jobs = (data || []).map((j) => ({
    ...j,
    filename: assetMap[j.asset_id]?.filename || "Unknown",
    thumbnail_url: assetMap[j.asset_id]?.thumbnail_url || null,
  }));

  return json({ ok: true, jobs });
}

// ── Route: clear-failed-renders ─────────────────────────────────────

async function handleClearFailedRenders() {
  const db = serviceClient();
  const { data, error } = await db
    .from("render_queue")
    .delete()
    .eq("status", "failed")
    .select("id");

  if (error) return err(error.message, 500);
  return json({ ok: true, deleted_count: data?.length ?? 0 });
}

// ── Route: send-test-render ─────────────────────────────────────────

async function handleSendTestRender() {
  const db = serviceClient();

  // Find most recent asset with thumbnail_error = 'no_pdf_compat'
  const { data: assets, error: aErr } = await db
    .from("assets")
    .select("id")
    .eq("thumbnail_error", "no_pdf_compat")
    .eq("is_deleted", false)
    .is("thumbnail_url", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (aErr) return err(aErr.message, 500);
  if (!assets || assets.length === 0) {
    return err("No assets with 'no_pdf_compat' error found to test with");
  }

  const assetId = assets[0].id;

  const { data: job, error: jErr } = await db
    .from("render_queue")
    .insert({ asset_id: assetId, status: "pending" })
    .select("id")
    .single();

  if (jErr) return err(jErr.message, 500);
  return json({ ok: true, job_id: job.id, asset_id: assetId });
}

// ── Route: check-render-job ─────────────────────────────────────────

async function handleCheckRenderJob(body: Record<string, unknown>) {
  const jobId = requireString(body, "job_id");
  const db = serviceClient();

  const { data, error } = await db
    .from("render_queue")
    .select("id, status, error_message, completed_at, asset_id")
    .eq("id", jobId)
    .single();

  if (error) return err(error.message, 500);
  if (!data) return err("Job not found", 404);

  let thumbnailUrl: string | null = null;
  if (data.status === "completed") {
    const { data: asset } = await db
      .from("assets")
      .select("thumbnail_url")
      .eq("id", data.asset_id)
      .single();
    thumbnailUrl = asset?.thumbnail_url ?? null;
  }

  return json({
    ok: true,
    status: data.status,
    error_message: data.error_message,
    completed_at: data.completed_at,
    thumbnail_url: thumbnailUrl,
  });
}

// ── Route: retry-failed-jobs ─────────────────────────────────────────

async function handleRetryFailedJobs() {
  const db = serviceClient();
  const { data, error } = await db
    .from("processing_queue")
    .update({ status: "pending", error_message: null, agent_id: null, claimed_at: null })
    .eq("status", "failed")
    .select("id");

  if (error) return err(error.message, 500);
  return json({ ok: true, retried_count: data?.length ?? 0 });
}

// ── Route: clear-completed-jobs ─────────────────────────────────────

async function handleClearCompletedJobs() {
  const db = serviceClient();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("processing_queue")
    .delete()
    .eq("status", "completed")
    .lt("completed_at", cutoff)
    .select("id");

  if (error) return err(error.message, 500);
  return json({ ok: true, deleted_count: data?.length ?? 0 });
}

// ── Route: remove-agent-registration ────────────────────────────────

async function handleRemoveAgentRegistration(body: Record<string, unknown>) {
  const agentId = requireString(body, "agent_id");
  const db = serviceClient();

  const { data: agent } = await db
    .from("agent_registrations")
    .select("id")
    .eq("id", agentId)
    .maybeSingle();

  if (!agent) return err("Agent registration not found", 404);

  const { error } = await db
    .from("agent_registrations")
    .delete()
    .eq("id", agentId);

  if (error) return err(error.message, 500);
  return json({ ok: true });
}

// ── Route: clear-junk-render-jobs ────────────────────────────────────

async function handleClearJunkRenderJobs() {
  const db = serviceClient();
  const JUNK_FILENAMES = new Set([".DS_Store", ".localized", "Thumbs.db", "desktop.ini"]);

  const { data: jobs, error: fetchErr } = await db
    .from("render_queue")
    .select("id, asset_id")
    .eq("status", "pending");

  if (fetchErr) return err(fetchErr.message, 500);
  if (!jobs || jobs.length === 0) return json({ ok: true, cleared: 0 });

  // Fetch asset info for these jobs
  const assetIds = [...new Set(jobs.map((j) => j.asset_id))];
  const { data: assets } = await db
    .from("assets")
    .select("id, filename, relative_path")
    .in("id", assetIds);

  const assetMap: Record<string, { filename: string; relative_path: string }> = {};
  for (const a of assets || []) {
    assetMap[a.id] = { filename: a.filename, relative_path: a.relative_path };
  }

  const junkIds = jobs
    .filter((job) => {
      const info = assetMap[job.asset_id];
      if (!info) return false;
      const fn = info.filename;
      const rp = info.relative_path;
      return (
        fn.startsWith("._") ||
        fn.startsWith("~") ||
        JUNK_FILENAMES.has(fn) ||
        rp.includes("__MACOSX")
      );
    })
    .map((job) => job.id);

  if (junkIds.length === 0) return json({ ok: true, cleared: 0 });

  const { error: updateErr } = await db
    .from("render_queue")
    .update({ status: "failed", error_message: "Skipped: macOS/system artifact" })
    .in("id", junkIds);

  if (updateErr) return err(updateErr.message, 500);
  return json({ ok: true, cleared: junkIds.length });
}

// ── Route: requeue-render-job ───────────────────────────────────────

async function handleRequeueRenderJob(body: Record<string, unknown>) {
  const jobId = requireString(body, "job_id");
  const db = serviceClient();

  const { data, error } = await db
    .from("render_queue")
    .update({ status: "pending", error_message: null, claimed_by: null, claimed_at: null, completed_at: null })
    .eq("id", jobId)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();

  if (error) return err(error.message, 500);
  if (!data) return err("Job not found or not in failed state", 404);
  return json({ ok: true });
}

// ── Route: generate-bootstrap-token ─────────────────────────────────

async function handleGenerateBootstrapToken(userId: string) {
  const db = serviceClient();

  // Check for an existing valid, unused token — return it instead of generating a new one
  const { data: existingRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "WINDOWS_BOOTSTRAP_TOKEN")
    .maybeSingle();

  if (existingRow) {
    const existing = existingRow.value as Record<string, unknown>;
    if (
      existing &&
      existing.used !== true &&
      existing.expires_at &&
      new Date(existing.expires_at as string).getTime() > Date.now()
    ) {
      // Return the existing valid token with its original expiry
      return json({
        ok: true,
        token: existing.token,
        expires_at: existing.expires_at,
      });
    }
  }

  // Generate 16-char token formatted as XXXX-XXXX-XXXX-XXXX
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 for readability
  let raw = "";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 16; i++) {
    raw += chars[bytes[i] % chars.length];
  }
  const token = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

  const { error } = await db.from("admin_config").upsert({
    key: "WINDOWS_BOOTSTRAP_TOKEN",
    value: {
      token,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      used: false,
      created_by: userId,
    },
    updated_at: now.toISOString(),
    updated_by: userId,
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, token, expires_at: expiresAt.toISOString() });
}

// ── Route: trigger-agent-update ──────────────────────────────────────

async function handleTriggerAgentUpdate(
  body: Record<string, unknown>,
  userId: string,
) {
  const action = requireString(body, "update_action");
  if (!["check", "apply"].includes(action)) {
    return err("update_action must be 'check' or 'apply'");
  }

  const db = serviceClient();
  const requestId = crypto.randomUUID();

  const { error } = await db.from("admin_config").upsert({
    key: "AGENT_UPDATE_REQUEST",
    value: {
      request_id: requestId,
      requested_at: new Date().toISOString(),
      requested_by: userId,
      action,
    },
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, request_id: requestId });
}

// ── Route: get-update-status ────────────────────────────────────────

async function handleGetUpdateStatus() {
  const db = serviceClient();
  const { data, error } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "AGENT_UPDATE_STATUS")
    .maybeSingle();

  if (error) return err(error.message, 500);
  return json({ ok: true, status: data?.value ?? null });
}

// ── Shared: metadata derivation (same logic as agent-api) ───────────

const WORKFLOW_FOLDER_MAP: Record<string, string> = {
  "concept approved designs": "concept_approved",
  "in development": "in_development",
  "freelancer art": "freelancer_art",
  "discontinued": "discontinued",
  "product ideas": "product_ideas",
};

async function deriveMetadataFromPath(
  relativePath: string,
  db: ReturnType<typeof serviceClient>,
): Promise<{
  workflow_status: string;
  is_licensed: boolean;
  licensor_id: string | null;
  property_id: string | null;
}> {
  const pathParts = relativePath.split("/");

  // is_licensed: find the "Decor" folder and check sub-folder
  const decorIndex = pathParts.findIndex(
    (p) => p.toLowerCase() === "decor",
  );
  const subFolder =
    decorIndex >= 0 ? (pathParts[decorIndex + 1] || "").toLowerCase() : "";
  const is_licensed = subFolder === "character licensed";

  // workflow_status: match exact folder names against each path segment
  const lowerParts = pathParts.map((p) => p.toLowerCase());
  let workflow_status = "other";
  for (const [folder, status] of Object.entries(WORKFLOW_FOLDER_MAP)) {
    if (lowerParts.some((p) => p === folder)) {
      workflow_status = status;
      break;
    }
  }

  // licensor/property extraction for licensed files
  // Structure: Decor/Character Licensed/[Licensor]/[Property]/...
  let licensor_name: string | null = null;
  let property_name: string | null = null;
  if (is_licensed && decorIndex >= 0) {
    const licIdx = decorIndex + 2; // skip "Decor" and "Character Licensed"
    if (pathParts.length > licIdx) {
      licensor_name = pathParts[licIdx];
    }
    if (pathParts.length > licIdx + 1) {
      property_name = pathParts[licIdx + 1];
    }
  }

  let licensor_id: string | null = null;
  let property_id: string | null = null;

  if (licensor_name) {
    const { data: lic } = await db
      .from("licensors")
      .select("id")
      .ilike("name", licensor_name)
      .maybeSingle();
    licensor_id = lic?.id || null;
  }

  if (licensor_id && property_name) {
    const { data: prop } = await db
      .from("properties")
      .select("id")
      .eq("licensor_id", licensor_id)
      .ilike("name", property_name)
      .maybeSingle();
    property_id = prop?.id || null;
  }

  return { workflow_status, is_licensed, licensor_id, property_id };
}

// ── Route: reprocess-asset-metadata ─────────────────────────────────

async function handleReprocessAssetMetadata(body: Record<string, unknown>) {
  const offset = typeof body.offset === "number" ? body.offset : 0;
  const BATCH_SIZE = 200;
  const db = serviceClient();

  const { data: assets, error: fetchErr } = await db
    .from("assets")
    .select("id, relative_path, filename, is_licensed, workflow_status, licensor_id, property_id, sku")
    .eq("is_deleted", false)
    .range(offset, offset + BATCH_SIZE - 1)
    .order("created_at");

  if (fetchErr) return err(fetchErr.message, 500);
  if (!assets || assets.length === 0) {
    return json({ ok: true, done: true, updated: 0, total: 0, nextOffset: null });
  }

  let updated = 0;

  for (const asset of assets) {
    const updates: Record<string, unknown> = {};

    // Re-derive path-based metadata
    const derived = await deriveMetadataFromPath(asset.relative_path, db);

    if (asset.is_licensed !== derived.is_licensed) {
      updates.is_licensed = derived.is_licensed;
    }
    if (asset.workflow_status !== derived.workflow_status) {
      updates.workflow_status = derived.workflow_status;
    }
    if (!asset.licensor_id && derived.licensor_id) {
      updates.licensor_id = derived.licensor_id;
    }
    if (!asset.property_id && derived.property_id) {
      updates.property_id = derived.property_id;
    }

    // Re-derive SKU metadata from filename
    const parsed = await parseSku(asset.filename);
    if (parsed) {
      const skuFields: Record<string, string | boolean> = {
        sku: parsed.sku,
        mg01_code: parsed.mg01_code, mg01_name: parsed.mg01_name,
        mg02_code: parsed.mg02_code, mg02_name: parsed.mg02_name,
        mg03_code: parsed.mg03_code, mg03_name: parsed.mg03_name,
        size_code: parsed.size_code, size_name: parsed.size_name,
        licensor_code: parsed.licensor_code, licensor_name: parsed.licensor_name,
        property_code: parsed.property_code, property_name: parsed.property_name,
        sku_sequence: parsed.sku_sequence,
        product_category: parsed.product_category,
        division_code: parsed.division_code, division_name: parsed.division_name,
        is_licensed: parsed.is_licensed,
      };
      for (const [k, v] of Object.entries(skuFields)) {
        const current = (asset as Record<string, unknown>)[k];
        if (current !== v) {
          updates[k] = v;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await db
        .from("assets")
        .update(updates)
        .eq("id", asset.id);
      if (!updateErr) updated++;
    }
  }

  const done = assets.length < BATCH_SIZE;
  return json({
    ok: true,
    done,
    updated,
    total: assets.length,
    nextOffset: done ? null : offset + BATCH_SIZE,
  });
}

// ── Route: rebuild-style-groups ──────────────────────────────────────

async function handleRebuildStyleGroups(body: Record<string, unknown>) {
  const offset = typeof body.offset === "number" ? body.offset : 0;
  const BATCH_SIZE = 500;
  const db = serviceClient();

  // On first call, clear all existing style groups
  if (offset === 0) {
    // Clear style_group_id on all assets first
    await db.from("assets").update({ style_group_id: null }).gte("created_at", "1970-01-01");
    // Delete all style_groups
    await db.from("style_groups").delete().gte("created_at", "1970-01-01");
  }

  // Fetch batch of assets
  const { data: assets, error: fetchErr } = await db
    .from("assets")
    .select("id, relative_path, filename, file_type, created_at, modified_at, workflow_status, is_licensed, licensor_id, licensor_code, licensor_name, property_id, property_code, property_name, product_category, division_code, division_name, mg01_code, mg01_name, mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name")
    .eq("is_deleted", false)
    .order("id")
    .range(offset, offset + BATCH_SIZE - 1);

  if (fetchErr) return err(fetchErr.message, 500);
  if (!assets || assets.length === 0) {
    return json({ ok: true, groups_created: 0, assets_assigned: 0, assets_ungrouped: 0, done: true, nextOffset: offset });
  }

  // Group by SKU folder
  const skuMap = new Map<string, typeof assets>();
  let ungrouped = 0;

  for (const asset of assets) {
    const sku = extractSkuFolder(asset.relative_path);
    if (!sku) {
      ungrouped++;
      continue;
    }
    if (!skuMap.has(sku)) skuMap.set(sku, []);
    skuMap.get(sku)!.push(asset);
  }

  let groupsCreated = 0;
  let assetsAssigned = 0;

  for (const [sku, members] of skuMap) {
    // Prefer the member whose filename contains the SKU string itself,
    // as that's most likely the primary art file with complete metadata.
    const sku_upper = sku.toUpperCase();
    const first = members.find(m => 
      m.filename.toUpperCase().includes(sku_upper)
    ) ?? members[0];
    const folderPath = first.relative_path.split("/").slice(0, -1).join("/");

    // Upsert style group
    const { data: group, error: upsertErr } = await db
      .from("style_groups")
      .upsert({
        sku,
        folder_path: folderPath,
        is_licensed: first.is_licensed ?? false,
        licensor_id: (first as any).licensor_id ?? null,
        licensor_code: first.licensor_code,
        licensor_name: first.licensor_name,
        property_id: (first as any).property_id ?? null,
        property_code: first.property_code,
        property_name: first.property_name,
        product_category: first.product_category,
        division_code: first.division_code,
        division_name: first.division_name,
        mg01_code: first.mg01_code,
        mg01_name: first.mg01_name,
        mg02_code: first.mg02_code,
        mg02_name: first.mg02_name,
        mg03_code: first.mg03_code,
        mg03_name: first.mg03_name,
        size_code: first.size_code,
        size_name: first.size_name,
      }, { onConflict: "sku" })
      .select("id")
      .single();

    if (upsertErr || !group) continue;
    groupsCreated++;

    // Assign all member assets
    const memberIds = members.map((m) => m.id);
    await db.from("assets").update({ style_group_id: group.id }).in("id", memberIds);
    assetsAssigned += memberIds.length;

    // Set primary and count — need to query ALL assets for this group (might span batches)
    const { data: allGroupAssets } = await db
      .from("assets")
      .select("id, filename, file_type, created_at, modified_at, workflow_status, thumbnail_url, thumbnail_error")
      .eq("style_group_id", group.id)
      .eq("is_deleted", false);

    if (allGroupAssets && allGroupAssets.length > 0) {
      const primaryId = selectPrimaryAsset(allGroupAssets);
      const statusPriority = ["licensor_approved", "customer_adopted", "in_process", "in_development", "concept_approved", "freelancer_art", "product_ideas"];
      let bestStatus = "other";
      for (const s of statusPriority) {
        if (allGroupAssets.some((a: Record<string, unknown>) => a.workflow_status === s)) {
          bestStatus = s;
          break;
        }
      }
      const latestFileDate = allGroupAssets.reduce((max: string, a: any) => {
        const d = a.modified_at ?? a.created_at;
        return d > max ? d : max;
      }, "1970-01-01T00:00:00.000Z");

      await db.from("style_groups").update({
        asset_count: allGroupAssets.length,
        primary_asset_id: primaryId,
        workflow_status: bestStatus as any,
        latest_file_date: latestFileDate,
        updated_at: new Date().toISOString(),
      }).eq("id", group.id);
    }
  }

  const done = assets.length < BATCH_SIZE;
  return json({
    ok: true,
    groups_created: groupsCreated,
    assets_assigned: assetsAssigned,
    assets_ungrouped: ungrouped,
    done,
    nextOffset: done ? offset + assets.length : offset + BATCH_SIZE,
  });
}

// ── Main router ─────────────────────────────────────────────────────

// ── Route: run-query ─────────────────────────────────────────────────

async function handleRunQuery(body: Record<string, unknown>) {
  const sql = body.sql;
  if (typeof sql !== "string" || sql.trim() === "") {
    return err("Missing required field: sql");
  }

  const trimmed = sql.trim();
  if (!/^select\s/i.test(trimmed)) {
    return err("Only SELECT queries are allowed");
  }

  // Block dangerous keywords even within SELECT
  const forbidden = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute)\b/i;
  if (forbidden.test(trimmed)) {
    return err("Query contains forbidden keywords");
  }

  const db = serviceClient();
  const { data, error: queryErr } = await db.rpc("execute_readonly_query" as any, { query_text: trimmed });

  if (queryErr) {
    // Fallback: try raw SQL via postgrest
    // Use the REST API directly with the service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    try {
      const pgRes = await fetch(`${supabaseUrl}/rest/v1/rpc/execute_readonly_query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
        },
        body: JSON.stringify({ query_text: trimmed }),
      });

      if (!pgRes.ok) {
        const pgErr = await pgRes.text();
        return err(`Query failed: ${pgErr}`, 400);
      }

      const rows = await pgRes.json();
      return json({ ok: true, rows: rows ?? [], count: Array.isArray(rows) ? rows.length : 0 });
    } catch (e) {
      return err(`Query execution failed: ${(e as Error).message}`, 500);
    }
  }

  return json({ ok: true, rows: data ?? [], count: Array.isArray(data) ? data.length : 0 });
}

// ── Route: purge-old-assets ──────────────────────────────────────────

async function handlePurgeOldAssets(body: Record<string, unknown>) {
  const cutoffDate = typeof body.cutoff_date === "string" ? body.cutoff_date : null;
  if (!cutoffDate) return err("cutoff_date is required");

  const BATCH_SIZE = 200;
  const db = serviceClient();

  // Always query from 0 — deleted rows disappear from results
  const { data: oldAssets, error: fetchErr } = await db
    .from("assets")
    .select("id, style_group_id, modified_at")
    .eq("is_deleted", false)
    .lt("modified_at", cutoffDate)
    .order("id")
    .range(0, BATCH_SIZE - 1);

  if (fetchErr) return err(fetchErr.message, 500);
  if (!oldAssets || oldAssets.length === 0) {
    return json({
      ok: true,
      assets_purged: 0,
      groups_removed: 0,
      groups_updated: 0,
      done: true,
    });
  }

  const assetIds = oldAssets.map((a: any) => a.id);
  const affectedGroupIds = [...new Set(
    oldAssets.map((a: any) => a.style_group_id).filter(Boolean)
  )] as string[];

  const { error: deleteErr } = await db
    .from("assets")
    .update({ is_deleted: true })
    .in("id", assetIds);
  if (deleteErr) return err(deleteErr.message, 500);

  let groupsRemoved = 0;
  let groupsUpdated = 0;

  if (affectedGroupIds.length > 0) {
    // Batch query: fetch all remaining assets for affected groups at once
    const { data: allRemaining } = await db
      .from("assets")
      .select("id, style_group_id, filename, file_type, created_at, modified_at, workflow_status, thumbnail_url, thumbnail_error")
      .in("style_group_id", affectedGroupIds)
      .eq("is_deleted", false);

    // Group by style_group_id in memory
    const byGroup = new Map<string, typeof allRemaining>();
    for (const asset of allRemaining ?? []) {
      const gid = asset.style_group_id!;
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid)!.push(asset);
    }

    for (const groupId of affectedGroupIds) {
      const remaining = byGroup.get(groupId) ?? [];

      if (remaining.length === 0) {
        await db.from("style_groups").delete().eq("id", groupId);
        groupsRemoved++;
      } else {
        const primaryId = selectPrimaryAsset(remaining);
        const latestFileDate = remaining.reduce((max: string, a: any) => {
          const d = a.modified_at ?? a.created_at;
          return d > max ? d : max;
        }, "1970-01-01T00:00:00.000Z");

        const statusPriority = ["licensor_approved", "customer_adopted",
          "in_process", "in_development", "concept_approved",
          "freelancer_art", "product_ideas"];
        let bestStatus = "other";
        for (const s of statusPriority) {
          if (remaining.some((a: any) => a.workflow_status === s)) {
            bestStatus = s;
            break;
          }
        }

        await db.from("style_groups").update({
          asset_count: remaining.length,
          primary_asset_id: primaryId,
          workflow_status: bestStatus as any,
          latest_file_date: latestFileDate,
          updated_at: new Date().toISOString(),
        }).eq("id", groupId);
        groupsUpdated++;
      }
    }
  }

  const done = oldAssets.length < BATCH_SIZE;
  return json({
    ok: true,
    assets_purged: assetIds.length,
    groups_removed: groupsRemoved,
    groups_updated: groupsUpdated,
    done,
  });
}

// ── Route: bulk-ai-tag / bulk-ai-tag-all ────────────────────────────

async function handleBulkAiTag(body: Record<string, unknown>, tagAll: boolean) {
  const offset = typeof body.offset === "number" ? body.offset : 0;
  const BATCH_SIZE = 10;
  const db = serviceClient();

  let query = db
    .from("assets")
    .select("id, thumbnail_url")
    .eq("is_deleted", false)
    .not("thumbnail_url", "is", null);

  if (!tagAll) {
    query = query.neq("status", "tagged");
  }

  const { data: assets, error } = await query
    .order("id")
    .range(offset, offset + BATCH_SIZE - 1);

  if (error) return err(error.message, 500);
  if (!assets || assets.length === 0) {
    return json({ ok: true, tagged: 0, failed: 0, done: true, nextOffset: offset });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  let tagged = 0;
  let skipped = 0;
  let failed = 0;

  for (const asset of assets) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/ai-tag`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ asset_id: asset.id, force: tagAll }),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.skipped) skipped++;
        else tagged++;
      } else {
        failed++;
        console.error("bulk-ai-tag asset failed", {
          assetId: asset.id,
          httpStatus: res.status,
        });
      }
    } catch {
      failed++;
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  const done = assets.length < BATCH_SIZE;
  return json({ ok: true, tagged, skipped, failed, done, nextOffset: offset + assets.length });
}

// ── Route: count-untagged-assets ────────────────────────────────────

async function handleCountUntaggedAssets() {
  const db = serviceClient();

  const { count: untaggedCount } = await db
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("is_deleted", false)
    .not("thumbnail_url", "is", null)
    .neq("status", "tagged");

  const { count: totalWithThumb } = await db
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("is_deleted", false)
    .not("thumbnail_url", "is", null);

  return json({ ok: true, count: untaggedCount ?? 0, totalWithThumbnails: totalWithThumb ?? 0 });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return err("Method not allowed", 405);
  }

  const authResult = await authenticateAdmin(req);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const url = new URL(req.url);
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const route = pathSegments[pathSegments.length - 1] || "";
  const action = (body.action as string) || route;

  try {
    switch (action) {
      case "get-config":
        return await handleGetConfig(body);
      case "set-config":
        return await handleSetConfig(body, userId);
      case "invite-user":
        return await handleInviteUser(body, userId);
      case "list-invites":
        return await handleListInvites();
      case "revoke-invite":
        return await handleRevokeInvite(body);
      case "generate-agent-key":
        return await handleGenerateAgentKey(body, userId);
      case "list-agents":
        return await handleListAgents();
      case "revoke-agent":
        return await handleRevokeAgent(body);
      case "doctor":
        return await handleDoctor();
      case "trigger-scan":
        return await handleTriggerScan(body, userId);
      case "stop-scan":
        return await handleStopScan(body);
      case "resume-scanning":
        return await handleResumeScanning();
      case "reset-scan-state":
        return await handleResetScanState();
      case "get-filter-options":
        return await handleGetFilterOptions(body);
      case "render-queue-stats":
        return await handleRenderQueueStats();
      case "list-render-jobs":
        return await handleListRenderJobs(body);
      case "remove-agent-registration":
        return await handleRemoveAgentRegistration(body);
      case "requeue-render-job":
        return await handleRequeueRenderJob(body);
      case "clear-junk-render-jobs":
        return await handleClearJunkRenderJobs();
      case "clear-failed-renders":
        return await handleClearFailedRenders();
      case "send-test-render":
        return await handleSendTestRender();
      case "check-render-job":
        return await handleCheckRenderJob(body);
      case "retry-failed-jobs":
        return await handleRetryFailedJobs();
      case "clear-completed-jobs":
        return await handleClearCompletedJobs();
      case "generate-bootstrap-token":
        return await handleGenerateBootstrapToken(userId);
      case "trigger-agent-update":
        return await handleTriggerAgentUpdate(body, userId);
      case "get-update-status":
        return await handleGetUpdateStatus();
      case "reprocess-asset-metadata":
        return await handleReprocessAssetMetadata(body);
      case "run-query":
        return await handleRunQuery(body);
      case "rebuild-style-groups":
        return await handleRebuildStyleGroups(body);
      case "purge-old-assets":
        return await handlePurgeOldAssets(body);
      case "rebuild-character-stats":
        return await handleRebuildCharacterStats(body);
      case "bulk-ai-tag":
        return await handleBulkAiTag(body, false);
      case "bulk-ai-tag-all":
        return await handleBulkAiTag(body, true);
      case "count-untagged-assets":
        return await handleCountUntaggedAssets();
      default:
        return err(`Unknown action: ${action}`, 404);
    }
  } catch (e) {
    console.error("admin-api error:", e);
    return err(
      e instanceof Error ? e.message : "Internal server error",
      500,
    );
  }
});

// ── rebuild-character-stats ─────────────────────────────────────────

async function handleRebuildCharacterStats(body: Record<string, unknown>) {
  const threshold = typeof body.threshold === "number" ? body.threshold : 3;
  const db = serviceClient();

  // Fetch all asset_characters links, joining to exclude deleted assets
  const { data: counts, error } = await db
    .from("asset_characters")
    .select("character_id, assets!inner(is_deleted)")
    .eq("assets.is_deleted", false);

  if (error) return err(error.message, 500);

  // Tally counts in memory
  const tally = new Map<string, number>();
  for (const row of counts ?? []) {
    const cid = row.character_id;
    tally.set(cid, (tally.get(cid) ?? 0) + 1);
  }

  // Reset all characters first
  await db.from("characters").update({
    usage_count: 0,
    is_priority: false,
  }).gte("usage_count", 0);

  // Update each character that has usage
  let priorityCount = 0;
  const entries = [...tally.entries()];
  for (const [characterId, count] of entries) {
    const isPriority = count >= threshold;
    if (isPriority) priorityCount++;
    await db.from("characters").update({
      usage_count: count,
      is_priority: isPriority,
    }).eq("id", characterId);
  }

  return json({
    ok: true,
    total_characters_with_assets: tally.size,
    priority_characters: priorityCount,
    threshold,
    message: `${priorityCount} priority characters (appearing in ${threshold}+ assets) out of ${tally.size} characters with any asset links`,
  });
}