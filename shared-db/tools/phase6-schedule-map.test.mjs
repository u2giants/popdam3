import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PHASE6_SCHEDULE_JOBS,
  jobForSchedule,
  assertScheduleMapComplete,
} from "./phase6-schedule-map.mjs";

const workflowPath = fileURLToPath(
  new URL("../.github/workflows/coldlion-licensor-property-phase6-parallel.yml", import.meta.url),
);
const workflow = readFileSync(workflowPath, "utf8");

test("jobForSchedule maps every registered cron exactly", () => {
  assert.equal(jobForSchedule("30 3 * * *"), "designflow");
  assert.equal(jobForSchedule("0 4 * * *"), "coldlion");
  assert.equal(jobForSchedule("0 5 * * *"), "compare");
  assert.equal(jobForSchedule("15 * * * *"), "health");
});

test("jobForSchedule refuses unknown or empty expressions (no wall-clock fallback)", () => {
  assert.throws(() => jobForSchedule("0 3 * * *"), /Unknown Phase 6 schedule/);
  assert.throws(() => jobForSchedule(""), /Unknown Phase 6 schedule/);
  assert.throws(() => jobForSchedule(null), /Unknown Phase 6 schedule/);
});

test("workflow dispatches via github.event.schedule exact match, not date/hour wall clock", () => {
  assert.match(workflow, /github\.event\.schedule/);
  assert.match(workflow, /case "\$SCHEDULE" in/);
  assert.doesNotMatch(workflow, /date -u \+%H/);
  assert.doesNotMatch(workflow, /date -u \+%M/);
  assert.doesNotMatch(workflow, /HOUR=\$\(/);
  assert.doesNotMatch(workflow, /MINUTE=\$\(/);
});

test("workflow case arms match PHASE6_SCHEDULE_JOBS keys and jobs", () => {
  for (const [cron, job] of Object.entries(PHASE6_SCHEDULE_JOBS)) {
    assert.match(
      workflow,
      new RegExp(`"${cron.replace(/\*/g, "\\*")}"\\)\\s*JOB=${job}`),
      `missing case arm for ${cron} -> ${job}`,
    );
    assert.match(workflow, new RegExp(`cron:\\s*"${cron.replace(/\*/g, "\\*")}"`));
  }
  assertScheduleMapComplete(Object.keys(PHASE6_SCHEDULE_JOBS));
});

test("offline unit-test step includes phase6 static suite (GLM I1)", () => {
  assert.match(workflow, /tools\/coldlion-licensor-property-phase6\.test\.mjs/);
  assert.match(workflow, /tools\/phase6-schedule-map\.test\.mjs/);
});
