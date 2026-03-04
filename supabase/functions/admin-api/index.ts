import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseSku } from "../_shared/sku-parser.ts";
import { extractSkuFolder, selectPrimaryAsset } from "../_shared/style-grouping.ts";

// ── CORS ────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, " +
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

  // Service role key bypass — allows server-to-server calls (e.g., bulk-job-runner)
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey && token === serviceRoleKey) {
    return { userId: "system" };
  }
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  let userId: string;
  try {
    // Try getClaims first, fall back to getUser if not available
    let sub: string | undefined;
    if (typeof anonClient.auth.getClaims === "function") {
      const { data, error: claimsError } = await anonClient.auth.getClaims(token);
      if (claimsError || !data?.claims?.sub) {
        console.error("getClaims failed:", claimsError, "data:", JSON.stringify(data));
        return err("Invalid or expired token", 401);
      }
      sub = data.claims.sub as string;
    } else {
      // Fallback: getClaims not available in this supabase-js version
      const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
      if (userError || !user?.id) {
        console.error("getUser failed:", userError);
        return err("Invalid or expired token", 401);
      }
      sub = user.id;
    }
    userId = sub;
    console.log("Authenticated userId:", userId);
  } catch (e) {
    console.error("Token validation error:", e);
    return err("Invalid or expired token", 401);
  }

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

// ── Retry helper for transient connection resets ────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 200,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message || "";
      const isTransient = msg.includes("connection reset") ||
        msg.includes("connection error") ||
        msg.includes("SendRequest");
      if (!isTransient || attempt === maxAttempts) throw e;
      console.warn(`Transient error (attempt ${attempt}/${maxAttempts}):`, msg);
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  throw new Error("withRetry: unreachable");
}

