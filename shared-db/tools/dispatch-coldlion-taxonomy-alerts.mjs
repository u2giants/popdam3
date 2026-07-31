#!/usr/bin/env node
// Durable alert DELIVERY for the ColdLion licensor/property lane.
//
// WHY THIS EXISTS
// ---------------
// The accelerated plan named "the existing Codex heartbeat task" as the primary
// alert path. A 2026-07-27 sweep of this repository found no such task: there is
// no scheduled monitor workflow, no cron definition, and no automation prompt
// anywhere in the repo that watches this workstream. The named path could not be
// proven because it does not exist here. Per plan Step 4 item 8, this is the
// smallest DURABLE channel that can meet the requirement instead:
//
//   preview DB alert row  ->  scheduled GitHub Actions monitor (every 10 minutes)
//                         ->  a GitHub Issue naming Albert Hazan as the human
//                             response owner, plus a RED failed workflow run
//
// Both surfaces are timestamped and permanent, so "it was delivered at HH:MM" is
// provable after the fact rather than asserted. 10-minute cadence keeps worst-case
// delivery inside the 15-minute target with margin for GitHub queue delay.
//
// Drills are delivered too (clearly labelled DRILL). An alert channel you cannot
// safely exercise is a channel nobody has actually tested.
//
// Usage:
//   node tools/dispatch-coldlion-taxonomy-alerts.mjs                        # dry-run SQL
//   node tools/dispatch-coldlion-taxonomy-alerts.mjs --apply --linked
//   node tools/dispatch-coldlion-taxonomy-alerts.mjs --apply --linked --out alerts.json
//
// Exit codes: 0 nothing outstanding, 1 undelivered alert(s) found (loud failure),
//             2 unparseable result (fail closed).

import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runSql, sqlDollarQuote } from "./coldlion-sync-common.mjs";
import {
  PREVIEW_PROJECT_REF,
  assertNoProductionEnv,
  assertPreviewApplyTarget,
  resolveRunMode,
} from "./phase6-preview-guards.mjs";
import { parsePhase6FunctionResult } from "./phase6-cli-result-parse.mjs";
// Added 2026-07-29 (accelerated plan Step 7A): the recurring PRODUCTION lane delivers
// its own alert from the detecting run, so the dispatcher must be reachable under the
// same four-part production authorization as every other ColdLion runner. Without any
// production flag its behaviour is unchanged and still preview-only.
import {
  assertColdlionApplyTarget,
  describeAuthorizedTarget,
  resolveProductionAuthorization,
} from "./coldlion-production-authorization.mjs";

export const HUMAN_RESPONSE_OWNER = "Albert Hazan";
export const ALERT_DELIVERY_TARGET_MINUTES = 15;

export function buildAlertQuerySql({ lookbackHours = 48 } = {}) {
  return `select jsonb_build_object(
  'ok', true,
  'preview_project_ref', ${sqlDollarQuote("al_prev", PREVIEW_PROJECT_REF)},
  'checked_at', timezone('utc', now()),
  'human_response_owner', ${sqlDollarQuote("al_owner", HUMAN_RESPONSE_OWNER)},
  'circuit_breaker', public.taxonomy_circuit_breaker_state('coldlion_licensor_property'),
  'alerts', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', a.id,
             'fired_at', a.fired_at,
             'age_minutes', round(extract(epoch from (now() - a.fired_at)) / 60.0, 2),
             'severity', a.severity,
             'source_name', a.source_name,
             'reason', a.reason,
             'is_drill', a.is_drill,
             'related_run_id', a.related_run_id,
             'observation_id', a.observation_id,
             'failed_invariant', a.payload->>'failed_invariant',
             'environment', a.payload->>'environment',
             'human_response_owner', coalesce(a.payload->>'human_response_owner', ${sqlDollarQuote("al_owner2", HUMAN_RESPONSE_OWNER)}),
             'first_response', a.payload->>'first_response')
             order by a.fired_at desc), '[]'::jsonb)
    from plm.taxonomy_sync_alert a
    where a.acknowledged_at is null
      and a.severity in ('critical', 'warning')
      and a.fired_at >= now() - ${sqlDollarQuote("al_look", `${lookbackHours} hours`)}::interval)
) as alert_dispatch;\n`;
}

