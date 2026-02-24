/**
 * Cloud API client — all outbound HTTPS calls to agent-api edge function.
 * No inbound networking required per PROJECT_BIBLE §2.
 */

import { config } from "./config.js";
import { logger } from "./logger.js";

async function callApi(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const body = JSON.stringify({ action, ...payload });

  const res = await fetch(config.agentApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agent-key": config.agentKey,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`agent-api ${action} returned ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (data && !data.ok) {
    throw new Error(`agent-api ${action} error: ${data.error || "unknown"}`);
  }
  return data;
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
  files_stat_failed: number;
  files_total_encountered: number;
  rejected_wrong_type: number;
  rejected_junk_file: number;
  noop_unchanged: number;
}

export interface HeartbeatResponse {
  ok: boolean;
  config?: {
    do_spaces?: { key: string; secret: string; bucket: string; region: string; endpoint: string };
    scanning?: { container_mount_root: string; roots: string[]; batch_size: number; adaptive_polling: { idle_seconds: number; active_seconds: number } };
    resource_guard?: { cpu_percentage_limit: number; memory_limit_mb: number; concurrency: number };
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
  };
}

export async function heartbeat(agentId: string, counters: Counters, lastError?: string): Promise<HeartbeatResponse> {
  const data = await callApi("heartbeat", { agent_id: agentId, counters, last_error: lastError });
  return data as unknown as HeartbeatResponse;
}

export interface IngestPayload {
  relative_path: string;
  filename: string;
  file_type: "psd" | "ai";
  file_size: number;
  modified_at: string;
  file_created_at: string | null;
  quick_hash: string;
  quick_hash_version: number;
  thumbnail_url?: string;
  thumbnail_error?: string;
  width?: number;
  height?: number;
}

export interface IngestResult {
  action: "created" | "updated" | "moved" | "noop";
  asset_id: string;
}

export async function ingest(payload: IngestPayload): Promise<IngestResult> {
  const data = await callApi("ingest", payload as unknown as Record<string, unknown>);
  return { action: data.action as IngestResult["action"], asset_id: data.asset_id as string };
}

export async function scanProgress(
  sessionId: string,
  status: "running" | "completed" | "failed",
  counters: Counters,
  currentPath?: string,
): Promise<void> {
  await callApi("scan-progress", {
    session_id: sessionId,
    status,
    counters,
    current_path: currentPath,
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

export interface CheckChangedFile {
  relative_path: string;
  modified_at: string;
  file_size: number;
}

export interface CheckChangedResult {
  changed: string[];
  needs_thumbnail: string[];
}

export async function checkChanged(files: CheckChangedFile[]): Promise<CheckChangedResult> {
  const data = await callApi("check-changed", { files });
  return {
    changed: (data.changed as string[]) || [],
    needs_thumbnail: (data.needs_thumbnail as string[]) || [],
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
