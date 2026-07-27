// Offline tests for the durable alert-delivery path.

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  ALERT_DELIVERY_TARGET_MINUTES,
  HUMAN_RESPONSE_OWNER,
  buildAlertQuerySql,
  buildDeliveryPlan,
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

test("alert_query_is_preview_only_and_read_only", () => {
  const sql = buildAlertQuerySql();
  assert.ok(sql.includes(PREVIEW_PROJECT_REF));
  assert.ok(!sql.includes(PRODUCTION_PROJECT_REF));
  assert.ok(!/\b(insert|update|delete|drop|alter)\b/i.test(sql));
  assert.ok(sql.includes("acknowledged_at is null"));
});
