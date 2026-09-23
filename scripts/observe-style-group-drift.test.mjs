import assert from "node:assert/strict";
import { test } from "node:test";
import { assessDriftRow, observe } from "./observe-style-group-drift.mjs";

const base = {
  observed_at: "2026-09-23T09:00:00Z", live_assets: 10, grouped_assets: 8,
  ungrouped_assets: 2, style_group_rows: 4, effective_tag_rows: 30,
  assets_missing_or_wrong_group: 0, assets_with_unexpected_group: 0,
  orphan_group_references: 0, effective_tag_sample_assets: 10,
  effective_tag_missing_rows: 0, effective_tag_extra_rows: 0,
  effective_tag_drifted_assets: 0, effective_tag_drift_rate: 0,
};
const url = "https://qsllyeztdwjgirsysgai.supabase.co";

test("one clean aggregate row is retained without asset identities", () => {
  const result = assessDriftRow([{ ...base, asset_id: "private" }]);
  assert.equal(result.failures.length, 0);
  assert.equal(result.asset_id, undefined);
});

test("every assignment direction triggers a failure", () => {
  for (const field of ["assets_missing_or_wrong_group", "assets_with_unexpected_group", "orphan_group_references"]) {
    assert.deepEqual(assessDriftRow([{ ...base, [field]: 1 }]).failures, [`${field}=1`]);
  }
});

test("missing or malformed aggregate fails closed", () => {
  for (const rows of [[], [{ ...base, live_assets: null }], [{ ...base, effective_tag_rows: null }],
    [{ ...base, live_assets: -1 }],
    [{ ...base, observed_at: "bad" }], [{ ...base }, { ...base }]]) {
    assert.throws(() => assessDriftRow(rows));
  }
});

test("production target is exact and the RPC uses POST with a bounded sample", async () => {
  let calls = 0;
  const fetchImpl = async (target, options) => {
    calls++;
    assert.equal(target, `${url}/rest/v1/rpc/reconcile_style_group_drift`);
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { p_effective_tag_sample: 5000 });
    assert.equal(options.headers.Authorization, "Bearer protected");
    return { ok: true, json: async () => [base] };
  };
  assert.equal((await observe({ url, key: "protected", fetchImpl })).ok, true);
  assert.equal(calls, 1);
  assert.equal((await observe({ url: "https://other.supabase.co", key: "protected", fetchImpl })).ok, false);
  assert.equal(calls, 1);
});

test("HTTP failure is visible without leaking response or credential", async () => {
  const report = await observe({ url, key: "protected", fetchImpl: async () => ({ ok: false, status: 403 }) });
  assert.equal(report.ok, false);
  assert.equal(report.measurement, null);
  assert.doesNotMatch(JSON.stringify(report), /protected/);
  assert.match(JSON.stringify(report), /HTTP 403/);
});
