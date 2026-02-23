/**
 * Cloud API client for Windows Render Agent.
 * Handles registration, heartbeat, claim-render, and complete-render.
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
    agent_type: "windows-render",
    agent_key: config.agentKey,
  });
  return data.agent_id as string;
}

export async function heartbeat(agentId: string, lastError?: string): Promise<void> {
  await callApi("heartbeat", {
    agent_id: agentId,
    counters: {},
    last_error: lastError,
  });
}

export interface RenderJob {
  job_id: string;
  asset_id: string;
  relative_path: string;
  file_type: string;
  filename: string;
}

export async function claimRender(agentId: string): Promise<RenderJob | null> {
  const data = await callApi("claim-render", { agent_id: agentId });
  const job = data.job as RenderJob | null;
  if (!job || !job.job_id) return null;
  return job;
}

export async function completeRender(
  jobId: string,
  success: boolean,
  thumbnailUrl?: string,
  error?: string,
): Promise<void> {
  await callApi("complete-render", {
    job_id: jobId,
    success,
    thumbnail_url: thumbnailUrl,
    error,
  });
}
