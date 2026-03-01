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
 * Rendering uses Sharp + Ghostscript (no Illustrator dependency).
 */

import { config } from "./config";
import { logger } from "./logger";
import * as api from "./api-client";
import { renderFile } from "./renderer";
import { uploadThumbnail, reinitializeS3Client } from "./uploader";
import { runPreflight, type HealthStatus } from "./preflight";
import { initUpdater, postRestartHealthCheck, getUpdateState, triggerImmediateUpdate } from "./updater";
import { scanTiffFiles, compressTiff, deleteOriginalBackup, type TiffScanResult } from "./tiff-optimizer";
import path from "node:path";
import { writeFile } from "node:fs/promises";

// ── State ───────────────────────────────────────────────────────

let agentId: string = "";
let activeJobs = 0;
let lastError: string | undefined;
let jobsCompleted = 0;
let jobsFailed = 0;
let configReceived = false;

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
let cloudSpacesBucket = config.doSpacesBucket;
let cloudSpacesRegion = config.doSpacesRegion;
let cloudSpacesEndpoint = config.doSpacesEndpoint;
let cloudSpacesKey = config.doSpacesKey;
let cloudSpacesSecret = config.doSpacesSecret;
let cloudNasUsername = "";
let cloudNasPassword = "";

// ── Pairing ─────────────────────────────────────────────────────

async function doPairing() {
  logger.info("No agent key found — pairing with cloud using pairing code");

  const result = await api.pair(config.pairingCode, config.agentName);

  // Persist agent config to %ProgramData%\PopDAM\agent-config.json
  const configData = {
    agent_id: result.agent_id,
    agent_key: result.agent_key,
    paired_at: new Date().toISOString(),
  };

  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(config.agentConfigDir, { recursive: true });
    await writeFile(config.agentConfigPath, JSON.stringify(configData, null, 2), "utf-8");
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
  setInterval(async () => {
    if (!healthStatus.healthy) {
      logger.info("Re-running preflight (currently unhealthy)...");
      await runHealthCheck();
    }
  }, PREFLIGHT_RECHECK_MS);
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
}

