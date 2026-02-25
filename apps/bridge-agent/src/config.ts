/**
 * Bridge Agent configuration — loaded from environment variables.
 * Supports pairing code flow: agent key is persisted to /data/agent-config.json
 * after initial pairing, then loaded automatically on subsequent starts.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Load persisted agent key from data volume ──
const AGENT_CONFIG_PATH = join(
  process.env.POPDAM_DATA_DIR || "/data",
  "agent-config.json",
);

try {
  const raw = readFileSync(AGENT_CONFIG_PATH, "utf-8");
  const saved = JSON.parse(raw);
  if (saved.agent_key && !process.env.AGENT_KEY) {
    process.env.AGENT_KEY = saved.agent_key;
  }
  if (saved.agent_id) {
    process.env._SAVED_AGENT_ID = saved.agent_id;
  }
} catch {
  /* not yet paired — will use PAIRING_CODE or env AGENT_KEY */
}

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return v.trim();
}

function optional(key: string, fallback: string): string {
  return (process.env[key] || "").trim() || fallback;
}

function optionalInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return isNaN(n) ? fallback : n;
}

// Server URL: prefer POPDAM_SERVER_URL, fall back to SUPABASE_URL
const serverUrl = optional("POPDAM_SERVER_URL", optional("SUPABASE_URL", ""));
if (!serverUrl) {
  throw new Error("Missing required: POPDAM_SERVER_URL or SUPABASE_URL");
}

export const config = {
  // Cloud API
  supabaseUrl: serverUrl,
  agentKey: optional("AGENT_KEY", ""),
  agentName: optional("AGENT_NAME", "bridge-agent"),

  // Pairing code (one-time use, consumed on first startup)
  pairingCode: optional("POPDAM_PAIRING_CODE", optional("PAIRING_CODE", "")),

  // DigitalOcean Spaces (optional — delivered via heartbeat config sync)
  doSpacesKey: optional("DO_SPACES_KEY", ""),
  doSpacesSecret: optional("DO_SPACES_SECRET", ""),
  doSpacesBucket: optional("DO_SPACES_BUCKET", "popdam"),
  doSpacesRegion: optional("DO_SPACES_REGION", "nyc3"),
  doSpacesEndpoint: optional("DO_SPACES_ENDPOINT", "https://nyc3.digitaloceanspaces.com"),

  // NAS filesystem
  nasContainerMountRoot: optional("NAS_CONTAINER_MOUNT_ROOT", "/nas"),
  scanRoots: optional("SCAN_ROOTS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Performance
  thumbConcurrency: optionalInt("THUMB_CONCURRENCY", 0),
  ingestBatchSize: optionalInt("INGEST_BATCH_SIZE", 0),

  // Persistent config path
  agentConfigPath: AGENT_CONFIG_PATH,

  // Saved agent ID from previous pairing
  savedAgentId: optional("_SAVED_AGENT_ID", ""),

  // Derived
  get agentApiUrl() {
    return `${this.supabaseUrl}/functions/v1/agent-api`;
  },

  get isPaired() {
    return !!this.agentKey;
  },
} as const;
