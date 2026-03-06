/**
 * Agent & scan management handlers extracted from admin-api/index.ts.
 *
 * Covers: generate-agent-key, list-agents, revoke-agent, doctor,
 * trigger-scan, stop-scan, resume-scanning, reset-scan-state,
 * render queue ops, pairing codes, bootstrap tokens, agent updates.
 */

import { err, formatPostgrestError, json, optionalString, requireString, serviceClient } from "../admin-utils.ts";

// ── generate-agent-key ──────────────────────────────────────────────

export async function handleGenerateAgentKey(
  body: Record<string, unknown>,
  userId: string,
) {
  const agentName = requireString(body, "agent_name");
  const agentType = optionalString(body, "agent_type") ?? "bridge";

  if (!["bridge", "windows-render"].includes(agentType)) {
    return err("agent_type must be 'bridge' or 'windows-render'");
  }

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const rawKey = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawKey));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const db = serviceClient();
  const { data, error } = await db
    .from("agent_registrations")
    .insert({ agent_name: agentName, agent_type: agentType, agent_key_hash: hashHex })
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

// ── list-agents ─────────────────────────────────────────────────────

export async function handleListAgents() {
  const db = serviceClient();
  const { data, error } = await db
    .from("agent_registrations")
    .select("id, agent_name, agent_type, last_heartbeat, metadata, created_at, agent_key_hash")
    .order("created_at", { ascending: false });

  if (error) return err(error.message, 500);

  const now = Date.now();
  const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000;

  const agents = (data || []).map((a) => {
    const lastHb = a.last_heartbeat ? new Date(a.last_heartbeat).getTime() : 0;
    const metadata = (a.metadata as Record<string, unknown>) || {};
    return {
      id: a.id,
      name: a.agent_name,
      type: a.agent_type,
      status: lastHb > 0 && now - lastHb < OFFLINE_THRESHOLD_MS ? "online" : "offline",
      last_heartbeat: a.last_heartbeat,
      last_counters: metadata.last_counters || null,
      last_error: metadata.last_error || null,
      heartbeat_history: metadata.heartbeat_history || [],
      version_info: metadata.version_info || null,
      metadata,
      key_preview: a.agent_key_hash ? `${a.agent_key_hash.substring(0, 8)}...` : null,
      created_at: a.created_at,
      force_stop: metadata.force_stop === true,
      scan_abort: metadata.scan_abort === true,
    };
  });

  return json({ ok: true, agents });
}

// ── revoke-agent ────────────────────────────────────────────────────

export async function handleRevokeAgent(body: Record<string, unknown>) {
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

// ── remove-agent-registration ───────────────────────────────────────

export async function handleRemoveAgentRegistration(body: Record<string, unknown>) {
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

// ── trigger-scan ────────────────────────────────────────────────────

export async function handleTriggerScan(
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

// ── stop-scan ───────────────────────────────────────────────────────

export async function handleStopScan(_body: Record<string, unknown>) {
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
        metadata: { ...metadata, scan_requested: false, scan_abort: true, force_stop: true },
      })
      .eq("id", a.id);
    if (updateErr) return err(updateErr.message, 500);
  }

  // Force progress out of stale "running" state
  const { data: progressRow, error: progressFetchErr } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "SCAN_PROGRESS")
    .maybeSingle();
  if (progressFetchErr) return err(progressFetchErr.message, 500);

  const progressVal = (progressRow?.value as Record<string, unknown>) || {};
  const counters = typeof progressVal.counters === "object" && progressVal.counters !== null ? progressVal.counters : {};

  const { error: progressErr } = await db.from("admin_config").upsert({
    key: "SCAN_PROGRESS",
    value: {
      ...(typeof progressVal.session_id === "string" ? { session_id: progressVal.session_id } : {}),
      status: "failed",
      counters,
      current_path: typeof progressVal.current_path === "string" ? progressVal.current_path : null,
      updated_at: now,
    },
    updated_at: now,
  });
  if (progressErr) return err(progressErr.message, 500);

  // Cancel any pending/claimed request
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

// ── resume-scanning ─────────────────────────────────────────────────

