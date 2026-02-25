/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Windows Render Agent configuration — loaded from environment variables.
 * Supports pairing code flow: agent key is persisted to %ProgramData%\PopDAM\agent-config.json
 * after initial pairing, then loaded automatically on subsequent starts.
 */

const envPath = require("path").join(
  require("path").dirname(process.execPath),
  ".env"
);
require("dotenv").config({ path: envPath });

console.log("[config] Loading .env from:", envPath);
console.log("[config] SUPABASE_URL loaded:", !!process.env.SUPABASE_URL);
console.log("[config] POPDAM_PAIRING_CODE loaded:", !!process.env.POPDAM_PAIRING_CODE);

import { readFileSync } from "node:fs";
import path from "node:path";

// ── Persistent config paths ──
// Primary: %ProgramData%\PopDAM\agent-config.json (survives reinstalls)
// Fallback: agent-key.cfg next to executable (legacy compat)
const PROGRAM_DATA = process.env.ProgramData || "C:\\ProgramData";
const AGENT_CONFIG_DIR = path.join(PROGRAM_DATA, "PopDAM");
const AGENT_CONFIG_PATH = path.join(AGENT_CONFIG_DIR, "agent-config.json");
const LEGACY_KEY_PATH = path.join(path.dirname(process.execPath), "agent-key.cfg");

// ── Load persisted agent key ──
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
  // Try legacy key file
  try {
    const savedKey = readFileSync(LEGACY_KEY_PATH, "utf-8").trim();
    if (savedKey && !process.env.AGENT_KEY) {
      process.env.AGENT_KEY = savedKey;
    }
  } catch {
    /* not yet paired */
  }
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
  agentName: optional("AGENT_NAME", "windows-render-agent"),

  // Pairing code (one-time use, consumed on first startup)
  pairingCode: optional("POPDAM_PAIRING_CODE", optional("PAIRING_CODE", optional("BOOTSTRAP_TOKEN", ""))),

  // DigitalOcean Spaces (optional — delivered via cloud config sync)
  doSpacesKey: optional("DO_SPACES_KEY", ""),
  doSpacesSecret: optional("DO_SPACES_SECRET", ""),
  doSpacesBucket: optional("DO_SPACES_BUCKET", "popdam"),
  doSpacesRegion: optional("DO_SPACES_REGION", "nyc3"),
  doSpacesEndpoint: optional("DO_SPACES_ENDPOINT", "https://nyc3.digitaloceanspaces.com"),

  // NAS file access (optional — delivered via cloud config sync)
  nasHost: optional("NAS_HOST", ""),
  nasShare: optional("NAS_SHARE", ""),
  nasMountPath: optional("NAS_MOUNT_PATH", ""),

  // Illustrator
  illustratorDpi: optionalInt("ILLUSTRATOR_DPI", 150),
  illustratorTimeoutMs: Math.min(
    optionalInt("ILLUSTRATOR_TIMEOUT_MS", 120_000),
    5 * 60_000, // hard cap: 5 minutes
  ),

  // Circuit breaker — Illustrator
  illustratorFailureLimit: optionalInt("ILLUSTRATOR_FAILURE_LIMIT", 3),
  illustratorCooldownMs: optionalInt("ILLUSTRATOR_COOLDOWN_MS", 15 * 60_000),

  // Concurrency + Polling
  renderConcurrency: optionalInt("RENDER_CONCURRENCY", 6),
  pollIntervalMs: optionalInt("POLL_INTERVAL_MS", 3_000),

  // Persistent config paths
  agentConfigPath: AGENT_CONFIG_PATH,
  agentConfigDir: AGENT_CONFIG_DIR,

  // Saved agent ID from previous pairing
  savedAgentId: optional("_SAVED_AGENT_ID", ""),

  // Version (from package.json, injected at build time)
  version: (() => {
    try {
      const pkg = require(require("path").join(__dirname, "..", "package.json"));
      return pkg.version || "0.0.0";
    } catch { return "0.0.0"; }
  })(),

  // Derived
  get agentApiUrl() {
    return `${this.supabaseUrl}/functions/v1/agent-api`;
  },

  get isPaired() {
    return !!this.agentKey;
  },
} as const;
