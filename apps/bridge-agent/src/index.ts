/**
 * PopDAM Bridge Agent — Main Entry Point
 *
 * Lifecycle:
 *   1. Validate config (fail-fast on missing env vars)
 *   2. Register with cloud API (get agent_id)
 *   3. Start heartbeat timer (every 30s — fallback command channel)
 *   4. Start Realtime watcher (instant SCAN_REQUEST delivery via Supabase Realtime)
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
import { validateScanRoots, scanFiles, isPdfCandidate, type FileCandidate, type ScanCallbacks } from "./scanner.js";
import { computeQuickHash } from "./hasher.js";
import { generateThumbnail, type PdfThumbnailResult } from "./thumbnailer.js";
import { uploadThumbnail, uploadPdfPage, reinitializeS3Client } from "./uploader.js";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { startRealtimeWatcher } from "./realtime-watcher.js";
import { crawlStyleGuides } from "./style-guide-crawler.js";
import { runPdfTextSample, type PdfSampleAsset, type AiModelDef } from "./pdf-text-sampler.js";

// ── State ───────────────────────────────────────────────────────

let agentId: string = "";
let isScanning = false;
let abortRequested = false;
let lastError: string | undefined;
const MAX_SKIPPED_DIRS = 500;
let skippedDirs: string[] = [];
let isCrawlingStyleGuides = false;
let isSamplingPdfText = false;

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
  dirs_skipped_excluded: 0,
  files_stat_failed: 0,
  files_total_encountered: 0,
  rejected_wrong_type: 0,
  rejected_junk_file: 0,
  noop_unchanged: 0,
  rejected_subfolder: 0,
  skipped_before_min_date: 0,
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
  counters.dirs_skipped_excluded = 0;
  counters.files_stat_failed = 0;
  counters.files_total_encountered = 0;
  counters.rejected_wrong_type = 0;
  counters.rejected_junk_file = 0;
  counters.noop_unchanged = 0;
  counters.rejected_subfolder = 0;
  counters.skipped_before_min_date = 0;
}

// ── Cloud Config State (overridden by heartbeat config sync) ────────

let cloudScanRoots: string[] | null = null; // null = use env fallback
let cloudMountRoot: string | null = null;
let cloudBatchSize: number | null = null;
let cloudConcurrency: number | null = null;
let cloudScanMinDate: string | null = null;
let cloudStyleGuideRoots: string[] = [];
let cloudAnthropicApiKey = "";
let cloudGoogleAiApiKey = "";
let cloudAiModels: AiModelDef[] = [];
let cloudPdfExtractionConfig: { ai_vision_model_id: string } | null = null;

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

async function sendHeartbeat() {
  const effectiveRoots = getEffectiveScanRoots();
  const effectiveMountRoot = cloudMountRoot || config.nasContainerMountRoot;
  const diagnostics: Record<string, unknown> = {
    mount_root_path: effectiveMountRoot,
    scan_roots: effectiveRoots,
  };

  try {
    await stat(effectiveMountRoot);
    diagnostics.mount_root_exists = true;
  } catch {
    diagnostics.mount_root_exists = false;
  }

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
  lastError = undefined;
  logger.debug("Heartbeat sent");

  if (response.config) {
    applyCloudConfig(response.config);
  }

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
    if (response.commands.test_paths) {
      handlePathTest(response.commands.test_paths).catch((e) =>
        logger.error("Path test failed", { error: (e as Error).message })
      );
    }
    if (response.commands.check_update) {
      handleCheckUpdate().catch((e) =>
        logger.error("Update check failed", { error: (e as Error).message })
      );
    }
    if (response.commands.apply_update) {
      handleApplyUpdate();
    }
    // PDF text sample
    if (response.commands.trigger_pdf_text_sample && !isSamplingPdfText) {
      const assets = (response.commands.pdf_text_sample_assets as PdfSampleAsset[]) || [];
      isSamplingPdfText = true;
      logger.info("PDF text sample requested via heartbeat", { count: assets.length });
      runPdfTextSample(assets, config.nasContainerMountRoot, {
        models: cloudAiModels,
        pdf_extraction: cloudPdfExtractionConfig,
        googleApiKey: cloudGoogleAiApiKey,
        anthropicApiKey: cloudAnthropicApiKey,
      }).finally(() => {
        isSamplingPdfText = false;
      });
    }
    // Style guide crawl
    if (response.commands.trigger_style_guide_crawl && !isCrawlingStyleGuides) {
      isCrawlingStyleGuides = true;
      const roots = cloudStyleGuideRoots.length > 0 ? cloudStyleGuideRoots : [];
      logger.info("Style guide crawl requested via heartbeat", { roots });
      crawlStyleGuides(roots).finally(() => {
        isCrawlingStyleGuides = false;
      });
    }
  }

  processSiblingScanRequests().catch((e) =>
    logger.error("Sibling scan processing failed", { error: (e as Error).message })
  );

  if (autoScanEnabled && !isScanning) {
    const elapsedMs = Date.now() - lastScanCompletedAt;
    const intervalMs = autoScanIntervalHours * 60 * 60 * 1000;
    if (elapsedMs >= intervalMs) {
      logger.info("Auto-scan triggered", { intervalHours: autoScanIntervalHours, elapsedMs });
      runScan().catch((e) => logger.error("Auto-scan error", { error: (e as Error).message }));
    }
  }
}

function startHeartbeat() {
  const INTERVAL_MS = 30_000;
  // Fire immediately on startup so the UI reflects the new version/state right away
  sendHeartbeat().catch((e) => logger.error("Heartbeat failed", { error: (e as Error).message }));
  setInterval(() => {
    sendHeartbeat().catch((e) => logger.error("Heartbeat failed", { error: (e as Error).message }));
  }, INTERVAL_MS);
  logger.info("Heartbeat started (30s interval)");
}

// ── Realtime wake callback ───────────────────────────────────────
// Called by startRealtimeWatcher when a SCAN_REQUEST lands in admin_config.
// Fires an immediate heartbeat so the agent picks up the force_scan command
// in milliseconds instead of waiting up to 30s for the next scheduled beat.
// Debounced to 2s so a rapid double-write doesn't send two concurrent heartbeats.

let _lastRealtimeWakeMs = 0;
function onRealtimeScanRequest() {
  const now = Date.now();
  if (now - _lastRealtimeWakeMs < 2_000) return; // debounce
  _lastRealtimeWakeMs = now;
  sendHeartbeat().catch((e) =>
    logger.error("Realtime-triggered heartbeat failed", { error: (e as Error).message }),
  );
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
  style_guide_scanning?: { roots: string[] };
  ai?: {
    anthropic_api_key?: string;
    google_ai_api_key?: string;
    models?: Array<{ id: string; provider: string; apiModel: string; capabilities: string[] }>;
    pdf_extraction?: { ai_vision_model_id?: string } | null;
  };
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
    if (cfg.scanning.scan_min_date !== undefined) {
      // Explicitly assign even when null — null means "clear the date filter"
      cloudScanMinDate = cfg.scanning.scan_min_date ?? null;
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
    const newMode = cfg.windows_render_policy.mode;
    if (newMode !== windowsRenderPolicy?.mode) {
      logger.info("Windows render policy updated", { mode: newMode });
    }
    windowsRenderPolicy = cfg.windows_render_policy;
  }

  // Update windows agent health context
  if (cfg.windows_healthy !== undefined) {
    windowsAgentHealthy = cfg.windows_healthy === true;
  }
  if (cfg.pending_render_jobs !== undefined) {
    pendingRenderJobs = typeof cfg.pending_render_jobs === "number" ? cfg.pending_render_jobs : 0;
  }

  // Update style guide scanning roots
  if (cfg.style_guide_scanning?.roots) {
    cloudStyleGuideRoots = cfg.style_guide_scanning.roots;
  }

  // Update AI config
  if (cfg.ai) {
    if (cfg.ai.anthropic_api_key) cloudAnthropicApiKey = cfg.ai.anthropic_api_key;
    if (cfg.ai.google_ai_api_key) cloudGoogleAiApiKey = cfg.ai.google_ai_api_key;
    if (Array.isArray(cfg.ai.models) && cfg.ai.models.length > 0) cloudAiModels = cfg.ai.models as AiModelDef[];
    if (cfg.ai.pdf_extraction !== undefined) {
      cloudPdfExtractionConfig = (cfg.ai.pdf_extraction as { ai_vision_model_id: string } | null) ?? null;
    }
  }
}
// ── Render Decision Logic ─────────────────────────────────────────

/**
 * Determines whether a file should be deferred to the Windows Render Agent
 * instead of being processed locally.
 * 
 * @param file - The file candidate to evaluate
 * @param quickHash - Pre-computed quick hash for deterministic decisions
 * @param effectiveMode - The effective render mode (from policy or legacy setting)
 * @param policy - The Windows render policy (if set)
 * @param windowsHealthy - Whether the Windows agent is healthy
 * @param pendingJobs - Current pending render job count
 * @returns Object with defer decision and reason
 */
