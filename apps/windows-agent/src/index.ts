/**
 * PopDAM Windows Render Agent — Main Entry Point
 *
 * Lifecycle:
 *   1. Check for agent key — if missing, bootstrap with one-time token
 *   2. Register with cloud API as agent_type = 'windows-render'
 *   3. Run preflight health checks (NAS + Illustrator)
 *   4. Start heartbeat timer (every 30s)
 *   5. Poll render_queue for pending jobs (every 3s, up to N concurrent)
 *      — only if healthy
 *
 * Per PROJECT_BIBLE §1C: Optional Muscle #2 for AI files that can't be
 * thumbnailed reliably on NAS.
 */

import { config } from "./config";
import { logger } from "./logger";
import * as api from "./api-client";
import { renderFile } from "./renderer";
import { uploadThumbnail, reinitializeS3Client } from "./uploader";
import { runPreflight, type HealthStatus } from "./preflight";
import { getCircuitBreakerStatus } from "./circuit-breaker";
import { initUpdater, postRestartHealthCheck, getUpdateState, triggerImmediateUpdate } from "./updater";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

// ── Session detection ───────────────────────────────────────────

/**
 * Detect whether this process is running in a non-interactive session
 * (e.g. a Windows Service via NSSM). Illustrator COM requires an
 * interactive desktop session to function.
 *
 * Detection heuristics:
 *   1. Session 0 isolation: services run in session 0 on Vista+
 *   2. No explorer.exe in current session (no desktop shell)
 */
async function isNonInteractiveSession(): Promise<boolean> {
  try {
    // Query current session ID via environment or process info
    const sessionId = process.env.SESSIONNAME;
    // Services typically have SESSIONNAME unset or "Services"
    if (sessionId === "Services" || sessionId === "") {
      return true;
    }

    // Check if we're in session 0 (services session on Vista+)
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "[System.Diagnostics.Process]::GetCurrentProcess().SessionId",
    ], { timeout: 5_000, windowsHide: true });

    const sid = parseInt(stdout.trim(), 10);
    if (sid === 0) {
      return true;
    }

    return false;
  } catch {
    // If we can't determine, assume interactive (don't block on detection failure)
    logger.warn("Could not detect session type — assuming interactive");
    return false;
  }
}

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
  illustratorHealthy: false,
  illustratorCrashDialog: false,
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
  // directly — Sharp and Ghostscript can't read UNC paths
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
    // nas_mount_path can be empty string (meaning "use UNC"), so always apply if present
    if (wa.nas_mount_path !== undefined) cloudNasMountPath = wa.nas_mount_path;

    // If NAS config changed, re-run preflight
    if (cloudNasMountPath !== oldMountPath || cloudNasHost !== oldHost || cloudNasShare !== oldShare) {
      logger.info("NAS config changed via heartbeat — re-running preflight");
      await runHealthCheck();
    }
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
  if (cloudNasHost && cloudSpacesKey && cloudSpacesSecret) {
    configReceived = true;
  }
}

function startHeartbeat() {
  setInterval(async () => {
    try {
      const cbStatus = getCircuitBreakerStatus();
      const updateState = getUpdateState();
      const enrichedHealth: api.AgentHealthPayload = {
        ...healthStatus,
        ...(cbStatus.illustratorCircuitBreaker === "open"
          ? {
              lastPreflightError: [
                healthStatus.lastPreflightError,
                `Illustrator circuit breaker OPEN — cooldown active until ${cbStatus.cooldownUntil} (${cbStatus.consecutiveFailures} consecutive failures)`,
              ].filter(Boolean).join("; "),
            }
          : {}),
      };
      const response = await api.heartbeat(agentId, lastError, enrichedHealth, {
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

      logger.debug("Heartbeat sent", { circuitBreaker: cbStatus.illustratorCircuitBreaker });
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
  // Skip files in __MACOSX directories (macOS zip artifacts)
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
        illustratorHealthy: healthStatus.illustratorHealthy,
      });
      return;
    }

    // Fill all available slots
    while (activeJobs < maxConcurrency) {
      try {
        const job = await api.claimRender(agentId);
        if (!job) {
          // No more jobs available
          if (activeJobs === 0) logger.debug("No render jobs available");
          break;
        }
        if (!job.relative_path) {
          logger.error("Claimed job missing relative_path", { jobId: job.job_id });
          await api.completeRender(job.job_id, false, undefined, "Asset missing relative_path");
          continue;
        }

        activeJobs++;
        // Fire and forget — don't await, let it run concurrently
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
  // 0. Detect non-interactive session (Service mode)
  const nonInteractive = await isNonInteractiveSession();
  if (nonInteractive) {
    logger.error(
      "╔══════════════════════════════════════════════════════════════╗\n" +
      "║  FATAL: Non-interactive session detected (Windows Service)  ║\n" +
      "║                                                              ║\n" +
      "║  Adobe Illustrator COM automation requires an interactive    ║\n" +
      "║  desktop session. The agent CANNOT render files in service   ║\n" +
      "║  mode (Session 0).                                           ║\n" +
      "║                                                              ║\n" +
      "║  FIX: Install as a Scheduled Task instead:                   ║\n" +
      "║    1. Run: scripts\\uninstall-service.ps1                     ║\n" +
      "║    2. Run: scripts\\install-scheduled-task.ps1                ║\n" +
      "║                                                              ║\n" +
      "║  The agent will continue running but will NOT claim jobs.    ║\n" +
      "╚══════════════════════════════════════════════════════════════╝"
    );
    healthStatus = {
      healthy: false,
      nasHealthy: false,
      illustratorHealthy: false,
      illustratorCrashDialog: false,
      lastPreflightError: "NON_INTERACTIVE_SESSION: Illustrator COM requires interactive desktop session. Reinstall as Scheduled Task.",
      lastPreflightAt: new Date().toISOString(),
    };
  }

  logger.info("PopDAM Windows Render Agent starting", {
    nasHost: config.nasHost,
    nasShare: config.nasShare,
    nasMountPath: config.nasMountPath || null,
    renderConcurrency: config.renderConcurrency,
    pollIntervalMs: config.pollIntervalMs,
    interactiveSession: !nonInteractive,
    paired: config.isPaired,
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

  // Start heartbeat early so cloud sees session error even if we skip preflight
  startHeartbeat();

  // If non-interactive, skip preflight/polling — heartbeat keeps reporting the error
  if (nonInteractive) {
    logger.warn("Agent will idle in non-interactive mode — heartbeat active, no jobs claimed.");
    startPreflightRecheck(); // will keep retrying but session won't change
    return;
  }

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

  logger.info("Windows Render Agent ready", {
    healthy: healthStatus.healthy,
    concurrency: config.renderConcurrency,
    version: config.version,
  });
}

main().catch((e) => {
  logger.error("Fatal error", { error: (e as Error).message });
  process.exit(1);
});
