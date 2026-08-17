// Regression guard: WHERE ColdLion promotion failures are durably recorded.
//
// The answer is `tools/promote-coldlion-source-owned.mjs`, out of band, in SEPARATE psql
// transactions that run after the aborted promotion transaction is already gone. It is NOT
// `plm.promote_coldlion_source_owned`, and it can never be, because nothing inside a
// transaction can leave a durable trace of that transaction's own abort.
//
// Between 20260729230000 and 20260730000500 the function nevertheless carried code that
// looked exactly like in-database failure recording: a body-level `exception when others`
// handler running `update ingest.sync_run set status = 'failed'`, plus two inline copies of
// the same UPDATE before a RAISE. All of it was dead — a PL/pgSQL block with an exception
// handler is a subtransaction, so the section 5.3 INSERT that created the run row was already
// rolled back by the time the UPDATE ran, and it matched zero rows every time. Removed by
// 20260731163000.
//
// These tests fail if either half of that arrangement is undone: if the dead in-function
// recording comes back (a future reader would trust it), or if the runner's real out-of-band
// path is deleted as "redundant" (that WOULD be a genuine silent failure).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");

const DEAD_CODE_REMOVAL_VERSION = "20260731163000";

/**
 * The migration that currently defines plm.promote_coldlion_source_owned is the
 * HIGHEST-versioned migration that redefines it — Postgres keeps whichever
 * `create or replace` applied last, so the newest file is the live body.
 */
function currentPromotionMigration() {
  const candidates = readdirSync(migrationsDir)
    .filter((name) => /^\d{14}.*\.sql$/.test(name))
    .filter((name) =>
      readFileSync(path.join(migrationsDir, name), "utf8").includes(
        "create or replace function plm.promote_coldlion_source_owned(",
      ),
    )
    .sort();
  assert.ok(candidates.length > 0, "no migration defines plm.promote_coldlion_source_owned");
  const newest = candidates[candidates.length - 1];
  return { name: newest, sql: readFileSync(path.join(migrationsDir, newest), "utf8") };
}

/** The function body only — header comments explain the dead code and must not trip the guards. */
function functionBody(sql) {
  const start = sql.indexOf("create or replace function plm.promote_coldlion_source_owned(");
  assert.ok(start >= 0);
  return sql.slice(start);
}

test("the live promotion migration is at or after the dead-code removal", () => {
  const { name } = currentPromotionMigration();
  assert.ok(
    name.slice(0, 14) >= DEAD_CODE_REMOVAL_VERSION,
    `${name} redefines plm.promote_coldlion_source_owned but sorts before ${DEAD_CODE_REMOVAL_VERSION}, ` +
      "so it would re-apply the dead in-function failure recording over the corrected body.",
  );
});

test("the function has no body-level `exception when others` handler", () => {
  const body = functionBody(currentPromotionMigration().sql);
  const code = body
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.ok(
    !/\bexception\s*\n\s*when\s+others\b/i.test(code),
    "a body-level `exception when others` handler makes the whole function body a subtransaction, " +
      "which is precisely what made the old in-function failure UPDATE dead. Durable failure " +
      "recording belongs in tools/promote-coldlion-source-owned.mjs, out of band.",
  );
});

test("the function never tries to mark its own ingest.sync_run row failed", () => {
  const body = functionBody(currentPromotionMigration().sql);
  const code = body
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.ok(
    !/update\s+ingest\.sync_run[\s\S]{0,200}?status\s*=\s*'failed'/i.test(code),
    "an in-function `update ingest.sync_run set status = 'failed'` can never persist: the RAISE " +
      "that follows it aborts the transaction that inserted the run row. Do not reintroduce it.",
  );
});

test("the current function either records SUCCESS in-band or is loudly retired", () => {
  const body = functionBody(currentPromotionMigration().sql);
  assert.ok(
    /update ingest\.sync_run\s*\n\s*set status = 'succeeded'/.test(body) ||
      /retired until #1090 Step 4/.test(body),
    "an active promotion records success; a retired promotion must refuse loudly",
  );
});

test("the migration points at durable failure ownership or loudly documents retirement", () => {
  const { sql } = currentPromotionMigration();
  assert.ok(
    (/tools\/promote-coldlion-source-owned\.mjs/.test(sql) && /record_taxonomy_sync_alert/.test(sql) && /buildFailedSyncRunSql/.test(sql)) ||
      /retired until #1090 Step 4/.test(sql),
    "active promotion must own durable failure evidence; retired promotion must refuse loudly",
  );
});

test("the runner keeps its out-of-band durable failure path", () => {
  const runner = readFileSync(path.join(repoRoot, "tools", "promote-coldlion-source-owned.mjs"), "utf8");
  assert.match(
    runner,
    /buildPromotionAlertSql\(/,
    "the critical taxonomy alert is what trips the breaker autotrip and fires pg_notify.",
  );
  assert.match(
    runner,
    /buildFailedSyncRunSql\(/,
    "the fresh failed ingest.sync_run row is the durable record of the failure.",
  );
  assert.match(runner, /record_taxonomy_sync_alert/);
  // Both must sit in the catch block — i.e. after the promotion transaction has aborted.
  const catchAt = runner.indexOf("} catch (error) {");
  assert.ok(catchAt > 0, "the runner's catch block is the whole mechanism; it is gone.");
  assert.ok(runner.indexOf("buildPromotionAlertSql(", catchAt) > catchAt);
  assert.ok(runner.indexOf("buildFailedSyncRunSql(", catchAt) > catchAt);
});
