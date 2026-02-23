/**
 * PopDAM Windows Render Agent — Main Entry Point
 *
 * Lifecycle:
 *   1. Check for agent key — if missing, bootstrap with one-time token
 *   2. Register with cloud API as agent_type = 'windows-render'
 *   3. Start heartbeat timer (every 30s)
 *   4. Poll render_queue for pending jobs (every 30s)
 *   5. For each job: construct UNC path → Illustrator render → upload to Spaces → complete-render
 *
 * Per PROJECT_BIBLE §1C: Optional Muscle #2 for AI files that can't be
 * thumbnailed reliably on NAS.
 */

import { config } from "./config.js";
import { logger } from "./logger.js";
import * as api from "./api-client.js";
import { renderWithIllustrator } from "./illustrator.js";
import { uploadThumbnail } from "./uploader.js";
import path from "node:path";
import { writeFile } from "node:fs/promises";

// ── State ───────────────────────────────────────────────────────

let agentId: string = "";
let isProcessing = false;
let lastError: string | undefined;
let jobsCompleted = 0;
let jobsFailed = 0;

// ── Cloud config overrides (updated from heartbeat) ─────────────

let cloudNasHost = config.nasHost;
let cloudNasShare = config.nasShare;
let cloudSpacesBucket = config.doSpacesBucket;
let cloudSpacesRegion = config.doSpacesRegion;
let cloudSpacesEndpoint = config.doSpacesEndpoint;

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
  const windowsPath = relativePath.replace(/\//g, "\\");
  return `\\\\${cloudNasHost}\\${cloudNasShare}\\${windowsPath}`;
}

// ── Heartbeat ───────────────────────────────────────────────────

async function applyCloudConfig(response: api.WindowsHeartbeatResponse) {
  if (response.config?.windows_agent) {
    const wa = response.config.windows_agent;
    if (wa.nas_host) cloudNasHost = wa.nas_host;
    if (wa.nas_share) cloudNasShare = wa.nas_share;
  }
  if (response.config?.do_spaces) {
    const sp = response.config.do_spaces;
    if (sp.bucket) cloudSpacesBucket = sp.bucket;
    if (sp.region) cloudSpacesRegion = sp.region;
    if (sp.endpoint) cloudSpacesEndpoint = sp.endpoint;
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

  try {
    const result = await renderWithIllustrator(uncPath);
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

// ── Polling loop ────────────────────────────────────────────────

function startPolling() {
  setInterval(async () => {
    if (isProcessing) return;
    try {
      isProcessing = true;
      const job = await api.claimRender(agentId);
      if (!job) { logger.debug("No render jobs available"); return; }
      if (!job.relative_path) {
        logger.error("Claimed job missing relative_path", { jobId: job.job_id });
        await api.completeRender(job.job_id, false, undefined, "Asset missing relative_path");
        return;
      }
      await processJob(job);
    } catch (e) {
      logger.error("Polling error", { error: (e as Error).message });
    } finally {
      isProcessing = false;
    }
  }, config.pollIntervalMs);
  logger.info("Polling started", { intervalMs: config.pollIntervalMs });
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  logger.info("PopDAM Windows Render Agent starting", {
    nasHost: config.nasHost,
    nasShare: config.nasShare,
    dpi: config.illustratorDpi,
    timeoutMs: config.illustratorTimeoutMs,
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
      logger.error("Bootstrap failed — exiting", { error: (e as Error).message });
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

  logger.info("Windows Render Agent ready");
}

main().catch((e) => {
  logger.error("Fatal error", { error: (e as Error).message });
  process.exit(1);
});
