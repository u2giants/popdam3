/**
 * PopDAM Bridge Agent — Main Entry Point
 *
 * Lifecycle:
 *   1. Validate config (fail-fast on missing env vars)
 *   2. Register with cloud API (get agent_id)
 *   3. Start heartbeat timer (every 30s, independent of scanning)
 *   4. Poll for scan requests (idle: 30s, active: 5s)
 *   5. When scan requested: validate roots → scan → hash → thumbnail → upload → ingest
 *   6. Report progress throughout
 *
 * Per PROJECT_BIBLE: outbound HTTPS only, no inbound networking.
 */

import { config } from "./config.js";
import { logger } from "./logger.js";
import * as api from "./api-client.js";
import { readFileSync } from "node:fs";
import { stat, readdir, writeFile, mkdir } from "node:fs/promises";
import { validateScanRoots, scanFiles, type FileCandidate, type ScanCallbacks } from "./scanner.js";
import { computeQuickHash } from "./hasher.js";
import { generateThumbnail } from "./thumbnailer.js";
import { uploadThumbnail, reinitializeS3Client } from "./uploader.js";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

// ── State ───────────────────────────────────────────────────────

let agentId: string = "";
let isScanning = false;
let abortRequested = false;
let lastError: string | undefined;

// ── Version info (injected via Docker build args or package.json) ──
const imageTag = process.env.POPDAM_IMAGE_TAG || "unknown";
const buildSha = process.env.POPDAM_BUILD_SHA || "unknown";
let packageVersion = "unknown";
try {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  packageVersion = pkg.version || "unknown";
} catch { /* running from dist — try relative */ 
  try {
    const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));
    packageVersion = pkg.version || "unknown";
  } catch { /* leave as unknown */ }
}

const counters: api.Counters = {
  files_checked: 0,
  candidates_found: 0,
  ingested_new: 0,
  moved_detected: 0,
  updated_existing: 0,
  errors: 0,
  roots_invalid: 0,
  roots_unreadable: 0,
  dirs_skipped_permission: 0,
  files_stat_failed: 0,
  files_total_encountered: 0,
  rejected_wrong_type: 0,
  rejected_junk_file: 0,
  noop_unchanged: 0,
  rejected_subfolder: 0,
};

function resetCounters() {
  counters.files_checked = 0;
  counters.candidates_found = 0;
  counters.ingested_new = 0;
  counters.moved_detected = 0;
  counters.updated_existing = 0;
  counters.errors = 0;
  counters.roots_invalid = 0;
  counters.roots_unreadable = 0;
  counters.dirs_skipped_permission = 0;
  counters.files_stat_failed = 0;
  counters.files_total_encountered = 0;
  counters.rejected_wrong_type = 0;
  counters.rejected_junk_file = 0;
  counters.noop_unchanged = 0;
  counters.rejected_subfolder = 0;
}

// ── Cloud Config State (overridden by heartbeat config sync) ────────

let cloudScanRoots: string[] | null = null; // null = use env fallback
let cloudMountRoot: string | null = null;
let cloudBatchSize: number | null = null;
let cloudConcurrency: number | null = null;
let cloudScanMinDate: string | null = null;

// Auto-scan state
let autoScanEnabled = false;
let autoScanIntervalHours = 6;
let lastScanCompletedAt: number = Date.now(); // init to now so auto-scan waits one full interval after startup

// Windows render mode: "fallback_only" (default) or "primary"
let windowsRenderMode: "fallback_only" | "primary" = "fallback_only";

// Windows render policy (new — overrides windowsRenderMode when present)
import type { WindowsRenderPolicy } from "./api-client.js";
let windowsRenderPolicy: WindowsRenderPolicy | null = null;

// Windows agent health context (updated each heartbeat)
let windowsAgentHealthy = false;
let pendingRenderJobs = 0;

function getEffectiveScanRoots(): string[] {
  return (cloudScanRoots && cloudScanRoots.length > 0) ? cloudScanRoots : config.scanRoots;
}

