import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS ────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-agent-key",
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

// ── Agent auth via x-agent-key ──────────────────────────────────────

async function authenticateAgent(
  req: Request,
): Promise<{ agentId: string; agentName: string } | Response> {
  const agentKey = req.headers.get("x-agent-key");
  if (!agentKey) return err("Missing x-agent-key header", 401);

  const db = serviceClient();
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(agentKey),
  );
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data, error } = await db
    .from("agent_registrations")
    .select("id, agent_name")
    .eq("agent_key_hash", hashHex)
    .maybeSingle();

  if (error || !data) return err("Invalid agent key", 401);
  return { agentId: data.id, agentName: data.agent_name };
}

// ── Validators (inline to avoid deno.lock issues) ───────────────────

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

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== "number") throw new Error(`Field ${key} must be a number`);
  return v;
}

function optionalNumber(
  obj: Record<string, unknown>,
  key: string,
): number | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number") throw new Error(`Field ${key} must be a number`);
  return v;
}

function requireCanonicalRelativePath(
  obj: Record<string, unknown>,
  key: string,
): string {
  const raw = obj[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`Missing required string field: ${key}`);
  }
  let p = raw.trim().replace(/\\/g, "/");
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (p === "") {
    throw new Error(`${key} cannot be empty after normalization`);
  }
  if (p.includes("//")) {
    throw new Error(`${key} contains empty path segments (//)`);
  }
  return p;
}

// ── Metadata derivation from path ───────────────────────────────────

const WORKFLOW_FOLDER_MAP: Record<string, string> = {
  "product ideas": "product_ideas",
  "concept approved": "concept_approved",
  "in development": "in_development",
  "freelancer art": "freelancer_art",
  "discontinued": "discontinued",
  "in process": "in_process",
  "customer adopted": "customer_adopted",
  "licensor approved": "licensor_approved",
};

function deriveMetadataFromPath(
  relativePath: string,
): { workflow_status: string; is_licensed: boolean } {
  const lowerPath = relativePath.toLowerCase();

  let workflow_status = "other";
  for (const [folder, status] of Object.entries(WORKFLOW_FOLDER_MAP)) {
    if (lowerPath.includes(folder)) {
      workflow_status = status;
      break;
    }
  }

  const is_licensed = lowerPath.includes("character licensed");
  return { workflow_status, is_licensed };
}

// ── Route: register ─────────────────────────────────────────────────

async function handleRegister(body: Record<string, unknown>) {
  const agentName = requireString(body, "agent_name");
  const agentType = requireString(body, "agent_type");
  const agentKey = requireString(body, "agent_key");

  if (!["bridge", "windows-render"].includes(agentType)) {
    return err("agent_type must be 'bridge' or 'windows-render'");
  }

  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(agentKey),
  );
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const db = serviceClient();
  const { data, error } = await db
    .from("agent_registrations")
    .upsert(
      {
        agent_name: agentName,
        agent_type: agentType,
        agent_key_hash: hashHex,
        last_heartbeat: new Date().toISOString(),
      },
      { onConflict: "agent_key_hash" },
    )
    .select("id")
    .single();

  if (error) return err(error.message, 500);
  return json({ ok: true, agent_id: data.id });
}

// ── Route: heartbeat ────────────────────────────────────────────────

const HEARTBEAT_CONFIG_KEYS = [
  "SPACES_CONFIG",
  "SCAN_ROOTS",
  "RESOURCE_GUARD",
  "POLLING_CONFIG",
  "NAS_CONTAINER_MOUNT_ROOT",
  "NAS_HOST_PATH",
  "PATH_TEST_REQUEST",
  "AUTO_SCAN_CONFIG",
  "SCAN_REQUEST",
];