export async function handleResumeScanning() {
  const db = serviceClient();
  const { data: agents } = await db
    .from("agent_registrations")
    .select("id, metadata");

  for (const a of agents || []) {
    const metadata = (a.metadata as Record<string, unknown>) || {};
    await db
      .from("agent_registrations")
      .update({ metadata: { ...metadata, scan_abort: false, force_stop: false } })
      .eq("id", a.id);
  }

  return json({ ok: true });
}

// ── reset-scan-state ────────────────────────────────────────────────

export async function handleResetScanState() {
  const db = serviceClient();
  const now = new Date().toISOString();

  const { error: progressErr } = await db.from("admin_config").upsert({
    key: "SCAN_PROGRESS",
    value: { status: "idle", updated_at: now },
    updated_at: now,
  });
  if (progressErr) return err(progressErr.message, 500);

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

  const { error: checkpointErr } = await db
    .from("admin_config")
    .delete()
    .eq("key", "SCAN_CHECKPOINT");
  if (checkpointErr) return err(checkpointErr.message, 500);

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
          metadata: { ...metadata, scan_abort: false, scan_requested: false, force_stop: false },
        })
        .eq("id", a.id);
      if (updateErr) return err(updateErr.message, 500);
    }
  }

  return json({ ok: true });
}

// ── render-queue-stats ──────────────────────────────────────────────