function getEffectiveBatchSize(): number {
  // Cloud config (admin panel) wins → .env fallback → hard default
  if (cloudBatchSize && cloudBatchSize > 0) return cloudBatchSize;
  if (config.ingestBatchSize > 0) return config.ingestBatchSize;
  return 100;
}

function getEffectiveConcurrency(): number {
  // Cloud config (admin panel) wins → .env fallback → hard default
  if (cloudConcurrency && cloudConcurrency > 0) return cloudConcurrency;
  if (config.thumbConcurrency > 0) return config.thumbConcurrency;
  return 2;
}

// ── Heartbeat (runs on its own timer, never blocked by scanning) ──

function startHeartbeat() {
  const INTERVAL_MS = 30_000;
  setInterval(async () => {
    try {
      // Build diagnostics payload for Doctor
      const effectiveRoots = getEffectiveScanRoots();
      const effectiveMountRoot = cloudMountRoot || config.nasContainerMountRoot;
      const diagnostics: Record<string, unknown> = {
        mount_root_path: effectiveMountRoot,
        scan_roots: effectiveRoots,
      };

      // Validate mount root exists
      try {
        await stat(effectiveMountRoot);
        diagnostics.mount_root_exists = true;
      } catch {
        diagnostics.mount_root_exists = false;
      }

      // Check each scan root
      const unreadableRoots: string[] = [];
      const readableRoots: string[] = [];
      for (const root of effectiveRoots) {
        try {
          await stat(root);
          readableRoots.push(root);
        } catch {
          unreadableRoots.push(root);
        }
      }
      diagnostics.readable_roots = readableRoots;
      diagnostics.unreadable_roots = unreadableRoots;
      diagnostics.scan_roots_readable = unreadableRoots.length === 0;

      const response = await api.heartbeat(agentId, { ...counters }, lastError, {
        image_tag: imageTag,
        version: packageVersion,
        build_sha: buildSha,
      }, diagnostics);
      logger.debug("Heartbeat sent");

      // Process config sync from heartbeat response
      if (response.config) {
        applyCloudConfig(response.config);
      }

      // Process commands
      if (response.commands) {
        if (response.commands.abort_scan && isScanning) {
          logger.info("Abort requested via heartbeat");
          abortRequested = true;
        }
        if (!isScanning && response.commands.force_scan) {
          const sessionId = response.commands.scan_session_id || undefined;
          logger.info("Scan requested via heartbeat config sync", { sessionId });
          runScan(sessionId).catch((e) => logger.error("Scan error", { error: (e as Error).message }));
        }
        // Handle path test command
        if (response.commands.test_paths) {
          handlePathTest(response.commands.test_paths).catch((e) =>
            logger.error("Path test failed", { error: (e as Error).message })
          );
        }

        // Handle update commands
        if (response.commands.check_update) {
          handleCheckUpdate().catch((e) =>
            logger.error("Update check failed", { error: (e as Error).message })
          );
        }
        if (response.commands.apply_update) {
          handleApplyUpdate();
        }
      }

      // Auto-scan: trigger if enabled + not scanning + interval elapsed
      if (autoScanEnabled && !isScanning) {
        const elapsedMs = Date.now() - lastScanCompletedAt;
        const intervalMs = autoScanIntervalHours * 60 * 60 * 1000;
        if (elapsedMs >= intervalMs) {
          logger.info("Auto-scan triggered", { intervalHours: autoScanIntervalHours, elapsedMs });
          runScan().catch((e) => logger.error("Auto-scan error", { error: (e as Error).message }));
        }
      }
    } catch (e) {
      logger.error("Heartbeat failed", { error: (e as Error).message });
    }
  }, INTERVAL_MS);
  logger.info("Heartbeat started (30s interval)");
}

