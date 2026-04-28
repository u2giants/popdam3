/**
 * PopDAM Windows Render Agent — Main Entry Point
 *
 * Lifecycle:
 *   1. Check for agent key — if missing, bootstrap with one-time token
 *   2. Register with cloud API as agent_type = 'windows-render'
 *   3. Run preflight health checks (NAS access)
 *   4. Start heartbeat timer (every 30s)
 *   5. Poll render_queue for pending jobs (every 3s, up to N concurrent)
 *      — only if healthy
 *
 * Rendering uses Sharp + Ghostscript. Hygiene scans use Illustrator ExtendScript.
 */

import { config } from "./config";
import { logger, getLogTail } from "./logger";
import * as api from "./api-client";
import { renderFile, type PdfRenderResult, type CompatWorker } from "./renderer";
import { uploadThumbnail, uploadPdfPage, uploadSgThumbnail, reinitializeS3Client } from "./uploader";
import { runPreflight, type HealthStatus } from "./preflight";
import { initUpdater, postRestartHealthCheck, getUpdateState, triggerImmediateUpdate, RESTART_EXIT_CODE } from "./updater";
import { scanTiffFiles, compressTiff, deleteOriginalBackup, setTimestampConfig, type TiffScanResult } from "./tiff-optimizer";
import { inspectAiFile } from "./ai-raster-inspector";
import { captureTimestamps } from "./tiff-timestamps";
import { ensureNasMapped } from "./nas-mapper";
import { shouldSkipPath, resetSkipWarnings } from "@popdam/path-filters";
import { startJanitor } from "./janitor";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { runPdfTextSample, type PdfSampleAsset, type AiModelDef } from "./pdf-text-sampler";
import { runCompatAudit, runCompatAuditPreview, createCompatAuditWorker } from "./compat-audit";

// ── State ───────────────────────────────────────────────────────

let agentId: string = "";
let activeJobs = 0;

// Lazily-initialized Tesseract worker for inline compat-alert OCR checks.
// Created on first AI render job, kept alive for the process lifetime.
let compatWorker: CompatWorker | undefined;
async function getCompatWorker(): Promise<CompatWorker | undefined> {
  if (!compatWorker) {
    try {
      compatWorker = await createCompatAuditWorker();
      logger.info("Tesseract compat worker initialized");
    } catch (e) {
      logger.warn("Failed to initialize Tesseract compat worker — inline OCR check disabled", {
        error: (e as Error).message,
      });
    }
  }
  return compatWorker;
}
let isSamplingPdfText = false;
let isRunningCompatAudit = false;
let isRunningCompatAuditPreview = false;
let lastError: string | undefined;
let jobsCompleted = 0;
let jobsFailed = 0;
let configReceived = false;
let stopAcceptingJobs = false;
let consecutiveHeartbeatFailures = 0;

// ── Health state ────────────────────────────────────────────────

let healthStatus: HealthStatus = {
  healthy: false,
  nasHealthy: false,
  lastPreflightError: "Preflight not yet run",
  lastPreflightAt: null,
};

const PREFLIGHT_RECHECK_MS = 60_000; // Re-check every 60s if unhealthy

// ── Cloud config overrides (updated from heartbeat) ─────────────

let cloudNasHost = config.nasHost;
let cloudNasShare = config.nasShare;
let cloudNasMountPath = config.nasMountPath;
// Separate mount path for style guide files — defaults to same as cloudNasMountPath if unset.
let cloudSgNasMountPath = "";
let cloudSpacesBucket = config.doSpacesBucket;
let cloudSpacesRegion = config.doSpacesRegion;
let cloudSpacesEndpoint = config.doSpacesEndpoint;
let cloudSpacesKey = config.doSpacesKey;
let cloudSpacesSecret = config.doSpacesSecret;
let cloudNasUsername = "";
let cloudNasPassword = "";
let cloudAnthropicApiKey = "";
let cloudGoogleAiApiKey = "";
let cloudOpenRouterApiKey = "";
let cloudAiModels: AiModelDef[] = [];
let cloudAiTaskModels: Record<string, string> = {};
let cloudPdfExtractionConfig: { ai_vision_model_id: string } | null = null;

// ── Pairing ─────────────────────────────────────────────────────

