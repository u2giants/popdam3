// Offline tests for the durable alert-delivery path.

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  ALERT_DELIVERY_TARGET_MINUTES,
  DEDUPE_DEFAULT_LOOKUP_LIMIT,
  DEDUPE_ENABLED_VARIABLE,
  DEDUPE_GH_BIN_VARIABLE,
  DEDUPE_LOOKUP_LIMIT_VARIABLE,
  DEDUPE_REPO_VARIABLE,
  EXIT_ALREADY_REPORTED,
  EXIT_DEDUPE_CHECK_FAILED,
  EXIT_DELIVER_NEW,
  HUMAN_RESPONSE_OWNER,
  buildAlertQuerySql,
  buildDedupeKey,
  buildDeliveryPlan,
  lookupExistingAlertIssues,
  parseDedupeMarker,
  renderDedupeMarker,
  resolveDedupeDecision,
} from "./dispatch-coldlion-taxonomy-alerts.mjs";
import { PRODUCTION_PROJECT_REF, PREVIEW_PROJECT_REF } from "./phase6-preview-guards.mjs";

function alert(overrides = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    fired_at: "2026-07-27T23:00:00Z",
    age_minutes: 3.5,
    severity: "critical",
    source_name: "coldlion_licensor_property_circuit_breaker",
    reason: "forced-failure drill: simulated protected-invariant failure",
    is_drill: false,
    failed_invariant: "mapping_identity",
    environment: "preview rjyboqwcdzcocqgmsyel",
    human_response_owner: HUMAN_RESPONSE_OWNER,
    first_response: "Disable the ColdLion schedule/promotion variable.",
    ...overrides,
  };
}

function probe(alerts, breakerState = "tripped") {
  return {
    ok: true,
    preview_project_ref: PREVIEW_PROJECT_REF,
    checked_at: "2026-07-27T23:03:00Z",
    circuit_breaker: { lane: "coldlion_licensor_property", state: breakerState },
    alerts,
  };
}

test("delivery_target_is_inside_fifteen_minutes", () => {
  assert.equal(ALERT_DELIVERY_TARGET_MINUTES, 15);
  // The monitor cron must be strictly faster than the target so queue delay has room.
  assert.ok(10 < ALERT_DELIVERY_TARGET_MINUTES);
});

test("an_open_alert_is_delivered_and_names_albert_hazan", () => {
  const plan = buildDeliveryPlan(probe([alert()]));
  assert.equal(plan.deliver, true);
  assert.equal(plan.critical_count, 1);
  assert.equal(plan.human_response_owner, "Albert Hazan");
  assert.ok(plan.title.includes("ColdLion taxonomy alert"));
  assert.ok(plan.title.includes("tripped"));
  // The response owner must be in the delivered BODY, not only in tool metadata —
  // the body is what a human actually reads.
  assert.ok(plan.body.includes("Human response owner: Albert Hazan"));
  assert.ok(plan.body.includes("First response"));
  assert.ok(plan.body.includes("mapping_identity"));
  assert.ok(plan.body.includes(PREVIEW_PROJECT_REF));
  assert.ok(!plan.body.includes(PRODUCTION_PROJECT_REF));
});

test("a_drill_alert_is_delivered_but_clearly_labelled", () => {
  const plan = buildDeliveryPlan(probe([alert({ is_drill: true })]));
  assert.equal(plan.deliver, true);
  assert.equal(plan.drill_count, 1);
  assert.ok(plan.title.startsWith("[DRILL]"));
  assert.ok(plan.body.includes("**yes**"));
});

test("no_open_alert_delivers_nothing", () => {
  const plan = buildDeliveryPlan(probe([], "closed"));
  assert.equal(plan.deliver, false);
  assert.equal(plan.title, null);
  assert.equal(plan.body, null);
  assert.equal(plan.blocking_reason, null);
});

