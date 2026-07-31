#!/usr/bin/env node
// Operational runner for the GUARDED RECURRING PROMOTION of ColdLion source-owned
// Licensor/Property fields (accelerated plan Step 7A item 3).
//
// WHERE THIS SITS IN THE RECURRING CYCLE
//   1. `coldlion` lane — tools/sync-coldlion-licensors-properties.mjs refreshes the typed
//      mirror (mirror_only). It never touches core.*.
//   2. `promote` lane — THIS runner. It reads the refreshed mirror + the approved links,
//      computes a promotion plan, and asks the database to apply it.
//   3. `compare` / `health` lanes — unchanged.
//
// TWO INDEPENDENT COMPUTATIONS, AND DISAGREEMENT IS FATAL
// ------------------------------------------------------
// This runner computes the plan in JavaScript (tools/coldlion-recurring-promotion.mjs,
// pure and unit-tested row by row) and sends it to plm.promote_coldlion_source_owned,
// which recomputes the SAME decisions in SQL from the same tables and aborts if the two
// disagree. That is deliberate redundancy: the highest-risk failure in this whole workstream
// is not ColdLion being wrong, it is OUR mapping/promotion logic being wrong. One
// implementation cannot catch its own bug; two that must agree can.
//
// WHAT IT CAN AND CANNOT CHANGE
//   Can : core.taxonomy_source_ref.source_name / .source_code  (always, for valid links)
//         core.licensor.name / core.property.name              (only under the one approved
//                                                               normalized-equivalent rule)
//   Cannot: canonical UUIDs, core.property.licensor_id, lifecycle status, canonical codes,
//         creating a canonical row, deleting one, or inactivating one that ColdLion stopped
//         sending. ColdLion's API supplies neither the parent edge nor a lifecycle flag, so
//         it is not entitled to assert either.
//
// FAIL CLOSED, LOUDLY, AND DURABLY
// A protected-invariant failure raises inside the database transaction, so the cycle rolls
// back whole — the canonical layer is never left partially promoted. Because that rollback
// would also erase an in-transaction breaker trip, this runner then records a critical
// alert in a SEPARATE transaction (the established PR #107 durable-failure pattern); the
// existing coldlion_autotrip_on_critical_alert trigger trips the breaker from there, which
// blocks every subsequent promotion until an authorized reset.
//
// Usage:
//   node tools/promote-coldlion-source-owned.mjs                        # dry-run: print the plan + SQL
//   node tools/promote-coldlion-source-owned.mjs --apply --linked       # preview
//   node tools/promote-coldlion-source-owned.mjs --apply --linked \
//        --production --production-authorized --project-ref qsllyeztdwjgirsysgai
//
// Exit codes: 0 promoted (or clean no-op), 1 refused/failed, 2 unparseable result.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildFailedSyncRunSql, runSql, sqlDollarQuote } from "./coldlion-sync-common.mjs";
import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertNoProductionEnv,
  assertPreviewApplyTarget,
  resolveRunMode,
} from "./phase6-preview-guards.mjs";
import {
  assertColdlionApplyTarget,
  describeAuthorizedTarget,
  resolveProductionAuthorization,
} from "./coldlion-production-authorization.mjs";
import { parsePhase6FunctionResult } from "./phase6-cli-result-parse.mjs";
import {
  HUMAN_RESPONSE_OWNER,
  PROMOTION_MODE,
  PROMOTION_RULE_ID,
  planRecurringPromotion,
} from "./coldlion-recurring-promotion.mjs";
import {
  APPROVED_COUNT,
  APPROVED_DISTINCT,
  APPROVED_HASH,
} from "./run-coldlion-licensor-property-phase4.mjs";

export const SOURCE_NAME = "coldlion_licensors_properties_promote_source_owned";

export { PROMOTION_MODE, PROMOTION_RULE_ID, HUMAN_RESPONSE_OWNER };

// =====================================================================================
// Pure SQL builders (unit-testable without a database)
// =====================================================================================

/**
 * Read this cycle's mirror + approved-link state. `present_this_cycle` is derived from the
 * mirror row's last_sync_run_id matching the most recent SUCCESSFUL mirror_only run — not
 * from a timestamp window. A time window would call a delayed snapshot "missing" and a
 * stale one "present"; the run id cannot be wrong about which snapshot a row came from.
 */
