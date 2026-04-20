/**
 * Multi-tenant supervisor for the Bridge Agent.
 *
 * Reads a TENANTS env var (JSON array), spawns one child process per tenant
 * running the same single-tenant agent code (src/index.ts), each with its own
 * env-var view (server URL, agent key, scan roots, DO Spaces bucket, etc.).
 *
 * Per-tenant config is persisted to /data/agent-config-<tenant>.json (handled
 * by the child process via POPDAM_DATA_FILE override).
 *
 * If TENANTS is absent or empty, the supervisor exits cleanly so the entry
 * point can fall back to single-tenant mode (today's behavior).
 *
 * Tenant JSON shape:
 *   {
 *     "name": "popdam",
 *     "server_url": "https://...supabase.co",
 *     "agent_key": "...",          // optional — pairing code can be used instead
 *     "pairing_code": "...",       // optional — one-time use
 *     "agent_name": "bridge-popdam",
 *     "scan_roots": ["/nas/popdam"],
 *     "supabase_anon_key": "...",  // optional — for realtime watcher
 *     "do_spaces": {               // optional — per-tenant bucket
 *       "key": "...", "secret": "...",
 *       "bucket": "popdam", "region": "nyc3",
 *       "endpoint": "https://nyc3.digitaloceanspaces.com"
 *     }
 *   }
 */

import { spawn, ChildProcess } from "node:child_process";
import { logger } from "./logger.js";

interface TenantSpaces {
  key?: string;
  secret?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
}

interface Tenant {
  name: string;
  server_url: string;
  agent_key?: string;
  pairing_code?: string;
  agent_name?: string;
  scan_roots?: string[];
  supabase_anon_key?: string;
  do_spaces?: TenantSpaces;
}

export function parseTenants(): Tenant[] | null {
  const raw = (process.env.TENANTS || "").trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`TENANTS env is not valid JSON: ${(e as Error).message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("TENANTS must be a non-empty JSON array");
  }

  const tenants: Tenant[] = [];
  const seenNames = new Set<string>();
  for (const t of parsed) {
    if (!t || typeof t !== "object") {
      throw new Error("Each tenant must be an object");
    }
    const obj = t as Record<string, unknown>;
    const name = String(obj.name || "").trim();
    const serverUrl = String(obj.server_url || "").trim();
    if (!name) throw new Error("Tenant.name is required");
    if (!serverUrl) throw new Error(`Tenant ${name}: server_url is required`);
    if (seenNames.has(name)) throw new Error(`Duplicate tenant name: ${name}`);
    seenNames.add(name);

    tenants.push({
      name,
      server_url: serverUrl,
      agent_key: obj.agent_key ? String(obj.agent_key) : undefined,
      pairing_code: obj.pairing_code ? String(obj.pairing_code) : undefined,
      agent_name: obj.agent_name ? String(obj.agent_name) : `bridge-${name}`,
      scan_roots: Array.isArray(obj.scan_roots) ? (obj.scan_roots as string[]) : undefined,
      supabase_anon_key: obj.supabase_anon_key ? String(obj.supabase_anon_key) : undefined,
      do_spaces: (obj.do_spaces && typeof obj.do_spaces === "object")
        ? (obj.do_spaces as TenantSpaces)
        : undefined,
    });
  }
  return tenants;
}

function buildTenantEnv(t: Tenant): NodeJS.ProcessEnv {
  // Start from a clean view: inherit non-tenant-specific vars (paths, etc.)
  // but strip anything that the child should derive from the tenant config.
  const env: NodeJS.ProcessEnv = { ...process.env };

  // Mark as child so child does not re-enter supervisor mode
  env.POPDAM_TENANT_CHILD = "1";
  env.POPDAM_TENANT_NAME = t.name;

  // Per-tenant persisted config file (replaces /data/agent-config.json)
  env.POPDAM_DATA_FILE = `/data/agent-config-${t.name}.json`;

  // Server + auth
  env.POPDAM_SERVER_URL = t.server_url;
  env.SUPABASE_URL = t.server_url;
  if (t.agent_key) env.AGENT_KEY = t.agent_key;
  else delete env.AGENT_KEY;
  if (t.pairing_code) env.POPDAM_PAIRING_CODE = t.pairing_code;
  else delete env.POPDAM_PAIRING_CODE;
  delete env.PAIRING_CODE; // avoid cross-tenant fallback
  env.AGENT_NAME = t.agent_name || `bridge-${t.name}`;
  if (t.supabase_anon_key) env.SUPABASE_ANON_KEY = t.supabase_anon_key;
  else delete env.SUPABASE_ANON_KEY;

  // Scan roots
  if (t.scan_roots && t.scan_roots.length > 0) {
    env.SCAN_ROOTS = t.scan_roots.join(",");
  }

  // DO Spaces (per-tenant bucket)
  if (t.do_spaces) {
    if (t.do_spaces.key) env.DO_SPACES_KEY = t.do_spaces.key;
    if (t.do_spaces.secret) env.DO_SPACES_SECRET = t.do_spaces.secret;
    if (t.do_spaces.bucket) env.DO_SPACES_BUCKET = t.do_spaces.bucket;
    if (t.do_spaces.region) env.DO_SPACES_REGION = t.do_spaces.region;
    if (t.do_spaces.endpoint) env.DO_SPACES_ENDPOINT = t.do_spaces.endpoint;
  }

  // Strip the TENANTS array so the child stays in single-tenant mode
  delete env.TENANTS;

  return env;
}

function spawnTenant(t: Tenant): ChildProcess {
  const env = buildTenantEnv(t);
  // Re-exec the same script: process.argv[1] points at dist/index.js
  // (or src/index.ts under tsx for dev). The child will see
  // POPDAM_TENANT_CHILD=1 and skip supervisor mode.
  const child = spawn(process.execPath, [process.argv[1]], {
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  child.on("exit", (code, signal) => {
    logger.warn("[supervisor] tenant child exited", {
      tenant: t.name,
      code,
      signal,
    });
    // Restart with backoff after 10s
    setTimeout(() => {
      logger.info("[supervisor] restarting tenant child", { tenant: t.name });
      const next = spawnTenant(t);
      processes.set(t.name, next);
    }, 10_000);
  });

  child.on("error", (err) => {
    logger.error("[supervisor] tenant child error", {
      tenant: t.name,
      error: err.message,
    });
  });

  return child;
}

const processes = new Map<string, ChildProcess>();

export function runSupervisor(tenants: Tenant[]): void {
  logger.info("[supervisor] Starting multi-tenant Bridge Agent", {
    tenantCount: tenants.length,
    tenants: tenants.map((t) => ({ name: t.name, server: t.server_url })),
  });

  for (const t of tenants) {
    const child = spawnTenant(t);
    processes.set(t.name, child);
  }

  // Forward shutdown signals to all children
  const shutdown = (signal: NodeJS.Signals) => {
    logger.info("[supervisor] received signal, forwarding to tenants", { signal });
    for (const [name, child] of processes) {
      try {
        child.kill(signal);
      } catch (e) {
        logger.warn("[supervisor] failed to signal child", {
          tenant: name,
          error: (e as Error).message,
        });
      }
    }
    setTimeout(() => process.exit(0), 5_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