test("unparseable_probe_fails_closed_and_never_reports_all_clear", () => {
  for (const bad of [null, undefined, "map[ok:true", {}, { ok: true }, { ok: true, alerts: "none" }]) {
    const plan = buildDeliveryPlan(bad);
    assert.equal(plan.parseable, false, `${JSON.stringify(bad)} must not parse`);
    assert.equal(plan.deliver, false);
    assert.ok(plan.blocking_reason.includes("failing closed"));
  }
});

// ---------------------------------------------------------------------------------
// #551 DEDUPLICATION. The monitor used to file a new issue every 10 minutes for the
// same unacknowledged alert set (#361-#394). These tests pin BOTH halves: it must stop
// the duplicates, and it must never quietly swallow a genuine alert.
// ---------------------------------------------------------------------------------

const openIssue = (number, key, login = "github-actions[bot]") => ({
  number,
  title: "ColdLion taxonomy alert",
  body: key ? `${renderDedupeMarker(key)}\n\nbody text` : "body text with no marker",
  author: { login },
});
const okLookup = (issues, limit = DEDUPE_DEFAULT_LOOKUP_LIMIT) => ({
  ok: true,
  issues,
  exhaustive: issues.length < limit,
  limit,
});

test("dedupe_key_is_stable_across_runs_and_ignores_per_run_noise", () => {
  const a = alert({ id: "aaa" });
  const b = alert({ id: "bbb" });
  const first = buildDeliveryPlan(probe([a, b]));
  // Same alert rows, different age/checked_at/breaker state — i.e. the next run 10
  // minutes later. If this key changed, the flood would come straight back.
  const later = buildDeliveryPlan(
    probe(
      [
        { ...b, age_minutes: 999 },
        { ...a, age_minutes: 1000 },
      ],
      "closed",
    ),
  );
  assert.equal(typeof first.dedupe_key, "string");
  assert.equal(first.dedupe_key, later.dedupe_key);
});

test("a_new_alert_row_produces_a_different_key_and_is_never_suppressed", () => {
  const one = buildDeliveryPlan(probe([alert({ id: "aaa" })])).dedupe_key;
  const two = buildDeliveryPlan(probe([alert({ id: "aaa" }), alert({ id: "bbb" })])).dedupe_key;
  assert.notEqual(one, two);
  // A drill over the same rows is a different thing and must not suppress the real one.
  const real = buildDeliveryPlan(probe([alert({ id: "aaa" })])).dedupe_key;
  const drill = buildDeliveryPlan(probe([alert({ id: "aaa", is_drill: true })])).dedupe_key;
  assert.notEqual(real, drill);
});

test("no_alerts_means_no_key_and_nothing_to_dedupe", () => {
  assert.equal(buildDedupeKey([]), null);
  assert.equal(buildDeliveryPlan(probe([])).dedupe_key, null);
});

test("the_delivered_body_carries_the_marker_the_next_run_reads", () => {
  const plan = buildDeliveryPlan(probe([alert()]));
  assert.ok(plan.body.includes(renderDedupeMarker(plan.dedupe_key)));
  assert.equal(parseDedupeMarker(plan.body), plan.dedupe_key);
  // A body with no marker must not accidentally match anything.
  assert.equal(parseDedupeMarker("nothing here"), null);
  assert.equal(parseDedupeMarker(null), null);
});

test("an_already_reported_alert_suppresses_the_duplicate_but_still_fails_red", () => {
  const key = buildDeliveryPlan(probe([alert()])).dedupe_key;
  const d = resolveDedupeDecision({
    key,
    lookup: okLookup([openIssue(11, "deadbeef"), openIssue(42, key)]),
  });
  assert.equal(d.action, "suppress");
  assert.equal(d.matched_issue, 42);
  assert.equal(d.exit_code, EXIT_ALREADY_REPORTED);
  assert.notEqual(d.exit_code, 0, "a suppressed duplicate must NEVER look like all-clear");
  assert.ok(d.reason.includes("#42"));
});

test("a_handover_quoting_the_marker_cannot_suppress_the_bot_alert", () => {
  const key = buildDeliveryPlan(probe([alert()])).dedupe_key;
  const d = resolveDedupeDecision({
    key,
    lookup: okLookup([openIssue(41, key, "u2giants")]),
  });
  assert.equal(d.action, "create");
  assert.equal(d.exit_code, EXIT_DELIVER_NEW);
});

