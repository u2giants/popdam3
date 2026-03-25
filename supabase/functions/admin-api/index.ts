import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, err, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/service-client.ts";
import { optionalString, requireString } from "../_shared/validators.ts";

// ── Extracted handler modules ───────────────────────────────────────
import {
  handleCheckRenderJob,
  handleClearCompletedJobs,
  handleClearFailedRenders,
  handleClearJunkRenderJobs,
  handleCreatePairingCode,
  handleDoctor,
  handleGenerateAgentKey,
  handleGenerateBootstrapToken,
  handleGetFilterOptions,
  handleGetUpdateStatus,
  handleListAgents,
  handleListPairingCodes,
  handleListRenderJobs,
  handleRemoveAgentRegistration,
  handleRenderQueueStats,
  handleRequestPathTest,
  handleRequeueAllNoPreview,
  handleRequeueRenderJob,
  handleResetScanState,
  handleResumeScanning,
  handleRetryFailedJobs,
  handleRetryFailedRenders,
  handleRevokeAgent,
  handleSendTestRender,
  handleStopScan,
  handleTriggerAgentUpdate,
  handleTriggerScan,
} from "../_shared/admin-handlers/agent-handlers.ts";

import { handleRebuildStyleGroups, handleReconcileStyleGroupStats } from "../_shared/admin-handlers/style-group-handlers.ts";

import { handleBulkAiTag, handleCountUntaggedAssets } from "../_shared/admin-handlers/ai-tagging-handlers.ts";

import { handleBulkPropagateGroupTags, handleCountGroupsForPropagation } from "../_shared/admin-handlers/tag-propagation-handlers.ts";

import { handleApplyErpEnrichment, handleClassifyErpCategories } from "../_shared/admin-handlers/erp-handlers.ts";

import { handleBackfillSkuNames, handleReprocessAssetMetadata } from "../_shared/admin-handlers/metadata-handlers.ts";

import { handlePurgeExcludedSubfolderAssets, handlePurgeOldAssets } from "../_shared/admin-handlers/purge-handlers.ts";

import {
  handleErpEnrichmentStats,
  handleErpItemsBrowse,
  handleErpItemsDismiss,
  handleErpReviewAction,
  handleErpReviewQueue,
  handleErpSyncRuns,
  handleTriggerErpSync,
} from "../_shared/admin-handlers/erp-browse-handlers.ts";

import { handleGenerateInstallBundle } from "../_shared/admin-handlers/install-bundle-handler.ts";

import {
  handleClearTiffScan,
  handleDeleteTiffOriginals,
  handleListTiffFiles,
  handleQueueTiffJobs,
  handleRefreshTiffDates,
  handleTriggerTiffScan,
} from "../_shared/admin-handlers/tiff-handlers.ts";

import {
  handleGetSiblingScanByFolder,
  handleGetSiblingScanResult,
  handleIngestSiblingImages,
  handleListSiblingImages,
} from "../_shared/admin-handlers/sibling-scan-handlers.ts";

import { handleDebugColdlionLookup, handleRepairInvalidPropertyNames } from "../_shared/admin-handlers/coldlion-handlers.ts";

import {
  handleListHygieneFindings,
  handleStopHygieneScan,
  handleTriggerHygieneScan,
  handleUpdateHygieneFindings,
} from "../_shared/admin-handlers/hygiene-handlers.ts";

// ── Auth: JWT validation only (any authenticated user) ──────────────

async function authenticateUser(
  req: Request,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return err("Missing or invalid Authorization header", 401);
  }

  const token = authHeader.replace("Bearer ", "");

  // Service role key bypass — allows server-to-server calls (e.g., Railway worker)
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey && token === serviceRoleKey) {
    return { userId: "system" };
  }

  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  try {
    let sub: string | undefined;
    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !user?.id) {
      if (typeof anonClient.auth.getClaims === "function") {
        const { data, error: claimsError } = await anonClient.auth.getClaims(token);
        if (!claimsError && data?.claims?.sub) {
          sub = data.claims.sub as string;
        }
      }
      if (!sub) {
        console.error("Auth failed — getUser:", userError);
        return err("Invalid or expired token", 401);
      }
    } else {
      sub = user.id;
    }
    console.log("Authenticated userId:", sub);
    return { userId: sub };
  } catch (e) {
    console.error("Token validation error:", e);
    return err("Invalid or expired token", 401);
  }
}

