import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsServe, err, json } from "../_shared/http.ts";
import { findRunningConflict } from "../_shared/operation-constants.ts";
import { serviceClient } from "../_shared/service-client.ts";
import { optionalString, requireString } from "../_shared/validators.ts";

// ── Extracted handler modules ───────────────────────────────────────
import {
  handleCheckRenderJob,
  handleClearCompletedJobs,
  handleClearFailedRenders,
  handleClearFailedSGRenders,
  handleClearJunkRenderJobs,
  handleCreatePairingCode,
  handleDoctor,
  handleGenerateAgentKey,
  handleGenerateBootstrapToken,
  handleGenerateRepairCode,
  handleGetCompatAuditPreviewResult,
  handleGetFilterOptions,
  handleGetUpdateStatus,
  handleListAgents,
  handleListPairingCodes,
  handleListRenderJobs,
  handleRemoveAgentRegistration,
  handleRenderQueueStats,
  handleRequestPathTest,
  handleRequeueAllNoPreview,
  handleRequeueBrokenThumbnails,
  handleRequeueRenderJob,
  handleResetScanState,
  handleResumeScanning,
  handleRetryFailedJobs,
  handleRetryFailedRenders,
  handleRevokeAgent,
  handleSendTestRender,
  handleSetAgentCommand,
  handleStopScan,
  handleTriggerAgentUpdate,
  handleTriggerCompatAudit,
  handleTriggerCompatAuditPreview,
  handleTriggerScan,
} from "../_shared/admin-handlers/agent-handlers.ts";

import { handleCountUntaggedAssets } from "../_shared/admin-handlers/ai-tagging-handlers.ts";

import { handleBulkPropagateGroupTags, handleCountGroupsForPropagation } from "../_shared/admin-handlers/tag-propagation-handlers.ts";
import { handleBackfillPdfFilesUsed, handleResolveSkuFilesUsed } from "../_shared/admin-handlers/pdf-files-handlers.ts";

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

import { handleProdOrderStats, handleProdOrderSyncRuns, handleTriggerProdOrderSync } from "../_shared/admin-handlers/prod-order-handlers.ts";

import { handleGenerateInstallBundle } from "../_shared/admin-handlers/install-bundle-handler.ts";
import { handleGetDirBrowseResult, handleRequestDirBrowse } from "../_shared/admin-handlers/dir-browse-handlers.ts";

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

import { handleDeleteAiPdfDuplicates, handleFindAiPdfDuplicates } from "../_shared/admin-handlers/ai-duplicate-handlers.ts";
import {
  handleGetAiSentinelStatus,
  handleGetBlankThumbCleanupStatus,
  handleRunAiSentinelCleanup,
  handleTriggerAiSentinelScan,
  handleTriggerBlankThumbCleanup,
} from "../_shared/admin-handlers/ai-sentinel-handlers.ts";

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
  if (userId === "system") return { userId };

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
  "fetch-thumbnail-by-url",
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

function isAllowedThumbnailUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    if (!url.pathname.startsWith("/thumbnails/")) return false;

    return [
      "popdam.nyc3.digitaloceanspaces.com",
      "popdam.nyc3.cdn.digitaloceanspaces.com",
      "cdn.designflow.app",
    ].includes(url.hostname);
  } catch {
    return false;
  }
}

async function handleFetchThumbnailByUrl(body: Record<string, unknown>): Promise<Response> {
  const url = optionalString(body, "url");
  if (!url) return err("Missing thumbnail URL", 400);
  if (!isAllowedThumbnailUrl(url)) return err("Thumbnail URL is not allowed", 400);

  const upstream = await fetch(url);
  if (!upstream.ok) {
    return err(`Thumbnail fetch failed: HTTP ${upstream.status}`, upstream.status >= 500 ? 502 : 400);
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  if (!contentType.toLowerCase().startsWith("image/")) {
    return err("Thumbnail URL did not return an image", 400);
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    },
  });
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

  // Apps the invitee should be granted access to
  const appsRaw = body.apps;
  const validApps = ["popdam", "styleguides"] as const;
  let apps: string[] = ["popdam"];
  if (Array.isArray(appsRaw) && appsRaw.length > 0) {
    apps = appsRaw.map(String).filter((a) => validApps.includes(a as typeof validApps[number]));
    if (apps.length === 0) {
      return err("At least one valid app must be selected (popdam, styleguides)");
    }
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
    .insert({ email, role: roleStr, invited_by: userId, apps })
    .select("id, email, role, apps, created_at")
    .single();

  if (error) return err(error.message, 500);

  // Send invite email via Brevo API
  const { sendBrevoEmail, buildInviteHtml } = await import("../_shared/brevo.ts");
  const appUrl = "https://dam.designflow.app";
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
    .select("id, email, role, apps, created_at, accepted_at, invited_by")
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
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(profile.user_id);
    if (deleteErr) {
      console.warn("Failed to delete auth user during invite revocation (non-fatal):", deleteErr.message);
    }
  }

  return json({ ok: true });
}

// ── Route: list-users ───────────────────────────────────────────────

async function handleListUsers() {
  const db = serviceClient();
  const { data, error } = await db
    .from("profiles")
    .select("user_id, email, full_name, created_at, user_roles(role), app_access(app)")
    .order("created_at", { ascending: false });

  if (error) return err(error.message, 500);

  return json({
    ok: true,
    users: (data ?? []).map((u) => ({
      id: u.user_id,
      email: u.email,
      full_name: u.full_name,
      created_at: u.created_at,
      isAdmin: Array.isArray(u.user_roles) &&
        (u.user_roles as { role: string }[]).some((r) => r.role === "admin"),
      apps: Array.isArray(u.app_access) ? (u.app_access as { app: string }[]).map((a) => a.app) : [],
    })),
  });
}