test("an_unreported_alert_is_delivered", () => {
  const d = resolveDedupeDecision({ key: "abc123", lookup: okLookup([openIssue(11, "other")]) });
  assert.equal(d.action, "create");
  assert.equal(d.exit_code, EXIT_DELIVER_NEW);
});

test("a_failed_dedupe_check_DELIVERS_and_shouts_and_never_says_already_reported", () => {
  const failures = [
    undefined,
    null,
    { ok: false, error: "gh not found" },
    { ok: false, error: "unparseable JSON" },
  ];
  for (const lookup of failures) {
    const d = resolveDedupeDecision({ key: "abc123", lookup });
    assert.equal(d.action, "deliver_unverified", `must deliver for ${JSON.stringify(lookup)}`);
    assert.notEqual(d.action, "suppress");
    assert.equal(d.exit_code, EXIT_DEDUPE_CHECK_FAILED);
    assert.notEqual(d.exit_code, EXIT_DELIVER_NEW, "a broken dedupe must be distinguishable from a clean delivery");
    assert.ok(/could not verify|no dedupe key/.test(d.reason));
  }
});

test("a_TRUNCATED_listing_is_failed_to_check_not_no_duplicate_found", () => {
  // The page was full, so the match may be on a page we never saw. Reporting
  // "no duplicate" here would be a silent wrong answer.
  const d = resolveDedupeDecision({
    key: "abc123",
    lookup: { ok: true, issues: [openIssue(1, "x"), openIssue(2, "y")], exhaustive: false, limit: 2 },
  });
  assert.equal(d.action, "deliver_unverified");
  assert.equal(d.exit_code, EXIT_DEDUPE_CHECK_FAILED);
  assert.ok(d.reason.includes(DEDUPE_LOOKUP_LIMIT_VARIABLE));
});

test("a_missing_key_delivers_loudly_rather_than_suppressing", () => {
  const d = resolveDedupeDecision({ key: null, lookup: okLookup([]) });
  assert.equal(d.action, "deliver_unverified");
  assert.equal(d.exit_code, EXIT_DEDUPE_CHECK_FAILED);
});

test("dedupe_can_be_switched_off_explicitly_and_says_so", () => {
  const key = "abc123abc123";
  const off = resolveDedupeDecision({
    key,
    lookup: okLookup([openIssue(42, key)]),
    env: { [DEDUPE_ENABLED_VARIABLE]: "false" },
  });
  assert.equal(off.action, "deliver_unverified");
  assert.equal(off.exit_code, EXIT_DELIVER_NEW);
  assert.ok(off.reason.includes(DEDUPE_ENABLED_VARIABLE));
  // Only the exact string "false" disables it: a typo must not silently unprotect.
  for (const typo of ["False", "0", "no", "", undefined]) {
    const on = resolveDedupeDecision({
      key,
      lookup: okLookup([openIssue(42, key)]),
      env: typo === undefined ? {} : { [DEDUPE_ENABLED_VARIABLE]: typo },
    });
    assert.equal(on.action, "suppress", `${JSON.stringify(typo)} must not disable dedupe`);
  }
});

