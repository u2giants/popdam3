import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PHASE6_SCHEDULE_JOBS } from "./phase6-schedule-map.mjs";
import {
  COLDLION_PRODUCTION_SCHEDULE_JOBS,
  COLDLION_PRODUCTION_DISPATCH_JOBS,
  COLDLION_PRODUCTION_WRITE_JOBS,
  jobForProductionSchedule,
  assertProductionScheduleMapComplete,
  assertPreviewAndProductionMapsDisjoint,
} from "./coldlion-production-schedule-map.mjs";

const workflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/coldlion-licensor-property-production.yml", import.meta.url)),
  "utf8",
);

test("scheduled events map to the exact intended job", () => {
  assert.equal(jobForProductionSchedule("0 6 * * *"), "coldlion");
  assert.equal(jobForProductionSchedule("30 6 * * *"), "promote");
  assert.equal(jobForProductionSchedule("0 7 * * *"), "compare");
  assert.equal(jobForProductionSchedule("45 * * * *"), "health");
});

test("an unknown or empty cron refuses instead of guessing a lane", () => {
  assert.throws(() => jobForProductionSchedule("0 8 * * *"), /Unknown ColdLion PRODUCTION schedule/);
  assert.throws(() => jobForProductionSchedule(""), /Unknown ColdLion PRODUCTION schedule/);
  assert.throws(() => jobForProductionSchedule(null), /Unknown ColdLion PRODUCTION schedule/);
});

test("a PREVIEW cron string can never resolve a production job, and vice versa", () => {
  for (const previewCron of Object.keys(PHASE6_SCHEDULE_JOBS)) {
    assert.throws(
      () => jobForProductionSchedule(previewCron),
      /Unknown ColdLion PRODUCTION schedule/,
      `preview cron ${previewCron} must not resolve a production lane`,
    );
  }
  assert.equal(assertPreviewAndProductionMapsDisjoint(), true);
});

test("the retired production workflow preserves schedule evidence but its gate refuses every lane", () => {
  const registered = [...workflow.matchAll(/- cron:\s*"([^"]+)"/g)].map((m) => m[1]);
  assertProductionScheduleMapComplete(registered);
  assert.match(workflow, /Retired by shared-db issue #1090 Step 1\.0/);
  for (const [cron, job] of Object.entries(COLDLION_PRODUCTION_SCHEDULE_JOBS)) {
    const escaped = cron.replace(/\*/g, "\\*");
    assert.match(workflow, new RegExp(`"${escaped}"\\)\\s*JOB=${job}`), `missing historical case arm ${cron} -> ${job}`);
  }
});

test("lane selection never falls back to wall-clock time", () => {
  assert.match(workflow, /github\.event\.schedule/);
  assert.match(workflow, /case "\$SCHEDULE" in/);
  assert.doesNotMatch(workflow, /date -u \+%H/);
  assert.doesNotMatch(workflow, /date -u \+%M/);
  assert.doesNotMatch(workflow, /HOUR=\$\(/);
  assert.doesNotMatch(workflow, /MINUTE=\$\(/);
});

test("every dispatch job exists as a workflow choice option and a step", () => {
  for (const job of COLDLION_PRODUCTION_DISPATCH_JOBS) {
    assert.match(workflow, new RegExp(`^\\s+- ${job}$`, "m"), `missing dispatch option ${job}`);
    assert.match(workflow, new RegExp(`env\\.LANE == '${job}'`), `missing step for lane ${job}`);
  }
  assert.deepEqual(
    [...new Set(Object.values(COLDLION_PRODUCTION_SCHEDULE_JOBS))].sort(),
    ["coldlion", "compare", "health", "promote"],
  );
  // readiness is deliberately dispatch-only: it is an operator gate, not a cron job.
  assert.ok(COLDLION_PRODUCTION_DISPATCH_JOBS.includes("readiness"));
  assert.ok(!Object.values(COLDLION_PRODUCTION_SCHEDULE_JOBS).includes("readiness"));
});

test("the write lanes are the snapshot and the promotion", () => {
  assert.deepEqual([...COLDLION_PRODUCTION_WRITE_JOBS], ["coldlion", "promote"]);
});