function formatPostgrestError(error: unknown): string {
  if (!error) return "Unknown database error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  const e = error as Record<string, unknown>;
  const message = typeof e.message === "string" ? e.message : "Database error";
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

interface DoctorIssue {
  severity: "critical" | "warn" | "info";
  code: string;
  title: string;
  details: string;
  recommended_fix: string;
  fix_action?: string; // admin-api action name to call
  fix_payload?: Record<string, unknown>;
  detected_at?: string; // ISO timestamp of when the underlying condition was observed
}

async function handleDoctor() {
  const db = serviceClient();
  const issues: DoctorIssue[] = [];

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
  const BRIDGE_OFFLINE_MS = 2 * 60 * 1000;
  const WINDOWS_OFFLINE_MS = 5 * 60 * 1000;

  const agentStatuses = (agents || []).map((a) => {
    const lastHb = a.last_heartbeat ? new Date(a.last_heartbeat).getTime() : 0;
    const metadata = (a.metadata as Record<string, unknown>) || {};
    const thresholdMs = a.agent_type === "windows-render" ? WINDOWS_OFFLINE_MS : BRIDGE_OFFLINE_MS;
    return {
      id: a.id,
      name: a.agent_name,
      type: a.agent_type,
      status: lastHb > 0 && now - lastHb < thresholdMs ? "online" : "offline",
      last_heartbeat: a.last_heartbeat,
      last_counters: metadata.last_counters || null,
      last_error: metadata.last_error || null,
      scan_roots: metadata.scan_roots || [],
      created_at: a.created_at,
      metadata,
    };
  });

  // 3) Scan progress + request
  const scanProgress = config.SCAN_PROGRESS as Record<string, unknown> | null;
  const scanRequest = config.SCAN_REQUEST as Record<string, unknown> | null;

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

  const { count: failedRenders } = await db
    .from("render_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "failed");

  // ── Issue detection ──

  // No bridge agent registered
  const bridgeAgents = agentStatuses.filter((a) => a.type === "bridge");
  const windowsAgents = agentStatuses.filter((a) => a.type === "windows-render");

  if (bridgeAgents.length === 0) {
    issues.push({
      severity: "critical",
      code: "NO_BRIDGE_AGENT",
      title: "No Bridge Agent registered",
      details: "No NAS Bridge Agent has been paired with the system. File scanning and thumbnail generation cannot operate.",
      recommended_fix: "Generate an install bundle and deploy the Bridge Agent on your Synology NAS.",
    });
  }

  // Bridge agent offline
  for (const agent of bridgeAgents) {
    if (agent.status === "offline") {
      issues.push({
        severity: "critical",
        code: "BRIDGE_OFFLINE",
        title: `Bridge Agent "${agent.name}" is offline`,
        details: `Last heartbeat: ${
          agent.last_heartbeat ? new Date(agent.last_heartbeat as string).toLocaleString() : "never"
        }. The agent is not sending heartbeats.`,
        recommended_fix: "Check that the Docker container is running on the Synology NAS. View logs with 'docker compose logs bridge'.",
        detected_at: agent.last_heartbeat as string || undefined,
      });
    }

    // Check force_stop / scan_abort flags
    const meta = agent.metadata;
    if (meta.force_stop === true || meta.scan_abort === true) {
      issues.push({
        severity: "warn",
        code: "STOP_FLAG_STUCK",
        title: `Agent "${agent.name}" has stop flags enabled`,
        details: `force_stop=${meta.force_stop}, scan_abort=${meta.scan_abort}. The agent will not accept scan jobs or ingest files.`,
        recommended_fix: "Click 'Clear Stop Flags' to resume normal operation.",
        fix_action: "resume-scanning",
        detected_at: agent.last_heartbeat as string || undefined,
      });
    }

    // Check last error
    if (agent.last_error) {
      issues.push({
        severity: "warn",
        code: "BRIDGE_LAST_ERROR",
        title: `Bridge Agent "${agent.name}" reported an error`,
        details: agent.last_error as string,
        recommended_fix: "Check the agent logs for more context. The error may have been transient.",
        detected_at: agent.last_heartbeat as string || undefined,
      });
    }

    // Check scan roots configuration
    const agentDiag = meta.diagnostics as Record<string, unknown> | undefined;
    if (agentDiag) {
      if (agentDiag.mount_root_exists === false) {
        issues.push({
          severity: "critical",
          code: "MOUNT_ROOT_MISSING",
          title: `Mount root not accessible on "${agent.name}"`,
          details: `The configured container mount root (${agentDiag.mount_root_path || "unknown"}) does not exist inside the Docker container.`,
          recommended_fix: "Check the Docker volume mount in docker-compose.yml. The NAS share must be mounted at the configured path.",
        });
      }
      if (Array.isArray(agentDiag.unreadable_roots) && (agentDiag.unreadable_roots as string[]).length > 0) {
        issues.push({
          severity: "critical",
          code: "SCAN_ROOTS_UNREADABLE",
          title: `Scan roots not readable on "${agent.name}"`,
          details: `The following scan roots are not accessible: ${(agentDiag.unreadable_roots as string[]).join(", ")}`,
          recommended_fix: "Verify the scan root paths match directories inside the container mount. Use 'Request Path Test' to validate.",
          fix_action: "request-path-test",
        });
      }
    }
  }

  // Windows agent checks
  for (const agent of windowsAgents) {
    if (agent.status === "offline") {
      issues.push({
        severity: "warn",
        code: "WINDOWS_OFFLINE",
        title: `Windows Agent "${agent.name}" is offline`,
        details: `Last heartbeat: ${agent.last_heartbeat ? new Date(agent.last_heartbeat as string).toLocaleString() : "never"}.`,
        recommended_fix: "Ensure the Windows Render Agent is running on the desktop machine with Adobe Illustrator.",
        detected_at: agent.last_heartbeat as string || undefined,
      });
    }

    const health = agent.metadata.health as Record<string, unknown> | undefined;
    if (health && agent.status === "online") {
      if (health.healthy === false) {
        if (health.illustrator_crash_dialog === true) {
          issues.push({
            severity: "critical",
            code: "ILLUSTRATOR_CRASH_DIALOG",
            title: `Illustrator blocked by crash dialog on "${agent.name}"`,
            details: "Adobe Illustrator is showing a crash recovery or safe mode dialog, preventing COM automation.",
            recommended_fix: "Open Illustrator on the Windows machine, dismiss the dialog, then restart the agent.",
          });
        } else if (health.nas_healthy === false) {
          issues.push({
            severity: "critical",
            code: "WINDOWS_NAS_UNREACHABLE",
            title: `NAS not accessible from Windows Agent "${agent.name}"`,
            details: health.last_preflight_error as string || "The configured NAS path is not reachable from the Windows machine.",
            recommended_fix: "Check the NAS host/share settings and network connectivity. Verify the drive letter mapping if configured.",
          });
        } else if (health.illustrator_healthy === false) {
          issues.push({
            severity: "critical",
            code: "ILLUSTRATOR_COM_FAILED",
            title: `Illustrator COM not working on "${agent.name}"`,
            details: health.last_preflight_error as string || "Illustrator COM automation test failed.",
            recommended_fix: "Ensure Adobe Illustrator is installed and not in a crashed state. The agent requires an interactive desktop session.",
          });
        }
      }

      // Check for non-interactive session
      if (
        typeof health.last_preflight_error === "string" &&
        (health.last_preflight_error as string).includes("NON_INTERACTIVE_SESSION")
      ) {
        issues.push({
          severity: "critical",
          code: "NON_INTERACTIVE_SESSION",
          title: `Windows Agent "${agent.name}" running as a service`,
          details: "The agent is running in Session 0 (Windows Service mode). Illustrator COM requires an interactive desktop session.",
          recommended_fix: "Reinstall the agent as a Scheduled Task instead of a Windows Service. Run the install script from the install bundle.",
        });
      }
    }

    // Circuit breaker
    const versionInfo = agent.metadata.version_info as Record<string, unknown> | undefined;
    if (versionInfo?.update_error) {
      issues.push({
        severity: "warn",
        code: "WINDOWS_UPDATE_FAILED",
        title: `Self-update failed on "${agent.name}"`,
        details: versionInfo.update_error as string,
        recommended_fix: "Check agent logs. The update may need to be downloaded manually.",
      });
    }
  }

  // Scan state issues
  if (scanProgress) {
    const progressStatus = scanProgress.status as string;
    const progressUpdatedAt = scanProgress.updated_at as string | undefined;

    // Stale running scan (no update in 10+ minutes)
    if ((progressStatus === "running" || progressStatus === "scanning") && progressUpdatedAt) {
      const staleMs = now - new Date(progressUpdatedAt).getTime();
      if (staleMs > 10 * 60 * 1000) {
        issues.push({
          severity: "warn",
          code: "SCAN_STALE",
          title: "Scan appears stuck",
          details: `Scan status is "${progressStatus}" but hasn't updated in ${Math.floor(staleMs / 60000)} minutes. The agent may have crashed mid-scan.`,
          recommended_fix: "Click 'Reset Scan State' to clear the stale scan and allow a new scan to start.",
          fix_action: "reset-scan-state",
          detected_at: progressUpdatedAt,
        });
      }
    }

    // Failed scan
    if (progressStatus === "failed") {
      issues.push({
        severity: "warn",
        code: "SCAN_FAILED",
        title: "Last scan failed",
        details: (scanProgress.error as string) || "The most recent scan ended with an error.",
        recommended_fix: "Check the agent logs for details. Reset the scan state and try again.",
        fix_action: "reset-scan-state",
        detected_at: scanProgress.updated_at as string || undefined,
      });
    }
  }

  // Stale scan request
  if (scanRequest) {
    const reqStatus = scanRequest.status as string;
    if (reqStatus === "pending" || reqStatus === "claimed") {
      const reqAt = scanRequest.requested_at as string | undefined;
      if (reqAt) {
        const reqAge = now - new Date(reqAt).getTime();
        if (reqAge > 5 * 60 * 1000) {
          issues.push({
            severity: "warn",
            code: "SCAN_REQUEST_STALE",
            title: "Scan request not being processed",
            details: `A scan request has been "${reqStatus}" for ${Math.floor(reqAge / 60000)} minutes without progress.`,
            recommended_fix: "The Bridge Agent may be offline or stuck. Reset the scan state.",
            fix_action: "reset-scan-state",
          });
        }
      }
    }
  }

  // Config issues
  const scanRoots = config.SCAN_ROOTS as string[] | undefined;
  const mountRoot = config.NAS_CONTAINER_MOUNT_ROOT as string | undefined;

  if (!scanRoots || scanRoots.length === 0) {
    issues.push({
      severity: "warn",
      code: "NO_SCAN_ROOTS",
      title: "No scan roots configured",
      details: "No directories are configured for scanning. The Bridge Agent won't know where to look for files.",
      recommended_fix: "Go to Settings → Scanning and configure at least one scan root.",
    });
  }

  if (scanRoots && mountRoot) {
    const mismatched = scanRoots.filter((r) => !r.startsWith(mountRoot));
    if (mismatched.length > 0) {
      issues.push({
        severity: "critical",
        code: "ROOTS_MISMATCH_MOUNT",
        title: "Scan roots don't match mount root",
        details: `These scan roots don't start with the container mount root "${mountRoot}": ${mismatched.join(", ")}`,
        recommended_fix: "Update the scan roots to be subdirectories of the container mount root, or update the mount root.",
      });
    }
  }

  // Spaces config
  const spacesConfig = config.SPACES_CONFIG as Record<string, string> | undefined;
  if (!spacesConfig || !spacesConfig.bucket_name) {
    issues.push({
      severity: "warn",
      code: "NO_SPACES_CONFIG",
      title: "DigitalOcean Spaces not configured",
      details: "Thumbnail storage is not configured. Thumbnails won't be uploaded.",
      recommended_fix: "Go to Settings → NAS & Storage and configure DigitalOcean Spaces.",
    });
  }

  // Failed render jobs
  if ((failedRenders ?? 0) > 0) {
    issues.push({
      severity: "warn",
      code: "FAILED_RENDERS",
      title: `${failedRenders} failed render jobs`,
      details: "Some .ai files failed to render on the Windows Agent. They may need to be retried or investigated.",
      recommended_fix: "Click 'Requeue Failed Renders' to retry them, or check the Windows Agent tab for details.",
      fix_action: "retry-failed-renders",
    });
  }

  // Pending renders with no windows agent
  if ((pendingRenders ?? 0) > 5 && windowsAgents.every((a) => a.status === "offline")) {
    issues.push({
      severity: "warn",
      code: "RENDERS_NO_AGENT",
      title: `${pendingRenders} render jobs waiting with no Windows Agent online`,
      details: "AI files that require Illustrator rendering are queued but no Windows Render Agent is connected to process them.",
      recommended_fix: "Start the Windows Render Agent or deploy one from Settings → Install Bundles.",
    });
  }

  // All clear
  if (issues.length === 0) {
    issues.push({
      severity: "info",
      code: "ALL_CLEAR",
      title: "System is healthy",
      details: "No issues detected. All agents are online and scanning is operating normally.",
      recommended_fix: "No action needed.",
    });
  }

  // Sort: critical first, then warn, then info
  const severityOrder: Record<string, number> = { critical: 0, warn: 1, info: 2 };
  issues.sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2));

  return json({
    ok: true,
    issues,
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
        failed_renders: failedRenders ?? 0,
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

  // Remove any existing active job for this asset to avoid unique constraint violation
  await db
    .from("render_queue")
    .delete()
    .eq("asset_id", assetId)
    .in("status", ["pending", "claimed"]);

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

// ── Route: create-pairing-code ───────────────────────────────────────

async function handleCreatePairingCode(
  body: Record<string, unknown>,
  userId: string,
) {
  const agentType = requireString(body, "agent_type");
  if (!["bridge", "windows-render"].includes(agentType)) {
    return err("agent_type must be 'bridge' or 'windows-render'");
  }
  const agentName = optionalString(body, "agent_name") || (agentType === "bridge" ? "bridge-agent" : "windows-render-agent");

  const db = serviceClient();

  // Check for an existing valid, unused pairing code for this agent type
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
    return json({
      ok: true,
      pairing_code: existing.pairing_code,
      expires_at: existing.expires_at,
      reused: true,
    });
  }

  // Generate 16-char pairing code formatted as XXXX-XXXX-XXXX-XXXX
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 for readability
  let raw = "";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 16; i++) {
    raw += chars[bytes[i] % chars.length];
  }
  const pairingCode = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes

  const { error } = await db.from("agent_pairings").insert({
    pairing_code: pairingCode,
    agent_type: agentType,
    agent_name: agentName,
    status: "pending",
    created_by: userId,
    expires_at: expiresAt.toISOString(),
  });

  if (error) return err(error.message, 500);
  return json({
    ok: true,
    pairing_code: pairingCode,
    expires_at: expiresAt.toISOString(),
    reused: false,
  });
}

// ── Route: list-pairing-codes ───────────────────────────────────────

async function handleListPairingCodes() {
  const db = serviceClient();
  const { data, error } = await db
    .from("agent_pairings")
    .select("id, pairing_code, agent_type, agent_name, status, created_at, expires_at, consumed_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return err(error.message, 500);
  return json({ ok: true, pairings: data });
}

// ── Route: generate-bootstrap-token (legacy — redirects to create-pairing-code) ──

async function handleGenerateBootstrapToken(userId: string) {
  // Legacy compat: create a windows-render pairing code with 5-min expiry
  const db = serviceClient();

  // Check for an existing valid pairing code
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
    return json({
      ok: true,
      token: existing.pairing_code,
      expires_at: existing.expires_at,
    });
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

  // 1. Write AGENT_UPDATE_REQUEST for bridge agent (reads check_update/apply_update)
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

  // 2. Also set trigger_update flag on Windows Render Agent metadata
  //    so it picks up the update on its next heartbeat (~30s)
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

const DEFAULT_WORKFLOW_FOLDER_MAP: Record<string, string> = {
  "concept approved designs": "concept_approved",
  "in development": "in_development",
  "freelancer art": "freelancer_art",
  "discontinued": "discontinued",
  "product ideas": "product_ideas",
  "in process": "in_process",
  "customer adopted": "customer_adopted",
  "licensor approved": "licensor_approved",
};

async function deriveMetadataFromPath(
  relativePath: string,
  db: ReturnType<typeof serviceClient>,
  licensorMap?: Map<string, string>,
  propertyMap?: Map<string, string>,
): Promise<{
  workflow_status: string;
  is_licensed: boolean;
  licensor_id: string | null;
  property_id: string | null;
}> {
  const pathParts = relativePath.split("/");
  const normalizedParts = pathParts.map((p) => p.trim().toLowerCase());

  // is_licensed is path-authoritative:
  // - Decor/Character Licensed/** => true
  // - Decor/Generic Decor/**      => false
  const decorIndex = normalizedParts.findIndex((p) => p === "decor");
  const subFolder = decorIndex >= 0 ? (normalizedParts[decorIndex + 1] || "") : "";
  const is_licensed = subFolder === "character licensed";

  // Load configurable workflow folder map from admin_config (fallback to defaults)
  let workflowFolderMap = DEFAULT_WORKFLOW_FOLDER_MAP;
  try {
    const { data: wfConfig } = await db
      .from("admin_config")
      .select("value")
      .eq("key", "WORKFLOW_FOLDER_MAP")
      .maybeSingle();
    if (wfConfig?.value && typeof wfConfig.value === "object" && !Array.isArray(wfConfig.value)) {
      workflowFolderMap = wfConfig.value as Record<string, string>;
    }
  } catch (_) { /* use defaults */ }

  // Skip "Concept Approved Designs" as a workflow signal when under ____New Structure (it's structural)
  const hasNewStructure = pathParts.some((p) => p.startsWith("____New Structure"));
  const lowerParts = normalizedParts;
  let workflow_status = "other";
  for (let i = lowerParts.length - 1; i >= 0; i--) {
    const segment = lowerParts[i];
    if (hasNewStructure && segment === "concept approved designs") continue;
    const matched = workflowFolderMap[segment];
    if (matched) {
      workflow_status = matched;
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

  if (licensor_name && licensorMap) {
    licensor_id = licensorMap.get(licensor_name.toLowerCase()) ?? null;
  }

  if (licensor_id && property_name && propertyMap) {
    property_id = propertyMap.get(`${licensor_id}:${property_name.toLowerCase()}`) ?? null;
  }

  return { workflow_status, is_licensed, licensor_id, property_id };
}

// ── Route: reprocess-asset-metadata ─────────────────────────────────

async function handleReprocessAssetMetadata(body: Record<string, unknown>) {
  const offset = typeof body.offset === "number" ? body.offset : 0;
  const BATCH_SIZE = 200;
  const db = serviceClient();

  const { data: allLicensors } = await db
    .from("licensors")
    .select("id, name");
  const { data: allProperties } = await db
    .from("properties")
    .select("id, name, licensor_id");

  const licensorMap = new Map(
    (allLicensors ?? []).map((l) => [l.name.toLowerCase(), l.id]),
  );
  const propertyMap = new Map(
    (allProperties ?? []).map((p) => [`${p.licensor_id}:${p.name.toLowerCase()}`, p.id]),
  );

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
    const derived = await deriveMetadataFromPath(asset.relative_path, db, licensorMap, propertyMap);

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
      const skuFields: Record<string, string | null> = {
        sku: parsed.sku,
        mg01_code: parsed.mg01_code,
        mg01_name: parsed.mg01_name,
        mg02_code: parsed.mg02_code,
        mg02_name: parsed.mg02_name,
        mg03_code: parsed.mg03_code,
        mg03_name: parsed.mg03_name,
        size_code: parsed.size_code,
        size_name: parsed.size_name,
        licensor_code: parsed.licensor_code,
        licensor_name: parsed.licensor_name,
        property_code: parsed.property_code,
        property_name: parsed.property_name,
        sku_sequence: parsed.sku_sequence,
        product_category: parsed.product_category,
        division_code: parsed.division_code,
        division_name: parsed.division_name,
        // NOTE: is_licensed intentionally excluded — path-derived is authoritative
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
  const forceRestart = body.force_restart === true;
  const db = serviceClient();

  const STATE_KEY = "REBUILD_STYLE_GROUPS_STATE";
  const DEFAULT_CLEAR_BATCH = 200;
  const DEFAULT_CLEAR_MIN_BATCH = 25;
  const GROUP_DELETE_BATCH = 200;
  const DEFAULT_REBUILD_BATCH = 250;
  const DEFAULT_REBUILD_MAX_GROUPS_PER_CALL = 50;

  type RebuildState = {
    stage: "clear_assets" | "delete_groups" | "rebuild_assets" | "finalize_stats";
    last_asset_id?: string | null;
    last_group_id?: string | null;
    last_rebuild_asset_id?: string | null;
    last_stats_group_id?: string | null;
    total_assets?: number;
    total_groups?: number;
    total_processed?: number;
    started_at?: string;
    finalize_sub?: string;
    finalize_cursor?: number;
    // legacy compatibility (old implementation)
    rebuild_offset?: number;
  };

  async function saveState(state: RebuildState) {
    const now = new Date().toISOString();
    await db.from("admin_config").upsert({
      key: STATE_KEY,
      value: state,
      updated_at: now,
      updated_by: null,
    });
  }

  async function clearState() {
    await db.from("admin_config").delete().eq("key", STATE_KEY);
  }

  const normalizeState = (state: RebuildState | null): RebuildState => ({
    stage: state?.stage ?? "clear_assets",
    last_asset_id: state?.last_asset_id ?? null,
    last_group_id: state?.last_group_id ?? null,
    last_rebuild_asset_id: state?.last_rebuild_asset_id ?? null,
    last_stats_group_id: state?.last_stats_group_id ?? null,
    total_assets: state?.total_assets,
    total_groups: state?.total_groups,
    total_processed: state?.total_processed ?? 0,
    started_at: state?.started_at ?? new Date().toISOString(),
  });

  const { data: existingStateRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", STATE_KEY)
    .maybeSingle();

  let state = (existingStateRow?.value as RebuildState | null) ?? null;

  // Start fresh only when explicitly requested; otherwise resume existing state.
  if (offset === 0 && forceRestart) {
    state = normalizeState(null);
    await saveState(state);
  }

  state = normalizeState(state);

  // Ensure we know total assets once per rebuild for UI verbosity.
  if (typeof state.total_assets !== "number") {
    const { count, error: countErr } = await db
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false);
    if (countErr) return err(formatPostgrestError(countErr), 500);
    state.total_assets = count ?? 0;
    await saveState(state);
  }

  // Legacy state compatibility: restart stage 3 safely on new cursor logic
  if (state.stage === "rebuild_assets" && state.last_rebuild_asset_id === undefined) {
    state = {
      ...state,
      stage: "rebuild_assets",
      last_rebuild_asset_id: null,
      last_stats_group_id: null,
    };
    await saveState(state);
  }

  let clearBatch = DEFAULT_CLEAR_BATCH;
  let clearMinBatch = DEFAULT_CLEAR_MIN_BATCH;
  let rebuildBatch = DEFAULT_REBUILD_BATCH;
  let rebuildMaxGroupsPerCall = DEFAULT_REBUILD_MAX_GROUPS_PER_CALL;
  try {
    const { data: knobRows } = await db
      .from("admin_config")
      .select("key, value")
      .in("key", [
        "CLEAR_ASSET_BATCH_SIZE",
        "CLEAR_ASSET_MIN_BATCH_SIZE",
        "REBUILD_ASSET_BATCH_SIZE",
        "REBUILD_MAX_GROUPS_PER_CALL",
      ]);

    for (const row of knobRows ?? []) {
      const raw = row?.value;
      const normalized = (raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)) ? (raw as Record<string, unknown>).value : raw;
      const parsed = typeof normalized === "number" ? normalized : parseInt(String(normalized), 10);
      if (row.key === "CLEAR_ASSET_BATCH_SIZE" && Number.isFinite(parsed) && parsed > 0) {
        clearBatch = parsed;
      }
      if (row.key === "CLEAR_ASSET_MIN_BATCH_SIZE" && Number.isFinite(parsed) && parsed > 0) {
        clearMinBatch = parsed;
      }
      if (row.key === "REBUILD_ASSET_BATCH_SIZE" && Number.isFinite(parsed) && parsed > 0) {
        rebuildBatch = parsed;
      }
      if (row.key === "REBUILD_MAX_GROUPS_PER_CALL" && Number.isFinite(parsed) && parsed > 0) {
        rebuildMaxGroupsPerCall = parsed;
      }
    }

    clearMinBatch = Math.max(1, Math.min(clearMinBatch, clearBatch));
  } catch {
    // defaults are fine
  }

  // Stage 1: clear style_group_id via server-side DB function with adaptive batch halving on timeout
  if (state.stage === "clear_assets") {
    const isStatementTimeout = (msg: string) => {
      const s = (msg || "").toLowerCase();
      return s.includes("57014") || s.includes("statement timeout") || s.includes("canceling statement due to statement timeout");
    };

    let batchSize = Math.max(clearMinBatch, clearBatch);
    let result: { cleared_count?: number; last_id?: string | null; has_more?: boolean } | null = null;
    let lastErr: string | null = null;

    while (batchSize >= clearMinBatch) {
      const { data: rpcResult, error: rpcErr } = await db.rpc("clear_style_group_batch", {
        p_last_id: state.last_asset_id ?? null,
        p_batch_size: batchSize,
      });

      if (!rpcErr) {
        result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
        break;
      }

      const msg = formatPostgrestError(rpcErr);
      lastErr = msg;
      if (!isStatementTimeout(msg) || batchSize === clearMinBatch) {
        return json({
          ok: false,
          error: msg,
          stage: "clear_assets",
          substage: "rpc",
          attempted_batch_size: batchSize,
          min_batch_size: clearMinBatch,
        }, 500);
      }

      const nextBatch = Math.max(clearMinBatch, Math.floor(batchSize / 2));
      console.warn(`clear_assets timeout at batch=${batchSize}, retrying with batch=${nextBatch}`);
      if (nextBatch === batchSize) break;
      batchSize = nextBatch;
    }

    if (!result) {
      return json({
        ok: false,
        error: lastErr || "clear_assets failed after adaptive retries",
        stage: "clear_assets",
        substage: "adaptive_retry",
        min_batch_size: clearMinBatch,
      }, 500);
    }

    const clearedCount = result?.cleared_count ?? 0;
    const lastId = result?.last_id ?? null;
    const hasMore = result?.has_more ?? false;

    const nextState: RebuildState = !hasMore
      ? {
        ...state,
        stage: "delete_groups",
        last_asset_id: null,
        last_group_id: null,
      }
      : {
        ...state,
        stage: "clear_assets",
        last_asset_id: lastId,
      };

    await saveState(nextState);

    return json({
      ok: true,
      stage: "clear_assets",
      substage: null,
      done: false,
      nextOffset: offset + 1,
      cleared_assets: clearedCount,
      clear_batch_size_used: batchSize,
      total_processed: nextState.total_processed ?? 0,
      total_assets: nextState.total_assets ?? 0,
      resumed: offset === 0 && !forceRestart && !!existingStateRow?.value,
    });
  }

  // Stage 2: delete existing style groups in chunks
  if (state.stage === "delete_groups") {
    let q = db
      .from("style_groups")
      .select("id")
      .order("id", { ascending: true })
      .limit(GROUP_DELETE_BATCH);

    if (state.last_group_id) {
      q = q.gt("id", state.last_group_id);
    }

    const { data: rows, error: fetchErr } = await q;
    if (fetchErr) return json({ ok: false, error: formatPostgrestError(fetchErr), stage: "delete_groups", substage: null }, 500);

    const ids = (rows ?? []).map((r) => r.id as string);
    if (ids.length > 0) {
      await withRetry(async () => {
        const { error: delErr } = await db.from("style_groups").delete().in("id", ids);
        if (delErr) {
          throw new Error(
            `delete_groups batch failed (size=${ids.length}, last_group_id=${state?.last_group_id ?? "none"}): ${formatPostgrestError(delErr)}`,
          );
        }
        return true;
      });
    }

    const reachedEnd = ids.length < GROUP_DELETE_BATCH;
    const nextState: RebuildState = reachedEnd
      ? {
        ...state,
        stage: "rebuild_assets",
        last_group_id: null,
        last_rebuild_asset_id: null,
      }
      : {
        ...state,
        stage: "delete_groups",
        last_group_id: ids[ids.length - 1],
      };

    await saveState(nextState);

    return json({
      ok: true,
      stage: "delete_groups",
      substage: null,
      done: false,
      nextOffset: offset + 1,
      groups_deleted: ids.length,
      total_processed: nextState.total_processed ?? 0,
      total_assets: nextState.total_assets ?? 0,
      resumed: offset === 0 && !forceRestart && !!existingStateRow?.value,
    });
  }

  // Stage 3: assign assets -> groups (bulk upsert + bulk assignment RPC)
  if (state.stage === "rebuild_assets") {
    const isStatementTimeout = (msg: string) => {
      const s = msg.toLowerCase();
      return s.includes("57014") ||
        s.includes("statement timeout") ||
        s.includes("canceling statement due to statement timeout");
    };

    try {
      let q = db
        .from("assets")
        .select(
          "id, relative_path, filename, file_type, created_at, modified_at, workflow_status, is_licensed, licensor_id, licensor_code, licensor_name, property_id, property_code, property_name, product_category, division_code, division_name, mg01_code, mg01_name, mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name",
        )
        .eq("is_deleted", false)
        .order("id", { ascending: true })
        .limit(rebuildBatch);

      if (state.last_rebuild_asset_id) {
        q = q.gt("id", state.last_rebuild_asset_id);
      }

      const { data: fetchedAssets, error: fetchErr } = await q;
      if (fetchErr) {
        return json({ ok: false, error: formatPostgrestError(fetchErr), stage: "rebuild_assets", substage: "fetch_assets" }, 500);
      }

      const assets = fetchedAssets ?? [];
      if (assets.length === 0) {
        const nextState: RebuildState = {
          ...state,
          stage: "finalize_stats",
          last_stats_group_id: null,
        };
        await saveState(nextState);
        return json({
          ok: true,
          stage: "rebuild_assets",
          groups_created: 0,
          assets_assigned: 0,
          assets_ungrouped: 0,
          total_processed: nextState.total_processed ?? 0,
          total_assets: nextState.total_assets ?? 0,
          done: false,
          nextOffset: offset + 1,
          resumed: offset === 0 && !forceRestart && !!existingStateRow?.value,
        });
      }

      let processUntil = assets.length;
      if (rebuildMaxGroupsPerCall > 0) {
        const seenSkus = new Set<string>();
        for (let i = 0; i < assets.length; i++) {
          const sku = extractSkuFolder(assets[i].relative_path);
          if (!sku) continue;
          if (!seenSkus.has(sku) && seenSkus.size >= rebuildMaxGroupsPerCall) {
            processUntil = i;
            break;
          }
          seenSkus.add(sku);
        }
      }

      const processBatch = assets.slice(0, Math.max(1, processUntil));
      const skuMap = new Map<string, typeof processBatch>();
      let ungrouped = 0;

      for (const asset of processBatch) {
        const sku = extractSkuFolder(asset.relative_path);
        if (!sku) {
          ungrouped++;
          continue;
        }
        if (!skuMap.has(sku)) skuMap.set(sku, []);
        skuMap.get(sku)!.push(asset);
      }

      const groupRows = Array.from(skuMap.entries()).map(([sku, members]) => {
        const skuUpper = sku.toUpperCase();
        const first = members.find((m) => m.filename.toUpperCase().includes(skuUpper)) ?? members[0];
        const pathParts = first.relative_path.split("/");
        const skuIdx = pathParts.lastIndexOf(sku);
        const folderPath = skuIdx >= 0 ? pathParts.slice(0, skuIdx + 1).join("/") : pathParts.slice(0, -1).join("/");

        return {
          sku,
          folder_path: folderPath,
          is_licensed: first.is_licensed ?? false,
          licensor_id: (first as { licensor_id?: string | null }).licensor_id ?? null,
          licensor_code: first.licensor_code,
          licensor_name: first.licensor_name,
          property_id: (first as { property_id?: string | null }).property_id ?? null,
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
        };
      });

      let groupsCreated = 0;
      let assetsAssigned = 0;

      if (groupRows.length > 0) {
        const allUpsertedGroups: Array<{ id: string; sku: string }> = [];
        let groupCursor = 0;
        let groupChunkSize = Math.min(100, groupRows.length);
        const GROUP_CHUNK_MIN = 10;

        while (groupCursor < groupRows.length) {
          const chunk = groupRows.slice(groupCursor, groupCursor + groupChunkSize);
          const { data: upsertedGroups, error: upsertErr } = await db
            .from("style_groups")
            .upsert(chunk, { onConflict: "sku" })
            .select("id, sku");

          if (upsertErr) {
            const msg = formatPostgrestError(upsertErr);
            if (isStatementTimeout(msg) && groupChunkSize > GROUP_CHUNK_MIN) {
              groupChunkSize = Math.max(GROUP_CHUNK_MIN, Math.ceil(groupChunkSize / 2));
              continue;
            }
            return json({
              ok: false,
              error: msg,
              stage: "rebuild_assets",
              substage: "upsert_groups",
            }, 500);
          }

          allUpsertedGroups.push(...(upsertedGroups ?? []) as Array<{ id: string; sku: string }>);
          groupCursor += chunk.length;
        }

        const groupIdBySku = new Map<string, string>(
          allUpsertedGroups.map((g) => [g.sku, g.id]),
        );

        const assignments: Array<{ asset_id: string; style_group_id: string }> = [];
        for (const [sku, members] of skuMap) {
          const groupId = groupIdBySku.get(sku);
          if (!groupId) continue;
          for (const m of members) {
            assignments.push({ asset_id: m.id, style_group_id: groupId });
          }
        }

        if (assignments.length > 0) {
          let assignCursor = 0;
          let assignChunkSize = Math.min(200, assignments.length);
          const ASSIGN_CHUNK_MIN = 25;

          while (assignCursor < assignments.length) {
            const chunk = assignments.slice(assignCursor, assignCursor + assignChunkSize);
            const { data: assignedCount, error: assignErr } = await db.rpc("bulk_assign_style_groups", {
              p_assignments: chunk,
            });

            if (assignErr) {
              const msg = formatPostgrestError(assignErr);
              if (isStatementTimeout(msg) && assignChunkSize > ASSIGN_CHUNK_MIN) {
                assignChunkSize = Math.max(ASSIGN_CHUNK_MIN, Math.ceil(assignChunkSize / 2));
                continue;
              }
              return json({
                ok: false,
                error: msg,
                stage: "rebuild_assets",
                substage: "assign_assets",
              }, 500);
            }

            assetsAssigned += typeof assignedCount === "number" ? assignedCount : chunk.length;
            assignCursor += chunk.length;
          }
        }

        groupsCreated = allUpsertedGroups.length;
      }

      const totalProcessed = (state.total_processed ?? 0) + processBatch.length;
      const reachedEnd = assets.length < rebuildBatch;
      const nextState: RebuildState = reachedEnd
        ? {
          ...state,
          stage: "finalize_stats",
          last_stats_group_id: null,
          total_processed: totalProcessed,
        }
        : {
          ...state,
          stage: "rebuild_assets",
          last_rebuild_asset_id: processBatch[processBatch.length - 1].id,
          total_processed: totalProcessed,
        };

      await saveState(nextState);

      return json({
        ok: true,
        stage: "rebuild_assets",
        substage: "complete_batch",
        groups_created: groupsCreated,
        assets_assigned: assetsAssigned,
        assets_ungrouped: ungrouped,
        total_processed: totalProcessed,
        total_assets: nextState.total_assets ?? 0,
        done: false,
        nextOffset: offset + 1,
        resumed: offset === 0 && !forceRestart && !!existingStateRow?.value,
      });
    } catch (e) {
      const msg = (e as Error).message || "Unknown error in rebuild stage 3";
      console.error("rebuild-style-groups stage 3 error:", msg);
      return json({ ok: false, error: msg, stage: "rebuild_assets", substage: "unhandled" }, 500);
    }
  }

  // Stage 4: finalize stats — three-phase: counts in batches, then primaries in batches
  if (state.stage === "finalize_stats") {
    // Load admin_config knobs for tunable batch sizes
    let COUNTS_BATCH = 100;
    let PRIMARIES_BATCH = 50;
    try {
      const { data: knobRow } = await db
        .from("admin_config")
        .select("key, value")
        .in("key", ["REBUILD_FINALIZE_BATCH_SIZE", "REBUILD_PRIMARIES_BATCH_SIZE"]);
      for (const r of knobRow ?? []) {
        const raw = (r.value && typeof r.value === "object" && "value" in (r.value as Record<string, unknown>))
          ? (r.value as Record<string, unknown>).value
          : r.value;
        const num = typeof raw === "number" ? raw : parseInt(String(raw), 10);
        if (r.key === "REBUILD_FINALIZE_BATCH_SIZE" && Number.isFinite(num) && num > 0) COUNTS_BATCH = num;
        if (r.key === "REBUILD_PRIMARIES_BATCH_SIZE" && Number.isFinite(num) && num > 0) PRIMARIES_BATCH = num;
      }
    } catch { /* use defaults */ }

    const subStage = state.finalize_sub ?? "counts";

    try {
      if (subStage === "counts") {
        // Initialize total group count once for finalize progress UI
        if (typeof state.total_groups !== "number") {
          const { count: totalGroups, error: totalGroupsErr } = await db
            .from("style_groups")
            .select("id", { count: "exact", head: true });
          if (totalGroupsErr) {
            return json({ ok: false, error: formatPostgrestError(totalGroupsErr), stage: "finalize_stats", substage: "counts" }, 500);
          }
          state.total_groups = totalGroups ?? 0;
          await saveState(state);
        }

        // Phase A: aggregate counts + latest_file_date using keyset pagination
        let q = db
          .from("style_groups")
          .select("id")
          .order("id", { ascending: true })
          .limit(COUNTS_BATCH);

        if (state.last_stats_group_id) {
          q = q.gt("id", state.last_stats_group_id);
        }

        const { data: groupIds, error: fetchErr } = await q;

        if (fetchErr) return json({ ok: false, error: formatPostgrestError(fetchErr), stage: "finalize_stats", substage: "counts" }, 500);

        if (!groupIds || groupIds.length === 0) {
          // Move to primaries sub-stage
          state.finalize_sub = "primaries";
          state.finalize_cursor = 0;
          state.last_stats_group_id = null;
          await saveState(state);
          return json({
            ok: true,
            stage: "finalize_stats",
            sub: "counts_done",
            counts_processed: state.total_groups ?? 0,
            finalize_total_groups: state.total_groups ?? 0,
            total_processed: state.total_processed ?? 0,
            total_assets: state.total_assets ?? 0,
            done: false,
            nextOffset: offset + 1,
          });
        }

        const ids = groupIds.map((g: { id: string }) => g.id);
        // Adaptive: try batch, halve on timeout
        let batchIds = ids;
        while (batchIds.length > 0) {
          try {
            const { error: countErr } = await db.rpc("refresh_style_group_counts_batch", { p_group_ids: batchIds });
            if (countErr) {
              const msg = formatPostgrestError(countErr);
              if (msg.includes("57014") && batchIds.length > 1) {
                // Statement timeout — halve and retry
                console.warn(`finalize counts timeout, halving batch from ${batchIds.length} to ${Math.ceil(batchIds.length / 2)}`);
                batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
                continue;
              }
              return json({ ok: false, error: msg, stage: "finalize_stats", substage: "counts" }, 500);
            }
            break;
          } catch (e) {
            const msg = (e as Error).message || "";
            if (msg.includes("57014") && batchIds.length > 1) {
              batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
              continue;
            }
            throw e;
          }
        }

        // If we had to halve, only advance by what we actually processed
        const processedCount = batchIds.length;
        state.finalize_cursor = (state.finalize_cursor ?? 0) + processedCount;
        state.last_stats_group_id = batchIds[processedCount - 1] ?? state.last_stats_group_id ?? null;
        await saveState(state);

        return json({
          ok: true,
          stage: "finalize_stats",
          sub: "counts",
          counts_processed: state.finalize_cursor,
          finalize_total_groups: state.total_groups ?? 0,
          total_processed: state.total_processed ?? 0,
          total_assets: state.total_assets ?? 0,
          done: false,
          nextOffset: offset + 1,
        });
      }

      if (subStage === "primaries") {
        // Ensure finalize total exists for progress UI
        if (typeof state.total_groups !== "number") {
          const { count: totalGroups, error: totalGroupsErr } = await db
            .from("style_groups")
            .select("id", { count: "exact", head: true });
          if (totalGroupsErr) {
            return json({ ok: false, error: formatPostgrestError(totalGroupsErr), stage: "finalize_stats", substage: "primaries" }, 500);
          }
          state.total_groups = totalGroups ?? 0;
          await saveState(state);
        }

        // Phase B: update primary_asset_id using keyset pagination
        let q = db
          .from("style_groups")
          .select("id")
          .order("id", { ascending: true })
          .limit(PRIMARIES_BATCH);

        if (state.last_stats_group_id) {
          q = q.gt("id", state.last_stats_group_id);
        }

        const { data: groupIds, error: fetchErr } = await q;

        if (fetchErr) return json({ ok: false, error: formatPostgrestError(fetchErr), stage: "finalize_stats", substage: "primaries" }, 500);

        if (!groupIds || groupIds.length === 0) {
          // All done — clear state
          await clearState();
          return json({
            ok: true,
            stage: "finalize_stats",
            sub: "complete",
            primaries_processed: state.total_groups ?? 0,
            finalize_total_groups: state.total_groups ?? 0,
            total_processed: state.total_processed ?? 0,
            total_assets: state.total_assets ?? 0,
            done: true,
            nextOffset: offset + 1,
          });
        }

        const ids = groupIds.map((g: { id: string }) => g.id);
        // Adaptive: try batch, halve on timeout
        let batchIds = ids;
        while (batchIds.length > 0) {
          try {
            const { error: primErr } = await db.rpc("refresh_style_group_primaries", { p_group_ids: batchIds });
            if (primErr) {
              const msg = formatPostgrestError(primErr);
              if (msg.includes("57014") && batchIds.length > 1) {
                console.warn(`finalize primaries timeout, halving batch from ${batchIds.length} to ${Math.ceil(batchIds.length / 2)}`);
                batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
                continue;
              }
              return json({ ok: false, error: msg, stage: "finalize_stats", substage: "primaries" }, 500);
            }
            break;
          } catch (e) {
            const msg = (e as Error).message || "";
            if (msg.includes("57014") && batchIds.length > 1) {
              batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
              continue;
            }
            throw e;
          }
        }

        const processedCount = batchIds.length;
        state.finalize_cursor = (state.finalize_cursor ?? 0) + processedCount;
        state.last_stats_group_id = batchIds[processedCount - 1] ?? state.last_stats_group_id ?? null;
        await saveState(state);

        return json({
          ok: true,
          stage: "finalize_stats",
          sub: "primaries",
          primaries_processed: state.finalize_cursor,
          finalize_total_groups: state.total_groups ?? 0,
          total_processed: state.total_processed ?? 0,
          total_assets: state.total_assets ?? 0,
          done: false,
          nextOffset: offset + 1,
        });
      }

      return json({ ok: false, error: "Unknown finalize sub-stage", stage: "finalize_stats", substage: subStage }, 500);
    } catch (e) {
      const msg = (e as Error).message || "Unknown error in rebuild stage 4";
      console.error("rebuild-style-groups stage 4 error:", msg);
      return json({ ok: false, error: msg, stage: "finalize_stats", substage: subStage }, 500);
    }
  }

  return err("Unknown rebuild state", 500);
}

// ── Route: reconcile-style-group-stats ───────────────────────────────

async function handleReconcileStyleGroupStats(body: Record<string, unknown>) {
  try {
    const offset = typeof body.offset === "number" ? body.offset : 0;
    const db = serviceClient();

    const STATE_KEY = "RECONCILE_STYLE_GROUPS_STATE";

    type ReconcileState = {
      sub: "counts" | "primaries";
      cursor: number;
    };

    const isStatementTimeout = (msg: string) => {
      const s = (msg || "").toLowerCase();
      return s.includes("57014") || s.includes("statement timeout") || s.includes("canceling statement due to statement timeout");
    };

    const { data: stateRow } = await db
      .from("admin_config")
      .select("value")
      .eq("key", STATE_KEY)
      .maybeSingle();

    let state = (stateRow?.value as ReconcileState | null) ?? { sub: "counts", cursor: 0 };

    // On first call, reset state
    if (offset === 0 && !stateRow) {
      state = { sub: "counts", cursor: 0 };
    }

    const BATCH = 100;

    async function saveRecState(s: ReconcileState) {
      await db.from("admin_config").upsert({
        key: STATE_KEY,
        value: s,
        updated_at: new Date().toISOString(),
        updated_by: null,
      });
    }

    if (state.sub === "counts") {
      const { data: groupIds, error: fetchErr } = await db
        .from("style_groups")
        .select("id")
        .order("id")
        .range(state.cursor, state.cursor + BATCH - 1);

      if (fetchErr) return json({ ok: false, error: formatPostgrestError(fetchErr), stage: "reconcile", substage: "counts" }, 500);

      if (!groupIds || groupIds.length === 0) {
        state = { sub: "primaries", cursor: 0 };
        await saveRecState(state);
        return json({ ok: true, sub: "counts_done", counts_processed: state.cursor, done: false, nextOffset: offset + 1 });
      }

      const ids = groupIds.map((g: { id: string }) => g.id);
      let batchIds = ids;
      while (batchIds.length > 0) {
        const { error: countErr } = await db.rpc("refresh_style_group_counts_batch", { p_group_ids: batchIds });
        if (!countErr) break;

        const msg = formatPostgrestError(countErr);
        if (isStatementTimeout(msg) && batchIds.length > 1) {
          batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
          continue;
        }

        return json({
          ok: false,
          error: msg,
          stage: "reconcile",
          substage: "counts",
          attempted_batch_size: batchIds.length,
        }, 500);
      }

      state.cursor += batchIds.length;
      await saveRecState(state);
      return json({ ok: true, sub: "counts", counts_processed: state.cursor, done: false, nextOffset: offset + 1 });
    }

    if (state.sub === "primaries") {
      const { data: groupIds, error: fetchErr } = await db
        .from("style_groups")
        .select("id")
        .order("id")
        .range(state.cursor, state.cursor + BATCH - 1);

      if (fetchErr) return json({ ok: false, error: formatPostgrestError(fetchErr), stage: "reconcile", substage: "primaries" }, 500);

      if (!groupIds || groupIds.length === 0) {
        // Done — clean up state
        await db.from("admin_config").delete().eq("key", STATE_KEY);
        return json({ ok: true, sub: "complete", primaries_processed: state.cursor, done: true, nextOffset: offset + 1 });
      }

      const ids = groupIds.map((g: { id: string }) => g.id);
      let batchIds = ids;
      while (batchIds.length > 0) {
        const { error: primErr } = await db.rpc("refresh_style_group_primaries", { p_group_ids: batchIds });
        if (!primErr) break;

        const msg = formatPostgrestError(primErr);
        if (isStatementTimeout(msg) && batchIds.length > 1) {
          batchIds = batchIds.slice(0, Math.ceil(batchIds.length / 2));
          continue;
        }

        return json({
          ok: false,
          error: msg,
          stage: "reconcile",
          substage: "primaries",
          attempted_batch_size: batchIds.length,
        }, 500);
      }

      state.cursor += batchIds.length;
      await saveRecState(state);
      return json({ ok: true, sub: "primaries", primaries_processed: state.cursor, done: false, nextOffset: offset + 1 });
    }

    return json({ ok: false, error: "Unknown reconcile sub-stage", stage: "reconcile", substage: "unknown" }, 500);
  } catch (e) {
    const msg = e instanceof Error ? e.message : formatPostgrestError(e);
    console.error("reconcile-style-group-stats unhandled:", msg);
    return json({ ok: false, error: msg || "Internal server error", stage: "reconcile", substage: "unhandled" }, 500);
  }
}

// ── Route: generate-install-bundle ──────────────────────────────────

async function handleGenerateInstallBundle(
  body: Record<string, unknown>,
  userId: string,
) {
  const { default: JSZip } = await import("https://esm.sh/jszip@3.10.1");

  const agentType = requireString(body, "agent_type");
  if (!["bridge", "windows-render"].includes(agentType)) {
    return err("agent_type must be 'bridge' or 'windows-render'");
  }

  const agentName = optionalString(body, "agent_name") ||
    (agentType === "bridge" ? "bridge-agent" : "windows-render-agent");
  const enableWatchtower = body.enable_watchtower === true;
  const updateChannel = optionalString(body, "update_channel") || "stable";

  // Bridge-specific options
  const nasHostPath = optionalString(body, "nas_host_path") || "/volume1/nas-share";
  const containerMountRoot = optionalString(body, "container_mount_root") || "/mnt/nas/mac";
  const scanRoots = Array.isArray(body.scan_roots) ? (body.scan_roots as string[]).filter(Boolean) : [];

  // Windows-specific options
  const desiredDriveLetter = optionalString(body, "desired_drive_letter") || "";
  const nasHost = optionalString(body, "nas_host") || "";
  const nasShare = optionalString(body, "nas_share") || "";

  // Create pairing code (reuse existing logic)
  const db = serviceClient();
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

  const { error: pairErr } = await db.from("agent_pairings").insert({
    pairing_code: pairingCode,
    agent_type: agentType,
    agent_name: agentName,
    status: "pending",
    created_by: userId,
    expires_at: expiresAt.toISOString(),
  });
  if (pairErr) return err(pairErr.message, 500);

  const serverUrl = Deno.env.get("SUPABASE_URL")!;
  const zip = new JSZip();

  if (agentType === "bridge") {
    // ── .env ──
    const envContent = [
      "# PopDAM Bridge Agent — generated " + now.toISOString(),
      "# This pairing code expires in 15 minutes. Deploy promptly.",
      "",
      "POPDAM_SERVER_URL=" + serverUrl,
      "POPDAM_PAIRING_CODE=" + pairingCode,
      "AGENT_NAME=" + agentName,
      "",
      "# Volume mapping (set in docker-compose.yml)",
      "NAS_CONTAINER_MOUNT_ROOT=" + containerMountRoot,
      ...(scanRoots.length > 0 ? ["SCAN_ROOTS=" + scanRoots.map((r) => `${containerMountRoot}/${r}`).join(",")] : ["# SCAN_ROOTS=" + containerMountRoot]),
    ].join("\n") + "\n";

    // ── docker-compose.yml ──
    let compose = [
      "# PopDAM Bridge Agent — Synology Container Manager",
      "# Import: Container Manager → Project → Create → select this folder",
      'version: "3.8"',
      "services:",
      "  bridge-agent:",
      "    image: ghcr.io/u2giants/popdam-bridge:" + updateChannel,
      "    container_name: popdam-bridge",
      "    restart: unless-stopped",
      "    env_file: .env",
      "    cpu_shares: 1024",
      "    mem_limit: 2g",
      "    volumes:",
      `      - ${nasHostPath}:${containerMountRoot}:ro`,
      "      - popdam-data:/data",
      "      - /var/run/docker.sock:/var/run/docker.sock",
    ].join("\n");

    if (enableWatchtower) {
      compose += "\n" + [
        "",
        "  watchtower:",
        "    image: containrrr/watchtower",
        "    container_name: popdam-watchtower",
        "    restart: unless-stopped",
        "    volumes:",
        "      - /var/run/docker.sock:/var/run/docker.sock",
        "    environment:",
        "      - WATCHTOWER_POLL_INTERVAL=3600",
        "      - WATCHTOWER_CLEANUP=true",
        "      - WATCHTOWER_SCOPE=popdam",
        "    labels:",
        '      - "com.centurylinklabs.watchtower.scope=popdam"',
      ].join("\n");
      // Add label to bridge-agent too
      compose = compose.replace(
        "      - /var/run/docker.sock:/var/run/docker.sock\n",
        "      - /var/run/docker.sock:/var/run/docker.sock\n    labels:\n" +
          '      - "com.centurylinklabs.watchtower.scope=popdam"\n',
      );
    }

    compose += "\n\nvolumes:\n  popdam-data:\n";

    // ── README.txt ──
    const readme = [
      "╔══════════════════════════════════════════════════╗",
      "║        PopDAM Bridge Agent — Quick Start         ║",
      "╚══════════════════════════════════════════════════╝",
      "",
      "IMPORTANT: This pairing code expires in 15 minutes!",
      "Deploy this bundle promptly after downloading.",
      "",
      "── STEP 1: Copy to Synology ───────────────────────",
      "Copy this entire folder to your NAS, e.g.:",
      "  /volume1/docker/popdam/",
      "",
      "── STEP 2: Deploy ────────────────────────────────",
      "Open Synology Container Manager → Project → Create",
      "  • Project name: popdam",
      "  • Path: /volume1/docker/popdam",
      "  • Click 'Build & Run'",
      "",
      "Or via SSH:",
      "  cd /volume1/docker/popdam",
      "  docker compose up -d",
      "",
      "── STEP 3: Verify ────────────────────────────────",
      "Check logs:",
      "  docker compose logs -f bridge-agent",
      "",
      "You should see 'Pairing successful' within 30 seconds.",
      "After pairing, the agent will begin scanning automatically.",
      "",
      "── Updating ──────────────────────────────────────",
      enableWatchtower ? "Watchtower is enabled and will auto-update every hour." : "To update manually:\n  docker compose pull\n  docker compose up -d",
      "",
      "── Troubleshooting ───────────────────────────────",
      "• Check agent status in PopDAM Settings → Agents",
      "• Logs: docker compose logs --tail 50 bridge-agent",
      "• If pairing code expired, download a new bundle",
      "",
      "Agent name: " + agentName,
      "Server: " + serverUrl,
      "Generated: " + now.toISOString(),
    ].join("\n");

    zip.file(".env", envContent);
    zip.file("docker-compose.yml", compose);
    zip.file("README.txt", readme);
  } else {
    // ── Windows Render Agent ──

    // ── install.ps1 ──
    const installPs1 = [
      "#Requires -RunAsAdministrator",
      "<#",
      ".SYNOPSIS",
      "  PopDAM Windows Render Agent — Automated Installer",
      "  Generated: " + now.toISOString(),
      "#>",
      "",
      '$ErrorActionPreference = "Stop"',
      "",
      "# ── Configuration ──",
      '$ServerUrl = "' + serverUrl + '"',
      '$PairingCode = "' + pairingCode + '"',
      '$AgentName = "' + agentName + '"',
      ...(nasHost ? ['$NasHost = "' + nasHost + '"'] : ['$NasHost = ""']),
      ...(nasShare ? ['$NasShare = "' + nasShare + '"'] : ['$NasShare = ""']),
      ...(desiredDriveLetter ? ['$DriveLetter = "' + desiredDriveLetter + '"'] : ['$DriveLetter = ""']),
      "",
      "# ── Create config directory ──",
      '$ConfigDir = Join-Path $env:ProgramData "PopDAM"',
      "if (-not (Test-Path $ConfigDir)) {",
      "    New-Item -Path $ConfigDir -ItemType Directory -Force | Out-Null",
      '    Write-Host "Created config directory: $ConfigDir" -ForegroundColor Green',
      "}",
      "",
      "# ── Write .env for agent ──",
      '$InstallDir = "C:\\Program Files\\PopDAM\\WindowsAgent"',
      "if (-not (Test-Path $InstallDir)) {",
      "    New-Item -Path $InstallDir -ItemType Directory -Force | Out-Null",
      "}",
      "",
      '$EnvContent = @"',
      "SUPABASE_URL=" + serverUrl,
      "POPDAM_SERVER_URL=" + serverUrl,
      "POPDAM_PAIRING_CODE=" + pairingCode,
      "AGENT_NAME=" + agentName,
      '"@',
      "",
      '$EnvPath = Join-Path $InstallDir ".env"',
      "Set-Content -Path $EnvPath -Value $EnvContent -Encoding UTF8 -Force",
      'Write-Host "Wrote config to $EnvPath" -ForegroundColor Green',
      "",
      "# ── Map network drive (optional) ──",
      "if ($DriveLetter -and $NasHost -and $NasShare) {",
      '    $UncPath = "\\\\$NasHost\\$NasShare"',
      '    $DriveWithColon = "${DriveLetter}:"',
      "    $existing = Get-PSDrive -Name $DriveLetter -ErrorAction SilentlyContinue",
      "    if (-not $existing) {",
      '        Write-Host "Mapping $DriveWithColon to $UncPath..." -ForegroundColor Yellow',
      "        net use $DriveWithColon $UncPath /persistent:yes",
      '        Write-Host "Drive mapped successfully." -ForegroundColor Green',
      "    } else {",
      '        Write-Host "Drive $DriveWithColon already mapped." -ForegroundColor Cyan',
      "    }",
      "}",
      "",
      "# ── Generate uninstall script ──",
      '$UninstallScript = @"',
      "#Requires -RunAsAdministrator",
      'Write-Host "Uninstalling PopDAM Windows Render Agent..." -ForegroundColor Yellow',
      '\\$TaskName = "PopDAM Windows Render Agent"',
      "\\$task = Get-ScheduledTask -TaskName \\$TaskName -ErrorAction SilentlyContinue",
      "if (\\$task) {",
      "    Stop-ScheduledTask -TaskName \\$TaskName -ErrorAction SilentlyContinue",
      "    Unregister-ScheduledTask -TaskName \\$TaskName -Confirm:\\$false",
      '    Write-Host "Scheduled task removed." -ForegroundColor Green',
      "}",
      'Write-Host "Uninstall complete. Config files in %ProgramData%\\PopDAM remain." -ForegroundColor Green',
      '"@',
      "",
      '$UninstallPath = Join-Path $InstallDir "uninstall.ps1"',
      "Set-Content -Path $UninstallPath -Value $UninstallScript -Encoding UTF8 -Force",
      'Write-Host "Wrote uninstall script to $UninstallPath" -ForegroundColor Green',
      "",
      "# ── Summary ──",
      'Write-Host ""',
      'Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan',
      'Write-Host "║  PopDAM Windows Agent — Configuration Written    ║" -ForegroundColor Cyan',
      'Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan',
      'Write-Host ""',
      'Write-Host "Next steps:" -ForegroundColor Yellow',
      'Write-Host "  1. Download the agent from GitHub Releases"',
      'Write-Host "  2. Extract to $InstallDir"',
      'Write-Host "  3. Run install-scheduled-task.ps1 to register startup"',
      'Write-Host "  4. Start the agent or log off / log on"',
      'Write-Host ""',
      'Write-Host "The agent will pair automatically on first start." -ForegroundColor Green',
      'Write-Host "Pairing code expires in 15 minutes!" -ForegroundColor Red',
    ].join("\n");

    const readme = [
      "╔══════════════════════════════════════════════════╗",
      "║     PopDAM Windows Render Agent — Quick Start    ║",
      "╚══════════════════════════════════════════════════╝",
      "",
      "IMPORTANT: This pairing code expires in 15 minutes!",
      "",
      "── STEP 1: Run the installer ──────────────────────",
      "Right-click install.ps1 → 'Run with PowerShell'",
      "(or: powershell -ExecutionPolicy Bypass -File install.ps1)",
      "",
      "This will:",
      "  • Create C:\\Program Files\\PopDAM\\WindowsAgent\\",
      "  • Write .env with server URL and pairing code",
      ...(desiredDriveLetter ? ["  • Map " + desiredDriveLetter + ": to \\\\" + nasHost + "\\" + nasShare] : []),
      "  • Generate an uninstall script",
      "",
      "── STEP 2: Download & extract agent ────────────────",
      "Download the latest agent zip from GitHub Releases:",
      "  https://github.com/u2giants/popdam3/releases",
      "Extract into C:\\Program Files\\PopDAM\\WindowsAgent\\",
      "",
      "── STEP 3: Start the agent ─────────────────────────",
      "Run install-scheduled-task.ps1 (in the agent folder)",
      "Then: Start-ScheduledTask -TaskName 'PopDAM Windows Render Agent'",
      "",
      "The agent will pair automatically on first start.",
      "",
      "── Troubleshooting ───────────────────────────────",
      "• Check agent status in PopDAM Settings → Windows Agent",
      "• If pairing code expired, download a new bundle",
      "• Adobe Illustrator must be installed and activated",
      "",
      "Agent name: " + agentName,
      "Server: " + serverUrl,
      "Generated: " + now.toISOString(),
    ].join("\n");

    zip.file("install.ps1", installPs1);
    zip.file("README.txt", readme);
  }

  const zipBlob = await zip.generateAsync({ type: "uint8array" });
  const filename = agentType === "bridge" ? "popdam-bridge-bundle.zip" : "popdam-windows-agent-bundle.zip";

  return new Response(zipBlob as unknown as BodyInit, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// ── Main router ─────────────────────────────────────────────────────

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

  // Block dangerous keywords even within SELECT
  const forbidden = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute)\b/i;
  if (forbidden.test(trimmed)) {
    return err("Query contains forbidden keywords");
  }

  const db = serviceClient();

  // Try RPC first, then raw REST fallback
  const tryQuery = async (): Promise<Response> => {
    const { data, error: queryErr } = await db.rpc("execute_readonly_query" as any, { query_text: trimmed });

    if (!queryErr) {
      return json({ ok: true, rows: data ?? [], count: Array.isArray(data) ? data.length : 0 });
    }

    // Fallback: try raw SQL via postgrest REST API
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
      // Detect statement timeout and return a user-friendly message
      if (pgErr.includes("57014") || pgErr.includes("statement timeout")) {
        return json({
          ok: false,
          error: "Query timed out. Try a simpler query or add WHERE/LIMIT clauses.",
          code: "statement_timeout",
        }, 408);
      }
      return err(`Query failed: ${pgErr}`, 400);
    }

    const rows = await pgRes.json();
    return json({ ok: true, rows: rows ?? [], count: Array.isArray(rows) ? rows.length : 0 });
  };

  try {
    return await tryQuery();
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
  const affectedGroupIds = [
    ...new Set(
      oldAssets.map((a: any) => a.style_group_id).filter(Boolean),
    ),
  ] as string[];

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

        const statusPriority = ["licensor_approved", "customer_adopted", "in_process", "in_development", "concept_approved", "freelancer_art", "product_ideas"];
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
  const groupIds = Array.isArray(body.group_ids) ? body.group_ids as string[] : null;
  const BATCH_SIZE = 10;
  const db = serviceClient();

  let query = db
    .from("assets")
    .select("id, thumbnail_url")
    .eq("is_deleted", false)
    .not("thumbnail_url", "is", null);

  // Optional group filter (for BulkActionBar group-based tagging)
  if (groupIds && groupIds.length > 0) {
    query = query.in("style_group_id", groupIds);
  }

  if (!tagAll && !groupIds) {
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
    await new Promise((r) => setTimeout(r, 200));
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
    console.log(`admin-api action: ${action}`);

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
      case "create-pairing-code":
        return await handleCreatePairingCode(body, userId);
      case "list-pairing-codes":
        return await handleListPairingCodes();
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
      case "generate-install-bundle":
        return await handleGenerateInstallBundle(body, userId);
      case "get-latest-agent-build":
        return await handleGetLatestAgentBuild(body);
      case "trigger-windows-update":
        return await handleTriggerWindowsUpdate(body, userId);
      case "retry-failed-renders":
        return await handleRetryFailedRenders();
      case "requeue-all-no-preview":
        return await handleRequeueAllNoPreview();
      case "request-path-test":
        return await handleRequestPathTest(userId);
      case "backfill-sku-names":
        return await handleBackfillSkuNames();
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
      case "reconcile-style-group-stats":
        return await handleReconcileStyleGroupStats(body);
      case "trigger-erp-sync":
        return await handleTriggerErpSync(body);
      case "erp-sync-runs":
        return await handleErpSyncRuns();
      case "erp-enrichment-stats":
        return await handleErpEnrichmentStats();
      case "erp-review-queue":
        return await handleErpReviewQueue();
      case "erp-review-action":
        return await handleErpReviewAction(body, userId);
      case "apply-erp-enrichment":
        return await handleApplyErpEnrichment(body);
      case "classify-erp-categories":
        return await handleClassifyErpCategories(body);
      case "erp-items-browse":
        return await handleErpItemsBrowse(body);
      default:
        return err(`Unknown action: ${action}`, 404);
    }
  } catch (e) {
    const message = formatPostgrestError(e) || "Internal server error";
    console.error("admin-api unhandled error:", message, e);
    return err(message, 500);
  }
});

// ── erp-items-browse ────────────────────────────────────────────────

async function handleErpItemsBrowse(body: Record<string, unknown>) {
  const db = serviceClient();
  const page = typeof body.page === "number" ? Math.max(1, body.page) : 1;
  const pageSize = typeof body.page_size === "number" ? Math.min(Math.max(1, body.page_size), 100) : 25;
  const search = typeof body.search === "string" ? body.search.trim() : "";
  const offset = (page - 1) * pageSize;

  // Count query
  let countQuery = db.from("erp_items_current").select("id", { count: "exact", head: true });
  if (search) {
    countQuery = countQuery.or(`external_id.ilike.%${search}%,style_number.ilike.%${search}%,item_description.ilike.%${search}%`);
  }
  const { count, error: countErr } = await countQuery;
  if (countErr) return err(countErr.message, 500);

  // Data query
  let dataQuery = db.from("erp_items_current")
    .select(
      "external_id, style_number, item_description, mg_category, mg01_code, mg02_code, mg03_code, mg04_code, mg05_code, mg06_code, size_code, licensor_code, property_code, division_code, erp_updated_at, synced_at, raw_mg_fields",
    )
    .order("synced_at", { ascending: false })
    .range(offset, offset + pageSize - 1);
  if (search) {
    dataQuery = dataQuery.or(`external_id.ilike.%${search}%,style_number.ilike.%${search}%,item_description.ilike.%${search}%`);
  }
  const { data, error: dataErr } = await dataQuery;
  if (dataErr) return err(dataErr.message, 500);

  return json({
    ok: true,
    items: data || [],
    total: count ?? 0,
    page,
    page_size: pageSize,
    total_pages: Math.ceil((count ?? 0) / pageSize),
  });
}

// ── rebuild-character-stats ─────────────────────────────────────────

async function handleRebuildCharacterStats(body: Record<string, unknown>) {
  // ... keep existing code
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

// ── get-latest-agent-build ──────────────────────────────────────────

async function handleGetLatestAgentBuild(body: Record<string, unknown>) {
  const agentType = optionalString(body, "agent_type") ?? "windows-render";
  const db = serviceClient();

  // Look up the latest build info from admin_config
  const configKey = agentType === "bridge" ? "BRIDGE_LATEST_BUILD" : "WINDOWS_LATEST_BUILD";

  const { data: row } = await db
    .from("admin_config")
    .select("value")
    .eq("key", configKey)
    .maybeSingle();

  if (!row?.value) {
    // Fallback: return GitHub releases URL pattern
    const repoBase = "https://github.com/u2giants/popdam3/releases";
    return json({
      ok: true,
      latest_version: "0.0.0",
      download_url: agentType === "bridge" ? `${repoBase}/latest/download/popdam-bridge-agent.tar.gz` : `${repoBase}/latest/download/popdam-windows-agent.zip`,
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

// ── trigger-windows-update ──────────────────────────────────────────

async function handleTriggerWindowsUpdate(
  body: Record<string, unknown>,
  userId: string,
) {
  const agentId = optionalString(body, "agent_id");
  const db = serviceClient();

  if (agentId) {
    // Signal specific agent via metadata flag
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
    // Signal all windows agents
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

// ── retry-failed-renders ────────────────────────────────────────────

async function handleRetryFailedRenders() {
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

// ── request-path-test ───────────────────────────────────────────────

async function handleRequestPathTest(userId: string) {
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

// ── requeue-all-no-preview ──────────────────────────────────────────

async function handleRequeueAllNoPreview() {
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

  // Get assets that already have active render jobs
  const assetIds = allAssetIds;

  // Batch in chunks of 500 to avoid query limits
  const CHUNK = 500;
  const activeSet = new Set<string>();
  for (let i = 0; i < assetIds.length; i += CHUNK) {
    const chunk = assetIds.slice(i, i + CHUNK);
    const { data: active } = await db
      .from("render_queue")
      .select("asset_id")
      .in("asset_id", chunk)
      .in("status", ["pending", "claimed"]);
    (active ?? []).forEach((j) => activeSet.add(j.asset_id));
  }

  const toQueue = assetIds.filter((id) => !activeSet.has(id));
  if (toQueue.length === 0) {
    return json({ ok: true, queued: 0, skipped: assetIds.length });
  }

  // Clear old failed jobs for these assets first
  for (let i = 0; i < toQueue.length; i += CHUNK) {
    const chunk = toQueue.slice(i, i + CHUNK);
    await db.from("render_queue").delete().in("asset_id", chunk).eq("status", "failed");
  }

  // Also reset thumbnail_error so the auto_queue_render trigger can fire,
  // or insert directly into render_queue
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

// ── backfill-sku-names ──────────────────────────────────────────────

async function handleBackfillSkuNames() {
  const db = serviceClient();
  const BATCH = 500;
  let updated = 0;
  let groupsUpdated = 0;
  let offset = 0;
  const MAX = 10000;

  while (offset < MAX) {
    const { data: assets, error } = await db
      .from("assets")
      .select("id, filename, licensor_code, licensor_name, property_code, property_name, style_group_id")
      .eq("is_deleted", false)
      .not("sku", "is", null)
      .not("licensor_code", "is", null)
      .order("id")
      .range(offset, offset + BATCH - 1);

    if (error) return err(error.message, 500);
    if (!assets || assets.length === 0) break;
    offset += assets.length;

    // Filter to only those where name = code (needs backfill)
    const needsBackfill = assets.filter((a: any) => (a.licensor_name === a.licensor_code) || (a.property_name === a.property_code));

    for (const asset of needsBackfill) {
      const parsed = await parseSku(asset.filename);
      if (!parsed) continue;

      const updates: Record<string, unknown> = {};
      if (parsed.licensor_name && asset.licensor_name === asset.licensor_code) {
        updates.licensor_name = parsed.licensor_name;
      }
      if (parsed.property_name && asset.property_name === asset.property_code) {
        updates.property_name = parsed.property_name;
      }

      if (Object.keys(updates).length > 0) {
        await db.from("assets").update(updates).eq("id", asset.id);
        updated++;

        if (asset.style_group_id) {
          await db.from("style_groups").update(updates).eq("id", asset.style_group_id);
          groupsUpdated++;
        }
      }
    }
  }

  return json({ ok: true, assets_updated: updated, groups_updated: groupsUpdated, assets_checked: offset });
}

// ── TIFF Hygiene Actions ────────────────────────────────────────────

async function handleTriggerTiffScan(userId: string) {
  const db = serviceClient();
  const requestId = crypto.randomUUID();

  const { error } = await db.from("admin_config").upsert({
    key: "TIFF_SCAN_REQUEST",
    value: {
      status: "pending",
      request_id: requestId,
      requested_by: userId,
      requested_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, request_id: requestId });
}

async function handleListTiffFiles(body: Record<string, unknown>) {
  const db = serviceClient();
  const status = optionalString(body, "status");
  const compressionFilter = optionalString(body, "compression");
  const limit = typeof body.limit === "number" ? body.limit : 500;
  const offset = typeof body.offset === "number" ? body.offset : 0;

  let query = db.from("tiff_optimization_queue")
    .select("*", { count: "exact" })
    .order("relative_path", { ascending: true })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (compressionFilter === "none") query = query.eq("compression_type", "none");
  if (compressionFilter === "compressed") query = query.neq("compression_type", "none");

  const { data, error, count } = await query;
  if (error) return err(error.message, 500);

  // Also get summary counts
  const { data: counts } = await db.rpc("execute_readonly_query", {
    query_text: `SELECT 
      count(*) as total,
      count(*) FILTER (WHERE compression_type = 'none') as uncompressed,
      count(*) FILTER (WHERE compression_type != 'none' AND compression_type IS NOT NULL) as compressed,
      count(*) FILTER (WHERE status = 'completed') as processed,
      count(*) FILTER (WHERE status = 'failed') as failed,
      count(*) FILTER (WHERE status IN ('queued_test','queued_process','processing')) as pending
    FROM tiff_optimization_queue`,
  });

  return json({ ok: true, files: data, total: count, summary: counts?.[0] || {} });
}

async function handleQueueTiffJobs(body: Record<string, unknown>) {
  const ids = body.ids as string[];
  const mode = requireString(body, "mode"); // 'test' or 'process'
  if (!["test", "process"].includes(mode)) return err("mode must be 'test' or 'process'");
  if (!Array.isArray(ids) || ids.length === 0) return err("ids must be a non-empty array");

  const db = serviceClient();
  const newStatus = mode === "test" ? "queued_test" : "queued_process";

  const { error } = await db.from("tiff_optimization_queue")
    .update({ status: newStatus, mode, error_message: null, claimed_by: null, claimed_at: null })
    .in("id", ids)
    .in("status", ["scanned", "failed", "completed"]); // allow re-queue

  if (error) return err(error.message, 500);
  return json({ ok: true, queued: ids.length, mode });
}

async function handleDeleteTiffOriginals(body: Record<string, unknown>) {
  const ids = body.ids as string[];
  if (!Array.isArray(ids) || ids.length === 0) return err("ids must be a non-empty array");

  const db = serviceClient();

  // Mark these for deletion — the Windows Agent will pick up the request
  const { error } = await db.from("tiff_optimization_queue")
    .update({ status: "queued_delete", error_message: null })
    .in("id", ids)
    .eq("original_backed_up", true)
    .eq("original_deleted", false);

  if (error) return err(error.message, 500);
  return json({ ok: true, queued: ids.length });
}

async function handleClearTiffScan() {
  const db = serviceClient();
  const { error } = await db.from("tiff_optimization_queue").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) return err(error.message, 500);

  // Also clear scan request
  await db.from("admin_config").delete().eq("key", "TIFF_SCAN_REQUEST");
  return json({ ok: true });
}

// ── ERP Enrichment Handlers ─────────────────────────────────────────

async function handleTriggerErpSync(body: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Forward full_sync, startDate, endDate to the erp-sync function
  const syncBody: Record<string, unknown> = {};
  if (body.full_sync === true) syncBody.full_sync = true;
  if (body.startDate) syncBody.startDate = body.startDate;
  if (body.endDate) syncBody.endDate = body.endDate;

  const resp = await fetch(`${supabaseUrl}/functions/v1/erp-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(syncBody),
  });

  if (!resp.ok) {
    const text = await resp.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text);
    } catch { /* ignore */ }
    return err((parsed.error as string) || `erp-sync returned ${resp.status}`, resp.status);
  }

  const result = await resp.json();
  return json({ ok: true, ...result });
}

async function handleErpSyncRuns() {
  const db = serviceClient();
  const { data, error } = await db.from("erp_sync_runs")
    .select("id, status, started_at, ended_at, total_fetched, total_upserted, total_errors, error_samples, created_by, run_metadata")
    .order("started_at", { ascending: false })
    .limit(10);
  if (error) return err(error.message, 500);
  return json({ ok: true, runs: data });
}

async function handleErpEnrichmentStats() {
  const db = serviceClient();

  const { count: totalErp } = await db.from("erp_items_current")
    .select("*", { count: "exact", head: true });

  const { count: withMgCat } = await db.from("erp_items_current")
    .select("*", { count: "exact", head: true })
    .not("mg_category", "is", null);

  const { count: pendingReview } = await db.from("product_category_predictions")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  const { count: aiClassified } = await db.from("product_category_predictions")
    .select("*", { count: "exact", head: true })
    .in("status", ["approved", "auto_applied"]);

  // Items with mg01_code but no mgCategory = rule-classifiable
  const { count: ruleClassified } = await db.from("erp_items_current")
    .select("*", { count: "exact", head: true })
    .is("mg_category", null)
    .not("mg01_code", "is", null);

  // Items needing AI = mg_category IS NULL, excluding those already classified
  const { count: needsAiRaw } = await db.from("erp_items_current")
    .select("*", { count: "exact", head: true })
    .is("mg_category", null);

  // Already classified (have an active prediction)
  const { count: alreadyHandled } = await db.from("product_category_predictions")
    .select("*", { count: "exact", head: true })
    .in("status", ["auto_applied", "approved", "pending"]);

  const needsAi = Math.max(0, (needsAiRaw ?? 0) - (alreadyHandled ?? 0));

  // Legacy items: those with erp_updated_at before cutoff (approximate via mg_category null)
  // Read cutoff from admin_config
  let categoryCutoff = "2025-05-10";
  try {
    const { data: cutoffRow } = await db.from("admin_config")
      .select("value").eq("key", "ERP_CATEGORY_CUTOFF_DATE").maybeSingle();
    if (cutoffRow?.value) {
      const raw = typeof cutoffRow.value === "string" ? cutoffRow.value : (cutoffRow.value as any)?.value ?? cutoffRow.value;
      if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) categoryCutoff = raw.slice(0, 10);
    }
  } catch { /* use default */ }

  const { count: legacyItems } = await db.from("erp_items_current")
    .select("*", { count: "exact", head: true })
    .lt("erp_updated_at", categoryCutoff + "T00:00:00Z");

  // SKU match: erp items whose style_number matches any asset SKU
  const { count: skuMatched } = await db.from("erp_items_current")
    .select("*", { count: "exact", head: true })
    .not("style_number", "is", null);

  return json({
    ok: true,
    total_erp_items: totalErp ?? 0,
    with_mg_category: withMgCat ?? 0,
    rule_classified: ruleClassified ?? 0,
    ai_classified: aiClassified ?? 0,
    needs_ai: needsAi,
    pending_review: pendingReview ?? 0,
    sku_matched: skuMatched ?? 0,
    unmatched_skus: (totalErp ?? 0) - (skuMatched ?? 0),
    legacy_items: legacyItems ?? 0,
    category_cutoff: categoryCutoff,
  });
}

async function handleErpReviewQueue() {
  const db = serviceClient();
  const { data, error } = await db.from("product_category_predictions")
    .select("id, external_id, predicted_category, confidence, rationale, classification_source, ai_model, status, created_at")
    .eq("status", "pending")
    .order("confidence", { ascending: true })
    .limit(50);

  if (error) return err(error.message, 500);

  // Enrich with item descriptions
  const externalIds = (data || []).map((d: any) => d.external_id);
  const { data: erpItems } = await db.from("erp_items_current")
    .select("external_id, item_description")
    .in("external_id", externalIds.length > 0 ? externalIds : ["__none__"]);

  const descMap: Record<string, string> = {};
  for (const item of erpItems || []) {
    descMap[item.external_id] = item.item_description || "";
  }

  const items = (data || []).map((d: any) => ({
    ...d,
    description: descMap[d.external_id] || null,
  }));

  return json({ ok: true, items });
}

async function handleErpReviewAction(body: Record<string, unknown>, userId: string) {
  const predictionId = requireString(body, "prediction_id");
  const action = requireString(body, "action"); // approve, reject
  const overrideCategory = optionalString(body, "override_category");

  if (!["approve", "reject"].includes(action)) return err("action must be 'approve' or 'reject'");

  const db = serviceClient();
  const now = new Date().toISOString();

  if (action === "approve") {
    const updates: Record<string, unknown> = {
      status: "approved",
      reviewed_by: userId === "system" ? null : userId,
      reviewed_at: now,
    };
    if (overrideCategory) updates.predicted_category = overrideCategory;
    const { error } = await db.from("product_category_predictions")
      .update(updates).eq("id", predictionId);
    if (error) return err(error.message, 500);
  } else {
    const { error } = await db.from("product_category_predictions")
      .update({ status: "rejected", reviewed_by: userId === "system" ? null : userId, reviewed_at: now })
      .eq("id", predictionId);
    if (error) return err(error.message, 500);
  }

  return json({ ok: true });
}

async function handleApplyErpEnrichment(body: Record<string, unknown>) {
  const mode = (body.mode as string) || "dry-run";
  const offset = typeof body.offset === "number" ? body.offset : 0;
  const batchSize = 50;
  const db = serviceClient();

  // Fetch a batch of erp_items_current with style_number
  const { data: erpItems, error: fetchErr } = await db.from("erp_items_current")
    .select("id, external_id, style_number, mg_category, mg01_code, mg02_code, mg03_code, size_code, licensor_code, property_code, division_code")
    .not("style_number", "is", null)
    .order("external_id")
    .range(offset, offset + batchSize - 1);

  if (fetchErr) return err(fetchErr.message, 500);
  if (!erpItems || erpItems.length === 0) {
    return json({ ok: true, done: true, assets_updated: 0, groups_updated: 0 });
  }

  let assetsUpdated = 0;
  let groupsUpdated = 0;
  let skipped = 0;

  async function buildProposedUpdates(erpItem: any): Promise<{
    updates: Record<string, unknown>;
    classification_source: string;
    confidence: number;
  }> {
    let productCategory: string | null = erpItem.mg_category || null;
    let classificationSource = "erp";
    let confidence = 1.0;

    if (!productCategory && erpItem.mg01_code) {
      const MG01_TO_CAT: Record<string, string> = {
        A: "Wall",
        B: "Wall",
        C: "Wall",
        D: "Wall",
        E: "Wall",
        F: "Tabletop",
        G: "Tabletop",
        H: "Tabletop",
        J: "Tabletop",
        K: "Tabletop",
        M: "Clock",
        N: "Storage",
        P: "Storage",
        Q: "Storage",
        R: "Storage",
        S: "Workspace",
        T: "Workspace",
        U: "Workspace",
        V: "Floor",
        W: "Garden",
      };
      productCategory = MG01_TO_CAT[String(erpItem.mg01_code).toUpperCase()] || null;
      classificationSource = "rule";
      confidence = 0.95;
    }

    if (!productCategory) {
      const { data: pred } = await db.from("product_category_predictions")
        .select("predicted_category, confidence")
        .eq("external_id", erpItem.external_id)
        .in("status", ["approved", "auto_applied"])
        .order("confidence", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pred) {
        productCategory = pred.predicted_category;
        classificationSource = "ai";
        confidence = pred.confidence;
      }
    }

    const updates: Record<string, unknown> = {};
    if (erpItem.mg01_code) updates.mg01_code = erpItem.mg01_code;
    if (erpItem.mg02_code) updates.mg02_code = erpItem.mg02_code;
    if (erpItem.mg03_code) updates.mg03_code = erpItem.mg03_code;
    if (erpItem.size_code) updates.size_code = erpItem.size_code;
    if (erpItem.licensor_code) updates.licensor_code = erpItem.licensor_code;
    if (erpItem.property_code) updates.property_code = erpItem.property_code;
    if (erpItem.division_code) updates.division_code = erpItem.division_code;
    if (productCategory) updates.product_category = productCategory;

    return {
      updates,
      classification_source: classificationSource,
      confidence,
    };
  }

  if (mode === "dry-run") {
    const skus = erpItems.map((e: any) => e.style_number).filter(Boolean);

    const { count: assetCount } = await db.from("assets")
      .select("*", { count: "exact", head: true })
      .in("sku", skus)
      .eq("is_deleted", false);

    const { count: groupCount } = await db.from("style_groups")
      .select("*", { count: "exact", head: true })
      .in("sku", skus);

    const sampleSkus = skus.slice(0, 25);
    const [assetSampleRes, groupSampleRes] = await Promise.all([
      db.from("assets")
        .select("id, sku, filename")
        .in("sku", sampleSkus)
        .eq("is_deleted", false)
        .limit(250),
      db.from("style_groups")
        .select("id, sku")
        .in("sku", sampleSkus)
        .limit(250),
    ]);

    const assetSamples = assetSampleRes.data ?? [];
    const groupSamples = groupSampleRes.data ?? [];

    const assetCountBySku = new Map<string, number>();
    for (const a of assetSamples) {
      if (!a.sku) continue;
      assetCountBySku.set(a.sku, (assetCountBySku.get(a.sku) ?? 0) + 1);
    }

    const groupCountBySku = new Map<string, number>();
    for (const g of groupSamples) {
      if (!g.sku) continue;
      groupCountBySku.set(g.sku, (groupCountBySku.get(g.sku) ?? 0) + 1);
    }

    const sample_updates: Array<Record<string, unknown>> = [];
    for (const erpItem of erpItems.slice(0, 20)) {
      if (!erpItem.style_number) continue;
      const { updates, classification_source, confidence } = await buildProposedUpdates(erpItem);
      if (Object.keys(updates).length === 0) continue;

      sample_updates.push({
        external_id: erpItem.external_id,
        sku: erpItem.style_number,
        classification_source,
        confidence,
        proposed_fields: updates,
        matching_asset_count: assetCountBySku.get(erpItem.style_number) ?? 0,
        matching_group_count: groupCountBySku.get(erpItem.style_number) ?? 0,
      });
    }

    return json({
      ok: true,
      done: true,
      assets_to_update: assetCount ?? 0,
      groups_to_update: groupCount ?? 0,
      new_categories: erpItems.filter((e: any) => e.mg_category).length,
      skipped_lower_confidence: 0,
      sample_updates,
    });
  }

  // Apply mode
  const forceOverwrite = mode === "apply-force";

  for (const erpItem of erpItems) {
    if (!erpItem.style_number) continue;

    const { updates } = await buildProposedUpdates(erpItem);

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    // Update assets
    const { data: assetRows } = await db.from("assets")
      .update(updates)
      .eq("sku", erpItem.style_number)
      .eq("is_deleted", false)
      .select("id");
    assetsUpdated += assetRows?.length ?? 0;

    // Update style_groups
    const { data: groupRows } = await db.from("style_groups")
      .update(updates)
      .eq("sku", erpItem.style_number)
      .select("id");
    groupsUpdated += groupRows?.length ?? 0;
  }

  const done = erpItems.length < batchSize;
  return json({
    ok: true,
    done,
    nextOffset: offset + erpItems.length,
    assets_updated: assetsUpdated,
    groups_updated: groupsUpdated,
    skipped,
    updated: assetsUpdated + groupsUpdated,
    total: offset + erpItems.length,
  });
}

async function handleClassifyErpCategories(body: Record<string, unknown>) {
  const offset = typeof body.offset === "number" ? body.offset : 0;
  const batchSize = 10;
  const db = serviceClient();

  // Get IDs of items that already have an active prediction (auto_applied or approved)
  const { data: alreadyClassified } = await db.from("product_category_predictions")
    .select("erp_item_id")
    .in("status", ["auto_applied", "approved"]);
  const classifiedIds = new Set((alreadyClassified || []).map((r: any) => r.erp_item_id).filter(Boolean));

  // Find ERP items that need AI classification:
  // mg_category IS NULL (covers legacy items whose category was wiped)
  // NO restriction on mg01_code — legacy items may have MG01 but it's unreliable
  const { data: items, error: fetchErr } = await db.from("erp_items_current")
    .select("id, external_id, style_number, item_description, mg01_code, mg02_code, mg03_code, raw_mg_fields")
    .is("mg_category", null)
    .order("external_id")
    .range(offset, offset + batchSize + 49); // fetch extra to filter out already-classified

  if (fetchErr) return err(fetchErr.message, 500);

  // Filter out already-classified items, then take batchSize
  const candidates = (items || []).filter((it: any) => !classifiedIds.has(it.id)).slice(0, batchSize);
  if (candidates.length === 0) {
    return json({ ok: true, done: true, classified: 0, total: offset });
  }

  if (fetchErr) return err(fetchErr.message, 500);
  if (!items || items.length === 0) {
    return json({ ok: true, done: true, classified: 0, total: offset });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return err("LOVABLE_API_KEY not configured", 500);

  let classified = 0;
  const CATEGORIES = ["Wall", "Tabletop", "Clock", "Storage", "Workspace", "Floor", "Garden"];

  for (const item of candidates) {
    if (!item.item_description && !item.style_number) continue;

    try {
      const prompt = `Classify this product into exactly one of these 7 categories: ${CATEGORIES.join(", ")}.

Product info:
- Style Number: ${item.style_number || "unknown"}
- Description: ${item.item_description || "none"}
- MG fields: ${JSON.stringify(item.raw_mg_fields || {})}

Return ONLY the classification using the provided tool.`;

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: "You are a product classification expert for a home décor company. Classify each product into exactly one category." },
            { role: "user", content: prompt },
          ],
          tools: [{
            type: "function",
            function: {
              name: "classify_product",
              description: "Classify a product into one of 7 categories",
              parameters: {
                type: "object",
                properties: {
                  category: { type: "string", enum: CATEGORIES },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  rationale: { type: "string", maxLength: 200 },
                },
                required: ["category", "confidence", "rationale"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "classify_product" } },
        }),
      });

      if (!aiResp.ok) {
        console.error(`AI classification failed for ${item.external_id}: ${aiResp.status}`);
        continue;
      }

      const aiResult = await aiResp.json();
      const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments) continue;

      let parsed: { category: string; confidence: number; rationale: string };
      try {
        parsed = JSON.parse(toolCall.function.arguments);
      } catch {
        continue;
      }

      if (!CATEGORIES.includes(parsed.category)) continue;

      const status = parsed.confidence >= 0.65 ? "auto_applied" : "pending";

      await db.from("product_category_predictions").insert({
        erp_item_id: item.id,
        external_id: item.external_id,
        predicted_category: parsed.category,
        confidence: parsed.confidence,
        rationale: parsed.rationale,
        classification_source: "ai",
        ai_model: "google/gemini-3-flash-preview",
        ai_prompt_version: "v1",
        status,
        input_context: {
          style_number: item.style_number,
          item_description: item.item_description,
          raw_mg_fields: item.raw_mg_fields,
        },
      });

      classified++;
    } catch (e) {
      console.error(`AI classification error for ${item.external_id}:`, e);
    }
  }

  const done = candidates.length < batchSize;
  return json({
    ok: true,
    done,
    nextOffset: offset + (items || []).length, // advance by total scanned (including skipped)
    classified,
    total: offset + (items || []).length,
  });
}
