#!/usr/bin/env node
// Phase 6 sync health checker (preview only).
//
// Calls public.check_taxonomy_sync_health(...) which inspects live ingest.sync_run
// rows and Phase 4 link counts. Exit non-zero on any issue so CI fails loudly.
//
// Usage:
//   node tools/check-coldlion-designflow-sync-health.mjs                 # dry-run SQL
//   node tools/check-coldlion-designflow-sync-health.mjs --apply --linked
//   node tools/check-coldlion-designflow-sync-health.mjs --apply --linked --force-fail
//
// --force-fail writes a durable alert + failed health run without mutating
// canonical UUID/status/parent/source-ref data (safe alert proof).

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runSql, sqlDollarQuote } from "./coldlion-sync-common.mjs";
import {
  PREVIEW_PROJECT_REF,
  assertNoProductionEnv,
  assertPreviewApplyTarget,
  resolveRunMode,
} from "./phase6-preview-guards.mjs";
import {
  parseHealthResult,
  healthExitCode,
} from "./phase6-cli-result-parse.mjs";

export {
  PREVIEW_PROJECT_REF,
  assertPreviewApplyTarget,
  resolveRunMode,
} from "./phase6-preview-guards.mjs";

export { parseHealthResult, healthExitCode } from "./phase6-cli-result-parse.mjs";

export function buildHealthSql({ maxSuccessAge = "36 hours", forceFail = false } = {}) {
  const opts = { force_fail: Boolean(forceFail) };
  return `select public.check_taxonomy_sync_health(
  ${sqlDollarQuote("max_age", maxSuccessAge)}::interval,
  ${sqlDollarQuote("health_opts", opts)}::jsonb
);\n`;
}

function readLinkedProjectRef() {
  try {
    return readFileSync(new URL("../supabase/.temp/project-ref", import.meta.url), "utf8").trim();
  } catch {
    return null;
  }
}

function main(argv = process.argv.slice(2), env = process.env) {
  assertNoProductionEnv(env);
  const mode = resolveRunMode(argv, env);
  const linkedProjectRef = mode.linked ? readLinkedProjectRef() : null;
  assertPreviewApplyTarget({
    apply: mode.apply,
    linked: mode.linked,
    connString: mode.connString,
    linkedProjectRef,
  });

  const sql = buildHealthSql({
    forceFail: mode.forceFail,
    maxSuccessAge: env.PHASE6_MAX_SUCCESS_AGE ?? "36 hours",
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "check-coldlion-designflow-sync-health",
        target: mode.target,
        mode: mode.apply ? "apply" : "dry-run (no DB write)",
        force_fail: mode.forceFail,
        preview_project_ref: PREVIEW_PROJECT_REF,
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
  const result = parseHealthResult(stdout);
  const code = healthExitCode(result);
  if (code !== 0) {
    process.stderr.write(
      `Phase 6 health check FAILED (ok=${result?.ok ?? "unknown"}, issues=${JSON.stringify(result?.issues ?? [])})\n`,
    );
  } else {
    process.stdout.write("Phase 6 health check PASS\n");
  }
  return code;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`check-coldlion-designflow-sync-health failed: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
  }
}

export { main };
