// Offline contract tests for the ColdLion recurring-promotion SERIALIZATION guard
// (migration 20260731180000, raised as a Medium finding against PR #331).
//
// These run with no database and no secrets. They cover the three surfaces that have to
// agree about one outcome — the migration, the host runner, and the production workflow —
// because the failure mode here is not "the lock is missing", it is "the lock is there but
// one of the three layers reads a skip as a failure". That would fire the
// two-consecutive-failure pg_notify breaker on a perfectly healthy overlap and block
// promotion until an authorized reset: an outage manufactured out of a normal race.
//
// The genuine two-connection concurrency proof lives in
// supabase/tests/coldlion_promotion_serialization_lock.sql, run against preview.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EXIT_SKIPPED_ALREADY_RUNNING,
  PROMOTION_ADVISORY_LOCK_KEY,
  SKIPPED_ALREADY_RUNNING_MODE,
  SOURCE_NAME,
  isAlreadyRunningSkip,
} from "./promote-coldlion-source-owned.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const migration = read(
  "../supabase/migrations/20260731180000_coldlion_recurring_promotion_serialization_lock.sql",
);
const runner = read("./promote-coldlion-source-owned.mjs");
const syncCommon = read("./coldlion-sync-common.mjs");
const workflow = read("../.github/workflows/coldlion-licensor-property-production.yml");
const registry = read("../docs/advisory-lock-registry.md");

// =====================================================================================
// The lock itself
// =====================================================================================