async function handleHeartbeat(
  body: Record<string, unknown>,
  agentId: string,
) {
  const counters = body.counters as Record<string, unknown> | undefined;
  const lastError = optionalString(body, "last_error");
  const db = serviceClient();

  // ── Update agent metadata ──
  const { data: agent } = await db
    .from("agent_registrations")
    .select("metadata")
    .eq("id", agentId)
    .single();

  const metadata = (agent?.metadata as Record<string, unknown>) || {};

  // Append to counter history (keep last 60)
  const history = Array.isArray(metadata.counter_history)
    ? (metadata.counter_history as unknown[])
    : [];
  history.push({ ts: new Date().toISOString(), ...counters });
  if (history.length > 60) history.splice(0, history.length - 60);

  const newMetadata = {
    ...metadata,
    last_counters: counters || {},
    last_error: lastError,
    counter_history: history,
  };

  const { error: updateErr } = await db
    .from("agent_registrations")
    .update({
      last_heartbeat: new Date().toISOString(),
      metadata: newMetadata,
    })
    .eq("id", agentId);

  if (updateErr) return err(updateErr.message, 500);

  // ── Fetch cloud config ──
  const { data: configRows } = await db
    .from("admin_config")
    .select("key, value")
    .in("key", HEARTBEAT_CONFIG_KEYS);

  const configMap: Record<string, unknown> = {};
  for (const row of configRows || []) {
    configMap[row.key] = row.value;
  }

  // Spaces
  const spacesConfig =
    (configMap.SPACES_CONFIG as Record<string, string>) || {};

  // Scanning
  const scanRoots = (configMap.SCAN_ROOTS as string[]) || [];
  const pollingConfig =
    (configMap.POLLING_CONFIG as Record<string, number>) || {};

  // Resource Guard
  const guard =
    (configMap.RESOURCE_GUARD as Record<string, unknown>) || {};
  const schedules =
    guard.schedules as Array<Record<string, unknown>> | undefined;

  let resourceDirectives: Record<string, unknown> = {
    cpu_percentage_limit: guard.default_cpu_shares ?? 50,
    memory_limit_mb: guard.default_memory_limit_mb ?? 512,
    concurrency: guard.default_thumb_concurrency ?? 2,
  };

  if (schedules && schedules.length > 0) {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const hour = now.getUTCHours();

    for (const sched of schedules) {
      const days = sched.days as number[] | undefined;
      const startHour = sched.start_hour as number | undefined;
      const endHour = sched.end_hour as number | undefined;

      if (
        days &&
        days.includes(dayOfWeek) &&
        startHour !== undefined &&
        endHour !== undefined &&
        hour >= startHour &&
        hour < endHour
      ) {
        resourceDirectives = {
          cpu_percentage_limit:
            sched.cpu_shares ?? resourceDirectives.cpu_percentage_limit,
          memory_limit_mb:
            sched.memory_limit_mb ?? resourceDirectives.memory_limit_mb,
          concurrency:
            sched.thumb_concurrency ?? resourceDirectives.concurrency,
        };
        break;
      }
    }
  }

  // ── Commands (abort/stop from agent metadata) ──
  const scanAbort = metadata.scan_abort === true;
  const forceStop = metadata.force_stop === true;

  // ── Durable scan request from admin_config ──
  const scanRequest =
    configMap.SCAN_REQUEST as Record<string, unknown> | undefined;
  let forceScan = false;
  let scanSessionId: string | null = null;

  if (
    scanRequest &&
    scanRequest.status === "pending" &&
    (!scanRequest.target_agent_id ||
      scanRequest.target_agent_id === agentId) &&
    !forceStop
  ) {
    const claimedValue = {
      ...scanRequest,
      status: "claimed",
      claimed_by: agentId,
      claimed_at: new Date().toISOString(),
    };
    const { error: claimErr } = await db
      .from("admin_config")
      .update({
        value: claimedValue,
        updated_at: new Date().toISOString(),
      })
      .eq("key", "SCAN_REQUEST");

    if (!claimErr) {
      forceScan = true;
      scanSessionId = scanRequest.request_id as string;

      // Clear any previous stop flags so the new scan can ingest
      const clearedMeta = {
        ...newMetadata,
        force_stop: false,
        scan_abort: false,
      };
      await db
        .from("agent_registrations")
        .update({ metadata: clearedMeta })
        .eq("id", agentId);
    }
  }

  // ── Path test request ──
  const pathTestRequest =
    configMap.PATH_TEST_REQUEST as Record<string, unknown> | undefined;

  let testPaths: {
    request_id: string;
    container_mount_root: string;
    scan_roots: string[];
  } | null = null;

  if (pathTestRequest && pathTestRequest.status === "pending") {
    testPaths = {
      request_id: pathTestRequest.request_id as string,
      container_mount_root:
        (configMap.NAS_CONTAINER_MOUNT_ROOT as string) || "",
      scan_roots: scanRoots,
    };
  }

  // ── Auto-scan config ──
  const autoScanConfig = (configMap.AUTO_SCAN_CONFIG as {
    enabled: boolean;
    interval_hours: number;
  }) || { enabled: false, interval_hours: 6 };

  // ── Response ──
  return json({
    ok: true,
    config: {
      do_spaces: {
        bucket: spacesConfig.bucket_name || spacesConfig.bucket || "popdam",
        region: spacesConfig.region || "nyc3",
        endpoint:
          spacesConfig.endpoint || "https://nyc3.digitaloceanspaces.com",
        public_base_url:
          spacesConfig.public_base_url ||
          "https://popdam.nyc3.digitaloceanspaces.com",
      },
      scanning: {
        container_mount_root:
          (configMap.NAS_CONTAINER_MOUNT_ROOT as string) || "",
        roots: scanRoots,
        batch_size: pollingConfig.batch_size ?? 100,
        adaptive_polling: {
          idle_seconds: pollingConfig.idle_seconds ?? 30,
          active_seconds: pollingConfig.active_seconds ?? 5,
        },
      },
      resource_guard: resourceDirectives,
      auto_scan: autoScanConfig,
    },
    commands: {
      force_scan: forceScan,
      scan_session_id: scanSessionId,
      abort_scan: scanAbort || forceStop,
      test_paths: testPaths,
    },
  });
}

