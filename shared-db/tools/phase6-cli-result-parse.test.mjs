// Regression fixtures for Supabase CLI Go-style map cells (workflow 30203386465)
// and preserved JSON/envelope parsing. No network, no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseComparisonResult,
  parseHealthResult,
  comparisonExitCode,
  healthExitCode,
  extractGoMapText,
  parseGoMap,
} from "./phase6-cli-result-parse.mjs";

// ---------------------------------------------------------------------------
// Real-shape fixtures (Ubuntu `supabase db query` Unicode box + Go map cell).
// Key order intentionally scrambled vs any fixed schema order.
// ---------------------------------------------------------------------------

const GREEN_COMPARISON_BOX = `
Connecting to remote database...
┌──────────────────────────────────────────────────────────────────────────────┐
│ record_taxonomy_parallel_observation                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ map[unexplained_diff_count:0 pass:true observation_id:bf9e8daf-84d9-49a1-8958-39aa987adeb4 alert_id:<nil> baseline_ok:true coldlion_ok:true designflow_ok:true links_ok:true immutability_ok:true is_drill:false diffs:[] licensor_count:26 property_count:256 coldlion_source_ref_count:542 designflow_source_ref_count:505 linked_licensor_count:38 linked_property_count:504 taxonomy_source_ref_count:1047 comparison_run_id:62843601-1a94-4081-9fa0-e324d14a5f89 coldlion_run_id:f71705f5-4778-47b0-a8e8-bb6233060933 designflow_run_id:2fbc1653-e8ed-452f-8527-e1bf2761e25f observation_date:2026-07-26 licensor_uuid_hash:590ea83ea6df1487fcfc1e18b3ef6a0d property_uuid_hash:e0e6c36eb02bb2d320c0deaff7aa8f8c parent_edge_hash:7459f6826cc59468779e7ead33ec0edc] │
└──────────────────────────────────────────────────────────────────────────────┘
`.trim();

const FORCED_COMPARISON_BOX = `
Connecting to remote database...
┌──────────────────────────────────────────────────────────────────────────────┐
│ record_taxonomy_parallel_observation                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ map[pass:false is_drill:true unexplained_diff_count:1 alert_id:50ffcfc2-58f8-4e50-97ac-0a9866579a6f observation_id:f5f6129a-21ec-4c23-a3ff-cdad22993da4 comparison_run_id:c4c76bd5-b4a2-459b-9c5d-e99c5c80e05d baseline_ok:true diffs:[map[kind:forced_failure_drill note:Append-only drill evidence; does not overwrite non-drill daily rows; no canonical mutation]] coldlion_ok:true designflow_ok:true links_ok:true immutability_ok:true] │
└──────────────────────────────────────────────────────────────────────────────┘
`.trim();

const GREEN_HEALTH_BOX = `
Connecting to remote database...
┌──────────────────────────────────────────────────────────────────────────────┐
│ check_taxonomy_sync_health                                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ map[ok:true force_fail:false is_drill:false issues:[] alert_id:<nil> health_run_id:8d585094-1bac-4343-8b25-8465ce3dbb05 latest_nondrill_observation_id:bf9e8daf-84d9-49a1-8958-39aa987adeb4 coldlion_run_id:f71705f5-4778-47b0-a8e8-bb6233060933 designflow_run_id:2fbc1653-e8ed-452f-8527-e1bf2761e25f coldlion_source_ref_count:542 linked_licensor_count:38 linked_property_count:504] │
└──────────────────────────────────────────────────────────────────────────────┘
`.trim();

const FORCED_HEALTH_BOX = `
Connecting to remote database...
┌──────────────────────────────────────────────────────────────────────────────┐
│ check_taxonomy_sync_health                                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ map[linked_property_count:504 ok:false is_drill:true force_fail:true health_run_id:5af6aecd-bdf7-4a4a-9a42-1e8c446da441 alert_id:77521ad3-e0dd-4aea-8047-cd7c3338e018 issues:[map[kind:forced_failure_drill note:Distinct drill signal; does not rewrite non-drill observation evidence]] coldlion_source_ref_count:542 linked_licensor_count:38] │
└──────────────────────────────────────────────────────────────────────────────┘
`.trim();

test("green comparison Go-map box: pass true, observation_id, nil alert, empty diffs", () => {
  const r = parseComparisonResult(GREEN_COMPARISON_BOX);
  assert.ok(r);
  assert.equal(r.pass, true);
  assert.equal(r.observation_id, "bf9e8daf-84d9-49a1-8958-39aa987adeb4");
  assert.equal(r.alert_id, null);
  assert.equal(r.baseline_ok, true);
  assert.equal(r.unexplained_diff_count, 0);
  assert.deepEqual(r.diffs, []);
  assert.equal(r.coldlion_source_ref_count, 542);
  assert.equal(comparisonExitCode(r), 0);
});