// ── Auth: JWT validation + admin role check ─────────────────────────

async function authenticateAdmin(
  req: Request,
): Promise<{ userId: string } | Response> {
  const authResult = await authenticateUser(req);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  // Check admin role using service client (bypasses RLS)
  const db = serviceClient();
  let roleRow: { role: string } | null = null;
  let roleError: unknown = null;

  try {
    const result = await withRetry(async () => {
      const queryResult = await db
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      if (queryResult.error) throw queryResult.error;
      return queryResult;
    });
    roleRow = result.data as { role: string } | null;
  } catch (e) {
    roleError = e;
  }

  console.log("Role check for userId:", userId, "result:", JSON.stringify(roleRow), "error:", roleError);

  if (!roleRow) {
    return err("Forbidden: admin role required", 403);
  }

  return { userId };
}

// ── Actions accessible to any authenticated user (not admin-only) ────

const USER_ACCESSIBLE_ACTIONS = new Set([
  "list-sibling-images",
  "get-sibling-scan-result",
  "get-sibling-scan-by-folder",
  "ingest-sibling-images",
  "sync-group-tags",
]);

// ── Retry helper for transient connection / body-read errors ────────

const TRANSIENT_ERROR_PATTERNS = [
  "connection reset",
  "connection error",
  "sendrequest",
  "error reading a body",
  "error reading body",
  "error reading a body from connection",
  "network error",
  "fetch failed",
  "broken pipe",
  "eof",
];

function isTransientError(e: unknown): boolean {
  const msg = ((e as Error)?.message || "").toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((p) => msg.includes(p));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 200,
  label = "",
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransientError(e) || attempt === maxAttempts) throw e;
      const msg = ((e as Error)?.message || "").toLowerCase();
      console.warn(
        `withRetry [${label || "?"}] transient error (attempt ${attempt}/${maxAttempts}): ${msg.slice(0, 120)}`,
      );
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  throw new Error("withRetry: unreachable");
}

function formatPostgrestError(error: unknown): string {
  const normalizeMessage = (message: string) => {
    const msg = (message || "").trim();
    if (!msg) return "Unknown database error";
    const lower = msg.toLowerCase();
    const looksHtml = lower.includes("<html") || lower.includes("<!doctype") || lower.includes("<head>");
    if (looksHtml) {
      return "Upstream gateway returned an HTML 500 page (transient infrastructure error). Please retry.";
    }
    return msg;
  };

  if (!error) return "Unknown database error";
  if (typeof error === "string") return normalizeMessage(error);
  if (error instanceof Error) return normalizeMessage(error.message);

  const e = error as Record<string, unknown>;
  const message = normalizeMessage(typeof e.message === "string" ? e.message : "Database error");
  const details = typeof e.details === "string" ? e.details : "";
  const hint = typeof e.hint === "string" ? e.hint : "";
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.status === "number" ? String(e.status) : "";
  const raw = (() => {
    try {
      const serialized = JSON.stringify(e);
      return serialized && serialized !== "{}" ? serialized : "";
    } catch {
      return "";
    }
  })();

  return [
    status ? `[status=${status}]` : "",
    code ? `[${code}]` : "",
    message,
    details ? `details: ${details}` : "",
    hint ? `hint: ${hint}` : "",
    raw && message === "Bad Request" ? `raw: ${raw}` : "",
  ].filter(Boolean).join(" | ");
}

// ── Route: get-config ───────────────────────────────────────────────

