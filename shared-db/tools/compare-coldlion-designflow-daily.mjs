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

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runSql, sqlDollarQuote } from "./coldlion-sync-common.mjs";
import {
  PREVIEW_PROJECT_REF,
  assertNoProductionEnv,
  assertPreviewApplyTarget,
  resolveRunMode,
} from "./phase6-preview-guards.mjs";

export {
  PREVIEW_PROJECT_REF,
  assertPreviewApplyTarget,
  resolveRunMode,
} from "./phase6-preview-guards.mjs";

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

/**
 * Parse comparison RPC result from supabase/psql stdout.
 *
 * GLM I3: fail-closed. No unverified CLI flag dependency is required.
 * Known shapes accepted when present:
 *   - JSON array of objects
 *   - Supabase CLI `{ rows: [ { fn_name: <object|string> } ] }` envelope
 *   - bare object with `pass`
 * Unparseable / empty output returns null → comparisonExitCode 2 (CI red).
 * We deliberately do not invent a second CLI output mode that is not already
 * exercised by this repo's Phase 2/4 runners.
 */
export function parseComparisonResult(stdout) {
  if (!stdout || !String(stdout).trim()) return null;
  const trimmed = String(stdout).trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed[0] ?? null;
    if (Array.isArray(parsed?.rows)) {
      const row = parsed.rows[0];
      if (row && typeof row === "object") {
        const first = Object.values(row)[0];
        if (typeof first === "object" && first !== null) return first;
        if (typeof first === "string") {
          try {
            return JSON.parse(first);
          } catch {
            return null; // fail-closed: do not treat opaque string as success
          }
        }
        return row;
      }
    }
    if (parsed && typeof parsed === "object" && "pass" in parsed) return parsed;
  } catch {
    // fall through — still fail-closed if no structured object found
  }
  // Last resort: locate a JSON object that includes pass (table-wrapped dumps).
  const match = trimmed.match(/\{[\s\S]*"pass"[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj && typeof obj === "object" && "pass" in obj) return obj;
    } catch {
      return null;
    }
  }
  return null;
}

/** 0 = pass, 1 = explicit fail, 2 = unparseable/missing result (fail-closed). */
export function comparisonExitCode(result) {
  if (!result || typeof result !== "object" || !("pass" in result)) return 2;
  return result.pass === true ? 0 : 1;
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

  const sql = buildComparisonSql({
    forceFail: mode.forceFail,
    maxSuccessAge: env.PHASE6_MAX_SUCCESS_AGE ?? "36 hours",
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "compare-coldlion-designflow-daily",
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
