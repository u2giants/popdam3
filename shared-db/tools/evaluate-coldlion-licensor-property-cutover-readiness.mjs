#!/usr/bin/env node
// ONE deterministic readiness command for the accelerated ColdLion Licensor/Property
// cutover (accelerated plan Step 3).
//
// This is a THIN COMPOSER, not a second monitoring system. It reuses:
//   * the original frozen 542-row artifact plus the ten typed rows for the five exact
//     Paramount mappings owner-approved on #539, independently fingerprinted as 552 rows
//   * tools/phase6-preview-guards.mjs                  — preview/production target guards
//   * public.check_taxonomy_sync_health(...)           — the exact strict health
//     function that tools/check-coldlion-designflow-sync-health.mjs calls, invoked
//     here rather than reimplemented, so it appends the same evidence row
//   * plm.taxonomy_parallel_observation                — the append-only comparison
//     evidence written by tools/compare-coldlion-designflow-daily.mjs
//   * tools/phase6-cli-result-parse.mjs                — the fail-closed CLI parser
//     (Go-style map[...] box cells; exit 2 on anything unparseable)
//
// It adds exactly two genuinely new checks:
//   1. production execution requires the exact separate authorization AND project ref;
//   2. every approved typed source identity is re-resolved, row by row, to the exact
//      approved canonical UUID via plm.verify_coldlion_approved_mapping_identity.
//
// WHY ROW-BY-ROW: counts and hashes cannot see a swap, an entity-type flip, or a
// compensating missing/extra pair. `row_counts_without_identity_proof_never_pass`
// is an explicit, tested rule here — if the identity payload is absent, partial, or
// malformed, readiness is BLOCKED even when every count looks correct.
//
// Usage:
//   node tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs            # dry-run: print SQL
//   node tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs --apply --linked
//
// Exit codes: 0 ready, 1 not ready (blocking reasons printed), 2 unparseable result.

import { readLinkedProjectRefSync, repoRootFrom } from "./check-supabase-link-state.mjs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runSql, sqlDollarQuote } from "./coldlion-sync-common.mjs";
// Step 7A item 5: production readiness must additionally prove the RECURRING lane exists,
// is schedule-valid, is still intentionally disabled, has its secret names wired, keeps the
// breaker watchdog enforced, and passes the recurring promotion contract. Without these, a
// green readiness result would only be describing the one-time approved-link package.
import {
  COLDLION_PRODUCTION_SCHEDULE_JOBS,
  assertPreviewAndProductionMapsDisjoint,
} from "./coldlion-production-schedule-map.mjs";
import {
  PRODUCTION_ENABLE_VARIABLE,
  PRODUCTION_WORKFLOW_PATH,
  evaluateProductionLaneReadiness,
  promotionContractIsIntact,
} from "./coldlion-production-lane-readiness.mjs";
import {
  PROTECTED_FIELDS,
  SOURCE_OWNED_FIELDS,
} from "./coldlion-recurring-promotion.mjs";
import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertNoProductionEnv,
  assertPreviewApplyTarget,
  resolveRunMode,
} from "./phase6-preview-guards.mjs";
import { parsePhase6FunctionResult } from "./phase6-cli-result-parse.mjs";
import { assertColdlionApplyTarget } from "./coldlion-production-authorization.mjs";
import {
  APPROVED_COUNT,
  APPROVED_DISTINCT,
  APPROVED_HASH,
  loadWidenedApprovedMapping,
} from "./coldlion-paramount-five-approved-mapping.mjs";

export {
  APPROVED_COUNT,
  APPROVED_DISTINCT,
  APPROVED_HASH,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
};

export const PRODUCTION_AUTHORIZATION_VARIABLE =
  "COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED";
export const HUMAN_RESPONSE_OWNER = "Albert Hazan";

// =====================================================================================
// Target authorization (new check 1) — pure
// =====================================================================================

/**
 * Preview is the default and needs nothing extra. Production needs ALL THREE of:
 * the --production flag, the exact repository/environment authorization variable set
 * to "true", and --project-ref spelled exactly as the production ref. Any one of them
 * missing blocks. This is deliberately redundant: a single stray flag must never be
 * enough to point this command at production.
 */
