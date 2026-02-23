/**
 * Windows Render Agent configuration — loaded from environment variables.
 * Supports bootstrap flow: agent-key.cfg is loaded automatically if present.
 * Fails fast only if no authentication method is available.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";

// ── Load persisted agent key from agent-key.cfg (written by bootstrap) ──
try {
  const keyFile = path.join(path.dirname(process.execPath), "agent-key.cfg");
  const savedKey = readFileSync(keyFile, "utf-8").trim();
  if (savedKey) process.env.AGENT_KEY = savedKey;
} catch {
  /* not yet bootstrapped — will use BOOTSTRAP_TOKEN or env AGENT_KEY */
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

export const config = {
  // Cloud API
  supabaseUrl: required("SUPABASE_URL"),
  agentKey: optional("AGENT_KEY", ""),
  agentName: optional("AGENT_NAME", "windows-render-agent"),

  // Bootstrap token (one-time use, consumed on first startup)
  bootstrapToken: optional("BOOTSTRAP_TOKEN", ""),

  // DigitalOcean Spaces (optional — delivered via cloud config sync)
  doSpacesKey: optional("DO_SPACES_KEY", ""),
  doSpacesSecret: optional("DO_SPACES_SECRET", ""),
  doSpacesBucket: optional("DO_SPACES_BUCKET", "popdam"),
  doSpacesRegion: optional("DO_SPACES_REGION", "nyc3"),
  doSpacesEndpoint: optional("DO_SPACES_ENDPOINT", "https://nyc3.digitaloceanspaces.com"),

  // NAS file access (optional — delivered via cloud config sync)
  nasHost: optional("NAS_HOST", ""),
  nasShare: optional("NAS_SHARE", ""),

  // Illustrator
  illustratorDpi: optionalInt("ILLUSTRATOR_DPI", 150),
  illustratorTimeoutMs: optionalInt("ILLUSTRATOR_TIMEOUT_MS", 120_000),

  // Polling
  pollIntervalMs: optionalInt("POLL_INTERVAL_MS", 30_000),

  // Derived
  get agentApiUrl() {
    return `${this.supabaseUrl}/functions/v1/agent-api`;
  },

  get isBootstrapped() {
    return !!this.agentKey;
  },
} as const;
