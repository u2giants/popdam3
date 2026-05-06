// ── Shared constants ─────────────────────────────────────────────────
const DEFAULT_BATCH_SIZE = 100;
const MAX_CLAIM_BATCH = 5;
const LEASE_DURATION_MINUTES = 5;
const MAX_RENDER_ATTEMPTS = 5;
const REQUEST_AGE_MS = 5 * 60 * 1000; // 5 minutes
const WINDOWS_OFFLINE_MS = 5 * 60 * 1000; // 5 minutes
const COUNTER_HISTORY_LIMIT = 60;
const ADAPTIVE_IDLE_SECONDS = 30;
const ADAPTIVE_ACTIVE_SECONDS = 5;
const CHECK_CHANGED_MAX_BATCH = 500;
const TIFF_CHUNK_SIZE = 200;
const HYGIENE_CHUNK_SIZE = 100;
const TIFF_REINSPECT_MIN_BATCH = 1;
const TIFF_REINSPECT_MAX_BATCH = 200;
const TIFF_REINSPECT_DEFAULT_BATCH = 50;
const LOG_TAIL_LINES = 50;
const PDF_TEXT_SAMPLE_PROGRESS_LIMIT = 25;

import { parseSku } from "../_shared/sku-parser.ts";
import { extractSkuFolder, selectPrimaryAsset } from "../_shared/style-grouping.ts";
import { isExcludedRelativePath, JUNK_FILENAMES } from "../_shared/path-filters.ts";
import { corsServe, err, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/service-client.ts";
import { optionalNumber, optionalString, requireCanonicalRelativePath, requireNumber, requireString } from "../_shared/validators.ts";
import { type DerivedMetadata, deriveMetadataFromPath, getCachedConfig } from "../_shared/metadata-derivation.ts";

// ── Agent auth via x-agent-key ──────────────────────────────────────

async function authenticateAgent(
  req: Request,
): Promise<{ agentId: string; agentName: string; agentType: string } | Response> {
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
    .select("id, agent_name, agent_type")
    .eq("agent_key_hash", hashHex)
    .maybeSingle();

  if (error) return err(`Auth lookup failed: ${error.message}`, 500);
  if (!data) return err("Invalid agent key", 401);
  return { agentId: data.id, agentName: data.agent_name, agentType: data.agent_type };
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
      { onConflict: "agent_name" },
    )
    .select("id")
    .single();

  if (error) return err(error.message, 500);
  return json({ ok: true, agent_id: data.id });
}

// ── Route: heartbeat ────────────────────────────────────────────────

// Config keys needed by ALL agent types
const HEARTBEAT_CONFIG_KEYS_COMMON = [
  "SPACES_CONFIG",
  "RESOURCE_GUARD",
  "POLLING_CONFIG",
  "AUTO_SCAN_CONFIG",
  "WINDOWS_RENDER_MODE",
  "WINDOWS_RENDER_POLICY",
  "DO_SPACES_KEY",
  "DO_SPACES_SECRET",
];

// Config keys needed only by bridge agents (Linux/Docker)
const HEARTBEAT_CONFIG_KEYS_BRIDGE = [
  ...HEARTBEAT_CONFIG_KEYS_COMMON,
  "AGENT_UPDATE_REQUEST", // bridge-only: Windows agents use trigger_update in their own metadata
  "SCAN_ROOTS",
  "NAS_CONTAINER_MOUNT_ROOT",
  "NAS_HOST_PATH",
  "PATH_TEST_REQUEST",
  "DIR_BROWSE_REQUEST",
  "SCAN_REQUEST",
  "SCAN_ALLOWED_SUBFOLDERS",
  "SCAN_MIN_DATE",
  "STYLE_GUIDE_SCAN_ROOTS",
  "STYLE_GUIDE_CRAWL_REQUEST",
  "ANTHROPIC_API_KEY",
  "GOOGLE_AI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "AI_MODELS",
  "AI_TASK_MODELS",
  "PDF_EXTRACTION_CONFIG",
  "PDF_TEXT_SAMPLE_REQUEST",
];

// Config keys needed only by Windows render agents
const HEARTBEAT_CONFIG_KEYS_WINDOWS = [
  ...HEARTBEAT_CONFIG_KEYS_COMMON,
  "WINDOWS_AGENT_NAS_HOST",
  "WINDOWS_AGENT_NAS_SHARE",
  "WINDOWS_AGENT_NAS_USER",
  "WINDOWS_AGENT_NAS_PASS",
  "WINDOWS_AGENT_NAS_MOUNT_PATH",
  "WINDOWS_AGENT_SG_NAS_HOST",
  "WINDOWS_AGENT_SG_NAS_SHARE",
  "WINDOWS_AGENT_SG_NAS_MOUNT_PATH",
  "WINDOWS_AGENT_SG_NAS_USER",
  "WINDOWS_AGENT_SG_NAS_PASS",
  "WINDOWS_AGENT_RENDER_CONCURRENCY",
  "WINDOWS_REPAIR_CODE",
  "PDF_TEXT_SAMPLE_REQUEST",
  "OPENROUTER_API_KEY",
  "AI_TASK_MODELS",
  "AI_MODELS",
  "COMPAT_AUDIT_REQUEST", // windows-only: OCR runs on Windows agent to avoid NAS CPU load
  "COMPAT_AUDIT_PREVIEW_REQUEST",
];

function getConfigKeysForAgent(agentType: string): string[] {
  if (agentType === "windows-render") return HEARTBEAT_CONFIG_KEYS_WINDOWS;
  return HEARTBEAT_CONFIG_KEYS_BRIDGE; // bridge and unknown types
}

