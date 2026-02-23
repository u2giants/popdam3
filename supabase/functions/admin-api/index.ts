import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
          scan_requested: false,
          scan_abort: true,
          force_stop: true,
        },
      })
      .eq("id", a.id);
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

  // 1. Set SCAN_PROGRESS to idle
  await db.from("admin_config").upsert({
    key: "SCAN_PROGRESS",
    value: { status: "idle" },
    updated_at: new Date().toISOString(),
  });

  // 2. Cancel any pending/claimed SCAN_REQUEST
  const { data: reqRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "SCAN_REQUEST")
    .maybeSingle();

  if (reqRow) {
    const reqVal = (reqRow.value as Record<string, unknown>) || {};
    if (reqVal.status === "pending" || reqVal.status === "claimed") {
      await db.from("admin_config").update({
        value: { ...reqVal, status: "canceled" },
        updated_at: new Date().toISOString(),
      }).eq("key", "SCAN_REQUEST");
    }
  }

  // 3. Clear legacy flags in agent_registrations metadata
  const { data: agents } = await db
    .from("agent_registrations")
    .select("id, metadata");

  for (const a of agents || []) {
    const metadata = (a.metadata as Record<string, unknown>) || {};
    if (metadata.scan_abort || metadata.scan_requested || metadata.force_stop) {
      await db
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

// ── Main router ─────────────────────────────────────────────────────

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