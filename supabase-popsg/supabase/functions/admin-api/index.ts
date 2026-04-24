// PopSG admin-api — authenticated admin operations.
// Auth: Supabase JWT + admin role in user_roles.
// Handles: doctor, trigger-scan, get-scan-status.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsServe, err, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/service-client.ts";

const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min

// ── Auth ───────────────────────────────────────────────────────────

async function authenticateAdmin(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return err("Missing Authorization header", 401);

  const token = authHeader.replace("Bearer ", "");

  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  let userId: string | undefined;
  try {
    const { data: { user }, error } = await anonClient.auth.getUser(token);
    if (error || !user?.id) return err("Invalid or expired token", 401);
    userId = user.id;
  } catch {
    return err("Invalid or expired token", 401);
  }

  const db = serviceClient();
  const { data: roleRow } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (!roleRow) return err("Forbidden: admin role required", 403);
  return { userId };
}

// ── Route: doctor ──────────────────────────────────────────────────

async function handleDoctor() {
  const db = serviceClient();
  const now = Date.now();

  const [agentsResult, crawlRunResult, fileCountResult, configResult] = await Promise.all([
    db.from("agent_registrations")
      .select("id, agent_name, agent_type, last_heartbeat, metadata")
      .order("created_at", { ascending: false }),
    db.from("style_guide_crawl_runs")
      .select("id, status, started_at, completed_at, files_found, error_message, agent_id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("style_guide_files")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true),
    db.from("admin_config")
      .select("key, value")
      .in("key", ["SCAN_PROGRESS", "STYLE_GUIDE_CRAWL_REQUEST", "scan_roots"]),
  ]);

  const agents = (agentsResult.data || []).map((a) => {
    const lastHb = a.last_heartbeat ? new Date(a.last_heartbeat).getTime() : 0;
    const online = lastHb > 0 && now - lastHb < OFFLINE_THRESHOLD_MS;
    return {
      id: a.id,
      name: a.agent_name,
      type: a.agent_type,
      online,
      last_heartbeat: a.last_heartbeat,
      last_heartbeat_seconds_ago: lastHb > 0 ? Math.round((now - lastHb) / 1000) : null,
    };
  });

  const configMap: Record<string, unknown> = {};
  for (const row of configResult.data || []) configMap[row.key] = row.value;

  return json({
    ok: true,
    agents,
    last_crawl_run: crawlRunResult.data ?? null,
    active_file_count: fileCountResult.count ?? 0,
    scan_progress: configMap.SCAN_PROGRESS ?? null,
    crawl_request: configMap.STYLE_GUIDE_CRAWL_REQUEST ?? null,
    scan_roots: configMap.scan_roots ?? [],
  });
}

// ── Route: trigger-scan ────────────────────────────────────────────

async function handleTriggerScan(_body: Record<string, unknown>, userId: string) {
  const db = serviceClient();
  const requestId = crypto.randomUUID();

  const { error } = await db.from("admin_config").upsert({
    key: "STYLE_GUIDE_CRAWL_REQUEST",
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

// ── Route: get-scan-status ─────────────────────────────────────────

async function handleGetScanStatus() {
  const db = serviceClient();

  const [reqResult, progressResult, lastRunResult] = await Promise.all([
    db.from("admin_config").select("value").eq("key", "STYLE_GUIDE_CRAWL_REQUEST").maybeSingle(),
    db.from("admin_config").select("value").eq("key", "SCAN_PROGRESS").maybeSingle(),
    db.from("style_guide_crawl_runs")
      .select("id, status, started_at, completed_at, files_found, error_message")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  return json({
    ok: true,
    crawl_request: reqResult.data?.value ?? null,
    scan_progress: progressResult.data?.value ?? null,
    recent_runs: lastRunResult.data ?? [],
  });
}

// ── Main router ────────────────────────────────────────────────────

corsServe(async (req: Request) => {
  if (req.method !== "POST") return err("Method not allowed", 405);

  if (
    !Deno.env.get("SUPABASE_URL") ||
    !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    !Deno.env.get("SUPABASE_ANON_KEY")
  ) {
    return err("Server configuration error", 500);
  }

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
    const authResult = await authenticateAdmin(req);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    switch (action) {
      case "doctor":
        return await handleDoctor();
      case "trigger-scan":
        return await handleTriggerScan(body, userId);
      case "get-scan-status":
        return await handleGetScanStatus();
      default:
        return err(`Unknown action: ${action}`, 404);
    }
  } catch (e) {
    const msg = ((e as Error)?.message) || "Internal server error";
    console.error("admin-api error:", msg, e);
    return err(msg, 500);
  }
});
