// Database access for the landing loaders.
//
// This module deliberately does NOT reuse tools/coldlion-sync-common.mjs's runSql: that
// helper passes psql `--single-transaction`, which wraps the whole file for one path and
// nothing at all for the Supabase-CLI path. The loader's atomicity is not a side effect
// of how it happens to be invoked — each window's SQL opens and commits its OWN
// transaction, so it is executed with ON_ERROR_STOP and no outer wrapper.
//
// The spawn constants and the client-fault classification ARE shared, because a wedged
// or unspawnable psql is a fault in this repository's tooling and must never be recorded
// as a database failure.

import { spawnSync } from "node:child_process";
import {
  SPAWN_MAX_BUFFER_BYTES,
  SPAWN_TIMEOUT_MS,
  clientSpawnFaultError,
  isClientSpawnFault,
} from "../../coldlion-sync-common.mjs";

export { isClientSpawnFault };

export function databaseUrl() {
  const url = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!url) {
    const error = new Error(
      "No database target: set DATABASE_URL or SUPABASE_DB_URL before running a load.",
    );
    error.code = "NO_DB_TARGET";
    throw error;
  }
  return url;
}

/** Run SQL through psql. The SQL owns its own BEGIN/COMMIT. */
export function runSql(sql, { url = databaseUrl() } = {}) {
  const psql = spawnSync("psql", [url, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet", "-f", "-"], {
    input: sql,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: SPAWN_MAX_BUFFER_BYTES,
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  if (psql.error) throw clientSpawnFaultError("psql", psql.error);
  if (psql.status !== 0) {
    const error = new Error(redactPsqlError(psql.stderr));
    error.code = "DATABASE_COMMAND_FAILED";
    throw error;
  }
  return psql.stdout;
}

export function redactPsqlError(stderr) {
  const first=String(stderr??"").split(/\r?\n/).find((line)=>/ERROR:|FATAL:|PANIC:/.test(line)) ?? "Database command failed";
  return first.replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted-url]")
    .replace(/'[^'\r\n]*'/g,"[redacted-value]")
    .replace(/"[^"\r\n]*"/g,(match,offset,line)=>/(relation|column|constraint|table|schema|function|type)\s*$/i.test(line.slice(0,offset))?match:"[redacted-value]")
    .slice(0,1000);
}

/** A single scalar-or-tabular read, returned as rows of trimmed strings. */
export function queryRows(sql, options = {}) {
  const output = runSql(`\\pset format unaligned\n\\pset tuples_only on\n\\pset fieldsep '\\t'\n${sql}`, options);
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"));
}

/**
 * PROVE THE TARGET before every write. A loader that cannot say which database it is
 * about to write to has no business writing to it, and the landing schema must exist:
 * a "successful" load into a database missing coldlion.window_ledger is a load into
 * nothing.
 */
export const PRODUCTION_PROJECT_REF = "qsllyeztdwjgirsysgai";

/**
 * NAME THE TARGET, do not merely describe it.
 *
 * A preview database is built from these same migrations, so "the coldlion schema
 * exists" is satisfied by exactly the database this loader must never write to. The
 * caller therefore has to declare which project it means, and the declaration is
 * checked against the connection string rather than against the loader's own hopes.
 * Fail closed: an undeclared target is refused, so forgetting the variable can never
 * degrade into writing wherever the URL happens to point.
 */
export function assertExpectedTarget({
  expectedProjectRef = process.env.COLDLION_EXPECTED_PROJECT_REF,
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const ref = String(expectedProjectRef ?? "").trim();
  if (!ref) {
    throw new Error(
      "COLDLION_EXPECTED_PROJECT_REF is not set; refusing to write to an undeclared database",
    );
  }
  const url = String(databaseUrl ?? "").trim();
  if (!url) throw new Error("DATABASE_URL is not set; refusing to write");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a parseable connection URL; refusing to write");
  }
  // The project ref appears in the host of a direct connection and in the user of a
  // pooled one, so both spellings are accepted -- and nothing else is. The URL is
  // never printed; only the ref that was expected.
  const hostParts = parsed.hostname.split(".");
  const userParts = decodeURIComponent(parsed.username).split(/[.:]/);
  if (!hostParts.includes(ref) && !userParts.includes(ref)) {
    throw new Error(`the connection does not name project ${ref}; refusing to write`);
  }
  return { expectedProjectRef: ref, host: parsed.host };
}

export function proveTarget(options = {}) {
  const expected = assertExpectedTarget(options);
  const [row] = queryRows(
    `select current_database(),
            coalesce(inet_server_addr()::text, 'local'),
            (select count(*) from information_schema.tables
              where table_schema = 'coldlion') as coldlion_tables;`,
    options,
  );
  if (!row) throw new Error("the target database did not answer the pre-write proof");
  const [database, host, tables] = row;
  if (Number(tables) === 0) {
    throw new Error(`target ${database} has no coldlion schema; refusing to load`);
  }
  return { database, host, coldlionTables: Number(tables), expectedProjectRef: expected.expectedProjectRef };
}

/**
 * Record a terminal failure durably and raise the alert, in its own transaction.
 *
 * A CLIENT-SIDE spawn fault is deliberately NOT recorded: it says nothing about the data
 * or the database, and two of them in a row would otherwise trip a circuit breaker on a
 * healthy feed.
 */
export function recordFailure({ scope, window, runId, companyCode, requestedBy, error, options = {} }) {
  if (isClientSpawnFault(error)) return false;
  const message = String(error?.message ?? error).slice(0, 4000);
  const sql = `begin;
insert into coldlion.sync_run
  (id, endpoint, company_code, request_params, window_from, window_to,
   status, requested_by, started_at, finished_at, http_status, body_status, error_message)
values
  ('${runId}', ${literal(scope.endpoint)}, ${literal(companyCode)},
   jsonb_build_object('fromDate', ${literal(window.from)}, 'toDate', ${literal(window.to)}${
     scope.stage ? `, 'stageCode', ${literal(scope.stage)}` : ""
   }),
   date ${literal(window.from)}, date ${literal(window.to)},
   'failed', ${literal(requestedBy)}, now(), now(),
   ${error?.httpStatus ?? "null"}, ${error?.bodyStatus ?? "null"}, ${literal(message)})
on conflict (id) do nothing;

update coldlion.window_ledger
   set state = 'failed', last_error = ${literal(message)}
 where endpoint = ${literal(scope.endpoint)}
   and company_code = ${literal(companyCode)}
   and stage_code is not distinct from ${scope.stage ? literal(scope.stage) : "null"}
   and window_from = date ${literal(window.from)}
   and state <> 'loaded';

select pg_notify('coldlion_sync_alert', ${literal(
    `${scope.endpoint}${scope.stage ? ` ${scope.stage}` : ""} window ${window.from}: ${message}`.slice(0, 7000),
  )});
commit;`;
  runSql(sql, options);
  return true;
}

/** Record and alert a terminal current-state master failure. Dry runs never call this. */
export function masterFailureSql({ endpoint, companyCode, requestedBy, error }) {
  if (isClientSpawnFault(error)) return false;
  const message = String(error?.message ?? error).slice(0, 4000);
  return `begin;
insert into coldlion.sync_run
  (endpoint, company_code, request_params, status, requested_by, started_at, finished_at,
   http_status, body_status, error_message)
values
  (${literal(endpoint)}, ${literal(companyCode)}, ${literal(JSON.stringify({companyCode,fullSnapshot:true,...(error?.requestParams ? {request:error.requestParams} : {})}))}::jsonb,
   'failed', ${literal(requestedBy)}, now(), now(), ${error?.httpStatus ?? "null"}, ${error?.bodyStatus ?? "null"}, ${literal(message)});
select pg_notify('coldlion_sync_alert', ${literal(`${endpoint} master snapshot failed: ${message}`.slice(0, 7000))});
commit;`;
}

export function recordMasterFailure({ endpoint, companyCode, requestedBy, error, options = {} }) {
  const sql = masterFailureSql({ endpoint, companyCode, requestedBy, error });
  if (sql === false) return false;
  runSql(sql, options);
  return true;
}

function literal(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}
