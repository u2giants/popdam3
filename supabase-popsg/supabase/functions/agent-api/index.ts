// PopSG agent-api — bridge agent endpoints.
// Handles: pair, heartbeat, scan-progress,
//          claim-style-guide-crawl, complete-style-guide-crawl.
// Auth: x-agent-key header (SHA-256 hashed, stored in agent_registrations).

import { corsServe, err, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/service-client.ts";
import { optionalNumber, optionalString, requireString } from "../_shared/validators.ts";

const ADAPTIVE_IDLE_SECONDS = 30;
const ADAPTIVE_ACTIVE_SECONDS = 5;

// ── Agent auth ──────────────────────────────────────────────────────

async function authenticateAgent(
  req: Request,
): Promise<{ agentId: string; agentName: string } | Response> {
  const agentKey = req.headers.get("x-agent-key");
  if (!agentKey) return err("Missing x-agent-key header", 401);

  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(agentKey),
  );
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const db = serviceClient();
  const { data, error } = await db
    .from("agent_registrations")
    .select("id, agent_name")
    .eq("agent_key_hash", hashHex)
    .maybeSingle();

  if (error) return err(`Auth lookup failed: ${error.message}`, 500);
  if (!data) return err("Invalid agent key", 401);
  return { agentId: data.id, agentName: data.agent_name };
}

// ── Route: pair ────────────────────────────────────────────────────

async function handlePair(body: Record<string, unknown>) {
  const pairingCode = requireString(body, "pairing_code");
  const agentName = optionalString(body, "agent_name") || "bridge-agent";

  const db = serviceClient();

  const { data: pairing, error: lookupErr } = await db
    .from("agent_pairings")
    .select("id, agent_type, agent_name, status, expires_at")
    .eq("pairing_code", pairingCode)
    .eq("status", "pending")
    .maybeSingle();

  if (lookupErr || !pairing) return err("Invalid or expired pairing code", 401);

  if (new Date(pairing.expires_at).getTime() < Date.now()) {
    await db.from("agent_pairings").update({ status: "expired" }).eq("id", pairing.id);
    return err("Invalid or expired pairing code", 401);
  }

  // Generate permanent agent key
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  const rawKey = Array.from(keyBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawKey),
  );
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const finalName = agentName !== "bridge-agent" ? agentName : (pairing.agent_name || pairing.agent_type);

  const { data: agentData, error: regErr } = await db
    .from("agent_registrations")
    .upsert(
      {
        agent_name: finalName,
        agent_type: pairing.agent_type,
        agent_key_hash: hashHex,
        last_heartbeat: new Date().toISOString(),
      },
      { onConflict: "agent_name", ignoreDuplicates: false },
    )
    .select("id")
    .single();

  if (regErr) return err(regErr.message, 500);

  const { error: consumeErr } = await db
    .from("agent_pairings")
    .update({
      status: "consumed",
      consumed_at: new Date().toISOString(),
      consumed_by_agent_id: agentData.id,
      agent_registration_id: agentData.id,
    })
    .eq("id", pairing.id)
    .eq("status", "pending");

  if (consumeErr) {
    await db.from("agent_registrations").delete().eq("id", agentData.id);
    return err("Failed to finalize pairing — please retry", 500);
  }

  return json({ ok: true, agent_id: agentData.id, agent_key: rawKey, agent_type: pairing.agent_type });
}

// ── Route: heartbeat ───────────────────────────────────────────────

