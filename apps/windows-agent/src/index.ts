/**
 * PopDAM Windows Render Agent — Main Entry Point
 *
 * Lifecycle:
 *   1. Check for agent key — if missing, bootstrap with one-time token
 *   2. Register with cloud API as agent_type = 'windows-render'
 *   3. Start heartbeat timer (every 30s)
 *   4. Poll render_queue for pending jobs (every 3s, up to N concurrent)
 *   5. For each job: Sharp → Ghostscript → Sibling → Illustrator COM
 *
 * Per PROJECT_BIBLE §1C: Optional Muscle #2 for AI files that can't be
 * thumbnailed reliably on NAS.
 */

import { config } from "./config";
import { logger } from "./logger";
import * as api from "./api-client";
import { renderFile } from "./renderer";
import { uploadThumbnail, reinitializeS3Client } from "./uploader";
import path from "node:path";
import { writeFile } from "node:fs/promises";

// ── State ───────────────────────────────────────────────────────

let agentId: string = "";
let activeJobs = 0;
let lastError: string | undefined;
let jobsCompleted = 0;
let jobsFailed = 0;
let configReceived = false;

// ── Cloud config overrides (updated from heartbeat) ─────────────

let cloudNasHost = config.nasHost;
let cloudNasShare = config.nasShare;
let cloudSpacesBucket = config.doSpacesBucket;
let cloudSpacesRegion = config.doSpacesRegion;
let cloudSpacesEndpoint = config.doSpacesEndpoint;
let cloudSpacesKey = config.doSpacesKey;
let cloudSpacesSecret = config.doSpacesSecret;
let cloudNasUsername = "";
let cloudNasPassword = "";

// ── Bootstrap ───────────────────────────────────────────────────

async function bootstrap() {
  logger.info("No agent key found — bootstrapping with install token");

  const result = await api.bootstrap(config.bootstrapToken, config.agentName);

  // Write the returned agent_key to agent-key.cfg next to the executable
  const keyFilePath = path.join(path.dirname(process.execPath), "agent-key.cfg");
  await writeFile(keyFilePath, result.agent_key, "utf-8");

  // Apply to runtime so the rest of startup uses it
  process.env.AGENT_KEY = result.agent_key;
  // Update config object (it reads from env via optional())
  (config as { agentKey: string }).agentKey = result.agent_key;

  agentId = result.agent_id;
  logger.info("Bootstrap complete — agent key saved", { agentId, keyFile: keyFilePath });
}

// ── Path construction ───────────────────────────────────────────

/**
 * Convert a canonical relative_path (POSIX, no leading slash)
 * to a Windows UNC path using NAS_HOST and NAS_SHARE config.
 */
function toUncPath(relativePath: string): string {
  const host = cloudNasHost.replace(/^\\+/, '');
  const share = cloudNasShare.replace(/^\\+/, '').replace(/^\/+/, '');
  const windowsPath = relativePath.replace(/\//g, "\\");
  return `\\\\${host}\\${share}\\${windowsPath}`;
}

// ── Heartbeat ───────────────────────────────────────────────────

async function applyCloudConfig(response: api.WindowsHeartbeatResponse) {
  if (response.config?.windows_agent) {
    const wa = response.config.windows_agent;
    if (wa.nas_host) cloudNasHost = wa.nas_host;
    if (wa.nas_share) cloudNasShare = wa.nas_share;
    if (wa.nas_username) cloudNasUsername = wa.nas_username;
    if (wa.nas_password) cloudNasPassword = wa.nas_password;
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
      const response = await api.heartbeat(agentId, lastError);
      applyCloudConfig(response);
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
    const result = await renderFile(uncPath, fileType, {
      host: cloudNasHost,
      share: cloudNasShare,
      username: cloudNasUsername,
      password: cloudNasPassword,
    });
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
  logger.info("PopDAM Windows Render Agent starting", {
    nasHost: config.nasHost,
    nasShare: config.nasShare,
    renderConcurrency: config.renderConcurrency,
    pollIntervalMs: config.pollIntervalMs,
  });

  // 1. Bootstrap if no agent key
  if (!config.agentKey) {
    if (!config.bootstrapToken) {
      logger.error(
        "No AGENT_KEY and no BOOTSTRAP_TOKEN set. Cannot start. " +
        "Please reinstall and provide a bootstrap token from PopDAM Settings → Windows Agent."
      );
      process.exit(1);
    }
    try {
      await bootstrap();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("Invalid or expired")) {
        logger.error(
          "Bootstrap token is invalid or expired. " +
          "Go to PopDAM Settings → Windows Agent and generate " +
          "a new Install Token, then update BOOTSTRAP_TOKEN in " +
          "C:\\Program Files\\PopDAM\\WindowsAgent\\.env and " +
          "restart the PopDAMWindowsAgent service."
        );
      } else {
        logger.error("Bootstrap failed — exiting", { error: msg });
      }
      process.exit(1);
    }
  }

  // 2. Register with cloud (if not already registered via bootstrap)
  if (!agentId) {
    try {
      agentId = await api.register(config.agentName);
      logger.info("Registered with cloud API", { agentId });
    } catch (e) {
      logger.error("Failed to register with cloud API — exiting", { error: (e as Error).message });
      process.exit(1);
    }
  }

  // 3. First heartbeat — fetch cloud config before processing
  try {
    const initialResponse = await api.heartbeat(agentId, undefined);
    applyCloudConfig(initialResponse);
    logger.info("Initial cloud config applied", {
      nasHost: cloudNasHost,
      nasShare: cloudNasShare,
      spacesBucket: cloudSpacesBucket,
    });
  } catch (e) {
    logger.warn("Initial heartbeat failed — will retry on timer", { error: (e as Error).message });
  }

  if (!cloudNasHost) {
    logger.warn(
      "NAS_HOST not configured. Set it in PopDAM Settings → Windows Agent. " +
      "Render jobs will be skipped until configured."
    );
  }

  // 4. Start heartbeat timer
  startHeartbeat();

  // 5. Start polling for render jobs
  startPolling();

  logger.info("Windows Render Agent ready", {
    concurrency: config.renderConcurrency,
  });
}

main().catch((e) => {
  logger.error("Fatal error", { error: (e as Error).message });
  process.exit(1);
});