export function resolveTargetAuthorization(argv = [], env = {}) {
  const args = new Set(argv);
  const wantsProduction = args.has("--production");
  const refIndex = argv.indexOf("--project-ref");
  const explicitRef = refIndex >= 0 ? argv[refIndex + 1] ?? null : null;

  if (!wantsProduction) {
    if (explicitRef && explicitRef !== PREVIEW_PROJECT_REF) {
      return {
        target: "preview",
        authorized: false,
        blocking_reason: `--project-ref ${explicitRef} is not the preview project ${PREVIEW_PROJECT_REF}`,
      };
    }
    return { target: "preview", authorized: true, blocking_reason: null };
  }

  const missing = [];
  if (env[PRODUCTION_AUTHORIZATION_VARIABLE] !== "true") {
    missing.push(`${PRODUCTION_AUTHORIZATION_VARIABLE}=true`);
  }
  if (explicitRef !== PRODUCTION_PROJECT_REF) {
    missing.push(`--project-ref ${PRODUCTION_PROJECT_REF}`);
  }
  if (!args.has("--production-authorized")) {
    missing.push("--production-authorized");
  }
  if (missing.length > 0) {
    return {
      target: "production",
      authorized: false,
      blocking_reason: `production execution requires the exact separate authorization: missing ${missing.join(", ")}`,
    };
  }
  return { target: "production", authorized: true, blocking_reason: null };
}

// =====================================================================================
// Readiness decision (new check 2 + composition of the existing tools) — pure
// =====================================================================================

function check(name, pass, detail, blockingReason = null) {
  return { name, pass: Boolean(pass), detail, blocking_reason: pass ? null : blockingReason };
}

const IDENTITY_DIFFERENCE_KEYS = [
  "missing",
  "extra",
  "cross_typed",
  "changed_uuid",
  "duplicate_input_key",
  "duplicate_source_ref",
  "link_mismatch",
  "canonical_missing",
];

/**
 * @param {{
 *   authorization: {target: string, authorized: boolean, blocking_reason: string|null},
 *   mappingContract: {hash: string, count: number, distinct_canonical: number}|null,
 *   probe: Record<string, unknown>|null,
 *   productionLane: Array|null,
 * }} inputs
 */