function startHeartbeat() {
  setInterval(async () => {
    try {
      const updateState = getUpdateState();
      const response = await api.heartbeat(agentId, lastError, healthStatus, {
        version: config.version,
        update_available: updateState.updateAvailable,
        latest_version: updateState.latestVersion,
        last_update_check: updateState.lastCheckAt,
        updating: updateState.updating,
        update_error: updateState.lastError,
      });
      applyCloudConfig(response);

      // Check if cloud requests immediate update
      if (response.commands?.trigger_update) {
        logger.info("Cloud requested immediate update check");
        triggerImmediateUpdate(agentId).catch((e) =>
          logger.error("Triggered update failed", { error: (e as Error).message })
        );
      }

      logger.debug("Heartbeat sent");
    } catch (e) {
      logger.error("Heartbeat failed", { error: (e as Error).message });
    }
  }, 30_000);
  logger.info("Heartbeat started (30s interval)");
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

  const filename = path.basename(job.relative_path);

  // Skip macOS resource forks
  if (filename.startsWith('._')) {
    logger.info("Skipping macOS resource fork", { relativePath: job.relative_path });
    await api.completeRender(job.job_id, false, undefined, "Skipped: macOS resource fork");
    return;
  }
  // Skip macOS system files
  if (filename === '.DS_Store' || filename === '.localized') {
    logger.info("Skipping macOS system file", { relativePath: job.relative_path });
    await api.completeRender(job.job_id, false, undefined, "Skipped: macOS system file");
    return;
  }
  // Skip Windows system files
  if (filename === 'Thumbs.db' || filename === 'desktop.ini') {
    logger.info("Skipping Windows system file", { relativePath: job.relative_path });
    await api.completeRender(job.job_id, false, undefined, "Skipped: Windows system file");
    return;
  }
  // Skip files in __MACOSX directories
  if (job.relative_path.includes('__MACOSX/') ||
      job.relative_path.includes('__MACOSX\\')) {
    logger.info("Skipping __MACOSX artifact", { relativePath: job.relative_path });
    await api.completeRender(job.job_id, false, undefined, "Skipped: __MACOSX artifact");
    return;
  }
  // Skip temp/autosave files
  if (filename.startsWith('~')) {
    logger.info("Skipping temp file", { relativePath: job.relative_path });
    await api.completeRender(job.job_id, false, undefined, "Skipped: temp/autosave file");
    return;
  }

  try {
    const fileType = (job.file_type === "psd") ? "psd" : "ai" as const;
    const result = await renderFile(uncPath, fileType);
    const thumbnailUrl = await uploadThumbnail(job.asset_id, result.buffer);
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

// ── Concurrent polling loop ─────────────────────────────────────

function startPolling() {
  const maxConcurrency = config.renderConcurrency;

  setInterval(async () => {
    if (!configReceived) {
      logger.debug("Skipping poll — waiting for cloud config (NAS host + Spaces credentials)");
      return;
    }

    if (!healthStatus.healthy) {
      logger.debug("Skipping poll — agent is unhealthy", {
        nasHealthy: healthStatus.nasHealthy,
      });
      return;
    }

    // Fill all available slots
    while (activeJobs < maxConcurrency) {
      try {
        const job = await api.claimRender(agentId);
        if (!job) {
          if (activeJobs === 0) logger.debug("No render jobs available");
          break;
        }
        if (!job.relative_path) {
          logger.error("Claimed job missing relative_path", { jobId: job.job_id });
          await api.completeRender(job.job_id, false, undefined, "Asset missing relative_path");
          continue;
        }

        activeJobs++;
        processJob(job)
          .catch((e) => logger.error("Uncaught job error", { error: (e as Error).message }))
          .finally(() => { activeJobs--; });
      } catch (e) {
        logger.error("Polling error", { error: (e as Error).message });
        break;
      }
    }
  }, config.pollIntervalMs);

  logger.info("Polling started", {
    intervalMs: config.pollIntervalMs,
    maxConcurrency,
  });
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  logger.info("PopDAM Windows Render Agent starting", {
    nasHost: config.nasHost,
    nasShare: config.nasShare,
    nasMountPath: config.nasMountPath || null,
    renderConcurrency: config.renderConcurrency,
    pollIntervalMs: config.pollIntervalMs,
    paired: config.isPaired,
    rendering: "Sharp + Ghostscript (no Illustrator)",
  });

  // 1. Pair if no agent key
  if (!config.agentKey) {
    if (!config.pairingCode) {
      logger.error(
        "No agent key and no pairing code. Cannot start.\n" +
        "Set POPDAM_SERVER_URL and POPDAM_PAIRING_CODE in your .env.\n" +
        "Generate a pairing code from PopDAM Settings → Agents."
      );
      process.exit(1);
    }
    try {
      await doPairing();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("Invalid or expired")) {
        logger.error(
          "Pairing code is invalid or expired.\n" +
          "Generate a new pairing code from PopDAM Settings → Agents\n" +
          "and update POPDAM_PAIRING_CODE in your .env."
        );
      } else {
        logger.error("Pairing failed — exiting", { error: msg });
      }
      process.exit(1);
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
        logger.error("Failed to register with cloud API — exiting", { error: (e as Error).message });
        process.exit(1);
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

  logger.info("Windows Render Agent ready", {
    healthy: healthStatus.healthy,
    concurrency: config.renderConcurrency,
    version: config.version,
  });
}

// ── TIFF Scan Request Checker ───────────────────────────────────

let tiffScanRunning = false;

function startTiffScanChecker() {
  // Check every heartbeat (30s) if there's a pending TIFF scan request
  setInterval(async () => {
    if (!configReceived || !healthStatus.healthy || tiffScanRunning) return;

    try {
      const resp = await api.callApi("get-config", { keys: ["TIFF_SCAN_REQUEST"] });
      const scanReq = resp?.config?.TIFF_SCAN_REQUEST;
      const reqValue = scanReq?.value ?? scanReq;
      if (!reqValue || reqValue.status !== "pending") return;

      tiffScanRunning = true;
      const sessionId = reqValue.request_id || crypto.randomUUID();
      logger.info("Starting TIFF filesystem scan", { sessionId });

      // Build mount root path
      const mountPath = (cloudNasMountPath || "").trim().replace(/\\+$/, "");
      const scanRoot = mountPath || `\\\\${cloudNasHost}\\${cloudNasShare}`;

      const batch: TiffScanResult[] = [];
      const BATCH_SIZE = 100;
      let totalFound = 0;

      for await (const file of scanTiffFiles(scanRoot, scanRoot)) {
        batch.push(file);
        totalFound++;

        if (batch.length >= BATCH_SIZE) {
          await api.callApi("report-tiff-scan", {
            files: batch,
            session_id: sessionId,
            done: false,
          });
          batch.length = 0;
        }
      }

      // Send remaining + mark done
      await api.callApi("report-tiff-scan", {
        files: batch,
        session_id: sessionId,
        done: true,
      });

      logger.info("TIFF scan complete", { totalFound, sessionId });
    } catch (e) {
      logger.error("TIFF scan failed", { error: (e as Error).message });
    } finally {
      tiffScanRunning = false;
    }
  }, 30_000);
}

// ── TIFF Job Polling ────────────────────────────────────────────

function startTiffPolling() {
  setInterval(async () => {
    if (!configReceived || !healthStatus.healthy || tiffScanRunning) return;

    try {
      const resp = await api.callApi("claim-tiff-job", {
        agent_id: agentId,
        batch_size: 1,
      });

      const jobs = resp?.jobs as Array<Record<string, unknown>>;
      if (!jobs || jobs.length === 0) return;

      for (const job of jobs) {
        const jobId = job.id as string;
        const relativePath = job.relative_path as string;
        const mode = job.mode as "test" | "process";
        const fileModifiedAt = new Date(job.file_modified_at as string);
        const fileCreatedAt = job.file_created_at ? new Date(job.file_created_at as string) : null;

        logger.info("Processing TIFF job", { jobId, relativePath, mode });

        const filePath = toUncPath(relativePath);

        try {
          const result = await compressTiff(filePath, mode, fileModifiedAt, fileCreatedAt);

          await api.callApi("complete-tiff-job", {
            job_id: jobId,
            success: result.success,
            error: result.error,
            new_file_size: result.new_file_size,
            new_filename: result.new_filename,
            new_file_modified_at: result.new_file_modified_at,
            new_file_created_at: result.new_file_created_at,
            original_backed_up: result.original_backed_up,
            original_deleted: result.original_deleted,
          });

          if (result.success) {
            logger.info("TIFF job completed", { jobId, mode, newSize: result.new_file_size });
          } else {
            logger.warn("TIFF job failed", { jobId, error: result.error });
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
    } catch (e) {
      // Silently skip — no jobs available or API error
      if (!(e as Error).message?.includes("Unknown action")) {
        logger.debug("TIFF poll error", { error: (e as Error).message });
      }
    }
  }, 5_000); // poll every 5s

  logger.info("TIFF job polling started (5s interval)");
}

main().catch((e) => {
  logger.error("Fatal error", { error: (e as Error).message });
  process.exit(1);
});
