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
}

export interface HeartbeatResponse {
  ok: boolean;
  config?: {
    do_spaces?: { key: string; secret: string; bucket: string; region: string; endpoint: string };
    scanning?: { roots: string[]; batch_size: number; adaptive_polling: { idle_seconds: number; active_seconds: number } };
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
  };
}

export async function heartbeat(agentId: string, counters: Counters, lastError?: string): Promise<HeartbeatResponse> {
  const data = await callApi("heartbeat", { agent_id: agentId, counters, last_error: lastError });
  return data as HeartbeatResponse;
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

export async function checkScanRequest(agentId: string): Promise<{ scan_requested: boolean; scan_abort: boolean }> {
  const data = await callApi("check-scan-request", { agent_id: agentId });
  return {
    scan_requested: data.scan_requested === true,
    scan_abort: data.scan_abort === true,
  };
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