export function evaluateReadiness({ authorization, mappingContract, probe, productionLane = null }) {
  const checks = [];

  // Step 7A item 5: the recurring-production-lane checks. They are evaluated for BOTH
  // targets on purpose — a preview run should surface a broken or prematurely-enabled
  // production lane too, rather than discovering it during the production window.
  if (Array.isArray(productionLane)) checks.push(...productionLane);

  checks.push(
    check(
      "production_requires_exact_authorization",
      authorization?.authorized === true,
      { target: authorization?.target ?? "unknown" },
      authorization?.blocking_reason ?? "target authorization could not be resolved",
    ),
  );

  // --- frozen approved mapping contract (Phase 4 loader recomputes it from the file) ---
  const contractOk =
    mappingContract?.hash === APPROVED_HASH &&
    mappingContract?.count === APPROVED_COUNT &&
    mappingContract?.distinct_canonical === APPROVED_DISTINCT;
  checks.push(
    check("approved_mapping_contract_is_the_frozen_552_set", contractOk, mappingContract ?? null,
      `approved mapping contract is not the owner-approved widened set (${APPROVED_HASH}, ${APPROVED_COUNT}, ${APPROVED_DISTINCT})`),
  );

  // --- fail-closed: no probe at all ---
  if (!probe || typeof probe !== "object") {
    checks.push(
      check("database_probe_returned_parseable_result", false, null,
        "the readiness probe returned no parseable result; readiness is blocked (never inferred)"),
    );
    return finish(checks, authorization);
  }

  // --- NEW CHECK 2: row-by-row identity. Counts alone never pass. ---
  const identity = probe.identity;
  const diffCounts = identity && typeof identity === "object" ? identity.difference_counts : null;
  const identityStructureOk =
    identity &&
    typeof identity === "object" &&
    typeof identity.pass === "boolean" &&
    diffCounts &&
    typeof diffCounts === "object" &&
    IDENTITY_DIFFERENCE_KEYS.every((k) => Number.isFinite(Number(diffCounts[k])));

  if (!identityStructureOk) {
    checks.push(
      check("row_counts_without_identity_proof_never_pass", false, { identity: identity ?? null },
        "the per-row mapping-identity proof is missing or malformed; matching counts are NOT accepted as evidence"),
    );
  } else {
    const nonZero = IDENTITY_DIFFERENCE_KEYS.filter((k) => Number(diffCounts[k]) !== 0);
    const countsOk =
      Number(identity.approved_count) === APPROVED_COUNT &&
      Number(identity.approved_distinct_canonical) === APPROVED_DISTINCT &&
      identity.recomputed_mapping_hash === APPROVED_HASH &&
      identity.expected_contract_ok === true;

    checks.push(
      check(
        "all_552_typed_source_rows_resolve_to_approved_uuids",
        identity.pass === true && nonZero.length === 0 && countsOk,
        {
          approved_count: identity.approved_count,
          approved_distinct_canonical: identity.approved_distinct_canonical,
          recomputed_mapping_hash: identity.recomputed_mapping_hash,
          actual_coldlion_source_refs: identity.actual_coldlion_source_refs,
          difference_counts: diffCounts,
          differences: identity.differences ?? null,
        },
        nonZero.length > 0
          ? `mapping identity failed on: ${nonZero.map((k) => `${k}=${diffCounts[k]}`).join(", ")}`
          : (Array.isArray(identity.blocking_reasons) && identity.blocking_reasons.length > 0
              ? identity.blocking_reasons.join("; ")
              : "mapping identity proof did not pass"),
      ),
    );
  }

  // --- existing Phase 6 strict health tool (invoked, not reimplemented) ---
  const health = probe.health;
  const healthOk = health && typeof health === "object" && health.ok === true;
  checks.push(
    check("phase6_sync_health_is_green", healthOk, health ?? null,
      health && typeof health === "object"
        ? `health check reported ok=${health.ok} issues=${JSON.stringify(health.issues ?? [])}`
        : "health check returned no parseable result"),
  );

  // --- existing Phase 6 daily comparison evidence (latest non-drill observation) ---
  const obs = probe.latest_observation;
  const obsOk =
    obs &&
    typeof obs === "object" &&
    obs.pass === true &&
    Number(obs.unexplained_diff_count) === 0 &&
    obs.is_drill !== true;
  checks.push(
    check("latest_nondrill_comparison_passed_with_zero_unexplained_differences", obsOk, obs ?? null,
      obs && typeof obs === "object"
        ? `latest non-drill observation ${obs.id ?? "unknown"} pass=${obs.pass} unexplained_diff_count=${obs.unexplained_diff_count}`
        : "no non-drill comparison observation is available"),
  );

  // --- circuit breaker must be closed before any cutover ---
  const breaker = probe.circuit_breaker;
  const breakerOk = breaker && typeof breaker === "object" && breaker.state === "closed";
  checks.push(
    check("circuit_breaker_is_closed", breakerOk, breaker ?? null,
      breaker && typeof breaker === "object"
        ? `circuit breaker state is ${breaker.state}: ${breaker.tripped_reason ?? "no reason recorded"}`
        : "circuit breaker state is unknown"),
  );

  // --- the breaker must actually still be INSTALLED, not just "closed" ---
  // A dropped or disabled trigger removes protection with no error and no alarm,
  // and a "closed" breaker on an unguarded database looks identical to a safe one.
  const enforcement = probe.breaker_enforcement;
  const enforcementOk =
    enforcement &&
    typeof enforcement === "object" &&
    enforcement.all_enforced === true &&
    Number(enforcement.installed_count) === Number(enforcement.expected_count) &&
    Number(enforcement.enabled_count) === Number(enforcement.expected_count);
  checks.push(
    check("circuit_breaker_enforcement_is_installed_and_enabled", enforcementOk, enforcement ?? null,
      enforcement && typeof enforcement === "object"
        ? `breaker enforcement incomplete: ${enforcement.enabled_count}/${enforcement.expected_count} triggers enabled; missing or disabled: ${JSON.stringify(enforcement.missing_or_disabled ?? [])}`
        : "breaker enforcement status could not be read; refusing to assume the guards exist"),
  );

  // --- no unacknowledged non-drill critical alert may be outstanding ---
  const openAlerts = Number(probe.open_critical_alerts ?? NaN);
  const alertsOk = Number.isFinite(openAlerts) && openAlerts === 0;
  checks.push(
    check("no_unacknowledged_critical_alerts", alertsOk,
      { open_critical_alerts: probe.open_critical_alerts ?? null,
        open_alert_sample: probe.open_alert_sample ?? null },
      Number.isFinite(openAlerts)
        ? `${openAlerts} unacknowledged non-drill critical alert(s) are outstanding`
        : "the outstanding-alert count could not be read"),
  );

  return finish(checks, authorization);
}