function shouldDeferToWindows(
  file: FileCandidate,
  quickHash: string,
  effectiveMode: "fallback_only" | "primary" | "shared" | undefined,
  policy: WindowsRenderPolicy | null,
  windowsHealthy: boolean,
  pendingJobs: number,
): { defer: boolean; reason: string | null } {
  // "primary" mode: always defer
  if (effectiveMode === "primary") {
    return { defer: true, reason: "primary_mode" };
  }

  // "fallback_only" mode: never defer proactively
  if (effectiveMode === "fallback_only") {
    return { defer: false, reason: null };
  }

  // "shared" mode: apply policy rules
  if (effectiveMode === "shared" && policy) {
    // File type must be eligible
    if (!policy.shared_types.includes(file.fileType)) {
      return { defer: false, reason: "type_not_eligible" };
    }

    // Health guard: if require_windows_healthy, check the flag
    if (policy.require_windows_healthy && !windowsHealthy) {
      return { defer: false, reason: "windows_unhealthy" };
    }

    // Queue depth guard
    if (pendingJobs >= policy.max_pending_jobs) {
      return { defer: false, reason: "queue_full" };
    }

    // Offload decision: file_size >= shared_min_mb OR hash-deterministic percent
    const meetsMinSize = policy.shared_min_mb > 0 && file.fileSize >= policy.shared_min_mb * 1024 * 1024;
    
    // Deterministic: use quick_hash so re-scans produce same decision
    const hashNum = parseInt(quickHash.slice(0, 8), 16);
    const meetsPercent = (hashNum % 100) < policy.shared_percent;

    if (meetsMinSize || meetsPercent) {
      return { defer: true, reason: "shared_offload" };
    }
  }

  return { defer: false, reason: null };
}

