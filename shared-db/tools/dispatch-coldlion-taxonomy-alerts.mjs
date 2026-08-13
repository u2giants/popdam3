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
// DEDUPLICATION (issue #551, added 2026-08-12)
// -------------------------------------------
// This dispatcher used to hand the workflow a title and a body and nothing else, and
// the workflow ran `gh issue create` UNCONDITIONALLY. There was no duplicate detection
// of any kind, so the same still-unacknowledged alert set produced a brand-new issue
// every 10 minutes. That is how issues #361-#394 happened: 46 issues, all the same
// alert, which buried every real issue in the tracker.
//
// The fix is a content-addressed dedupe key over the alert set, embedded as an HTML
// comment marker in the delivered issue body. Before delivering, the dispatcher reads
// the repository's OPEN issues and looks for that marker. Already reported -> do not
// create a second issue (but STILL fail the run red, because the alert is still
// outstanding). A new or changed alert set produces a different key and is always
// delivered.
//
// THE DEDUPE MUST NEVER SWALLOW AN ALERT. A dedupe that loses a genuine new alert is
// far worse than the duplicates it prevents, so the three outcomes are kept strictly
// apart and only ONE of them suppresses anything:
//   * "already reported"  -> proven by a marker match on an open issue -> suppress.
//   * "failed to check"   -> the lookup errored, returned junk, or could not be proven
//                            exhaustive -> DELIVER ANYWAY and shout. Never suppress on
//                            a failed check.
//   * "dedupe disabled"   -> deliver, and say so.
//
// Exit codes: 0 nothing outstanding,
//             1 undelivered alert(s) found, deliver a NEW issue (loud failure),
//             2 unparseable probe result (fail closed),
//             3 undelivered alert(s) found but ALREADY REPORTED on an open issue —
//               do not create a duplicate; the run still fails red,
//             4 undelivered alert(s) found and the dedupe check FAILED — deliver
//               anyway and report the dedupe failure loudly.

import { readLinkedProjectRefSync, repoRootFrom } from "./check-supabase-link-state.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

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

// ---------------------------------------------------------------------------------
// Dedupe configuration. Nothing here is hard-coded that an operator could reasonably
// need to change: every value has a documented environment variable, and every default
// is the safe one.
// ---------------------------------------------------------------------------------
export const DEDUPE_MARKER_PREFIX = "coldlion-alert-dedupe";
export const DEDUPE_ENABLED_VARIABLE = "COLDLION_ALERT_DEDUPE_ENABLED";
export const DEDUPE_LOOKUP_LIMIT_VARIABLE = "COLDLION_ALERT_DEDUPE_LOOKUP_LIMIT";
export const DEDUPE_REPO_VARIABLE = "COLDLION_ALERT_ISSUE_REPO";
export const DEDUPE_GH_BIN_VARIABLE = "COLDLION_ALERT_DEDUPE_GH_BIN";
// Keep enough headroom above the repository's normal open-issue count that the
// fail-closed truncation alarm is exceptional, not permanently noisy. Operators can
// still override this, and a full page is still treated as an unverified lookup.
export const DEDUPE_DEFAULT_LOOKUP_LIMIT = 500;

export const EXIT_ALL_CLEAR = 0;
export const EXIT_DELIVER_NEW = 1;
export const EXIT_UNPARSEABLE = 2;
export const EXIT_ALREADY_REPORTED = 3;
export const EXIT_DEDUPE_CHECK_FAILED = 4;

/**
 * Content-addressed identity of an alert SET. Pure.
 *
 * Keyed on the alert row ids (sorted, so ordering churn cannot fabricate a new key)
 * plus the drill flag (a drill and a real alert over the same rows are genuinely
 * different things and must never suppress each other). Deliberately NOT keyed on
 * age_minutes, checked_at or the breaker state — those change every single run, which
 * would give every run a fresh key and rebuild the exact flood this exists to stop.
 */
export function buildDedupeKey(alerts = []) {
  const ids = alerts
    .map((a) => String(a?.id ?? ""))
    .filter((id) => id.length > 0)
    .sort();
  const drill = alerts.some((a) => a?.is_drill === true) ? "drill" : "real";
  if (ids.length === 0) return null;
  return createHash("sha256").update(`${drill}\n${ids.join("\n")}`).digest("hex").slice(0, 32);
}

/** The marker embedded in a delivered issue body; how a later run recognises its own work. */
export function renderDedupeMarker(key) {
  return `<!-- ${DEDUPE_MARKER_PREFIX}: ${key} -->`;
}

/** Read a marker back out of an issue body. Returns the key, or null. */
export function parseDedupeMarker(body) {
  const m = new RegExp(`<!--\\s*${DEDUPE_MARKER_PREFIX}:\\s*([0-9a-f]{8,64})\\s*-->`).exec(
    String(body ?? ""),
  );
  return m ? m[1] : null;
}

