// Unit tests for Phase 6 daily comparison runner (no network, no DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildComparisonSql,
  parseComparisonResult,
  comparisonExitCode,
  assertPreviewApplyTarget,
  PREVIEW_PROJECT_REF,
} from "./compare-coldlion-designflow-daily.mjs";
import {
  PRODUCTION_PROJECT_REF,
  EXPECTED_COLDLION_REFS,
  assertNoProductionEnv,
} from "./phase6-preview-guards.mjs";

test("buildComparisonSql calls public.record_taxonomy_parallel_observation and does not embed hash values", () => {
  const sql = buildComparisonSql({ forceFail: false });
  assert.match(sql, /public\.record_taxonomy_parallel_observation\(/);
  assert.match(sql, /null::date/);
  assert.doesNotMatch(sql, /licensor_uuid_hash\s*:/);
  assert.doesNotMatch(sql, /parent_edge_hash\s*:/);
  assert.match(sql, /max_success_age/);
});

test("buildComparisonSql force_fail option is JSON true", () => {
  const sql = buildComparisonSql({ forceFail: true });
  assert.match(sql, /"force_fail"\s*:\s*true/);
});

test("buildComparisonSql pins observation date when provided", () => {
  const sql = buildComparisonSql({ observationDate: "2026-07-26" });
  assert.match(sql, /\$obs_day\$2026-07-26\$obs_day\$::date/);
});

test("parseComparisonResult reads Supabase CLI JSON rows", () => {
  const payload = {
    pass: true,
    unexplained_diff_count: 0,
    coldlion_source_ref_count: EXPECTED_COLDLION_REFS,
  };
  const stdout = JSON.stringify({
    rows: [{ record_taxonomy_parallel_observation: payload }],
  });
  const result = parseComparisonResult(stdout);
  assert.equal(result.pass, true);
  assert.equal(result.coldlion_source_ref_count, 542);
});

test("parseComparisonResult reads bare array result", () => {
  const result = parseComparisonResult(JSON.stringify([{ pass: false, unexplained_diff_count: 2 }]));
  assert.equal(result.pass, false);
  assert.equal(result.unexplained_diff_count, 2);
});

test("comparisonExitCode is 0 only when pass===true; unparseable is fail-closed (2)", () => {
  assert.equal(comparisonExitCode({ pass: true }), 0);
  assert.equal(comparisonExitCode({ pass: false }), 1);
  assert.equal(comparisonExitCode(null), 2);
  assert.equal(comparisonExitCode({}), 2);
  assert.equal(comparisonExitCode({ not_pass: true }), 2);
});

test("parseComparisonResult fail-closed on garbage / opaque string rows", () => {
  assert.equal(parseComparisonResult(""), null);
  assert.equal(parseComparisonResult("not json at all"), null);
  assert.equal(
    parseComparisonResult(JSON.stringify({ rows: [{ record_taxonomy_parallel_observation: "not-json" }] })),
    null,
  );
});

test("assertPreviewApplyTarget refuses production project ref", () => {
  assert.throws(
    () =>
      assertPreviewApplyTarget({
        apply: true,
        linked: false,
        connString: `postgresql://postgres.${PRODUCTION_PROJECT_REF}:x@db.example.com:6543/postgres`,
      }),
    /production/,
  );
});

test("assertPreviewApplyTarget accepts preview DATABASE_URL", () => {
  assert.doesNotThrow(() =>
    assertPreviewApplyTarget({
      apply: true,
      linked: false,
      connString: `postgresql://postgres.${PREVIEW_PROJECT_REF}:x@aws-1-us-east-1.pooler.supabase.com:6543/postgres`,
    }),
  );
});

test("assertPreviewApplyTarget accepts linked preview project ref", () => {
  assert.doesNotThrow(() =>
    assertPreviewApplyTarget({
      apply: true,
      linked: true,
      connString: null,
      linkedProjectRef: PREVIEW_PROJECT_REF,
    }),
  );
});

test("assertNoProductionEnv throws when env embeds production ref", () => {
  assert.throws(
    () => assertNoProductionEnv({ DATABASE_URL: `postgres://${PRODUCTION_PROJECT_REF}` }),
    /production/,
  );
});
