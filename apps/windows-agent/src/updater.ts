/**
 * Windows Render Agent — Self-updater with atomic swap + rollback.
 *
 * Lifecycle:
 *   1. On startup + every 6h, call admin-api get-latest-agent-build
 *   2. If newer version, download to temp, verify checksum
 *   3. Atomic swap: rename current → .old, move new → current
 *   4. Restart: spawn new process and exit
 *   5. If new process fails health within 60s, rollback .old → current
 *
 * Constraints:
 *   - Never updates while rendering (waits for idle)
 *   - Does not require admin interaction
 */

import { config } from "./config";
import { logger } from "./logger";
import * as api from "./api-client";
import { createWriteStream, existsSync, renameSync, unlinkSync, statSync } from "node:fs";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

// ── Types ───────────────────────────────────────────────────────────

export interface UpdateInfo {
  latest_version: string;
  download_url: string;
  checksum_sha256: string;
  release_notes?: string;
  published_at?: string;
}

export interface UpdateState {
  updateAvailable: boolean;
  latestVersion: string | null;
  lastCheckAt: string | null;
  updating: boolean;
  lastError: string | null;
}

// ── Module state ────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const HEALTH_CHECK_TIMEOUT_MS = 60_000;

let state: UpdateState = {
  updateAvailable: false,
  latestVersion: null,
  lastCheckAt: null,
  updating: false,
  lastError: null,
};

let activeJobsRef: () => number = () => 0;
let checkTimer: ReturnType<typeof setInterval> | null = null;

// ── Public API ──────────────────────────────────────────────────────

export function getUpdateState(): UpdateState {
  return { ...state };
}

export function initUpdater(opts: {
  getActiveJobs: () => number;
  agentId: string;
}) {
  activeJobsRef = opts.getActiveJobs;

  // Initial check after 30s (let agent settle first)
  setTimeout(() => checkForUpdate(opts.agentId), 30_000);

  // Periodic check every 6 hours
  checkTimer = setInterval(() => checkForUpdate(opts.agentId), CHECK_INTERVAL_MS);

  logger.info("Self-updater initialized", { checkIntervalHours: 6 });
}

export async function triggerImmediateUpdate(agentId: string): Promise<void> {
  await checkForUpdate(agentId, true);
}

// ── Version comparison ──────────────────────────────────────────────