async function doPairing() {
  logger.info("No agent key found — pairing with cloud using pairing code");

  const result = await api.pair(config.pairingCode, config.agentName);

  // Merge pairing result into existing agent-config.json (preserve drive_letter, nas_unc, etc.)
  try {
    const { mkdir, readFile } = await import("node:fs/promises");
    await mkdir(config.agentConfigDir, { recursive: true });

    // Read existing config if present (tolerate parse errors)
    let existing: Record<string, unknown> = {};
    try {
      const raw = await readFile(config.agentConfigPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // File doesn't exist or is invalid JSON — start fresh
    }

    // Merge in pairing fields, preserving all others (drive_letter, nas_unc, server_url, etc.)
    const merged: Record<string, unknown> = {
      ...existing,
      agent_id: result.agent_id,
      agent_key: result.agent_key,
      paired_at: new Date().toISOString(),
    };

    // Clear consumed pairing code (no longer needed after successful pairing)
    if (merged.pairing_code) {
      delete merged.pairing_code;
    }

    await writeFile(config.agentConfigPath, JSON.stringify(merged, null, 2), "utf-8");

    logger.info("Agent config merged successfully", {
      preservedKeys: Object.keys(existing).filter(k => !["agent_id", "agent_key", "paired_at", "pairing_code"].includes(k)),
    });
  } catch (e) {
    logger.error("Failed to persist agent config — key will be lost on restart", {
      path: config.agentConfigPath,
      error: (e as Error).message,
    });
    // Fallback: also write to legacy location
    try {
      const legacyPath = path.join(path.dirname(process.execPath), "agent-key.cfg");
      await writeFile(legacyPath, result.agent_key, "utf-8");
    } catch { /* best effort */ }
  }

  // Apply to runtime
  (config as { agentKey: string }).agentKey = result.agent_key;
  agentId = result.agent_id;
  logger.info("Pairing complete — agent key saved", {
    agentId,
    configPath: config.agentConfigPath,
  });
}

// ── Path construction ───────────────────────────────────────────

/**
 * Convert a canonical relative_path (POSIX, no leading slash)
 * to a Windows UNC path using NAS_HOST and NAS_SHARE config.
 */
function toUncPath(relativePath: string): string {
  const windowsPath = relativePath.replace(/\//g, "\\");

  // If a local mount path is configured (e.g. Z:), use it
  const mountPath = (cloudNasMountPath || "").trim()
    .replace(/\\+$/, ""); // strip trailing backslash
  if (mountPath) {
    return `${mountPath}\\${windowsPath}`;
  }

  // Fall back to UNC path
  const host = cloudNasHost.replace(/^\\+/, '');
  const share = cloudNasShare.replace(/^\\+/, '').replace(/^\/+/, '');
  return `\\\\${host}\\${share}\\${windowsPath}`;
}

/**
 * Convert a style guide relative_path to a Windows path using the
 * sg_nas_mount_path config (falls back to the main NAS mount if unset).
 */
function toSgUncPath(relativePath: string): string {
  const windowsPath = relativePath.replace(/\//g, "\\");
  const mountPath = (cloudSgNasMountPath || cloudNasMountPath || "").trim()
    .replace(/\\+$/, "");
  if (mountPath) {
    return `${mountPath}\\${windowsPath}`;
  }
  const host = cloudNasHost.replace(/^\\+/, "");
  const share = cloudNasShare.replace(/^\\+/, "").replace(/^\/+/, "");
  return `\\\\${host}\\${share}\\${windowsPath}`;
}

// ── Preflight ───────────────────────────────────────────────────

async function runHealthCheck() {
  healthStatus = await runPreflight({
    mountPath: cloudNasMountPath,
    nasHost: cloudNasHost,
    nasShare: cloudNasShare,
    nasUsername: cloudNasUsername,
    nasPassword: cloudNasPassword,
  });
}

function startPreflightRecheck() {
  const loop = async () => {
    if (!healthStatus.healthy) {
      logger.info("Re-running preflight (currently unhealthy)...");
      // Attempt to re-map NAS before re-running preflight
      if (cloudNasHost) {
        const remapResult = await ensureNasMapped(cloudNasMountPath, {
          host: cloudNasHost,
          share: cloudNasShare,
          username: cloudNasUsername,
          password: cloudNasPassword,
        });
        if (!remapResult.ok) {
          logger.warn("NAS remap failed during health recovery", { error: remapResult.error });
        }
      }
      await runHealthCheck();
    }
    setTimeout(loop, PREFLIGHT_RECHECK_MS);
  };
  setTimeout(loop, PREFLIGHT_RECHECK_MS);
}

// ── Heartbeat ───────────────────────────────────────────────────

async function applyCloudConfig(response: api.WindowsHeartbeatResponse) {
  if (response.config?.windows_agent) {
    const wa = response.config.windows_agent;
    const oldMountPath = cloudNasMountPath;
    const oldHost = cloudNasHost;
    const oldShare = cloudNasShare;

    if (wa.nas_host) cloudNasHost = wa.nas_host;
    if (wa.nas_share) cloudNasShare = wa.nas_share;
    if (wa.nas_username) cloudNasUsername = wa.nas_username;
    if (wa.nas_password) cloudNasPassword = wa.nas_password;
    if (wa.nas_mount_path !== undefined) cloudNasMountPath = wa.nas_mount_path;
    if (wa.sg_nas_mount_path !== undefined) cloudSgNasMountPath = wa.sg_nas_mount_path;
    if (wa.render_concurrency && wa.render_concurrency > 0) {
      (config as { renderConcurrency: number }).renderConcurrency = wa.render_concurrency;
    }

    logger.debug("Cloud config received for windows_agent", {
      nas_host: wa.nas_host || "(empty)",
      nas_share: wa.nas_share || "(empty)",
      nas_mount_path: wa.nas_mount_path ?? "(not set)",
      nas_username: wa.nas_username ? "(set)" : "(empty)",
      nas_password: wa.nas_password ? "(set)" : "(empty)",
    });

    // If NAS config changed, re-run preflight
    if (cloudNasMountPath !== oldMountPath || cloudNasHost !== oldHost || cloudNasShare !== oldShare) {
      logger.info("NAS config changed via heartbeat — re-running preflight");
      await runHealthCheck();
    }
  } else {
    logger.debug("Heartbeat response did not contain windows_agent config block");
  }
  if (response.config?.do_spaces) {
    const sp = response.config.do_spaces;
    if (sp.bucket) cloudSpacesBucket = sp.bucket;
    if (sp.region) cloudSpacesRegion = sp.region;
    if (sp.endpoint) cloudSpacesEndpoint = sp.endpoint;
    if (sp.key) cloudSpacesKey = sp.key;
    if (sp.secret) cloudSpacesSecret = sp.secret;

    reinitializeS3Client({
      key: cloudSpacesKey,
      secret: cloudSpacesSecret,
      bucket: cloudSpacesBucket,
      region: cloudSpacesRegion,
      endpoint: cloudSpacesEndpoint,
    });
  }

  // Mark config as received when all required values are present
  const wasConfigReceived = configReceived;
  if (cloudNasHost && cloudSpacesKey && cloudSpacesSecret) {
    configReceived = true;
    if (!wasConfigReceived) {
      logger.info("All required cloud config received — agent will begin claiming jobs", {
        nasHost: cloudNasHost,
        nasShare: cloudNasShare,
        nasMountPath: cloudNasMountPath || "(UNC mode)",
      });
    }
  } else if (!configReceived) {
    logger.warn("Still waiting for cloud config", {
      nasHost: cloudNasHost || "(missing)",
      spacesKey: cloudSpacesKey ? "(set)" : "(missing)",
      spacesSecret: cloudSpacesSecret ? "(set)" : "(missing)",
    });
  }

  // Update AI config
  if (response.config?.ai) {
    const ai = response.config.ai;
    if (ai.anthropic_api_key) cloudAnthropicApiKey = ai.anthropic_api_key;
    if (ai.google_ai_api_key) cloudGoogleAiApiKey = ai.google_ai_api_key;
    if (ai.openrouter_api_key) cloudOpenRouterApiKey = ai.openrouter_api_key;
    if (Array.isArray(ai.models) && ai.models.length > 0) cloudAiModels = ai.models as AiModelDef[];
    if (ai.ai_task_models && typeof ai.ai_task_models === "object") cloudAiTaskModels = ai.ai_task_models as Record<string, string>;
    if (ai.pdf_extraction !== undefined) {
      cloudPdfExtractionConfig = (ai.pdf_extraction as { ai_vision_model_id: string } | null) ?? null;
    }
  }
}

function startHeartbeat() {
  const HEARTBEAT_MS = 30_000;
  const loop = async () => {
    try {
      const updateState = getUpdateState();
      const response = await api.heartbeat(agentId, lastError, healthStatus, {
        version: config.version,
        update_available: updateState.updateAvailable,
        latest_version: updateState.latestVersion,
        last_update_check: updateState.lastCheckAt,
        updating: updateState.updating,
        update_error: updateState.lastError,
      }, getLogTail(50));
      applyCloudConfig(response);
      consecutiveHeartbeatFailures = 0;

      // PDF text extraction sample
      if (response.commands?.trigger_pdf_text_sample && !isSamplingPdfText) {
        const assets = (response.commands.pdf_text_sample_assets as PdfSampleAsset[]) || [];
        const mountRoot = cloudNasMountPath.trim() || `\\\\${cloudNasHost}\\${cloudNasShare}`;
        isSamplingPdfText = true;
        logger.info("PDF text sample requested via heartbeat", { count: assets.length });
        runPdfTextSample(assets, mountRoot, {
          models: cloudAiModels,
          pdf_extraction: cloudPdfExtractionConfig,
          googleApiKey: cloudGoogleAiApiKey,
          anthropicApiKey: cloudAnthropicApiKey,
          openRouterApiKey: cloudOpenRouterApiKey,
          aiTaskModels: cloudAiTaskModels,
        }).finally(() => {
          isSamplingPdfText = false;
        });
      }

      // Check if cloud requests immediate update (standard — respects idle check)
      if (response.commands?.trigger_update) {
        logger.info("Cloud requested immediate update check");
        triggerImmediateUpdate(agentId).catch((e) =>
          logger.error("Triggered update failed", { error: (e as Error).message })
        );
      }

      // Force apply update — bypass activeJobs guard
      if (response.commands?.force_apply_update) {
        logger.info("Cloud requested force update — bypassing active-jobs guard");
        triggerImmediateUpdate(agentId, true).catch((e) =>
          logger.error("Force update failed", { error: (e as Error).message })
        );
      }

      // Force restart — exit immediately, launcher restarts us
      if (response.commands?.force_restart) {
        logger.info("Cloud requested force restart — exiting now");
        process.exit(RESTART_EXIT_CODE);
      }

      // Force stop jobs — stop claiming, drain current jobs, then restart
      if (response.commands?.force_stop_jobs) {
        logger.info("Cloud requested stop — halting job claims and draining");
        stopAcceptingJobs = true;
        waitForIdleThenRestart();
      }

      // Remote re-pairing — cloud sent a new pairing code
      if (response.commands?.repair_pairing_code) {
        const code = response.commands.repair_pairing_code;
        logger.info("Cloud sent repair pairing code — re-pairing agent");
        try {
          (config as Record<string, unknown>).pairingCode = code;
          await doPairing();
          logger.info("Agent re-paired successfully via remote repair");
        } catch (pairErr) {
          logger.error("Remote re-pairing failed", { error: (pairErr as Error).message });
        }
      }

      // Compat thumbnail audit — OCR all AI thumbnails and clear placeholder ones
      if (response.commands?.audit_compat_thumbnails && !isRunningCompatAudit) {
        isRunningCompatAudit = true;
        logger.info("Compat thumbnail audit requested via heartbeat");
        runCompatAudit().finally(() => {
          isRunningCompatAudit = false;
        });
      }

      // Compat thumbnail preview — OCR all AI thumbnails, report flagged without clearing
      if (response.commands?.audit_compat_preview && !isRunningCompatAuditPreview) {
        isRunningCompatAuditPreview = true;
        logger.info("Compat thumbnail preview requested via heartbeat");
        runCompatAuditPreview().finally(() => {
          isRunningCompatAuditPreview = false;
        });
      }

      logger.debug("Heartbeat sent");
    } catch (e) {
      consecutiveHeartbeatFailures++;
      logger.error("Heartbeat failed", {
        error: (e as Error).message,
        consecutiveFailures: consecutiveHeartbeatFailures,
      });
      // Restart after 10 consecutive failures (5 minutes) — likely a stuck state
      if (consecutiveHeartbeatFailures >= 10) {
        logger.error("10 consecutive heartbeat failures — restarting agent to recover");
        process.exit(RESTART_EXIT_CODE);
      }
    }
    setTimeout(loop, HEARTBEAT_MS);
  };
  setTimeout(loop, HEARTBEAT_MS);
  logger.info("Heartbeat started (30s interval)");
}

/**
 * Stop claiming new jobs, wait for in-flight jobs to finish (up to 60s), then restart.
 */
function waitForIdleThenRestart() {
  const MAX_WAIT_MS = 60_000;
  const CHECK_INTERVAL_MS = 5_000;
  const start = Date.now();

  const check = () => {
    if (activeJobs === 0) {
      logger.info("All jobs drained — restarting after force_stop_jobs");
      process.exit(RESTART_EXIT_CODE);
    }
    if (Date.now() - start >= MAX_WAIT_MS) {
      logger.warn("Timeout waiting for jobs to drain — forcing restart", { activeJobs });
      process.exit(RESTART_EXIT_CODE);
    }
    logger.info("Waiting for jobs to drain before restart", { activeJobs });
    setTimeout(check, CHECK_INTERVAL_MS);
  };
  check();
}

// ── Job processing ──────────────────────────────────────────────

async function processJob(job: api.RenderJob): Promise<void> {
  const uncPath = toUncPath(job.relative_path);
  logger.info("Processing render job", {
    jobId: job.job_id,
    assetId: job.asset_id,
    relativePath: job.relative_path,
    uncPath,
  });

  // Centralized path exclusion check (covers all junk files, excluded dirs, system artifacts)
  if (shouldSkipPath(job.relative_path, logger.warn)) {
    logger.info("Skipping excluded path", { relativePath: job.relative_path });
    await api.completeRender(job.job_id, false, undefined, "Skipped: excluded by path filter");
    return;
  }

  const filename = path.basename(job.relative_path);

  // Skip temp/autosave files (filename-level, not folder-level)
  if (filename.startsWith('~') || filename.startsWith('._')) {
    logger.info("Skipping junk file", { relativePath: job.relative_path });
    await api.completeRender(job.job_id, false, undefined, "Skipped: junk/temp file");
    return;
  }

  try {
    const fileType = (job.file_type === "psd") ? "psd" : (job.file_type === "pdf") ? "pdf" : "ai" as const;
    const cw = fileType === "ai" ? await getCompatWorker() : undefined;
    const result = await renderFile(uncPath, fileType, cw);
    const thumbnailUrl = await uploadThumbnail(job.asset_id, result.buffer);

    // For PDFs, upload hi-res page images
    if ("hiresPage1Buffer" in result) {
      const pdfResult = result as PdfRenderResult;
      await uploadPdfPage(job.asset_id, 1, pdfResult.hiresPage1Buffer);
      if (pdfResult.hiresPage2Buffer) {
        const page2Url = await uploadPdfPage(job.asset_id, 2, pdfResult.hiresPage2Buffer);
        // Update asset with page 2 URL via separate update call
        try {
          await api.updateAsset(job.asset_id, { pdf_page2_url: page2Url });
        } catch (e) {
          logger.warn("Failed to set pdf_page2_url", { assetId: job.asset_id, error: (e as Error).message });
        }
      }
    }

    await api.completeRender(job.job_id, true, thumbnailUrl);
    jobsCompleted++;
    logger.info("Render job completed", { jobId: job.job_id, assetId: job.asset_id, thumbnailUrl });
  } catch (e) {
    const errorMsg = (e as Error).message;
    jobsFailed++;
    lastError = errorMsg;
    logger.error("Render job failed", { jobId: job.job_id, assetId: job.asset_id, error: errorMsg });
    try {
      await api.completeRender(job.job_id, false, undefined, errorMsg);
    } catch (reportErr) {
      logger.error("Failed to report render failure", { jobId: job.job_id, error: (reportErr as Error).message });
    }
  }
}

async function processSgJob(job: api.SgRenderJob): Promise<void> {
  const uncPath = toSgUncPath(job.relative_path);
  logger.info("Processing SG render job", {
    jobId: job.job_id,
    fileId: job.style_guide_file_id,
    relativePath: job.relative_path,
    uncPath,
  });

  if (shouldSkipPath(job.relative_path, logger.warn)) {
    logger.info("Skipping excluded SG path", { relativePath: job.relative_path });
    await api.completeSgRender(job.job_id, false, undefined, "Skipped: excluded by path filter");
    return;
  }

  const filename = path.basename(job.relative_path);
  if (filename.startsWith("~") || filename.startsWith("._")) {
    logger.info("Skipping junk SG file", { relativePath: job.relative_path });
    await api.completeSgRender(job.job_id, false, undefined, "Skipped: junk/temp file");
    return;
  }

  try {
    const fileType = (job.file_type === "psd") ? "psd" : (job.file_type === "pdf") ? "pdf" : "ai" as const;
    const result = await renderFile(uncPath, fileType);
    const thumbnailUrl = await uploadSgThumbnail(job.style_guide_file_id, result.buffer);
    await api.completeSgRender(job.job_id, true, thumbnailUrl);
    jobsCompleted++;
    logger.info("SG render job completed", { jobId: job.job_id, fileId: job.style_guide_file_id, thumbnailUrl });
  } catch (e) {
    const errorMsg = (e as Error).message;
    jobsFailed++;
    lastError = errorMsg;
    logger.error("SG render job failed", { jobId: job.job_id, fileId: job.style_guide_file_id, error: errorMsg });
    try {
      await api.completeSgRender(job.job_id, false, undefined, errorMsg);
    } catch (reportErr) {
      logger.error("Failed to report SG render failure", { jobId: job.job_id, error: (reportErr as Error).message });
    }
  }
}

// ── Concurrent polling loop ─────────────────────────────────────

function startPolling() {
  const maxConcurrency = config.renderConcurrency;

  const loop = async () => {
    if (!configReceived) {
      logger.debug("Skipping poll — waiting for cloud config (NAS host + Spaces credentials)");
    } else if (!healthStatus.healthy) {
      logger.debug("Skipping poll — agent is unhealthy", {
        nasHealthy: healthStatus.nasHealthy,
      });
    } else if (stopAcceptingJobs) {
      logger.debug("Skipping poll — job claiming halted (force_stop_jobs active)");
    } else {
      // Fill all available slots — try PopDAM jobs first, then SG jobs
      while (activeJobs < maxConcurrency) {
        try {
          const job = await api.claimRender(agentId);
          if (job) {
            if (!job.relative_path) {
              logger.error("Claimed job missing relative_path", { jobId: job.job_id });
              await api.completeRender(job.job_id, false, undefined, "Asset missing relative_path");
              continue;
            }
            activeJobs++;
            processJob(job)
              .catch((e) => logger.error("Uncaught job error", { error: (e as Error).message }))
              .finally(() => { activeJobs--; });
            continue;
          }

          // No PopDAM job — try SG job
          const sgJob = await api.claimSgRender(agentId);
          if (sgJob) {
            if (!sgJob.relative_path) {
              logger.error("Claimed SG job missing relative_path", { jobId: sgJob.job_id });
              await api.completeSgRender(sgJob.job_id, false, undefined, "File missing relative_path");
              continue;
            }
            activeJobs++;
            processSgJob(sgJob)
              .catch((e) => logger.error("Uncaught SG job error", { error: (e as Error).message }))
              .finally(() => { activeJobs--; });
            continue;
          }

          // Nothing available
          if (activeJobs === 0) logger.debug("No render jobs available");
          break;
        } catch (e) {
          logger.error("Polling error", { error: (e as Error).message });
          break;
        }
      }
    }

    setTimeout(loop, config.pollIntervalMs);
  };

  setTimeout(loop, config.pollIntervalMs);

  logger.info("Polling started", {
    intervalMs: config.pollIntervalMs,
    maxConcurrency,
  });
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  // Validate critical config before anything else
  if (!config.supabaseUrl) {
    throw new Error(
      "Missing required: POPDAM_SERVER_URL or SUPABASE_URL.\n" +
      "Set one of these in your .env file next to the agent executable."
    );
  }

  logger.info("PopDAM Windows Render Agent starting", {
    nasHost: config.nasHost,
    nasShare: config.nasShare,
    nasMountPath: config.nasMountPath || null,
    renderConcurrency: config.renderConcurrency,
    pollIntervalMs: config.pollIntervalMs,
    paired: config.isPaired,
    rendering: "Sharp + Ghostscript (no Illustrator)",
  });

  // 1. Pair if no agent key — retry with exponential backoff
  if (!config.agentKey) {
    if (!config.pairingCode) {
      throw new Error(
        "No agent key and no pairing code. " +
        "Set POPDAM_SERVER_URL and POPDAM_PAIRING_CODE in your .env, " +
        "or restore %ProgramData%\\PopDAM\\agent-config.json with agent_key."
      );
    }

    const MAX_PAIRING_RETRIES = 5;
    const BASE_DELAY_MS = 3_000; // 3s, 6s, 12s, 24s, 48s

    for (let attempt = 1; attempt <= MAX_PAIRING_RETRIES; attempt++) {
      try {
        logger.info(`Pairing attempt ${attempt}/${MAX_PAIRING_RETRIES}`);
        await doPairing();
        break; // success
      } catch (e) {
        const msg = (e as Error).message;
        const stack = (e as Error).stack;

        if (msg.includes("Invalid or expired")) {
          throw new Error(
            "Pairing code is invalid or expired. " +
            "Generate a new pairing code and update POPDAM_PAIRING_CODE."
          );
        }

        logger.error(`Pairing attempt ${attempt} failed`, {
          error: msg,
          stack,
          attempt,
          maxRetries: MAX_PAIRING_RETRIES,
        });

        if (attempt === MAX_PAIRING_RETRIES) {
          throw new Error(
            `Pairing failed after ${MAX_PAIRING_RETRIES} attempts. ` +
            "Likely causes: server URL unreachable, pairing expired, or outbound HTTPS blocked."
          );
        }

        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.info(`Retrying pairing in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // 2. Register with cloud (if not already registered via pairing)
  if (!agentId) {
    if (config.savedAgentId) {
      agentId = config.savedAgentId;
      logger.info("Using saved agent ID", { agentId });
    } else {
      try {
        agentId = await api.register(config.agentName);
        logger.info("Registered with cloud API", { agentId });
      } catch (e) {
        throw new Error(`Failed to register with cloud API: ${(e as Error).message}`);
      }
    }
  }

  // 3. First heartbeat — fetch cloud config before processing
  try {
    const initialResponse = await api.heartbeat(agentId, undefined, healthStatus);
    applyCloudConfig(initialResponse);
    logger.info("Initial cloud config applied", {
      nasHost: cloudNasHost,
      nasShare: cloudNasShare,
      spacesBucket: cloudSpacesBucket,
    });
  } catch (e) {
    logger.warn("Initial heartbeat failed — will retry on timer", { error: (e as Error).message });
  }

  // Start heartbeat early
  startHeartbeat();

  if (!cloudNasHost) {
    logger.warn(
      "NAS_HOST not configured. Set it in PopDAM Settings → Windows Agent. " +
      "Render jobs will be skipped until configured."
    );
  }

  // 4. Post-restart health check (handles rollback if update failed)
  await postRestartHealthCheck(agentId);

  // 5. Run preflight health checks
  await runHealthCheck();

  // 6. Start polling for render jobs (guarded by health check)
  startPolling();

  // 7. Start periodic preflight re-check for unhealthy agents
  startPreflightRecheck();

  // 8. Initialize self-updater
  initUpdater({
    getActiveJobs: () => activeJobs,
    agentId,
  });

  // 9. Start TIFF job polling
  startTiffPolling();

  // 10. Check for TIFF scan requests periodically
  startTiffScanChecker();

  // 11. Start date re-inspection polling for already-processed TIFFs
  startTiffReinspectPolling();

  // 12. Start temp janitor (cleanup stale render artifacts)
  startJanitor();

  // 13. Start hygiene scan checker (AI raster inspection)
  startHygieneScanChecker();

  logger.info("Windows Render Agent ready", {
    healthy: healthStatus.healthy,
    concurrency: config.renderConcurrency,
    version: config.version,
  });
}

// ── TIFF Scan Request Checker ───────────────────────────────────

let tiffScanRunning = false;

function startTiffScanChecker() {
  const TIFF_SCAN_CHECK_MS = 30_000;

  const loop = async () => {
    if (!configReceived || !healthStatus.healthy || tiffScanRunning) {
      setTimeout(loop, TIFF_SCAN_CHECK_MS);
      return;
    }

    try {
      const resp = await api.callApi("claim-tiff-scan", {});
      const reqValue = (resp?.request as Record<string, unknown> | null) ?? null;
      if (!reqValue) {
        setTimeout(loop, TIFF_SCAN_CHECK_MS);
        return;
      }

      tiffScanRunning = true;
      const sessionId = reqValue.request_id || crypto.randomUUID();
      logger.info("Starting TIFF filesystem scan", { sessionId });

      // Ensure NAS is mapped/authenticated before scanning
      const nasMapResult = await ensureNasMapped(cloudNasMountPath, {
        host: cloudNasHost,
        share: cloudNasShare,
        username: cloudNasUsername,
        password: cloudNasPassword,
      });

      if (!nasMapResult.ok) {
        logger.error("TIFF scan aborted — NAS not accessible", {
          error: nasMapResult.error,
          mountPath: cloudNasMountPath || "(UNC mode)",
          nasHost: cloudNasHost,
          nasShare: cloudNasShare,
        });
        await api.callApi("report-tiff-scan", {
          files: [],
          session_id: sessionId,
          done: true,
          error: nasMapResult.error,
        });
        tiffScanRunning = false;
        setTimeout(loop, TIFF_SCAN_CHECK_MS);
        return;
      }

      const mountPath = (cloudNasMountPath || "").trim().replace(/\\+$/, "");
      const scanRoot = mountPath || `\\\\${cloudNasHost}\\${cloudNasShare}`;

      logger.info("TIFF scan root resolved", { scanRoot, sessionId });

      await api.callApi("report-tiff-scan", {
        files: [],
        session_id: sessionId,
        done: false,
        status: "claimed",
      });

      const batch: TiffScanResult[] = [];
      const BATCH_SIZE = 100;
      let totalFound = 0;
      let dirsScanned = 0;
      let currentDir = "";
      const scanStarted = Date.now();

      for await (const file of scanTiffFiles(scanRoot, scanRoot, {
        onProgress: (dir?: string) => { dirsScanned++; if (dir) currentDir = dir; },
      })) {
        batch.push(file);
        totalFound++;

        if (batch.length >= BATCH_SIZE) {
          await api.callApi("report-tiff-scan", {
            files: batch,
            session_id: sessionId,
            done: false,
            progress: {
              dirs_scanned: dirsScanned,
              files_found: totalFound,
              current_dir: currentDir,
              elapsed_ms: Date.now() - scanStarted,
            },
          });
          batch.length = 0;
        }
      }

      await api.callApi("report-tiff-scan", {
        files: batch,
        session_id: sessionId,
        done: true,
        progress: {
          dirs_scanned: dirsScanned,
          files_found: totalFound,
          elapsed_ms: Date.now() - scanStarted,
        },
      });

      logger.info("TIFF scan complete", { totalFound, dirsScanned, sessionId });
    } catch (e) {
      logger.error("TIFF scan failed", { error: (e as Error).message });
    } finally {
      tiffScanRunning = false;
    }

    setTimeout(loop, TIFF_SCAN_CHECK_MS);
  };

  setTimeout(loop, TIFF_SCAN_CHECK_MS);
}

// ── TIFF Job Polling ────────────────────────────────────────────

function startTiffPolling() {
  const TIFF_POLL_MS = 5_000;

  const loop = async () => {
    if (!configReceived || !healthStatus.healthy || tiffScanRunning) {
      setTimeout(loop, TIFF_POLL_MS);
      return;
    }

    try {
      const resp = await api.callApi("claim-tiff-job", {
        agent_id: agentId,
        batch_size: 1,
      });

      const jobs = resp?.jobs as Array<Record<string, unknown>>;
      if (jobs && jobs.length > 0) {
        for (const job of jobs) {
          const jobId = job.id as string;
          const relativePath = job.relative_path as string;
          const mode = job.mode as "test" | "process";
          const fileModifiedAt = new Date(job.file_modified_at as string);
          const fileCreatedAt = job.file_created_at ? new Date(job.file_created_at as string) : null;

          logger.info("Processing TIFF job", { jobId, relativePath, mode });

          // Centralized path exclusion check
          if (shouldSkipPath(relativePath, logger.warn)) {
            logger.info("Skipping excluded TIFF path", { jobId, relativePath });
            await api.callApi("complete-tiff-job", {
              job_id: jobId,
              success: false,
              error: "Skipped: excluded by path filter",
            });
            continue;
          }

          const filePath = toUncPath(relativePath);

          try {
            const result = await compressTiff(filePath, mode, fileModifiedAt, fileCreatedAt, jobId);

            await api.callApi("complete-tiff-job", {
              job_id: jobId,
              success: result.success,
              error: result.error,
              error_code: result.error_code,
              new_file_size: result.new_file_size,
              new_filename: result.new_filename,
              new_file_modified_at: result.new_file_modified_at,
              new_file_created_at: result.new_file_created_at,
              original_backed_up: result.original_backed_up,
              original_deleted: result.original_deleted,
              timestamp_restore_status: result.timestamp_restore_status,
              creation_time_restored: result.creation_time_restored,
              mtime_restored: result.mtime_restored,
              verification_details: result.verification_details,
            });

            if (result.success) {
              logger.info("TIFF job completed", {
                jobId, mode, newSize: result.new_file_size,
                timestamp_restore_status: result.timestamp_restore_status,
                mtime_restored: result.mtime_restored,
                creation_time_restored: result.creation_time_restored,
              });
            } else {
              logger.warn("TIFF job failed", {
                jobId, error: result.error, error_code: result.error_code,
                timestamp_restore_status: result.timestamp_restore_status,
              });
            }
          } catch (e) {
            logger.error("TIFF job error", { jobId, error: (e as Error).message });
            await api.callApi("complete-tiff-job", {
              job_id: jobId,
              success: false,
              error: (e as Error).message,
            }).catch(() => {});
          }
        }
      }
    } catch (e) {
      if (!(e as Error).message?.includes("Unknown action")) {
        logger.debug("TIFF poll error", { error: (e as Error).message });
      }
    }

    setTimeout(loop, TIFF_POLL_MS);
  };

  setTimeout(loop, TIFF_POLL_MS);
  logger.info("TIFF job polling started (5s interval)");
}

function startTiffReinspectPolling() {
  const REINSPECT_POLL_MS = 7_000;

  const loop = async () => {
    if (!configReceived || !healthStatus.healthy || tiffScanRunning) {
      setTimeout(loop, REINSPECT_POLL_MS);
      return;
    }

    try {
      const resp = await api.callApi("claim-tiff-reinspect", {
        agent_id: agentId,
        batch_size: 50,
      });

      const jobs = (resp?.jobs as Array<Record<string, unknown>> | undefined) ?? [];
      if (jobs.length === 0) {
        setTimeout(loop, REINSPECT_POLL_MS);
        return;
      }

      // Ensure NAS is mapped/authenticated before reading timestamps
      const nasMapResult = await ensureNasMapped(cloudNasMountPath, {
        host: cloudNasHost,
        share: cloudNasShare,
        username: cloudNasUsername,
        password: cloudNasPassword,
      });

      if (!nasMapResult.ok) {
        const msg = `Re-inspection aborted — NAS not accessible: ${nasMapResult.error}`;
        logger.error(msg);
        for (const job of jobs) {
          await api.callApi("complete-tiff-reinspect", {
            job_id: job.id,
            success: false,
            error: msg,
          }).catch(() => {});
        }
        setTimeout(loop, REINSPECT_POLL_MS);
        return;
      }

      for (const job of jobs) {
        const jobId = job.id as string;
        const relativePath = job.relative_path as string;

        if (shouldSkipPath(relativePath, logger.warn)) {
          await api.callApi("complete-tiff-reinspect", {
            job_id: jobId,
            success: false,
            error: "Skipped: excluded by path filter",
          }).catch(() => {});
          continue;
        }

        const filePath = toUncPath(relativePath);
        try {
          const ts = await captureTimestamps(filePath, jobId);
          await api.callApi("complete-tiff-reinspect", {
            job_id: jobId,
            success: true,
            new_file_modified_at: ts.mtime.toISOString(),
            new_file_created_at: ts.creationTime?.toISOString() ?? null,
          });
        } catch (e) {
          await api.callApi("complete-tiff-reinspect", {
            job_id: jobId,
            success: false,
            error: (e as Error).message,
          }).catch(() => {});
        }
      }
    } catch (e) {
      if (!(e as Error).message?.includes("Unknown action")) {
        logger.debug("TIFF re-inspection poll error", { error: (e as Error).message });
      }
    }

    setTimeout(loop, REINSPECT_POLL_MS);
  };

  setTimeout(loop, REINSPECT_POLL_MS);
  logger.info("TIFF date re-inspection polling started (7s interval)");
}

// ── Hygiene Scan Checker (AI Raster Inspection) ─────────────────

let hygieneScanRunning = false;

function startHygieneScanChecker() {
  const CHECK_MS = 30_000;

  const loop = async () => {
    if (!configReceived || !healthStatus.healthy || hygieneScanRunning) {
      setTimeout(loop, CHECK_MS);
      return;
    }

    try {
      const resp = await api.callApi("claim-hygiene-scan", {});
      const reqValue = (resp?.request as Record<string, unknown> | null) ?? null;
      if (!reqValue) {
        setTimeout(loop, CHECK_MS);
        return;
      }

      hygieneScanRunning = true;
      const sessionId = (reqValue.request_id as string) || crypto.randomUUID();
      const checkTypes = (reqValue.check_types as string[]) || ["ai_embedded_raster"];
      logger.info("Starting hygiene scan", { sessionId, checkTypes });

      const nasMapResult = await ensureNasMapped(cloudNasMountPath, {
        host: cloudNasHost, share: cloudNasShare,
        username: cloudNasUsername, password: cloudNasPassword,
      });

      if (!nasMapResult.ok) {
        logger.error("Hygiene scan aborted — NAS not accessible", { error: nasMapResult.error });
        await api.callApi("report-hygiene-findings", {
          findings: [], session_id: sessionId, done: true, error: nasMapResult.error,
        });
        hygieneScanRunning = false;
        setTimeout(loop, CHECK_MS);
        return;
      }

      const mountPath = (cloudNasMountPath || "").trim().replace(/\\+$/, "");
      const scanRoot = mountPath || `\\\\${cloudNasHost}\\${cloudNasShare}`;

      // Walk filesystem looking for .ai files
      const { readdir, stat: fsStat } = await import("node:fs/promises");
      const findings: Array<Record<string, unknown>> = [];
      const BATCH_SIZE = 50;
      let totalChecked = 0;
      let totalDirs = 0;
      let totalSkipped = 0;
      let totalErrors = 0;
      let currentFile = "";
      let cancelled = false;
      const scanStarted = Date.now();

      function makeProgress() {
        return {
          files_checked: totalChecked,
          dirs_scanned: totalDirs,
          findings_count: findings.length,
          current_file: currentFile,
          elapsed_ms: Date.now() - scanStarted,
          errors: totalErrors,
          skipped: totalSkipped,
        };
      }

      async function walkDir(dir: string) {
        if (cancelled) return;
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) {
          totalSkipped++;
          logger.debug("Hygiene scan: dir unreadable", { dir, error: (e as Error).message });
          return;
        }
        totalDirs++;

        for (const entry of entries) {
          if (cancelled) return;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (shouldSkipPath(entry.name, () => {})) continue;
            await walkDir(fullPath);
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".ai")) {
            const relativePath = fullPath.slice(scanRoot.length).replace(/\\/g, "/").replace(/^\//, "");
            if (shouldSkipPath(relativePath, () => {})) continue;

            totalChecked++;
            currentFile = relativePath;
            try {
              const result = await inspectAiFile(fullPath);
              if (result.exceedsThreshold) {
                findings.push({
                  relative_path: relativePath,
                  filename: entry.name,
                  check_type: "ai_embedded_raster",
                  severity: result.totalEmbeddedBytes > 20 * 1024 * 1024 ? "critical" : "warning",
                  details: {
                    embedded_count: result.embeddedCount,
                    total_embedded_bytes: result.totalEmbeddedBytes,
                    largest_raster_bytes: result.largestRasterBytes,
                    inspection_method: result.inspectionMethod,
                    raster_items: result.rasterItems.slice(0, 10),
                  },
                });

                if (findings.length >= BATCH_SIZE) {
                  const resp = await api.callApi("report-hygiene-findings", {
                    findings, session_id: sessionId, done: false,
                    progress: makeProgress(),
                  });
                  if (resp?.cancelled) { cancelled = true; return; }
                  findings.length = 0;
                }
              }

              // Report progress every 5 files (more frequent updates)
              if (totalChecked % 5 === 0) {
                const resp = await api.callApi("report-hygiene-findings", {
                  findings: [], session_id: sessionId, done: false,
                  progress: makeProgress(),
                });
                if (resp?.cancelled) { cancelled = true; return; }
              }
            } catch (e) {
              totalErrors++;
              logger.debug("AI inspection error", { file: relativePath, error: (e as Error).message });
            }
          }
        }
      }

      await walkDir(scanRoot);

      await api.callApi("report-hygiene-findings", {
        findings, session_id: sessionId, done: true,
        progress: makeProgress(),
        ...(cancelled ? { error: "Scan cancelled by user" } : {}),
      });

      logger.info(cancelled ? "Hygiene scan cancelled by user" : "Hygiene scan complete", {
        totalChecked, totalErrors, findingsReported: findings.length, sessionId,
      });
    } catch (e) {
      logger.error("Hygiene scan failed", { error: (e as Error).message });
    } finally {
      hygieneScanRunning = false;
    }

    setTimeout(loop, CHECK_MS);
  };

  setTimeout(loop, CHECK_MS);
  logger.info("Hygiene scan checker started (30s interval)");
}

// ── Global error handlers ────────────────────────────────────────

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception — restarting agent to recover", {
    error: err.message,
    stack: err.stack,
  });
  // Exit with restart code so launcher.bat restarts us immediately
  process.exit(RESTART_EXIT_CODE);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error("Unhandled promise rejection (process will continue)", {
    error: msg,
    stack,
  });
});

// ── Startup with resilient retry (no launcher crash-loop) ──────

const MAIN_RETRY_BASE_MS = 10_000; // backoff base
const MAIN_RETRY_MAX_MS = 300_000; // cap at 5 minutes

// ── Multi-tenant entry: if TENANTS env is set and we are NOT a child, run supervisor ──
import { parseTenants, runSupervisor } from "./tenant-supervisor";

(async () => {
  if (!process.env.POPDAM_TENANT_CHILD) {
    let tenants;
    try {
      tenants = parseTenants();
    } catch (e) {
      logger.error("Invalid TENANTS configuration — exiting", { error: (e as Error).message });
      process.exit(1);
    }
    if (tenants && tenants.length > 0) {
      runSupervisor(tenants);
      return; // supervisor manages children
    }
  } else {
    logger.info("Running as tenant child", {
      tenant: process.env.POPDAM_TENANT_NAME,
      configFile: process.env.POPDAM_DATA_FILE,
    });
  }

  // Single-tenant fallback (legacy behavior) with resilient retry
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      await main();
      return;
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`main() failed (attempt ${attempt})`, {
        error: msg,
        stack: (e as Error).stack,
      });

      const likelyConfigIssue =
        msg.includes("No agent key and no pairing code") ||
        msg.includes("invalid or expired") ||
        msg.includes("Missing required: POPDAM_SERVER_URL or SUPABASE_URL");

      const delay = likelyConfigIssue
        ? 60_000
        : Math.min(MAIN_RETRY_MAX_MS, MAIN_RETRY_BASE_MS * Math.pow(2, Math.min(attempt - 1, 8)));

      logger.warn("Startup blocked; agent will retry automatically (process stays alive)", {
        retryInSeconds: Math.round(delay / 1000),
        likelyConfigIssue,
      });

      await new Promise((r) => setTimeout(r, delay));
    }
  }
})();