// ── Thumbnail pipeline (bounded concurrency) ────────────────────

async function processThumbnail(
  file: FileCandidate,
  tempAssetId: string,
): Promise<{ thumbnailUrl?: string; thumbnailError?: string; width?: number; height?: number; pdfPage2Url?: string }> {
  try {
    const result = await generateThumbnail(file.absolutePath, file.fileType);
    const url = await uploadThumbnail(tempAssetId, result.buffer);

    let pdfPage2Url: string | undefined;

    // For PDFs, upload hi-res page images
    if ("hiresPage1Buffer" in result) {
      const pdfResult = result as PdfThumbnailResult;
      // Upload hi-res page 1
      await uploadPdfPage(tempAssetId, 1, pdfResult.hiresPage1Buffer);
      // Upload hi-res page 2 if available
      if (pdfResult.hiresPage2Buffer) {
        pdfPage2Url = await uploadPdfPage(tempAssetId, 2, pdfResult.hiresPage2Buffer);
      }
    }

    return { thumbnailUrl: url, width: result.width, height: result.height, pdfPage2Url };
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

/**
 * Safe wrapper for scan progress reporting.
 * Progress reports are telemetry — a network hiccup or DB timeout must never
 * hard-stop an otherwise healthy scan. Logs failures at warn level and continues.
 */
async function safeScanProgress(
  sessionId: string,
  status: "running" | "completed" | "completed_with_errors" | "failed",
  currentCounters: api.Counters,
  message?: string,
  dirs?: string[],
) {
  try {
    await api.scanProgress(sessionId, status, currentCounters, message, dirs);
  } catch (e) {
    logger.warn("Failed to report scan progress (non-fatal)", {
      status,
      error: (e as Error).message,
    });
  }
}

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
      const ageMs = Date.now() - new Date(checkpoint.saved_at).getTime();
      const isDifferentSession = checkpoint.session_id !== sessionId;

      if (isDifferentSession) {
        // Checkpoint belongs to a different scan session. Never resume from it.
        //
        // A different-session checkpoint is typically left over from a previous scan
        // that completed but whose clearCheckpoint call failed (network error). If we
        // resumed from it, the new scan would skip every directory up to
        // last_completed_dir — often ALL directories — reporting "no new assets."
        //
        // Resume only applies to the SAME session (agent crashed mid-scan and the
        // same session_id was re-requested).
        logger.warn("Discarding checkpoint from different session — starting fresh scan", {
          checkpointSession: checkpoint.session_id,
          currentSession: sessionId,
          savedAt: checkpoint.saved_at,
          ageHours: Math.round(ageMs / 3_600_000),
        });
        await api.clearCheckpoint().catch((e) =>
          logger.warn("Failed to clear different-session checkpoint", { error: (e as Error).message })
        );
      } else {
        // Same session = agent crashed mid-scan and was restarted with the same session_id.
        // Resume from where it left off.
        logger.info("Found checkpoint for current session, resuming scan", {
          lastCompletedDir: checkpoint.last_completed_dir,
          savedAt: checkpoint.saved_at,
          ageHours: Math.round(ageMs / 3_600_000),
        });
        resumeFromDir = checkpoint.last_completed_dir;
      }
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
      await safeScanProgress(sessionId, "failed", counters);
      await api.clearCheckpoint().catch(() => {});
      return;
    }

    await safeScanProgress(sessionId, "running", counters, undefined, skippedDirs);

    // Collect files and process in batches
    let batch: FileCandidate[] = [];
    let currentTopLevelDir: string | null = null;

    // Reset skipped directories for this scan (module-level so processBatch can access)
    skippedDirs = [];

    // Throttled progress reporter for directory walking
    let lastProgressAt = 0;
    const PROGRESS_INTERVAL_MS = 2000;
    // Track files processed for periodic checkpointing (every 500 files)
    let lastCheckpointFileCount = 0;
    const CHECKPOINT_FILE_INTERVAL = 500;

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
                lastCheckpointFileCount = counters.files_checked;
              }
              currentTopLevelDir = topLevelFull;
            }
            break;
          }
        }

        // Periodic checkpoint every 500 files, regardless of directory boundaries
        if (
          currentTopLevelDir &&
          counters.files_checked - lastCheckpointFileCount >= CHECKPOINT_FILE_INTERVAL
        ) {
          api.saveCheckpoint(sessionId, currentTopLevelDir).catch((e) =>
            logger.warn("Failed to save periodic checkpoint", { error: (e as Error).message })
          );
          lastCheckpointFileCount = counters.files_checked;
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

    for await (const file of scanFiles(counters, effectiveRoots, callbacks, resumeFromDir, cloudMountRoot || config.nasContainerMountRoot)) {
      if (abortRequested) {
        logger.info("Scan aborted by cloud request");
        await safeScanProgress(sessionId, "failed", counters, "Aborted by user", skippedDirs);
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
      await safeScanProgress(sessionId, "failed", counters, "Aborted by user", skippedDirs);
      return;
    }

    // §4.3: "0 files checked" is an error (only if not resuming — resumed scans may legitimately have fewer files)
    if (counters.files_checked === 0 && !resumeFromDir) {
      logger.error("Scan completed with 0 files checked — treating as error");
      counters.errors++;
      await safeScanProgress(sessionId, "failed", counters, undefined, skippedDirs);
      return;
    }

    // Determine final status: completed_with_errors if some files failed but scan overall succeeded
    const finalStatus = counters.errors > 0 ? "completed_with_errors" : "completed";
    logger.info("Scan completed", { counters, resumed: !!resumeFromDir, skippedDirs: skippedDirs.length, finalStatus });
    await safeScanProgress(sessionId, finalStatus, counters, undefined, skippedDirs);
    // Clear checkpoint on successful completion — retry once to prevent stale resume on the next scan
    try {
      await api.clearCheckpoint();
    } catch (e) {
      logger.warn("Failed to clear checkpoint (retrying once)", { error: (e as Error).message });
      await api.clearCheckpoint().catch((e2) =>
        logger.error("Failed to clear checkpoint after retry — next scan may skip directories", {
          error: (e2 as Error).message,
        })
      );
    }
  } catch (e) {
    lastError = (e as Error).message;
    logger.error("Scan failed with exception", { error: lastError });
    await safeScanProgress(sessionId, "failed", counters, undefined, skippedDirs);
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
    // Note: files_checked was already incremented in the scanner when each file was yielded.
    // Do NOT add unchanged here — that would double-count those files in the counter.
    logger.debug(`Skipping ${unchanged}/${batch.length} unchanged files in batch`);
  }

  // Files needing thumbnail retry: generate thumbnail + ingest (but they're otherwise unchanged)
  const thumbRetryFiles = batch.filter((f) => needsThumbnailSet.has(f.relativePath));
  if (thumbRetryFiles.length > 0) {
    logger.info(`Retrying thumbnails for ${thumbRetryFiles.length} previously failed files`);
  }

  const filesToProcess = batch.filter((f) => changedSet.has(f.relativePath));
  const allToProcess = [...filesToProcess, ...thumbRetryFiles];
  if (allToProcess.length === 0) {
    // Report progress even if nothing to process — fire-and-forget, never kill the scan
    api.scanProgress(sessionId, "running", counters, batch[batch.length - 1]?.relativePath, skippedDirs).catch(() => {});
    return;
  }

  // Process changed files with bounded thumbnail concurrency
  const concurrency = getEffectiveConcurrency();
  let i = 0;

  while (i < allToProcess.length) {
    const chunk = allToProcess.slice(i, i + concurrency);
    await Promise.all(chunk.map((file) => processFile(file)));
    i += concurrency;

    // Report progress — fire-and-forget, never kill the scan
    api.scanProgress(sessionId, "running", counters, allToProcess[Math.min(i, allToProcess.length) - 1]?.relativePath, skippedDirs).catch(() => {});
  }
}

