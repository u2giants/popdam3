/**
 * Windows Render Agent — Self-updater with dist/ hot-swap + restart.
 *
 * Lifecycle:
 *   1. On startup + every 6h, call agent-api get-latest-build
 *   2. If newer version, download dist.zip to temp
 *   3. Hot-swap: rename dist/ → dist.old/, extract dist.zip → dist/
 *   4. Restart: re-run the scheduled task (or spawn new process) and exit
 *   5. If new process fails health within 60s, rollback dist.old/ → dist/
 *
 * Constraints:
 *   - Never updates while rendering (waits for idle)
 *   - Does not require admin interaction
 *   - Only replaces dist/ (compiled JS) — node.exe + node_modules stay
 */

import { config } from "./config";
import { logger } from "./logger";
import * as api from "./api-client";
import {
  existsSync, renameSync, unlinkSync, mkdirSync,
  rmSync, createWriteStream, statSync,
} from "node:fs";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
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
export const RESTART_EXIT_CODE = 77;

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

// ── Install directory detection ─────────────────────────────────────

/**
 * The agent is installed at: $INSTDIR/dist/index.js run by $INSTDIR/node.exe
 * So the install root is two levels up from __dirname (dist/).
 */
function getInstallDir(): string {
  // __dirname = .../WindowsAgent/dist
  return path.dirname(__dirname);
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

  const installDir = getInstallDir();
  const distDir = path.join(installDir, "dist");
  const distOldDir = path.join(installDir, "dist.old");
  const distNewDir = path.join(installDir, "dist.new");
  const zipPath = path.join(installDir, "dist-update.zip");

  try {
    // 1. Download dist.zip
    logger.info("Downloading update...", { url: info.download_url });
    const res = await fetch(info.download_url);
    if (!res.ok || !res.body) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    }

    const ws = createWriteStream(zipPath);
    const nodeStream = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
    await pipeline(nodeStream, ws);

    const zipSize = statSync(zipPath).size;
    logger.info("Download complete", { size: `${(zipSize / 1024).toFixed(0)} KB` });

    // 2. Verify checksum (if provided)
    if (info.checksum_sha256) {
      logger.info("Verifying checksum...");
      const fileBuffer = await readFile(zipPath);
      const hash = createHash("sha256").update(fileBuffer).digest("hex");
      if (hash !== info.checksum_sha256) {
        throw new Error(
          `Checksum mismatch: expected ${info.checksum_sha256}, got ${hash}`
        );
      }
      logger.info("Checksum verified");
    }

    // 3. Extract to dist.new/
    logger.info("Extracting update...");
    if (existsSync(distNewDir)) rmSync(distNewDir, { recursive: true });
    mkdirSync(distNewDir, { recursive: true });

    // Use PowerShell to extract (available on all Windows)
    // SilentlyContinue suppresses the blue progress bar that flashes in the console
    execSync(
      `powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Expand-Archive -Path '${zipPath}' -DestinationPath '${distNewDir}' -Force"`,
      { timeout: 30_000 }
    );

    // Verify extraction produced files
    const extractedIndex = path.join(distNewDir, "index.js");
    if (!existsSync(extractedIndex)) {
      // Maybe extracted into a single subdirectory — flatten it
      const { readdirSync } = await import("node:fs");
      const entries = readdirSync(distNewDir);
      if (entries.length === 1) {
        const nestedDir = path.join(distNewDir, entries[0]);
        if (statSync(nestedDir).isDirectory() && existsSync(path.join(nestedDir, "index.js"))) {
          const flatDir = `${distNewDir}.flat`;
          if (existsSync(flatDir)) rmSync(flatDir, { recursive: true });
          renameSync(nestedDir, flatDir);
          rmSync(distNewDir, { recursive: true });
          renameSync(flatDir, distNewDir);
        }
      }
    }

    if (!existsSync(path.join(distNewDir, "index.js"))) {
      throw new Error("Extracted dist.zip does not contain index.js — aborting");
    }

    // 4. Atomic swap: dist → dist.old, dist.new → dist
    logger.info("Performing dist/ swap...");

    if (existsSync(distOldDir)) {
      rmSync(distOldDir, { recursive: true });
    }

    renameSync(distDir, distOldDir);
    renameSync(distNewDir, distDir);

    logger.info("Swap complete");

    // 5. Update package.json version — prefer the stamped copy from dist.zip,
    //    fall back to patching the existing one
    try {
      const pkgPath = path.join(installDir, "package.json");
      const distPkgPath = path.join(distDir, "package.json");
      if (existsSync(distPkgPath)) {
        // dist.zip includes a pre-stamped package.json — copy it to install root
        const { copyFileSync } = await import("node:fs");
        copyFileSync(distPkgPath, pkgPath);
        logger.info("Copied stamped package.json from dist.zip", {
          version: info.latest_version,
        });
      } else {
        // Legacy dist.zip without package.json — patch in place
        const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
        pkg.version = info.latest_version.replace(/^v/, "");
        await writeFile(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
        logger.info("Patched package.json version", { version: info.latest_version });
      }
    } catch (e) {
      logger.warn("Could not update package.json version", { error: (e as Error).message });
    }

    // 6. Save rollback info
    const rollbackInfo = {
      old_dist_path: distOldDir,
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

    // 7. Report to cloud
    try {
      await api.reportUpdateStatus({
        agent_id: agentId,
        status: "restarting",
        old_version: config.version,
        new_version: info.latest_version,
      });
    } catch { /* best effort */ }

    // 8. Clean up zip
    try { unlinkSync(zipPath); } catch { /* ok */ }

    // 9. Restart via launcher exit code (launcher loop will restart us)
    logger.info("Restarting via launcher exit code", { exitCode: RESTART_EXIT_CODE });
    process.exit(RESTART_EXIT_CODE);
  } catch (e) {
    const msg = (e as Error).message;
    state.lastError = msg;
    state.updating = false;
    logger.error("Update failed", { error: msg });

    // Cleanup
    try { if (existsSync(zipPath)) unlinkSync(zipPath); } catch { /* ok */ }
    try { if (existsSync(distNewDir)) rmSync(distNewDir, { recursive: true }); } catch { /* ok */ }

    // Report failure
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
  const rollbackInfoPath = path.join(config.agentConfigDir, "rollback-info.json");

  let previousVersion = process.env.POPDAM_PREVIOUS_VERSION || "";
  let rollbackDist = process.env.POPDAM_ROLLBACK_DIST || "";

  // Scheduled-task restarts do not preserve env vars; recover rollback context from disk.
  if (!previousVersion || !rollbackDist) {
    try {
      if (existsSync(rollbackInfoPath)) {
        const raw = await readFile(rollbackInfoPath, "utf-8");
        const info = JSON.parse(raw) as {
          old_version?: string;
          old_dist_path?: string;
          new_version?: string;
        };

        if (
          typeof info.old_version === "string" &&
          typeof info.old_dist_path === "string" &&
          info.new_version?.replace(/^v/, "") === config.version.replace(/^v/, "")
        ) {
          previousVersion = info.old_version;
          rollbackDist = info.old_dist_path;
        }
      }
    } catch (e) {
      logger.warn("Failed to read rollback-info.json", { error: (e as Error).message });
    }
  }

  if (!previousVersion || !rollbackDist) {
    return; // Not a post-update restart
  }

  logger.info("Post-update restart detected", {
    previousVersion,
    currentVersion: config.version,
    rollbackDist,
  });

  const startTime = Date.now();
  let healthy = false;

  while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT_MS) {
    try {
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

    // Clean up old dist + rollback marker
    try {
      if (existsSync(rollbackDist)) rmSync(rollbackDist, { recursive: true });
    } catch { /* ok */ }
    try {
      if (existsSync(rollbackInfoPath)) unlinkSync(rollbackInfoPath);
    } catch { /* ok */ }

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
      rollbackDist,
    });

    try {
      const installDir = getInstallDir();
      const distDir = path.join(installDir, "dist");
      const failedDir = path.join(installDir, "dist.failed");

      if (existsSync(rollbackDist)) {
        if (existsSync(failedDir)) rmSync(failedDir, { recursive: true });
        renameSync(distDir, failedDir);
        renameSync(rollbackDist, distDir);

        try {
          if (existsSync(rollbackInfoPath)) unlinkSync(rollbackInfoPath);
        } catch { /* ok */ }

        try {
          await api.reportUpdateStatus({
            agent_id: agentId,
            status: "rolled_back",
            old_version: previousVersion,
            new_version: config.version,
            error: "Health check failed within 60s — rolled back",
          });
        } catch { /* best effort */ }

        // Restart with old code via launcher exit code
        logger.info("Rollback complete — restarting with previous version");
        process.exit(RESTART_EXIT_CODE);
      } else {
        logger.error("Rollback dist not found — cannot rollback", { rollbackDist });
      }
    } catch (e) {
      logger.error("Rollback failed", { error: (e as Error).message });
    }
  }
}