// ── Route: ingest ───────────────────────────────────────────────────

async function handleIngest(
  body: Record<string, unknown>,
  agentId?: string,
) {
  // Guard: reject ingestion if force_stop is set
  if (agentId) {
    const db = serviceClient();
    const { data: agentReg } = await db
      .from("agent_registrations")
      .select("metadata")
      .eq("id", agentId)
      .maybeSingle();

    const meta = (agentReg?.metadata as Record<string, unknown>) || {};
    if (meta.force_stop === true || meta.scan_abort === true) {
      return json(
        {
          ok: false,
          error:
            "Ingestion blocked: scan is stopped. " +
            "Clear force_stop in admin to resume.",
        },
        403,
      );
    }
  }

  const relativePath = requireCanonicalRelativePath(body, "relative_path");
  const filename = requireString(body, "filename");
  const fileType = requireString(body, "file_type");
  const fileSize = optionalNumber(body, "file_size") ?? 0;
  const modifiedAt = requireString(body, "modified_at");
  const fileCreatedAt = optionalString(body, "file_created_at");
  const quickHash = requireString(body, "quick_hash");
  const quickHashVersion = optionalNumber(body, "quick_hash_version") ?? 1;
  const thumbnailUrl = optionalString(body, "thumbnail_url");
  const thumbnailError = optionalString(body, "thumbnail_error");
  const width = optionalNumber(body, "width") ?? 0;
  const height = optionalNumber(body, "height") ?? 0;

  if (!["psd", "ai"].includes(fileType)) {
    return err("file_type must be 'psd' or 'ai'");
  }

  const derived = deriveMetadataFromPath(relativePath);
  const db = serviceClient();

  // ── 1) Move detection: same quick_hash, different path ──

  const { data: existingByHash } = await db
    .from("assets")
    .select("id, relative_path")
    .eq("quick_hash", quickHash)
    .neq("relative_path", relativePath)
    .limit(1)
    .maybeSingle();

  if (existingByHash) {
    const oldPath = existingByHash.relative_path;
    const reDerived = deriveMetadataFromPath(relativePath);

      const { error: moveError } = await db
      .from("assets")
      .update({
        relative_path: relativePath,
        filename,
        modified_at: modifiedAt,
        file_created_at: fileCreatedAt || modifiedAt,
        last_seen_at: new Date().toISOString(),
        workflow_status: reDerived.workflow_status,
        is_licensed: reDerived.is_licensed,
        ...(thumbnailUrl
          ? { thumbnail_url: thumbnailUrl, thumbnail_error: null }
          : {}),
        ...(!thumbnailUrl && thumbnailError
          ? { thumbnail_error: thumbnailError }
          : {}),
      })
      .eq("id", existingByHash.id);

    if (moveError) return err(moveError.message, 500);

    await db.from("asset_path_history").insert({
      asset_id: existingByHash.id,
      old_relative_path: oldPath,
      new_relative_path: relativePath,
    });

    return json({
      ok: true,
      action: "moved",
      asset_id: existingByHash.id,
    });
  }

  // ── 2) Update existing by path ──

  const { data: existingByPath } = await db
    .from("assets")
    .select("id")
    .eq("relative_path", relativePath)
    .maybeSingle();

  if (existingByPath) {
    const { error: updateError } = await db
      .from("assets")
      .update({
        filename,
        file_type: fileType,
        file_size: fileSize,
        width,
        height,
        modified_at: modifiedAt,
        file_created_at: fileCreatedAt || modifiedAt,
        quick_hash: quickHash,
        quick_hash_version: quickHashVersion,
        last_seen_at: new Date().toISOString(),
        ...(thumbnailUrl
          ? { thumbnail_url: thumbnailUrl, thumbnail_error: null }
          : {}),
        ...(!thumbnailUrl && thumbnailError
          ? { thumbnail_error: thumbnailError }
          : {}),
      })
      .eq("id", existingByPath.id);

    if (updateError) return err(updateError.message, 500);

    // Queue AI tagging if this update provides a new thumbnail
    if (thumbnailUrl) {
      await db.from("processing_queue").insert({
        asset_id: existingByPath.id,
        job_type: "ai-tag",
      }).then(() => {}).catch(() => {}); // best-effort, don't block ingest
    }

    return json({
      ok: true,
      action: "updated",
      asset_id: existingByPath.id,
    });
  }

  // ── 3) New asset ──

  const { data: newAsset, error: insertError } = await db
    .from("assets")
    .insert({
      relative_path: relativePath,
      filename,
      file_type: fileType,
      file_size: fileSize,
      width,
      height,
      modified_at: modifiedAt,
      file_created_at: fileCreatedAt || modifiedAt,
      quick_hash: quickHash,
      quick_hash_version: quickHashVersion,
      last_seen_at: new Date().toISOString(),
      thumbnail_url: thumbnailUrl,
      thumbnail_error: thumbnailError,
      workflow_status: derived.workflow_status,
      is_licensed: derived.is_licensed,
    })
    .select("id")
    .single();

  if (insertError) return err(insertError.message, 500);

  // Queue for thumbnail processing (if no thumbnail yet)
  if (!thumbnailUrl) {
    await db.from("processing_queue").insert({
      asset_id: newAsset.id,
      job_type: "thumbnail",
    });
  }

  // Queue for AI tagging if thumbnail is available
  if (thumbnailUrl) {
    await db.from("processing_queue").insert({
      asset_id: newAsset.id,
      job_type: "ai-tag",
    });
  }

  return json({ ok: true, action: "created", asset_id: newAsset.id });
}

