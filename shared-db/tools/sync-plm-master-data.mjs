#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function applyImport(licensors, customers) {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!databaseUrl && !useLinkedSupabase) {
    throw new Error(
      "DATABASE_URL or SUPABASE_DB_URL is required when using --apply, unless --linked is set.",
    );
  }

  const sql = `
select *
from plm.import_master_data(
  ${sqlDollarQuote("plm_licensors", licensors)}::jsonb,
  ${sqlDollarQuote("plm_customers", customers)}::jsonb
);
`;

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
      process.stdout.write(psqlResult.stdout);
      return;
    }

    if (psqlResult.error?.code !== "ENOENT") {
      process.stderr.write(psqlResult.stderr ?? "");
      throw new Error("psql import failed.");
    }
  }

  const dir = mkdtempSync(join(tmpdir(), "plm-master-data-"));
  const file = join(dir, "import.sql");

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
      process.stderr.write(supabaseResult.stderr);
      throw new Error("supabase db query import failed.");
    }

    process.stdout.write(supabaseResult.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const apiKey = readApiKey();
const [licensors, customers] = await Promise.all([
  fetchJson(LICENSORS_URL, apiKey),
  fetchJson(CUSTOMERS_URL, apiKey),
]);

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
  applyImport(licensors, customers);
}