// ── Route: set-user-apps ────────────────────────────────────────────

async function handleSetUserApps(body: Record<string, unknown>, _userId: string) {
  const targetUserId = requireString(body, "user_id");
  const appsRaw = body.apps;
  if (!Array.isArray(appsRaw)) {
    return err("apps must be an array");
  }
  const validApps = ["popdam", "styleguides"] as const;
  const apps = appsRaw
    .map(String)
    .filter((a) => validApps.includes(a as typeof validApps[number]));

  const db = serviceClient();

  // Replace the user's app_access rows with exactly the requested set
  const { error: delErr } = await db
    .from("app_access")
    .delete()
    .eq("user_id", targetUserId);
  if (delErr) return err(delErr.message, 500);

  if (apps.length > 0) {
    const rows = apps.map((app) => ({ user_id: targetUserId, app, granted_by: _userId }));
    const { error: insErr } = await db.from("app_access").insert(rows);
    if (insErr) return err(insErr.message, 500);
  }

  return json({ ok: true, apps });
}

// ── Route: run-query ─────────────────────────────────────────────────

async function handleRunQuery(body: Record<string, unknown>) {
  const sql = body.sql;
  if (typeof sql !== "string" || sql.trim() === "") {
    return err("Missing required field: sql");
  }

  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (!/^select\s/i.test(trimmed)) {
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

  // Guard: if this call is transitioning the op to running/queued, check cross-lane conflicts.
  // The bulk-job-runner also checks this at promotion time, but catching it here gives the
  // user immediate feedback instead of silently deferring.
  const newStatus = (opState as Record<string, unknown>).status;
  if (newStatus === "running" || newStatus === "queued") {
    const { data: configRow } = await db
      .from("admin_config")
      .select("value")
      .eq("key", "BULK_OPERATIONS")
      .maybeSingle();
    const allOps = (configRow?.value as Record<string, { status: string }>) || {};
    const conflictingOp = findRunningConflict(opKey, allOps);
    if (conflictingOp) {
      return err(
        `Cannot start '${opKey}': '${conflictingOp}' is currently running and writes to the same tables. Stop it first or wait for it to complete.`,
        409,
      );
    }
  }

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
      sha: null,
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
    // The git sha of the published build — the immutable identity the UI compares
    // the agent's running build_sha against to detect drift (version strings lie).
    sha: val.sha || null,
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

// ── Route: trigger-style-guide-crawl ────────────────────────────────

async function handleTriggerStyleGuideCrawl(userId: string) {
  const db = serviceClient();
  const requestId = crypto.randomUUID();
  await db.from("admin_config").upsert({
    key: "STYLE_GUIDE_CRAWL_REQUEST",
    value: { request_id: requestId, status: "pending", requested_at: new Date().toISOString(), requested_by: userId },
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });
  return json({ ok: true, request_id: requestId });
}

// ── Route: get-style-guide-crawl-status ─────────────────────────────

async function handleGetStyleGuideCrawlStatus() {
  const db = serviceClient();

  const { data: reqRow } = await db.from("admin_config").select("value").eq("key", "STYLE_GUIDE_CRAWL_REQUEST").maybeSingle();
  const request = (reqRow?.value as Record<string, unknown>) || null;

  const { data: lastRun } = await db.from("style_guide_crawl_runs")
    .select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { count: totalActive } = await db.from("style_guide_files")
    .select("*", { count: "exact", head: true }).eq("is_active", true);

  return json({ ok: true, request, last_run: lastRun, total_active_files: totalActive ?? 0 });
}

// ── Route: browse-style-guide-files ─────────────────────────────────

async function handleBrowseStyleGuideFiles(body: Record<string, unknown>) {
  const db = serviceClient();
  const page = Math.max(1, Number(body.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(body.page_size) || 50));
  const search = (body.search as string || "").trim();
  const styleGuideFolder = (body.style_guide_folder as string || "").trim();
  const extension = (body.extension as string || "").trim();

  let query = db.from("style_guide_files")
    .select(
      "id,root_label,relative_path,directory_path,filename,basename_no_ext,file_extension,property_folder,style_guide_folder,size_bytes,modified_at,is_active",
      { count: "exact" },
    )
    .eq("is_active", true)
    .order("style_guide_folder", { ascending: true })
    .order("filename", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (search) {
    query = query.ilike("filename", `%${search}%`);
  }
  if (styleGuideFolder) {
    query = query.eq("style_guide_folder", styleGuideFolder);
  }
  if (extension) {
    query = query.eq("file_extension", extension.toLowerCase());
  }

  const { data: files, count, error: qErr } = await query;
  if (qErr) throw qErr;

  // Get distinct style guide folders for filter dropdown
  const { data: folders } = await db.from("style_guide_files")
    .select("style_guide_folder")
    .eq("is_active", true)
    .order("style_guide_folder")
    .limit(500);

  const uniqueFolders = [...new Set((folders || []).map((f: { style_guide_folder: string | null }) => f.style_guide_folder).filter(Boolean))];

  // Get distinct extensions
  const { data: exts } = await db.from("style_guide_files")
    .select("file_extension")
    .eq("is_active", true)
    .not("file_extension", "is", null)
    .order("file_extension")
    .limit(100);

  const uniqueExts = [...new Set((exts || []).map((e: { file_extension: string }) => e.file_extension))];

  return json({
    ok: true,
    files: files || [],
    total: count ?? 0,
    page,
    page_size: pageSize,
    folders: uniqueFolders,
    extensions: uniqueExts,
  });
}

// ── Route: get-openrouter-vision-models ─────────────────────────────

async function handleGetOpenrouterVisionModels() {
  const db = serviceClient();
  const { data: keyRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "OPENROUTER_API_KEY")
    .maybeSingle();

  const apiKey = (keyRow?.value as string | null) ?? null;
  if (!apiKey) return err("OPENROUTER_API_KEY not configured in admin_config", 400);

  const resp = await fetch("https://openrouter.ai/api/v1/models/user", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) return err(`OpenRouter API error: ${resp.status} ${resp.statusText}: ${await resp.text()}`, 502);

  const payload = await resp.json() as { data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const items = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];
  const models = items.filter((m) => {
    const arch = m.architecture as Record<string, unknown> | undefined;
    const modalities = arch?.input_modalities as string[] | undefined;
    return Array.isArray(modalities) && modalities.includes("image");
  }).map((m) => ({
    id: m.id as string,
    name: (m.name as string | null) ?? (m.id as string),
    context_length: m.context_length as number | null,
    supports_tools: Array.isArray(m.supported_parameters) && (m.supported_parameters as string[]).includes("tools"),
    pricing: m.pricing as Record<string, unknown> | null,
  }));

  return json({ ok: true, models });
}

// ── Routes: AI tag bake-off ────────────────────────────────────────

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

type BakeoffSampleAsset = {
  id: string;
  filename: string | null;
  relative_path: string | null;
  quick_hash?: string | null;
  sku?: string | null;
};

function bakeoffSampleKeys(asset: BakeoffSampleAsset) {
  const keys: string[] = [];
  const filename = (asset.filename ?? "").trim().toLowerCase();
  if (asset.quick_hash) keys.push(`hash:${asset.quick_hash}`);
  if (filename) {
    if (asset.sku) keys.push(`sku-file:${asset.sku.trim().toLowerCase()}:${filename}`);
    keys.push(`filename:${filename}`);
  }
  return keys;
}

function isTechpackPath(asset: BakeoffSampleAsset) {
  return /(^|\/)techpack(\/|$)/i.test(asset.relative_path ?? "");
}

function dedupeBakeoffAssets(assets: BakeoffSampleAsset[], limit: number) {
  const selected: BakeoffSampleAsset[] = [];
  const usedKeys = new Map<string, number>();

  for (const asset of assets) {
    const keys = bakeoffSampleKeys(asset);
    const existingIndex = keys.map((key) => usedKeys.get(key)).find((idx): idx is number => idx !== undefined);
    if (existingIndex === undefined) {
      selected.push(asset);
      const idx = selected.length - 1;
      for (const key of keys) usedKeys.set(key, idx);
    } else if (isTechpackPath(selected[existingIndex]) && !isTechpackPath(asset)) {
      selected[existingIndex] = asset;
    }
    if (selected.length >= limit) break;
  }

  return selected.slice(0, limit);
}

async function fetchBakeoffAssetsByIds(db: ReturnType<typeof serviceClient>, assetIds: string[]) {
  if (assetIds.length === 0) return [];
  const { data, error } = await db
    .from("assets")
    .select("id, filename, relative_path, quick_hash, sku")
    .in("id", assetIds);
  if (error) throw new Error(`Failed to load explicit assets: ${error.message}`);
  const byId = new Map(((data ?? []) as BakeoffSampleAsset[]).map((asset) => [asset.id, asset]));
  return assetIds.map((id) => byId.get(id)).filter((asset): asset is BakeoffSampleAsset => !!asset);
}

function randomInt(maxExclusive: number) {
  return Math.floor(Math.random() * Math.max(1, maxExclusive));
}

async function selectRandomBakeoffAssets(db: ReturnType<typeof serviceClient>, sampleSize: number) {
  const baseQuery = () =>
    db
      .from("assets")
      .select("id, filename, relative_path, quick_hash, sku")
      .eq("is_deleted", false)
      .not("thumbnail_url", "is", null)
      .not("primary_sort_tier", "in", "(4,8)");

  const pageSize = Math.min(1000, Math.max(100, sampleSize * 25));
  const seenIds = new Set<string>();
  const pool: BakeoffSampleAsset[] = [];
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts && dedupeBakeoffAssets(pool, sampleSize).length < sampleSize; attempt++) {
    const pivot = crypto.randomUUID();
    const { data, error } = await baseQuery()
      .order("id", { ascending: true })
      .gte("id", pivot)
      .limit(pageSize);
    if (error) throw new Error(`Failed to select random sample assets: ${error.message}`);
    for (const asset of (data ?? []) as BakeoffSampleAsset[]) {
      if (!seenIds.has(asset.id)) {
        seenIds.add(asset.id);
        pool.push(asset);
      }
    }
  }

  if (dedupeBakeoffAssets(pool, sampleSize).length < sampleSize) {
    const { data, error } = await baseQuery()
      .order("id", { ascending: true })
      .limit(pageSize);
    if (error) throw new Error(`Failed to fill random sample assets: ${error.message}`);
    for (const asset of (data ?? []) as BakeoffSampleAsset[]) {
      if (!seenIds.has(asset.id)) {
        seenIds.add(asset.id);
        pool.push(asset);
      }
    }
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return dedupeBakeoffAssets(pool, sampleSize);
}

async function handleCreateAiTagBakeoffRun(body: Record<string, unknown>, userId: string) {
  const db = serviceClient();
  const modelIds = stringArray(body.model_ids).slice(0, 5);
  if (modelIds.length !== 5) return err("model_ids must contain exactly 5 models", 400);

  const requestedSampleSize = typeof body.sample_size === "number" ? Math.floor(body.sample_size) : 30;
  const sampleSize = Math.min(500, Math.max(1, requestedSampleSize));
  const explicitAssetIds = stringArray(body.asset_ids).slice(0, sampleSize);
  let sampleAssets: BakeoffSampleAsset[] = [];

  try {
    sampleAssets = explicitAssetIds.length > 0
      ? dedupeBakeoffAssets(await fetchBakeoffAssetsByIds(db, explicitAssetIds), sampleSize)
      : await selectRandomBakeoffAssets(db, sampleSize);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }

  const assetIds = sampleAssets.map((asset) => asset.id);
  if (assetIds.length === 0) return err("No eligible assets with thumbnails found", 400);

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : `Vision bake-off ${new Date().toISOString().slice(0, 10)}`;

  const { data: run, error: runErr } = await db
    .from("ai_tag_bakeoff_runs")
    .insert({
      name,
      status: "draft",
      model_a: modelIds[0],
      model_b: modelIds[1],
      model_c: modelIds[2],
      model_d: modelIds[3],
      model_e: modelIds[4],
      sample_size: assetIds.length,
      asset_ids: assetIds,
      created_by: userId === "system" ? null : userId,
    })
    .select("*")
    .single();

  if (runErr) return err(`Failed to create bake-off run: ${runErr.message}`, 500);
  return json({ ok: true, run });
}

async function handleListAiTagBakeoffRuns() {
  const db = serviceClient();
  const { data, error: qErr } = await db
    .from("ai_tag_bakeoff_runs")
    .select("id, name, status, model_a, model_b, model_c, model_d, model_e, sample_size, created_at, updated_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (qErr) return err(`Failed to list bake-off runs: ${qErr.message}`, 500);
  return json({ ok: true, runs: data ?? [] });
}

async function handleGetAiTagBakeoffRun(body: Record<string, unknown>) {
  const runId = typeof body.run_id === "string" ? body.run_id : null;
  if (!runId) return err("run_id is required", 400);
  const db = serviceClient();

  const { data: run, error: runErr } = await db
    .from("ai_tag_bakeoff_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (runErr || !run) return err(`Bake-off run not found: ${runErr?.message ?? "no data"}`, 404);

  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await db
    .from("ai_tag_bakeoff_results")
    .update({
      status: "failed",
      error_message: "Stale running result: no final result was written within 10 minutes",
      updated_at: new Date().toISOString(),
    })
    .eq("run_id", runId)
    .eq("status", "running")
    .lt("updated_at", staleCutoff);

  const assetIds = ((run as { asset_ids?: string[] }).asset_ids ?? []) as string[];
  const [{ data: assets, error: assetsErr }, { data: results, error: resultsErr }, { data: reviews, error: reviewsErr }] = await Promise.all([
    assetIds.length > 0
      ? db.from("assets").select("id, filename, relative_path, thumbnail_url, ai_model, ai_tagged_at").in("id", assetIds)
      : Promise.resolve({ data: [], error: null }),
    db.from("ai_tag_bakeoff_results").select("*").eq("run_id", runId),
    db.from("ai_tag_bakeoff_reviews").select("*").eq("run_id", runId),
  ]);
  if (assetsErr) return err(`Failed to load bake-off assets: ${assetsErr.message}`, 500);
  if (resultsErr) return err(`Failed to load bake-off results: ${resultsErr.message}`, 500);
  if (reviewsErr) return err(`Failed to load bake-off reviews: ${reviewsErr.message}`, 500);

  const assetMap = new Map((assets ?? []).map((a: Record<string, unknown>) => [a.id as string, a]));
  const orderedAssets = assetIds.map((id) => assetMap.get(id)).filter(Boolean);

  return json({ ok: true, run, assets: orderedAssets, results: results ?? [], reviews: reviews ?? [] });
}

async function handleScoreAiTagBakeoffField(body: Record<string, unknown>, userId: string) {
  const runId = typeof body.run_id === "string" ? body.run_id : null;
  const assetId = typeof body.asset_id === "string" ? body.asset_id : null;
  const field = typeof body.field === "string" ? body.field : null;
  const winnerSlot = typeof body.winner_slot === "string" && body.winner_slot ? body.winner_slot : null;
  const notes = typeof body.notes === "string" ? body.notes : null;
  const scores = body.scores && typeof body.scores === "object" ? body.scores : {};
  if (!runId || !assetId || !field) return err("run_id, asset_id, and field are required", 400);
  if (!["tags", "description", "characters", "property", "overall"].includes(field)) return err("Invalid field", 400);
  if (winnerSlot && !["a", "b", "c", "d", "e"].includes(winnerSlot)) return err("Invalid winner_slot", 400);

  const db = serviceClient();
  const { data, error: upsertErr } = await db
    .from("ai_tag_bakeoff_reviews")
    .upsert({
      run_id: runId,
      asset_id: assetId,
      field,
      winner_slot: winnerSlot,
      scores,
      notes,
      reviewed_by: userId === "system" ? null : userId,
      reviewed_at: new Date().toISOString(),
    }, { onConflict: "run_id,asset_id,field" })
    .select("*")
    .single();
  if (upsertErr) return err(`Failed to save review: ${upsertErr.message}`, 500);
  return json({ ok: true, review: data });
}

// ── Routes: pdf-backfill ─────────────────────────────────────────────────────

async function handleTriggerPdfBackfill() {
  const db = serviceClient();

  // Accurate remaining count over licensing-sheet / tech-pack PDFs (matches claim_pdf_backfill_batch).
  // count_pdf_backfill_remaining() is the same NOT-EXISTS predicate the agent claims against,
  // so the progress bar total stays consistent with the work actually done.
  const { data: remainingCount } = await db.rpc("count_pdf_backfill_remaining");
  const remaining = (remainingCount as number) ?? 0;
  const nowIso = new Date().toISOString();
  const initialStatus = remaining > 0 ? "running" : "completed";

  await db.from("admin_config").upsert({
    key: "PDF_BACKFILL",
    value: {
      status: initialStatus,
      started_at: nowIso,
      completed_at: remaining > 0 ? null : nowIso,
      total: remaining,
      processed: 0,
      remaining,
      last_batch_at: null,
      claimed_by_agent_id: null,
      claimed_by_agent_name: null,
      // Outcome tallies accumulated by complete-pdf-backfill-batch (reset on each run).
      stats: {},
      files_used_added: 0,
    },
    updated_at: nowIso,
  });

  return json({ ok: true, total: remaining });
}

async function handlePausePdfBackfill() {
  const db = serviceClient();
  const { data: row } = await db.from("admin_config")
    .select("value").eq("key", "PDF_BACKFILL").maybeSingle();
  const bf = (row?.value as Record<string, unknown>) || {};
  await db.from("admin_config").upsert({
    key: "PDF_BACKFILL",
    value: { ...bf, status: "paused" },
    updated_at: new Date().toISOString(),
  });
  return json({ ok: true });
}

async function handleResumePdfBackfill() {
  const db = serviceClient();
  const { data: row } = await db.from("admin_config")
    .select("value").eq("key", "PDF_BACKFILL").maybeSingle();
  const bf = (row?.value as Record<string, unknown>) || {};
  await db.from("admin_config").upsert({
    key: "PDF_BACKFILL",
    value: { ...bf, status: "running", resumed_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  });
  return json({ ok: true });
}

async function handleGetPdfBackfillStatus() {
  const db = serviceClient();
  const [{ data: row }, { data: agents }, { data: remainingCount }] = await Promise.all([
    db.from("admin_config")
      .select("value, updated_at").eq("key", "PDF_BACKFILL").maybeSingle(),
    // Health of the agent that runs the backfill (windows-render after the offload).
    db.from("agent_registrations")
      .select("agent_name, agent_type, last_heartbeat")
      .eq("agent_type", "windows-render")
      .order("last_heartbeat", { ascending: false }),
    db.rpc("count_pdf_backfill_remaining"),
  ]);

  const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min
  const now = Date.now();
  const top = (agents ?? [])[0];
  const lastHb = top?.last_heartbeat ? new Date(top.last_heartbeat).getTime() : 0;
  const agent = top
    ? {
      agent_name: top.agent_name,
      agent_type: top.agent_type,
      last_heartbeat: top.last_heartbeat,
      seconds_ago: lastHb > 0 ? Math.round((now - lastHb) / 1000) : null,
      online: lastHb > 0 && (now - lastHb) < OFFLINE_THRESHOLD_MS,
    }
    : null;

  let backfill = (row?.value as Record<string, unknown> | null) ?? null;
  const remaining = (remainingCount as number) ?? null;

  // If an agent drained the queue but exited before the final status write (or the original
  // total was stale), normalize it here so the UI shows a terminal result instead of a
  // forever-running/no-details state.
  if (backfill?.status === "running" && remaining === 0) {
    const nowIso = new Date().toISOString();
    backfill = {
      ...backfill,
      status: "completed",
      completed_at: backfill.completed_at ?? nowIso,
      remaining: 0,
      live_current_file: null,
      live_current_step: "completed",
    };
    await db.from("admin_config").upsert({
      key: "PDF_BACKFILL",
      value: backfill,
      updated_at: nowIso,
    });
  } else if (backfill && remaining != null && backfill.remaining !== remaining) {
    backfill = { ...backfill, remaining };
  }

  return json({ backfill, agent, remaining_count: remaining, updated_at: row?.updated_at ?? null });
}

// ── Route: trigger-pdf-text-sample ──────────────────────────────────

async function handleTriggerPdfTextSample(body: Record<string, unknown>) {
  const db = serviceClient();

  // If explicit asset_ids are provided, use those directly (bypasses file_type filter —
  // used for targeted analysis of .ai files or other non-PDF assets).
  const explicitIds = Array.isArray(body.asset_ids) ? (body.asset_ids as string[]) : null;
  if (explicitIds && explicitIds.length > 0) {
    const { data: assets, error } = await db
      .from("assets")
      .select("id, relative_path, filename")
      .in("id", explicitIds)
      .eq("is_deleted", false);

    if (error) return err(error.message, 500);
    if (!assets || assets.length === 0) return err("None of the specified asset IDs were found", 404);

    await db.from("admin_config").upsert({
      key: "PDF_TEXT_SAMPLE_REQUEST",
      value: {
        status: "pending",
        mode: "targeted",
        assets: assets.map((a) => ({ id: a.id, relative_path: a.relative_path, filename: a.filename })),
        requested_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    });

    return json({ ok: true, queued: assets.length, mode: "targeted" });
  }

  const mode = body.mode === "full" ? "full" : "sample";

  const query = db
    .from("assets")
    .select("id, relative_path, filename")
    .eq("file_type", "pdf")
    .eq("is_deleted", false);

  if (mode === "sample") query.limit(250); // fetch 250 to shuffle down to 25
  // full mode: no limit (Supabase default 1000; large libraries may need pagination but 1000 is sufficient)

  const { data: assets, error } = await query;

  if (error) return err(error.message, 500);
  if (!assets || assets.length === 0) return err("No active PDF assets found", 404);

  let selected = assets;
  if (mode === "sample") {
    // Fisher-Yates shuffle for uniform random selection
    const shuffled = [...assets];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    selected = shuffled.slice(0, 25);
  }

  await db.from("admin_config").upsert({
    key: "PDF_TEXT_SAMPLE_REQUEST",
    value: {
      status: "pending",
      mode,
      assets: selected.map((a) => ({ id: a.id, relative_path: a.relative_path, filename: a.filename })),
      requested_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  });

  return json({ ok: true, queued: selected.length, mode });
}

// ── Route: get-pdf-text-samples ──────────────────────────────────────

async function handleGetPdfTextSamples() {
  const db = serviceClient();

  // Parallel: get request status, samples, and agent heartbeats
  const settled = await Promise.allSettled([
    db.from("admin_config")
      .select("value, updated_at")
      .eq("key", "PDF_TEXT_SAMPLE_REQUEST")
      .maybeSingle(),
    (async () => {
      try {
        const { data, error } = await db
          .from("pdf_text_samples")
          .select("id,asset_id,filename,relative_path,extraction_method,extracted_text,page_count,char_count,extraction_error,sampled_at")
          .order("sampled_at", { ascending: false })
          .limit(5000);
        if (!error) return data ?? [];
        console.warn("pdf_text_samples query failed (table may not exist):", error.message);
        return [];
      } catch (e) {
        console.warn("pdf_text_samples query exception:", e);
        return [];
      }
    })(),
    db.from("agent_registrations")
      .select("id, agent_name, agent_type, last_heartbeat, metadata"),
    db.from("admin_config")
      .select("value")
      .eq("key", "WINDOWS_RENDER_POLICY")
      .maybeSingle(),
  ]);

  const configResult = settled[0].status === "fulfilled" ? settled[0].value : { data: null };
  const samplesResult = settled[1].status === "fulfilled" ? settled[1].value : [];
  const agentsResult = settled[2].status === "fulfilled" ? settled[2].value : { data: [] };
  const policyResult = settled[3].status === "fulfilled" ? settled[3].value : { data: null };
  if (settled[0].status === "rejected") console.error("get-pdf-text-samples config query failed:", settled[0].reason);
  if (settled[2].status === "rejected") console.error("get-pdf-text-samples agents query failed:", settled[2].reason);
  if (settled[3].status === "rejected") console.error("get-pdf-text-samples policy query failed:", settled[3].reason);

  let samples = samplesResult as Array<Record<string, unknown>>;
  const agents = agentsResult.data ?? [];
  const now = Date.now();
  const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min

  // Build agent status summary
  const agentStatus = agents.map((a) => {
    const lastHb = a.last_heartbeat ? new Date(a.last_heartbeat).getTime() : 0;
    const secAgo = lastHb > 0 ? Math.round((now - lastHb) / 1000) : null;
    const online = lastHb > 0 && (now - lastHb) < OFFLINE_THRESHOLD_MS;
    const meta = (a.metadata as Record<string, unknown>) || {};
    const health = meta.health as Record<string, unknown> | undefined;
    const versionInfo = meta.version_info as Record<string, unknown> | undefined;
    return {
      id: a.id,
      name: a.agent_name,
      type: a.agent_type,
      online,
      last_heartbeat_seconds_ago: secAgo,
      last_heartbeat: a.last_heartbeat,
      healthy: health?.healthy ?? null,
      version: versionInfo?.version ?? null,
    };
  });

  // Determine which agent type should handle PDF samples
  const policy = (policyResult.data?.value as Record<string, unknown> | null) || null;
  const policyMode = (policy?.mode as string) || "primary";
  const bridgeOnline = agentStatus.some((a) => a.type === "bridge" && a.online);
  const windowsOnline = agentStatus.some((a) => a.type === "windows-render" && a.online);

  let targetAgentType: string;
  if (policyMode === "fallback_only") {
    targetAgentType = "bridge";
  } else if (policy?.require_windows_healthy === true && !windowsOnline) {
    targetAgentType = "bridge";
  } else {
    targetAgentType = "windows-render";
  }

  const targetOnline = targetAgentType === "bridge" ? bridgeOnline : windowsOnline;

  // ── Auto-timeout stuck requests ──
  let request = configResult.data?.value as Record<string, unknown> | null;

  if (request) {
    const status = request.status as string;
    const PENDING_TIMEOUT_MS = 3 * 60 * 1000; // 3 min
    const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

    if (status === "pending") {
      const requestedAt = request.requested_at as string | undefined;
      const elapsed = requestedAt ? now - new Date(requestedAt).getTime() : Infinity;

      if (elapsed > PENDING_TIMEOUT_MS) {
        // Build a specific reason
        const reasons: string[] = [];
        if (agents.length === 0) {
          reasons.push("No agents registered at all.");
        } else {
          const targetAgents = agentStatus.filter((a) => a.type === targetAgentType);
          if (targetAgents.length === 0) {
            reasons.push(`No ${targetAgentType} agents registered. Policy mode: "${policyMode}".`);
          } else {
            for (const a of targetAgents) {
              if (!a.online) {
                const ago = a.last_heartbeat_seconds_ago !== null
                  ? `last heartbeat ${Math.round(a.last_heartbeat_seconds_ago / 60)}m ago`
                  : "never heartbeated";
                reasons.push(`${a.name} (${a.type}) is OFFLINE — ${ago}.`);
              }
            }
            if (reasons.length === 0) {
              reasons.push(`${targetAgentType} agent is online but did not claim the request within 3 minutes. Check agent logs.`);
            }
          }
        }

        const errorMsg = `Auto-timeout: No agent claimed this request after 3 minutes. ${reasons.join(" ")}`;
        const timedOut = {
          ...request,
          status: "error",
          error: errorMsg,
          timed_out_at: new Date().toISOString(),
        };
        await db.from("admin_config").upsert({
          key: "PDF_TEXT_SAMPLE_REQUEST",
          value: timedOut,
          updated_at: new Date().toISOString(),
        });
        request = timedOut;
      }
    } else if (status === "processing") {
      const progress = request.progress as Record<string, unknown> | undefined;
      const lastProgressUpdate = progress?.updated_at as string | undefined;
      const claimedAt = request.claimed_at as string | undefined;
      const lastActivity = lastProgressUpdate || claimedAt;
      const elapsed = lastActivity ? now - new Date(lastActivity).getTime() : Infinity;

      if (elapsed > PROCESSING_TIMEOUT_MS) {
        const claimedBy = request.claimed_by_agent_name as string || "unknown agent";
        const processed = (progress?.processed as number) ?? 0;
        const total = (progress?.total as number) ?? 0;
        const currentFile = progress?.current_file as string || null;
        const currentStep = progress?.current_step as string || null;

        let detail = `Agent "${claimedBy}" stopped reporting progress after ${Math.round(elapsed / 60000)}m.`;
        detail += ` Processed ${processed}/${total} PDFs.`;
        if (currentFile) detail += ` Last file: "${currentFile}".`;
        if (currentStep) detail += ` Last step: "${currentStep}".`;

        // Check if claiming agent is still online
        const claimingAgentId = request.claimed_by_agent_id as string | undefined;
        const claimingAgent = agentStatus.find((a) => a.id === claimingAgentId);
        if (claimingAgent && !claimingAgent.online) {
          detail += ` Agent "${claimingAgent.name}" is now OFFLINE (last heartbeat ${
            claimingAgent.last_heartbeat_seconds_ago !== null ? Math.round(claimingAgent.last_heartbeat_seconds_ago / 60) + "m ago" : "never"
          }).`;
        } else if (!claimingAgent) {
          detail += ` Claiming agent (ID: ${claimingAgentId?.slice(0, 8)}…) not found in registrations.`;
        }

        const errorMsg = `Auto-timeout: ${detail}`;
        const timedOut = {
          ...request,
          status: "error",
          error: errorMsg,
          timed_out_at: new Date().toISOString(),
        };
        await db.from("admin_config").upsert({
          key: "PDF_TEXT_SAMPLE_REQUEST",
          value: timedOut,
          updated_at: new Date().toISOString(),
        });
        request = timedOut;
      }
    }
  }

  // Enrich samples with thumbnail_url from assets, plus sibling replacement thumbnail
  // for sentinel .ai files (their own thumbnail renders the Adobe boilerplate warning,
  // not the artwork — show a sibling PDF/PNG/JPG thumbnail instead).
  const assetIds = samples.map((s) => s.asset_id as string).filter(Boolean);
  if (assetIds.length > 0) {
    try {
      const { data: assetRows } = await db
        .from("assets")
        .select("id, thumbnail_url, relative_path, file_type")
        .in("id", assetIds)
        .limit(5000);

      const assetMap = new Map((assetRows ?? []).map((a) => [
        a.id as string,
        { thumbnail_url: a.thumbnail_url as string | null, relative_path: a.relative_path as string, file_type: a.file_type as string },
      ]));

      // For sentinel .ai files, find sibling PDF/PNG/JPG thumbnails
      const sentinelSamples = (samples as Array<Record<string, unknown>>).filter(
        (s) => (s.extracted_text as string | null)?.includes("saved without PDF Content") && assetMap.get(s.asset_id as string)?.file_type === "ai",
      );
      const sentinelDirs = [
        ...new Set(
          sentinelSamples.map((s) => {
            const rp = assetMap.get(s.asset_id as string)?.relative_path ?? "";
            return rp.replace(/\/[^/]*$/, "");
          }).filter(Boolean),
        ),
      ];

      const siblingMap = new Map<string, { thumbnail_url: string; filename: string }>();
      if (sentinelDirs.length > 0) {
        // Query each directory individually — .or() with multi-word paths breaks
        // the PostgREST parser because spaces in values are not quoted.
        await Promise.all(sentinelDirs.map(async (dir) => {
          const { data: rows } = await db
            .from("assets")
            .select("filename, thumbnail_url")
            .in("file_type", ["pdf", "png", "jpg"])
            .eq("is_deleted", false)
            .not("thumbnail_url", "is", null)
            .like("relative_path", `${dir}/%`)
            .limit(20);
          const siblings = (rows ?? []) as Array<{ filename: string; thumbnail_url: string }>;
          const techPack = siblings.find((r) => /tech.?pack/i.test(r.filename));
          const best = techPack ?? siblings[0] ?? null;
          if (best) siblingMap.set(dir, { thumbnail_url: best.thumbnail_url, filename: best.filename });
        }));
      }

      samples = (samples as Array<Record<string, unknown>>).map((s) => {
        const asset = assetMap.get(s.asset_id as string);
        const isSentinel = (s.extracted_text as string | null)?.includes("saved without PDF Content") && asset?.file_type === "ai";
        const dir = asset?.relative_path.replace(/\/[^/]*$/, "") ?? "";
        const sibling = isSentinel ? (siblingMap.get(dir) ?? null) : null;
        return {
          ...s,
          thumbnail_url: asset?.thumbnail_url ?? null,
          replacement_thumbnail_url: sibling?.thumbnail_url ?? null,
          replacement_filename: sibling?.filename ?? null,
        };
      });
    } catch (e) {
      console.warn("get-pdf-text-samples thumbnail enrichment failed:", e);
    }
  }

  return json({
    ok: true,
    request,
    samples,
    agent_status: agentStatus,
    target_agent_type: targetAgentType,
    target_agent_online: targetOnline,
  });
}

// ── Main router ─────────────────────────────────────────────────────

corsServe(async (req: Request) => {
  console.log(`admin-api: ${req.method} ${new URL(req.url).pathname}`);

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
      case "fetch-thumbnail-by-url":
        return await handleFetchThumbnailByUrl(body);

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
      case "list-users":
        return await handleListUsers();
      case "set-user-apps":
        return await handleSetUserApps(body, userId);

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
      case "clear-failed-sg-renders":
        return await handleClearFailedSGRenders();
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
      case "requeue-broken-thumbnails":
        return await handleRequeueBrokenThumbnails();
      case "trigger-compat-audit":
        return await handleTriggerCompatAudit();
      case "trigger-compat-audit-preview":
        return await handleTriggerCompatAuditPreview();
      case "get-compat-audit-preview-result":
        return await handleGetCompatAuditPreviewResult();
      case "request-path-test":
        return await handleRequestPathTest(userId);
      case "request-dir-browse":
        return await handleRequestDirBrowse(body, userId);
      case "get-dir-browse-result":
        return await handleGetDirBrowseResult();

      // ── Metadata (from metadata-handlers.ts) ──
      case "reprocess-asset-metadata":
        return await handleReprocessAssetMetadata(body);
      case "backfill-sku-names":
        return await handleBackfillSkuNames();

      // ── AI tagging (from ai-tagging-handlers.ts) ──
      case "count-untagged-assets":
        return await handleCountUntaggedAssets();
      case "create-ai-tag-bakeoff-run":
        return await handleCreateAiTagBakeoffRun(body, userId);
      case "list-ai-tag-bakeoff-runs":
        return await handleListAiTagBakeoffRuns();
      case "get-ai-tag-bakeoff-run":
        return await handleGetAiTagBakeoffRun(body);
      case "score-ai-tag-bakeoff-field":
        return await handleScoreAiTagBakeoffField(body, userId);
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
      case "trigger-prod-order-sync":
        return await handleTriggerProdOrderSync(body);
      case "prod-order-sync-runs":
        return await handleProdOrderSyncRuns();
      case "prod-order-stats":
        return await handleProdOrderStats();

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
      case "set-agent-command":
        return await handleSetAgentCommand(body, userId);
      case "generate-repair-code":
        return await handleGenerateRepairCode(body, userId);
      case "trigger-style-guide-crawl":
        return await handleTriggerStyleGuideCrawl(userId);
      case "get-style-guide-crawl-status":
        return await handleGetStyleGuideCrawlStatus();
      case "browse-style-guide-files":
        return await handleBrowseStyleGuideFiles(body);
      case "get-openrouter-vision-models":
        return await handleGetOpenrouterVisionModels();
      case "trigger-pdf-backfill":
        return await handleTriggerPdfBackfill();
      case "pause-pdf-backfill":
        return await handlePausePdfBackfill();
      case "resume-pdf-backfill":
        return await handleResumePdfBackfill();
      case "get-pdf-backfill-status":
        return await handleGetPdfBackfillStatus();
      case "trigger-pdf-text-sample":
        return await handleTriggerPdfTextSample(body);
      case "find-ai-pdf-duplicates":
        return await handleFindAiPdfDuplicates();
      case "delete-ai-pdf-duplicates":
        return await handleDeleteAiPdfDuplicates();
      case "get-ai-sentinel-status":
        return await handleGetAiSentinelStatus();
      case "run-ai-sentinel-cleanup":
        return await handleRunAiSentinelCleanup(body);
      case "dismiss-ai-sentinel": {
        const assetIds = body.asset_ids as string[] | undefined;
        if (!Array.isArray(assetIds) || assetIds.length === 0) return err("asset_ids required", 400);
        const db = serviceClient();
        const { error } = await db.from("pdf_text_samples").delete().in("asset_id", assetIds);
        if (error) return err(error.message, 500);
        return json({ ok: true, dismissed: assetIds.length });
      }
      case "snooze-ai-sentinel": {
        const assetIds = body.asset_ids as string[] | undefined;
        if (!Array.isArray(assetIds) || assetIds.length === 0) return err("asset_ids required", 400);
        const db = serviceClient();
        const snoozeUntil = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString();
        // Fetch the relative paths for these assets
        const { data: assets, error: assetsErr } = await db
          .from("assets")
          .select("relative_path")
          .in("id", assetIds);
        if (assetsErr) return err(assetsErr.message, 500);
        // Remove from sentinel list
        await db.from("pdf_text_samples").delete().in("asset_id", assetIds);
        // Add to scanner ignore list with expiry (upsert — may already exist from a prior snooze)
        if (assets && assets.length > 0) {
          await db.from("scanner_ai_ignores").upsert(
            (assets as Array<{ relative_path: string }>).map((a) => ({
              relative_path: a.relative_path,
              reason: "snooze",
              snoozed_until: snoozeUntil,
            })),
            { onConflict: "relative_path" },
          );
        }
        return json({ ok: true, snoozed: assetIds.length, until: snoozeUntil });
      }
      case "trigger-ai-sentinel-scan":
        return await handleTriggerAiSentinelScan(body);
      case "trigger-blank-thumb-cleanup":
        return await handleTriggerBlankThumbCleanup();
      case "get-blank-thumb-cleanup-status":
        return await handleGetBlankThumbCleanupStatus();
      case "backfill-pdf-files-used":
        return await handleBackfillPdfFilesUsed();
      case "resolve-sku-files-used":
        return await handleResolveSkuFilesUsed();
      case "get-pdf-text-samples":
        return await handleGetPdfTextSamples();
      case "reset-pdf-text-sample": {
        const db = serviceClient();
        await db.from("admin_config").delete().eq("key", "PDF_TEXT_SAMPLE_REQUEST");
        return json({ ok: true });
      }

      default:
        return err(`Unknown action: ${action}`, 404);
    }
  } catch (e) {
    const message = formatPostgrestError(e) || "Internal server error";
    console.error("admin-api unhandled error:", message, e);
    return err(message, 500);
  }
});
