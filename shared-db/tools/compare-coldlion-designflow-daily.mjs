#!/usr/bin/env node
// Phase 6 daily comparison runner (preview only).
//
// Calls public.record_taxonomy_parallel_observation(...) which computes ALL
// hashes and counts from live DB state. The runner never supplies hash values.
//
// Usage:
//   node tools/compare-coldlion-designflow-daily.mjs                 # dry-run (SQL only)
//   node tools/compare-coldlion-designflow-daily.mjs --apply --linked
//   node tools/compare-coldlion-designflow-daily.mjs --apply --linked --force-fail
//
// --force-fail exercises durable alert + failed comparison run without mutating
// canonical rows (safe drill). Exit code is non-zero when pass=false.

import { readLinkedProjectRefSync, repoRootFrom } from "./check-supabase-link-state.mjs";

import { pathToFileURL } from "node:url";
import { runSql, sqlDollarQuote } from "./coldlion-sync-common.mjs";
import {
  PREVIEW_PROJECT_REF,
  assertNoProductionEnv,
  assertPreviewApplyTarget,
  resolveRunMode,
} from "./phase6-preview-guards.mjs";
import {
  parseComparisonResult,
  comparisonExitCode,
} from "./phase6-cli-result-parse.mjs";
import {
  assertColdlionApplyTarget,
  describeAuthorizedTarget,
  resolveProductionAuthorization,
} from "./coldlion-production-authorization.mjs";

export {
  PREVIEW_PROJECT_REF,
  assertPreviewApplyTarget,
  resolveRunMode,
} from "./phase6-preview-guards.mjs";

export { parseComparisonResult, comparisonExitCode } from "./phase6-cli-result-parse.mjs";

export function buildComparisonSql({ observationDate = null, forceFail = false, maxSuccessAge = "36 hours" } = {}) {
  const daySql =
    observationDate == null
      ? "null::date"
      : `${sqlDollarQuote("obs_day", observationDate)}::date`;
  const opts = {
    max_success_age: maxSuccessAge,
    force_fail: Boolean(forceFail),
  };
  return `select public.record_taxonomy_parallel_observation(
  ${daySql},
  ${sqlDollarQuote("obs_opts", opts)}::jsonb
);\n`;
}

function readLinkedProjectRef() {
  // #593: delegate to the shared reader. Same contract as the single-file read
  // it replaces -- the CLI-authoritative ref, or null when unlinked -- but a
  // `project-ref` / `linked-project.json` split is now REPORTED instead of
  // invisible, and `repoRootFrom` pins it to THIS checkout under the
  // agent-per-worktree model.
  return readLinkedProjectRefSync({ root: repoRootFrom(import.meta.url) });
}

function main(argv = process.argv.slice(2), env = process.env) {
  // WIRED FOR PRODUCTION 2026-07-28 (Kimi review). This runner records the
  // append-only comparison observation that the readiness command REQUIRES. It was
  // preview-only, and it was not in the Step 7 command list, so on production the
  // readiness gate could never go green: before linking the identity check fails
  // (0 ColdLion refs), and after linking the comparison check fails because no
  // observation exists and the operator had no authorized way to create one. The
  // cutover would have ended on a red light with no instruction — the fourth
  // instance of "the pieces pass, the sequence does not run".
  const auth = resolveProductionAuthorization(argv, env);
  if (!(auth.requested && auth.authorized)) assertNoProductionEnv(env);
  const mode = resolveRunMode(argv, env);
  const linkedProjectRef = mode.linked ? readLinkedProjectRef() : null;
  assertColdlionApplyTarget({
    apply: mode.apply,
    linked: mode.linked,
    connString: mode.connString,
    linkedProjectRef,
    argv,
    env,
    assertPreviewApplyTarget,
  });

  const sql = buildComparisonSql({
    forceFail: mode.forceFail,
    maxSuccessAge: env.PHASE6_MAX_SUCCESS_AGE ?? "36 hours",
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "compare-coldlion-designflow-daily",
        authorized_target: describeAuthorizedTarget(argv, env),
        target: mode.target,
        mode: mode.apply ? "apply" : "dry-run (no DB write)",
        force_fail: mode.forceFail,
        preview_project_ref: PREVIEW_PROJECT_REF,
        note: "Hashes/counts are computed inside SQL from live tables; runner never supplies them.",
      },
      null,
      2,
    )}\n`,
  );

  if (!mode.apply) {
    process.stdout.write(sql);
    process.stdout.write("Dry-run complete. Re-run with --apply --linked against preview to persist.\n");
    return 0;
  }

  const stdout = runSql(sql, { linked: mode.linked });
  process.stdout.write(stdout);
  const result = parseComparisonResult(stdout);
  const code = comparisonExitCode(result);
  if (code !== 0) {
    process.stderr.write(
      `Phase 6 daily comparison FAILED (pass=${result?.pass ?? "unknown"}, unexplained=${result?.unexplained_diff_count ?? "?"})\n`,
    );
  } else {
    process.stdout.write("Phase 6 daily comparison PASS\n");
  }
  return code;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`compare-coldlion-designflow-daily failed: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
  }
}

export { main, buildComparisonSql as buildSql };