export function buildCycleStateSql() {
  return `with snapshot as (
  select id from ingest.sync_run
  where source_name = 'coldlion_licensors_properties_api' and status = 'succeeded'
  order by started_at desc nulls last limit 1
),
mirror as (
  select 'licensor'::text as entity_type, company_code, division_code, mg_type_code, mg_code,
         name as source_name, licensor_id as canonical_id, resolution_status, last_sync_run_id
  from plm.erp_licensor
  union all
  select 'property'::text, company_code, division_code, mg_type_code, mg_code,
         name, property_id, resolution_status, last_sync_run_id
  from plm.erp_property
)
select jsonb_build_object(
  'ok', true,
  'snapshot_run_id', (select id from snapshot),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'entityType', m.entity_type,
      'company', m.company_code,
      'division', m.division_code,
      'mgTypeCode', m.mg_type_code,
      'mgCode', m.mg_code,
      'name', m.source_name,
      'resolution_status', m.resolution_status,
      'present_this_cycle', (m.last_sync_run_id = (select id from snapshot)),
      'canonical_id', m.canonical_id,
      'canonical_name', c.canonical_name,
      'canonical_code', c.canonical_code,
      'canonical_status', c.canonical_status,
      'canonical_licensor_id', c.canonical_licensor_id,
      'source_ref_name', r.source_name)
      order by m.entity_type, m.company_code, m.division_code, m.mg_type_code, m.mg_code)
    from mirror m
    left join lateral (
      select l.name as canonical_name, l.code as canonical_code,
             l.status::text as canonical_status, null::uuid as canonical_licensor_id
      from core.licensor l where m.entity_type = 'licensor' and l.id = m.canonical_id
      union all
      select p.name, p.code, p.status::text, p.licensor_id
      from core.property p where m.entity_type = 'property' and p.id = m.canonical_id
    ) c on true
    left join core.taxonomy_source_ref r
      on r.source_system = 'coldlion'
     and r.source_id = m.company_code || '/' || m.division_code || '/' || m.mg_type_code || '/' || m.mg_code
    where m.resolution_status = 'manually_matched'
       or m.last_sync_run_id = (select id from snapshot)
  ), '[]'::jsonb)
) as cycle;\n`;
}

export function buildPromoteSql(plan, { isDrill = false } = {}) {
  const expected = {
    hash: APPROVED_HASH,
    count: APPROVED_COUNT,
    distinct_canonical: APPROVED_DISTINCT,
  };
  return `select * from public.promote_coldlion_source_owned(
  ${sqlDollarQuote("cl_expected", expected)}::jsonb,
  ${sqlDollarQuote("cl_plan", plan)}::jsonb,
  ${isDrill ? "true" : "false"});\n`;
}

/**
 * Split the database's cycle state into the two inputs the pure planner takes.
 * `sourceRows` = what ColdLion sent this cycle. `linkedRows` = the approved links that
 * exist, whether or not ColdLion sent them — that is what makes an ABSENT record visible
 * as a review item instead of silently disappearing.
 */
export function splitCycleState(cycle) {
  const rows = Array.isArray(cycle?.rows) ? cycle.rows : [];
  const sourceRows = rows
    .filter((r) => r.present_this_cycle === true)
    .map((r) => ({
      company: r.company,
      division: r.division,
      mgTypeCode: r.mgTypeCode,
      mgCode: r.mgCode,
      entityType: r.entityType,
      name: r.name,
    }));
  const linkedRows = rows
    .filter((r) => r.resolution_status === "manually_matched")
    .map((r) => ({
      company: r.company,
      division: r.division,
      mgTypeCode: r.mgTypeCode,
      mgCode: r.mgCode,
      entityType: r.entityType,
      canonical_id: r.canonical_id,
      canonical_name: r.canonical_name,
      canonical_code: r.canonical_code,
      canonical_status: r.canonical_status,
      canonical_licensor_id: r.canonical_licensor_id,
      source_ref_name: r.source_ref_name,
    }));
  return { sourceRows, linkedRows };
}

/** The durable critical alert that survives the aborted promotion and trips the breaker. */
export function buildPromotionAlertSql(failedInvariant, detail) {
  // Named arguments on purpose: the function's positional order is
  // (severity, source_name, reason, ...) and a silent transposition of the first two would
  // record a well-formed alert with the wrong severity, which the breaker autotrip reads.
  return `select public.record_taxonomy_sync_alert(
  p_severity => 'critical',
  p_source_name => ${sqlDollarQuote("al_source", SOURCE_NAME)},
  p_reason => ${sqlDollarQuote("al_reason", `ColdLion recurring promotion refused: ${failedInvariant}`)},
  p_payload => ${sqlDollarQuote("al_payload", {
    failed_invariant: failedInvariant,
    detail: String(detail ?? "").slice(0, 3000),
    mode: PROMOTION_MODE,
    rule_id: PROMOTION_RULE_ID,
    human_response_owner: HUMAN_RESPONSE_OWNER,
    first_response:
      "Set COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED=false to stop the recurring lane, leave mirrors and evidence intact, compare the protected UUID/status/parent hashes, then reproduce and fix forward on preview via shared-db.",
  })}::jsonb);\n`;
}