test("the_lookup_reaches_the_STATE_STORE_by_listing_open_issues_not_by_label_or_search", () => {
  const calls = [];
  const res = lookupExistingAlertIssues({
    env: { GITHUB_REPOSITORY: "u2giants/shared-db" },
    exec: (bin, args) => {
      calls.push({ bin, args });
      return JSON.stringify([openIssue(7, "key7")]);
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.issues.length, 1);
  assert.equal(res.exhaustive, true);
  assert.equal(calls[0].bin, "gh");
  const args = calls[0].args.join(" ");
  assert.ok(args.includes("--repo u2giants/shared-db"));
  assert.ok(args.includes("--state open"));
  assert.ok(args.includes(`--limit ${DEDUPE_DEFAULT_LOOKUP_LIMIT}`));
  assert.ok(args.includes("--json number,title,body,author"));
  // The delivering workflow may create the issue WITHOUT the label when the label does
  // not exist, so a label filter would miss exactly the issues this must find. And
  // GitHub's in:body search index lags minutes, which on a 10-minute cron is the flood.
  assert.ok(!args.includes("--label"), "must not filter by label");
  assert.ok(!args.includes("--search"), "must not depend on the lagging search index");
});

test("the_lookup_is_configurable_and_never_hard_codes_the_repo_or_the_binary", () => {
  const calls = [];
  lookupExistingAlertIssues({
    env: {
      [DEDUPE_REPO_VARIABLE]: "someone/else",
      GITHUB_REPOSITORY: "u2giants/shared-db",
      [DEDUPE_LOOKUP_LIMIT_VARIABLE]: "250",
      [DEDUPE_GH_BIN_VARIABLE]: "/usr/local/bin/gh",
    },
    exec: (bin, args) => {
      calls.push({ bin, args });
      return "[]";
    },
  });
  assert.equal(calls[0].bin, "/usr/local/bin/gh");
  assert.ok(calls[0].args.join(" ").includes("--repo someone/else"));
  assert.ok(calls[0].args.join(" ").includes("--limit 250"));
});

test("THE_STATE_STORE_IS_UNREACHABLE: every failure mode reports ok:false, never a false all-clear", () => {
  const unreachable = [
    {
      name: "gh binary missing / network down",
      exec: () => {
        throw new Error("spawn gh ENOENT");
      },
      env: { GITHUB_REPOSITORY: "u2giants/shared-db" },
    },
    {
      name: "gh printed something that is not JSON",
      exec: () => "gh: could not determine repository\n",
      env: { GITHUB_REPOSITORY: "u2giants/shared-db" },
    },
    {
      name: "gh printed JSON that is not a list of issues",
      exec: () => JSON.stringify({ message: "Not Found" }),
      env: { GITHUB_REPOSITORY: "u2giants/shared-db" },
    },
    {
      name: "no repository is configured at all",
      exec: () => {
        throw new Error("must not be called");
      },
      env: {},
    },
  ];
  for (const c of unreachable) {
    const res = lookupExistingAlertIssues({ env: c.env, exec: c.exec });
    assert.equal(res.ok, false, `${c.name} must report a failed check`);
    assert.equal(res.exhaustive, false);
    assert.ok(res.error && res.error.length > 0, `${c.name} must carry a reason`);
    // And that failed check must DELIVER, loudly — never suppress.
    const d = resolveDedupeDecision({ key: "abc123", lookup: res });
    assert.equal(d.action, "deliver_unverified", `${c.name} must still deliver the alert`);
    assert.equal(d.exit_code, EXIT_DEDUPE_CHECK_FAILED);
    assert.ok(d.reason.includes(res.error), `${c.name} must surface the underlying error`);
  }
});

test("the_four_delivery_outcomes_have_four_DISTINCT_exit_codes", () => {
  // The workflow branches on these. If any two collided, "already reported" and
  // "dedupe broken" would become indistinguishable in CI.
  const codes = new Set([0, EXIT_DELIVER_NEW, 2, EXIT_ALREADY_REPORTED, EXIT_DEDUPE_CHECK_FAILED]);
  assert.equal(codes.size, 5);
  assert.equal(EXIT_DELIVER_NEW, 1);
  assert.equal(EXIT_ALREADY_REPORTED, 3);
  assert.equal(EXIT_DEDUPE_CHECK_FAILED, 4);
});

test("alert_query_is_preview_only_and_read_only", () => {
  const sql = buildAlertQuerySql();
  assert.ok(sql.includes(PREVIEW_PROJECT_REF));
  assert.ok(!sql.includes(PRODUCTION_PROJECT_REF));
  assert.ok(!/\b(insert|update|delete|drop|alter)\b/i.test(sql));
  assert.ok(sql.includes("acknowledged_at is null"));
});