async function handleGetConfig(body: Record<string, unknown>) {
  const keys = body.keys;
  const db = serviceClient();

  const { data, error } = await withRetry(async () => {
    let query = db.from("admin_config").select("key, value, updated_at");
    if (Array.isArray(keys) && keys.length > 0) {
      query = query.in("key", keys as string[]);
    }
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    return result;
  });

  if (error) return err((error as Error).message, 500);

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
  const rawEntries = body.entries;
  const legacyKey = typeof body.key === "string" ? body.key.trim() : "";

  const entries = rawEntries && typeof rawEntries === "object" && !Array.isArray(rawEntries)
    ? rawEntries as Record<string, unknown>
    : legacyKey
    ? { [legacyKey]: body.value }
    : null;

  if (!entries) {
    return err("entries must be an object of { key: value } pairs", 400);
  }

  const db = serviceClient();
  const now = new Date().toISOString();
  const upserts = Object.entries(entries).map(
    ([key, value]) => ({
      key,
      value,
      updated_at: now,
      updated_by: userId,
    }),
  );

  // Parallel upserts — independent config keys don't conflict
  const results = await Promise.all(
    upserts.map((row) => db.from("admin_config").upsert(row)),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return err(`Failed to set config: ${failed.error.message}`, 500);

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

  // Send invite email via Brevo API
  const { sendBrevoEmail, buildInviteHtml } = await import("../_shared/brevo.ts");
  const appUrl = Deno.env.get("SUPABASE_URL")?.replace(".supabase.co", "") ? "https://popdam.lovable.app" : "https://popdam.lovable.app";
  const signUpUrl = `${appUrl}/login?signup=true`;
  const htmlContent = buildInviteHtml(signUpUrl, roleStr);

  const emailResult = await sendBrevoEmail({
    to: email,
    subject: "You've been invited to PopDAM",
    htmlContent,
  });

  if (!emailResult.ok) {
    // Roll back the invitation row so the admin can retry
    await db.from("invitations").delete().eq("id", data.id);
    return err(`Failed to send invitation email: ${emailResult.error}`, 500);
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
    .select("email, accepted_at")
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

  // Also delete the pending auth user so they can't sign in with the invite link
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: profile } = await db
    .from("profiles")
    .select("user_id")
    .eq("email", invite.email)
    .maybeSingle();
  if (profile?.user_id) {
    await adminClient.auth.admin.deleteUser(profile.user_id).catch(() => {});
  }

  return json({ ok: true });
}

// ── Route: run-query ─────────────────────────────────────────────────

async function handleRunQuery(body: Record<string, unknown>) {
  const sql = body.sql;
  if (typeof sql !== "string" || sql.trim() === "") {
    return err("Missing required field: sql");
  }

  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (!/^(select|with)\s/i.test(trimmed)) {
    return err("Only SELECT queries are allowed");
  }

  const forbidden = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute)\b/i;
  if (forbidden.test(trimmed)) {
    return err("Query contains forbidden keywords");
  }

  const db = serviceClient();

  try {
    const { data, error: queryErr } = await db.rpc("execute_readonly_query", { query_text: trimmed });

    if (queryErr) {
      const msg = queryErr.message || "";
      if (msg.includes("57014") || msg.includes("statement timeout")) {
        return json({
          ok: false,
          error: "Query timed out. Try a simpler query or add WHERE/LIMIT clauses.",
          code: "statement_timeout",
        }, 408);
      }
      const looksHtml = /<!doctype|<html|<head>/i.test(msg);
      if (looksHtml) {
        return err("Query backend returned HTML (transient infrastructure error). Please retry.", 502);
      }
      return err(`Query failed: ${msg}`, 400);
    }

    return json({ ok: true, rows: data ?? [], count: Array.isArray(data) ? data.length : 0 });
  } catch (e) {
    const msg = (e as Error).message || "";
    if (msg.includes("57014") || msg.includes("statement timeout")) {
      return json({
        ok: false,
        error: "Query timed out. Try a simpler query or add WHERE/LIMIT clauses.",
        code: "statement_timeout",
      }, 408);
    }
    return err(`Query execution failed: ${msg}`, 500);
  }
}