async function processFile(file: FileCandidate) {
  // Skip files older than the configured scan min date
  if (cloudScanMinDate && file.modifiedAt < new Date(cloudScanMinDate)) {
    counters.skipped_before_min_date++;
    return;
  }

  try {
    // 1. Quick hash
    const { quick_hash, quick_hash_version } = await computeQuickHash(file.absolutePath);

    // 2. Thumbnail strategy — uses new policy if set, else legacy mode
    let thumb: { thumbnailUrl?: string; thumbnailError?: string; width?: number; height?: number; pdfPage2Url?: string } = {};
    const effectiveMode = windowsRenderPolicy?.mode ?? windowsRenderMode;
    const policy = windowsRenderPolicy;

    // ── Step 2a: Determine if we should defer to Windows BEFORE local thumbnailing ──
    const deferDecision = shouldDeferToWindows(
      file,
      quick_hash,
      effectiveMode,
      policy,
      windowsAgentHealthy,
      pendingRenderJobs,
    );

    // ── Step 2b: Either defer or attempt local thumbnail ──
    if (deferDecision.defer) {
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
      pdf_page2_url: thumb.pdfPage2Url,
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
      if (deferDecision.defer && isNewOrChanged) {
        return deferDecision.reason;
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
        if (deferDecision.defer) pendingRenderJobs++; // local estimate for queue depth guard
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

// ── Sibling Scan Handler ─────────────────────────────────────────

let siblingScanInProgress = false;

async function processSiblingScanRequests() {
  if (siblingScanInProgress) return;
  siblingScanInProgress = true;

  try {
    const request = await api.claimSiblingScan();
    if (!request) return;

    logger.info("Sibling scan claimed", { requestId: request.request_id, folder: request.folder_path });

    const effectiveMountRoot = (cloudMountRoot || config.nasContainerMountRoot).replace(/\/+$/, "");
    // Build absolute path: mountRoot + "/" + folder_path
    const folderPath = request.folder_path.replace(/^\/+/, "").replace(/\/+$/, "");
    const absoluteFolder = `${effectiveMountRoot}/${folderPath}`;

    // Safety: ensure resolved path stays inside mount root (no traversal)
    const { resolve } = await import("node:path");
    const resolved = resolve(absoluteFolder);
    if (!resolved.startsWith(resolve(effectiveMountRoot))) {
      logger.error("Sibling scan path traversal blocked", { requested: absoluteFolder, resolved });
      await api.completeSiblingScan(request.request_id, "failed", [], "Path traversal detected — folder is outside allowed mount root");
      return;
    }

    // Check folder exists
    try {
      const s = await stat(resolved);
      if (!s.isDirectory()) {
        await api.completeSiblingScan(request.request_id, "failed", [], `Path exists but is not a directory: ${folderPath}`);
        return;
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const msg = code === "ENOENT" ? `Folder not found: ${folderPath}` : code === "EACCES" ? `Permission denied: ${folderPath}` : `Cannot access folder: ${(e as Error).message}`;
      logger.warn("Sibling scan folder inaccessible", { folder: folderPath, error: msg });
      await api.completeSiblingScan(request.request_id, "failed", [], msg);
      return;
    }

    // List image files (non-recursive)
    const entries = await readdir(resolved, { withFileTypes: true });
    const extensions = new Set((request.extensions || [".jpg", ".jpeg", ".png"]).map(e => e.toLowerCase()));
    const images: api.SiblingImageResult[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = "." + entry.name.split(".").pop()?.toLowerCase();
      if (!extensions.has(ext)) continue;

      // Apply the same PDF keyword filter used by the main scanner
      if (ext === ".pdf" && !isPdfCandidate(entry.name)) continue;

      try {
        const filePath = `${resolved}/${entry.name}`;
        const fileStat = await stat(filePath);
        const result: api.SiblingImageResult = {
          filename: entry.name,
          relative_path: `${folderPath}/${entry.name}`,
          file_size: fileStat.size,
        };

        // Generate and upload a small thumbnail for preview
        try {
          let buffer: Buffer;
          if (ext === ".pdf") {
            const thumbResult = await generateThumbnail(filePath, "pdf");
            buffer = thumbResult.buffer;
          } else {
            const sharp = (await import("sharp")).default;
            buffer = await sharp(filePath)
              .flatten({ background: "#ffffff" })
              .resize(400, 400, { fit: "inside", withoutEnlargement: true })
              .jpeg({ quality: 75 })
              .toBuffer();
          }

          // Upload to DO Spaces under siblings/ prefix using a hash of relative_path
          const { createHash } = await import("node:crypto");
          const pathHash = createHash("md5").update(result.relative_path).digest("hex");
          const { uploadSiblingThumbnail } = await import("./uploader.js");
          result.thumbnail_url = await uploadSiblingThumbnail(pathHash, buffer);
        } catch (thumbErr) {
          logger.warn("Sibling thumbnail generation failed", {
            file: entry.name,
            error: (thumbErr as Error).message,
          });
        }

        images.push(result);
      } catch {
        // Skip files we can't stat
      }
    }

    await api.completeSiblingScan(request.request_id, "completed", images);
    logger.info("Sibling scan completed", { requestId: request.request_id, folder: folderPath, imageCount: images.length });
  } catch (e) {
    logger.error("Sibling scan error", { error: (e as Error).message });
  } finally {
    siblingScanInProgress = false;
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

  // Always check :stable — never use the running container's version tag,
  // which would always compare against itself and never detect a newer image.
  const checkTag = "stable";
  const pullImage = `ghcr.io/u2giants/popdam-bridge:${checkTag}`;

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
      checked_tag: checkTag,
      checked_at: new Date().toISOString(),
    });

    logger.info("Update check complete", { updateAvailable, tag: checkTag, currentDigest: currentDigest.trim(), latestDigest: latestDigest.trim() });
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
  logger.info("Self-update requested — pulling latest image and recreating container");
  const composePath = process.env.POPDAM_COMPOSE_PATH || "/volume1/docker/popdam/docker-compose.yml";
  logger.info("Using compose path for restart", { composePath });
  const { exec } = require("node:child_process");

  // Report status before starting
  api.reportUpdateStatus({
    status: "updating",
    started_at: new Date().toISOString(),
  }).catch(() => {});

  // Pull :stable explicitly first so we get the latest image regardless of what
  // tag the compose file pins, then recreate the container.
  exec(
    `docker pull ghcr.io/u2giants/popdam-bridge:stable && docker compose -f ${composePath} pull && docker compose -f ${composePath} up -d --force-recreate`,
    { timeout: 300_000 },
    (err: Error | null) => {
      if (err) {
        logger.error("Self-update exec failed", { error: err.message });
        api.reportUpdateStatus({
          status: "failed",
          error: err.message,
          failed_at: new Date().toISOString(),
        }).catch(() => {});
      }
      // On success the container is replaced — this process exits naturally
    }
  );
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

  // 1. Register with cloud — refreshes key hash in DB to prevent persistent 401s.
  // If a saved agent ID exists (already paired), use it immediately and re-register
  // in the background so the heartbeat starts without waiting for up to 5×30s retries.
  if (!agentId) {
    if (config.savedAgentId) {
      // Fast path: use persisted agent ID so heartbeat starts immediately.
      // Background re-registration updates the key hash in DB.
      agentId = config.savedAgentId;
      logger.info("Using saved agent ID, re-registering in background", { agentId });
      api.register(config.agentName)
        .then((id) => {
          agentId = id;
          logger.info("Background re-registration complete", { agentId });
        })
        .catch((e) =>
          logger.warn("Background re-registration failed (non-fatal)", { error: (e as Error).message })
        );
    } else {
      // First-time startup: must register synchronously (no saved ID to fall back on).
      try {
        agentId = await api.register(config.agentName);
        logger.info("Registered with cloud API", { agentId });
      } catch (e) {
        logger.error("Failed to register with cloud API — exiting", { error: (e as Error).message });
        process.exit(1);
      }
    }
  }

  // 2. Start heartbeat (independent timer — fallback command channel)
  startHeartbeat();

  // 3. Start Realtime watcher (instant scan-request delivery when SUPABASE_ANON_KEY is set)
  startRealtimeWatcher(config.supabaseUrl, config.supabaseAnonKey, agentId, onRealtimeScanRequest);

  // 4. Ready
  logger.info("Agent ready");
}

main().catch((e) => {
  logger.error("Fatal error", { error: (e as Error).message });
  process.exit(1);
});
