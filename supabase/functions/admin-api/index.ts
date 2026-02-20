import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  if (typeof v !== "string" || v.trim() === "")
    throw new Error(`Missing required string field: ${key}`);
  return v.trim();
}

function optionalString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new Error(`Field ${key} must be a string`);
  return v.trim() || null;
}

// ── Auth: JWT validation + admin role check ─────────────────────────

async function authenticateAdmin(req: Request): Promise<{ userId: string } | Response> {
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

  const { data, error } = await anonClient.auth.getClaims(token);
  if (error || !data?.claims) {
    return err("Invalid or expired token", 401);
  }

  const userId = data.claims.sub as string;
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

// ── Route handlers ──────────────────────────────────────────────────

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

async function handleSetConfig(body: Record<string, unknown>, userId: string) {
  const entries = body.entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return err("entries must be an object of { key: value } pairs");
  }

  const db = serviceClient();
  const now = new Date().toISOString();
  const upserts = Object.entries(entries as Record<string, unknown>).map(
    ([key, value]) => ({
      key,
      value: typeof value === "string" ? JSON.parse(`"${value}"`) : value,
      updated_at: now,
      updated_by: userId,
    }),
  );

  // Upsert one at a time to handle jsonb correctly
  for (const row of upserts) {
    const { error } = await db.from("admin_config").upsert(row);
    if (error) return err(`Failed to set ${row.key}: ${error.message}`, 500);
  }

  return json({ ok: true });
}

async function handleInviteUser(body: Record<string, unknown>, userId: string) {
  const email = requireString(body, "email").toLowerCase();
  const roleStr = optionalString(body, "role") ?? "user";

  if (!["admin", "user"].includes(roleStr)) {
    return err("role must be 'admin' or 'user'");
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return err("Invalid email format");
  }

  const db = serviceClient();

  // Check if already invited
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

  // Trigger invite email via send-invite-email function (fire-and-forget)
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
    // Don't fail the invitation creation if email fails
  }

  return json({ ok: true, invitation: data });
}

async function handleListInvites() {
  const db = serviceClient();
  const { data, error } = await db
    .from("invitations")
    .select("id, email, role, created_at, accepted_at, invited_by")
    .order("created_at", { ascending: false });

  if (error) return err(error.message, 500);
  return json({ ok: true, invitations: data });
}

async function handleRevokeInvite(body: Record<string, unknown>) {
  const invitationId = requireString(body, "invitation_id");
  const db = serviceClient();

  const { data: invite } = await db
    .from("invitations")
    .select("accepted_at")
    .eq("id", invitationId)
    .single();

  if (!invite) return err("Invitation not found", 404);
  if (invite.accepted_at) return err("Cannot revoke an already accepted invitation");

  const { error } = await db
    .from("invitations")
    .delete()
    .eq("id", invitationId);

  if (error) return err(error.message, 500);
  return json({ ok: true });
}

async function handleGenerateAgentKey(body: Record<string, unknown>, userId: string) {
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
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawKey));
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

  // Return the raw key ONCE — it cannot be retrieved again
  return json({
    ok: true,
    agent_id: data.id,
    agent_key: rawKey,
    warning: "Store this key securely. It cannot be retrieved again.",
  });
}

async function handleListAgents() {
  const db = serviceClient();
  const { data, error } = await db
    .from("agent_registrations")
    .select("id, agent_name, agent_type, last_heartbeat, metadata, created_at")
    .order("created_at", { ascending: false });

  if (error) return err(error.message, 500);

  const now = Date.now();
  const agents = (data || []).map((a) => {
    const lastHb = a.last_heartbeat ? new Date(a.last_heartbeat).getTime() : 0;
    const offlineMs = 2 * 60 * 1000;
    const metadata = (a.metadata as Record<string, unknown>) || {};
    return {
      id: a.id,
      name: a.agent_name,
      type: a.agent_type,
      status: lastHb > 0 && now - lastHb < offlineMs ? "online" : "offline",
      last_heartbeat: a.last_heartbeat,
      last_counters: metadata.last_counters || null,
      last_error: metadata.last_error || null,
      heartbeat_history: metadata.heartbeat_history || [],
      key_preview: a.agent_key_hash ? `${a.agent_key_hash.substring(0, 8)}...` : null,
      created_at: a.created_at,
    };
  });

  return json({ ok: true, agents });
}

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
    .select("id, agent_name, agent_type, last_heartbeat, metadata, created_at");

  const now = Date.now();
  const agentStatuses = (agents || []).map((a) => {
    const lastHb = a.last_heartbeat ? new Date(a.last_heartbeat).getTime() : 0;
    const offlineThresholdMs = 2 * 60 * 1000; // 2 minutes
    const metadata = (a.metadata as Record<string, unknown>) || {};
    return {
      id: a.id,
      name: a.agent_name,
      type: a.agent_type,
      status: lastHb > 0 && now - lastHb < offlineThresholdMs ? "online" : "offline",
      last_heartbeat: a.last_heartbeat,
      last_counters: metadata.last_counters || null,
      last_error: metadata.last_error || null,
      scan_roots: metadata.scan_roots || [],
      created_at: a.created_at,
    };
  });

  // 3) Scan progress
  const scanProgress = config.SCAN_PROGRESS || null;

  // 4) Recent errors from processing queue
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

// ── Main router ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return err("Method not allowed", 405);
  }

  // Authenticate admin
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
  const path = url.pathname.split("/").filter(Boolean);
  const route = path[path.length - 1] || "";
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
      default:
        return err(`Unknown action: ${action}`, 404);
    }
  } catch (e) {
    console.error("admin-api error:", e);
    return err(e instanceof Error ? e.message : "Internal server error", 500);
  }
});
