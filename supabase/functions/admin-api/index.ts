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
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  let userId: string;
  try {
    const { data, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !data?.claims?.sub) {
      console.error("Token validation error:", claimsError);
      return err("Invalid or expired token", 401);
    }
    userId = data.claims.sub as string;
  } catch (e) {
    console.error("Token validation error:", e);
    return err("Invalid or expired token", 401);
  }

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
      const skuFields: Record<string, string> = {
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
  const db = serviceClient();

  const STATE_KEY = "REBUILD_STYLE_GROUPS_STATE";
  const CLEAR_BATCH = 2000;
  const GROUP_DELETE_BATCH = 1000;
  const REBUILD_BATCH = 100;

  type RebuildState = {
    stage: "clear_assets" | "delete_groups" | "rebuild_assets";
    last_asset_id?: string | null;
    last_group_id?: string | null;
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

  // Start a fresh run when caller starts from offset 0
  if (offset === 0) {
    const initialState: RebuildState = {
      stage: "clear_assets",
      last_asset_id: null,
      last_group_id: null,
      rebuild_offset: 0,
    };
    await saveState(initialState);
  }

  const { data: stateRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", STATE_KEY)
    .maybeSingle();

  let state = (stateRow?.value as RebuildState | null) ?? null;

  if (!state || !state.stage) {
    state = {
      stage: "clear_assets",
      last_asset_id: null,
      last_group_id: null,
      rebuild_offset: 0,
    };
    await saveState(state);
  }

  // Stage 1: clear style_group_id in chunks
  if (state.stage === "clear_assets") {
    let q = db
      .from("assets")
      .select("id")
      .eq("is_deleted", false)
      .not("style_group_id", "is", null)
      .order("id", { ascending: true })
      .limit(CLEAR_BATCH);

    if (state.last_asset_id) {
      q = q.gt("id", state.last_asset_id);
    }

    const { data: rows, error: fetchErr } = await q;
    if (fetchErr) return err(fetchErr.message, 500);

    const ids = (rows ?? []).map((r) => r.id as string);
    if (ids.length > 0) {
      const { error: clearErr } = await db
        .from("assets")
        .update({ style_group_id: null })
        .in("id", ids);
      if (clearErr) return err(clearErr.message, 500);
    }

    const reachedEnd = ids.length < CLEAR_BATCH;
    const nextState: RebuildState = reachedEnd
      ? {
        stage: "delete_groups",
        last_group_id: null,
        rebuild_offset: 0,
      }
      : {
        ...state,
        last_asset_id: ids[ids.length - 1],
      };

    await saveState(nextState);

    return json({
      ok: true,
      stage: "clear_assets",
      done: false,
      nextOffset: offset + 1,
      cleared_assets: ids.length,
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
    if (fetchErr) return err(fetchErr.message, 500);

    const ids = (rows ?? []).map((r) => r.id as string);
    if (ids.length > 0) {
      const { error: delErr } = await db
        .from("style_groups")
        .delete()
        .in("id", ids);
      if (delErr) return err(delErr.message, 500);
    }

    const reachedEnd = ids.length < GROUP_DELETE_BATCH;
    const nextState: RebuildState = reachedEnd
      ? {
        stage: "rebuild_assets",
        rebuild_offset: 0,
      }
      : {
        ...state,
        last_group_id: ids[ids.length - 1],
      };

    await saveState(nextState);

    return json({
      ok: true,
      stage: "delete_groups",
      done: false,
      nextOffset: offset + 1,
      groups_deleted: ids.length,
    });
  }

  // Stage 3: rebuild groups from assets in chunks
  // Reduced batch + hard cap on SKUs to stay within edge function timeout
  const rebuildOffset = state.rebuild_offset ?? 0;
  const MAX_SKUS_PER_CALL = 25;

  try {
    const { data: assets, error: fetchErr } = await withRetry(() =>
      db
        .from("assets")
        .select(
          "id, relative_path, filename, file_type, created_at, modified_at, workflow_status, is_licensed, licensor_id, licensor_code, licensor_name, property_id, property_code, property_name, product_category, division_code, division_name, mg01_code, mg01_name, mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name",
        )
        .eq("is_deleted", false)
        .order("id")
        .range(rebuildOffset, rebuildOffset + REBUILD_BATCH - 1)
        .then((r) => { if (r.error) throw new Error(r.error.message); return r; })
    );

    if (fetchErr) return err(fetchErr.message, 500);
    if (!assets || assets.length === 0) {
      await clearState();
      return json({
        ok: true,
        stage: "rebuild_assets",
        groups_created: 0,
        assets_assigned: 0,
        assets_ungrouped: 0,
        done: true,
        nextOffset: offset,
      });
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
    const touchedGroupIds: string[] = [];
    let skusProcessed = 0;

    for (const [sku, members] of skuMap) {
      if (skusProcessed >= MAX_SKUS_PER_CALL) break;
      skusProcessed++;

      const sku_upper = sku.toUpperCase();
      const first = members.find((m) => m.filename.toUpperCase().includes(sku_upper)) ?? members[0];

      const pathParts = first.relative_path.split("/");
      const skuIdx = pathParts.lastIndexOf(sku);
      const folderPath = skuIdx >= 0 ? pathParts.slice(0, skuIdx + 1).join("/") : pathParts.slice(0, -1).join("/");

      const { data: group, error: upsertErr } = await withRetry(() =>
        db
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
          .single()
          .then((r) => { if (r.error) throw new Error(r.error.message); return r; })
      );

      if (upsertErr || !group) continue;
      groupsCreated++;
      touchedGroupIds.push(group.id);

      const memberIds = members.map((m) => m.id);
      await withRetry(() =>
        db.from("assets").update({ style_group_id: group.id }).in("id", memberIds)
          .then((r) => { if (r.error) throw new Error(r.error.message); return r; })
      );
      assetsAssigned += memberIds.length;
    }

    // Batch-fetch assets for ALL touched groups in one query (eliminates N+1)
    if (touchedGroupIds.length > 0) {
      const { data: allGroupAssets } = await withRetry(() =>
        db
          .from("assets")
          .select("id, style_group_id, filename, file_type, asset_type, created_at, modified_at, workflow_status, thumbnail_url, thumbnail_error")
          .in("style_group_id", touchedGroupIds)
          .eq("is_deleted", false)
          .then((r) => { if (r.error) throw new Error(r.error.message); return r; })
      );

      if (allGroupAssets && allGroupAssets.length > 0) {
        // Group fetched assets by style_group_id
        const byGroup = new Map<string, typeof allGroupAssets>();
        for (const a of allGroupAssets) {
          const gid = a.style_group_id as string;
          if (!byGroup.has(gid)) byGroup.set(gid, []);
          byGroup.get(gid)!.push(a);
        }

        const statusPriority = ["licensor_approved", "customer_adopted", "in_process", "in_development", "concept_approved", "freelancer_art", "product_ideas"];

        for (const [gid, groupAssets] of byGroup) {
          const primaryId = selectPrimaryAsset(groupAssets);
          const primaryAsset = groupAssets.find((a: Record<string, unknown>) => a.id === primaryId) as Record<string, unknown> | undefined;

          let bestStatus = "other";
          for (const s of statusPriority) {
            if (groupAssets.some((a: Record<string, unknown>) => a.workflow_status === s)) {
              bestStatus = s;
              break;
            }
          }

          const latestFileDate = groupAssets.reduce((max: string, a: any) => {
            const d = a.modified_at ?? a.created_at;
            return d > max ? d : max;
          }, "1970-01-01T00:00:00.000Z");

          await withRetry(() =>
            db.from("style_groups").update({
              asset_count: groupAssets.length,
              primary_asset_id: primaryId,
              primary_asset_type: (primaryAsset?.asset_type as string | null) ?? null,
              workflow_status: bestStatus as any,
              latest_file_date: latestFileDate,
              updated_at: new Date().toISOString(),
            }).eq("id", gid)
              .then((r) => { if (r.error) throw new Error(r.error.message); return r; })
          );
        }
      }
    }

    const done = assets.length < REBUILD_BATCH;
    if (done) {
      await clearState();
    } else {
      await saveState({
        stage: "rebuild_assets",
        rebuild_offset: rebuildOffset + REBUILD_BATCH,
      });
    }

    return json({
      ok: true,
      stage: "rebuild_assets",
      groups_created: groupsCreated,
      assets_assigned: assetsAssigned,
      assets_ungrouped: ungrouped,
      done,
      nextOffset: offset + 1,
    });
  } catch (e) {
    const msg = (e as Error).message || "Unknown error in rebuild stage 3";
    console.error("rebuild-style-groups stage 3 error:", msg);
    return err(msg, 500);
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

  return new Response(zipBlob, {
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
      default:
        return err(`Unknown action: ${action}`, 404);
    }
  } catch (e) {
    console.error("admin-api unhandled error:", e);
    console.error("Stack:", e instanceof Error ? e.stack : "no stack");
    const message = e instanceof Error ? e.message : "Internal server error";
    return err(message, 500);
  }
});

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
