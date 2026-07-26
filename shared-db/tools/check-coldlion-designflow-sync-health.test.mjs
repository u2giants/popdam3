// Unit tests for Phase 6 health checker (no network, no DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildHealthSql,
  parseHealthResult,
  healthExitCode,
  assertPreviewApplyTarget,
  PREVIEW_PROJECT_REF,
} from "./check-coldlion-designflow-sync-health.mjs";
import { PRODUCTION_PROJECT_REF } from "./phase6-preview-guards.mjs";

test("buildHealthSql calls public.check_taxonomy_sync_health", () => {
  const sql = buildHealthSql({ forceFail: false });
  assert.match(sql, /public\.check_taxonomy_sync_health\(/);
  assert.match(sql, /::interval/);
  assert.match(sql, /"force_fail"\s*:\s*false/);
});

test("buildHealthSql force_fail is true for safe alert drill", () => {
  const sql = buildHealthSql({ forceFail: true });
  assert.match(sql, /"force_fail"\s*:\s*true/);
});

test("parseHealthResult reads nested function result", () => {
  const stdout = JSON.stringify({
    rows: [{ check_taxonomy_sync_health: { ok: true, issues: [] } }],
  });
  const result = parseHealthResult(stdout);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("healthExitCode is 0 only when ok===true; unparseable is fail-closed (2)", () => {
  assert.equal(healthExitCode({ ok: true }), 0);
  assert.equal(healthExitCode({ ok: false, issues: [{ kind: "stale_run" }] }), 1);
  assert.equal(healthExitCode(null), 2);
  assert.equal(healthExitCode({}), 2);
});

test("parseHealthResult fail-closed on garbage", () => {
  assert.equal(parseHealthResult(""), null);
  assert.equal(parseHealthResult("<<<not-json>>>"), null);
});

test("assertPreviewApplyTarget refuses production on health apply", () => {
  assert.throws(
    () =>
      assertPreviewApplyTarget({
        apply: true,
        linked: true,
        connString: null,
        linkedProjectRef: PRODUCTION_PROJECT_REF,
      }),
    /preview/,
  );
});

test("assertPreviewApplyTarget dry-run skips target check", () => {
  assert.doesNotThrow(() =>
    assertPreviewApplyTarget({
      apply: false,
      linked: false,
      connString: null,
    }),
  );
});

test("preview project constant is the rehearsal branch", () => {
  assert.equal(PREVIEW_PROJECT_REF, "rjyboqwcdzcocqgmsyel");
});