function finish(checks, authorization) {
  const blocking = checks.filter((c) => !c.pass);
  return {
    tool: "evaluate-coldlion-licensor-property-cutover-readiness",
    target: authorization?.target ?? "unknown",
    human_response_owner: HUMAN_RESPONSE_OWNER,
    ready: blocking.length === 0,
    checks,
    passed: checks.filter((c) => c.pass).map((c) => c.name),
    blocked: blocking.map((c) => c.name),
    blocking_reasons: blocking.map((c) => `${c.name}: ${c.blocking_reason}`),
  };
}

// =====================================================================================
// SQL probe
// =====================================================================================

/**
 * ONE statement so `supabase db query` returns exactly one result cell. The health
 * function is volatile and appends a fresh health run — that is intentional
 * append-only evidence, identical to what the Phase 6 health lane records.
 */
export function buildReadinessProbeSql(input, expected, { maxSuccessAge = "36 hours" } = {}) {
  return `with health as (
  select public.check_taxonomy_sync_health(${sqlDollarQuote("rd_age", maxSuccessAge)}::interval, '{}'::jsonb) as result
)
select jsonb_build_object(
  'ok', true,
  'preview_project_ref', ${sqlDollarQuote("rd_prev", PREVIEW_PROJECT_REF)},
  'health', health.result,
  'identity', public.verify_coldlion_approved_mapping_identity(
    ${sqlDollarQuote("rd_input", input)}::jsonb,
    ${sqlDollarQuote("rd_expected", expected)}::jsonb,
    25),
  'circuit_breaker', public.taxonomy_circuit_breaker_state('coldlion_licensor_property'),
  'breaker_enforcement', public.taxonomy_breaker_enforcement_status(),
  -- Step 7A: verify the REAL OBJECTS of the recurring promotion lane, not the migration
  -- ledger. The ledger can record a migration whose object is absent (seen on preview
  -- 2026-07-23), so readiness asks the catalog directly.
  'promotion_objects', jsonb_build_object(
    'promote_function', to_regprocedure('plm.promote_coldlion_source_owned(jsonb,jsonb,boolean)')::text,
    'normalize_function', to_regprocedure('plm.coldlion_normalize_name(text)')::text,
    'audit_table', to_regclass('plm.coldlion_promotion_audit')::text,
    'quarantine_table', to_regclass('plm.coldlion_promotion_quarantine')::text),
  'latest_observation', (
    select to_jsonb(o) - 'details'
    from plm.taxonomy_parallel_observation o
    where o.is_drill = false
    order by o.observed_at desc
    limit 1),
  'open_critical_alerts', (
    select count(*) from plm.taxonomy_sync_alert a
    where a.acknowledged_at is null and a.is_drill = false and a.severity = 'critical'),
  'open_alert_sample', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', a.id, 'fired_at', a.fired_at, 'source_name', a.source_name,
             'reason', a.reason) order by a.fired_at desc), '[]'::jsonb)
    from (
      select * from plm.taxonomy_sync_alert
      where acknowledged_at is null and is_drill = false and severity = 'critical'
      order by fired_at desc limit 5) a)
) as readiness
from health;\n`;
}

// =====================================================================================
// Entry point
// =====================================================================================

function readLinkedProjectRef() {
  // #593: delegate to the shared reader. Same contract as the single-file read
  // it replaces -- the CLI-authoritative ref, or null when unlinked -- but a
  // `project-ref` / `linked-project.json` split is now REPORTED instead of
  // invisible, and `repoRootFrom` pins it to THIS checkout under the
  // agent-per-worktree model.
  return readLinkedProjectRefSync({ root: repoRootFrom(import.meta.url) });
}

/**
 * Gather everything the production-lane checks need from the filesystem and environment.
 * Kept separate from the pure evaluator so the checks stay unit-testable.
 */
