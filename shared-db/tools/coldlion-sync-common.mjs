import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const COLDLION_BASE_URL = "http://x5.coldlion.com/EhpApi";
export const COLDLION_API_KEY_REF =
  "op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential";

export function readColdlionApiKey() {
  if (process.env.COLDLION_API_KEY) return process.env.COLDLION_API_KEY;
  const result = spawnSync("op", ["read", COLDLION_API_KEY_REF], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      "COLDLION_API_KEY is not set and `op read` failed for the documented 1Password reference.",
    );
  }
  return result.stdout.trim();
}

export function sqlDollarQuote(tag, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.includes(`$${tag}$`)) {
    throw new Error(`value unexpectedly contains dollar quote tag ${tag}`);
  }
  return `$${tag}$${text}$${tag}$`;
}

export function buildFailedSyncRunSql(sourceName, stage, message) {
  const error = String(message ?? "").slice(0, 4000);
  return `with failed as (
  insert into ingest.sync_run
    (source_system, source_name, status, started_at, finished_at, error, metadata)
  values ('coldlion', ${sqlDollarQuote("cl_source", sourceName)}, 'failed', now(), now(),
    ${sqlDollarQuote("cl_error", error)},
    jsonb_build_object('recorded_by','coldlion host wrapper','stage',${sqlDollarQuote("cl_stage", stage)},'promotion','not-promoted'))
  returning id
), consecutive as (
  select 1 + count(*)::integer as failures
  from failed
  cross join lateral (select status from ingest.sync_run where source_system='coldlion' and source_name=${sqlDollarQuote("cl_source2", sourceName)}
        order by started_at desc limit 1) recent
  where recent.status='failed'
)
select pg_notify('coldlion_sync_alert', ${sqlDollarQuote("cl_alert", `${sourceName}: at least two consecutive non-promotions`)})
from consecutive where failures >= 2;
`;
}

export function runSql(sql, { linked = false } = {}) {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!databaseUrl && !linked) {
    const error = new Error(
      "No database target: set DATABASE_URL/SUPABASE_DB_URL or pass --linked.",
    );
    error.code = "NO_DB_TARGET";
    throw error;
  }

  if (databaseUrl && !linked) {
    const psql = spawnSync(
      "psql",
      [databaseUrl, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--single-transaction"],
      { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    if (!psql.error && psql.status === 0) return psql.stdout;
    if (psql.error?.code !== "ENOENT") throw new Error(psql.stderr || "psql failed");
  }

  const dir = mkdtempSync(join(tmpdir(), "coldlion-sync-"));
  const file = join(dir, "query.sql");
  try {
    writeFileSync(file, sql, "utf8");
    const args = linked
      ? ["db", "query", "--linked", "--file", file]
      : ["db", "query", "--db-url", databaseUrl, "--file", file];
    const result = spawnSync("supabase", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) throw new Error(result.stderr || "supabase db query failed");
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function fetchPaged(url, apiKey, fetchImpl = fetch) {
  const rows = [];
  let page = 0;
  let terminalReached = false;
  for (;;) {
    const pagedUrl = new URL(url);
    pagedUrl.searchParams.set("page", String(page));
    if (!pagedUrl.searchParams.has("size")) pagedUrl.searchParams.set("size", "200");
    const response = await fetchImpl(pagedUrl, { headers: { "X-API-Key": apiKey } });
    if (!response.ok) throw new Error(`${pagedUrl} returned HTTP ${response.status}`);
    const payload = await response.json();
    if (Array.isArray(payload)) {
      rows.push(...payload);
      terminalReached = true;
      break;
    }
    if (!Array.isArray(payload?.content)) {
      throw new Error(`${pagedUrl} did not return an array or paged content envelope`);
    }
    rows.push(...payload.content);
    if (payload.content.length === 0 || payload.last === true) {
      terminalReached = true;
      break;
    }
    page += 1;
  }
  return { rows, terminalReached, pagesFetched: page + 1 };
}
