// Unit tests for the pure SQL builders in sync-plm-master-data.mjs.
// Run with: node --test tools/sync-plm-master-data.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildImportSql,
  buildFailedSyncRunSql,
  countProperties,
  sqlDollarQuoteText,
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