interface CloudConfig {
  do_spaces?: { key?: string; secret?: string; bucket: string; region: string; endpoint: string };
  scanning?: { container_mount_root?: string; roots: string[]; batch_size: number; scan_min_date?: string | null; adaptive_polling: { idle_seconds: number; active_seconds: number } };
  resource_guard?: { cpu_percentage_limit: number; memory_limit_mb: number; concurrency: number };
  auto_scan?: { enabled: boolean; interval_hours: number };
  windows_render_mode?: "fallback_only" | "primary";
  windows_render_policy?: WindowsRenderPolicy | null;
  windows_healthy?: boolean;
  pending_render_jobs?: number;
}

function applyCloudConfig(cfg: CloudConfig) {
  // Hot-reload S3 client if DO Spaces config changed (bucket, region, endpoint, key, secret)
  if (cfg.do_spaces) {
    reinitializeS3Client({
      bucket: cfg.do_spaces.bucket,
      region: cfg.do_spaces.region,
      endpoint: cfg.do_spaces.endpoint,
      ...(cfg.do_spaces.key && cfg.do_spaces.secret ? { key: cfg.do_spaces.key, secret: cfg.do_spaces.secret } : {}),
    });
  }

  // Update scan roots and mount root from cloud
  if (cfg.scanning) {
    if (cfg.scanning.container_mount_root) {
      cloudMountRoot = cfg.scanning.container_mount_root;
    }
    if (cfg.scanning.roots && cfg.scanning.roots.length > 0) {
      cloudScanRoots = cfg.scanning.roots;
    }
    if (cfg.scanning.batch_size) {
      cloudBatchSize = cfg.scanning.batch_size;
    }
    if (cfg.scanning.scan_min_date) {
      cloudScanMinDate = cfg.scanning.scan_min_date;
    }
  }

  // Update resource guard
  if (cfg.resource_guard) {
    if (cfg.resource_guard.concurrency) {
      cloudConcurrency = cfg.resource_guard.concurrency;
    }
  }

  // Update auto-scan config
  if (cfg.auto_scan) {
    autoScanEnabled = cfg.auto_scan.enabled === true;
    if (cfg.auto_scan.interval_hours && cfg.auto_scan.interval_hours > 0) {
      autoScanIntervalHours = cfg.auto_scan.interval_hours;
    }
  }

  // Update windows render mode (legacy)
  if (cfg.windows_render_mode === "primary" || cfg.windows_render_mode === "fallback_only") {
    windowsRenderMode = cfg.windows_render_mode;
  }

  // Update windows render policy (new — takes precedence)
  if (cfg.windows_render_policy) {
    windowsRenderPolicy = cfg.windows_render_policy;
    logger.info("Windows render policy updated", { mode: cfg.windows_render_policy.mode });
  }

  // Update windows agent health context
  if (cfg.windows_healthy !== undefined) {
    windowsAgentHealthy = cfg.windows_healthy === true;
  }
  if (cfg.pending_render_jobs !== undefined) {
    pendingRenderJobs = typeof cfg.pending_render_jobs === "number" ? cfg.pending_render_jobs : 0;
  }
}

// ── Thumbnail pipeline (bounded concurrency) ────────────────────

async function processThumbnail(
  file: FileCandidate,
  tempAssetId: string,
): Promise<{ thumbnailUrl?: string; thumbnailError?: string; width?: number; height?: number }> {
  try {
    const result = await generateThumbnail(file.absolutePath, file.fileType);
    const url = await uploadThumbnail(tempAssetId, result.buffer);
    return { thumbnailUrl: url, width: result.width, height: result.height };
  } catch (e) {
    const errorMsg = (e as Error).message;
    logger.warn("Thumbnail generation failed", { file: file.relativePath, error: errorMsg });

    // Queue for Windows Render Agent if AI-specific failure
    if (errorMsg === "no_pdf_compat") {
      return { thumbnailError: "no_pdf_compat" };
    }
    return { thumbnailError: errorMsg };
  }
}

