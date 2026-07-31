// Tests for the Step 7A item 5 production-lane readiness checks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_ENABLE_VARIABLE,
  REQUIRED_PRODUCTION_SECRET_NAMES,
  evaluateProductionLaneReadiness,
  promotionContractIsIntact,
} from "./coldlion-production-lane-readiness.mjs";
import { COLDLION_PRODUCTION_SCHEDULE_JOBS } from "./coldlion-production-schedule-map.mjs";
import { PROTECTED_FIELDS, SOURCE_OWNED_FIELDS } from "./coldlion-recurring-promotion.mjs";
import {
  collectProductionLaneInputs,
  evaluateReadiness,
} from "./evaluate-coldlion-licensor-property-cutover-readiness.mjs";

const realWorkflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/coldlion-licensor-property-production.yml", import.meta.url)),
  "utf8",
);
const realCrons = [...realWorkflow.matchAll(/- cron:\s*"([^"]+)"/g)].map((m) => m[1]);

const GOOD_OBJECTS = {
  promote_function: "plm.promote_coldlion_source_owned(jsonb,jsonb,boolean)",
  normalize_function: "plm.coldlion_normalize_name(text)",
  audit_table: "plm.coldlion_promotion_audit",
  quarantine_table: "plm.coldlion_promotion_quarantine",
};

function baseInput(over = {}) {
  return {
    workflowText: realWorkflow,
    registeredCrons: realCrons,
    scheduleMap: COLDLION_PRODUCTION_SCHEDULE_JOBS,
    enableVariable: null,
    approvalArtifacts: [],
    promotionContractOk: true,
    promotionObjects: GOOD_OBJECTS,
    ...over,
  };
}

const byName = (checks) => Object.fromEntries(checks.map((c) => [c.name, c]));

test("the real production workflow passes every production-lane check", () => {
  const checks = byName(evaluateProductionLaneReadiness(baseInput()));
  for (const [name, c] of Object.entries(checks)) {
    assert.equal(c.pass, true, `${name} should pass: ${c.blocking_reason}`);
  }
});

test("readiness FAILS when the production workflow does not exist", () => {
  const checks = byName(evaluateProductionLaneReadiness(baseInput({ workflowText: null })));
  assert.equal(checks.production_workflow_exists.pass, false);
  assert.match(checks.production_workflow_exists.blocking_reason, /one-time link run is not a recurring feed/);
});

test("readiness FAILS when the schedule map and the workflow disagree", () => {
  const checks = byName(
    evaluateProductionLaneReadiness(baseInput({ registeredCrons: ["0 6 * * *"] })),
  );
  assert.equal(checks.production_schedule_map_is_valid.pass, false);
});

test("readiness FAILS if lane selection could use wall-clock time", () => {
  const checks = byName(
    evaluateProductionLaneReadiness(
      baseInput({ workflowText: `${realWorkflow}\n          HOUR=$(date -u +%H)\n` }),
    ),
  );
  assert.equal(checks.production_schedule_map_is_valid.pass, false);
});

test("readiness FAILS when any required secret name is not wired", () => {
  for (const name of REQUIRED_PRODUCTION_SECRET_NAMES) {
    const stripped = realWorkflow.replaceAll(`secrets.${name}`, "secrets.SOMETHING_ELSE");
    const checks = byName(evaluateProductionLaneReadiness(baseInput({ workflowText: stripped })));
    assert.equal(
      checks.all_required_production_secret_names_are_wired.pass,
      false,
      `removing ${name} should block readiness`,
    );
    assert.match(checks.all_required_production_secret_names_are_wired.blocking_reason, new RegExp(name));
  }
});

test("readiness FAILS when a runner call is missing part of the four-part authorization", () => {
  const weakened = realWorkflow.replace("--production --production-authorized \\", "\\");
  const checks = byName(evaluateProductionLaneReadiness(baseInput({ workflowText: weakened })));
  assert.equal(checks.every_production_runner_call_has_four_part_authorization.pass, false);
});

test("readiness FAILS if the workflow could degrade silently", () => {
  const degraded = `${realWorkflow}\n        continue-on-error: true\n`;
  const checks = byName(evaluateProductionLaneReadiness(baseInput({ workflowText: degraded })));
  assert.equal(checks.disabled_lane_skips_loudly_without_fallback.pass, false);
});