export async function handleRenderQueueStats() {
  const db = serviceClient();
  const { count, error } = await db
    .from("render_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) return err(error.message, 500);
  return json({ ok: true, pending_count: count ?? 0 });
}

// ── list-render-jobs ────────────────────────────────────────────────

export async function handleListRenderJobs(body: Record<string, unknown>) {
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

// ── clear-failed-renders ────────────────────────────────────────────

export async function handleClearFailedRenders() {
  const db = serviceClient();
  const { data, error } = await db
    .from("render_queue")
    .delete()
    .eq("status", "failed")
    .select("id");

  if (error) return err(error.message, 500);
  return json({ ok: true, deleted_count: data?.length ?? 0 });
}

// ── send-test-render ────────────────────────────────────────────────

export async function handleSendTestRender() {
  const db = serviceClient();

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
  await db.from("render_queue").delete().eq("asset_id", assetId).in("status", ["pending", "claimed"]);

  const { data: job, error: jErr } = await db
    .from("render_queue")
    .insert({ asset_id: assetId, status: "pending" })
    .select("id")
    .single();

  if (jErr) return err(jErr.message, 500);
  return json({ ok: true, job_id: job.id, asset_id: assetId });
}

// ── check-render-job ────────────────────────────────────────────────

export async function handleCheckRenderJob(body: Record<string, unknown>) {
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
    const { data: asset } = await db.from("assets").select("thumbnail_url").eq("id", data.asset_id).single();
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

// ── retry-failed-jobs ───────────────────────────────────────────────

export async function handleRetryFailedJobs() {
  const db = serviceClient();
  const { data, error } = await db
    .from("processing_queue")
    .update({ status: "pending", error_message: null, agent_id: null, claimed_at: null })
    .eq("status", "failed")
    .select("id");

  if (error) return err(error.message, 500);
  return json({ ok: true, retried_count: data?.length ?? 0 });
}

// ── clear-completed-jobs ────────────────────────────────────────────

export async function handleClearCompletedJobs() {
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

// ── clear-junk-render-jobs ──────────────────────────────────────────

export async function handleClearJunkRenderJobs() {
  const db = serviceClient();
  const JUNK_FILENAMES = new Set([".DS_Store", ".localized", "Thumbs.db", "desktop.ini"]);

  const { data: jobs, error: fetchErr } = await db
    .from("render_queue")
    .select("id, asset_id")
    .eq("status", "pending");

  if (fetchErr) return err(fetchErr.message, 500);
  if (!jobs || jobs.length === 0) return json({ ok: true, cleared: 0 });

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
      return fn.startsWith("._") || fn.startsWith("~") || JUNK_FILENAMES.has(fn) || rp.includes("__MACOSX");
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

// ── requeue-render-job ──────────────────────────────────────────────

export async function handleRequeueRenderJob(body: Record<string, unknown>) {
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

// ── create-pairing-code ─────────────────────────────────────────────

export async function handleCreatePairingCode(
  body: Record<string, unknown>,
  userId: string,
) {
  const agentType = requireString(body, "agent_type");
  if (!["bridge", "windows-render"].includes(agentType)) {
    return err("agent_type must be 'bridge' or 'windows-render'");
  }
  const agentName = optionalString(body, "agent_name") || (agentType === "bridge" ? "bridge-agent" : "windows-render-agent");

  const db = serviceClient();

  const { data: existing } = await db
    .from("agent_pairings")
    .select("id, pairing_code, expires_at")
    .eq("agent_type", agentType)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return json({ ok: true, pairing_code: existing.pairing_code, expires_at: existing.expires_at, reused: true });
  }

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let raw = "";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 16; i++) {
    raw += chars[bytes[i] % chars.length];
  }
  const pairingCode = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

  const { error } = await db.from("agent_pairings").insert({
    pairing_code: pairingCode,
    agent_type: agentType,
    agent_name: agentName,
    status: "pending",
    created_by: userId,
    expires_at: expiresAt.toISOString(),
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, pairing_code: pairingCode, expires_at: expiresAt.toISOString(), reused: false });
}

// ── list-pairing-codes ──────────────────────────────────────────────

export async function handleListPairingCodes() {
  const db = serviceClient();
  const { data, error } = await db
    .from("agent_pairings")
    .select("id, pairing_code, agent_type, agent_name, status, created_at, expires_at, consumed_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return err(error.message, 500);
  return json({ ok: true, pairings: data });
}

// ── generate-bootstrap-token (legacy) ───────────────────────────────

export async function handleGenerateBootstrapToken(userId: string) {
  const db = serviceClient();

  const { data: existing } = await db
    .from("agent_pairings")
    .select("pairing_code, expires_at")
    .eq("agent_type", "windows-render")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return json({ ok: true, token: existing.pairing_code, expires_at: existing.expires_at });
  }

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let raw = "";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 16; i++) {
    raw += chars[bytes[i] % chars.length];
  }
  const pairingCode = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

  const { error } = await db.from("agent_pairings").insert({
    pairing_code: pairingCode,
    agent_type: "windows-render",
    agent_name: "windows-render-agent",
    status: "pending",
    created_by: userId,
    expires_at: expiresAt.toISOString(),
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, token: pairingCode, expires_at: expiresAt.toISOString() });
}

// ── trigger-agent-update ────────────────────────────────────────────

export async function handleTriggerAgentUpdate(
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

  const { data: windowsAgents } = await db
    .from("agent_registrations")
    .select("id, metadata")
    .eq("agent_type", "windows-render");

  if (windowsAgents && windowsAgents.length > 0) {
    for (const agent of windowsAgents) {
      const meta = (agent.metadata as Record<string, unknown>) || {};
      await db
        .from("agent_registrations")
        .update({
          metadata: {
            ...meta,
            trigger_update: true,
            update_requested_by: userId,
            update_requested_at: new Date().toISOString(),
          },
        })
        .eq("id", agent.id);
    }
  }

  return json({ ok: true, request_id: requestId });
}

// ── get-update-status ───────────────────────────────────────────────

export async function handleGetUpdateStatus() {
  const db = serviceClient();
  const { data, error } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "AGENT_UPDATE_STATUS")
    .maybeSingle();

  if (error) return err(error.message, 500);
  return json({ ok: true, status: data?.value ?? null });
}

// ── retry-failed-renders ────────────────────────────────────────────

export async function handleRetryFailedRenders() {
  const db = serviceClient();
  // First get failed jobs that DON'T already have an active (pending/claimed) sibling
  const { data: failedJobs } = await db
    .from("render_queue")
    .select("id, asset_id")
    .eq("status", "failed");

  if (!failedJobs || failedJobs.length === 0) {
    return json({ ok: true, requeued_count: 0 });
  }

  // Find which assets already have an active job
  const assetIds = failedJobs.map((j) => j.asset_id);
  const { data: activeJobs } = await db
    .from("render_queue")
    .select("asset_id")
    .in("asset_id", assetIds)
    .in("status", ["pending", "claimed"]);

  const activeAssetIds = new Set((activeJobs ?? []).map((j) => j.asset_id));
  const safeToRetry = failedJobs.filter((j) => !activeAssetIds.has(j.asset_id)).map((j) => j.id);

  if (safeToRetry.length === 0) {
    // Just delete the duplicates
    await db.from("render_queue").delete().eq("status", "failed").in("asset_id", [...activeAssetIds]);
    return json({ ok: true, requeued_count: 0, skipped_duplicates: activeAssetIds.size });
  }

  const { data, error } = await db
    .from("render_queue")
    .update({ status: "pending", claimed_by: null, claimed_at: null, error_message: null })
    .in("id", safeToRetry)
    .select("id");

  if (error) return err(error.message, 500);
  return json({ ok: true, requeued_count: data?.length ?? 0 });
}

// ── requeue-all-no-preview ──────────────────────────────────────────

export async function handleRequeueAllNoPreview() {
  const db = serviceClient();

  // Paginate to fetch ALL assets with no thumbnail (bypass 1000-row default limit)
  const PAGE = 1000;
  const allAssetIds: string[] = [];
  let from = 0;
  while (true) {
    const { data: page, error: fetchErr } = await db
      .from("assets")
      .select("id")
      .is("thumbnail_url", null)
      .eq("is_deleted", false)
      .not("thumbnail_error", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);

    if (fetchErr) return err(fetchErr.message, 500);
    if (!page || page.length === 0) break;
    for (const a of page) allAssetIds.push(a.id);
    if (page.length < PAGE) break;
    from += PAGE;
  }

  if (allAssetIds.length === 0) {
    return json({ ok: true, queued: 0, skipped: 0 });
  }

  // Batch in chunks of 500 to avoid query limits
  const CHUNK = 500;
  const activeSet = new Set<string>();
  for (let i = 0; i < allAssetIds.length; i += CHUNK) {
    const chunk = allAssetIds.slice(i, i + CHUNK);
    const { data: active } = await db
      .from("render_queue")
      .select("asset_id")
      .in("asset_id", chunk)
      .in("status", ["pending", "claimed"]);
    (active ?? []).forEach((j) => activeSet.add(j.asset_id));
  }

  const toQueue = allAssetIds.filter((id) => !activeSet.has(id));
  if (toQueue.length === 0) {
    return json({ ok: true, queued: 0, skipped: allAssetIds.length });
  }

  // Clear old failed jobs for these assets first
  for (let i = 0; i < toQueue.length; i += CHUNK) {
    const chunk = toQueue.slice(i, i + CHUNK);
    await db.from("render_queue").delete().in("asset_id", chunk).eq("status", "failed");
  }

  let queued = 0;
  for (let i = 0; i < toQueue.length; i += CHUNK) {
    const chunk = toQueue.slice(i, i + CHUNK);
    const rows = chunk.map((id) => ({ asset_id: id, status: "pending" as const }));
    const { data: inserted } = await db
      .from("render_queue")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
      .select("id");
    queued += inserted?.length ?? chunk.length;
  }

  // Clear thumbnail_error so they show as "renderable" until re-attempted
  for (let i = 0; i < toQueue.length; i += CHUNK) {
    const chunk = toQueue.slice(i, i + CHUNK);
    await db.from("assets").update({ thumbnail_error: null }).in("id", chunk);
  }

  return json({ ok: true, queued, skipped: activeSet.size });
}

// ── request-path-test ───────────────────────────────────────────────

export async function handleRequestPathTest(userId: string) {
  const db = serviceClient();
  const requestId = crypto.randomUUID();

  const { error } = await db.from("admin_config").upsert({
    key: "PATH_TEST_REQUEST",
    value: {
      request_id: requestId,
      status: "pending",
      requested_at: new Date().toISOString(),
      requested_by: userId,
    },
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, request_id: requestId });
}

// ── doctor ──────────────────────────────────────────────────────────

export async function handleDoctor() {
  const db = serviceClient();
  const issues: Array<{
    severity: "critical" | "warn" | "info";
    code: string;
    title: string;
    details: string;
    recommended_fix: string;
    fix_action?: string;
    fix_payload?: Record<string, unknown>;
  }> = [];

  // ── Gather counts ──
  const [
    { count: totalAssets },
    { count: pendingAssets },
    { count: errorAssets },
    { count: pendingJobs },
    { count: pendingRenders },
  ] = await Promise.all([
    db.from("assets").select("id", { count: "exact", head: true }).eq("is_deleted", false),
    db.from("assets").select("id", { count: "exact", head: true }).eq("is_deleted", false).eq("status", "pending"),
    db.from("assets").select("id", { count: "exact", head: true }).eq("is_deleted", false).eq("status", "error"),
    db.from("processing_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("render_queue").select("id", { count: "exact", head: true }).in("status", ["pending", "claimed"]),
  ]);

  const counts = {
    total_assets: totalAssets ?? 0,
    pending_assets: pendingAssets ?? 0,
    error_assets: errorAssets ?? 0,
    pending_jobs: pendingJobs ?? 0,
    pending_renders: pendingRenders ?? 0,
  };

  // ── Agents ──
  const { data: rawAgents, error: agentErr } = await db
    .from("agent_registrations")
    .select("id, agent_name, agent_type, last_heartbeat, metadata, created_at");

  if (agentErr) {
    issues.push({
      severity: "critical",
      code: "AGENT_QUERY_FAILED",
      title: "Cannot query agents",
      details: agentErr.message,
      recommended_fix: "Check database connectivity",
    });
  } else if (!rawAgents || rawAgents.length === 0) {
    issues.push({
      severity: "critical",
      code: "NO_AGENTS",
      title: "No agents registered",
      details: "No bridge or render agents are registered. Assets cannot be scanned or thumbnailed.",
      recommended_fix: "Register a bridge agent via Settings → Install Bundle",
      fix_action: "create-pairing-code",
      fix_payload: { agent_type: "bridge" },
    });
  } else {
    const now = Date.now();
    for (const agent of rawAgents) {
      if (!agent.last_heartbeat) continue;
      const lastBeat = new Date(agent.last_heartbeat).getTime();
      const minutesAgo = (now - lastBeat) / 60000;
      if (minutesAgo > 10) {
        issues.push({
          severity: minutesAgo > 60 ? "critical" : "warn",
          code: "AGENT_STALE",
          title: `Agent "${agent.agent_name}" is unresponsive`,
          details: `Last heartbeat was ${Math.round(minutesAgo)} minutes ago.`,
          recommended_fix: "Check that the agent container/service is running",
        });
      }
    }
  }

  // Map agents to the shape the UI expects
  const agents = (rawAgents ?? []).map((a: any) => {
    const meta = (a.metadata ?? {}) as Record<string, any>;
    const diag = meta.diagnostics ?? {};
    const now = Date.now();
    const lastBeat = a.last_heartbeat ? new Date(a.last_heartbeat).getTime() : 0;
    const minutesAgo = lastBeat ? (now - lastBeat) / 60000 : Infinity;
    let status = "unknown";
    if (minutesAgo < 5) status = "online";
    else if (minutesAgo < 30) status = "stale";
    else status = "offline";

    return {
      id: a.id,
      name: a.agent_name,
      type: a.agent_type,
      status,
      last_heartbeat: a.last_heartbeat,
      last_counters: meta.last_counters ?? null,
      last_error: meta.last_error ?? null,
      scan_roots: diag.scan_roots ?? [],
      created_at: a.created_at,
    };
  });

  // ── Scan progress ──
  const { data: scanRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "SCAN_PROGRESS")
    .maybeSingle();
  const scanProgress = scanRow?.value
    ? (typeof scanRow.value === "object" && scanRow.value !== null && "value" in (scanRow.value as any)
        ? (scanRow.value as any).value
        : scanRow.value)
    : null;

  // ── Recent errors ──
  const { data: recentErrors } = await db
    .from("processing_queue")
    .select("id, asset_id, job_type, error_message, completed_at")
    .eq("status", "failed")
    .order("completed_at", { ascending: false })
    .limit(20);

  // ── Config (non-sensitive) ──
  const { data: configRows } = await db.from("admin_config").select("key, value, updated_at");
  const config: Record<string, unknown> = {};
  for (const row of configRows ?? []) {
    config[row.key] = row.value;
  }

  // ── Additional issue checks ──
  const { count: staleJobs } = await db
    .from("render_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "claimed")
    .lt("claimed_at", new Date(Date.now() - 30 * 60000).toISOString());

  if (staleJobs && staleJobs > 0) {
    issues.push({
      severity: "warn",
      code: "STALE_RENDER_JOBS",
      title: `${staleJobs} stale render job${staleJobs > 1 ? "s" : ""}`,
      details: "Render jobs claimed more than 30 minutes ago may be stuck.",
      recommended_fix: "Reset stale jobs so they can be re-claimed",
      fix_action: "retry-failed-jobs",
    });
  }

  const { count: failedRenders } = await db
    .from("render_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed");

  if (failedRenders && failedRenders > 0) {
    issues.push({
      severity: "warn",
      code: "FAILED_RENDERS",
      title: `${failedRenders} failed render job${failedRenders > 1 ? "s" : ""}`,
      details: "These assets could not be thumbnailed. Review errors or retry.",
      recommended_fix: "Retry failed renders or clear them",
      fix_action: "retry-failed-renders",
    });
  }

  const { count: pendingThumbs } = await db
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("is_deleted", false)
    .is("thumbnail_url", null)
    .is("thumbnail_error", null);

  if (pendingThumbs && pendingThumbs > 50) {
    issues.push({
      severity: "info",
      code: "PENDING_THUMBNAILS",
      title: `${pendingThumbs} assets awaiting thumbnails`,
      details: "These assets have not been thumbnailed yet.",
      recommended_fix: "Ensure an agent is running and processing render jobs",
    });
  }

  if (issues.length === 0) {
    issues.push({
      severity: "info",
      code: "ALL_CLEAR",
      title: "All systems healthy",
      details: "No issues detected.",
      recommended_fix: "",
    });
  }

  return json({
    ok: true,
    issues,
    diagnostic: {
      timestamp: new Date().toISOString(),
      counts,
      agents,
      scan_progress: scanProgress,
      recent_errors: recentErrors ?? [],
      config,
    },
  });
}

// ── get-filter-options ──────────────────────────────────────────────

export async function handleGetFilterOptions(body: Record<string, unknown>) {
  const db = serviceClient();
  const licensorId = typeof body.licensor_id === "string" ? body.licensor_id : null;

  // Fetch licensors with asset counts
  const { data: licensors, error: licErr } = await db
    .from("licensors")
    .select("id, name");

  if (licErr) return err(licErr.message, 500);

  // Count assets per licensor
  const licensorResults: Array<{ id: string; name: string; asset_count: number }> = [];
  for (const lic of licensors ?? []) {
    const { count } = await db
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("licensor_id", lic.id)
      .eq("is_deleted", false);
    licensorResults.push({ id: lic.id, name: lic.name, asset_count: count ?? 0 });
  }

  // Fetch properties (optionally filtered by licensor)
  let propQuery = db.from("properties").select("id, name, licensor_id");
  if (licensorId) {
    propQuery = propQuery.eq("licensor_id", licensorId);
  }
  const { data: properties, error: propErr } = await propQuery;
  if (propErr) return err(propErr.message, 500);

  const propertyResults: Array<{ id: string; name: string; licensor_id: string; asset_count: number }> = [];
  for (const prop of properties ?? []) {
    const { count } = await db
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("property_id", prop.id)
      .eq("is_deleted", false);
    propertyResults.push({ id: prop.id, name: prop.name, licensor_id: prop.licensor_id, asset_count: count ?? 0 });
  }

  return json({
    ok: true,
    licensors: licensorResults.filter((l) => l.asset_count > 0),
    properties: propertyResults.filter((p) => p.asset_count > 0),
  });
}