/** Pure: turn the probe into a delivery decision + a ready-to-post issue body. */
export function buildDeliveryPlan(probe) {
  if (!probe || typeof probe !== "object" || !Array.isArray(probe.alerts)) {
    return {
      parseable: false,
      deliver: false,
      alerts: [],
      blocking_reason:
        "the alert probe returned no parseable result; failing closed rather than reporting all-clear",
    };
  }

  const alerts = probe.alerts;
  const critical = alerts.filter((a) => a.severity === "critical");
  const breakerState = probe.circuit_breaker?.state ?? "unknown";

  return {
    parseable: true,
    deliver: alerts.length > 0,
    alerts,
    critical_count: critical.length,
    drill_count: alerts.filter((a) => a.is_drill === true).length,
    circuit_breaker_state: breakerState,
    human_response_owner: HUMAN_RESPONSE_OWNER,
    title: alerts.length
      ? `${alerts.some((a) => a.is_drill) ? "[DRILL] " : ""}ColdLion taxonomy alert — ${alerts.length} undelivered (breaker: ${breakerState})`
      : null,
    body: alerts.length ? renderIssueBody(probe, alerts) : null,
    blocking_reason: null,
  };
}

function renderIssueBody(probe, alerts) {
  const lines = [];
  lines.push(`**Human response owner: ${HUMAN_RESPONSE_OWNER}.**`);
  lines.push("");
  lines.push(
    `Environment: preview \`${probe.preview_project_ref ?? PREVIEW_PROJECT_REF}\`. Production is not monitored by this workflow.`,
  );
  lines.push(`Circuit breaker: \`${probe.circuit_breaker?.state ?? "unknown"}\`.`);
  lines.push(`Checked at (UTC): ${probe.checked_at ?? "unknown"}.`);
  lines.push("");
  lines.push("| Alert | Fired (UTC) | Age (min) | Severity | Drill | Failed invariant | Reason |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const a of alerts) {
    lines.push(
      `| \`${a.id}\` | ${a.fired_at} | ${a.age_minutes} | ${a.severity} | ${a.is_drill ? "**yes**" : "no"} | ${a.failed_invariant ?? "—"} | ${String(a.reason ?? "").replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
  const firstResponse = alerts.find((a) => a.first_response)?.first_response;
  lines.push("### First response");
  lines.push("");
  lines.push(
    firstResponse ??
      "Disable the ColdLion schedule/promotion variable, leave mirrors and evidence intact, compare protected hashes, reproduce on preview, fix forward through shared-db.",
  );
  lines.push("");
  lines.push(
    "Close this issue only after acknowledging the alert rows in `plm.taxonomy_sync_alert`. Evidence is append-only: never delete the alert or the circuit-breaker events.",
  );
  return lines.join("\n");
}

function readLinkedProjectRef() {
  try {
    return readFileSync(new URL("../supabase/.temp/project-ref", import.meta.url), "utf8").trim();
  } catch {
    return null;
  }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const auth = resolveProductionAuthorization(argv, env);
  if (!auth.requested) assertNoProductionEnv(env);
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

  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? argv[outIndex + 1] ?? null : null;
  const sql = buildAlertQuerySql({ lookbackHours: Number(env.COLDLION_ALERT_LOOKBACK_HOURS ?? 48) });

  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "dispatch-coldlion-taxonomy-alerts",
        target: mode.target,
        authorized_target: describeAuthorizedTarget(argv, env),
        mode: mode.apply ? "apply (read-only query)" : "dry-run",
        preview_project_ref: PREVIEW_PROJECT_REF,
        human_response_owner: HUMAN_RESPONSE_OWNER,
        delivery_target_minutes: ALERT_DELIVERY_TARGET_MINUTES,
      },
      null,
      2,
    )}\n`,
  );

  if (!mode.apply) {
    process.stdout.write(sql);
    return 0;
  }

  const stdout = runSql(sql, { linked: mode.linked });
  const probe = parsePhase6FunctionResult(stdout, { requiredKey: "ok" });
  const plan = buildDeliveryPlan(probe);

  if (!plan.parseable) {
    process.stderr.write(`ALERT DISPATCH UNPARSEABLE: ${plan.blocking_reason}\n`);
    return 2;
  }

  if (outPath) writeFileSync(outPath, JSON.stringify(plan, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify({ ...plan, body: undefined }, null, 2)}\n`);

  if (!plan.deliver) {
    process.stdout.write("ALERT DISPATCH: no undelivered ColdLion taxonomy alerts\n");
    return 0;
  }

  process.stderr.write(
    `ALERT DISPATCH: ${plan.alerts.length} undelivered alert(s); human response owner ${HUMAN_RESPONSE_OWNER}\n`,
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`dispatch-coldlion-taxonomy-alerts failed: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
  }
}
