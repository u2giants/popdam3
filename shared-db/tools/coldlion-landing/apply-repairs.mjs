#!/usr/bin/env node
// Apply committed one-time ColdLion data repairs (tools/coldlion-landing/
// repairs/*.sql), each exactly once. A repair records itself as a
// coldlion.sync_run row whose request_params.step is its file name (minus
// .sql) inside its own transaction, so "already applied" is a database fact,
// never a local marker. Runs in the intake workflow before the writer, on the
// workflow's production secret: reviewed SQL lands from main, never by hand.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { proveTarget, queryRows, runSql } from "./lib/db.mjs";
import { sqlText } from "./lib/values.mjs";

const REPAIRS = join(dirname(fileURLToPath(import.meta.url)), "repairs");

/** The step name a repair file must record; refuses a file that does not. */
export function repairStep(file, sql) {
  const step = file.replace(/\.sql$/, "");
  if (!/^\d{8}-[a-z0-9-]+\.sql$/.test(file)) throw new Error(`${file} is not named <yyyymmdd>-<slug>.sql`);
  if (!sql.includes(`'${step}'`)) throw new Error(`${file} never records step '${step}'`);
  if (!/^begin;$/m.test(sql) || !/^commit;\s*$/m.test(sql.trimEnd().split("\n").at(-1) + "\n")) {
    throw new Error(`${file} must be one transaction (a begin; line and a final commit; line)`);
  }
  return step;
}

function main() {
  proveTarget();
  for (const file of readdirSync(REPAIRS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(REPAIRS, file), "utf8");
    const step = repairStep(file, sql);
    const [done] = queryRows(`select count(*) from coldlion.sync_run where request_params ->> 'step' = ${sqlText(step)};`, {});
    if (done?.[0] !== "0") {
      console.log(`repair ${step}: already applied`);
      continue;
    }
    try {
      runSql(sql, {});
    } catch (error) {
      // The repair rolled back; say so where every intake failure is heard.
      const note = `ColdLion repair ${step} refused: ${String(error.message).slice(0, 500)}`;
      try { runSql(`select pg_notify('coldlion_sync_alert', ${sqlText(note)});`, {}); } catch { /* the red step still reports it */ }
      throw error;
    }
    console.log(`repair ${step}: applied`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