// ── Route: update-asset ─────────────────────────────────────────────

const ALLOWED_UPDATE_FIELDS = [
  "thumbnail_url",
  "thumbnail_error",
  "status",
  "tags",
  "width",
  "height",
  "artboards",
  "file_size",
  "ai_description",
  "scene_description",
  "workflow_status",
  "is_licensed",
  "licensor_id",
  "property_id",
  "asset_type",
  "art_source",
  "big_theme",
  "little_theme",
  "design_ref",
  "design_style",
];

async function handleUpdateAsset(body: Record<string, unknown>) {
  const assetId = requireString(body, "asset_id");
  const updates: Record<string, unknown> = {};

  for (const field of ALLOWED_UPDATE_FIELDS) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return err("No valid fields to update");
  }

  const db = serviceClient();
  const { error } = await db
    .from("assets")
    .update(updates)
    .eq("id", assetId);

  if (error) return err(error.message, 500);
  return json({ ok: true, asset_id: assetId });
}

// ── Route: move-asset ───────────────────────────────────────────────

async function handleMoveAsset(body: Record<string, unknown>) {
  const assetId = requireString(body, "asset_id");
  const newRelativePath = requireCanonicalRelativePath(
    body,
    "new_relative_path",
  );
  const newFilename = optionalString(body, "filename");

  const db = serviceClient();

  const { data: asset, error: fetchError } = await db
    .from("assets")
    .select("relative_path, filename")
    .eq("id", assetId)
    .single();

  if (fetchError || !asset) return err("Asset not found", 404);

  const derived = deriveMetadataFromPath(newRelativePath);

  const { error: updateError } = await db
    .from("assets")
    .update({
      relative_path: newRelativePath,
      filename: newFilename || asset.filename,
      workflow_status: derived.workflow_status,
      is_licensed: derived.is_licensed,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", assetId);

  if (updateError) return err(updateError.message, 500);

  await db.from("asset_path_history").insert({
    asset_id: assetId,
    old_relative_path: asset.relative_path,
    new_relative_path: newRelativePath,
  });

  return json({ ok: true, asset_id: assetId });
}

// ── Route: scan-progress ────────────────────────────────────────────

async function handleScanProgress(body: Record<string, unknown>) {
  const sessionId = requireString(body, "session_id");
  const status = requireString(body, "status");
  const counters = body.counters as Record<string, unknown> | undefined;
  const currentPath = optionalString(body, "current_path");

  const db = serviceClient();

  // Store progress in admin_config for UI consumption
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

  // When scan completes or fails, also update SCAN_REQUEST if session matches
  if (status === "completed" || status === "failed") {
    const { data: reqRow } = await db
      .from("admin_config")
      .select("value")
      .eq("key", "SCAN_REQUEST")
      .maybeSingle();

    if (reqRow) {
      const reqVal = reqRow.value as Record<string, unknown>;
      if (reqVal.request_id === sessionId) {
        await db
          .from("admin_config")
          .update({
            value: {
              ...reqVal,
              status,
              completed_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq("key", "SCAN_REQUEST");
      }
    }
  }

  return json({ ok: true });
}

// ── Route: ingestion-progress ───────────────────────────────────────

async function handleIngestionProgress(body: Record<string, unknown>) {
  const processed = requireNumber(body, "processed");
  const total = requireNumber(body, "total");

  const db = serviceClient();
  const { error } = await db.from("admin_config").upsert({
    key: "INGESTION_PROGRESS",
    value: {
      processed,
      total,
      updated_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  });

  if (error) return err(error.message, 500);
  return json({ ok: true });
}

// ── Route: queue-render ─────────────────────────────────────────────

async function handleQueueRender(body: Record<string, unknown>) {
  const assetId = requireString(body, "asset_id");
  const _reason = optionalString(body, "reason") ?? "no_pdf_compat";

  const db = serviceClient();
  const { data, error } = await db
    .from("render_queue")
    .insert({ asset_id: assetId, status: "pending" })
    .select("id")
    .single();

  if (error) return err(error.message, 500);
  return json({ ok: true, job_id: data.id });
}

// ── Route: claim-render ─────────────────────────────────────────────

async function handleClaimRender(body: Record<string, unknown>) {
  const agentId = requireString(body, "agent_id");
  const db = serviceClient();

  const { data: jobs } = await db
    .from("render_queue")
    .select("id, asset_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (!jobs || jobs.length === 0) {
    return json({ ok: true, job: null });
  }

  const job = jobs[0];
  const { error } = await db
    .from("render_queue")
    .update({
      status: "claimed",
      claimed_by: agentId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "pending"); // optimistic lock

  if (error) {
    return json({ ok: true, job: null }); // someone else claimed it
  }

  return json({
    ok: true,
    job: { job_id: job.id, asset_id: job.asset_id },
  });
}

// ── Route: complete-render ──────────────────────────────────────────

async function handleCompleteRender(body: Record<string, unknown>) {
  const jobId = requireString(body, "job_id");
  const success = body.success === true;
  const thumbnailUrl = optionalString(body, "thumbnail_url");
  const errorMsg = optionalString(body, "error");

  const db = serviceClient();

  const { data: job } = await db
    .from("render_queue")
    .select("asset_id")
    .eq("id", jobId)
    .single();

  if (!job) return err("Job not found", 404);

  await db
    .from("render_queue")
    .update({
      status: success ? "completed" : "failed",
      completed_at: new Date().toISOString(),
      error_message: errorMsg,
    })
    .eq("id", jobId);

  if (success && thumbnailUrl) {
    await db
      .from("assets")
      .update({ thumbnail_url: thumbnailUrl, thumbnail_error: null })
      .eq("id", job.asset_id);
  }

  return json({ ok: true });
}

// ── Route: trigger-scan (no-op fallback — use admin_config SCAN_REQUEST) ──

async function handleTriggerScan(_body: Record<string, unknown>) {
  return json({
    ok: true,
    note: "Scan requests are now managed via admin_config SCAN_REQUEST",
  });
}

// ── Route: check-scan-request ───────────────────────────────────────

async function handleCheckScanRequest(
  _body: Record<string, unknown>,
  agentId: string,
) {
  const db = serviceClient();
  const { data: agent } = await db
    .from("agent_registrations")
    .select("metadata")
    .eq("id", agentId)
    .single();

  if (!agent) return err("Agent not found", 404);

  const metadata = (agent.metadata as Record<string, unknown>) || {};
  const scanRequested = metadata.scan_requested === true;
  const scanAbort = metadata.scan_abort === true;

  if (scanRequested || scanAbort) {
    await db
      .from("agent_registrations")
      .update({
        metadata: {
          ...metadata,
          scan_requested: false,
          scan_abort: false,
        },
      })
      .eq("id", agentId);
  }

  return json({
    ok: true,
    scan_requested: scanRequested,
    scan_abort: scanAbort,
  });
}

// ── Route: claim ────────────────────────────────────────────────────

async function handleClaim(body: Record<string, unknown>) {
  const agentId = requireString(body, "agent_id");
  const batchSize = optionalNumber(body, "batch_size") ?? 5;

  const db = serviceClient();
  const { data, error } = await db.rpc("claim_jobs", {
    p_agent_id: agentId,
    p_batch_size: batchSize,
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, jobs: data });
}

// ── Route: complete ─────────────────────────────────────────────────

async function handleComplete(body: Record<string, unknown>) {
  const jobId = requireString(body, "job_id");
  const success = body.success === true;
  const errorMessage = optionalString(body, "error_message");

  const db = serviceClient();
  const { error } = await db
    .from("processing_queue")
    .update({
      status: success ? "completed" : "failed",
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
    })
    .eq("id", jobId);

  if (error) return err(error.message, 500);
  return json({ ok: true });
}

// ── Route: reset-stale ──────────────────────────────────────────────

async function handleResetStale(body: Record<string, unknown>) {
  const timeoutMinutes = optionalNumber(body, "timeout_minutes") ?? 30;

  const db = serviceClient();
  const { data, error } = await db.rpc("reset_stale_jobs", {
    p_timeout_minutes: timeoutMinutes,
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, reset_count: data });
}

// ── Route: set-scan-roots ───────────────────────────────────────────

async function handleSetScanRoots(
  body: Record<string, unknown>,
  agentId: string,
) {
  const scanRoots = body.scan_roots;
  if (!Array.isArray(scanRoots)) {
    return err("scan_roots must be an array");
  }

  const db = serviceClient();
  const { data: agent } = await db
    .from("agent_registrations")
    .select("metadata")
    .eq("id", agentId)
    .single();

  if (!agent) return err("Agent not found", 404);

  const metadata = (agent.metadata as Record<string, unknown>) || {};
  await db
    .from("agent_registrations")
    .update({ metadata: { ...metadata, scan_roots: scanRoots } })
    .eq("id", agentId);

  return json({ ok: true });
}

// ── Route: get-scan-roots ───────────────────────────────────────────

async function handleGetScanRoots(agentId: string) {
  const db = serviceClient();
  const { data: agent } = await db
    .from("agent_registrations")
    .select("metadata")
    .eq("id", agentId)
    .single();

  if (!agent) return err("Agent not found", 404);

  const metadata = (agent.metadata as Record<string, unknown>) || {};
  return json({ ok: true, scan_roots: metadata.scan_roots || [] });
}

// ── Route: get-config ───────────────────────────────────────────────

async function handleGetConfig(body: Record<string, unknown>) {
  const keys = body.keys;
  const db = serviceClient();

  let query = db.from("admin_config").select("key, value");
  if (Array.isArray(keys) && keys.length > 0) {
    query = query.in("key", keys as string[]);
  }

  const { data, error } = await query;
  if (error) return err(error.message, 500);

  const config: Record<string, unknown> = {};
  for (const row of data || []) {
    config[row.key] = row.value;
  }
  return json({ ok: true, config });
}

// ── Route: report-path-test ─────────────────────────────────────────

async function handleReportPathTest(body: Record<string, unknown>) {
  const requestId = requireString(body, "request_id");
  const results = body.results as Record<string, unknown>;
  if (!results) return err("Missing 'results' object");

  const db = serviceClient();

  await db.from("admin_config").upsert(
    {
      key: "PATH_TEST_RESULT",
      value: {
        request_id: requestId,
        tested_at: new Date().toISOString(),
        ...results,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  await db
    .from("admin_config")
    .update({
      value: { request_id: requestId, status: "completed" },
      updated_at: new Date().toISOString(),
    })
    .eq("key", "PATH_TEST_REQUEST");

  return json({ ok: true });
}

// ── Main router ─────────────────────────────────────────────────────

// ── Route: check-changed ─────────────────────────────────────────────

async function handleCheckChanged(body: Record<string, unknown>) {
  const files = body.files;
  if (!Array.isArray(files) || files.length === 0) {
    return err("files must be a non-empty array");
  }

  // Cap batch size to prevent abuse
  if (files.length > 500) {
    return err("files array exceeds maximum batch size of 500");
  }

  const db = serviceClient();
  const relativePaths = files.map((f: Record<string, unknown>) => f.relative_path as string);

  // Fetch existing assets by relative_path in one query
  const { data: existingAssets, error } = await db
    .from("assets")
    .select("relative_path, modified_at, file_size")
    .in("relative_path", relativePaths)
    .eq("is_deleted", false);

  if (error) return err(error.message, 500);

  // Build lookup map: relative_path -> { modified_at, file_size }
  const existingMap = new Map<string, { modified_at: string; file_size: number | null }>();
  for (const asset of existingAssets || []) {
    existingMap.set(asset.relative_path, {
      modified_at: asset.modified_at,
      file_size: asset.file_size,
    });
  }

  // Determine which files are new or changed
  const changed: string[] = [];
  for (const file of files) {
    const f = file as Record<string, unknown>;
    const rp = f.relative_path as string;
    const existing = existingMap.get(rp);

    if (!existing) {
      // New file — needs processing
      changed.push(rp);
      continue;
    }

    // Compare modified_at (truncate to seconds for comparison)
    const incomingMod = new Date(f.modified_at as string).getTime();
    const existingMod = new Date(existing.modified_at).getTime();
    const incomingSize = f.file_size as number;

    if (incomingMod !== existingMod || incomingSize !== (existing.file_size ?? 0)) {
      changed.push(rp);
    }
  }

  return json({ ok: true, changed });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return err("Method not allowed", 405);
  }

  const url = new URL(req.url);
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const route = pathSegments[pathSegments.length - 1] || "";

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body");
  }

  const action = (body.action as string) || route;

  try {
    // Register doesn't require existing auth
    if (action === "register") {
      return await handleRegister(body);
    }

    // All other routes require agent authentication
    const authResult = await authenticateAgent(req);
    if (authResult instanceof Response) return authResult;
    const { agentId } = authResult;

    switch (action) {
      case "heartbeat":
        return await handleHeartbeat(body, agentId);
      case "ingest":
        return await handleIngest(body, agentId);
      case "update-asset":
        return await handleUpdateAsset(body);
      case "move-asset":
        return await handleMoveAsset(body);
      case "scan-progress":
        return await handleScanProgress(body);
      case "ingestion-progress":
        return await handleIngestionProgress(body);
      case "queue-render":
        return await handleQueueRender(body);
      case "claim-render":
        return await handleClaimRender(body);
      case "complete-render":
        return await handleCompleteRender(body);
      case "trigger-scan":
        return await handleTriggerScan(body);
      case "check-scan-request":
        return await handleCheckScanRequest(body, agentId);
      case "claim":
        return await handleClaim(body);
      case "complete":
        return await handleComplete(body);
      case "reset-stale":
        return await handleResetStale(body);
      case "set-scan-roots":
        return await handleSetScanRoots(body, agentId);
      case "get-scan-roots":
        return await handleGetScanRoots(agentId);
      case "get-config":
        return await handleGetConfig(body);
      case "report-path-test":
        return await handleReportPathTest(body);
      case "check-changed":
        return await handleCheckChanged(body);
      default:
        return err(`Unknown action: ${action}`, 404);
    }
  } catch (e) {
    console.error("agent-api error:", e);
    return err(
      e instanceof Error ? e.message : "Internal server error",
      500,
    );
  }
});
