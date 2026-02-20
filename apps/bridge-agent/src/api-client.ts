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

export async function heartbeat(agentId: string, counters: Counters, lastError?: string): Promise<void> {
  await callApi("heartbeat", { agent_id: agentId, counters, last_error: lastError });
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

export async function checkScanRequest(agentId: string): Promise<boolean> {
  const data = await callApi("check-scan-request", { agent_id: agentId });
  return data.scan_requested === true;
}

export async function queueRender(assetId: string, reason: string): Promise<string> {
  const data = await callApi("queue-render", { asset_id: assetId, reason });
  return data.job_id as string;
}
