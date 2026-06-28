/**
 * Cloud API client — all outbound HTTPS calls to agent-api edge function.
 * No inbound networking required per PROJECT_BIBLE §2.
 */

import { config } from "./config.js";
import { logger } from "./logger.js";

async function callApi(action: string, payload: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  const body = JSON.stringify({ action, ...payload });
  const maxAttempts = 5;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(config.agentApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-key": config.agentKey,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs), // hard timeout per request — prevents hung connections stalling the scan
      });

      if (!res.ok) {
        const text = await res.text();
        // Don't retry client errors (4xx) — they are permanent
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`agent-api ${action} returned ${res.status}: ${text}`);
        }
        // Retry server errors (5xx)
        lastError = new Error(`agent-api ${action} returned ${res.status}: ${text}`);
        if (attempt < maxAttempts) {
          const delay = Math.min(5000, 1000 * Math.pow(2, attempt - 1));
          logger.warn(`agent-api ${action} returned ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
          await new Promise( r => setTimeout(r, delay));
          continue;
        }
        throw lastError;
      }

      const data = await res.json();
      if (data && !data.ok) {
        throw new Error(`agent-api ${action} error: ${data.error || "unknown"}`);
      }
      return data;

    } catch (e) {
      // Re-throw already-formatted errors (4xx or data.ok === false)
      if (e instanceof Error && e.message.startsWith("agent-api")) throw e;
      // Network error — retry
      lastError = e as Error;
      if (attempt < maxAttempts) {
        const delay = Math.min(5000, 1000 * Math.pow(2, attempt - 1));
        logger.warn(`agent-api ${action} network error, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`, { error: (e as Error).message });
        await new Promise( r => setTimeout(r, delay));
      }
    }
  }
  throw lastError ?? new Error(`agent-api ${action} failed after ${maxAttempts} attempts`);
}

// ── Public API ──────────────────────────────────────────────────

export async function register(agentName: string): Promise<string> {
  const data = await callApi("register", {
    agent_name: agentName,
    agent_type: "bridge",
    agent_key: config.agentKey,
  });
  return data.agent_id as string;
}

// ── Pairing (unauthenticated — uses one-time pairing code) ─────

export async function pair(
  pairingCode: string,
  agentName: string,
): Promise<{ agent_id: string; agent_key: string }> {
  const res = await fetch(config.agentApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "pair",
      pairing_code: pairingCode,
      agent_name: agentName,
    }),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Pairing failed");
  return { agent_id: data.agent_id, agent_key: data.agent_key };
}

export interface Counters {
  files_checked: number;
  candidates_found: number;
  ingested_new: number;
  moved_detected: number;
  updated_existing: number;
  errors: number;
  roots_invalid: number;
  roots_unreadable: number;
  dirs_skipped_permission: number;
  dirs_skipped_excluded: number;
  files_stat_failed: number;
  files_total_encountered: number;
  rejected_wrong_type: number;
  rejected_junk_file: number;
  noop_unchanged: number;
  rejected_subfolder: number;
  skipped_before_min_date: number;
  rejected_ai_has_pdf_sibling: number;
}

export interface WindowsRenderPolicy {
  mode: "fallback_only" | "shared" | "primary";
  shared_percent: number;
  shared_types: ("psd" | "ai" | "pdf")[];
  shared_min_mb: number;
  require_windows_healthy: boolean;
  max_pending_jobs: number;
  final_fallback_on_local_failure: boolean;
}

export interface HeartbeatResponse {
  ok: boolean;
  config?: {
    do_spaces?: { key: string; secret: string; bucket: string; region: string; endpoint: string };
    scanning?: { container_mount_root: string; roots: string[]; batch_size: number; scan_min_date?: string | null; adaptive_polling: { idle_seconds: number; active_seconds: number } };
    resource_guard?: { cpu_percentage_limit: number; memory_limit_mb: number; concurrency: number };
    windows_render_mode?: "fallback_only" | "primary";
    windows_render_policy?: WindowsRenderPolicy | null;
    windows_healthy?: boolean;
    pending_render_jobs?: number;
    style_guide_scanning?: { roots: string[] };
    ai?: {
      anthropic_api_key?: string;
      google_ai_api_key?: string;
      openai_api_key?: string;
      openrouter_api_key?: string;
      models?: Array<{ id: string; provider: string; apiModel: string; capabilities: string[] }>;
      ai_task_models?: Record<string, string>;
      pdf_extraction?: { ai_vision_model_id?: string } | null;
    };
  };
  commands?: {
    force_scan: boolean;
    scan_session_id?: string;
    abort_scan: boolean;
    test_paths?: {
      request_id: string;
      container_mount_root: string;
      scan_roots: string[];
    } | null;
    check_update?: boolean;
    apply_update?: boolean;
    trigger_style_guide_crawl?: boolean;
    trigger_pdf_text_sample?: boolean;
    pdf_text_sample_assets?: unknown[];
    trigger_ai_sentinel_scan?: boolean;
    ai_sentinel_scan_assets?: Array<{ id: string; filename: string; relative_path: string }>;
    trigger_blank_thumb_cleanup?: boolean;
    blank_thumb_cleanup_assets?: Array<{ id: string; thumbnail_url: string; file_type: string; relative_path: string }>;
    trigger_pdf_backfill?: boolean;
    audit_compat_thumbnails?: boolean;
    audit_compat_preview?: boolean;
    browse_dir?: { request_id: string; path: string } | null;
  };
}

export async function heartbeat(
  agentId: string,
  counters: Counters,
  lastError?: string,
  versionInfo?: { image_tag?: string; version?: string; build_sha?: string },
  diagnostics?: Record<string, unknown>,
): Promise<HeartbeatResponse> {
  // Heartbeat runs 4+ parallel DB queries server-side and can hit Supabase cold starts.
  // Use a 60s timeout (vs. 30s for other calls) so slow responses don't abort prematurely
  // and cause the force_scan command to never reach the agent.
  const data = await callApi("heartbeat", {
    agent_id: agentId,
    counters,
    last_error: lastError,
    version_info: versionInfo,
    diagnostics,
  }, 60_000);
  return data as unknown as HeartbeatResponse;
}

export interface IngestPayload {
  relative_path: string;
  filename: string;
  file_type: "psd" | "ai" | "pdf";
  file_size: number;
  modified_at: string;
  file_created_at: string | null;
  quick_hash: string;
  quick_hash_version: number;
  thumbnail_url?: string;
  thumbnail_error?: string;
  width?: number;
  height?: number;
  pdf_page2_url?: string;
  skip_move_detection?: boolean;
}

export interface IngestResult {
  action: "created" | "updated" | "moved" | "noop" | "rejected_subfolder" | "skipped";
  asset_id: string;
}

export async function ingest(payload: IngestPayload): Promise<IngestResult> {
  const data = await callApi("ingest", payload as unknown as Record<string, unknown>);
  return { action: data.action as IngestResult["action"], asset_id: data.asset_id as string };
}

export async function scanProgress(
  sessionId: string,
  status: "running" | "completed" | "completed_with_errors" | "failed",
  counters: Counters,
  currentPath?: string,
  skippedDirs?: string[],
): Promise<void> {
  await callApi("scan-progress", {
    session_id: sessionId,
    status,
    counters,
    current_path: currentPath,
    ...(status === "failed" && currentPath ? { error: currentPath } : {}),
    ...(skippedDirs && skippedDirs.length > 0 ? { skipped_dirs: skippedDirs } : {}),
  });
}


export async function queueRender(assetId: string, reason: string): Promise<string> {
  const data = await callApi("queue-render", { asset_id: assetId, reason });
  return data.job_id as string;
}

export async function reportPathTest(
  requestId: string,
  results: Record<string, unknown>,
): Promise<void> {
  await callApi("report-path-test", { request_id: requestId, results });
}

export interface DirEntry {
  name: string;
  is_dir: boolean;
  size?: number;
  modified?: string;
}

export async function reportDirBrowse(
  requestId: string,
  path: string,
  entries: DirEntry[],
): Promise<void> {
  await callApi("report-dir-browse", { request_id: requestId, path, entries });
}

export interface CheckChangedFile {
  relative_path: string;
  modified_at: string;
  file_size: number;
}

export interface CheckChangedResult {
  changed: string[];
  needs_thumbnail: string[];
  existing_content_identities: Array<{
    relative_path: string;
    filename: string;
    quick_hash: string;
  }>;
}

export async function checkChanged(files: CheckChangedFile[]): Promise<CheckChangedResult> {
  const data = await callApi("check-changed", { files });
  return {
    changed: (data.changed as string[]) || [],
    needs_thumbnail: (data.needs_thumbnail as string[]) || [],
    existing_content_identities: (data.existing_content_identities as CheckChangedResult["existing_content_identities"]) || [],
  };
}

export interface ScanCheckpoint {
  session_id: string;
  last_completed_dir: string;
  saved_at: string;
  agent_id: string;
}

export async function saveCheckpoint(sessionId: string, lastCompletedDir: string): Promise<void> {
  await callApi("save-checkpoint", { session_id: sessionId, last_completed_dir: lastCompletedDir });
}

export async function getCheckpoint(): Promise<ScanCheckpoint | null> {
  const data = await callApi("get-checkpoint", {});
  return (data.checkpoint as ScanCheckpoint) || null;
}

export async function clearCheckpoint(): Promise<void> {
  await callApi("clear-checkpoint", {});
}

export async function reportUpdateStatus(
  status: Record<string, unknown>,
): Promise<void> {
  await callApi("report-update-status", status);
}

// ── Sibling scan requests ──────────────────────────────────────────

export interface SiblingScanRequest {
  request_id: string;
  folder_path: string;
  extensions: string[];
}

export interface SiblingImageResult {
  filename: string;
  relative_path: string;
  file_size: number;
  thumbnail_url?: string;
}

export async function claimSiblingScan(): Promise<SiblingScanRequest | null> {
  const data = await callApi("claim-sibling-scan", {});
  const req = data.request as SiblingScanRequest | null;
  if (!req || !req.request_id) return null;
  return req;
}

export async function completeSiblingScan(
  requestId: string,
  status: "completed" | "failed",
  images: SiblingImageResult[],
  errorMessage?: string,
): Promise<void> {
  await callApi("complete-sibling-scan", {
    request_id: requestId,
    status,
    images,
    error_message: errorMessage,
  });
}

// ── Style Guide Crawl ──────────────────────────────────────────────

export async function claimStyleGuideCrawl(): Promise<{ run_id: string; roots: string[] } | null> {
  const data = await callApi("claim-style-guide-crawl", {});
  if (!data.run_id) return null;
  return { run_id: data.run_id as string, roots: (data.roots as string[]) || [] };
}

import type { StyleGuideFileRecord } from "./style-guide-crawler.js";
import type { PdfTextSampleResult } from "./pdf-text-sampler.js";

export async function completeStyleGuideCrawl(
  runId: string,
  files: StyleGuideFileRecord[],
  done: boolean,
  totalFiles?: number,
  error?: string,
  inaccessibleRoots?: string[],
): Promise<void> {
  await callApi("complete-style-guide-crawl", {
    run_id: runId,
    files,
    done,
    total_files: totalFiles,
    error,
    inaccessible_roots: inaccessibleRoots?.length ? inaccessibleRoots : undefined,
  });
}

// ── PDF Text Sample ────────────────────────────────────────────────

export async function completePdfTextSample(
  results: PdfTextSampleResult[],
): Promise<void> {
  await callApi("complete-pdf-text-sample", { results }, 60_000);
}

export async function reportPdfTextSampleProgress(payload: Record<string, unknown>): Promise<void> {
  await callApi("pdf-text-sample-progress", payload);
}

// ── Compat Audit ────────────────────────────────────────────────────

export interface CompatAuditAsset {
  id: string;
  relative_path: string;
  thumbnail_url?: string;
}

export async function getCompatAuditBatch(afterId: string | null): Promise<{ assets: CompatAuditAsset[]; batch_size: number }> {
  const data = await callApi("get-compat-audit-batch", afterId ? { after_id: afterId } : {});
  return data as { assets: CompatAuditAsset[]; batch_size: number };
}

export async function clearCompatThumbnails(assetIds: string[]): Promise<void> {
  await callApi("clear-compat-thumbnails", { asset_ids: assetIds });
}

export async function completeCompatAudit(scanned: number, cleared: number, error?: string): Promise<void> {
  await callApi("complete-compat-audit", { scanned, cleared, error });
}

export interface CompatAuditPreviewFlagged {
  id: string;
  thumbnail_url: string;
  relative_path: string;
}

export async function updateCompatAuditPreview(
  scanned: number,
  flagged: CompatAuditPreviewFlagged[],
): Promise<void> {
  await callApi("update-compat-audit-preview", { scanned, flagged });
}

export async function completeCompatAuditPreview(
  scanned: number,
  flagged: CompatAuditPreviewFlagged[],
  error?: string,
): Promise<void> {
  await callApi("complete-compat-audit-preview", { scanned, flagged, error });
}

// ── PDF Backfill ────────────────────────────────────────────────────

export interface BackfillAsset {
  id: string;
  filename: string;
  relative_path: string;
  needs_thumbnail: boolean;
}

export interface BackfillResult {
  asset_id: string;
  filename: string;
  relative_path: string;
  extraction_method: string;
  extracted_text: string | null;
  page_count: number | null;
  char_count: number;
  extraction_error: string | null;
  sample_thumbnail_url: string | null;
  asset_thumbnail_url: string | null;
}

export async function claimPdfBackfillBatch(): Promise<{
  assets: BackfillAsset[];
  remaining: number;
  total: number;
  status: string;
}> {
  const data = await callApi("claim-pdf-backfill-batch", {});
  return data as { assets: BackfillAsset[]; remaining: number; total: number; status: string };
}

export async function completePdfBackfillBatch(
  results: BackfillResult[],
): Promise<{ remaining: number }> {
  const data = await callApi("complete-pdf-backfill-batch", { results }, 120_000);
  return { remaining: (data.remaining as number) ?? 0 };
}

export async function reportPdfBackfillProgress(
  processed: number,
  total: number,
  currentFile: string | null,
  currentStep: string,
): Promise<void> {
  try {
    await callApi("pdf-backfill-progress", { processed, total, current_file: currentFile, current_step: currentStep });
  } catch (e) {
    logger.warn("PDF backfill: progress report failed (non-fatal)", { error: (e as Error).message });
  }
}

// ── AI ignore list ──────────────────────────────────────────────────

/** Load all permanently ignored .ai relative paths from the cloud DB. */
export async function loadAiIgnoreList(): Promise<Set<string>> {
  try {
    const data = await callApi("load-ai-ignore-list");
    const ignores = (data.ignores as Array<{ relative_path: string }>) ?? [];
    return new Set(ignores.map((r) => r.relative_path));
  } catch (e) {
    logger.warn("Failed to load AI ignore list (proceeding without it)", { error: (e as Error).message });
    return new Set();
  }
}

/**
 * Permanently mark an .ai file as ignored.
 * reason: 'pdf_sibling' | 'no_pdf_compat'
 * Fire-and-forget safe — caller should not rely on success.
 */
export async function markAiIgnored(relativePath: string, reason: string): Promise<void> {
  try {
    await callApi("mark-ai-ignored", { relative_path: relativePath, reason });
  } catch (e) {
    logger.warn("Failed to record AI ignore entry", { path: relativePath, reason, error: (e as Error).message });
  }
}

// ── Check-in receipt verification ──────────────────────────────────

export interface CheckinVerificationItem {
  checkout_id: string;
  relative_path: string | null;
  filename: string | null;
  expected_hash: string | null;
  expected_size: number | null;
  original_hash: string | null;
  original_size: number | null;
  verify_deadline_at: string | null;
  verify_attempts: number;
  already_flagged: boolean;
  resolve_due: boolean;
}

export async function claimCheckinVerifications(limit = 25): Promise<CheckinVerificationItem[]> {
  const data = await callApi("claim-checkin-verifications", { limit });
  return (data.items as CheckinVerificationItem[]) ?? [];
}

export async function reportCheckinVerification(params: {
  checkout_id: string;
  outcome: "verified" | "not_ready" | "mismatch" | "resolved";
  final_hash?: string;
  final_size?: number;
  detail?: string;
  // For 'resolved' (terminal auto-resolve): what is at the master path now.
  disk_state?: "matches_original" | "foreign" | "missing";
}): Promise<void> {
  await callApi("report-checkin-verification", params as unknown as Record<string, unknown>);
}

export interface AiSentinelScanResult {
  asset_id: string;
  filename: string;
  relative_path: string;
  is_sentinel: boolean;
}

export async function completeAiSentinelScan(results: AiSentinelScanResult[]): Promise<void> {
  await callApi("complete-ai-sentinel-scan", { results }, 60_000);
}

export interface BlankThumbCleanupResult {
  asset_id: string;
  thumbnail_url: string;
  file_type: string;
  relative_path: string;
  is_blank: boolean;
}

export async function completeBlankThumbCleanup(results: BlankThumbCleanupResult[]): Promise<void> {
  await callApi("complete-blank-thumb-cleanup", { results }, 60_000);
}