async function handleHeartbeat(
  body: Record<string, unknown>,
  agentId: string,
  agentType: string,
  agentName: string,
) {
  const counters = body.counters as Record<string, unknown> | undefined;
  const lastError = optionalString(body, "last_error");
  const health = body.health as Record<string, unknown> | undefined;
  const versionInfo = body.version_info as Record<string, unknown> | undefined;
  const diagnostics = body.diagnostics as Record<string, unknown> | undefined;
  const logTail = Array.isArray(body.log_tail) ? (body.log_tail as string[]).slice(-LOG_TAIL_LINES) : undefined;
  const db = serviceClient();

  // ── Fetch agent metadata (needed for update) ──
  const { data: agent } = await db
    .from("agent_registrations")
    .select("metadata")
    .eq("id", agentId)
    .single();

  const metadata = (agent?.metadata as Record<string, unknown>) || {};

  // Append to counter history (keep last 60)
  const history = Array.isArray(metadata.counter_history) ? (metadata.counter_history as unknown[]) : [];
  history.push({ ts: new Date().toISOString(), ...counters });
  if (history.length > COUNTER_HISTORY_LIMIT) history.splice(0, history.length - COUNTER_HISTORY_LIMIT);

  const newMetadata = {
    ...metadata,
    last_counters: counters || {},
    last_error: lastError,
    last_error_at: lastError ? new Date().toISOString() : (lastError === null ? null : metadata.last_error_at),
    counter_history: history,
    // Version info — works for both bridge and windows agents
    version_info: versionInfo
      ? {
        image_tag: versionInfo.image_tag ?? null,
        version: versionInfo.version ?? null,
        build_sha: versionInfo.build_sha ?? null,
        update_available: versionInfo.update_available ?? null,
        latest_version: versionInfo.latest_version ?? null,
        last_update_check: versionInfo.last_update_check ?? null,
        updating: versionInfo.updating ?? false,
        update_error: versionInfo.update_error ?? null,
        last_reported_at: new Date().toISOString(),
      }
      : metadata.version_info,
    // Structured health payload from Windows agent preflight
    health: health
      ? {
        healthy: health.healthy ?? false,
        nas_healthy: health.nasHealthy ?? false,
        last_preflight_error: health.lastPreflightError ?? null,
        last_preflight_at: health.lastPreflightAt ?? null,
      }
      : metadata.health,
    // Diagnostics from bridge agent (mount root, scan roots, etc.)
    diagnostics: diagnostics
      ? {
        ...diagnostics,
        last_reported_at: new Date().toISOString(),
      }
      : metadata.diagnostics,
    // Recent log lines from Windows agent — stored for remote viewing
    log_tail: logTail ?? metadata.log_tail,
    // Clear trigger_update flag once delivered (below)
  };

  // ── Update agent metadata ──
  const { error: updateErr } = await db
    .from("agent_registrations")
    .update({
      last_heartbeat: new Date().toISOString(),
      metadata: newMetadata,
    })
    .eq("id", agentId);

  if (updateErr) return err(updateErr.message, 500);

  // ── PARALLELIZED: Fetch config, cleanup tokens, get windows agents, and render queue count ──
  const now = new Date();

  const [configResult, _tokenCleanup, _queuePrune, windowsAgentsResult, renderQueueResult] = await Promise.all([
    // 1. Fetch cloud config — only keys relevant to this agent type
    db.from("admin_config")
      .select("key, value")
      .in("key", getConfigKeysForAgent(agentType)),

    // 2. Cleanup expired/used bootstrap tokens (fire-and-forget style, errors non-fatal)
    (async () => {
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
        console.error("Bootstrap token cleanup failed:", cleanupErr);
      }
    })(),

    // 2b. Prune completed/failed render_queue rows older than 3 days to keep the table lean
    (async () => {
      try {
        await db.from("render_queue")
          .delete()
          .in("status", ["completed", "failed"])
          .lt("created_at", new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString());
      } catch (pruneErr) {
        console.error("render_queue prune failed:", pruneErr);
      }
    })(),

    // 3. Windows agent health check
    db.from("agent_registrations")
      .select("agent_type, last_heartbeat, metadata")
      .eq("agent_type", "windows-render"),

    // 4. Pending render jobs count
    db.from("render_queue")
      .select("*", { count: "exact", head: true })
      .in("status", ["pending", "claimed", "processing"]),
  ]);

  // Process config rows
  const configMap: Record<string, unknown> = {};
  for (const row of configResult.data || []) {
    configMap[row.key] = row.value;
  }

  // Spaces
  const spacesConfig = (configMap.SPACES_CONFIG as Record<string, string>) || {};

  // Scanning
  const scanRoots = (configMap.SCAN_ROOTS as string[]) || [];
  const pollingConfig = (configMap.POLLING_CONFIG as Record<string, number>) || {};

  // Resource Guard
  const guard = (configMap.RESOURCE_GUARD as Record<string, unknown>) || {};
  const schedules = guard.schedules as Array<Record<string, unknown>> | undefined;

  let resourceDirectives: Record<string, unknown> = {
    cpu_percentage_limit: guard.default_cpu_shares ?? 50,
    memory_limit_mb: guard.default_memory_limit_mb ?? 512,
    concurrency: guard.default_thumb_concurrency ?? 2,
  };

  if (schedules && schedules.length > 0) {
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
          cpu_percentage_limit: sched.cpu_shares ?? resourceDirectives.cpu_percentage_limit,
          memory_limit_mb: sched.memory_limit_mb ?? resourceDirectives.memory_limit_mb,
          concurrency: sched.thumb_concurrency ?? resourceDirectives.concurrency,
        };
        break;
      }
    }
  }

  // ── Commands (abort/stop from agent metadata) ──
  const scanAbort = metadata.scan_abort === true;
  const forceStop = metadata.force_stop === true;

  // ── Durable scan request from admin_config ──
  const scanRequest = configMap.SCAN_REQUEST as Record<string, unknown> | undefined;
  let forceScan = false;
  let scanSessionId: string | null = null;

  const isPending = scanRequest?.status === "pending";
  // Also re-trigger if the request was claimed by THIS agent but the scan never started
  // (e.g. agent restarted after claiming — common after a container rebuild).
  const isOrphanedClaim = scanRequest?.status === "claimed" && scanRequest?.claimed_by === agentId;

  if (
    scanRequest &&
    (isPending || isOrphanedClaim) &&
    (!scanRequest.target_agent_id ||
      scanRequest.target_agent_id === agentId) &&
    !forceStop &&
    agentType === "bridge"
  ) {
    if (isPending) {
      // Claim the pending request
      const claimedValue = {
        ...scanRequest,
        status: "claimed",
        claimed_by: agentId,
        claimed_at: new Date().toISOString(),
      };
      await db
        .from("admin_config")
        .update({
          value: claimedValue,
          updated_at: new Date().toISOString(),
        })
        .eq("key", "SCAN_REQUEST");
    }
    // For orphaned claims: leave status as "claimed" — just re-deliver force_scan command

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

  // ── Path test request ──
  const pathTestRequest = configMap.PATH_TEST_REQUEST as Record<string, unknown> | undefined;

  let testPaths: {
    request_id: string;
    container_mount_root: string;
    scan_roots: string[];
  } | null = null;

  if (pathTestRequest && pathTestRequest.status === "pending") {
    testPaths = {
      request_id: pathTestRequest.request_id as string,
      container_mount_root: (configMap.NAS_CONTAINER_MOUNT_ROOT as string) || "",
      scan_roots: scanRoots,
    };
  }

  // ── Dir browse request ──
  const dirBrowseRequest = configMap.DIR_BROWSE_REQUEST as Record<string, unknown> | undefined;
  let browseDir: { request_id: string; path: string } | null = null;
  if (dirBrowseRequest && dirBrowseRequest.status === "pending") {
    browseDir = {
      request_id: dirBrowseRequest.request_id as string,
      path: (dirBrowseRequest.path as string) || "",
    };
  }

  // ── Auto-scan config ──
  const autoScanConfig = (configMap.AUTO_SCAN_CONFIG as {
    enabled: boolean;
    interval_hours: number;
  }) || { enabled: false, interval_hours: 6 };

  // ── Update command from admin ──
  const updateRequest = configMap.AGENT_UPDATE_REQUEST as Record<string, unknown> | undefined;
  let checkUpdate = false;
  let applyUpdate = false;

  if (agentType === "bridge" && updateRequest && updateRequest.requested_at) {
    const requestAge = Date.now() - new Date(updateRequest.requested_at as string).getTime();
    if (requestAge < REQUEST_AGE_MS) {
      checkUpdate = updateRequest.action === "check";
      applyUpdate = updateRequest.action === "apply";

      // Clear the request after delivering
      await db.from("admin_config").delete().eq("key", "AGENT_UPDATE_REQUEST");
    }
  }

  // ── Windows agent health + pending render jobs ──
  const windowsAgents = windowsAgentsResult.data || [];
  let windowsHealthy = false;
  if (windowsAgents.length > 0) {
    windowsHealthy = windowsAgents.some((wa: Record<string, unknown>) => {
      const lastHb = wa.last_heartbeat ? new Date(wa.last_heartbeat as string).getTime() : 0;
      if (lastHb === 0 || now.getTime() - lastHb > WINDOWS_OFFLINE_MS) return false;
      const wMeta = (wa.metadata as Record<string, unknown>) || {};
      const wHealth = wMeta.health as Record<string, unknown> | undefined;
      return wHealth?.healthy === true;
    });
  }

  const pendingRenderJobs = renderQueueResult.count ?? 0;

  // ── PDF text sample claim/dispatch ──
  let pdfTextSampleCommand: Record<string, unknown> = {};
  const sampleReq = configMap.PDF_TEXT_SAMPLE_REQUEST as Record<string, unknown> | undefined;
  if (sampleReq && sampleReq.status === "pending") {
    const policy = (configMap.WINDOWS_RENDER_POLICY as Record<string, unknown> | null) || null;
    const policyMode = (policy?.mode as string) || "primary";
    const requireWindowsHealthy = policy?.require_windows_healthy === true;

    let targetAgentType: string;
    if (policyMode === "fallback_only") {
      targetAgentType = "bridge";
    } else if (requireWindowsHealthy && !windowsHealthy) {
      targetAgentType = "bridge";
    } else {
      targetAgentType = "windows-render";
    }

    if (agentType === targetAgentType) {
      const nowIso = new Date().toISOString();
      const assets = Array.isArray(sampleReq.assets) ? (sampleReq.assets as unknown[]) : [];
      const claimedSampleReq: Record<string, unknown> = {
        ...sampleReq,
        status: "processing",
        claimed_by_agent_id: agentId,
        claimed_by_agent_name: agentName,
        claimed_at: nowIso,
        progress: {
          processed: 0,
          total: assets.length,
          current_file: null,
          current_step: "starting",
          file_results: [],
          updated_at: nowIso,
        },
      };

      await db.from("admin_config").upsert({
        key: "PDF_TEXT_SAMPLE_REQUEST",
        value: claimedSampleReq,
        updated_at: nowIso,
      });

      pdfTextSampleCommand = {
        trigger_pdf_text_sample: true,
        pdf_text_sample_assets: assets,
      };
    }
  }

  // ── Compat audit claim/dispatch ──
  // Only dispatched to Windows render agents — OCR via Tesseract would spike CPU on Synology NAS.
  let compatAuditCommand: Record<string, unknown> = {};
  if (agentType === "windows-render") {
    const auditReq = configMap.COMPAT_AUDIT_REQUEST as Record<string, unknown> | undefined;
    if (auditReq && auditReq.status === "pending") {
      const nowIso = new Date().toISOString();
      const claimedReq: Record<string, unknown> = {
        ...auditReq,
        status: "processing",
        claimed_by_agent_id: agentId,
        claimed_at: nowIso,
      };
      await db.from("admin_config").upsert({
        key: "COMPAT_AUDIT_REQUEST",
        value: claimedReq,
        updated_at: nowIso,
      });
      compatAuditCommand = { audit_compat_thumbnails: true };
    } else {
      // Preview scan (all batches, no clearing — reports which would be flagged so user can confirm)
      const previewReq = configMap.COMPAT_AUDIT_PREVIEW_REQUEST as Record<string, unknown> | undefined;
      const previewStale = previewReq?.status === "processing" && previewReq?.claimed_at &&
        (Date.now() - new Date(previewReq.claimed_at as string).getTime()) > 5 * 60 * 1000;
      if (previewReq && (previewReq.status === "pending" || previewStale)) {
        const nowIso = new Date().toISOString();
        await db.from("admin_config").upsert({
          key: "COMPAT_AUDIT_PREVIEW_REQUEST",
          value: { ...previewReq, status: "processing", claimed_by_agent_id: agentId, claimed_at: nowIso },
          updated_at: nowIso,
        });
        compatAuditCommand = { audit_compat_preview: true };
      }
    }
  }

  // ── Build response ──
  const responsePayload = {
    ok: true,
    config: {
      do_spaces: {
        key: (configMap.DO_SPACES_KEY as string) || "",
        secret: (configMap.DO_SPACES_SECRET as string) || "",
        bucket: spacesConfig.bucket_name || spacesConfig.bucket || "popdam",
        region: spacesConfig.region || "nyc3",
        endpoint: spacesConfig.endpoint || "https://nyc3.digitaloceanspaces.com",
        public_base_url: spacesConfig.public_base_url ||
          "https://popdam.nyc3.digitaloceanspaces.com",
      },
      scanning: {
        container_mount_root: (configMap.NAS_CONTAINER_MOUNT_ROOT as string) || "",
        roots: scanRoots,
        batch_size: (guard.batch_size as number) || pollingConfig.batch_size || DEFAULT_BATCH_SIZE,
        scan_min_date: (configMap.SCAN_MIN_DATE as string) || null,
        allowed_subfolders: (configMap.SCAN_ALLOWED_SUBFOLDERS as string[]) || [],
        adaptive_polling: {
          idle_seconds: pollingConfig.idle_seconds ?? ADAPTIVE_IDLE_SECONDS,
          active_seconds: pollingConfig.active_seconds ?? ADAPTIVE_ACTIVE_SECONDS,
        },
      },
      resource_guard: resourceDirectives,
      auto_scan: autoScanConfig,
      windows_render_mode: (configMap.WINDOWS_RENDER_MODE as string) || "fallback_only",
      windows_render_policy: (configMap.WINDOWS_RENDER_POLICY as Record<string, unknown>) || null,
      windows_healthy: windowsHealthy,
      pending_render_jobs: pendingRenderJobs ?? 0,
      windows_agent: {
        nas_host: (configMap.WINDOWS_AGENT_NAS_HOST as string) || "",
        nas_share: (configMap.WINDOWS_AGENT_NAS_SHARE as string) || "",
        nas_username: (configMap.WINDOWS_AGENT_NAS_USER as string) || "",
        nas_password: (configMap.WINDOWS_AGENT_NAS_PASS as string) || "",
        nas_mount_path: (configMap.WINDOWS_AGENT_NAS_MOUNT_PATH as string) || "",
        sg_nas_host: (configMap.WINDOWS_AGENT_SG_NAS_HOST as string) || "",
        sg_nas_share: (configMap.WINDOWS_AGENT_SG_NAS_SHARE as string) || "",
        sg_nas_mount_path: (configMap.WINDOWS_AGENT_SG_NAS_MOUNT_PATH as string) || "",
        sg_nas_username: (configMap.WINDOWS_AGENT_SG_NAS_USER as string) || "",
        sg_nas_password: (configMap.WINDOWS_AGENT_SG_NAS_PASS as string) || "",
        render_concurrency: parseInt((configMap.WINDOWS_AGENT_RENDER_CONCURRENCY as string) || "0") || 0,
      },
      style_guide_scanning: {
        roots: (configMap.STYLE_GUIDE_SCAN_ROOTS as string[]) || [],
      },
      helper_root_mappings: ((configMap.SCAN_ROOTS as string[]) || []).map((r: string) => {
        const name = r.replace(/\/+$/, "").split("/").pop() || r;
        return { root_id: name, display_name: name, server_path: r };
      }),
      ai: {
        anthropic_api_key: (configMap.ANTHROPIC_API_KEY as string) || "",
        google_ai_api_key: (configMap.GOOGLE_AI_API_KEY as string) || "",
        openai_api_key: (configMap.OPENAI_API_KEY as string) || "",
        openrouter_api_key: (configMap.OPENROUTER_API_KEY as string) || "",
        models: (configMap.AI_MODELS as unknown[]) || [],
        ai_task_models: (configMap.AI_TASK_MODELS as Record<string, string>) || {},
        pdf_extraction: (configMap.PDF_EXTRACTION_CONFIG as Record<string, unknown>) || null,
      },
    },
    commands: {
      force_scan: forceScan,
      scan_session_id: scanSessionId,
      abort_scan: scanAbort || forceStop,
      test_paths: testPaths,
      browse_dir: browseDir,
      check_update: checkUpdate,
      apply_update: applyUpdate,
      trigger_update: (newMetadata as Record<string, unknown>).trigger_update === true,
      force_restart: (newMetadata as Record<string, unknown>).force_restart === true,
      force_apply_update: (newMetadata as Record<string, unknown>).force_apply_update === true,
      force_stop_jobs: (newMetadata as Record<string, unknown>).force_stop_jobs === true,
      repair_pairing_code: (configMap.WINDOWS_REPAIR_CODE as string) || null,
      trigger_style_guide_crawl: (() => {
        // Deliver crawl command if a pending request exists and agent is a bridge
        if (agentType !== "bridge") return false;
        const crawlReq = configMap.STYLE_GUIDE_CRAWL_REQUEST as Record<string, unknown> | undefined;
        if (!crawlReq) return false;
        return crawlReq.status === "pending" || (crawlReq.status === "claimed" && crawlReq.claimed_by === agentId);
      })(),
      ...pdfTextSampleCommand,
      ...compatAuditCommand,
    },
  };

  // Clear one-shot command flags BEFORE returning (so they only fire once)
  const meta = newMetadata as Record<string, unknown>;
  const needsClear = meta.trigger_update === true || meta.force_restart === true ||
    meta.force_apply_update === true || meta.force_stop_jobs === true;

  if (needsClear || configMap.WINDOWS_REPAIR_CODE) {
    const cleanMeta: Record<string, unknown> = {
      ...meta,
      trigger_update: false,
      force_restart: false,
      force_apply_update: false,
      force_stop_jobs: false,
    };
    delete cleanMeta.update_requested_by;
    delete cleanMeta.update_requested_at;

    await db.from("agent_registrations").update({ metadata: cleanMeta }).eq("id", agentId);

    // Clear WINDOWS_REPAIR_CODE from admin_config after delivery
    if (configMap.WINDOWS_REPAIR_CODE) {
      await db.from("admin_config").delete().eq("key", "WINDOWS_REPAIR_CODE");
    }
  }

  return json(responsePayload);
}