async function handleHeartbeat(
  body: Record<string, unknown>,
  agentId: string,
) {
  const health = body.health as Record<string, unknown> | undefined;
  const versionInfo = body.version_info as Record<string, unknown> | undefined;
  const counters = body.counters as Record<string, unknown> | undefined;

  const db = serviceClient();

  const { data: agent } = await db
    .from("agent_registrations")
    .select("metadata")
    .eq("id", agentId)
    .single();

  const metadata = (agent?.metadata as Record<string, unknown>) || {};
  const history = Array.isArray(metadata.counter_history)
    ? (metadata.counter_history as unknown[])
    : [];
  history.push({ ts: new Date().toISOString(), ...counters });
  if (history.length > 60) history.splice(0, history.length - 60);

  const newMetadata = {
    ...metadata,
    last_counters: counters || {},
    counter_history: history,
    health: health
      ? {
        healthy: health.healthy ?? false,
        last_error: health.last_error ?? null,
        last_heartbeat_at: new Date().toISOString(),
      }
      : metadata.health,
    version_info: versionInfo
      ? {
        version: versionInfo.version ?? null,
        image_tag: versionInfo.image_tag ?? null,
        build_sha: versionInfo.build_sha ?? null,
        last_reported_at: new Date().toISOString(),
      }
      : metadata.version_info,
  };

  await db
    .from("agent_registrations")
    .update({ last_heartbeat: new Date().toISOString(), metadata: newMetadata })
    .eq("id", agentId);

  // Fetch config for this agent
  const { data: configRows } = await db
    .from("admin_config")
    .select("key, value")
    .in("key", [
      "scan_roots",
      "POLLING_CONFIG",
      "STYLE_GUIDE_CRAWL_REQUEST",
    ]);

  const configMap: Record<string, unknown> = {};
  for (const row of configRows || []) configMap[row.key] = row.value;

  const pollingConfig = (configMap.POLLING_CONFIG as Record<string, number>) || {};
  const scanRoots = (configMap.scan_roots as string[]) || [];

  // Deliver crawl command if pending/orphaned
  const crawlReq = configMap.STYLE_GUIDE_CRAWL_REQUEST as Record<string, unknown> | undefined;
  const forceStop = (newMetadata as Record<string, unknown>).force_stop === true;
  let triggerCrawl = false;
  let crawlSessionId: string | null = null;

  if (crawlReq && !forceStop) {
    const isPending = crawlReq.status === "pending";
    const isOrphan = crawlReq.status === "claimed" && crawlReq.claimed_by === agentId;
    if (isPending || isOrphan) {
      if (isPending) {
        await db.from("admin_config").update({
          value: { ...crawlReq, status: "claimed", claimed_by: agentId, claimed_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        }).eq("key", "STYLE_GUIDE_CRAWL_REQUEST");
      }
      triggerCrawl = true;
      crawlSessionId = crawlReq.request_id as string ?? null;
    }
  }

  return json({
    ok: true,
    config: {
      scanning: {
        roots: scanRoots,
        adaptive_polling: {
          idle_seconds: pollingConfig.idle_seconds ?? ADAPTIVE_IDLE_SECONDS,
          active_seconds: pollingConfig.active_seconds ?? ADAPTIVE_ACTIVE_SECONDS,
        },
      },
    },
    commands: {
      trigger_crawl: triggerCrawl,
      crawl_session_id: crawlSessionId,
      abort_scan: (newMetadata as Record<string, unknown>).force_stop === true,
    },
  });
}

// ── Route: scan-progress ───────────────────────────────────────────

async function handleScanProgress(body: Record<string, unknown>) {
  const sessionId = requireString(body, "session_id");
  const status = requireString(body, "status");
  const counters = body.counters as Record<string, unknown> | undefined;
  const currentPath = optionalString(body, "current_path");

  const db = serviceClient();

  const TERMINAL = new Set(["completed", "completed_with_errors", "failed"]);
  if (status === "running") {
    const { data: existing } = await db
      .from("admin_config")
      .select("value")
      .eq("key", "SCAN_PROGRESS")
      .maybeSingle();
    if (existing?.value) {
      const prev = existing.value as Record<string, unknown>;
      if (prev.session_id === sessionId && TERMINAL.has(prev.status as string)) {
        return json({ ok: true, skipped: "terminal_status_already_set" });
      }
    }
  }

  const { error } = await db.from("admin_config").upsert({
    key: "SCAN_PROGRESS",
    value: {
      session_id: sessionId,
      status,
      counters: counters || {},
      current_path: currentPath,
      updated_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  });

  if (error) return err(error.message, 500);

  if (TERMINAL.has(status)) {
    const { data: reqRow } = await db
      .from("admin_config")
      .select("value")
      .eq("key", "STYLE_GUIDE_CRAWL_REQUEST")
      .maybeSingle();
    if (reqRow) {
      const reqVal = reqRow.value as Record<string, unknown>;
      if (reqVal.request_id === sessionId) {
        await db.from("admin_config").update({
          value: { ...reqVal, status, completed_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        }).eq("key", "STYLE_GUIDE_CRAWL_REQUEST");
      }
    }
  }

  return json({ ok: true });
}

// ── Route: claim-style-guide-crawl ─────────────────────────────────

async function handleClaimStyleGuideCrawl(agentId: string) {
  const db = serviceClient();

  const { data: reqRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "STYLE_GUIDE_CRAWL_REQUEST")
    .maybeSingle();

  if (!reqRow?.value) return json({ ok: true, run_id: null });

  const req = reqRow.value as Record<string, unknown>;
  const isPending = req.status === "pending";
  const isOrphan = req.status === "claimed" && req.claimed_by === agentId;
  if (!isPending && !isOrphan) return json({ ok: true, run_id: null });

  const { data: rootsRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "scan_roots")
    .maybeSingle();
  const roots = (rootsRow?.value as string[]) || [];

  await db.from("admin_config").upsert({
    key: "STYLE_GUIDE_CRAWL_REQUEST",
    value: { ...req, status: "claimed", claimed_by: agentId, claimed_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  });

  const { data: run, error: runErr } = await db
    .from("style_guide_crawl_runs")
    .insert({
      status: "running",
      agent_id: agentId,
      roots_scanned: roots,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runErr) return err(runErr.message, 500);

  return json({ ok: true, run_id: run.id, roots });
}

// ── Path metadata derivation ────────────────────────────────────────

function derivePathMeta(relPath: string, filename: string) {
  const segments = relPath.split("/").filter(Boolean);
  const dirParts = segments.slice(0, -1);
  const nameParts = filename.split(".");
  const ext = nameParts.length > 1 ? nameParts.pop()!.toLowerCase() : null;
  const baseName = nameParts.join(".");
  const normalized = filename.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedFolder = dirParts.join("/").toLowerCase().replace(/[^a-z0-9/]/g, "");

  return {
    path_segments: segments,
    directory_path: dirParts.join("/"),
    basename_no_ext: baseName,
    file_extension: ext,
    licensor_name: dirParts[0] ?? null,
    property_name: dirParts[1] ?? null,
    depth: segments.length,
    normalized_name: normalized,
    normalized_style_guide_folder: normalizedFolder,
  };
}

// ── Route: complete-style-guide-crawl ──────────────────────────────

async function handleCompleteStyleGuideCrawl(body: Record<string, unknown>) {
  const runId = body.run_id as string;
  const files = (body.files as Record<string, unknown>[]) || [];
  const done = body.done === true;
  const totalFiles = body.total_files as number | undefined;
  const crawlError = body.error as string | undefined;

  if (!runId) return err("run_id is required");

  const db = serviceClient();

  if (files.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < files.length; i += CHUNK) {
      const chunk = files.slice(i, i + CHUNK);
      const rows = chunk.map((f) => {
        const relPath = f.relative_path as string;
        const filename = f.filename as string;
        const derived = derivePathMeta(relPath, filename);
        return {
          crawl_run_id: runId,
          root_label: f.root_label as string,
          relative_path: relPath,
          filename,
          size_bytes: (f.size_bytes as number) || null,
          modified_at: (f.modified_at as string) || null,
          file_created_at: (f.file_created_at as string) || null,
          quick_hash: (f.quick_hash as string) || null,
          quick_hash_version: (f.quick_hash_version as number) || 1,
          last_seen_at: new Date().toISOString(),
          is_active: true,
          ...derived,
        };
      });

      const { error: upsertErr } = await db
        .from("style_guide_files")
        .upsert(rows, { onConflict: "root_label,relative_path" });

      if (upsertErr) {
        console.error("[complete-style-guide-crawl] upsert error:", upsertErr);
        return err(`File upsert failed: ${upsertErr.message}`, 500);
      }
    }
  }

  if (done) {
    if (crawlError) {
      await db.from("style_guide_crawl_runs").update({
        status: "failed",
        error_message: crawlError,
        completed_at: new Date().toISOString(),
        files_found: totalFiles ?? 0,
      }).eq("id", runId);

      await db.from("admin_config").upsert({
        key: "STYLE_GUIDE_CRAWL_REQUEST",
        value: { status: "failed", error: crawlError, completed_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      });
    } else {
      await db.from("style_guide_crawl_runs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        files_found: totalFiles ?? 0,
      }).eq("id", runId);

      // Mark stale files from previous runs for the same roots
      const { data: runData } = await db
        .from("style_guide_crawl_runs")
        .select("roots_scanned")
        .eq("id", runId)
        .single();

      if (runData?.roots_scanned) {
        for (const root of runData.roots_scanned) {
          const rootLabel = root.split("/").filter(Boolean).pop() || root;
          await db
            .from("style_guide_files")
            .update({ is_active: false })
            .eq("root_label", rootLabel)
            .neq("crawl_run_id", runId);
        }
      }

      await db.from("admin_config").upsert({
        key: "STYLE_GUIDE_CRAWL_REQUEST",
        value: { status: "completed", completed_at: new Date().toISOString(), files_found: totalFiles },
        updated_at: new Date().toISOString(),
      });
    }
  }

  return json({ ok: true });
}

// ── Main router ────────────────────────────────────────────────────

corsServe(async (req: Request) => {
  if (req.method !== "POST") return err("Method not allowed", 405);

  if (
    !Deno.env.get("SUPABASE_URL") ||
    !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
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
    // Pair is unauthenticated — uses pairing code
    if (action === "pair") return await handlePair(body);

    // All other routes require a valid agent key
    const authResult = await authenticateAgent(req);
    if (authResult instanceof Response) return authResult;
    const { agentId, agentName: _agentName } = authResult;

    switch (action) {
      case "heartbeat":
        return await handleHeartbeat(body, agentId);
      case "scan-progress":
        return await handleScanProgress(body);
      case "claim-style-guide-crawl":
        return await handleClaimStyleGuideCrawl(agentId);
      case "complete-style-guide-crawl":
        return await handleCompleteStyleGuideCrawl(body);
      default:
        return err(`Unknown action: ${action}`, 404);
    }
  } catch (e) {
    const msg = ((e as Error)?.message) || "Internal server error";
    console.error("agent-api error:", msg, e);
    return err(msg, 500);
  }
});
