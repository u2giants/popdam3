// Unit tests for the pure SQL builders in sync-plm-master-data.mjs.
// Run with: node --test tools/sync-plm-master-data.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildImportSql,
  buildFailedSyncRunSql,
  countProperties,
  sqlDollarQuoteText,
  assertDesignflowApplyTarget,
  DESIGNFLOW_SOURCE_NAME,
  DESIGNFLOW_SOURCE_SYSTEM,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
} from "./sync-plm-master-data.mjs";

test("countProperties sums nested property arrays and tolerates missing", () => {
  const licensors = [
    { properties: [{}, {}] },
    { properties: [{}] },
    {}, // no properties key
    { properties: null },
  ];
  assert.equal(countProperties(licensors), 3);
});

test("buildImportSql calls plm.import_master_data with both jsonb payloads", () => {
  const sql = buildImportSql([{ id: 1 }], [{ id: 2 }]);
  assert.match(sql, /plm\.import_master_data\(/);
  assert.match(sql, /\$plm_licensors\$.*\$plm_licensors\$::jsonb/s);
  assert.match(sql, /\$plm_customers\$.*\$plm_customers\$::jsonb/s);
});

test("buildFailedSyncRunSql records a failed row with stage and message", () => {
  const sql = buildFailedSyncRunSql("fetch", "getLicensorsWithProperties returned HTTP 502");
  assert.match(sql, /insert into ingest\.sync_run/);
  assert.match(sql, /'failed'/);
  assert.match(sql, /'designflow_plm'/);
  assert.match(sql, /HTTP 502/);
  assert.match(sql, /'stage'/);
  assert.match(sql, /\$plm_stage\$fetch\$plm_stage\$/);
});

test("buildFailedSyncRunSql truncates very long error messages to 4000 chars", () => {
  const long = "x".repeat(10000);
  const sql = buildFailedSyncRunSql("apply", long);
  const body = sql.match(/\$plm_err\$([\s\S]*?)\$plm_err\$/);
  assert.ok(body, "error literal should be present");
  assert.equal(body[1].length, 4000);
});

test("buildFailedSyncRunSql tolerates null/undefined message", () => {
  const sql = buildFailedSyncRunSql("fetch", undefined);
  assert.match(sql, /\$plm_err\$\$plm_err\$/); // empty literal, no crash
});

test("sqlDollarQuoteText refuses text that would break out of its own quoting", () => {
  assert.throws(
    () => sqlDollarQuoteText("plm_err", "boom $plm_err$ escape"),
    /dollar quote tag/,
  );
});

test("DesignFlow source names match Phase 6 health/comparison contracts", () => {
  assert.equal(DESIGNFLOW_SOURCE_SYSTEM, "designflow_plm");
  assert.equal(DESIGNFLOW_SOURCE_NAME, "plm_master_data_api");
  const sql = buildFailedSyncRunSql("fetch", "x");
  assert.match(sql, /'designflow_plm'/);
  assert.match(sql, /'plm_master_data_api'/);
});

test("assertDesignflowApplyTarget with previewOnly refuses production", () => {
  assert.throws(
    () =>
      assertDesignflowApplyTarget({
        apply: true,
        linked: false,
        connString: `postgresql://postgres.${PRODUCTION_PROJECT_REF}:x@h/db`,
        previewOnly: true,
      }),
    /production|preview/,
  );
});

test("assertDesignflowApplyTarget with previewOnly accepts preview URL", () => {
  assert.doesNotThrow(() =>
    assertDesignflowApplyTarget({
      apply: true,
      linked: false,
      connString: `postgresql://postgres.${PREVIEW_PROJECT_REF}:x@aws-1-us-east-1.pooler.supabase.com:6543/postgres`,
      previewOnly: true,
    }),
  );
});

test("assertDesignflowApplyTarget without previewOnly is a no-op for apply target shape", () => {
  assert.doesNotThrow(() =>
    assertDesignflowApplyTarget({
      apply: true,
      linked: false,
      connString: "postgresql://anything",
      previewOnly: false,
    }),
  );
});
