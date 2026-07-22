#!/usr/bin/env node
// Operational runner for the guarded Coldlion /vendors -> core.factory sync (Phase A).
//
// Pulls Coldlion /vendors and calls public.sync_coldlion_vendors(payload) (the SECURITY
// DEFINER wrapper over plm.sync_coldlion_vendors). All curation guards live in SQL; this
// wrapper only adds the operational safety the DB function cannot: the empty/short-pull
// guard on the CALLER side and PR #107 durable-failure recording (a committed failed
// ingest.sync_run row in a separate transaction, since the in-function failed-status
// update rolls back with the aborted import).
//
// Usage:
//   DATABASE_URL=postgres://... node tools/sync-coldlion-vendors.mjs --dry-run
//   DATABASE_URL=postgres://... node tools/sync-coldlion-vendors.mjs --apply
// Coldlion key: env COLDLION_API_KEY, else `op read op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential`.
//
// --dry-run wraps the call in BEGIN/ROLLBACK so nothing persists (proves the guards without
// mutating). --apply commits. Neither is auto-run on import (helpers are unit-tested).

import { spawnSync } from "node:child_process";

// `pg` is loaded lazily (via loadPg) so the pure, unit-tested helpers below import without
// it. `pg` is not a repo dependency — install it into a scratch dir when running for real
// (AGENTS §9): `npm i pg` in a scratch cwd and run with NODE_PATH pointing at it.
async function loadPg() {
  return (await import("pg")).default;
}

export const VENDORS_URL =
  "http://x5.coldlion.com/EhpApi/vendors?companyCode=EDGEHOME&size=2000&page=0";
const API_KEY_REF = "op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential";

// The floor below which a pull is treated as suspicious. A 0-row pull is ALWAYS a hard
// failure (never call the importer); a short pull (0 < n < FLOOR) is a loud warning but
// still applied — a hard floor would freeze the sync forever if Coldlion legitimately
// shrinks. Kept configurable via env.
export const SHORT_PULL_FLOOR = Number(process.env.VENDOR_PULL_FLOOR ?? 50);

// Decide what to do with a pulled payload BEFORE touching the DB. Pure + unit-tested.
// Returns { action: 'abort'|'warn'|'ok', reason }.
export function classifyPull(rows) {
  if (!Array.isArray(rows)) return { action: "abort", reason: "payload is not an array" };
  if (rows.length === 0) return { action: "abort", reason: "empty /vendors pull (0 rows)" };
  if (rows.length < SHORT_PULL_FLOOR)
    return { action: "warn", reason: `short pull: ${rows.length} < floor ${SHORT_PULL_FLOOR}` };
  return { action: "ok", reason: `${rows.length} rows` };
}

export function readApiKey() {
  if (process.env.COLDLION_API_KEY) return process.env.COLDLION_API_KEY;
  const r = spawnSync("op", ["read", API_KEY_REF], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error("COLDLION_API_KEY not set and `op read` failed for the Coldlion key.");
  return r.stdout.trim();
}

export async function fetchVendors(apiKey) {
  const res = await fetch(VENDORS_URL, { headers: { "X-API-Key": apiKey } });
  if (!res.ok) throw new Error(`${VENDORS_URL} returned HTTP ${res.status}`);
  const body = await res.json();
  const rows = Array.isArray(body) ? body : body?.content;
  if (!Array.isArray(rows)) throw new Error("Coldlion /vendors did not return an array (or {content:[]}).");
  return rows;
}

// Record a committed failed run in its OWN connection so it survives an aborted import
// (PR #107). Best-effort + loud; never masks the original error.
async function recordFailure(connString, stage, message) {
  const pg = await loadPg();
  const client = new pg.Client({ connectionString: connString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query("select public.record_failed_sync_run($1,$2,$3)", [
      "coldlion_vendors_api",
      String(message ?? "").slice(0, 4000),
      stage,
    ]);
    process.stderr.write(`Recorded failed ingest.sync_run row (stage=${stage}).\n`);
  } catch (e) {
    process.stderr.write(`WARNING: could not record failed sync_run row: ${e?.message ?? e}\n`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function run({ dryRun }) {
  const connString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!connString) throw new Error("Set DATABASE_URL (or SUPABASE_DB_URL) to the target pooler.");

  let rows;
  try {
    rows = await fetchVendors(readApiKey());
  } catch (err) {
    await recordFailure(connString, "fetch", err?.message ?? String(err));
    throw err;
  }

  const decision = classifyPull(rows);
  if (decision.action === "warn") process.stderr.write(`WARNING: ${decision.reason}\n`);
  if (decision.action === "abort") {
    await recordFailure(connString, "fetch", decision.reason);
    throw new Error(`Refusing to apply: ${decision.reason}`);
  }

  const pg = await loadPg();
  const client = new pg.Client({ connectionString: connString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    const res = await client.query("select * from public.sync_coldlion_vendors($1::jsonb)", [JSON.stringify(rows)]);
    if (dryRun) {
      await client.query("rollback");
      console.log(JSON.stringify({ mode: "dry-run (rolled back)", pulled: rows.length, result: res.rows[0] }, null, 2));
    } else {
      await client.query("commit");
      console.log(JSON.stringify({ mode: "apply (committed)", pulled: rows.length, result: res.rows[0] }, null, 2));
    }
  } catch (err) {
    await client.query("rollback").catch(() => {});
    await recordFailure(connString, "apply", err?.message ?? String(err));
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (invokedDirectly) {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--dry-run") && !args.has("--apply")) {
    process.stderr.write("Pass --dry-run or --apply.\n");
    process.exitCode = 2;
  } else {
    run({ dryRun: args.has("--dry-run") }).catch((err) => {
      process.stderr.write(`coldlion vendor sync failed: ${err?.stack ?? err}\n`);
      process.exitCode = 1;
    });
  }
}
