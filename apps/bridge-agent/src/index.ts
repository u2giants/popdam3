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
import { validateScanRoots, scanFiles, type FileCandidate } from "./scanner.js";
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
let cloudBatchSize: number | null = null;
let cloudIdleInterval: number | null = null;
let cloudActiveInterval: number | null = null;
let cloudConcurrency: number | null = null;

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
          logger.info("Scan requested via heartbeat config sync");
          runScan().catch((e) => logger.error("Scan error", { error: (e as Error).message }));
        }
      }
    } catch (e) {
      logger.error("Heartbeat failed", { error: (e as Error).message });
    }
  }, INTERVAL_MS);
  logger.info("Heartbeat started (30s interval)");
}

interface CloudConfig {
  do_spaces?: { key: string; secret: string; bucket: string; region: string; endpoint: string };
  scanning?: { roots: string[]; batch_size: number; adaptive_polling: { idle_seconds: number; active_seconds: number } };
  resource_guard?: { cpu_percentage_limit: number; memory_limit_mb: number; concurrency: number };
}

function applyCloudConfig(cfg: CloudConfig) {
  // Hot-reload S3 client if DO credentials changed
  if (cfg.do_spaces && cfg.do_spaces.key && cfg.do_spaces.secret) {
    reinitializeS3Client(cfg.do_spaces);
  }

  // Update scan roots from cloud
  if (cfg.scanning) {
    if (cfg.scanning.roots && cfg.scanning.roots.length > 0) {
      cloudScanRoots = cfg.scanning.roots;
    }
    if (cfg.scanning.batch_size) {
      cloudBatchSize = cfg.scanning.batch_size;
    }
    if (cfg.scanning.adaptive_polling) {
      cloudIdleInterval = cfg.scanning.adaptive_polling.idle_seconds * 1000;
      cloudActiveInterval = cfg.scanning.adaptive_polling.active_seconds * 1000;
    }
  }

  // Update resource guard
  if (cfg.resource_guard) {
    if (cfg.resource_guard.concurrency) {
      cloudConcurrency = cfg.resource_guard.concurrency;
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

async function runScan() {
  if (isScanning) {
    logger.warn("Scan already in progress, skipping");
    return;
  }

  isScanning = true;
  abortRequested = false;
  resetCounters();
  const sessionId = randomUUID();
  const effectiveRoots = getEffectiveScanRoots();
  logger.info("Scan starting", { sessionId, roots: effectiveRoots });

  try {
    // §4.1: Validate roots first
    const rootsValid = await validateScanRoots(counters, effectiveRoots);
    if (!rootsValid) {
      logger.error("Scan aborted: invalid scan roots", { counters });
      await api.scanProgress(sessionId, "failed", counters);
      return;
    }

    await api.scanProgress(sessionId, "running", counters);

    // Collect files and process in batches
    let batch: FileCandidate[] = [];

    for await (const file of scanFiles(counters, effectiveRoots)) {
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

    // §4.3: "0 files checked" is an error
    if (counters.files_checked === 0) {
      logger.error("Scan completed with 0 files checked — treating as error");
      counters.errors++;
      await api.scanProgress(sessionId, "failed", counters);
      return;
    }

    logger.info("Scan completed", { counters });
    await api.scanProgress(sessionId, "completed", counters);
  } catch (e) {
    lastError = (e as Error).message;
    logger.error("Scan failed with exception", { error: lastError });
    await api.scanProgress(sessionId, "failed", counters).catch(() => {});
  } finally {
    isScanning = false;
  }
}

async function processBatch(batch: FileCandidate[], sessionId: string) {
  // Process files with bounded thumbnail concurrency
  const concurrency = getEffectiveConcurrency();
  let i = 0;

  while (i < batch.length) {
    const chunk = batch.slice(i, i + concurrency);
    await Promise.all(chunk.map((file) => processFile(file)));
    i += concurrency;

    // Report progress
    await api.scanProgress(sessionId, "running", counters, batch[Math.min(i, batch.length) - 1]?.relativePath);
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

// ── Polling loop (outbound only per §8) ─────────────────────────
// Note: scan commands are now also delivered via heartbeat config sync.
// This loop remains as a secondary check mechanism.

async function startPolling() {
  while (true) {
    const idleMs = cloudIdleInterval ?? 30_000;
    const activeMs = cloudActiveInterval ?? 5_000;
    const interval = isScanning ? activeMs : idleMs;

    try {
      const result = await api.checkScanRequest(agentId);

      if (result.scan_abort && isScanning) {
        logger.info("Abort requested by cloud");
        abortRequested = true;
      }

      if (!isScanning && result.scan_requested) {
        logger.info("Scan requested by cloud, starting scan");
        runScan().catch((e) => logger.error("Scan error", { error: (e as Error).message }));
      }
    } catch (e) {
      logger.error("Poll failed", { error: (e as Error).message });
    }

    await sleep(interval);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Bootstrap ───────────────────────────────────────────────────

async function main() {
  logger.info("PopDAM Bridge Agent starting", {
    scanRoots: config.scanRoots,
    mountRoot: config.nasContainerMountRoot,
    thumbConcurrency: config.thumbConcurrency,
    batchSize: config.ingestBatchSize,
  });

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

  // 3. Start polling loop
  logger.info("Entering polling loop (outbound HTTPS only)");
  await startPolling();
}

main().catch((e) => {
  logger.error("Fatal error", { error: (e as Error).message });
  process.exit(1);
});