// ── Route: update-bulk-op (atomic single-op update via RPC) ─────────

async function handleUpdateBulkOp(body: Record<string, unknown>) {
  const opKey = body.op_key;
  const opState = body.op_state;
  if (typeof opKey !== "string" || !opKey) return err("op_key is required");
  if (!opState || typeof opState !== "object") return err("op_state is required");

  const onlyIfStatus = typeof body.only_if_status === "string" ? body.only_if_status : null;

  const db = serviceClient();
  const { data, error } = await db.rpc("update_bulk_operation", {
    p_op_key: opKey,
    p_op_state: opState,
    p_only_if_status: onlyIfStatus,
  });

  if (error) return err(`update_bulk_operation failed: ${error.message}`, 500);
  return json({ ok: true, operations: data });
}

// ── Route: rebuild-character-stats ──────────────────────────────────

async function handleRebuildCharacterStats(body: Record<string, unknown>) {
  const threshold = typeof body.threshold === "number" ? body.threshold : 3;
  const db = serviceClient();

  const { data: counts, error } = await db
    .from("asset_characters")
    .select("character_id, assets!inner(is_deleted)")
    .eq("assets.is_deleted", false);

  if (error) return err(error.message, 500);

  const tally = new Map<string, number>();
  for (const row of counts ?? []) {
    const cid = row.character_id;
    tally.set(cid, (tally.get(cid) ?? 0) + 1);
  }

  await db.from("characters").update({
    usage_count: 0,
    is_priority: false,
  }).gte("usage_count", 0);

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

// ── Route: get-latest-agent-build ───────────────────────────────────

async function handleGetLatestAgentBuild(body: Record<string, unknown>) {
  const agentType = optionalString(body, "agent_type") ?? "windows-render";
  const db = serviceClient();

  const configKey = agentType === "bridge" ? "BRIDGE_LATEST_BUILD" : "WINDOWS_LATEST_BUILD";

  const { data: row } = await db
    .from("admin_config")
    .select("value")
    .eq("key", configKey)
    .maybeSingle();

  if (!row?.value) {
    const repoBase = "https://github.com/u2giants/popdam3/releases";
    return json({
      ok: true,
      latest_version: "0.0.0",
      download_url: agentType === "bridge"
        ? `${repoBase}/latest/download/popdam-bridge-agent.tar.gz`
        : `${repoBase}/latest/download/popdam-windows-agent-dist.zip`,
      checksum_sha256: "",
      release_notes: "",
      published_at: null,
    });
  }

  const val = row.value as Record<string, unknown>;
  return json({
    ok: true,
    latest_version: val.version || "0.0.0",
    download_url: val.download_url || "",
    checksum_sha256: val.checksum_sha256 || "",
    release_notes: val.release_notes || "",
    published_at: val.published_at || null,
  });
}

// ── Route: trigger-windows-update ───────────────────────────────────

async function handleTriggerWindowsUpdate(
  body: Record<string, unknown>,
  userId: string,
) {
  const agentId = optionalString(body, "agent_id");
  const db = serviceClient();

  if (agentId) {
    const { data: agent } = await db
      .from("agent_registrations")
      .select("metadata")
      .eq("id", agentId)
      .maybeSingle();

    if (!agent) return err("Agent not found", 404);

    const metadata = (agent.metadata as Record<string, unknown>) || {};
    await db
      .from("agent_registrations")
      .update({
        metadata: {
          ...metadata,
          trigger_update: true,
          update_requested_by: userId,
          update_requested_at: new Date().toISOString(),
        },
      })
      .eq("id", agentId);
  } else {
    const { data: agents } = await db
      .from("agent_registrations")
      .select("id, metadata")
      .eq("agent_type", "windows-render");

    for (const a of agents || []) {
      const metadata = (a.metadata as Record<string, unknown>) || {};
      await db
        .from("agent_registrations")
        .update({
          metadata: {
            ...metadata,
            trigger_update: true,
            update_requested_by: userId,
            update_requested_at: new Date().toISOString(),
          },
        })
        .eq("id", a.id);
    }
  }

  return json({ ok: true });
}

// ── Main router ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  console.log(`admin-api: ${req.method} ${new URL(req.url).pathname}`);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return err("Method not allowed", 405);
  }

  // Validate env vars early
  if (!Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || !Deno.env.get("SUPABASE_ANON_KEY")) {
    console.error("Missing required env vars:", {
      hasUrl: !!Deno.env.get("SUPABASE_URL"),
      hasServiceKey: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      hasAnonKey: !!Deno.env.get("SUPABASE_ANON_KEY"),
    });
    return err("Server configuration error", 500);
  }

  try {
    // Parse body first so we can determine the action before selecting auth level
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
    console.log(`admin-api action: ${action}`);

    // Choose auth level: some actions are open to all authenticated users
    const authResult = USER_ACCESSIBLE_ACTIONS.has(action) ? await authenticateUser(req) : await authenticateAdmin(req);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    switch (action) {
      // ── Config ──
      case "get-config":
        return await handleGetConfig(body);
      case "set-config":
        return await handleSetConfig(body, userId);

      // ── Invitations ──
      case "invite-user":
        return await handleInviteUser(body, userId);
      case "list-invites":
        return await handleListInvites();
      case "revoke-invite":
        return await handleRevokeInvite(body);

      // ── Agents (from agent-handlers.ts) ──
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
      case "create-pairing-code":
        return await handleCreatePairingCode(body, userId);
      case "list-pairing-codes":
        return await handleListPairingCodes();
      case "trigger-agent-update":
        return await handleTriggerAgentUpdate(body, userId);
      case "get-update-status":
        return await handleGetUpdateStatus();
      case "retry-failed-renders":
        return await handleRetryFailedRenders();
      case "requeue-all-no-preview":
        return await handleRequeueAllNoPreview();
      case "request-path-test":
        return await handleRequestPathTest(userId);

      // ── Metadata (from metadata-handlers.ts) ──
      case "reprocess-asset-metadata":
        return await handleReprocessAssetMetadata(body);
      case "backfill-sku-names":
        return await handleBackfillSkuNames();

      // ── Style groups (from style-group-handlers.ts) ──
      case "rebuild-style-groups":
        return await handleRebuildStyleGroups(body);
      case "reconcile-style-group-stats":
        return await handleReconcileStyleGroupStats(body);

      // ── AI tagging (from ai-tagging-handlers.ts) ──
      case "bulk-ai-tag":
        return await handleBulkAiTag(body, false);
      case "bulk-ai-tag-all":
        return await handleBulkAiTag(body, true);
      case "count-untagged-assets":
        return await handleCountUntaggedAssets();
      case "bulk-propagate-group-tags":
        return await handleBulkPropagateGroupTags(body);
      case "count-groups-for-propagation":
        return await handleCountGroupsForPropagation();

      // ── Tag propagation ──
      case "sync-group-tags": {
        const groupId = typeof body.group_id === "string" ? body.group_id : null;
        if (!groupId) return err("group_id is required");
        const { propagateGroupTags } = await import("../_shared/tag-propagation.ts");
        // Find the primary asset (or first tagged asset) as the source
        const db = serviceClient();
        const { data: group } = await db.from("style_groups").select("primary_asset_id").eq("id", groupId).single();
        let sourceId = group?.primary_asset_id;
        if (!sourceId) {
          // Fallback: first tagged asset in the group
          const { data: tagged } = await db.from("assets")
            .select("id").eq("style_group_id", groupId).eq("is_deleted", false)
            .not("ai_tagged_at", "is", null).limit(1).single();
          sourceId = tagged?.id;
        }
        if (!sourceId) return err("No tagged asset found in this group to propagate from");
        const result = await propagateGroupTags(sourceId, groupId, { onlyUntagged: false });
        return json({ ok: true, ...result });
      }

      // ── Purge (from purge-handlers.ts) ──
      case "purge-old-assets":
        return await handlePurgeOldAssets(body);
      case "purge-excluded-subfolder-assets":
        return await handlePurgeExcludedSubfolderAssets();

      // ── ERP (from erp-handlers.ts + erp-browse-handlers.ts) ──
      case "trigger-erp-sync":
        return await handleTriggerErpSync(body);
      case "erp-sync-runs":
        return await handleErpSyncRuns();
      case "erp-enrichment-stats":
        return await handleErpEnrichmentStats();
      case "erp-review-queue":
        return await handleErpReviewQueue(body);
      case "erp-review-action":
        return await handleErpReviewAction(body, userId);
      case "apply-erp-enrichment":
        return await handleApplyErpEnrichment(body);
      case "classify-erp-categories":
        return await handleClassifyErpCategories(body);
      case "erp-items-browse":
        return await handleErpItemsBrowse(body);
      case "erp-items-dismiss":
        return await handleErpItemsDismiss(body);

      // ── Install bundle (from install-bundle-handler.ts) ──
      case "generate-install-bundle":
        return await handleGenerateInstallBundle(body, userId);

      // ── Sibling scans (from sibling-scan-handlers.ts) ──
      case "list-sibling-images":
        return await handleListSiblingImages(body);
      case "get-sibling-scan-result":
        return await handleGetSiblingScanResult(body);
      case "get-sibling-scan-by-folder":
        return await handleGetSiblingScanByFolder(body);
      case "ingest-sibling-images":
        return await handleIngestSiblingImages(body, userId);

      // ── TIFF hygiene (from tiff-handlers.ts) ──
      case "trigger-tiff-scan":
        return await handleTriggerTiffScan(userId);
      case "list-tiff-files":
        return await handleListTiffFiles(body);
      case "queue-tiff-jobs":
        return await handleQueueTiffJobs(body);
      case "delete-tiff-originals":
        return await handleDeleteTiffOriginals(body);
      case "clear-tiff-scan":
        return await handleClearTiffScan();
      case "refresh-tiff-dates":
        return await handleRefreshTiffDates(body, userId);

      // ── ColdLion (from coldlion-handlers.ts) ──
      case "debug-coldlion-lookup":
        return await handleDebugColdlionLookup(body);
      case "repair-invalid-property-names":
        return await handleRepairInvalidPropertyNames();

      // ── File hygiene (from hygiene-handlers.ts) ──
      case "list-hygiene-findings":
        return await handleListHygieneFindings(body);
      case "update-hygiene-findings":
        return await handleUpdateHygieneFindings(body, userId);
      case "trigger-hygiene-scan":
        return await handleTriggerHygieneScan(body, userId);
      case "stop-hygiene-scan":
        return await handleStopHygieneScan(userId);

      // ── Misc inline ──
      case "run-query":
        return await handleRunQuery(body);
      case "update-bulk-op":
        return await handleUpdateBulkOp(body);
      case "rebuild-character-stats":
        return await handleRebuildCharacterStats(body);
      case "get-latest-agent-build":
        return await handleGetLatestAgentBuild(body);
      case "trigger-windows-update":
        return await handleTriggerWindowsUpdate(body, userId);
      case "trigger-style-guide-crawl":
        return await handleTriggerStyleGuideCrawl(userId);
      case "get-style-guide-crawl-status":
        return await handleGetStyleGuideCrawlStatus();

      default:
        return err(`Unknown action: ${action}`, 404);
    }
  } catch (e) {
    const message = formatPostgrestError(e) || "Internal server error";
    console.error("admin-api unhandled error:", message, e);
    return err(message, 500);
  }
});