function dedupeEnabled(env = {}) {
  // Default ON. Only the exact string "false" disables it, so a typo cannot silently
  // switch the protection off.
  return String(env[DEDUPE_ENABLED_VARIABLE] ?? "true") !== "false";
}

function dedupeLookupLimit(env = {}) {
  const raw = Number(env[DEDUPE_LOOKUP_LIMIT_VARIABLE] ?? DEDUPE_DEFAULT_LOOKUP_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEDUPE_DEFAULT_LOOKUP_LIMIT;
}

/**
 * Read the repository's OPEN issues so a marker match can be proven client-side.
 *
 * Deliberately NOT a label filter and NOT a GitHub search query:
 *   * the delivering workflow falls back to creating the issue WITHOUT the
 *     `coldlion-taxonomy-alert` label when that label does not exist, so a
 *     label-filtered lookup would miss exactly the issues it must find;
 *   * GitHub's `in:body` code/issue search is asynchronously indexed and routinely
 *     lags minutes behind issue creation — on a 10-minute cron that lag IS the flood.
 * Listing open issues and matching the marker locally has neither failure mode.
 *
 * Returns a result object; it never throws. `ok:false` means "failed to check", which
 * the caller must treat as DELIVER + shout, never as "already reported".
 */
export function lookupExistingAlertIssues({
  env = {},
  exec = execFileSync,
} = {}) {
  const repo = env[DEDUPE_REPO_VARIABLE] || env.GITHUB_REPOSITORY || null;
  if (!repo) {
    return {
      ok: false,
      issues: [],
      exhaustive: false,
      error: `cannot look up existing alert issues: neither ${DEDUPE_REPO_VARIABLE} nor GITHUB_REPOSITORY is set`,
    };
  }
  const limit = dedupeLookupLimit(env);
  const bin = env[DEDUPE_GH_BIN_VARIABLE] || "gh";
  let raw;
  try {
    raw = exec(
      bin,
      [
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--limit",
        String(limit),
        "--json",
        "number,title,body,author",
      ],
      { encoding: "utf8" },
    );
  } catch (err) {
    return {
      ok: false,
      issues: [],
      exhaustive: false,
      error: `\`${bin} issue list\` failed for ${repo}: ${err?.message ?? err}`,
    };
  }
  let issues;
  try {
    issues = JSON.parse(String(raw));
  } catch (err) {
    return {
      ok: false,
      issues: [],
      exhaustive: false,
      error: `\`${bin} issue list\` returned unparseable JSON for ${repo}: ${err?.message ?? err}`,
    };
  }
  if (!Array.isArray(issues)) {
    return {
      ok: false,
      issues: [],
      exhaustive: false,
      error: `\`${bin} issue list\` returned ${typeof issues}, not an array of issues`,
    };
  }
  // A full page means the listing was TRUNCATED: the match may be on the page we never
  // saw. That is "failed to check", not "no match" — reporting no-match here would
  // suppress nothing today but would silently mis-report tomorrow.
  return { ok: true, issues, exhaustive: issues.length < limit, limit, repo };
}

/**
 * Decide what to do with a delivery plan given a lookup result. Pure.
 *
 * @returns {{action: "create"|"suppress"|"deliver_unverified", matched_issue: number|null, reason: string, exit_code: number}}
 */
export function resolveDedupeDecision({ key, lookup, env = {} } = {}) {
  if (!dedupeEnabled(env)) {
    return {
      action: "deliver_unverified",
      matched_issue: null,
      exit_code: EXIT_DELIVER_NEW,
      reason: `dedupe is switched off via ${DEDUPE_ENABLED_VARIABLE}=false; delivering without a duplicate check`,
    };
  }
  if (!key) {
    return {
      action: "deliver_unverified",
      matched_issue: null,
      exit_code: EXIT_DEDUPE_CHECK_FAILED,
      reason:
        "no dedupe key could be built from the alert set (no usable alert ids); delivering anyway and reporting the dedupe failure",
    };
  }
  if (!lookup || lookup.ok !== true) {
    return {
      action: "deliver_unverified",
      matched_issue: null,
      exit_code: EXIT_DEDUPE_CHECK_FAILED,
      reason: `could not verify whether this alert was already reported (${lookup?.error ?? "no lookup result"}); delivering anyway rather than risking a swallowed alert`,
    };
  }
  // Only this workflow's durable issues may suppress a delivery. Handover/review issues
  // routinely quote workflow output verbatim; allowing any author to suppress on a
  // quoted marker would lose the real alert's durable surface.
  const match = (lookup.issues ?? []).find(
    (i) => i?.author?.login === "github-actions[bot]" && parseDedupeMarker(i?.body) === key,
  );
  if (match) {
    return {
      action: "suppress",
      matched_issue: match.number ?? null,
      exit_code: EXIT_ALREADY_REPORTED,
      reason: `this exact alert set is already reported on open issue #${match.number}; not creating a duplicate. The run still fails because the alert is still outstanding.`,
    };
  }
  if (lookup.exhaustive !== true) {
    return {
      action: "deliver_unverified",
      matched_issue: null,
      exit_code: EXIT_DEDUPE_CHECK_FAILED,
      reason: `the open-issue listing hit its limit of ${lookup.limit} rows, so "no duplicate found" is not proven; delivering anyway. Raise ${DEDUPE_LOOKUP_LIMIT_VARIABLE} or close stale issues.`,
    };
  }
  return {
    action: "create",
    matched_issue: null,
    exit_code: EXIT_DELIVER_NEW,
    reason: "no open issue carries this alert set's dedupe marker; delivering a new issue",
  };
}

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
  const dedupeKey = buildDedupeKey(alerts);

  return {
    parseable: true,
    deliver: alerts.length > 0,
    alerts,
    dedupe_key: dedupeKey,
    critical_count: critical.length,
    drill_count: alerts.filter((a) => a.is_drill === true).length,
    circuit_breaker_state: breakerState,
    human_response_owner: HUMAN_RESPONSE_OWNER,
    title: alerts.length
      ? `${alerts.some((a) => a.is_drill) ? "[DRILL] " : ""}ColdLion taxonomy alert — ${alerts.length} undelivered (breaker: ${breakerState})`
      : null,
    body: alerts.length ? renderIssueBody(probe, alerts, dedupeKey) : null,
    blocking_reason: null,
  };
}

