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
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { exec } from "node:child_process";
import { stat, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { validateScanRoots, scanFiles, isPdfCandidate, type FileCandidate, type ScanCallbacks } from "./scanner.js";
import { computeQuickHash } from "./hasher.js";
import { generateThumbnail, isAiWithoutPdfCompat, isCompatAlertThumbnail, createCompatAuditWorker, type PdfThumbnailResult } from "./thumbnailer.js";
import { uploadThumbnail, uploadPdfPage, reinitializeS3Client } from "./uploader.js";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
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
let isAuditingCompatThumbnails = false;
let isPreviewingCompatThumbnails = false;

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
    if (response.commands.browse_dir) {
      handleDirBrowse(response.commands.browse_dir as { request_id: string; path: string }).catch((e) =>
        logger.error("Dir browse failed", { error: (e as Error).message })
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
    // Compat audit
    if (response.commands.audit_compat_thumbnails && !isAuditingCompatThumbnails) {
      isAuditingCompatThumbnails = true;
      logger.info("Compat thumbnail audit requested via heartbeat");
      runCompatAudit().finally(() => {
        isAuditingCompatThumbnails = false;
      });
    }
    // Compat audit preview (scan first batch only, no clearing)
    if (response.commands.audit_compat_preview && !isPreviewingCompatThumbnails && !isAuditingCompatThumbnails) {
      isPreviewingCompatThumbnails = true;
      logger.info("Compat thumbnail preview requested via heartbeat");
      runCompatAuditPreview().finally(() => {
        isPreviewingCompatThumbnails = false;
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

async function ensureRootMarkers(
  rootMappings: Array<{ root_id: string; display_name: string; server_path: string }>,
): Promise<void> {
  const mountRoot = (cloudMountRoot || config.nasContainerMountRoot).replace(/\/+$/, "");
  for (const rm of rootMappings) {
    if (!rm.root_id || !rm.server_path) continue;
    // server_path may be absolute (e.g. /mnt/nas/mac/Decor) or relative (e.g. Decor)
    const rootPath = rm.server_path.startsWith("/")
      ? rm.server_path.replace(/\/+$/, "")
      : `${mountRoot}/${rm.server_path.replace(/^\/+/, "")}`;
    const markerPath = `${rootPath}/.pop-root.json`;

    try {
      const s = await stat(rootPath);
      if (!s.isDirectory()) {
        logger.warn("Root marker: path is not a directory", { rootId: rm.root_id, path: rootPath });
        continue;
      }
    } catch {
      logger.warn("Root marker: path not accessible", { rootId: rm.root_id, path: rootPath });
      continue;
    }

    // Skip if marker already correct
    try {
      const existing = JSON.parse(await readFile(markerPath, "utf-8"));
      if (existing.root_id === rm.root_id && existing.type === "pop-dam-root") continue;
    } catch { /* not found or invalid — write it */ }

    const marker = {
      type: "pop-dam-root",
      root_id: rm.root_id,
      company: "POP Creations",
      created_by: "POP DAM Bridge Agent",
      canonical_server_path: rm.server_path,
      do_not_move: true,
      schema_version: 1,
    };
    await writeFile(markerPath, JSON.stringify(marker, null, 2), "utf-8");
    logger.info("Root marker written", { rootId: rm.root_id, path: markerPath });
  }
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

  // Write .pop-root.json markers to each NAS root so Helper users can auto-validate
  // Derived from scan roots — same source of truth, no separate config needed
  if (cfg.scanning?.roots && cfg.scanning.roots.length > 0) {
    const rootMappings = cfg.scanning.roots.map((r) => {
      const name = r.replace(/\/+$/, "").split("/").pop() || r;
      return { root_id: name, display_name: name, server_path: r };
    });
    ensureRootMarkers(rootMappings).catch((e) =>
      logger.warn("Root marker write failed (non-fatal)", { error: (e as Error).message })
    );
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

// ── Compat audit ────────────────────────────────────────────────────────────
// Reads source AI files for all assets that currently have thumbnail_url set.
// Checks each file for the /CompatibilityAlert marker (Illustrator saved without
// PDF compatibility). Clears thumbnails for matches so the asset is re-queued
// for proper rendering (Windows Render Agent / Inkscape path).

async function runCompatAudit(): Promise<void> {
  logger.info("Starting compat thumbnail audit (OCR-based)");
  let afterId: string | null = null;
  let totalScanned = 0;
  let totalCleared = 0;

  const worker = await createCompatAuditWorker();
  try {
    while (true) {
      const { assets, batch_size } = await api.getCompatAuditBatch(afterId);
      if (!assets || assets.length === 0) break;

      const badIds: string[] = [];

      for (const asset of assets) {
        totalScanned++;
        if (!asset.thumbnail_url) continue;
        const isPlaceholder = await isCompatAlertThumbnail(asset.thumbnail_url, worker);
        if (isPlaceholder) {
          badIds.push(asset.id);
          logger.info("Compat audit: flagging placeholder thumbnail", { path: asset.relative_path });
        }
      }

      if (badIds.length > 0) {
        await api.clearCompatThumbnails(badIds);
        totalCleared += badIds.length;
        logger.info("Compat audit: cleared placeholder thumbnails", { cleared: badIds.length, cumulative: totalCleared });
      }

      if (assets.length < batch_size) break; // last page
      afterId = assets[assets.length - 1].id;
    }

    logger.info("Compat thumbnail audit complete", { scanned: totalScanned, cleared: totalCleared });
    await api.completeCompatAudit(totalScanned, totalCleared);
  } catch (e) {
    const msg = (e as Error).message;
    logger.error("Compat thumbnail audit failed", { error: msg, scanned: totalScanned, cleared: totalCleared });
    await api.completeCompatAudit(totalScanned, totalCleared, msg).catch(() => {});
  } finally {
    await worker.terminate();
  }
}

// ── Compat audit preview ─────────────────────────────────────────────────────
// Scans ALL AI assets across all batches and reports which are flagged as
// compatibility-alert placeholders — WITHOUT clearing anything.
// Uses Tesseract OCR on each stored thumbnail to detect the warning page
// visually, so it only flags thumbnails that *actually look wrong* regardless
// of what the source .ai file contains.
// Sends live progress after each batch so the UI can show thumbnails as they
// accumulate. Lets the admin visually confirm every affected asset before
// committing to the destructive full audit.

async function runCompatAuditPreview(): Promise<void> {
  logger.info("Starting compat thumbnail preview (OCR-based, all batches, no clearing)");
  let afterId: string | null = null;
  let totalScanned = 0;
  const allFlagged: api.CompatAuditPreviewFlagged[] = [];

  const worker = await createCompatAuditWorker();
  try {
    while (true) {
      const { assets, batch_size } = await api.getCompatAuditBatch(afterId);
      if (!assets || assets.length === 0) break;

      for (const asset of assets) {
        totalScanned++;
        if (!asset.thumbnail_url) continue;
        const isPlaceholder = await isCompatAlertThumbnail(asset.thumbnail_url, worker);
        if (isPlaceholder) {
          allFlagged.push({ id: asset.id, thumbnail_url: asset.thumbnail_url, relative_path: asset.relative_path });
          logger.info("Compat preview: flagged placeholder", { path: asset.relative_path });
        }
      }

      // Report incremental progress after each batch so the UI updates live
      await api.updateCompatAuditPreview(totalScanned, allFlagged).catch(() => {});

      if (assets.length < batch_size) break; // last page
      afterId = assets[assets.length - 1].id;
    }

    logger.info("Compat thumbnail preview complete", { scanned: totalScanned, flagged: allFlagged.length });
    await api.completeCompatAuditPreview(totalScanned, allFlagged);
  } catch (e) {
    const msg = (e as Error).message;
    logger.error("Compat thumbnail preview failed", { error: msg, scanned: totalScanned });
    await api.completeCompatAuditPreview(totalScanned, allFlagged, msg).catch(() => {});
  } finally {
    await worker.terminate();
  }
}

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

async function handleDirBrowse(cmd: { request_id: string; path: string }) {
  const target = cmd.path.trim();
  logger.info("Dir browse requested", { requestId: cmd.request_id, path: target });

  try {
    let entries: api.DirEntry[];

    if (!target) {
      // Empty path → list scan roots
      const scanRootsCfg = config.scanRoots ?? [];
      entries = await Promise.all(
        scanRootsCfg.map(async (root: string) => {
          try {
            const s = await stat(root);
            return { name: root, is_dir: s.isDirectory() };
          } catch {
            return { name: root, is_dir: true };
          }
        })
      );
    } else {
      const rawEntries = await readdir(target, { withFileTypes: true });
      entries = await Promise.all(
        rawEntries.map(async (e) => {
          const entry: api.DirEntry = { name: e.name, is_dir: e.isDirectory() };
          if (!e.isDirectory()) {
            try {
              const s = await stat(`${target}/${e.name}`);
              entry.size = s.size;
              entry.modified = s.mtime.toISOString();
            } catch { /* skip */ }
          }
          return entry;
        })
      );
    }

    await api.reportDirBrowse(cmd.request_id, target, entries);
    logger.info("Dir browse completed", { path: target, count: entries.length });
  } catch (e) {
    const msg = (e as NodeJS.ErrnoException).message ?? String(e);
    logger.warn("Dir browse failed", { path: target, error: msg });
    await api.reportDirBrowse(cmd.request_id, target, []);
  }
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

    // Detect current container ID from hostname (Docker sets hostname = container ID
    // by default). This avoids hardcoding a container name that may differ between
    // Synology Container Manager stacks (e.g. "popdam-popdam-bridge-1" vs "popdam-bridge").
    const { stdout: hostnameOut } = await execFileAsync("hostname");
    const containerId = hostnameOut.trim();

    const { stdout: currentDigest } = await execFileAsync(
      "docker", ["inspect", containerId, "--format={{.Image}}"]
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

    logger.info("Update check complete", { updateAvailable, tag: checkTag, containerId, currentDigest: currentDigest.trim(), latestDigest: latestDigest.trim() });
  } catch (e) {
    logger.error("Update check failed", { error: (e as Error).message });
    await api.reportUpdateStatus({
      error: (e as Error).message,
      update_available: false,
      checked_at: new Date().toISOString(),
    }).catch(() => {});
  }
}

async function handleApplyUpdate() {
  logger.info("Self-update requested — pulling latest image and restarting container");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const startedAt = new Date().toISOString();
  const NEW_IMAGE = "ghcr.io/u2giants/popdam-bridge:stable";

  // ── Pre-flight: verify Docker socket is accessible ────────────────
  try {
    await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"]);
  } catch (e) {
    const msg = `Docker socket not accessible — ensure /var/run/docker.sock is mounted in docker-compose.yml. Error: ${(e as Error).message}`;
    logger.error("Self-update pre-flight failed", { error: msg });
    await api.reportUpdateStatus({ status: "failed", error: msg, started_at: startedAt, failed_at: new Date().toISOString() }).catch(() => {});
    return;
  }

  // Get container ID from hostname (Docker sets hostname = short container ID).
  const containerId = (await execFileAsync("hostname")).stdout.trim();
  logger.info("Self-update starting", { containerId });

  await api.reportUpdateStatus({ status: "updating", started_at: startedAt, container_id: containerId }).catch(() => {});

  // ── Step 1: Pull the latest :stable image ─────────────────────────
  try {
    logger.info(`Pulling ${NEW_IMAGE} ...`);
    await execFileAsync("docker", ["pull", NEW_IMAGE], { timeout: 240_000 } as never);
    logger.info("Pull complete");
  } catch (e) {
    const msg = `docker pull failed: ${(e as Error).message}`;
    logger.error("Self-update pull failed", { error: msg });
    await api.reportUpdateStatus({ status: "failed", error: msg, started_at: startedAt, failed_at: new Date().toISOString() }).catch(() => {});
    return;
  }

  // ── Step 2: Inspect container to find compose project dir ─────────
  // Docker Compose sets com.docker.compose.project.working_dir on all
  // containers it creates — use that to find the compose file without
  // requiring POPDAM_COMPOSE_PATH to be set.
  let composePath: string | null = null;
  try {
    const { stdout: workingDirOut } = await execFileAsync("docker", [
      "inspect", containerId,
      "--format", '{{index .Config.Labels "com.docker.compose.project.working_dir"}}',
    ]);
    const workingDir = workingDirOut.trim();
    if (workingDir) {
      for (const name of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
        const candidate = `${workingDir}/${name}`;
        try { await stat(candidate); composePath = candidate; break; } catch { /* try next */ }
      }
    }
  } catch { /* inspect failed — fall through */ }

  // Fall back to explicit env var or Synology default
  if (!composePath) {
    const envPath = process.env.POPDAM_COMPOSE_PATH;
    if (envPath) {
      composePath = envPath;
    } else {
      // Try common Synology Container Manager project paths
      for (const candidate of [
        "/volume1/docker/popdam/docker-compose.yml",
        "/volume1/docker/popdam3/docker-compose.yml",
        "/volume1/docker/popdam-bridge/docker-compose.yml",
      ]) {
        try { await stat(candidate); composePath = candidate; break; } catch { /* try next */ }
      }
    }
  }

  // ── Step 3a: Recreate via docker compose (preferred) ──────────────
  if (composePath) {
    logger.info("Recreating container via compose", { composePath });
    exec(
      `docker compose -f "${composePath}" up -d --force-recreate`,
      { timeout: 120_000 },
      async (err: Error | null) => {
        if (!err) return; // new container is up — this one exits naturally
        logger.warn("docker compose up failed — falling back to docker run recreation", { error: err.message });
        await recreateViaDockerRun(containerId, NEW_IMAGE, startedAt, execFileAsync);
      },
    );
    return;
  }

  // ── Step 3b: No compose file found — recreate via docker run ───────
  logger.warn("No compose file found — recreating container via docker run");
  await recreateViaDockerRun(containerId, NEW_IMAGE, startedAt, execFileAsync);
}

async function recreateViaDockerRun(
  containerId: string,
  newImage: string,
  startedAt: string,
  execFileAsync: (cmd: string, args: string[], opts?: object) => Promise<{ stdout: string; stderr: string }>,
) {
  try {
    // Inspect the running container to clone its config
    const { stdout: inspectOut } = await execFileAsync("docker", [
      "inspect", containerId, "--format", "{{json .}}",
    ]);
    const info = JSON.parse(inspectOut.trim());

    const rawName: string = info.Name || "";
    const containerName = rawName.replace(/^\//, ""); // strip leading slash

    // Collect -e flags
    const envArgs: string[] = (info.Config?.Env ?? []).flatMap((e: string) => ["-e", e]);

    // Collect -v flags, stripping :ro from all bind mounts so the recreated container
    // always has read-write access (fixes NAS volume mounted :ro via old install bundle).
    const bindArgs: string[] = (info.HostConfig?.Binds ?? []).flatMap((b: string) => ["-v", b.replace(/:ro$/, "")]);

    // Collect --network flags (connect to first network; others added after start)
    const networks = Object.keys(info.NetworkSettings?.Networks ?? {});
    const primaryNetwork = networks[0];
    const networkArgs: string[] = primaryNetwork ? ["--network", primaryNetwork] : [];

    // Restart policy
    const restartPolicy: string = info.HostConfig?.RestartPolicy?.Name || "unless-stopped";
    const restartArgs = ["--restart", restartPolicy];

    // Rename ourselves to a temp name first — this frees up the original name
    // while we're still running, so the new container can claim it immediately.
    // docker rename works on running containers without disrupting the process.
    const oldTempName = `${containerName}-old-${Date.now()}`;
    logger.info("Renaming current container to free up name", { from: containerName, to: oldTempName });
    await execFileAsync("docker", ["rename", containerId, oldTempName]);

    // Use inspected image if caller didn't specify one (e.g. self-heal path)
    const imageToRun = newImage || (info.Config?.Image as string) || "";
    if (!imageToRun) throw new Error("Cannot determine image name for recreated container");

    // Start new container with the ORIGINAL name — no rename needed at the end
    logger.info("Starting replacement container", { name: containerName, image: imageToRun });
    await execFileAsync("docker", [
      "run", "-d",
      "--name", containerName,
      ...restartArgs,
      ...networkArgs,
      ...envArgs,
      ...bindArgs,
      imageToRun,
    ]);

    // Suppress SIGTERM so we can complete cleanup before exiting.
    // docker stop sends SIGTERM to us (via dumb-init), which would kill node
    // before docker rm can run. We ignore it, finish cleanup, then exit.
    process.removeAllListeners("SIGTERM");
    process.on("SIGTERM", () => { /* suppressed — cleanup in progress */ });

    // Fire docker stop on ourselves (now named oldTempName, still same containerId)
    exec(`docker stop --time 15 ${containerId}`, () => {});

    // Wait for SIGTERM to be delivered, then remove ourselves
    await new Promise(r => setTimeout(r, 2_000));
    await execFileAsync("docker", ["rm", containerId]).catch(() => {});

    logger.info("Container recreated successfully via docker run", { containerName });
    // Exit cleanly — docker stop was already issued so unless-stopped won't restart
    process.exit(0);
  } catch (e) {
    const msg = `Failed to recreate container: ${(e as Error).message}. Mount the compose file into the container or set POPDAM_COMPOSE_PATH.`;
    logger.error("Self-update recreation failed", { error: msg });
    await api.reportUpdateStatus({ status: "failed", error: msg, started_at: startedAt, failed_at: new Date().toISOString() }).catch(() => {});
  }
}

/**
 * On startup, write a small test file into the NAS mount root.
 * If the filesystem is read-only (EROFS), recreate the container without :ro
 * on the bind mounts so the next start can write marker files normally.
 */
async function checkAndHealReadOnlyMount(): Promise<void> {
  const testPath = join(config.nasContainerMountRoot, ".pop-rw-test");
  try {
    writeFileSync(testPath, "rw-check");
    unlinkSync(testPath);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EROFS" || code === "EACCES") {
      logger.warn("NAS volume is read-only — recreating container without :ro bind mounts", {
        mountRoot: config.nasContainerMountRoot,
        code,
      });
      const selfId = process.env.HOSTNAME ?? "";
      if (!selfId) {
        logger.error("Cannot self-heal: HOSTNAME env var not set (container ID unknown)");
        return;
      }
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      // Pass empty newImage — recreateViaDockerRun falls back to docker inspect image.
      await recreateViaDockerRun(selfId, "", new Date().toISOString(), execFileAsync);
      // recreateViaDockerRun calls process.exit(0) on success; reaching here means
      // it failed — log and continue so the rest of startup can proceed (degraded).
    }
    // ENOENT = mount root doesn't exist yet (scanRoot not configured); skip silently.
  }
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

  // Self-heal: if NAS volume is mounted read-only, recreate container without :ro
  await checkAndHealReadOnlyMount();

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
  const cleanupRealtime = startRealtimeWatcher(config.supabaseUrl, config.supabaseAnonKey, agentId, onRealtimeScanRequest);

  // 4. Graceful shutdown — close Realtime WebSocket so the server-side subscription is
  // released immediately rather than waiting for the TCP timeout (up to ~90s on Synology).
  // Without this, each container restart leaves an orphaned subscription on the Supabase
  // Realtime server until it detects the dead connection, which can accumulate over time.
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal} — closing Realtime connection and exiting`);
    await cleanupRealtime();
    process.exit(0);
  };
  process.on("SIGTERM", () => { shutdown("SIGTERM").catch(() => process.exit(0)); });
  process.on("SIGINT",  () => { shutdown("SIGINT").catch(() => process.exit(0)); });

  // 5. Ready
  logger.info("Agent ready");
}

// ── Multi-tenant entry: if TENANTS env is set and we are NOT a child, run supervisor ──
import { parseTenants, runSupervisor } from "./tenant-supervisor.js";

async function entry() {
  if (!process.env.POPDAM_TENANT_CHILD) {
    let tenants;
    try {
      tenants = parseTenants();
    } catch (e) {
      logger.error("Invalid TENANTS configuration — exiting", { error: (e as Error).message });
      process.exit(1);
    }
    if (tenants && tenants.length > 0) {
      runSupervisor(tenants);
      return; // supervisor manages children; do not run main()
    }
  } else {
    logger.info("Running as tenant child", {
      tenant: process.env.POPDAM_TENANT_NAME,
      configFile: process.env.POPDAM_DATA_FILE,
    });
  }
  // Single-tenant fallback (legacy behavior)
  await main();
}

entry().catch((e) => {
  logger.error("Fatal error", { error: (e as Error).message });
  process.exit(1);
});
