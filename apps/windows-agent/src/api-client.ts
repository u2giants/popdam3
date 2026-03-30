/**
 * Cloud API client for Windows Render Agent.
 * Handles registration, heartbeat, claim-render, and complete-render.
 */

import { config } from "./config";
import { logger } from "./logger";

export async function callApi(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
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

// ── Public API ───────────────────────────────────────────────

export async function register(agentName: string): Promise<string> {
  const data = await callApi("register", {
    agent_name: agentName,
    agent_type: "windows-render",
    agent_key: config.agentKey,
  });
  return data.agent_id as string;
}

export interface WindowsHeartbeatResponse {
  ok: boolean;
  config?: {
    do_spaces?: {
      key: string;
      secret: string;
      bucket: string;
      region: string;
      endpoint: string;
    };
    windows_agent?: {
      nas_host: string;
      nas_share: string;
      nas_username?: string;
      nas_password?: string;
      nas_mount_path?: string;
      render_concurrency?: number;
    };
    ai?: {
      anthropic_api_key?: string;
      google_ai_api_key?: string;
      models?: Array<{ id: string; provider: string; apiModel: string; capabilities: string[] }>;
      pdf_extraction?: { ai_vision_model_id?: string } | null;
    };
  };
  commands?: {
    trigger_update?: boolean;
    trigger_pdf_text_sample?: boolean;
    pdf_text_sample_assets?: unknown[];
    force_restart?: boolean;
    force_apply_update?: boolean;
    force_stop_jobs?: boolean;
    repair_pairing_code?: string | null;
  };
}

export interface AgentHealthPayload {
  healthy: boolean;
  nasHealthy: boolean;
  lastPreflightError: string | null;
  lastPreflightAt: string | null;
}

export interface WindowsVersionInfo {
  version: string;
  update_available: boolean;
  latest_version: string | null;
  last_update_check: string | null;
  updating: boolean;
  update_error: string | null;
}

export async function heartbeat(
  agentId: string,
  lastError?: string,
  health?: AgentHealthPayload,
  versionInfo?: WindowsVersionInfo,
  logTail?: string[],
): Promise<WindowsHeartbeatResponse> {
  const data = await callApi("heartbeat", {
    agent_id: agentId,
    counters: {},
    last_error: lastError,
    health: health ?? undefined,
    version_info: versionInfo ?? undefined,
    log_tail: logTail ?? undefined,
  });
  return data as unknown as WindowsHeartbeatResponse;
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


export async function completePdfTextSample(results: unknown[]): Promise<void> {
  await callApi("complete-pdf-text-sample", { results });
}

export async function reportPdfTextSampleProgress(payload: Record<string, unknown>): Promise<void> {
  await callApi("pdf-text-sample-progress", payload);
}

/**
 * Update an asset's fields (e.g. pdf_page2_url after PDF rendering).
 */
export async function updateAsset(
  assetId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await callApi("update-asset", { asset_id: assetId, ...fields });
}

// ── Pairing (unauthenticated — uses one-time pairing code) ─────

export async function pair(
  pairingCode: string,
  agentName: string,
): Promise<{ agent_id: string; agent_key: string }> {
  const maskedCode = pairingCode.length > 4
    ? `${pairingCode.slice(0, 4)}-****-****-****`
    : "****";
  const endpoint = config.agentApiUrl;

  logger.info("Attempting pairing", { endpoint, pairingCode: maskedCode });

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "pair",
        pairing_code: pairingCode,
        agent_name: agentName,
      }),
    });
  } catch (fetchErr) {
    const msg = (fetchErr as Error).message;
    logger.error("Pairing fetch failed (network-level error)", {
      endpoint,
      error: msg,
      stack: (fetchErr as Error).stack,
    });
    throw new Error(`Pairing network error: ${msg}`);
  }

  logger.info("Pairing response received", {
    status: res.status,
    statusText: res.statusText,
    contentType: res.headers.get("content-type"),
  });

  // Read raw body first to handle non-JSON responses
  let rawBody: string;
  try {
    rawBody = await res.text();
  } catch (readErr) {
    throw new Error(`Pairing failed: could not read response body (HTTP ${res.status})`);
  }

  if (!res.ok) {
    logger.error("Pairing HTTP error", {
      status: res.status,
      statusText: res.statusText,
      body: rawBody.slice(0, 500),
    });
    // Try to parse JSON error message
    try {
      const errData = JSON.parse(rawBody);
      throw new Error(errData.error || `Pairing failed with HTTP ${res.status}`);
    } catch (parseErr) {
      if ((parseErr as Error).message.startsWith("Pairing")) throw parseErr;
      throw new Error(`Pairing failed with HTTP ${res.status}: ${rawBody.slice(0, 200)}`);
    }
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawBody);
  } catch {
    logger.error("Pairing response is not valid JSON", {
      status: res.status,
      body: rawBody.slice(0, 500),
    });
    throw new Error(`Pairing failed: response is not JSON (HTTP ${res.status})`);
  }

  if (!data.ok) {
    logger.error("Pairing rejected by server", {
      error: data.error,
      fullResponse: rawBody.slice(0, 500),
    });
    throw new Error(
      (data.error as string) || `Pairing rejected by server (no error message in response)`
    );
  }

  logger.info("Pairing succeeded", {
    agentId: data.agent_id,
    agentType: data.agent_type,
  });
  return { agent_id: data.agent_id as string, agent_key: data.agent_key as string };
}

// ── Self-update API ────────────────────────────────────────

export interface LatestBuildInfo {
  latest_version: string;
  download_url: string;
  checksum_sha256: string;
  release_notes?: string;
  published_at?: string;
}

export async function getLatestBuild(): Promise<LatestBuildInfo> {
  const data = await callApi("get-latest-build", { agent_type: "windows-render" });
  return data as unknown as LatestBuildInfo;
}

export interface UpdateStatusPayload {
  agent_id: string;
  status: "restarting" | "completed" | "failed" | "rolled_back";
  old_version: string;
  new_version: string;
  error?: string;
}

export async function reportUpdateStatus(payload: UpdateStatusPayload): Promise<void> {
  await callApi("report-update-status", payload as unknown as Record<string, unknown>);
}

// ── Legacy bootstrap compat ────────────────────────────

export async function bootstrap(
  bootstrapToken: string,
  agentName: string,
): Promise<{ agent_id: string; agent_key: string }> {
  return pair(bootstrapToken, agentName);
}