function renderIssueBody(probe, alerts, dedupeKey = null) {
  const lines = [];
  // The marker goes FIRST and is never omitted: it is what stops the next run from
  // filing this same alert again. An issue delivered without it is invisible to the
  // dedupe and will be duplicated forever.
  if (dedupeKey) {
    lines.push(renderDedupeMarker(dedupeKey));
    lines.push("");
  }
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
  // #593: delegate to the shared reader. Same contract as the single-file read
  // it replaces -- the CLI-authoritative ref, or null when unlinked -- but a
  // `project-ref` / `linked-project.json` split is now REPORTED instead of
  // invisible, and `repoRootFrom` pins it to THIS checkout under the
  // agent-per-worktree model.
  return readLinkedProjectRefSync({ root: repoRootFrom(import.meta.url) });
}

export function main(argv = process.argv.slice(2), env = process.env, { exec = execFileSync } = {}) {
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
    return EXIT_UNPARSEABLE;
  }

  if (!plan.deliver) {
    if (outPath) writeFileSync(outPath, JSON.stringify(plan, null, 2), "utf8");
    process.stdout.write(`${JSON.stringify({ ...plan, body: undefined }, null, 2)}\n`);
    process.stdout.write("ALERT DISPATCH: no undelivered ColdLion taxonomy alerts\n");
    return EXIT_ALL_CLEAR;
  }

  // #551: an alert IS outstanding. Decide whether it has already been reported before
  // handing the workflow another `gh issue create`.
  const decision = resolveDedupeDecision({
    key: plan.dedupe_key,
    lookup: dedupeEnabled(env) ? lookupExistingAlertIssues({ env, exec }) : null,
    env,
  });
  const decided = {
    ...plan,
    dedupe_action: decision.action,
    dedupe_matched_issue: decision.matched_issue,
    dedupe_reason: decision.reason,
  };

  if (outPath) writeFileSync(outPath, JSON.stringify(decided, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify({ ...decided, body: undefined }, null, 2)}\n`);

  process.stderr.write(
    `ALERT DISPATCH: ${plan.alerts.length} undelivered alert(s); human response owner ${HUMAN_RESPONSE_OWNER}\n`,
  );

  if (decision.action === "suppress") {
    process.stderr.write(`ALERT DISPATCH DEDUPE: ${decision.reason}\n`);
    return EXIT_ALREADY_REPORTED;
  }
  if (decision.exit_code === EXIT_DEDUPE_CHECK_FAILED) {
    // "Failed to check" is NEVER allowed to look like "already reported". It delivers,
    // and it says loudly that the dedupe itself is broken.
    process.stderr.write(`ALERT DISPATCH DEDUPE CHECK FAILED: ${decision.reason}\n`);
    return EXIT_DEDUPE_CHECK_FAILED;
  }
  process.stderr.write(`ALERT DISPATCH DEDUPE: ${decision.reason}\n`);
  return EXIT_DELIVER_NEW;
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
