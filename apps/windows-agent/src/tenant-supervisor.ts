/**
 * Multi-tenant supervisor for the Windows Render Agent.
 *
 * Reads a TENANTS env var (JSON array), spawns one child process per tenant
 * running the same single-tenant agent code (src/index.ts), each with its own
 * env-var view (server URL, agent key, DO Spaces bucket, etc.).
 *
 * Per-tenant config persisted to %ProgramData%\PopDAM\agent-config-<tenant>.json
 * via POPDAM_DATA_FILE override.
 *
 * If TENANTS is absent, the supervisor exits cleanly so the entry point
 * falls back to single-tenant mode (today's behavior).
 *
 * Tenant JSON shape:
 *   {
 *     "name": "popdam",
 *     "server_url": "https://...supabase.co",
 *     "agent_key": "...",          // optional
 *     "pairing_code": "...",       // optional
 *     "agent_name": "windows-popdam",
 *     "nas": {                     // optional — per-tenant NAS access
 *       "host": "...", "share": "...", "mount_path": "Z:"
 *     },
 *     "do_spaces": {               // optional — per-tenant bucket
 *       "key": "...", "secret": "...",
 *       "bucket": "popdam", "region": "nyc3",
 *       "endpoint": "https://nyc3.digitaloceanspaces.com"
 *     }
 *   }
 */

import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import { logger } from "./logger";

interface TenantSpaces {
  key?: string;
  secret?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
}

interface TenantNas {
  host?: string;
  share?: string;
  mount_path?: string;
}

interface Tenant {
  name: string;
  server_url: string;
  agent_key?: string;
  pairing_code?: string;
  agent_name?: string;
  nas?: TenantNas;
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
  const seen = new Set<string>();
  for (const t of parsed) {
    if (!t || typeof t !== "object") throw new Error("Each tenant must be an object");
    const obj = t as Record<string, unknown>;
    const name = String(obj.name || "").trim();
    const serverUrl = String(obj.server_url || "").trim();
    if (!name) throw new Error("Tenant.name is required");
    if (!serverUrl) throw new Error(`Tenant ${name}: server_url is required`);
    if (seen.has(name)) throw new Error(`Duplicate tenant name: ${name}`);
    seen.add(name);

    tenants.push({
      name,
      server_url: serverUrl,
      agent_key: obj.agent_key ? String(obj.agent_key) : undefined,
      pairing_code: obj.pairing_code ? String(obj.pairing_code) : undefined,
      agent_name: obj.agent_name ? String(obj.agent_name) : `windows-${name}`,
      nas: (obj.nas && typeof obj.nas === "object") ? (obj.nas as TenantNas) : undefined,
      do_spaces: (obj.do_spaces && typeof obj.do_spaces === "object")
        ? (obj.do_spaces as TenantSpaces)
        : undefined,
    });
  }
  return tenants;
}

function buildTenantEnv(t: Tenant): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  env.POPDAM_TENANT_CHILD = "1";
  env.POPDAM_TENANT_NAME = t.name;

  // Per-tenant persisted config file
  const programData = process.env.ProgramData || "C:\\ProgramData";
  env.POPDAM_DATA_FILE = path.join(programData, "PopDAM", `agent-config-${t.name}.json`);

  // Server + auth
  env.POPDAM_SERVER_URL = t.server_url;
  env.SUPABASE_URL = t.server_url;
  if (t.agent_key) env.AGENT_KEY = t.agent_key;
  else delete env.AGENT_KEY;
  if (t.pairing_code) env.POPDAM_PAIRING_CODE = t.pairing_code;
  else delete env.POPDAM_PAIRING_CODE;
  delete env.PAIRING_CODE;
  delete env.BOOTSTRAP_TOKEN;
  env.AGENT_NAME = t.agent_name || `windows-${t.name}`;

  // NAS
  if (t.nas) {
    if (t.nas.host) env.NAS_HOST = t.nas.host;
    if (t.nas.share) env.NAS_SHARE = t.nas.share;
    if (t.nas.mount_path) env.NAS_MOUNT_PATH = t.nas.mount_path;
  }

  // DO Spaces (per-tenant bucket)
  if (t.do_spaces) {
    if (t.do_spaces.key) env.DO_SPACES_KEY = t.do_spaces.key;
    if (t.do_spaces.secret) env.DO_SPACES_SECRET = t.do_spaces.secret;
    if (t.do_spaces.bucket) env.DO_SPACES_BUCKET = t.do_spaces.bucket;
    if (t.do_spaces.region) env.DO_SPACES_REGION = t.do_spaces.region;
    if (t.do_spaces.endpoint) env.DO_SPACES_ENDPOINT = t.do_spaces.endpoint;
  }

  delete env.TENANTS;
  return env;
}

const processes = new Map<string, ChildProcess>();

function spawnTenant(t: Tenant): ChildProcess {
  const env = buildTenantEnv(t);
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

export function runSupervisor(tenants: Tenant[]): void {
  logger.info("[supervisor] Starting multi-tenant Windows Render Agent", {
    tenantCount: tenants.length,
    tenants: tenants.map((t) => ({ name: t.name, server: t.server_url })),
  });

  for (const t of tenants) {
    const child = spawnTenant(t);
    processes.set(t.name, child);
  }

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info("[supervisor] received signal, forwarding to tenants", { signal });
    for (const [name, child] of processes) {
      try { child.kill(signal); } catch (e) {
        logger.warn("[supervisor] failed to signal child", {
          tenant: name, error: (e as Error).message,
        });
      }
    }
    setTimeout(() => process.exit(0), 5_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
