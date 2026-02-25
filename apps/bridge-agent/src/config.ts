/**
 * Bridge Agent configuration — loaded from environment variables.
 * Fails fast if required values are missing.
 */

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
  agentName: optional("AGENT_NAME", "bridge-agent"),

  // DigitalOcean Spaces (optional — delivered via heartbeat config sync)
  doSpacesKey: optional("DO_SPACES_KEY", ""),
  doSpacesSecret: optional("DO_SPACES_SECRET", ""),
  doSpacesBucket: optional("DO_SPACES_BUCKET", "popdam"),
  doSpacesRegion: optional("DO_SPACES_REGION", "nyc3"),
  doSpacesEndpoint: optional("DO_SPACES_ENDPOINT", "https://nyc3.digitaloceanspaces.com"),

  // NAS filesystem
  nasContainerMountRoot: required("NAS_CONTAINER_MOUNT_ROOT"),
  scanRoots: required("SCAN_ROOTS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Performance
  // 0 = "not set by env" — cloud config (Resource Guard) takes priority
  thumbConcurrency: optionalInt("THUMB_CONCURRENCY", 0),
  ingestBatchSize: optionalInt("INGEST_BATCH_SIZE", 0),

  // Derived
  get agentApiUrl() {
    return `${this.supabaseUrl}/functions/v1/agent-api`;
  },
} as const;