// ── Scan + Ingest pipeline ──────────────────────────────────────

async function runScan(providedSessionId?: string) {
  if (isScanning) {
    logger.warn("Scan already in progress, skipping");
    return;
  }

  isScanning = true;
  abortRequested = false;
  resetCounters();
  const sessionId = providedSessionId || randomUUID();
  const effectiveRoots = getEffectiveScanRoots();
  let resumeFromDir: string | undefined;

  // ── Check for resumable checkpoint ──
  try {
    const checkpoint = await api.getCheckpoint();
    if (checkpoint && checkpoint.last_completed_dir) {
      // Resume from last completed directory regardless of session match.
      // Same session = crashed mid-scan and restarted.
      // Different session = previous scan crashed, new one requested.
      logger.info("Found checkpoint, resuming scan", {
        checkpointSession: checkpoint.session_id,
        currentSession: sessionId,
        lastCompletedDir: checkpoint.last_completed_dir,
        savedAt: checkpoint.saved_at,
      });
      resumeFromDir = checkpoint.last_completed_dir;
    }
  } catch (e) {
    logger.warn("Failed to fetch checkpoint, starting fresh", { error: (e as Error).message });
  }

  logger.info("Scan starting", { sessionId, roots: effectiveRoots, resumeFromDir: resumeFromDir || "none" });

  try {
    // §4.1: Validate roots first
    const rootsValid = await validateScanRoots(counters, effectiveRoots, cloudMountRoot || undefined);
    if (!rootsValid) {
      logger.error("Scan aborted: invalid scan roots", { counters });
      await api.scanProgress(sessionId, "failed", counters);
      await api.clearCheckpoint().catch(() => {});
      return;
    }

    await api.scanProgress(sessionId, "running", counters);

    // Collect files and process in batches
    let batch: FileCandidate[] = [];
    let currentTopLevelDir: string | null = null;

    // Track skipped directories (capped to avoid payload bloat)
    const MAX_SKIPPED_DIRS = 500;
    const skippedDirs: string[] = [];

    // Throttled progress reporter for directory walking
    let lastProgressAt = 0;
    const PROGRESS_INTERVAL_MS = 2000;
    const callbacks: ScanCallbacks = {
      shouldAbort: () => abortRequested,
      onDir: (dirPath) => {
        // Track top-level subdirectory transitions for checkpointing
        for (const root of effectiveRoots) {
          if (dirPath.startsWith(root) && dirPath !== root) {
            const subPath = dirPath.slice(root.length).replace(/^\//, "");
            const topLevel = subPath.split("/")[0];
            if (topLevel) {
              const topLevelFull = root + "/" + topLevel;
              if (topLevelFull !== currentTopLevelDir && currentTopLevelDir !== null) {
                // We've moved to a new top-level dir — checkpoint the completed one
                api.saveCheckpoint(sessionId, currentTopLevelDir).catch((e) =>
                  logger.warn("Failed to save checkpoint", { error: (e as Error).message })
                );
              }
              currentTopLevelDir = topLevelFull;
            }
            break;
          }
        }

        const now = Date.now();
        if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
          lastProgressAt = now;
          api.scanProgress(sessionId, "running", counters, dirPath, skippedDirs).catch(() => {});
        }
      },
      onSkippedDir: (dirPath, _reason) => {
        if (skippedDirs.length < MAX_SKIPPED_DIRS) {
          // Store path relative to mount root for readability
          const effectiveMountRoot = cloudMountRoot || config.nasContainerMountRoot;
          const displayPath = dirPath.startsWith(effectiveMountRoot)
            ? dirPath.slice(effectiveMountRoot.length).replace(/^\//, "")
            : dirPath;
          skippedDirs.push(displayPath);
        }
      },
    };

    for await (const file of scanFiles(counters, effectiveRoots, callbacks, resumeFromDir)) {
      if (abortRequested) {
        logger.info("Scan aborted by cloud request");
        await api.scanProgress(sessionId, "failed", counters, "Aborted by user", skippedDirs);
        return;
      }

      batch.push(file);

      if (batch.length >= getEffectiveBatchSize()) {
        await processBatch(batch, sessionId);
        batch = [];
      }
    }

    // Process remaining
    if (batch.length > 0 && !abortRequested) {
      await processBatch(batch, sessionId);
    }

    // Check abort after scan loop completes
    if (abortRequested) {
      logger.info("Scan aborted by cloud request (post-loop)");
      await api.scanProgress(sessionId, "failed", counters, "Aborted by user", skippedDirs);
      return;
    }

    // §4.3: "0 files checked" is an error (only if not resuming — resumed scans may legitimately have fewer files)
    if (counters.files_checked === 0 && !resumeFromDir) {
      logger.error("Scan completed with 0 files checked — treating as error");
      counters.errors++;
        await api.scanProgress(sessionId, "failed", counters, undefined, skippedDirs);
      return;
    }

    logger.info("Scan completed", { counters, resumed: !!resumeFromDir, skippedDirs: skippedDirs.length });
    await api.scanProgress(sessionId, "completed", counters, undefined, skippedDirs);
    // Clear checkpoint on successful completion
    await api.clearCheckpoint().catch(() => {});
  } catch (e) {
    lastError = (e as Error).message;
    logger.error("Scan failed with exception", { error: lastError });
    await api.scanProgress(sessionId, "failed", counters).catch(() => {});
    // Don't clear checkpoint on failure — allows resume on restart
  } finally {
    isScanning = false;
    lastScanCompletedAt = Date.now();
  }

}

async function processBatch(batch: FileCandidate[], sessionId: string) {
  // ── Change detection: ask cloud which files actually need processing ──
  const checkPayload = batch.map((f) => ({
    relative_path: f.relativePath,
    modified_at: f.modifiedAt.toISOString(),
    file_size: f.fileSize,
  }));

  let changedSet: Set<string>;
  let needsThumbnailSet: Set<string>;
  try {
    // Chunk check-changed calls into groups of 20 to avoid URL length limits
    const CHECK_CHUNK_SIZE = 20;
    const allChanged: string[] = [];
    const allNeedsThumbnail: string[] = [];
    for (let ci = 0; ci < checkPayload.length; ci += CHECK_CHUNK_SIZE) {
      const chunk = checkPayload.slice(ci, ci + CHECK_CHUNK_SIZE);
      const result = await api.checkChanged(chunk);
      allChanged.push(...result.changed);
      allNeedsThumbnail.push(...result.needs_thumbnail);
    }
    changedSet = new Set(allChanged);
    needsThumbnailSet = new Set(allNeedsThumbnail);
  } catch (e) {
    // If check-changed fails, fall back to processing everything
    logger.warn("check-changed failed, processing entire batch", { error: (e as Error).message });
    changedSet = new Set(batch.map((f) => f.relativePath));
    needsThumbnailSet = new Set();
  }

  const unchanged = batch.length - changedSet.size - needsThumbnailSet.size;
  if (unchanged > 0) {
    logger.debug(`Skipping ${unchanged}/${batch.length} unchanged files in batch`);
    counters.files_checked += unchanged;
  }

  // Files needing thumbnail retry: generate thumbnail + ingest (but they're otherwise unchanged)
  const thumbRetryFiles = batch.filter((f) => needsThumbnailSet.has(f.relativePath));
  if (thumbRetryFiles.length > 0) {
    logger.info(`Retrying thumbnails for ${thumbRetryFiles.length} previously failed files`);
  }

  const filesToProcess = batch.filter((f) => changedSet.has(f.relativePath));
  const allToProcess = [...filesToProcess, ...thumbRetryFiles];
  if (allToProcess.length === 0) {
    // Report progress even if nothing to process
    await api.scanProgress(sessionId, "running", counters, batch[batch.length - 1]?.relativePath);
    return;
  }

  // Process changed files with bounded thumbnail concurrency
  const concurrency = getEffectiveConcurrency();
  let i = 0;

  while (i < allToProcess.length) {
    const chunk = allToProcess.slice(i, i + concurrency);
    await Promise.all(chunk.map((file) => processFile(file)));
    i += concurrency;

    // Report progress
    await api.scanProgress(sessionId, "running", counters, allToProcess[Math.min(i, allToProcess.length) - 1]?.relativePath);
  }
}

async function processFile(file: FileCandidate) {
  // Skip files older than the configured scan min date
  if (cloudScanMinDate && file.modifiedAt < new Date(cloudScanMinDate)) {
    counters.noop_unchanged++;
    return;
  }

  try {
    // 1. Quick hash
    const { quick_hash, quick_hash_version } = await computeQuickHash(file.absolutePath);

    // 2. Thumbnail strategy — uses new policy if set, else legacy mode
    let thumb: { thumbnailUrl?: string; thumbnailError?: string; width?: number; height?: number } = {};
    const effectiveMode = windowsRenderPolicy?.mode ?? windowsRenderMode;
    const policy = windowsRenderPolicy;

    // ── Step 2a: Determine if we should defer to Windows BEFORE local thumbnailing ──
    const shouldDeferToWindows = (() => {
      if (effectiveMode === "primary") return true;
      if (effectiveMode === "fallback_only") return false;

      // "shared" mode
      if (effectiveMode === "shared" && policy) {
        // File type must be eligible
        if (!policy.shared_types.includes(file.fileType)) return false;

        // Health guard: if require_windows_healthy, check the flag
        if (policy.require_windows_healthy && !windowsAgentHealthy) {
          logger.debug("Shared mode: Windows unhealthy, doing local", { file: file.relativePath });
          return false;
        }

        // Queue depth guard
        if (pendingRenderJobs >= policy.max_pending_jobs) {
          logger.debug("Shared mode: render queue full, doing local", { pending: pendingRenderJobs, max: policy.max_pending_jobs });
          return false;
        }

        // Offload decision: file_size >= shared_min_mb OR hash-deterministic percent
        const meetsMinSize = policy.shared_min_mb > 0 && file.fileSize >= policy.shared_min_mb * 1024 * 1024;
        // Deterministic: use quick_hash so re-scans produce same decision
        const hashNum = parseInt(quick_hash.slice(0, 8), 16);
        const meetsPercent = (hashNum % 100) < policy.shared_percent;

        return meetsMinSize || meetsPercent;
      }
      return false;
    })();

    // ── Step 2b: Either defer or attempt local thumbnail ──
    if (shouldDeferToWindows) {
      thumb = { thumbnailError: "deferred_to_windows_agent" };
    } else {
      const tempId = randomUUID();
      thumb = await processThumbnail(file, tempId);
    }

    // 3. Ingest to cloud
    const result = await api.ingest({
      relative_path: file.relativePath,
      filename: file.filename,
      file_type: file.fileType,
      file_size: file.fileSize,
      modified_at: file.modifiedAt.toISOString(),
      file_created_at: file.fileCreatedAt?.toISOString() || null,
      quick_hash,
      quick_hash_version,
      thumbnail_url: thumb.thumbnailUrl,
      thumbnail_error: thumb.thumbnailError,
      width: thumb.width,
      height: thumb.height,
    });

    // Update counters based on API response
    switch (result.action) {
      case "created":
        counters.ingested_new++;
        break;
      case "moved":
        counters.moved_detected++;
        break;
      case "updated":
        counters.updated_existing++;
        break;
      case "noop":
        counters.noop_unchanged++;
        break;
      case "rejected_subfolder":
        counters.rejected_subfolder++;
        break;
      case "skipped":
        break; // junk files
    }

    // ── Step 4: Queue for Windows render agent ──
    const isNewOrChanged = result.action === "created" || result.action === "updated" || result.action === "moved";
    const localThumbFailed = !thumb.thumbnailUrl && !!thumb.thumbnailError && thumb.thumbnailError !== "deferred_to_windows_agent";

    const queueReason = (() => {
      // A) Deferred (primary or shared offload) — queue after successful ingest
      if (shouldDeferToWindows && isNewOrChanged) {
        return effectiveMode === "primary" ? "primary_mode" : "shared_offload";
      }

      // B) Local thumbnail failed — evaluate fallback options
      if (localThumbFailed) {
        // B1) New policy: final_fallback_on_local_failure covers both PSD and AI
        if (policy?.final_fallback_on_local_failure) {
          return "local_thumb_failed";
        }
        // B2) Legacy fallback: AI no_pdf_compat only (backward compat when no policy set)
        if (thumb.thumbnailError === "no_pdf_compat" && file.fileType === "ai") {
          return "no_pdf_compat";
        }
      }

      return null;
    })();

    if (queueReason) {
      try {
        await api.queueRender(result.asset_id, queueReason);
        if (shouldDeferToWindows) pendingRenderJobs++; // local estimate for queue depth guard
      } catch (e) {
        logger.warn("Failed to queue render job", { assetId: result.asset_id, reason: queueReason, error: (e as Error).message });
      }
    }

    logger.debug("File processed", {
      file: file.relativePath,
      action: result.action,
      assetId: result.asset_id,
    });
  } catch (e) {
    counters.errors++;
    lastError = (e as Error).message;
    logger.error("File processing failed", {
      file: file.relativePath,
      error: lastError,
    });
  }
}

// ── Path Test Handler ────────────────────────────────────────────

async function handlePathTest(cmd: { request_id: string; container_mount_root: string; scan_roots: string[] }) {
  logger.info("Path test requested", { requestId: cmd.request_id });

  let mountRootValid = false;
  try {
    const s = await stat(cmd.container_mount_root);
    mountRootValid = s.isDirectory();
  } catch { /* not found */ }

  const scanRootResults: Array<{ path: string; valid: boolean; file_count?: number; error?: string }> = [];
  for (const root of cmd.scan_roots) {
    try {
      const s = await stat(root);
      if (!s.isDirectory()) {
        scanRootResults.push({ path: root, valid: false, error: "exists but is not a directory" });
        continue;
      }
      const entries = await readdir(root);
      scanRootResults.push({ path: root, valid: true, file_count: entries.length });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      scanRootResults.push({ path: root, valid: false, error: code === "ENOENT" ? "not found" : code === "EACCES" ? "permission denied" : String(e) });
    }
  }

  await api.reportPathTest(cmd.request_id, {
    mount_root_valid: mountRootValid,
    scan_root_results: scanRootResults,
  });

  logger.info("Path test completed", { mountRootValid, scanRootResults });
}

// ── Self-Update Handlers ────────────────────────────────────────

async function handleCheckUpdate() {
  logger.info("Checking for Docker image update...");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  // Use the tag the container was built with, falling back to "stable"
  const tag = imageTag !== "unknown" ? imageTag : "stable";
  const pullImage = `ghcr.io/u2giants/popdam-bridge:${tag}`;

  try {
    await execFileAsync("docker", ["pull", pullImage, "--quiet"]);

    const { stdout: currentDigest } = await execFileAsync(
      "docker", ["inspect", "popdam-bridge", "--format={{.Image}}"]
    );
    const { stdout: latestDigest } = await execFileAsync(
      "docker", ["inspect", pullImage, "--format={{.Id}}"]
    );

    const updateAvailable = currentDigest.trim() !== latestDigest.trim();

    await api.reportUpdateStatus({
      current_digest: currentDigest.trim(),
      latest_digest: latestDigest.trim(),
      update_available: updateAvailable,
      checked_tag: tag,
      checked_at: new Date().toISOString(),
    });

    logger.info("Update check complete", { updateAvailable, tag, currentDigest: currentDigest.trim(), latestDigest: latestDigest.trim() });
  } catch (e) {
    logger.error("Update check failed", { error: (e as Error).message });
    await api.reportUpdateStatus({
      error: (e as Error).message,
      update_available: false,
      checked_at: new Date().toISOString(),
    }).catch(() => {});
  }
}

function handleApplyUpdate() {
  logger.info("Self-update requested — pulling and restarting container");
  const tag = imageTag !== "unknown" ? imageTag : "stable";
  const pullImage = `ghcr.io/u2giants/popdam-bridge:${tag}`;
  const { exec } = require("node:child_process");
  // Fire and forget — container will stop mid-execution
  exec([
    `docker pull ${pullImage}`,
    "docker stop popdam-bridge",
    "docker rm popdam-bridge",
    "docker compose -f /volume1/docker/popdam/docker-compose.yml up -d",
  ].join(" && "), (err: Error | null) => {
    if (err) {
      logger.error("Self-update exec failed", { error: err.message });
    }
  });
}

// Legacy polling loop removed.
// All scan commands (force_scan, abort_scan, test_paths) are now
// delivered exclusively via heartbeat config sync (see startHeartbeat).

// ── Pairing ─────────────────────────────────────────────────────

async function doPairing(): Promise<void> {
  logger.info("No agent key found — pairing with cloud using pairing code");

  const result = await api.pair(config.pairingCode, config.agentName);

  // Persist agent config to data volume
  const configData = {
    agent_id: result.agent_id,
    agent_key: result.agent_key,
    paired_at: new Date().toISOString(),
  };

  try {
    await mkdir(dirname(config.agentConfigPath), { recursive: true });
    await writeFile(config.agentConfigPath, JSON.stringify(configData, null, 2), "utf-8");
  } catch (e) {
    logger.error("Failed to persist agent config — key will be lost on restart", {
      path: config.agentConfigPath,
      error: (e as Error).message,
    });
  }

  // Apply to runtime
  (config as { agentKey: string }).agentKey = result.agent_key;
  agentId = result.agent_id;
  logger.info("Pairing complete — agent key saved", {
    agentId,
    configPath: config.agentConfigPath,
  });
}

// ── Bootstrap ───────────────────────────────────────────────────

async function main() {
  logger.info("PopDAM Bridge Agent starting", {
    version: packageVersion,
    imageTag,
    buildSha,
    scanRoots: config.scanRoots,
    mountRoot: config.nasContainerMountRoot,
    thumbConcurrency: config.thumbConcurrency,
    batchSize: config.ingestBatchSize,
    paired: config.isPaired,
  });

  // Warn about missing DO Spaces credentials (expected — will arrive via heartbeat)
  if (!config.doSpacesKey || !config.doSpacesSecret) {
    logger.warn("DO_SPACES_KEY/SECRET not set — waiting for cloud config via heartbeat.");
  }

  // 0. Pairing flow: if no agent key, pair with cloud using pairing code
  if (!config.agentKey) {
    if (!config.pairingCode) {
      logger.error(
        "No agent key and no pairing code. Cannot start.\n" +
        "Set POPDAM_SERVER_URL and POPDAM_PAIRING_CODE in your .env or docker-compose.yml.\n" +
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
          "Generate a new pairing code from PopDAM Settings → Agents and update POPDAM_PAIRING_CODE."
        );
      } else {
        logger.error("Pairing failed — exiting", { error: msg });
      }
      process.exit(1);
    }
  }

  // 1. Register with cloud (if not already registered via pairing)
  if (!agentId) {
    // Try to use saved agent ID first
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

  // 2. Start heartbeat (independent timer)
  startHeartbeat();

  // 3. Ready — all scan/abort commands come via heartbeat
  logger.info("Agent ready (all commands via heartbeat)");
}

main().catch((e) => {
  logger.error("Fatal error", { error: (e as Error).message });
  process.exit(1);
});