// ── Style group assignment helper ────────────────────────────────────

async function assignToStyleGroup(
  relativePath: string,
  assetId: string,
  skuFields: Record<string, unknown>,
  derived: Pick<DerivedMetadata, "is_licensed" | "licensor_name" | "property_name" | "licensor_id" | "property_id">,
  db: ReturnType<typeof serviceClient>,
): Promise<void> {
  try {
    const sku = extractSkuFolder(relativePath);
    if (!sku) return;

    // Derive folder_path as the path up to and including the SKU folder
    const parts = relativePath.split("/");
    const skuIdx = parts.lastIndexOf(sku);
    const folderPath = skuIdx >= 0 ? parts.slice(0, skuIdx + 1).join("/") : parts.slice(0, -1).join("/");

    // Keep style_groups licensing aligned with path-authoritative rule
    const groupFields: Record<string, unknown> = {
      sku,
      folder_path: folderPath,
      is_licensed: derived.is_licensed,
      licensor_id: skuFields.licensor_id ?? derived.licensor_id ?? null,
      licensor_code: skuFields.licensor_code ?? null,
      licensor_name: skuFields.licensor_name ?? derived.licensor_name ?? null,
      property_id: skuFields.property_id ?? derived.property_id ?? null,
      property_code: skuFields.property_code ?? null,
      property_name: skuFields.property_name ?? derived.property_name ?? null,
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

    const { data: group } = await db
      .from("style_groups")
      .upsert(groupFields, { onConflict: "sku", ignoreDuplicates: false })
      .select("id")
      .single();

    if (!group) return;

    // Assign group ID to the asset
    await db.from("assets").update({ style_group_id: group.id }).eq("id", assetId);

    // Incrementally update asset_count for this group
    const { count: memberCount } = await db
      .from("assets")
      .select("*", { count: "exact", head: true })
      .eq("style_group_id", group.id)
      .eq("is_deleted", false);

    if (memberCount !== null) {
      await db
        .from("style_groups")
        .update({ asset_count: memberCount })
        .eq("id", group.id);
    }
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
          error: "Ingestion blocked: scan is stopped. " +
            "Clear force_stop in admin to resume.",
        },
        403,
      );
    }
  }

  const relativePath = requireCanonicalRelativePath(body, "relative_path");

  // Reject paths that match the centralized exclusion filter
  if (isExcludedRelativePath(relativePath)) {
    return json({ ok: true, skipped: true, reason: "excluded_path", id: null });
  }
  const filename = requireString(body, "filename");

  // ── Junk-file guard: skip system/temp files before any DB work ──
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
  const subfolderValue = await getCachedConfig<string[]>(db0, "SCAN_ALLOWED_SUBFOLDERS");
  const allowedSubfolders = Array.isArray(subfolderValue) ? subfolderValue : [];
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
  const hasOldFolder = ingestParts.some((p) => p.toLowerCase() === "___old");
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

  const pdfPage2Url = optionalString(body, "pdf_page2_url");

  if (!["psd", "ai", "pdf"].includes(fileType)) {
    return err("file_type must be 'psd', 'ai', or 'pdf'");
  }

  const db = serviceClient();
  const derived = await deriveMetadataFromPath(relativePath, db);

  // SKU parsing from filename
  const parsed = await parseSku(filename);
  const skuFields: Record<string, unknown> = parsed
    ? {
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
      property_code: parsed.property_code,
      sku_sequence: parsed.sku_sequence,
      product_category: parsed.product_category,
      division_code: parsed.division_code,
      division_name: parsed.division_name,
      // NOTE: is_licensed is intentionally EXCLUDED here.
      // Path-derived is_licensed (from folder structure) is the authoritative source.
    }
    : {};

  // Licensor/property names: prefer ColdLion (SKU parser), fall back to path-derived
  if (parsed?.licensor_name) {
    skuFields.licensor_name = parsed.licensor_name;
  }
  if (parsed?.property_name) {
    skuFields.property_name = parsed.property_name;
  }

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
    // Path-derived names fill in when ColdLion didn't resolve
    if (!moveUpdates.licensor_name && reDerived.licensor_name) moveUpdates.licensor_name = reDerived.licensor_name;
    if (!moveUpdates.property_name && reDerived.property_name) moveUpdates.property_name = reDerived.property_name;
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

    assignToStyleGroup(relativePath, existingByHash.id, skuFields, reDerived, db).catch((e) =>
      console.error(`assignToStyleGroup failed for moved asset ${existingByHash.id}:`, e)
    );

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

    const updateFields: Record<string, unknown> = {
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
      workflow_status: derived.workflow_status,
      is_licensed: derived.is_licensed,
      ...(pdfPage2Url ? { pdf_page2_url: pdfPage2Url } : {}),
      ...thumbnailFields,
      ...skuFields,
    };
    // Path-derived names fill in when ColdLion didn't resolve
    if (!updateFields.licensor_name && derived.licensor_name) updateFields.licensor_name = derived.licensor_name;
    if (!updateFields.property_name && derived.property_name) updateFields.property_name = derived.property_name;
    if (derived.licensor_id) updateFields.licensor_id = derived.licensor_id;
    if (derived.property_id) updateFields.property_id = derived.property_id;

    const { error: updateError } = await db
      .from("assets")
      .update(updateFields)
      .eq("id", existingByPath.id);

    if (updateError) return err(updateError.message, 500);

    // processing_queue inserts removed — AI tagging is now handled by the Railway worker

    assignToStyleGroup(relativePath, existingByPath.id, skuFields, derived, db).catch((e) =>
      console.error(`assignToStyleGroup failed for updated asset ${existingByPath.id}:`, e)
    );

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
    ...(pdfPage2Url ? { pdf_page2_url: pdfPage2Url } : {}),
    ...skuFields,
  };
  // Path-derived names fill in when ColdLion didn't resolve
  if (!newAssetRow.licensor_name && derived.licensor_name) newAssetRow.licensor_name = derived.licensor_name;
  if (!newAssetRow.property_name && derived.property_name) newAssetRow.property_name = derived.property_name;
  if (derived.licensor_id) newAssetRow.licensor_id = derived.licensor_id;
  if (derived.property_id) newAssetRow.property_id = derived.property_id;

  const { data: newAsset, error: insertError } = await db
    .from("assets")
    .insert(newAssetRow)
    .select("id")
    .single();

  if (insertError) return err(insertError.message, 500);

  // processing_queue inserts removed — thumbnails are handled by render_queue trigger,
  // AI tagging by the Railway worker

  assignToStyleGroup(relativePath, newAsset.id, skuFields, derived, db).catch((e) =>
    console.error(`assignToStyleGroup failed for new asset ${newAsset.id}:`, e)
  );

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
  "pdf_page2_url",
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
  const skippedDirs = Array.isArray(body.skipped_dirs) ? body.skipped_dirs as string[] : undefined;

  const db = serviceClient();

  // Store progress in admin_config for UI consumption
  const db2 = serviceClient();

  // ── Guard: never regress a terminal status back to "running" ──
  // Fire-and-forget "running" updates from the agent can arrive after
  // the final "completed/failed" call due to HTTP pipelining races.
  const TERMINAL_STATUSES = new Set(["completed", "completed_with_errors", "failed"]);
  if (status === "running") {
    try {
      const { data: existing } = await db2.from("admin_config").select("value").eq("key", "SCAN_PROGRESS").maybeSingle();
      if (existing && existing.value) {
        const prev = existing.value as Record<string, unknown>;
        if (prev.session_id === sessionId && TERMINAL_STATUSES.has(prev.status as string)) {
          // Already in terminal state for this session — discard stale "running" update
          return json({ ok: true, skipped: "terminal_status_already_set" });
        }
      }
    } catch (_e) {
      // Continue — better to risk overwrite than fail the call
    }
  }

  const progressValue: Record<string, unknown> = {
    session_id: sessionId,
    status,
    counters: counters || {},
    current_path: currentPath,
    updated_at: new Date().toISOString(),
  };
  // Include skipped_dirs if present in this update
  if (skippedDirs && skippedDirs.length > 0) {
    progressValue.skipped_dirs = skippedDirs;
  } else {
    // Preserve existing skipped_dirs from previous progress update
    try {
      const { data: existing } = await db.from("admin_config").select("value").eq("key", "SCAN_PROGRESS").maybeSingle();
      if (existing && existing.value) {
        const prev = existing.value as Record<string, unknown>;
        if (prev.session_id === sessionId && Array.isArray(prev.skipped_dirs)) {
          progressValue.skipped_dirs = prev.skipped_dirs;
        }
      }
    } catch (_e) {
      // Silently continue — losing skipped_dirs is acceptable vs failing the whole call
    }
  }

  const { error } = await db.from("admin_config").upsert({
    key: "SCAN_PROGRESS",
    value: progressValue,
    updated_at: new Date().toISOString(),
  });

  if (error) return err(error.message, 500);

  // When scan completes or fails, also update SCAN_REQUEST if session matches
  if (status === "completed" || status === "completed_with_errors" || status === "failed") {
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

  // Guard: reject files whose path matches the centralized exclusion filter
  const { data: asset } = await db
    .from("assets")
    .select("filename, relative_path, thumbnail_url")
    .eq("id", assetId)
    .single();

  if (asset) {
    // Check full relative_path against centralized filter
    if (isExcludedRelativePath(asset.relative_path)) {
      return json({ ok: true, job_id: null, skipped: true, reason: "excluded path" });
    }
    // Also catch junk filenames (resource forks, temp files)
    const f = asset.filename;
    if (f.startsWith("._") || f.startsWith("~")) {
      return json({ ok: true, job_id: null, skipped: true, reason: "junk file" });
    }
    // Skip re-queuing if asset already has a working thumbnail.
    // The Synology NAS periodically touches file mtimes (indexer/media service),
    // which causes check-changed to flag unchanged files as "changed", the bridge
    // re-defers them, and queueRender is called even though the prior completed
    // job already produced a valid thumbnail. This guard stops that loop.
    if (asset.thumbnail_url) {
      return json({ ok: true, job_id: null, skipped: true, reason: "already_has_thumbnail" });
    }
  }

  // Idempotent: check for existing pending/claimed/processing job for this asset
  const { data: existing } = await db
    .from("render_queue")
    .select("id, status")
    .eq("asset_id", assetId)
    .in("status", ["pending", "claimed", "processing"])
    .maybeSingle();

  if (existing) {
    return json({ ok: true, job_id: existing.id, already_queued: true });
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
  const batchSize = Math.min((body.batch_size as number) || 1, MAX_CLAIM_BATCH);
  const db = serviceClient();

  // Use raw SQL via rpc for FOR UPDATE SKIP LOCKED — not available in PostgREST
  // Select pending jobs OR expired-lease claimed jobs, atomically claim them
  const { data: claimedJobs, error: claimErr } = await db.rpc("claim_render_jobs", {
    p_agent_id: agentId,
    p_batch_size: batchSize,
    p_lease_minutes: LEASE_DURATION_MINUTES,
    p_max_attempts: MAX_RENDER_ATTEMPTS,
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
    .select("asset_id, attempts")
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
        .select("id, filename, file_type, asset_type, created_at, thumbnail_url, thumbnail_error")
        .eq("style_group_id", asset.style_group_id)
        .eq("is_deleted", false);

      if (groupAssets && groupAssets.length > 0) {
        const primaryId = selectPrimaryAsset(groupAssets);
        if (primaryId) {
          const primaryAsset = groupAssets.find((ga: typeof groupAssets[number]) => ga.id === primaryId);
          await db
            .from("style_groups")
            .update({
              primary_asset_id: primaryId,
              primary_asset_type: primaryAsset?.asset_type ?? null,
            })
            .eq("id", asset.style_group_id);
        }
      }
    }
  } else if (!success && job.attempts >= MAX_RENDER_ATTEMPTS) {
    // Exhausted all attempts — mark asset with permanent thumbnail failure
    await db
      .from("assets")
      .update({ thumbnail_error: "no_preview_or_render_failed" })
      .eq("id", job.asset_id);
  }

  return json({ ok: true });
}

// ── Route: trigger-scan ─────────────────────────────────────────────

async function handleTriggerScan(_body: Record<string, unknown>) {
  const db = serviceClient();
  const requestId = crypto.randomUUID();

  // Clear abort flags on all agents
  const { data: agents } = await db.from("agent_registrations").select("id, metadata");
  for (const a of agents || []) {
    const meta = (a.metadata as Record<string, unknown>) || {};
    if (meta.force_stop === true || meta.scan_abort === true) {
      await db.from("agent_registrations")
        .update({ metadata: { ...meta, scan_abort: false, force_stop: false } })
        .eq("id", a.id);
    }
  }

  const { error } = await db.from("admin_config").upsert({
    key: "SCAN_REQUEST",
    value: {
      request_id: requestId,
      status: "pending",
      requested_at: new Date().toISOString(),
      requested_by: "agent-api",
      target_agent_id: null,
    },
    updated_at: new Date().toISOString(),
    updated_by: "agent-api",
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, request_id: requestId });
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

// ── Route: report-dir-browse ─────────────────────────────────────────

async function handleReportDirBrowse(body: Record<string, unknown>) {
  const requestId = requireString(body, "request_id");
  const path = optionalString(body, "path") ?? "";
  const entries = body.entries;
  if (!Array.isArray(entries)) return err("Missing 'entries' array");

  const db = serviceClient();

  await db.from("admin_config").upsert(
    {
      key: "DIR_BROWSE_RESULT",
      value: {
        request_id: requestId,
        path,
        entries,
        listed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  await db
    .from("admin_config")
    .update({
      value: { request_id: requestId, path, status: "completed" },
      updated_at: new Date().toISOString(),
    })
    .eq("key", "DIR_BROWSE_REQUEST");

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
  // Files that are unchanged and require Windows render retry
  const needsRender: string[] = [];
  const PERMANENT_THUMB_ERRORS = ["no_preview_or_render_failed"];

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
    } else if (
      !existing.thumbnail_url &&
      existing.thumbnail_error === "no_pdf_compat"
    ) {
      needsRender.push(rp);
    }
  }

  if (needsRender.length > 0) {
    const { data: renderAssets } = await db
      .from("assets")
      .select("id")
      .in("relative_path", needsRender)
      .eq("is_deleted", false);

    for (const asset of renderAssets ?? []) {
      const { data: existing } = await db
        .from("render_queue")
        .select("id")
        .eq("asset_id", asset.id)
        .in("status", ["pending", "claimed"])
        .maybeSingle();

      if (!existing) {
        await db.from("render_queue").insert({ asset_id: asset.id, status: "pending" });
      }
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

// ── Route: get-latest-build (for self-update) ───────────────────────

async function handleGetLatestBuild(
  body: Record<string, unknown>,
  _agentId: string,
) {
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

// ── Route: bootstrap (Windows agents use pairing_code instead) ─────────

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

// ── Route: claim-tiff-scan ──────────────────────────────────────────

async function handleClaimTiffScan(_body: Record<string, unknown>, agentId: string) {
  const db = serviceClient();

  const { data: row, error } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "TIFF_SCAN_REQUEST")
    .maybeSingle();

  if (error) return err(error.message, 500);

  const req = (row?.value as Record<string, unknown> | undefined) ?? undefined;
  if (!req || req.status !== "pending") {
    return json({ ok: true, request: null });
  }

  if (req.target_agent_id && req.target_agent_id !== agentId) {
    return json({ ok: true, request: null });
  }

  const claimed = {
    ...req,
    status: "claimed",
    claimed_by: agentId,
    claimed_at: new Date().toISOString(),
  };

  const { error: claimErr } = await db.from("admin_config").upsert(
    {
      key: "TIFF_SCAN_REQUEST",
      value: claimed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  if (claimErr) return err(claimErr.message, 500);

  return json({ ok: true, request: claimed });
}

// ── Route: report-tiff-scan ─────────────────────────────────────────

async function handleReportTiffScan(body: Record<string, unknown>) {
  const files = body.files as Array<Record<string, unknown>>;
  const sessionId = optionalString(body, "session_id");
  const done = body.done === true;
  const scanError = optionalString(body, "error");
  const scanStatus = optionalString(body, "status");

  // Accept progress counters from agent
  const progressCounters = body.progress as Record<string, unknown> | undefined;

  if (!Array.isArray(files)) return err("files must be an array");

  const db = serviceClient();

  // If agent is just reporting status (claimed / error), update config
  if (scanStatus === "claimed" && sessionId) {
    await db.from("admin_config").upsert({
      key: "TIFF_SCAN_REQUEST",
      value: {
        status: "claimed",
        request_id: sessionId,
        claimed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    });
    return json({ ok: true, status: "claimed" });
  }

  // Upsert files in batches
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < files.length; i += CHUNK) {
    const chunk = files.slice(i, i + CHUNK);
    const rows = chunk
      .filter((f) => !isExcludedRelativePath(f.relative_path as string))
      .map((f) => ({
        relative_path: f.relative_path as string,
        filename: f.filename as string,
        file_size: f.file_size as number,
        file_modified_at: f.file_modified_at as string,
        file_created_at: (f.file_created_at as string) || null,
        compression_type: (f.compression_type as string) || "unknown",
        status: "scanned",
        scan_session_id: sessionId,
      }));

    const { error } = await db.from("tiff_optimization_queue")
      .upsert(rows, { onConflict: "relative_path", ignoreDuplicates: false });
    if (error) {
      console.error("report-tiff-scan upsert error:", error);
    } else {
      inserted += rows.length;
    }
  }

  // Update progress on every batch (not just when done)
  if (sessionId && !done) {
    const progressUpdate: Record<string, unknown> = {
      status: "claimed",
      request_id: sessionId,
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      files_reported_so_far: inserted,
    };
    if (progressCounters) {
      progressUpdate.progress = progressCounters;
    }
    try {
      await db.from("admin_config").upsert({
        key: "TIFF_SCAN_REQUEST",
        value: progressUpdate,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    } catch { /* best-effort */ }
  }

  // If done, mark scan request as completed (or failed)
  if (done && sessionId) {
    const finalValue: Record<string, unknown> = {
      status: scanError ? "error" : "completed",
      request_id: sessionId,
      completed_at: new Date().toISOString(),
      total_files: inserted,
    };
    if (scanError) finalValue.error = scanError;
    if (progressCounters) finalValue.progress = progressCounters;
    await db.from("admin_config").upsert({
      key: "TIFF_SCAN_REQUEST",
      value: finalValue,
      updated_at: new Date().toISOString(),
    });
  }

  return json({ ok: true, inserted });
}

// ── Route: claim-tiff-job ───────────────────────────────────────────

async function handleClaimTiffJob(body: Record<string, unknown>, agentId: string) {
  const db = serviceClient();
  const batchSize = typeof body.batch_size === "number" ? body.batch_size : 1;

  const { data, error } = await db.rpc("claim_tiff_jobs", {
    p_agent_id: agentId,
    p_batch_size: batchSize,
  });

  if (error) return err(error.message, 500);
  if (!data || data.length === 0) return json({ ok: true, jobs: [] });

  return json({ ok: true, jobs: data });
}

async function handleClaimTiffReinspect(body: Record<string, unknown>, agentId: string) {
  const db = serviceClient();
  const batchSize = typeof body.batch_size === "number"
    ? Math.min(Math.max(body.batch_size, TIFF_REINSPECT_MIN_BATCH), TIFF_REINSPECT_MAX_BATCH)
    : TIFF_REINSPECT_DEFAULT_BATCH;

  const { data: row, error: reqErr } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "TIFF_REINSPECT_REQUEST")
    .maybeSingle();

  if (reqErr) return err(reqErr.message, 500);

  const req = (row?.value as Record<string, unknown> | undefined) ?? undefined;
  if (!req || (req.status !== "pending" && req.status !== "claimed")) {
    return json({ ok: true, jobs: [], done: true });
  }

  const nowIso = new Date().toISOString();
  const currentStatus = req.status as string;
  const claimedBy = typeof req.claimed_by === "string" ? req.claimed_by : null;

  if (currentStatus === "pending") {
    const { error: claimErr } = await db.from("admin_config").upsert({
      key: "TIFF_REINSPECT_REQUEST",
      value: {
        ...req,
        status: "claimed",
        claimed_by: agentId,
        claimed_at: nowIso,
      },
      updated_at: nowIso,
    }, { onConflict: "key" });
    if (claimErr) return err(claimErr.message, 500);
  } else if (claimedBy && claimedBy !== agentId) {
    return json({ ok: true, jobs: [], done: false });
  }

  const requestedIds = Array.isArray(req.ids) ? (req.ids.filter((v): v is string => typeof v === "string" && v.length > 0)) : [];
  const lastId = typeof req.last_id === "string" && req.last_id.length > 0 ? req.last_id : null;
  const processedCount = typeof req.processed_count === "number" ? req.processed_count : 0;

  let query = db.from("tiff_optimization_queue")
    .select("id, relative_path")
    .eq("status", "completed")
    .order("id", { ascending: true })
    .limit(batchSize);

  if (requestedIds.length > 0) query = query.in("id", requestedIds);
  if (lastId) query = query.gt("id", lastId);

  const { data: jobs, error: jobsErr } = await query;
  if (jobsErr) return err(jobsErr.message, 500);

  if (!jobs || jobs.length === 0) {
    const { error: doneErr } = await db.from("admin_config").upsert({
      key: "TIFF_REINSPECT_REQUEST",
      value: {
        ...req,
        status: "completed",
        completed_at: nowIso,
        processed_count: processedCount,
      },
      updated_at: nowIso,
    }, { onConflict: "key" });
    if (doneErr) return err(doneErr.message, 500);
    return json({ ok: true, jobs: [], done: true });
  }

  const newLastId = jobs[jobs.length - 1].id;
  const { error: progErr } = await db.from("admin_config").upsert({
    key: "TIFF_REINSPECT_REQUEST",
    value: {
      ...req,
      status: "claimed",
      claimed_by: agentId,
      claimed_at: nowIso,
      processed_count: processedCount + jobs.length,
      last_id: newLastId,
    },
    updated_at: nowIso,
  }, { onConflict: "key" });
  if (progErr) return err(progErr.message, 500);

  return json({ ok: true, jobs, done: false });
}

async function handleCompleteTiffReinspect(body: Record<string, unknown>) {
  const jobId = requireString(body, "job_id");
  const success = body.success === true;
  const db = serviceClient();

  const updates: Record<string, unknown> = {
    processed_at: new Date().toISOString(),
  };

  if (success) {
    if (body.new_file_modified_at !== undefined) updates.new_file_modified_at = body.new_file_modified_at;
    if (body.new_file_created_at !== undefined) updates.new_file_created_at = body.new_file_created_at;
    updates.error_message = null;
  } else {
    updates.error_message = optionalString(body, "error") || "Timestamp re-inspection failed";
  }

  const { error } = await db.from("tiff_optimization_queue")
    .update(updates)
    .eq("id", jobId)
    .eq("status", "completed");

  if (error) return err(error.message, 500);
  return json({ ok: true });
}

// ── Route: complete-tiff-job ────────────────────────────────────────

async function handleCompleteTiffJob(body: Record<string, unknown>) {
  const jobId = requireString(body, "job_id");
  const success = body.success === true;
  const errorMsg = optionalString(body, "error");
  const db = serviceClient();

  const updates: Record<string, unknown> = {
    status: success ? "completed" : "failed",
    processed_at: new Date().toISOString(),
    error_message: errorMsg || null,
  };

  if (success) {
    if (body.new_file_size !== undefined) updates.new_file_size = body.new_file_size;
    if (body.new_filename !== undefined) updates.new_filename = body.new_filename;
    if (body.new_file_modified_at !== undefined) updates.new_file_modified_at = body.new_file_modified_at;
    if (body.new_file_created_at !== undefined) updates.new_file_created_at = body.new_file_created_at;
    if (body.original_backed_up !== undefined) updates.original_backed_up = body.original_backed_up;
    if (body.original_deleted !== undefined) updates.original_deleted = body.original_deleted;
    if (body.file_size !== undefined) updates.file_size = body.file_size; // update original size if changed
  }

  const { error } = await db.from("tiff_optimization_queue")
    .update(updates)
    .eq("id", jobId);

  if (error) return err(error.message, 500);
  return json({ ok: true });
}

// (legacy handleBootstrap stub removed — the real one is above at handlePair delegation)

async function handleNotifyBuild(
  body: Record<string, unknown>,
  req: Request,
): Promise<Response> {
  // Auth: compare x-deploy-key header against DEPLOY_WEBHOOK_KEY secret
  const deployKey = req.headers.get("x-deploy-key");
  const expectedKey = Deno.env.get("DEPLOY_WEBHOOK_KEY");

  if (!expectedKey) {
    return err("DEPLOY_WEBHOOK_KEY secret not configured", 500);
  }
  if (!deployKey || deployKey !== expectedKey) {
    return err("Invalid deploy key", 401);
  }

  const agentType = optionalString(body, "agent_type") ?? "windows-render";
  const version = requireString(body, "version");
  const downloadUrl = requireString(body, "download_url");
  const checksum = optionalString(body, "checksum_sha256") || "";
  const installerUrl = optionalString(body, "installer_url") || "";
  const commitSha = optionalString(body, "commit_sha") || "";

  const configKey = agentType === "bridge" ? "BRIDGE_LATEST_BUILD" : "WINDOWS_LATEST_BUILD";

  const db = serviceClient();
  const { error: upsertErr } = await db
    .from("admin_config")
    .upsert({
      key: configKey,
      value: {
        version,
        download_url: downloadUrl,
        installer_url: installerUrl,
        checksum_sha256: checksum,
        commit_sha: commitSha,
        published_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

  if (upsertErr) return err(upsertErr.message, 500);

  console.log(`[notify-build] Updated ${configKey}: v${version} (${commitSha.slice(0, 7)})`);
  return json({ ok: true, config_key: configKey, version });
}

// ── Route: claim-sibling-scan ────────────────────────────────────────
// Bridge Agent claims the oldest pending sibling scan request.

async function handleClaimSiblingScan(_body: Record<string, unknown>, agentId: string) {
  const db = serviceClient();

  // Fetch all sibling_scan_request_* keys that are pending
  const { data: rows, error: fetchErr } = await db
    .from("admin_config")
    .select("key, value")
    .like("key", "sibling_scan_request_%")
    .order("updated_at", { ascending: true })
    .limit(20);

  if (fetchErr) return err(fetchErr.message, 500);

  const pendingRequests: Array<{ key: string; value: Record<string, unknown> }> = [];
  for (const row of rows || []) {
    const val = row.value as Record<string, unknown>;
    if (val && val.status === "pending") {
      pendingRequests.push({ key: row.key, value: val });
    }
  }

  if (pendingRequests.length === 0) {
    return json({ ok: true, request: null });
  }

  // Claim the oldest one
  const oldest = pendingRequests[0];
  const requestId = oldest.key.replace("sibling_scan_request_", "");

  const claimedValue = {
    ...oldest.value,
    status: "claimed",
    claimed_by: agentId,
    claimed_at: new Date().toISOString(),
  };

  const { error: claimErr } = await db
    .from("admin_config")
    .update({ value: claimedValue, updated_at: new Date().toISOString() })
    .eq("key", oldest.key);

  if (claimErr) return err(claimErr.message, 500);

  console.log(`[claim-sibling-scan] Agent ${agentId} claimed request ${requestId} for folder ${oldest.value.folder_path}`);

  return json({
    ok: true,
    request: {
      request_id: requestId,
      folder_path: oldest.value.folder_path,
      extensions: oldest.value.extensions ?? [".jpg", ".jpeg", ".png"],
    },
  });
}

// ── Route: complete-sibling-scan ────────────────────────────────────
// Bridge Agent reports completion or failure of a sibling scan.

async function handleCompleteSiblingScan(body: Record<string, unknown>) {
  const requestId = requireString(body, "request_id");
  const status = requireString(body, "status"); // "completed" | "failed"
  const images = (body.images as Array<Record<string, unknown>>) || [];
  const errorMessage = optionalString(body, "error_message");
  const db = serviceClient();

  const configKey = `sibling_scan_request_${requestId}`;

  const { data: existing } = await db
    .from("admin_config")
    .select("value")
    .eq("key", configKey)
    .maybeSingle();

  if (!existing) return err("Request not found", 404);

  const oldVal = existing.value as Record<string, unknown>;
  const newVal = {
    ...oldVal,
    status,
    processed_at: new Date().toISOString(),
    images: status === "completed" ? images : [],
    error_message: status === "failed" ? errorMessage : null,
  };

  const { error: updErr } = await db
    .from("admin_config")
    .update({ value: newVal, updated_at: new Date().toISOString() })
    .eq("key", configKey);

  if (updErr) return err(updErr.message, 500);

  console.log(`[complete-sibling-scan] Request ${requestId}: ${status}, ${images.length} images`);
  return json({ ok: true });
}

// ── Route: claim-hygiene-scan ───────────────────────────────────────

async function handleClaimHygieneScan(_body: Record<string, unknown>, agentId: string) {
  const db = serviceClient();
  const { data } = await db.from("admin_config").select("value").eq("key", "HYGIENE_SCAN_REQUEST").maybeSingle();
  const req = (data?.value as Record<string, unknown>) ?? null;

  if (!req || req.status !== "pending") {
    return json({ ok: true, request: null });
  }

  const claimed = {
    ...req,
    status: "claimed",
    claimed_by: agentId,
    claimed_at: new Date().toISOString(),
  };

  const { error: claimErr } = await db.from("admin_config").upsert(
    { key: "HYGIENE_SCAN_REQUEST", value: claimed, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );

  if (claimErr) return err(claimErr.message, 500);
  return json({ ok: true, request: claimed });
}

// ── Route: report-hygiene-findings ──────────────────────────────────

async function handleReportHygieneFindings(body: Record<string, unknown>) {
  const findings = body.findings as Array<Record<string, unknown>>;
  const sessionId = optionalString(body, "session_id");
  const done = body.done === true;
  const scanError = optionalString(body, "error");

  // Accept progress counters from agent
  const progressCounters = body.progress as Record<string, unknown> | undefined;

  if (!Array.isArray(findings)) return err("findings must be an array");

  const db = serviceClient();

  // Upsert findings in batches
  const CHUNK = 100;
  let inserted = 0;
  for (let i = 0; i < findings.length; i += CHUNK) {
    const chunk = findings.slice(i, i + CHUNK);
    const rows = chunk
      .filter((f) => !isExcludedRelativePath(f.relative_path as string))
      .map((f) => ({
        asset_id: (f.asset_id as string) || null,
        relative_path: f.relative_path as string,
        filename: f.filename as string,
        check_type: f.check_type as string,
        severity: (f.severity as string) || "warning",
        status: "open",
        details: f.details || {},
        scan_session_id: sessionId,
        found_by_agent: (f.found_by_agent as string) || null,
      }));

    // Use upsert with the unique index on (relative_path, check_type) WHERE status != 'resolved'
    for (const row of rows) {
      const { error } = await db.from("hygiene_findings")
        .upsert(row, { onConflict: "relative_path,check_type" });
      if (!error) inserted++;
    }
  }

  // Read current state to MERGE (not overwrite) — preserves claimed_at, claimed_by, etc.
  const { data: currentData } = await db.from("admin_config")
    .select("value").eq("key", "HYGIENE_SCAN_REQUEST").maybeSingle();
  const currentState = (currentData?.value as Record<string, unknown>) ?? {};

  // Check if scan was cancelled (status changed to "cancelled")
  const isCancelled = currentState.status === "cancelled";

  // Update progress on every batch (not just when done)
  if (sessionId && !done && !isCancelled) {
    const merged: Record<string, unknown> = {
      ...currentState,
      updated_at: new Date().toISOString(),
      findings_so_far: inserted + ((currentState.findings_so_far as number) || 0),
    };
    if (progressCounters) {
      merged.progress = progressCounters;
    }
    try {
      await db.from("admin_config").upsert({
        key: "HYGIENE_SCAN_REQUEST",
        value: merged,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    } catch { /* best-effort */ }
  }

  // If done, mark scan request as completed
  if (done && sessionId) {
    const finalValue: Record<string, unknown> = {
      ...currentState,
      status: scanError ? "error" : (isCancelled ? "cancelled" : "completed"),
      completed_at: new Date().toISOString(),
      total_findings: ((currentState.findings_so_far as number) || 0) + inserted,
    };
    if (scanError) finalValue.error = scanError;
    if (progressCounters) finalValue.progress = progressCounters;
    await db.from("admin_config").upsert({
      key: "HYGIENE_SCAN_REQUEST",
      value: finalValue,
      updated_at: new Date().toISOString(),
    });
  }

  return json({ ok: true, inserted, cancelled: isCancelled });
}

// ── Route: claim-style-guide-crawl ──────────────────────────────────

async function handleClaimStyleGuideCrawl(_body: Record<string, unknown>, agentId: string) {
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

  // Read roots
  const { data: rootsRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "STYLE_GUIDE_SCAN_ROOTS")
    .maybeSingle();

  const roots = (rootsRow?.value as string[]) || [];

  // Claim the request
  await db.from("admin_config").upsert({
    key: "STYLE_GUIDE_CRAWL_REQUEST",
    value: { ...req, status: "claimed", claimed_by: agentId, claimed_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  });

  // Create crawl run
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

  console.log(`[claim-style-guide-crawl] Agent ${agentId} claimed crawl, run_id=${run.id}`);
  return json({ ok: true, run_id: run.id, roots });
}

// ── Route: complete-style-guide-crawl ───────────────────────────────

async function handleCompleteStyleGuideCrawl(body: Record<string, unknown>) {
  const db = serviceClient();
  const runId = body.run_id as string;
  const files = (body.files as Record<string, unknown>[]) || [];
  const done = body.done === true;
  const totalFiles = body.total_files as number | undefined;
  const crawlError = body.error as string | undefined;
  const inaccessibleRoots = (body.inaccessible_roots as string[]) || [];

  if (!runId) return err("run_id is required");

  // Upsert files in batch
  if (files.length > 0) {
    const rows = files.map((f) => ({
      crawl_run_id: runId,
      root_label: f.root_label as string,
      relative_path: f.relative_path as string,
      directory_path: f.directory_path as string,
      filename: f.filename as string,
      basename_no_ext: f.basename_no_ext as string,
      file_extension: (f.file_extension as string) || null,
      property_folder: (f.property_folder as string) || null,
      style_guide_folder: (f.style_guide_folder as string) || null,
      normalized_name: f.normalized_name as string,
      normalized_style_guide_folder: (f.normalized_style_guide_folder as string) || null,
      size_bytes: (f.size_bytes as number) || null,
      modified_at: (f.modified_at as string) || null,
      last_seen_at: new Date().toISOString(),
      is_active: true,
      thumbnail_url: (f.thumbnail_url as string) || null,
      thumbnail_error: (f.thumbnail_error as string) || null,
    }));

    const { data: upsertedRows, error: upsertErr } = await db
      .from("style_guide_files")
      .upsert(rows, { onConflict: "root_label,relative_path" })
      .select("id");

    if (upsertErr) {
      console.error("[complete-style-guide-crawl] Upsert error:", upsertErr);
      return err(`File upsert failed: ${upsertErr.message}`, 500);
    }

    // Queue render jobs for this batch progressively (don't wait until crawl done)
    if (upsertedRows && upsertedRows.length > 0) {
      const fileIds = upsertedRows.map((r: { id: string }) => r.id);
      const { error: queueErr } = await db.rpc("queue_sg_render_jobs_by_ids", { p_file_ids: fileIds });
      if (queueErr) {
        console.warn("[complete-style-guide-crawl] SG render queue error (non-fatal):", queueErr.message);
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
        ...(inaccessibleRoots.length ? { inaccessible_roots: inaccessibleRoots } : {}),
      }).eq("id", runId);

      await db.from("admin_config").upsert({
        key: "STYLE_GUIDE_CRAWL_REQUEST",
        value: { status: "failed", error: crawlError, completed_at: new Date().toISOString(), inaccessible_roots: inaccessibleRoots },
        updated_at: new Date().toISOString(),
      });
    } else {
      await db.from("style_guide_crawl_runs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        files_found: totalFiles ?? 0,
        ...(inaccessibleRoots.length ? { inaccessible_roots: inaccessibleRoots } : {}),
      }).eq("id", runId);

      // Mark stale files
      const { data: runData } = await db
        .from("style_guide_crawl_runs")
        .select("roots_scanned")
        .eq("id", runId)
        .single();

      if (runData?.roots_scanned) {
        // Files from previous runs for the same roots that weren't seen in this run
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
        value: { status: "completed", completed_at: new Date().toISOString(), files_found: totalFiles, inaccessible_roots: inaccessibleRoots },
        updated_at: new Date().toISOString(),
      });
    }
    console.log(`[complete-style-guide-crawl] Run ${runId} done=${done}, files=${totalFiles}, error=${crawlError || "none"}`);
  }

  return json({ ok: true });
}

// ── Route: claim-sg-render ───────────────────────────────────────

async function handleClaimSgRender(body: Record<string, unknown>) {
  const db = serviceClient();
  const agentId = body.agent_id as string;
  if (!agentId) return err("agent_id is required");

  const { data, error } = await db.rpc("claim_sg_render_jobs", { p_agent_id: agentId, p_batch_size: 1 });
  if (error) {
    console.error("[claim-sg-render] RPC error:", error);
    return err(`claim_sg_render_jobs failed: ${error.message}`, 500);
  }

  const jobs = data as Array<{ id: string; style_guide_file_id: string }> | null;
  if (!jobs || jobs.length === 0) return json({ ok: true, job: null });

  const row = jobs[0];

  // Fetch file metadata needed by the agent
  const { data: fileRow, error: fileErr } = await db
    .from("style_guide_files")
    .select("relative_path, file_extension, filename")
    .eq("id", row.style_guide_file_id)
    .single();

  if (fileErr || !fileRow) {
    // Mark job failed so it doesn't stay claimed
    await db.from("style_guide_render_queue").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: "File record not found",
    }).eq("id", row.id);
    return json({ ok: true, job: null });
  }

  return json({
    ok: true,
    job: {
      job_id: row.id,
      style_guide_file_id: row.style_guide_file_id,
      relative_path: fileRow.relative_path,
      file_type: (fileRow.file_extension || "").toLowerCase().replace(/^\./, ""),
      filename: fileRow.filename,
    },
  });
}

// ── Route: complete-sg-render ────────────────────────────────────

async function handleCompleteSgRender(body: Record<string, unknown>) {
  const db = serviceClient();
  const jobId = body.job_id as string;
  const success = body.success === true;
  const thumbnailUrl = body.thumbnail_url as string | undefined;
  const errorMsg = body.error as string | undefined;
  const fileId = body.style_guide_file_id as string | undefined;

  if (!jobId) return err("job_id is required");

  const now = new Date().toISOString();

  const { data: jobRow, error: fetchErr } = await db
    .from("style_guide_render_queue")
    .select("id, style_guide_file_id")
    .eq("id", jobId)
    .single();

  if (fetchErr || !jobRow) {
    console.warn("[complete-sg-render] Job not found:", jobId);
    return json({ ok: true });
  }

  const resolvedFileId = (fileId || jobRow.style_guide_file_id) as string;

  await db.from("style_guide_render_queue").update({
    status: success ? "completed" : "failed",
    completed_at: now,
    error_message: errorMsg || null,
  }).eq("id", jobId);

  if (success && thumbnailUrl && resolvedFileId) {
    await db.from("style_guide_files").update({
      thumbnail_url: thumbnailUrl,
      thumbnail_error: null,
    }).eq("id", resolvedFileId);
  } else if (!success && errorMsg && resolvedFileId) {
    await db.from("style_guide_files").update({
      thumbnail_error: errorMsg,
    }).eq("id", resolvedFileId);
  }

  console.log(`[complete-sg-render] job=${jobId} success=${success} fileId=${resolvedFileId}`);
  return json({ ok: true });
}

// ── Route: complete-pdf-text-sample ─────────────────────────────────

async function handleCompletePdfTextSample(body: Record<string, unknown>) {
  const db = serviceClient();
  const results = (body.results as Record<string, unknown>[]) || [];

  if (results.length === 0) return json({ ok: true });

  // Clear existing sample rows then insert fresh results
  await db.from("pdf_text_samples").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  const rows = results.map((r) => ({
    asset_id: (r.asset_id as string) || null,
    filename: r.filename as string,
    relative_path: r.relative_path as string,
    extraction_method: r.extraction_method as string,
    extracted_text: (r.extracted_text as string) || null,
    page_count: (r.page_count as number) || null,
    char_count: (r.char_count as number) || 0,
    extraction_error: (r.extraction_error as string) || null,
    sampled_at: new Date().toISOString(),
  }));

  const { error } = await db.from("pdf_text_samples").insert(rows);
  if (error) {
    console.error("[complete-pdf-text-sample] Insert error:", error);
    return err(`Insert failed: ${error.message}`, 500);
  }

  // Mark the request as completed
  await db.from("admin_config").upsert({
    key: "PDF_TEXT_SAMPLE_REQUEST",
    value: { status: "completed", completed_at: new Date().toISOString(), count: rows.length },
    updated_at: new Date().toISOString(),
  });

  console.log(`[complete-pdf-text-sample] Stored ${rows.length} results`);
  return json({ ok: true });
}

async function handlePdfTextSampleProgress(
  body: Record<string, unknown>,
  agentId: string,
  agentName: string,
) {
  const db = serviceClient();

  const processed = Math.max(0, optionalNumber(body, "processed") ?? 0);
  const total = Math.max(0, optionalNumber(body, "total") ?? 0);
  const currentFile = optionalString(body, "current_file") ?? null;
  const currentStep = optionalString(body, "current_step") ?? null;
  const errorMsg = optionalString(body, "error") ?? null;
  const fileResults = Array.isArray(body.file_results) ? (body.file_results as unknown[]).slice(-PDF_TEXT_SAMPLE_PROGRESS_LIMIT) : [];

  const { data: reqRow, error: reqErr } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "PDF_TEXT_SAMPLE_REQUEST")
    .maybeSingle();

  if (reqErr) return err(reqErr.message, 500);
  if (!reqRow?.value) return json({ ok: true, ignored: true, reason: "no_active_request" });

  const existing = (reqRow.value as Record<string, unknown>) || {};
  if (existing.status === "completed") {
    return json({ ok: true, ignored: true, reason: "already_completed" });
  }

  const nowIso = new Date().toISOString();
  const updatedValue: Record<string, unknown> = {
    ...existing,
    status: errorMsg ? "error" : "processing",
    claimed_by_agent_id: (existing.claimed_by_agent_id as string) || agentId,
    claimed_by_agent_name: (existing.claimed_by_agent_name as string) || agentName,
    progress: {
      processed,
      total,
      current_file: currentFile,
      current_step: currentStep,
      file_results: fileResults,
      updated_at: nowIso,
    },
  };

  if (errorMsg) {
    updatedValue.error = errorMsg.slice(0, 500);
  } else {
    delete updatedValue.error;
  }

  await db.from("admin_config").upsert({
    key: "PDF_TEXT_SAMPLE_REQUEST",
    value: updatedValue,
    updated_at: nowIso,
  });

  return json({ ok: true });
}

// ── Route: get-compat-audit-batch ────────────────────────────────────
// Returns a paginated batch of AI assets that have a thumbnail_url set.
// The bridge-agent reads source files for each to check /CompatibilityAlert.

const COMPAT_AUDIT_BATCH_SIZE = 200;

async function handleGetCompatAuditBatch(body: Record<string, unknown>) {
  const db = serviceClient();
  // Prefer keyset cursor (after_id) — O(1) with PK index, no timeout at large offsets.
  // Legacy offset still accepted for backward compat with older agent versions.
  const afterId = optionalString(body, "after_id");
  const legacyOffset = optionalNumber(body, "offset") ?? 0;

  let query = db
    .from("assets")
    .select("id, relative_path, thumbnail_url")
    .eq("file_type", "ai")
    .eq("is_deleted", false)
    .not("thumbnail_url", "is", null)
    .order("id");

  if (afterId) {
    query = query.gt("id", afterId).limit(COMPAT_AUDIT_BATCH_SIZE);
  } else if (legacyOffset > 0) {
    query = query.range(legacyOffset, legacyOffset + COMPAT_AUDIT_BATCH_SIZE - 1);
  } else {
    query = query.limit(COMPAT_AUDIT_BATCH_SIZE);
  }

  const { data, error } = await query;

  if (error) return err(error.message, 500);

  return json({ ok: true, assets: data ?? [], batch_size: COMPAT_AUDIT_BATCH_SIZE });
}

// ── Route: clear-compat-thumbnails ─────────────────────────────────
// Force-clears thumbnail_url and sets thumbnail_error = "no_pdf_compat" for
// assets identified as CompatibilityAlert placeholders.
// Bypasses the normal ingest protection that keeps existing thumbnails.

async function handleClearCompatThumbnails(body: Record<string, unknown>) {
  const db = serviceClient();
  const assetIds = body.asset_ids as string[];
  if (!Array.isArray(assetIds) || assetIds.length === 0) {
    return json({ ok: true, cleared: 0 });
  }

  const CHUNK = 200;
  let cleared = 0;
  for (let i = 0; i < assetIds.length; i += CHUNK) {
    const chunk = assetIds.slice(i, i + CHUNK);
    const { error } = await db
      .from("assets")
      .update({ thumbnail_url: null, thumbnail_error: "no_pdf_compat" })
      .in("id", chunk);
    if (error) return err(error.message, 500);
    cleared += chunk.length;
  }

  return json({ ok: true, cleared });
}

// ── Route: update-compat-audit-preview ───────────────────────────────
// Called by bridge-agent after each batch during a preview scan.
// Writes intermediate progress (scanned count + flagged-so-far) so the UI
// can show live progress without waiting for the full scan to complete.

async function handleUpdateCompatAuditPreview(body: Record<string, unknown>) {
  const db = serviceClient();
  const scanned = optionalNumber(body, "scanned") ?? 0;
  const flagged = (body.flagged as Array<Record<string, unknown>>) ?? [];
  const nowIso = new Date().toISOString();

  const { data: reqRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "COMPAT_AUDIT_PREVIEW_REQUEST")
    .maybeSingle();

  if (!reqRow?.value) return json({ ok: true, ignored: true });

  await db.from("admin_config").upsert({
    key: "COMPAT_AUDIT_PREVIEW_REQUEST",
    value: {
      ...(reqRow.value as Record<string, unknown>),
      status: "scanning",
      scanned,
      flagged,
    },
    updated_at: nowIso,
  });

  return json({ ok: true });
}

// ── Route: complete-compat-audit-preview ─────────────────────────────
// Called by bridge-agent when the full preview scan finishes.
// Stores the final list of flagged assets so the admin UI can display them
// before the user commits to the destructive full audit.

async function handleCompleteCompatAuditPreview(body: Record<string, unknown>) {
  const db = serviceClient();
  const scanned = optionalNumber(body, "scanned") ?? 0;
  const flagged = (body.flagged as Array<Record<string, unknown>>) ?? [];
  const errorMsg = optionalString(body, "error") ?? null;
  const nowIso = new Date().toISOString();

  const { data: reqRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "COMPAT_AUDIT_PREVIEW_REQUEST")
    .maybeSingle();

  if (!reqRow?.value) return json({ ok: true, ignored: true });

  const updated: Record<string, unknown> = {
    ...(reqRow.value as Record<string, unknown>),
    status: errorMsg ? "error" : "completed",
    completed_at: nowIso,
    scanned,
    flagged,
  };
  if (errorMsg) updated.error = errorMsg.slice(0, 500);

  await db.from("admin_config").upsert({
    key: "COMPAT_AUDIT_PREVIEW_REQUEST",
    value: updated,
    updated_at: nowIso,
  });

  return json({ ok: true });
}

// ── Route: complete-compat-audit ─────────────────────────────────────
// Called by bridge-agent when the audit loop finishes.

async function handleCompleteCompatAudit(body: Record<string, unknown>) {
  const db = serviceClient();
  const cleared = optionalNumber(body, "cleared") ?? 0;
  const scanned = optionalNumber(body, "scanned") ?? 0;
  const errorMsg = optionalString(body, "error") ?? null;
  const nowIso = new Date().toISOString();

  const { data: reqRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "COMPAT_AUDIT_REQUEST")
    .maybeSingle();

  if (!reqRow?.value) return json({ ok: true, ignored: true });

  const updated: Record<string, unknown> = {
    ...(reqRow.value as Record<string, unknown>),
    status: errorMsg ? "error" : "completed",
    completed_at: nowIso,
    result: { scanned, cleared },
  };
  if (errorMsg) updated.error = errorMsg.slice(0, 500);

  await db.from("admin_config").upsert({
    key: "COMPAT_AUDIT_REQUEST",
    value: updated,
    updated_at: nowIso,
  });

  return json({ ok: true });
}

corsServe(async (req: Request) => {
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

    // Deploy webhook — authenticated via x-deploy-key header
    if (action === "notify-build") {
      return await handleNotifyBuild(body, req);
    }

    // get-latest-build is read-only (returns public GitHub release URLs) — no auth needed.
    // Keeping it unauthenticated ensures OTA updates work even during transient DB auth failures.
    if (action === "get-latest-build") {
      return await handleGetLatestBuild(body, "");
    }

    // report-update-status is best-effort telemetry — allow without auth so updates complete
    if (action === "report-update-status") {
      return await handleReportUpdateStatus(body);
    }

    // All other routes require agent authentication
    const authResult = await authenticateAgent(req);
    if (authResult instanceof Response) return authResult;
    const { agentId, agentType, agentName } = authResult;

    switch (action) {
      case "heartbeat":
        return await handleHeartbeat(body, agentId, agentType, agentName);
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
      case "report-dir-browse":
        return await handleReportDirBrowse(body);
      case "check-changed":
        return await handleCheckChanged(body);
      case "save-checkpoint":
        return await handleSaveCheckpoint(body, agentId);
      case "get-checkpoint":
        return await handleGetCheckpoint(agentId);
      case "clear-checkpoint":
        return await handleClearCheckpoint();
      // report-update-status and get-latest-build handled above (before auth)
      case "claim-tiff-scan":
        return await handleClaimTiffScan(body, agentId);
      case "report-tiff-scan":
        return await handleReportTiffScan(body);
      case "claim-tiff-job":
        return await handleClaimTiffJob(body, agentId);
      case "claim-tiff-reinspect":
        return await handleClaimTiffReinspect(body, agentId);
      case "complete-tiff-job":
        return await handleCompleteTiffJob(body);
      case "complete-tiff-reinspect":
        return await handleCompleteTiffReinspect(body);
      case "claim-sibling-scan":
        return await handleClaimSiblingScan(body, agentId);
      case "complete-sibling-scan":
        return await handleCompleteSiblingScan(body);
      case "claim-hygiene-scan":
        return await handleClaimHygieneScan(body, agentId);
      case "report-hygiene-findings":
        return await handleReportHygieneFindings(body);
      case "claim-style-guide-crawl":
        return await handleClaimStyleGuideCrawl(body, agentId);
      case "complete-style-guide-crawl":
        return await handleCompleteStyleGuideCrawl(body);
      case "claim-sg-render":
        return await handleClaimSgRender(body);
      case "complete-sg-render":
        return await handleCompleteSgRender(body);
      case "complete-pdf-text-sample":
        return await handleCompletePdfTextSample(body);
      case "pdf-text-sample-progress":
        return await handlePdfTextSampleProgress(body, agentId, agentName);
      case "get-compat-audit-batch":
        return await handleGetCompatAuditBatch(body);
      case "clear-compat-thumbnails":
        return await handleClearCompatThumbnails(body);
      case "complete-compat-audit":
        return await handleCompleteCompatAudit(body);
      case "update-compat-audit-preview":
        return await handleUpdateCompatAuditPreview(body);
      case "complete-compat-audit-preview":
        return await handleCompleteCompatAuditPreview(body);
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
