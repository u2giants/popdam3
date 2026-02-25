import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseSku } from "../_shared/sku-parser.ts";
import { extractSkuFolder, selectPrimaryAsset } from "../_shared/style-grouping.ts";

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
  "concept approved designs": "concept_approved",
  "in development": "in_development",
  "freelancer art": "freelancer_art",
  "discontinued": "discontinued",
  "product ideas": "product_ideas",
};

interface DerivedMetadata {
  workflow_status: string;
  is_licensed: boolean;
  licensor_name: string | null;
  property_name: string | null;
  licensor_id: string | null;
  property_id: string | null;
}

async function deriveMetadataFromPath(
  relativePath: string,
  db: ReturnType<typeof serviceClient>,
): Promise<DerivedMetadata> {
  const pathParts = relativePath.split("/");

  // is_licensed: find the "Decor" folder and check sub-folder
  const decorIndex = pathParts.findIndex(
    (p) => p.toLowerCase() === "decor",
  );
  const subFolder =
    decorIndex >= 0 ? (pathParts[decorIndex + 1] || "").toLowerCase() : "";
  const is_licensed = subFolder === "character licensed";

  // workflow_status: match exact folder names against each path segment
  const lowerParts = pathParts.map((p) => p.toLowerCase());
  let workflow_status = "other";
  for (const [folder, status] of Object.entries(WORKFLOW_FOLDER_MAP)) {
    if (lowerParts.some((p) => p === folder)) {
      workflow_status = status;
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

  // Look up licensor_id and property_id from DB
  let licensor_id: string | null = null;
  let property_id: string | null = null;

  if (licensor_name) {
    const { data: lic } = await db
      .from("licensors")
      .select("id")
      .ilike("name", licensor_name)
      .maybeSingle();
    licensor_id = lic?.id || null;
  }

  if (licensor_id && property_name) {
    const { data: prop } = await db
      .from("properties")
      .select("id")
      .eq("licensor_id", licensor_id)
      .ilike("name", property_name)
      .maybeSingle();
    property_id = prop?.id || null;
  }

  return {
    workflow_status,
    is_licensed,
    licensor_name,
    property_name,
    licensor_id,
    property_id,
  };
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
  "SCAN_ALLOWED_SUBFOLDERS",
  "WINDOWS_AGENT_NAS_HOST",
  "WINDOWS_AGENT_NAS_SHARE",
  "WINDOWS_AGENT_NAS_USER",
  "WINDOWS_AGENT_NAS_PASS",
  "WINDOWS_AGENT_NAS_MOUNT_PATH",
  "DO_SPACES_KEY",
  "DO_SPACES_SECRET",
  "AGENT_UPDATE_REQUEST",
  "SCAN_MIN_DATE",
  "WINDOWS_RENDER_MODE",
];

async function handleHeartbeat(
  body: Record<string, unknown>,
  agentId: string,
) {
  const counters = body.counters as Record<string, unknown> | undefined;
  const lastError = optionalString(body, "last_error");
  const health = body.health as Record<string, unknown> | undefined;
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
    // Structured health payload from Windows agent preflight
    health: health ? {
      healthy: health.healthy ?? false,
      nas_healthy: health.nasHealthy ?? false,
      illustrator_healthy: health.illustratorHealthy ?? false,
      illustrator_crash_dialog: health.illustratorCrashDialog ?? false,
      last_preflight_error: health.lastPreflightError ?? null,
      last_preflight_at: health.lastPreflightAt ?? null,
    } : metadata.health,
  };

  const { error: updateErr } = await db
    .from("agent_registrations")
    .update({
      last_heartbeat: new Date().toISOString(),
      metadata: newMetadata,
    })
    .eq("id", agentId);

  if (updateErr) return err(updateErr.message, 500);

  // ── Cleanup expired/used bootstrap tokens ──
  try {
    const { data: tokenRow } = await db
      .from("admin_config")
      .select("value")
      .eq("key", "WINDOWS_BOOTSTRAP_TOKEN")
      .maybeSingle();

    if (tokenRow) {
      const tokenVal = tokenRow.value as Record<string, unknown>;
      if (tokenVal) {
        const isExpired = tokenVal.expires_at && new Date(tokenVal.expires_at as string).getTime() < Date.now();
        const isUsed = tokenVal.used === true;
        if (isExpired || isUsed) {
          await db.from("admin_config").delete().eq("key", "WINDOWS_BOOTSTRAP_TOKEN");
        }
      }
    }
  } catch (cleanupErr) {
    // Non-fatal — log and continue
    console.error("Bootstrap token cleanup failed:", cleanupErr);
  }

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

  // ── Update command from admin ──
  const updateRequest =
    configMap.AGENT_UPDATE_REQUEST as Record<string, unknown> | undefined;
  let checkUpdate = false;
  let applyUpdate = false;

  if (updateRequest && updateRequest.requested_at) {
    const requestAge = Date.now() - new Date(updateRequest.requested_at as string).getTime();
    if (requestAge < 5 * 60 * 1000) {
      checkUpdate = updateRequest.action === "check";
      applyUpdate = updateRequest.action === "apply";

      // Clear the request after delivering
      await db.from("admin_config").delete().eq("key", "AGENT_UPDATE_REQUEST");
    }
  }

  // ── Response ──
  return json({
    ok: true,
    config: {
      do_spaces: {
        key: ((configMap.DO_SPACES_KEY as string) || ""),
        secret: ((configMap.DO_SPACES_SECRET as string) || ""),
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
        batch_size: (guard.batch_size as number) || pollingConfig.batch_size || 100,
        scan_min_date: (configMap.SCAN_MIN_DATE as string) || null,
        allowed_subfolders: (configMap.SCAN_ALLOWED_SUBFOLDERS as string[]) || [],
        adaptive_polling: {
          idle_seconds: pollingConfig.idle_seconds ?? 30,
          active_seconds: pollingConfig.active_seconds ?? 5,
        },
      },
      resource_guard: resourceDirectives,
      auto_scan: autoScanConfig,
      windows_render_mode: (configMap.WINDOWS_RENDER_MODE as string) || "fallback_only",
      windows_agent: {
        nas_host: ((configMap.WINDOWS_AGENT_NAS_HOST as string) || ""),
        nas_share: ((configMap.WINDOWS_AGENT_NAS_SHARE as string) || ""),
        nas_username: ((configMap.WINDOWS_AGENT_NAS_USER as string) || ""),
        nas_password: ((configMap.WINDOWS_AGENT_NAS_PASS as string) || ""),
        nas_mount_path: ((configMap.WINDOWS_AGENT_NAS_MOUNT_PATH as string) || ""),
      },
    },
    commands: {
      force_scan: forceScan,
      scan_session_id: scanSessionId,
      abort_scan: scanAbort || forceStop,
      test_paths: testPaths,
      check_update: checkUpdate,
      apply_update: applyUpdate,
    },
  });
}

// ── Style group assignment helper ────────────────────────────────────

// ── Style group assignment helper ────────────────────────────────────

async function assignToStyleGroup(
  relativePath: string,
  assetId: string,
  skuFields: Record<string, unknown>,
  db: ReturnType<typeof serviceClient>,
): Promise<void> {
  try {
    const sku = extractSkuFolder(relativePath);
    if (!sku) return;
    const folderPath = relativePath.split("/").slice(0, -1).join("/");

    let { data: group } = await db
      .from("style_groups")
      .select("id")
      .eq("sku", sku)
      .maybeSingle();

    if (!group) {
      const groupFields: Record<string, unknown> = {
        sku,
        folder_path: folderPath,
        is_licensed: skuFields.is_licensed ?? false,
        licensor_id: skuFields.licensor_id ?? null,
        licensor_code: skuFields.licensor_code ?? null,
        licensor_name: skuFields.licensor_name ?? null,
        property_id: skuFields.property_id ?? null,
        property_code: skuFields.property_code ?? null,
        property_name: skuFields.property_name ?? null,
        product_category: skuFields.product_category ?? null,
        division_code: skuFields.division_code ?? null,
        division_name: skuFields.division_name ?? null,
        mg01_code: skuFields.mg01_code ?? null,
        mg01_name: skuFields.mg01_name ?? null,
        mg02_code: skuFields.mg02_code ?? null,
        mg02_name: skuFields.mg02_name ?? null,
        mg03_code: skuFields.mg03_code ?? null,
        mg03_name: skuFields.mg03_name ?? null,
        size_code: skuFields.size_code ?? null,
        size_name: skuFields.size_name ?? null,
      };
      const { data: newGroup } = await db
        .from("style_groups")
        .upsert(groupFields, { onConflict: "sku", ignoreDuplicates: false })
        .select("id")
        .single();
      group = newGroup;
    }

    if (!group) return;

    // Only assign group ID — skip stats update during ingest for performance.
    // Run "Rebuild Style Groups" after scan completes to update primary_asset_id, asset_count, etc.
    await db.from("assets").update({ style_group_id: group.id }).eq("id", assetId);
  } catch (e) {
    console.error("assignToStyleGroup error (non-fatal):", e);
  }
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

  // ── Junk-file guard: skip system/temp files before any DB work ──
  const JUNK_FILENAMES = new Set([".DS_Store", ".localized", "Thumbs.db", "desktop.ini"]);
  if (
    filename.startsWith("._") ||
    filename.startsWith("~") ||
    JUNK_FILENAMES.has(filename) ||
    relativePath.includes("__MACOSX")
  ) {
    return json({ ok: true, action: "skipped", reason: "junk file" });
  }

  // ── Configurable subfolder filter ──
  // If SCAN_ALLOWED_SUBFOLDERS is set and non-empty, only allow files under those subfolders of "Decor/"
  // If not set or empty, allow all files through (no filter)
  const ingestParts = relativePath.split("/");
  const db0 = serviceClient();
  const { data: subfolderConfig } = await db0
    .from("admin_config")
    .select("value")
    .eq("key", "SCAN_ALLOWED_SUBFOLDERS")
    .maybeSingle();
  const allowedSubfolders = Array.isArray(subfolderConfig?.value) ? subfolderConfig.value as string[] : [];
  if (allowedSubfolders.length > 0) {
    const ingestDecorIndex = ingestParts.findIndex(
      (p) => p.toLowerCase() === "decor",
    );
    if (ingestDecorIndex !== -1) {
      const ingestSubFolder = (ingestParts[ingestDecorIndex + 1] || "").toLowerCase();
      if (!allowedSubfolders.includes(ingestSubFolder)) {
        return json({ ok: true, action: "rejected_subfolder", reason: "ignored folder" });
      }
    }
  }

  // Defense in depth: reject files inside ___OLD folders
  const hasOldFolder = ingestParts.some(p => p.toLowerCase() === "___old");
  if (hasOldFolder) {
    return json({ ok: true, action: "noop", reason: "excluded ___old folder" });
  }

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

  const db = serviceClient();
  const derived = await deriveMetadataFromPath(relativePath, db);

  // SKU parsing from filename
  const parsed = await parseSku(filename);
  const skuFields = parsed ? {
    sku: parsed.sku,
    mg01_code: parsed.mg01_code, mg01_name: parsed.mg01_name,
    mg02_code: parsed.mg02_code, mg02_name: parsed.mg02_name,
    mg03_code: parsed.mg03_code, mg03_name: parsed.mg03_name,
    size_code: parsed.size_code, size_name: parsed.size_name,
    licensor_code: parsed.licensor_code, licensor_name: parsed.licensor_name,
    property_code: parsed.property_code, property_name: parsed.property_name,
    sku_sequence: parsed.sku_sequence,
    product_category: parsed.product_category,
    division_code: parsed.division_code, division_name: parsed.division_name,
    is_licensed: parsed.is_licensed,
  } : {};

  // ── 1) Move detection: same quick_hash, different path ──

  const { data: existingByHash } = await db
    .from("assets")
    .select("id, relative_path")
    .eq("quick_hash", quickHash)
    .eq("is_deleted", false)
    .neq("relative_path", relativePath)
    .limit(1)
    .maybeSingle();

  if (existingByHash) {
    const oldPath = existingByHash.relative_path;
    const reDerived = await deriveMetadataFromPath(relativePath, db);

    // Thumbnail logic: protect existing working thumbnails from being overwritten by errors
    const thumbMove: Record<string, unknown> = {};
    if (thumbnailUrl) {
      thumbMove.thumbnail_url = thumbnailUrl;
      thumbMove.thumbnail_error = null;
    } else if (thumbnailError) {
      const { data: current } = await db
        .from("assets")
        .select("thumbnail_url")
        .eq("id", existingByHash.id)
        .single();
      if (!current?.thumbnail_url) {
        thumbMove.thumbnail_error = thumbnailError;
      }
    }

    const moveUpdates: Record<string, unknown> = {
        relative_path: relativePath,
        filename,
        modified_at: modifiedAt,
        file_created_at: fileCreatedAt || modifiedAt,
        last_seen_at: new Date().toISOString(),
        workflow_status: reDerived.workflow_status,
        is_licensed: reDerived.is_licensed,
        ...thumbMove,
        ...skuFields,
    };
    if (reDerived.licensor_id) moveUpdates.licensor_id = reDerived.licensor_id;
    if (reDerived.property_id) moveUpdates.property_id = reDerived.property_id;

    const { error: moveError } = await db
      .from("assets")
      .update(moveUpdates)
      .eq("id", existingByHash.id);

    if (moveError) return err(moveError.message, 500);

    await db.from("asset_path_history").insert({
      asset_id: existingByHash.id,
      old_relative_path: oldPath,
      new_relative_path: relativePath,
    });

    assignToStyleGroup(relativePath, existingByHash.id, skuFields, db).catch(() => {});

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
    // Thumbnail update logic:
    // - If incoming has a thumbnailUrl, ALWAYS overwrite (successful generation)
    // - If incoming has only a thumbnailError, only set it if there's no existing working thumbnail
    const thumbnailFields: Record<string, unknown> = {};
    if (thumbnailUrl) {
      // Always overwrite with a working thumbnail
      thumbnailFields.thumbnail_url = thumbnailUrl;
      thumbnailFields.thumbnail_error = null;
    } else if (thumbnailError) {
      // Only set error if asset doesn't already have a working thumbnail
      // Fetch current thumbnail_url to check
      const { data: currentAsset } = await db
        .from("assets")
        .select("thumbnail_url")
        .eq("id", existingByPath.id)
        .single();
      if (!currentAsset?.thumbnail_url) {
        thumbnailFields.thumbnail_error = thumbnailError;
      }
    }

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
        ...thumbnailFields,
        ...skuFields,
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

    assignToStyleGroup(relativePath, existingByPath.id, skuFields, db).catch(() => {});

    return json({
      ok: true,
      action: "updated",
      asset_id: existingByPath.id,
    });
  }

  // ── 3) New asset ──

  const newAssetRow: Record<string, unknown> = {
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
      ...skuFields,
  };
  if (derived.licensor_id) newAssetRow.licensor_id = derived.licensor_id;
  if (derived.property_id) newAssetRow.property_id = derived.property_id;

  const { data: newAsset, error: insertError } = await db
    .from("assets")
    .insert(newAssetRow)
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

  assignToStyleGroup(relativePath, newAsset.id, skuFields, db).catch(() => {});

  return json({ ok: true, action: "created", asset_id: newAsset.id, needs_group_rebuild: true });
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

  const derived = await deriveMetadataFromPath(newRelativePath, db);

  const moveUpdates: Record<string, unknown> = {
      relative_path: newRelativePath,
      filename: newFilename || asset.filename,
      workflow_status: derived.workflow_status,
      is_licensed: derived.is_licensed,
      last_seen_at: new Date().toISOString(),
  };
  if (derived.licensor_id) moveUpdates.licensor_id = derived.licensor_id;
  if (derived.property_id) moveUpdates.property_id = derived.property_id;

  const { error: updateError } = await db
    .from("assets")
    .update(moveUpdates)
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

  // Guard: reject junk files before inserting into render queue
  const { data: asset } = await db
    .from("assets")
    .select("filename")
    .eq("id", assetId)
    .single();

  if (asset) {
    const f = asset.filename;
    if (
      f.startsWith("._") ||
      f.startsWith("~") ||
      f === ".DS_Store" ||
      f === ".localized" ||
      f === "Thumbs.db" ||
      f === "desktop.ini"
    ) {
      return json({ ok: true, job_id: null, skipped: true, reason: "junk file" });
    }
  }

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
  const batchSize = Math.min((body.batch_size as number) || 1, 5);
  const db = serviceClient();

  const LEASE_DURATION_MINUTES = 5;
  const MAX_ATTEMPTS = 5;
  const now = new Date().toISOString();

  // Use raw SQL via rpc for FOR UPDATE SKIP LOCKED — not available in PostgREST
  // Select pending jobs OR expired-lease claimed jobs, atomically claim them
  const { data: claimedJobs, error: claimErr } = await db.rpc("claim_render_jobs", {
    p_agent_id: agentId,
    p_batch_size: batchSize,
    p_lease_minutes: LEASE_DURATION_MINUTES,
    p_max_attempts: MAX_ATTEMPTS,
  });

  if (claimErr || !claimedJobs || claimedJobs.length === 0) {
    return json({ ok: true, job: null, jobs: [] });
  }

  // Fetch asset details for all claimed jobs
  const assetIds = claimedJobs.map((j: Record<string, unknown>) => j.asset_id);
  const { data: assets } = await db
    .from("assets")
    .select("id, relative_path, file_type, filename")
    .in("id", assetIds);

  const assetMap = new Map((assets || []).map((a: Record<string, unknown>) => [a.id, a]));

  const jobResults = claimedJobs.map((j: Record<string, unknown>) => {
    const asset = assetMap.get(j.asset_id) as Record<string, unknown> | undefined;
    return {
      job_id: j.id,
      asset_id: j.asset_id,
      relative_path: asset?.relative_path || null,
      file_type: asset?.file_type || null,
      filename: asset?.filename || null,
      attempts: j.attempts,
      lease_expires_at: j.lease_expires_at,
    };
  });

  // Backward compat: single job in `job` field
  return json({
    ok: true,
    job: jobResults[0] || null,
    jobs: jobResults,
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
      lease_expires_at: null, // clear lease on completion
    })
    .eq("id", jobId);

  if (success && thumbnailUrl) {
    await db
      .from("assets")
      .update({ thumbnail_url: thumbnailUrl, thumbnail_error: null })
      .eq("id", job.asset_id);

    // Re-evaluate style group primary now that this asset has a working thumbnail
    const { data: asset } = await db
      .from("assets")
      .select("style_group_id")
      .eq("id", job.asset_id)
      .single();

    if (asset?.style_group_id) {
      const { data: groupAssets } = await db
        .from("assets")
        .select("id, filename, file_type, created_at, thumbnail_url, thumbnail_error")
        .eq("style_group_id", asset.style_group_id)
        .eq("is_deleted", false);

      if (groupAssets && groupAssets.length > 0) {
        const primaryId = selectPrimaryAsset(groupAssets);
        if (primaryId) {
          await db
            .from("style_groups")
            .update({ primary_asset_id: primaryId })
            .eq("id", asset.style_group_id);
        }
      }
    }
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

  // Fetch existing assets by relative_path in one query (include thumbnail info for retry logic)
  const { data: existingAssets, error } = await db
    .from("assets")
    .select("relative_path, modified_at, file_size, thumbnail_url, thumbnail_error")
    .in("relative_path", relativePaths)
    .eq("is_deleted", false);

  if (error) return err(error.message, 500);

  // Build lookup map
  const existingMap = new Map<string, {
    modified_at: string;
    file_size: number | null;
    thumbnail_url: string | null;
    thumbnail_error: string | null;
  }>();
  for (const asset of existingAssets || []) {
    existingMap.set(asset.relative_path, {
      modified_at: asset.modified_at,
      file_size: asset.file_size,
      thumbnail_url: asset.thumbnail_url,
      thumbnail_error: asset.thumbnail_error,
    });
  }

  // Determine which files are new or changed
  const changed: string[] = [];
  // Files that are unchanged but have retryable thumbnail failures
  const needsThumbnail: string[] = [];
  const PERMANENT_THUMB_ERRORS = ["no_pdf_compat", "no_preview_or_render_failed"];

  for (const file of files) {
    const f = file as Record<string, unknown>;
    const rp = f.relative_path as string;
    const existing = existingMap.get(rp);

    if (!existing) {
      changed.push(rp);
      continue;
    }

    const incomingMod = new Date(f.modified_at as string).getTime();
    const existingMod = new Date(existing.modified_at).getTime();
    const incomingSize = f.file_size as number;

    if (incomingMod !== existingMod || incomingSize !== (existing.file_size ?? 0)) {
      changed.push(rp);
    } else if (
      !existing.thumbnail_url &&
      existing.thumbnail_error &&
      !PERMANENT_THUMB_ERRORS.includes(existing.thumbnail_error)
    ) {
      // Unchanged file but has a retryable thumbnail failure — retry it
      needsThumbnail.push(rp);
    }
  }

  return json({ ok: true, changed, needs_thumbnail: needsThumbnail });
}

// ── Route: save-checkpoint ───────────────────────────────────────────

async function handleSaveCheckpoint(body: Record<string, unknown>, agentId: string) {
  const sessionId = requireString(body, "session_id");
  const lastCompletedDir = requireString(body, "last_completed_dir");

  const db = serviceClient();
  const { error } = await db
    .from("admin_config")
    .upsert({
      key: "SCAN_CHECKPOINT",
      value: {
        session_id: sessionId,
        last_completed_dir: lastCompletedDir,
        saved_at: new Date().toISOString(),
        agent_id: agentId,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

  if (error) return err(error.message, 500);
  return json({ ok: true });
}

// ── Route: get-checkpoint ───────────────────────────────────────────

async function handleGetCheckpoint(agentId: string) {
  const db = serviceClient();
  const { data, error } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "SCAN_CHECKPOINT")
    .maybeSingle();

  if (error) return err(error.message, 500);
  if (!data) return json({ ok: true, checkpoint: null });

  const checkpoint = data.value as Record<string, unknown>;
  // Only return checkpoint if it belongs to this agent
  if (checkpoint.agent_id !== agentId) {
    return json({ ok: true, checkpoint: null });
  }

  return json({ ok: true, checkpoint });
}

// ── Route: clear-checkpoint ─────────────────────────────────────────

async function handleClearCheckpoint() {
  const db = serviceClient();
  await db.from("admin_config").delete().eq("key", "SCAN_CHECKPOINT");
  return json({ ok: true });
}

// ── Route: report-update-status ──────────────────────────────────────

async function handleReportUpdateStatus(body: Record<string, unknown>) {
  const db = serviceClient();
  const { error } = await db.from("admin_config").upsert({
    key: "AGENT_UPDATE_STATUS",
    value: {
      ...body,
      reported_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  });

  if (error) return err(error.message, 500);
  return json({ ok: true });
}

// ── Route: pair (unified pairing code flow for bridge + windows) ────

async function handlePair(body: Record<string, unknown>) {
  const pairingCode = requireString(body, "pairing_code");
  const agentName = optionalString(body, "agent_name") || "agent";

  const db = serviceClient();

  // Look up pairing code
  const { data: pairing, error: lookupErr } = await db
    .from("agent_pairings")
    .select("id, agent_type, agent_name, status, expires_at")
    .eq("pairing_code", pairingCode)
    .eq("status", "pending")
    .maybeSingle();

  if (lookupErr || !pairing) {
    return err("Invalid or expired pairing code", 401);
  }

  // Check expiry
  if (new Date(pairing.expires_at).getTime() < Date.now()) {
    // Mark as expired
    await db.from("agent_pairings").update({ status: "expired" }).eq("id", pairing.id);
    return err("Invalid or expired pairing code", 401);
  }

  // Generate a permanent agent key
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  const rawKey = Array.from(keyBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Hash for DB storage
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawKey));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Use the agent name from the pairing code or the request
  const finalName = agentName !== "agent" ? agentName : (pairing.agent_name || pairing.agent_type);

  // Register the agent
  const { data: agentData, error: regError } = await db
    .from("agent_registrations")
    .insert({
      agent_name: finalName,
      agent_type: pairing.agent_type,
      agent_key_hash: hashHex,
      last_heartbeat: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (regError) return err(regError.message, 500);

  // Mark pairing code as consumed (atomically with status check)
  const { error: consumeErr } = await db
    .from("agent_pairings")
    .update({
      status: "consumed",
      consumed_at: new Date().toISOString(),
      consumed_by_agent_id: agentData.id,
      agent_registration_id: agentData.id,
    })
    .eq("id", pairing.id)
    .eq("status", "pending"); // optimistic lock

  if (consumeErr) {
    // Rollback agent registration
    await db.from("agent_registrations").delete().eq("id", agentData.id);
    return err("Failed to finalize pairing — please retry", 500);
  }

  return json({
    ok: true,
    agent_id: agentData.id,
    agent_key: rawKey,
    agent_type: pairing.agent_type,
  });
}

// ── Route: bootstrap (legacy compat — delegates to pair) ─────────────

async function handleBootstrap(body: Record<string, unknown>) {
  // Legacy Windows agents send bootstrap_token — map to pairing_code
  const token = requireString(body, "bootstrap_token");
  const agentName = optionalString(body, "agent_name") || "windows-render-agent";

  return handlePair({
    action: "pair",
    pairing_code: token,
    agent_name: agentName,
  });
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

    // Bootstrap / pair don't require x-agent-key (unauthenticated pairing routes)
    if (action === "bootstrap") {
      return await handleBootstrap(body);
    }
    if (action === "pair") {
      return await handlePair(body);
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
      case "save-checkpoint":
        return await handleSaveCheckpoint(body, agentId);
      case "get-checkpoint":
        return await handleGetCheckpoint(agentId);
      case "clear-checkpoint":
        return await handleClearCheckpoint();
      case "report-update-status":
        return await handleReportUpdateStatus(body);
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
