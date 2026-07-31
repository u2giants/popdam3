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

/**
 * Output ceiling for EVERY database child process this module spawns — psql and the Supabase
 * CLI alike. Node's spawnSync default is exactly 1 MiB; the cycle-state probe returned
 * 1,305,075 bytes on preview and was killed with ENOBUFS, null `status` and EMPTY `stderr`.
 *
 * This is the SECOND line of defence, not the first: the probe itself is now paged
 * (CYCLE_STATE_PAGE_SIZE in tools/promote-coldlion-source-owned.mjs). It is applied to both
 * spawns from one constant so the two paths can never drift apart again.
 */
export const SPAWN_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

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

/**
 * The `code` carried by an error that represents a CLIENT-SIDE tooling fault — one where Node
 * itself sets `result.error` because the child could not be run or its output could not be
 * collected: ENOENT (not installed), ENOBUFS (output exceeded maxBuffer), EACCES.
 *
 * NOT every abnormal end is one of these. An EXTERNAL signal kill is deliberately excluded:
 * on Linux — which CI and the production lane both run on — a SIGKILL from outside yields
 * `status: null`, `signal: "SIGKILL"` and `error: undefined`, so it takes the ordinary
 * recorded-failure path below, not this one. That is the safe direction (loud and durable
 * rather than silently benign) and it is left as is on purpose: this repo cannot tell an
 * external kill apart from the OOM killer stopping a legitimately failing query.
 *
 * This is deliberately NOT a database failure and must never be recorded as one. A spawn
 * fault says nothing about the data or the database: recording it as a durable failed
 * `ingest.sync_run` row lets two of them in a row auto-trip the coldlion_licensor_property
 * circuit breaker and shut down a HEALTHY production feed, blaming the database for a
 * defect in this repo's own tooling. Callers branch on `isClientSpawnFault(error)`.
 */
export const CLIENT_SPAWN_FAULT_CODE = "CLIENT_SPAWN_FAULT";

/** True when the error came from the spawn boundary rather than from SQL. */
export function isClientSpawnFault(error) {
  return error?.code === CLIENT_SPAWN_FAULT_CODE;
}

/**
 * Build the tagged error for a spawn-level fault. `status` is null and `stderr` is EMPTY for
 * every one of these, so the underlying `error.code` is the only diagnostic that exists.
 */
export function clientSpawnFaultError(what, spawnError) {
  const error = new Error(
    `${what} could not be executed (${spawnError?.code ?? "spawn error"}): ${spawnError?.message ?? spawnError}` +
      " — this is a CLIENT-SIDE tooling fault, not a database failure.",
  );
  error.code = CLIENT_SPAWN_FAULT_CODE;
  error.spawnErrorCode = spawnError?.code ?? null;
  error.cause = spawnError;
  return error;
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
      {
        input: sql,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        // The SAME ceiling as the Supabase-CLI branch below. This branch had NONE, so wherever
        // DATABASE_URL was set the original 1 MiB ENOBUFS cliff was completely untouched by the
        // PR #362 fix — the two paths do the same job and any asymmetry between them is exactly
        // how this defect survived the first time.
        maxBuffer: SPAWN_MAX_BUFFER_BYTES,
      },
    );
    if (!psql.error && psql.status === 0) return psql.stdout;
    // ENOENT means psql is simply not installed — the documented fall-through to the Supabase
    // CLI below. Any OTHER spawn error (ENOBUFS, EACCES, a kill) is a client-side tooling
    // fault: `stderr` is empty for those, so the old `psql.stderr || "psql failed"` produced an
    // undiagnosable message that the caller then recorded as a database failure.
    if (psql.error && psql.error.code !== "ENOENT") throw clientSpawnFaultError("psql", psql.error);
    if (!psql.error) throw new Error(psql.stderr || "psql failed");
  }

  const dir = mkdtempSync(join(tmpdir(), "coldlion-sync-"));
  const file = join(dir, "query.sql");
  try {
    writeFileSync(file, sql, "utf8");
    // `--output json` is NOT the default. The default box-table renderer wraps a 1.3 MB JSON
    // cell across box-drawn lines, interleaving `|` borders into the payload, which is not
    // recoverable. Ask for json and let parsePhase6FunctionResult unwrap the column name.
    const args = linked
      ? ["db", "query", "--linked", "--output", "json", "--file", file]
      : ["db", "query", "--db-url", databaseUrl, "--output", "json", "--file", file];
    const result = spawnSync("supabase", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // Identical ceiling to the psql branch above — see SPAWN_MAX_BUFFER_BYTES.
      maxBuffer: SPAWN_MAX_BUFFER_BYTES,
    });
    if (result.error) {
      // Never let a spawn-level fault (ENOBUFS, ENOENT, EACCES) masquerade as a SQL failure.
      // Tagged CLIENT_SPAWN_FAULT so a caller cannot record it as a durable sync failure.
      throw clientSpawnFaultError("supabase db query", result.error);
    }
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