function readLinkedProjectRef() {
  try {
    return readFileSync(new URL("../supabase/.temp/project-ref", import.meta.url), "utf8").trim();
  } catch {
    return null;
  }
}

// =====================================================================================
// Entry point
// =====================================================================================

export function main(argv = process.argv.slice(2), env = process.env) {
  const auth = resolveProductionAuthorization(argv, env);
  if (!auth.requested) assertNoProductionEnv(env);

  const mode = resolveRunMode(argv, env);
  const isDrill = argv.includes("--drill");
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

  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "promote-coldlion-source-owned",
        target: mode.target,
        authorized_target: describeAuthorizedTarget(argv, env),
        linked_project_ref: linkedProjectRef,
        mode: mode.apply ? "apply" : "dry-run (no DB write)",
        promotion_mode: PROMOTION_MODE,
        rule_id: PROMOTION_RULE_ID,
        is_drill: isDrill,
        approved_scope: {
          hash: APPROVED_HASH,
          count: APPROVED_COUNT,
          distinct_canonical: APPROVED_DISTINCT,
        },
        human_response_owner: HUMAN_RESPONSE_OWNER,
        preview_project_ref: PREVIEW_PROJECT_REF,
        production_project_ref: PRODUCTION_PROJECT_REF,
      },
      null,
      2,
    )}\n`,
  );

  if (!mode.apply) {
    process.stdout.write(buildCycleStateSql());
    process.stdout.write(
      "Dry-run complete. No database write performed. Re-run with --apply --linked to promote.\n",
    );
    return 0;
  }

  let stage = "read-cycle-state";
  try {
    const stateOut = runSql(buildCycleStateSql(), { linked: mode.linked });
    const cycle = parsePhase6FunctionResult(stateOut, { requiredKey: "ok" });
    if (!cycle) {
      process.stderr.write(
        "PROMOTION UNPARSEABLE: the cycle-state probe could not be parsed; failing closed with exit 2\n",
      );
      return 2;
    }
    if (!cycle.snapshot_run_id) {
      throw new Error(
        "no successful ColdLion mirror_only snapshot exists to promote; the recurring lane runs the snapshot first on purpose",
      );
    }

    stage = "plan";
    const { sourceRows, linkedRows } = splitCycleState(cycle);
    const plan = planRecurringPromotion({ sourceRows, linkedRows });

    process.stdout.write(
      `${JSON.stringify(
        {
          snapshot_run_id: cycle.snapshot_run_id,
          counts: plan.counts,
          quarantine_reasons: plan.quarantines.reduce((acc, q) => {
            acc[q.reason] = (acc[q.reason] ?? 0) + 1;
            return acc;
          }, {}),
          curated_name_changes: plan.promotions
            .filter((p) => p.curated_name_changed)
            .map((p) => ({ key: p.key, from: p.old_values, to: p.proposed_fields })),
        },
        null,
        2,
      )}\n`,
    );

    if (plan.refuse) {
      throw new Error(
        `protected-invariant violation in the computed plan: ${JSON.stringify(plan.protected_violations)}`,
      );
    }

    stage = "promote";
    const promoteOut = runSql(buildPromoteSql(plan, { isDrill }), { linked: mode.linked });
    process.stdout.write(promoteOut);

    if (/protected|ABORTED|refused/i.test(promoteOut) && !/"protected_violations": *0/.test(promoteOut)) {
      // The database prints its refusal; treat anything that is not an explicit zero-violation
      // result as a failure rather than reading success into ambiguous output.
      process.stderr.write("PROMOTION: the database result does not confirm zero protected violations\n");
      return 1;
    }

    process.stdout.write(
      `PROMOTION COMPLETE: ${plan.counts.curated_name_changes} curated name change(s), ` +
        `${plan.counts.quarantines} quarantined for review, protected invariants unchanged.\n`,
    );
    return 0;
  } catch (error) {
    // Durable, separate-transaction alert so the breaker trip survives the rollback.
    try {
      runSql(buildPromotionAlertSql(stage, error?.message ?? String(error)), { linked: mode.linked });
    } catch (alertErr) {
      process.stderr.write(
        `WARNING: could not record the durable promotion alert: ${alertErr?.message ?? alertErr}\n`,
      );
    }
    try {
      runSql(buildFailedSyncRunSql(SOURCE_NAME, stage, error?.message ?? String(error)), {
        linked: mode.linked,
      });
    } catch (recErr) {
      process.stderr.write(`WARNING: could not record durable failure: ${recErr?.message ?? recErr}\n`);
    }
    process.stderr.write(
      `ColdLion recurring promotion FAILED at stage ${stage}: ${error?.message ?? error}\n` +
        `Human response owner: ${HUMAN_RESPONSE_OWNER}\n`,
    );
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`promote-coldlion-source-owned failed: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
  }
}