test("the enable variable must be intentionally OFF while unapproved", () => {
  const off = byName(evaluateProductionLaneReadiness(baseInput({ enableVariable: null })));
  assert.equal(off.production_enable_variable_is_intentionally_off_before_approval.pass, true);

  const falseVal = byName(evaluateProductionLaneReadiness(baseInput({ enableVariable: "false" })));
  assert.equal(falseVal.production_enable_variable_is_intentionally_off_before_approval.pass, true);

  const onWithoutApproval = byName(evaluateProductionLaneReadiness(baseInput({ enableVariable: "true" })));
  assert.equal(onWithoutApproval.production_enable_variable_is_intentionally_off_before_approval.pass, false);
  assert.match(
    onWithoutApproval.production_enable_variable_is_intentionally_off_before_approval.blocking_reason,
    /requires Albert Hazan's explicit approval/,
  );
});

test("an enabled variable is acceptable ONLY once a durable Step 8 approval artifact exists", () => {
  // Without this conditional rule, readiness would go permanently red the moment Step 8
  // legitimately enables the lane — training whoever is on call to ignore a red gate.
  const approved = byName(
    evaluateProductionLaneReadiness(
      baseInput({
        enableVariable: "true",
        approvalArtifacts: ["coldlion-licensor-property-step8-approval-20260801"],
      }),
    ),
  );
  assert.equal(approved.production_enable_variable_is_intentionally_off_before_approval.pass, true);
});

test("readiness FAILS when the promotion contract is not intact", () => {
  const checks = byName(evaluateProductionLaneReadiness(baseInput({ promotionContractOk: false })));
  assert.equal(checks.recurring_promotion_contract_passes.pass, false);
});

test("readiness FAILS when a promotion object is missing from the database", () => {
  for (const key of Object.keys(GOOD_OBJECTS)) {
    const objects = { ...GOOD_OBJECTS, [key]: null };
    const checks = byName(evaluateProductionLaneReadiness(baseInput({ promotionObjects: objects })));
    assert.equal(
      checks.recurring_promotion_objects_exist_in_the_database.pass,
      false,
      `missing ${key} must block readiness`,
    );
  }
  const none = byName(evaluateProductionLaneReadiness(baseInput({ promotionObjects: null })));
  assert.equal(none.recurring_promotion_objects_exist_in_the_database.pass, false);
});

test("promotionContractIsIntact demands a disjoint split that protects status and parents", () => {
  assert.equal(
    promotionContractIsIntact({ sourceOwned: SOURCE_OWNED_FIELDS, protectedFields: PROTECTED_FIELDS }),
    true,
  );
  // Overlap is fatal.
  assert.equal(
    promotionContractIsIntact({
      sourceOwned: ["core.licensor.name", "core.licensor.status"],
      protectedFields: PROTECTED_FIELDS,
    }),
    false,
  );
  // The parent edge must be protected.
  assert.equal(
    promotionContractIsIntact({
      sourceOwned: SOURCE_OWNED_FIELDS,
      protectedFields: ["core.licensor.status", "core.property.status"],
    }),
    false,
  );
  assert.equal(promotionContractIsIntact({}), false);
});

test("collectProductionLaneInputs reads the real workflow and the enable variable", () => {
  const inputs = collectProductionLaneInputs({}, { promotion_objects: GOOD_OBJECTS });
  assert.ok(inputs.workflowText.includes("ColdLion Licensor/Property Recurring Feed (PRODUCTION)"));
  assert.deepEqual(inputs.registeredCrons, realCrons);
  assert.equal(inputs.promotionContractOk, true);
  assert.equal(inputs.enableVariable, null);
  assert.deepEqual(inputs.promotionObjects, GOOD_OBJECTS);

  const enabled = collectProductionLaneInputs({ [PRODUCTION_ENABLE_VARIABLE]: "true" }, null);
  assert.equal(enabled.enableVariable, "true");
  assert.equal(enabled.promotionObjects, null);
});

test("the production-lane checks are folded into the overall readiness verdict", () => {
  const authorization = { target: "preview", authorized: true, blocking_reason: null };
  const failing = evaluateProductionLaneReadiness(baseInput({ workflowText: null }));
  const report = evaluateReadiness({
    authorization,
    mappingContract: null,
    probe: null,
    productionLane: failing,
  });
  assert.equal(report.ready, false);
  assert.ok(report.blocked.includes("production_workflow_exists"));
  assert.ok(report.blocking_reasons.some((r) => r.startsWith("production_workflow_exists:")));
});
