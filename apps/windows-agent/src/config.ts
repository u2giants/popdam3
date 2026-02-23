/**
 * Windows Render Agent configuration — loaded from environment variables.
 * Fails fast if required values are missing.
 */

import "dotenv/config";

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
  agentKey: required("AGENT_KEY"),
  agentName: optional("AGENT_NAME", "windows-render-agent"),

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
} as const;
