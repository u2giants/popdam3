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
import { uploadThumbnail } from "./uploader.js";
import { randomUUID } from "node:crypto";

// ── State ───────────────────────────────────────────────────────

let agentId: string = "";
let isScanning = false;
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

// ── Heartbeat (runs on its own timer, never blocked by scanning) ──

function startHeartbeat() {
  const INTERVAL_MS = 30_000;
  setInterval(async () => {
    try {
      await api.heartbeat(agentId, { ...counters }, lastError);
      logger.debug("Heartbeat sent");
    } catch (e) {
      logger.error("Heartbeat failed", { error: (e as Error).message });
    }
  }, INTERVAL_MS);
  logger.info("Heartbeat started (30s interval)");
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
  resetCounters();
  const sessionId = randomUUID();
  logger.info("Scan starting", { sessionId });

  try {
    // §4.1: Validate roots first
    const rootsValid = await validateScanRoots(counters);
    if (!rootsValid) {
      logger.error("Scan aborted: invalid scan roots", { counters });
      await api.scanProgress(sessionId, "failed", counters);
      return;
    }

    await api.scanProgress(sessionId, "running", counters);

    // Collect files and process in batches
    let batch: FileCandidate[] = [];

    for await (const file of scanFiles(counters)) {
      batch.push(file);

      if (batch.length >= config.ingestBatchSize) {
        await processBatch(batch, sessionId);
        batch = [];
      }
    }

    // Process remaining
    if (batch.length > 0) {
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
  const concurrency = config.thumbConcurrency;
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

async function startPolling() {
  const IDLE_INTERVAL = 30_000;
  const ACTIVE_INTERVAL = 5_000;

  while (true) {
    const interval = isScanning ? ACTIVE_INTERVAL : IDLE_INTERVAL;

    try {
      if (!isScanning) {
        const requested = await api.checkScanRequest(agentId);
        if (requested) {
          logger.info("Scan requested by cloud, starting scan");
          // Don't await — let it run in background while polling continues
          runScan().catch((e) => logger.error("Scan error", { error: (e as Error).message }));
        }
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
    agentId = await api.register("bridge-agent");
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