test("forced comparison Go-map box: pass false, drill, nested diffs map, exit 1", () => {
  const r = parseComparisonResult(FORCED_COMPARISON_BOX);
  assert.ok(r);
  assert.equal(r.pass, false);
  assert.equal(r.is_drill, true);
  assert.equal(r.alert_id, "50ffcfc2-58f8-4e50-97ac-0a9866579a6f");
  assert.equal(r.unexplained_diff_count, 1);
  assert.ok(Array.isArray(r.diffs));
  assert.equal(r.diffs.length, 1);
  assert.equal(r.diffs[0].kind, "forced_failure_drill");
  assert.match(String(r.diffs[0].note), /Append-only drill evidence/);
  assert.equal(comparisonExitCode(r), 1);
});

test("green health Go-map box: ok true, empty issues, nil alert", () => {
  const r = parseHealthResult(GREEN_HEALTH_BOX);
  assert.ok(r);
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
  assert.equal(r.alert_id, null);
  assert.equal(r.health_run_id, "8d585094-1bac-4343-8b25-8465ce3dbb05");
  assert.equal(r.latest_nondrill_observation_id, "bf9e8daf-84d9-49a1-8958-39aa987adeb4");
  assert.equal(healthExitCode(r), 0);
});

test("forced health Go-map box: ok false, issues array with note spaces, exit 1", () => {
  const r = parseHealthResult(FORCED_HEALTH_BOX);
  assert.ok(r);
  assert.equal(r.ok, false);
  assert.equal(r.is_drill, true);
  assert.equal(r.force_fail, true);
  assert.equal(r.alert_id, "77521ad3-e0dd-4aea-8047-cd7c3338e018");
  assert.ok(Array.isArray(r.issues));
  assert.equal(r.issues[0].kind, "forced_failure_drill");
  assert.match(String(r.issues[0].note), /Distinct drill signal/);
  assert.equal(healthExitCode(r), 1);
});

test("key order independence: scrambled green comparison still parses", () => {
  const scrambled =
    "map[pass:true unexplained_diff_count:0 diffs:[] alert_id:<nil> observation_id:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee baseline_ok:true]";
  const r = parseComparisonResult(scrambled);
  assert.equal(r.pass, true);
  assert.equal(r.observation_id, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.equal(r.alert_id, null);
});

test("JSON envelope shapes still work (regression)", () => {
  const json = JSON.stringify({
    rows: [
      {
        record_taxonomy_parallel_observation: {
          pass: true,
          unexplained_diff_count: 0,
          observation_id: "11111111-1111-1111-1111-111111111111",
        },
      },
    ],
  });
  const r = parseComparisonResult(json);
  assert.equal(r.pass, true);
  assert.equal(comparisonExitCode(r), 0);

  const healthJson = JSON.stringify({
    rows: [{ check_taxonomy_sync_health: { ok: false, issues: [{ kind: "stale_run" }] } }],
  });
  const h = parseHealthResult(healthJson);
  assert.equal(h.ok, false);
  assert.equal(healthExitCode(h), 1);
});

test("fail-closed: garbage, missing discriminator, loose substring", () => {
  assert.equal(parseComparisonResult(""), null);
  assert.equal(parseComparisonResult("Connecting... done"), null);
  assert.equal(parseComparisonResult("map[baseline_ok:true unexplained_diff_count:0]"), null); // no pass
  assert.equal(parseComparisonResult('the word pass:true is not enough'), null);
  assert.equal(parseHealthResult("map[issues:[]]"), null); // no ok
  assert.equal(comparisonExitCode(null), 2);
  assert.equal(comparisonExitCode({}), 2);
  assert.equal(comparisonExitCode({ pass: "true" }), 2); // string not boolean
  assert.equal(healthExitCode(null), 2);
  assert.equal(healthExitCode({ ok: 1 }), 2);
});

test("fail-closed: malformed map returns null", () => {
  assert.equal(parseComparisonResult("map[pass:true"), null); // unclosed
  assert.equal(parseGoMap("map[pass:true"), null);
  assert.equal(extractGoMapText("no map here"), null);
});

test("fail-closed: duplicate pass key (later value must not shadow)", () => {
  // Later pass:false must not silently win over earlier pass:true.
  assert.equal(parseComparisonResult("map[pass:true unexplained_diff_count:0 pass:false]"), null);
  assert.equal(parseGoMap("map[pass:true pass:false]"), null);
  assert.equal(comparisonExitCode(parseComparisonResult("map[pass:true pass:false]")), 2);
});

test("fail-closed: duplicate ok key", () => {
  assert.equal(parseHealthResult("map[ok:true issues:[] ok:false]"), null);
  assert.equal(parseGoMap("map[ok:true ok:false]"), null);
  assert.equal(healthExitCode(parseHealthResult("map[ok:true ok:false]")), 2);
});

test("fail-closed: duplicate non-discriminator key", () => {
  assert.equal(
    parseComparisonResult(
      "map[pass:true unexplained_diff_count:0 unexplained_diff_count:1 observation_id:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee]",
    ),
    null,
  );
  assert.equal(parseGoMap("map[pass:true baseline_ok:true baseline_ok:false]"), null);
  assert.equal(parseHealthResult("map[ok:true coldlion_source_ref_count:542 coldlion_source_ref_count:0]"), null);
});

test("extractGoMapText finds map inside box noise", () => {
  const text = extractGoMapText(GREEN_COMPARISON_BOX);
  assert.ok(text?.startsWith("map["));
  assert.ok(text?.endsWith("]"));
  assert.match(text, /pass:true/);
});