function parseVersion(v: string): number[] {
  return v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

// ── Check + download + swap ─────────────────────────────────────────

async function checkForUpdate(agentId: string, forceApply = false): Promise<void> {
  if (state.updating) {
    logger.debug("Update already in progress, skipping check");
    return;
  }

  try {
    logger.info("Checking for updates...");
    const info = await api.getLatestBuild();

    state.lastCheckAt = new Date().toISOString();
    state.latestVersion = info.latest_version;

    const currentVersion = config.version;
    const newer = isNewer(info.latest_version, currentVersion);

    state.updateAvailable = newer;

    if (!newer && !forceApply) {
      logger.info("Already on latest version", {
        current: currentVersion,
        latest: info.latest_version,
      });
      return;
    }

    if (newer) {
      logger.info("Update available", {
        current: currentVersion,
        latest: info.latest_version,
      });
    }

    // Wait for idle (no active render jobs)
    if (activeJobsRef() > 0) {
      logger.info("Deferring update — render jobs active", {
        activeJobs: activeJobsRef(),
      });
      // Schedule retry in 30s
      setTimeout(() => checkForUpdate(agentId, forceApply), 30_000);
      return;
    }

    await applyUpdate(info, agentId);
  } catch (e) {
    const msg = (e as Error).message;
    state.lastError = msg;
    logger.error("Update check failed", { error: msg });
  }
}

async function applyUpdate(info: UpdateInfo, agentId: string): Promise<void> {
  state.updating = true;
  state.lastError = null;

  const exePath = process.execPath;
  const exeDir = path.dirname(exePath);
  const exeName = path.basename(exePath);
  const tempPath = path.join(exeDir, `${exeName}.new`);
  const oldPath = path.join(exeDir, `${exeName}.old`);

  try {
    // 1. Download to temp
    logger.info("Downloading update...", { url: info.download_url });
    const res = await fetch(info.download_url);
    if (!res.ok || !res.body) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    }

    const ws = createWriteStream(tempPath);
    // Convert web ReadableStream to Node stream
    const nodeStream = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
    await pipeline(nodeStream, ws);

    // 2. Verify checksum
    if (info.checksum_sha256) {
      logger.info("Verifying checksum...");
      const fileBuffer = await readFile(tempPath);
      const hash = createHash("sha256").update(fileBuffer).digest("hex");
      if (hash !== info.checksum_sha256) {
        throw new Error(
          `Checksum mismatch: expected ${info.checksum_sha256}, got ${hash}`
        );
      }
      logger.info("Checksum verified");
    }

    // 3. Atomic swap
    logger.info("Performing atomic swap...");

    // Remove stale .old if exists
    if (existsSync(oldPath)) {
      try { unlinkSync(oldPath); } catch { /* ok */ }
    }

    // Rename current → .old
    renameSync(exePath, oldPath);

    // Move new → current
    renameSync(tempPath, exePath);

    logger.info("Swap complete, saving update state...");

    // 4. Save rollback info
    const rollbackInfo = {
      old_path: oldPath,
      new_version: info.latest_version,
      old_version: config.version,
      swapped_at: new Date().toISOString(),
      agent_id: agentId,
    };
    await mkdir(config.agentConfigDir, { recursive: true });
    await writeFile(
      path.join(config.agentConfigDir, "rollback-info.json"),
      JSON.stringify(rollbackInfo, null, 2),
      "utf-8"
    );

    // 5. Report to cloud
    try {
      await api.reportUpdateStatus({
        agent_id: agentId,
        status: "restarting",
        old_version: config.version,
        new_version: info.latest_version,
      });
    } catch { /* best effort */ }

    // 6. Spawn new process and exit
    logger.info("Restarting with new version...");
    const child = spawn(exePath, process.argv.slice(1), {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        POPDAM_PREVIOUS_VERSION: config.version,
        POPDAM_ROLLBACK_PATH: oldPath,
      },
    });
    child.unref();

    // Give the new process a moment to start
    setTimeout(() => process.exit(0), 2_000);
  } catch (e) {
    const msg = (e as Error).message;
    state.lastError = msg;
    state.updating = false;
    logger.error("Update failed", { error: msg });

    // Cleanup temp file
    try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch { /* ok */ }

    // Report failure to cloud
    try {
      await api.reportUpdateStatus({
        agent_id: agentId,
        status: "failed",
        old_version: config.version,
        new_version: info.latest_version,
        error: msg,
      });
    } catch { /* best effort */ }
  }
}

// ── Post-restart health check + rollback ────────────────────────────

export async function postRestartHealthCheck(agentId: string): Promise<void> {
  const previousVersion = process.env.POPDAM_PREVIOUS_VERSION;
  const rollbackPath = process.env.POPDAM_ROLLBACK_PATH;

  if (!previousVersion || !rollbackPath) {
    // Not a post-update restart
    return;
  }

  logger.info("Post-update restart detected", {
    previousVersion,
    currentVersion: config.version,
    rollbackPath,
  });

  // Wait for health check to pass
  const startTime = Date.now();
  let healthy = false;

  while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT_MS) {
    try {
      // Basic health: can we talk to the API?
      await api.heartbeat(agentId);
      healthy = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  if (healthy) {
    logger.info("Post-update health check passed — update successful", {
      newVersion: config.version,
    });

    // Clean up .old binary
    try {
      if (existsSync(rollbackPath)) unlinkSync(rollbackPath);
    } catch { /* ok */ }

    // Report success
    try {
      await api.reportUpdateStatus({
        agent_id: agentId,
        status: "completed",
        old_version: previousVersion,
        new_version: config.version,
      });
    } catch { /* best effort */ }
  } else {
    logger.error("Post-update health check FAILED — rolling back!", {
      rollbackPath,
    });

    // Rollback: swap .old back to current
    try {
      const exePath = process.execPath;
      const failedPath = exePath + ".failed";

      if (existsSync(rollbackPath)) {
        renameSync(exePath, failedPath);
        renameSync(rollbackPath, exePath);

        // Report rollback
        try {
          await api.reportUpdateStatus({
            agent_id: agentId,
            status: "rolled_back",
            old_version: previousVersion,
            new_version: config.version,
            error: "Health check failed within 60s — rolled back to previous version",
          });
        } catch { /* best effort */ }

        // Restart with old binary
        logger.info("Rollback complete — restarting with previous version");
        const child = spawn(exePath, process.argv.slice(1), {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        setTimeout(() => process.exit(1), 2_000);
      } else {
        logger.error("Rollback file not found — cannot rollback", { rollbackPath });
      }
    } catch (e) {
      logger.error("Rollback failed", { error: (e as Error).message });
    }
  }
}