test("the migration takes a transaction-scoped TRY lock, never a blocking or session lock", () => {
  assert.match(migration, /pg_try_advisory_xact_lock\(v_lock_key\)/);
  // A blocking wait would queue a scheduled run behind a drill and then let it apply a
  // plan computed against a snapshot that has since moved.
  assert.doesNotMatch(migration, /perform\s+pg_advisory_xact_lock\s*\(/);
  // A session lock survives a crashed backend and wedges the lane with no way back.
  assert.doesNotMatch(migration, /\bpg_advisory_lock\s*\(/);
  assert.doesNotMatch(migration, /\bpg_try_advisory_lock\s*\(/);
});

test("the key is a documented literal constant, not a hashtext() derivation", () => {
  assert.match(
    migration,
    new RegExp(`v_lock_key\\s+constant bigint\\s*:=\\s*${PROMOTION_ADVISORY_LOCK_KEY};`),
  );
  // hashtext() is only stable within a PostgreSQL major version. A major upgrade could
  // move the lock and let two runs interleave with nothing anywhere to show for it.
  // Comment lines are stripped first — the 5.0 block explains hashtext() at length, and a
  // naive scan of the raw text would fail on the explanation rather than on real code.
  const executable = migration
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  assert.doesNotMatch(executable, /hashtext/i);
  // The 5.0 block must physically sit ahead of the 5.1 breaker check.
  assert.ok(
    migration.indexOf("5.0 SERIALIZATION GUARD") <
      migration.indexOf("5.1 The breaker must be closed"),
  );
});

test("the lock is taken before the breaker check and before the approved-contract check", () => {
  const lock = migration.indexOf("pg_try_advisory_xact_lock");
  const breaker = migration.indexOf("plm.taxonomy_circuit_breaker_is_open(");
  const contract = migration.indexOf("1230f5a12d0f2a3029f1d3df17fc5b5f");
  assert.ok(lock > 0 && breaker > 0 && contract > 0);
  // A second caller must decide "skip" immediately, not half-compute a cycle it discards,
  // and a skip must never be reported as a breaker refusal.
  assert.ok(lock < breaker, "the lock must precede the breaker check");
  assert.ok(lock < contract, "the lock must precede the approved-contract check");
});

test("the key is registered so a future feature cannot silently reuse it", () => {
  assert.match(registry, new RegExp(`\`${PROMOTION_ADVISORY_LOCK_KEY}\``));
  assert.match(registry, /plm\.promote_coldlion_source_owned/);
  assert.match(migration, /docs\/advisory-lock-registry\.md/);
});

// =====================================================================================
// Losing the race is RECORDED, not swallowed
// =====================================================================================

test("the skip writes a durable sync_run row — it is never a silent no-op", () => {
  const skipBlock = migration.slice(
    migration.indexOf("if not coalesce(v_lock_acquired, false) then"),
    migration.indexOf("5.1 The breaker must be closed"),
  );
  assert.ok(skipBlock.length > 0);
  assert.match(skipBlock, /insert into ingest\.sync_run/);
  assert.match(skipBlock, new RegExp(`'${SOURCE_NAME}'`));
  assert.match(skipBlock, new RegExp(`'outcome', '${SKIPPED_ALREADY_RUNNING_MODE}'`));
  assert.match(skipBlock, /'advisory_lock_key', v_lock_key/);
  // An operator reading ingest.sync_run must be able to tell what happened without
  // reading this migration.
  assert.match(skipBlock, /raise warning/);
  assert.match(skipBlock, /returning id into v_run_id/);
});

test("the skip is recorded as CANCELLED, never as FAILED", () => {
  const skipBlock = migration.slice(
    migration.indexOf("if not coalesce(v_lock_acquired, false) then"),
    migration.indexOf("5.1 The breaker must be closed"),
  );
  assert.match(skipBlock, /'cancelled', now\(\), now\(\)/);
  assert.doesNotMatch(skipBlock, /'failed'/);
  assert.match(skipBlock, /'counts_toward_consecutive_failure_breaker', false/);
});

test("the breaker that must not fire is the one keyed on consecutive FAILED rows", () => {
  // This is the fact the previous test depends on. If the breaker is ever re-keyed to
  // count cancelled rows too, that change has to break here rather than silently start
  // tripping on healthy overlaps.
  assert.match(syncCommon, /pg_notify\('coldlion_sync_alert'/);
  assert.match(syncCommon, /status='failed'/);
  assert.match(syncCommon, /where failures >= 2/);
  assert.doesNotMatch(syncCommon, /status='cancelled'/);
});

test("the skip returns a distinguishable mode with every count zero", () => {
  const skipBlock = migration.slice(
    migration.indexOf("if not coalesce(v_lock_acquired, false) then"),
    migration.indexOf("5.1 The breaker must be closed"),
  );
  assert.match(
    skipBlock,
    new RegExp(`return query select v_run_id, '${SKIPPED_ALREADY_RUNNING_MODE}'::text`),
  );
  // Eight zero counts follow the run id and the mode.
  assert.match(skipBlock, /0, 0, 0, 0, 0, 0, 0, 0;/);
});

test("the migration neither enables the production lane nor invents the enable flag", () => {
  assert.doesNotMatch(migration, /COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED\s*=\s*true/);
  assert.match(migration, /does NOT enable the production lane/);
});

// =====================================================================================
// The runner reports the skip distinctly from BOTH success and failure
// =====================================================================================

test("the runner exposes a third exit code, distinct from success and failure", () => {
  assert.equal(EXIT_SKIPPED_ALREADY_RUNNING, 3);
  assert.notEqual(EXIT_SKIPPED_ALREADY_RUNNING, 0);
  assert.notEqual(EXIT_SKIPPED_ALREADY_RUNNING, 1);
  assert.notEqual(EXIT_SKIPPED_ALREADY_RUNNING, 2);
  assert.match(runner, /3 skipped because another promotion already holds the lane lock/);
});

test("isAlreadyRunningSkip recognises the database's skip result", () => {
  const promoteOut = [
    "     sync_run_id      |          mode           | source_rows | linked_rows",
    "----------------------+-------------------------+-------------+------------",
    ` 0e3a...              | ${SKIPPED_ALREADY_RUNNING_MODE} |           0 |          0`,
  ].join("\n");
  assert.equal(isAlreadyRunningSkip(promoteOut), true);
});

test("isAlreadyRunningSkip does NOT read an ordinary promotion or a failure as a skip", () => {
  // The dangerous direction: mistaking a real problem for a benign skip would exit 3 and
  // suppress the alert entirely.
  assert.equal(isAlreadyRunningSkip(" promote_source_owned | 542 | 271 | 0"), false);
  assert.equal(
    isAlreadyRunningSkip("ERROR: ColdLion promotion ABORTED on a protected invariant"),
    false,
  );
  // "skipped" on its own is not the contract — quarantine reasons and NOTICEs use that word.
  assert.equal(isAlreadyRunningSkip("NOTICE: 3 rows skipped for review"), false);
  assert.equal(isAlreadyRunningSkip("skipped"), false);
  assert.equal(isAlreadyRunningSkip(""), false);
  assert.equal(isAlreadyRunningSkip(null), false);
  assert.equal(isAlreadyRunningSkip(undefined), false);
});

test("the runner returns exit 3 without taking the alerting/failure path", () => {
  const main = runner.slice(runner.indexOf("stage = \"promote\";"));
  const skipIdx = main.indexOf("isAlreadyRunningSkip(promoteOut)");
  const refusalIdx = main.indexOf("/protected|ABORTED|refused/i");
  assert.ok(skipIdx > 0, "the runner must check for a skip after the promote call");
  assert.ok(refusalIdx > 0);
  // Order is load-bearing: the refusal heuristic must never get first look at a skip.
  assert.ok(skipIdx < refusalIdx, "the skip check must precede the refusal heuristic");
  // The skip returns straight out, so it cannot reach the catch block that writes a
  // durable failed row (buildFailedSyncRunSql) and records a critical alert.
  const skipBranch = main.slice(skipIdx, main.indexOf("return EXIT_SKIPPED_ALREADY_RUNNING;"));
  assert.doesNotMatch(skipBranch, /buildPromotionAlertSql/);
  assert.doesNotMatch(skipBranch, /buildFailedSyncRunSql/);
  assert.doesNotMatch(skipBranch, /throw /);
});

test("the runner explains, in the operator's words, that a skip is not a failure", () => {
  assert.match(runner, /PROMOTION SKIPPED/);
  assert.match(runner, /does not count toward the two-consecutive-failure breaker|This is NOT a failure/);
});

// =====================================================================================
// The workflow must not turn a healthy skip into a red scheduled run
// =====================================================================================

test("the production workflow maps exit 3 to a green job with a notice", () => {
  const step = workflow.slice(
    workflow.indexOf("promote — approved source-owned promotion"),
    workflow.indexOf("compare — ColdLion vs DesignFlow daily comparison"),
  );
  assert.ok(step.length > 0, "the promote step must still exist");
  assert.match(step, /promote_status=\$\?/);
  assert.match(step, /if \[ "\$promote_status" -eq 3 \]; then/);
  assert.match(step, /::notice::/);
  assert.match(step, /exit "\$promote_status"/);
  // `set -e` would abort on exit 3 before the status could ever be inspected.
  assert.doesNotMatch(step, /set -euo pipefail/);
  assert.match(step, /set -uo pipefail/);
});

test("every other exit code still fails the workflow step", () => {
  const step = workflow.slice(
    workflow.indexOf("promote — approved source-owned promotion"),
    workflow.indexOf("compare — ColdLion vs DesignFlow daily comparison"),
  );
  // Only 3 is special-cased; the final `exit "$promote_status"` propagates 1 and 2.
  assert.equal((step.match(/-eq 3 /g) ?? []).length, 1);
  assert.doesNotMatch(step, /-eq 1 \]/);
  assert.doesNotMatch(step, /\|\| true/);
});

test("this change does not enable the production lane", () => {
  // The lane stays disabled; the exit-3 mapping is part of its standing contract, not an
  // enablement. Step 8 (Albert's production approval) is unchanged. The gate must still be
  // the repository variable — which does not exist — and must still skip loudly without it.
  assert.match(
    workflow,
    /if \[ "\$\{\{ vars\.COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED \}\}" = "true" \]; then/,
  );
  assert.match(workflow, /::warning title=ColdLion production feed is DISABLED::/);
  assert.match(workflow, /NO preview fallback and NO dry-run fallback/);
  // The promote step this change edits stays behind that gate.
  const promoteStep = workflow.slice(
    workflow.indexOf("promote — approved source-owned promotion"),
    workflow.indexOf("compare — ColdLion vs DesignFlow daily comparison"),
  );
  assert.match(promoteStep, /if: env\.LANE == 'promote'/);
});
