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
import { stat, readdir } from "node:fs/promises";
import { validateScanRoots, scanFiles, type FileCandidate, type ScanCallbacks } from "./scanner.js";
import { computeQuickHash } from "./hasher.js";
import { generateThumbnail } from "./thumbnailer.js";
import { uploadThumbnail, reinitializeS3Client } from "./uploader.js";
import { randomUUID } from "node:crypto";

// ── State ───────────────────────────────────────────────────────

let agentId: string = "";
let isScanning = false;
let abortRequested = false;
let lastError: string | undefined;

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
}

// ── Cloud Config State (overridden by heartbeat config sync) ────────

let cloudScanRoots: string[] | null = null; // null = use env fallback
let cloudMountRoot: string | null = null;
let cloudBatchSize: number | null = null;
let cloudConcurrency: number | null = null;

// Auto-scan state
let autoScanEnabled = false;
let autoScanIntervalHours = 6;
let lastScanCompletedAt: number = 0; // epoch ms

function getEffectiveScanRoots(): string[] {
  return (cloudScanRoots && cloudScanRoots.length > 0) ? cloudScanRoots : config.scanRoots;
}

function getEffectiveBatchSize(): number {
  return cloudBatchSize ?? config.ingestBatchSize;
}

function getEffectiveConcurrency(): number {
  return cloudConcurrency ?? config.thumbConcurrency;
}

// ── Heartbeat (runs on its own timer, never blocked by scanning) ──

function startHeartbeat() {
  const INTERVAL_MS = 30_000;
  setInterval(async () => {
    try {
      const response = await api.heartbeat(agentId, { ...counters }, lastError);
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
  scanning?: { container_mount_root?: string; roots: string[]; batch_size: number; adaptive_polling: { idle_seconds: number; active_seconds: number } };
  resource_guard?: { cpu_percentage_limit: number; memory_limit_mb: number; concurrency: number };
  auto_scan?: { enabled: boolean; interval_hours: number };
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
    if (checkpoint && checkpoint.session_id !== sessionId) {
      // Different session — this checkpoint is from a crashed previous scan
      logger.info("Found checkpoint from crashed scan, resuming", {
        checkpointSession: checkpoint.session_id,
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
          api.scanProgress(sessionId, "running", counters, dirPath).catch(() => {});
        }
      },
    };

    for await (const file of scanFiles(counters, effectiveRoots, callbacks, resumeFromDir)) {
      if (abortRequested) {
        logger.info("Scan aborted by cloud request");
        await api.scanProgress(sessionId, "failed", counters, "Aborted by user");
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
      await api.scanProgress(sessionId, "failed", counters, "Aborted by user");
      return;
    }

    // §4.3: "0 files checked" is an error (only if not resuming — resumed scans may legitimately have fewer files)
    if (counters.files_checked === 0 && !resumeFromDir) {
      logger.error("Scan completed with 0 files checked — treating as error");
      counters.errors++;
      await api.scanProgress(sessionId, "failed", counters);
      return;
    }

    logger.info("Scan completed", { counters, resumed: !!resumeFromDir });
    await api.scanProgress(sessionId, "completed", counters);
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
    const result = await api.checkChanged(checkPayload);
    changedSet = new Set(result.changed);
    needsThumbnailSet = new Set(result.needs_thumbnail);
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
  try {
    // 1. Quick hash
    const { quick_hash, quick_hash_version } = await computeQuickHash(file.absolutePath);

    // 2. Generate a temporary ID for thumbnail upload naming
    // The actual asset_id will come from the API response
    const tempId = randomUUID();

    // 3. Thumbnail
    const thumb = await processThumbnail(file, tempId);

    // 4. Ingest to cloud
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

    // If thumbnail was uploaded with temp ID but asset got a different ID,
    // that's fine — the URL is stored in the DB row regardless.

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
    }

    // Queue for render if thumbnail failed on AI files
    if (thumb.thumbnailError === "no_pdf_compat" && file.fileType === "ai") {
      try {
        await api.queueRender(result.asset_id, "no_pdf_compat");
      } catch (e) {
        logger.warn("Failed to queue render job", { assetId: result.asset_id, error: (e as Error).message });
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

// Legacy polling loop removed.
// All scan commands (force_scan, abort_scan, test_paths) are now
// delivered exclusively via heartbeat config sync (see startHeartbeat).

// ── Bootstrap ───────────────────────────────────────────────────

async function main() {
  logger.info("PopDAM Bridge Agent starting", {
    scanRoots: config.scanRoots,
    mountRoot: config.nasContainerMountRoot,
    thumbConcurrency: config.thumbConcurrency,
    batchSize: config.ingestBatchSize,
  });

  // Warn about missing DO Spaces credentials (expected — will arrive via heartbeat)
  if (!config.doSpacesKey || !config.doSpacesSecret) {
    logger.warn("DO_SPACES_KEY/SECRET not set in .env — waiting for cloud config via heartbeat. Thumbnails will be skipped until credentials are received.");
  }

  // 1. Register with cloud
  try {
    agentId = await api.register(config.agentName);
    logger.info("Registered with cloud API", { agentId });
  } catch (e) {
    logger.error("Failed to register with cloud API — exiting", { error: (e as Error).message });
    process.exit(1);
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