export function collectProductionLaneInputs(env = process.env, probe = null) {
  let workflowText = null;
  let registeredCrons = [];
  try {
    workflowText = readFileSync(new URL(`../${PRODUCTION_WORKFLOW_PATH}`, import.meta.url), "utf8");
    registeredCrons = [...workflowText.matchAll(/- cron:\s*"([^"]+)"/g)].map((m) => m[1]);
  } catch {
    workflowText = null;
  }

  // A durable Step 8 approval artifact is what makes an ENABLED production variable
  // legitimate. With none present, the variable must still be off.
  let approvalArtifacts = [];
  try {
    const dir = new URL("../docs/verification/", import.meta.url);
    approvalArtifacts = readdirSync(dir)
      .filter((name) => /^coldlion-licensor-property-step8-approval-/.test(name))
      .filter((name) => existsSync(new URL(`${name}/approval.json`, dir)));
  } catch {
    approvalArtifacts = [];
  }

  let mapsDisjoint = false;
  try {
    mapsDisjoint = assertPreviewAndProductionMapsDisjoint();
  } catch {
    mapsDisjoint = false;
  }

  return {
    workflowText,
    registeredCrons,
    scheduleMap: COLDLION_PRODUCTION_SCHEDULE_JOBS,
    enableVariable: env[PRODUCTION_ENABLE_VARIABLE] ?? null,
    approvalArtifacts,
    promotionContractOk:
      mapsDisjoint &&
      promotionContractIsIntact({
        sourceOwned: SOURCE_OWNED_FIELDS,
        protectedFields: PROTECTED_FIELDS,
      }),
    promotionObjects: probe && typeof probe === "object" ? probe.promotion_objects ?? null : null,
  };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const authorization = resolveTargetAuthorization(argv, env);

  // Preview lanes keep the hard production-environment refusal from Phase 6.
  if (authorization.target !== "production") assertNoProductionEnv(env);

  const mode = resolveRunMode(argv, env);
  const linkedProjectRef = mode.linked ? readLinkedProjectRef() : null;

  // FIXED 2026-07-28 (Grok review): this previously skipped the target check
  // entirely when the target was production, so a production-flagged run could
  // evaluate — and report GREEN — against whatever project happened to be linked,
  // including preview. A false green at the END of a cutover window is worse than
  // a refusal at the start. Readiness now holds exactly the same bar as the write
  // runners, via the same shared module.
  assertColdlionApplyTarget({
    apply: mode.apply,
    linked: mode.linked,
    connString: mode.connString,
    linkedProjectRef,
    argv,
    env,
    assertPreviewApplyTarget,
  });

  const { input, expected } = loadWidenedApprovedMapping();
  const sql = buildReadinessProbeSql(input, expected, {
    maxSuccessAge: env.PHASE6_MAX_SUCCESS_AGE ?? "36 hours",
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "evaluate-coldlion-licensor-property-cutover-readiness",
        target_description: mode.target,
        target: authorization.target,
        authorized: authorization.authorized,
        linked_project_ref: linkedProjectRef,
        mode: mode.apply ? "apply (records an append-only health run)" : "dry-run (no DB write)",
        approved_mapping_contract: expected,
        human_response_owner: HUMAN_RESPONSE_OWNER,
      },
      null,
      2,
    )}\n`,
  );

  if (!mode.apply) {
    process.stdout.write(sql);
    process.stdout.write("Dry-run complete. Re-run with --apply --linked against preview to evaluate.\n");
    return 0;
  }

  if (!authorization.authorized) {
    process.stderr.write(`READINESS BLOCKED: ${authorization.blocking_reason}\n`);
    return 1;
  }

  const stdout = runSql(sql, { linked: mode.linked });
  process.stdout.write(stdout);

  const probe = parsePhase6FunctionResult(stdout, { requiredKey: "ok" });
  if (!probe) {
    process.stderr.write(
      "READINESS UNPARSEABLE: the probe result could not be parsed; failing closed with exit 2\n",
    );
    return 2;
  }

  const productionLane = evaluateProductionLaneReadiness(
    collectProductionLaneInputs(env, probe),
  );
  const report = evaluateReadiness({
    authorization,
    mappingContract: expected,
    probe,
    productionLane,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (report.ready) {
    process.stdout.write("READINESS: ready=true — every deterministic preview requirement passed\n");
    return 0;
  }
  process.stderr.write(
    `READINESS: ready=false — blocked by:\n${report.blocking_reasons.map((r) => `  - ${r}`).join("\n")}\n`,
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(
      `evaluate-coldlion-licensor-property-cutover-readiness failed: ${err?.stack ?? err}\n`,
    );
    process.exitCode = 1;
  }
}
