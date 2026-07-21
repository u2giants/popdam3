#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const LICENSORS_URL =
  "https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties";
const CUSTOMERS_URL = "https://api.designflow.app/api/core/customers/getCustomers";
const API_KEY_REF =
  "op://vibe_coding/DesignFlow PLM Canonical Master Data API/api_key";

const args = new Set(process.argv.slice(2));
const shouldApply = args.has("--apply");
const useLinkedSupabase = args.has("--linked");

function readApiKey() {
  if (process.env.DESIGNFLOW_API_KEY) {
    return process.env.DESIGNFLOW_API_KEY;
  }
  if (process.env.PLM_API_KEY) {
    return process.env.PLM_API_KEY;
  }

  const result = spawnSync("op", ["read", API_KEY_REF], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      "DESIGNFLOW_API_KEY is not set and `op read` failed for the 1Password API key reference.",
    );
  }

  return result.stdout.trim();
}

async function fetchJson(url, apiKey) {
  const response = await fetch(url, {
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`${url} returned ${typeof payload}; expected a JSON array.`);
  }

  return payload;
}

function countProperties(licensors) {
  return licensors.reduce((count, licensor) => {
    return count + (Array.isArray(licensor.properties) ? licensor.properties.length : 0);
  }, 0);
}

function sqlDollarQuote(tag, value) {
  const json = JSON.stringify(value);
  if (json.includes(`$${tag}$`)) {
    throw new Error(`JSON payload unexpectedly contains dollar quote tag ${tag}.`);
  }

  return `$${tag}$${json}$${tag}$`;
}

// Dollar-quote a plain text literal (not a JSON payload) for SQL.
function sqlDollarQuoteText(tag, value) {
  const text = String(value ?? "");
  if (text.includes(`$${tag}$`)) {
    throw new Error(`text unexpectedly contains dollar quote tag ${tag}.`);
  }

  return `$${tag}$${text}$${tag}$`;
}

function buildImportSql(licensors, customers) {
  return `
select *
from plm.import_master_data(
  ${sqlDollarQuote("plm_licensors", licensors)}::jsonb,
  ${sqlDollarQuote("plm_customers", customers)}::jsonb
);
`;
}

// Build a committed failure record for ingest.sync_run.
//
// WHY THIS LIVES IN THE WRAPPER, NOT THE DATABASE FUNCTION:
// plm.import_master_data() sets status='failed' in its `exception when others`
// handler and then re-raises. Re-raising aborts the transaction, so that
// UPDATE — and the earlier status='running' INSERT — are both rolled back and
// leave no row. On top of that, the most common failure today is an upstream
// HTTP error in fetchJson(), which happens before the import transaction even
// starts. Either way a failed run used to leave NO trace, so ingest.sync_run
// showed only successes. This statement runs in its own transaction and
// therefore survives, satisfying the "no silent failures" rule.
function buildFailedSyncRunSql(stage, message) {
  const trimmed = String(message ?? "").slice(0, 4000);
  return `insert into ingest.sync_run
  (source_system, source_name, status, started_at, finished_at, error, metadata)
values
  ('designflow_plm', 'plm_master_data_api', 'failed', now(), now(),
   ${sqlDollarQuoteText("plm_err", trimmed)},
   jsonb_build_object(
     'recorded_by', 'sync-plm-master-data.mjs',
     'stage', ${sqlDollarQuoteText("plm_stage", stage)},
     'note', 'Written by the host wrapper; the in-transaction failed-status update in plm.import_master_data() is rolled back with the aborted import transaction.'
   ));
`;
}

// Run a SQL statement against the target database. Prefers a direct DATABASE_URL
// via psql; falls back to the Supabase CLI (either --linked or --db-url).
// Returns stdout on success; throws on failure. Throws an error tagged
// code='NO_DB_TARGET' when there is no way to reach a database.
function runSql(sql) {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!databaseUrl && !useLinkedSupabase) {
    const err = new Error(
      "No database target: set DATABASE_URL or SUPABASE_DB_URL, or pass --linked.",
    );
    err.code = "NO_DB_TARGET";
    throw err;
  }

  if (databaseUrl && !useLinkedSupabase) {
    const psqlResult = spawnSync(
      "psql",
      [databaseUrl, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--single-transaction"],
      {
        input: sql,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    if (!psqlResult.error && psqlResult.status === 0) {
      return psqlResult.stdout;
    }

    if (psqlResult.error?.code !== "ENOENT") {
      process.stderr.write(psqlResult.stderr ?? "");
      throw new Error("psql command failed.");
    }
    // psql not installed (ENOENT) — fall through to the Supabase CLI.
  }

  const dir = mkdtempSync(join(tmpdir(), "plm-master-data-"));
  const file = join(dir, "query.sql");

  try {
    writeFileSync(file, sql, "utf8");
    const supabaseArgs = useLinkedSupabase
      ? ["db", "query", "--linked", "--file", file]
      : ["db", "query", "--db-url", databaseUrl, "--file", file];
    const supabaseResult = spawnSync("supabase", supabaseArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (supabaseResult.status !== 0) {
      process.stderr.write(supabaseResult.stderr ?? "");
      throw new Error("supabase db query failed.");
    }

    return supabaseResult.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function applyImport(licensors, customers) {
  process.stdout.write(runSql(buildImportSql(licensors, customers)));
}

// Best-effort: record a durable failed row. Never throws — a failure to record
// must not mask the original error, but it is reported loudly so it is never
// silent.
function recordFailedSyncRun(stage, error) {
  const message = error?.message ?? String(error);
  try {
    runSql(buildFailedSyncRunSql(stage, message));
    process.stderr.write(
      `Recorded failed ingest.sync_run row (stage=${stage}).\n`,
    );
  } catch (recordErr) {
    if (recordErr?.code === "NO_DB_TARGET") {
      process.stderr.write(
        "WARNING: could not record failed ingest.sync_run row — no database target configured. " +
          "The systemd OnFailure alert and non-zero exit are the only signals for this run.\n",
      );
    } else {
      process.stderr.write(
        `WARNING: could not record failed ingest.sync_run row: ${recordErr?.message ?? recordErr}\n`,
      );
    }
  }
}

async function main() {
  const apiKey = readApiKey();

  let licensors;
  let customers;
  try {
    [licensors, customers] = await Promise.all([
      fetchJson(LICENSORS_URL, apiKey),
      fetchJson(CUSTOMERS_URL, apiKey),
    ]);
  } catch (err) {
    if (shouldApply) {
      recordFailedSyncRun("fetch", err);
    }
    throw err;
  }

  console.log(
    JSON.stringify(
      {
        licensors: licensors.length,
        properties: countProperties(licensors),
        customers: customers.length,
        licensorKeys: Object.keys(licensors[0] ?? {}),
        propertyKeys: Object.keys(licensors[0]?.properties?.[0] ?? {}),
        customerKeys: Object.keys(customers[0] ?? {}),
        apply: shouldApply,
      },
      null,
      2,
    ),
  );

  if (shouldApply) {
    try {
      applyImport(licensors, customers);
    } catch (err) {
      recordFailedSyncRun("apply", err);
      throw err;
    }
  }
}

// Only auto-run when invoked directly, so the pure helpers can be imported by
// the test file without triggering a live sync.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`plm master-data sync failed: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
  });
}

export {
  buildImportSql,
  buildFailedSyncRunSql,
  countProperties,
  sqlDollarQuote,
  sqlDollarQuoteText,
};
