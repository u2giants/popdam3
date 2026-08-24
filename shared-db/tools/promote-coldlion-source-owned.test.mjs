// Contract tests for the promotion runner's half of the Step 5.6 plan cross-check.
//
// tools/coldlion-recurring-promotion.test.mjs proves the PURE planner. This file proves the
// two things that sit between the planner and the database, and that a pure test cannot see:
//
//   1. splitCycleState actually feeds the planner the provenance rows. A perfect planner that
//      is handed an empty list plans nothing, sends an empty provenance_refreshes array, and
//      the database — which recomputes the same set from the same tables and finds rows —
//      fail-closes the cycle. The bug would look like "the guard is broken", not "the runner
//      forgot an input".
//   2. The SQL the runner sends actually selects the columns that set is derived from. Adding
//      a field to the JSON payload and forgetting the column is a silent null.
//
// Both halves of the cross-check are only worth anything if the two implementations are
// genuinely independent AND genuinely comparable. These are the seams where that breaks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCycleStateSql, planColdlionStatusChanges, splitCycleState } from "./promote-coldlion-source-owned.mjs";
import { planRecurringPromotion } from "./coldlion-recurring-promotion.mjs";

const MIGRATION = fileURLToPath(
  new URL(
    "../supabase/migrations/20260731190000_coldlion_promotion_crosscheck_provenance_coverage.sql",
    import.meta.url,
  ),
);

const LIC_UUID = "11111111-1111-4111-8111-111111111111";
const REF_UUID = "44444444-4444-4444-8444-444444444444";

function cycleRow(over = {}) {
  return {
    entityType: "licensor",
    company: "EDGEHOME",
    division: "CW001",
    mgTypeCode: "05",
    mgCode: "BM",
    name: "Batman",
    resolution_status: "manually_matched",
    present_this_cycle: true,
    canonical_id: LIC_UUID,
    canonical_name: "Batman",
    canonical_code: "BM",
    canonical_status: "active",
    canonical_licensor_id: null,
    source_ref_id: REF_UUID,
    source_ref_name: "Batman",
    source_ref_code: "BM",
    ...over,
  };
}

// =====================================================================================
// The cycle-state SQL must select what the plan is built from
// =====================================================================================

test("the cycle-state probe reads the provenance id, name AND code", () => {
  const sql = buildCycleStateSql();
  // Without source_code the runner cannot predict the source_code refresh at all, which is
  // the exact blind spot this cross-check was added to close.
  assert.match(sql, /'source_ref_code', r\.source_code/);
  assert.match(sql, /'source_ref_id', r\.id/);
  assert.match(sql, /'source_ref_name', r\.source_name/);
});

test("the cycle-state probe carries the typed ColdLion active flag", () => {
  const sql = buildCycleStateSql();
  assert.match(sql, /name as source_name, source_active, licensor_id/);
  assert.match(sql, /'source_active', m\.source_active/);
});

test("status plan supports both lifecycle directions and unchanged cycles", () => {
  const rows = [
    cycleRow({ source_active: false, canonical_status: "active" }),
    cycleRow({ entityType: "property", canonical_id: "22222222-2222-4222-8222-222222222222", source_active: true, canonical_status: "inactive" }),
    cycleRow({ mgCode: "UNCHANGED", canonical_id: "33333333-3333-4333-8333-333333333333", source_active: true, canonical_status: "active" }),
  ];
  const plan = planColdlionStatusChanges(rows);
  assert.deepEqual(plan.changes.map((x) => x.desired_status).sort(), ["active", "inactive"]);
  assert.equal(plan.unchanged.length, 1);
});

test("status plan abstains on conflicting duplicate divisions and higher authority", () => {
  const conflict = [
    cycleRow({ division: "CW001", source_active: true }),
    cycleRow({ division: "SP001", source_active: false }),
  ];
  assert.equal(planColdlionStatusChanges(conflict).quarantines[0].reason, "conflicting_or_missing_source_active");
  assert.equal(
    planColdlionStatusChanges([cycleRow({ source_active: false, higher_status_authority: true })]).quarantines[0].reason,
    "higher_status_authority",
  );
});

test("status plan ignores unresolved identities", () => {
  const plan = planColdlionStatusChanges([
    cycleRow({ source_active: false, resolution_status: "unresolved", canonical_id: null }),
  ]);
  assert.deepEqual(plan, { changes: [], unchanged: [], quarantines: [] });
});

test("present_this_cycle is coalesced to false, never left null", () => {
  // A null would reach JavaScript as `null`, which is neither `=== true` nor a usable false,
  // so the row would silently take no branch on either side of the comparison.
  assert.match(
    buildCycleStateSql(),
    /'present_this_cycle', coalesce\(m\.last_sync_run_id = \(select id from snapshot\), false\)/,
  );
});

// =====================================================================================
// splitCycleState — the provenance input has its own scope, not an intersection
// =====================================================================================

test("provenanceRows are the rows that are BOTH present and approved-linked", () => {
  const { provenanceRows } = splitCycleState({
    rows: [
      cycleRow(),
      cycleRow({ mgCode: "AB", present_this_cycle: false }),
      cycleRow({ mgCode: "CD", resolution_status: "unmatched" }),
    ],
  });
  assert.deepEqual(
    provenanceRows.map((r) => r.mgCode),
    ["BM"],
  );
});

test("a key present on one row and linked on ANOTHER is not a provenance row", () => {
  // This is why the set is derived here rather than by intersecting sourceRows and
  // linkedRows by key afterwards. The database scopes its write per mirror row, so an
  // intersection would claim a write the database never makes — and a cross-check that
  // over-predicts fail-closes a perfectly healthy cycle just as hard as one that
  // under-predicts lets a write through.
  const rows = [
    cycleRow({ present_this_cycle: true, resolution_status: "unmatched" }),
    cycleRow({ present_this_cycle: false, resolution_status: "manually_matched" }),
  ];
  const { sourceRows, linkedRows, provenanceRows } = splitCycleState({ rows });
  assert.equal(sourceRows.length, 1, "the key IS present this cycle");
  assert.equal(linkedRows.length, 1, "and the key IS approved-linked");
  assert.deepEqual(provenanceRows, [], "but not on the same row, so nothing is written");
});

test("splitCycleState carries the provenance columns through to the planner", () => {
  const { sourceRows, linkedRows, provenanceRows } = splitCycleState({
    rows: [cycleRow({ source_ref_code: "BM-OLD" })],
  });
  const plan = planRecurringPromotion({ sourceRows, linkedRows, provenanceRows });
  // End to end: a source_code drift in the database's cycle state becomes a cross-checkable
  // entry in the plan, with no curated-name promotion anywhere in sight.
  assert.equal(plan.promotions.length, 0);
  assert.deepEqual(plan.provenance_refreshes, [
    {
      key: "EDGEHOME/CW001/05/BM",
      entity_type: "licensor",
      fields: ["core.taxonomy_source_ref.source_code"],
    },
  ]);
});

test("a missing rows array is an empty cycle, not a crash", () => {
  for (const junk of [undefined, null, {}, { rows: null }, { rows: "nope" }]) {
    const split = splitCycleState(junk);
    assert.deepEqual(split.provenanceRows, []);
  }
});

// =====================================================================================
// The two implementations must stay comparable
// =====================================================================================

test("the migration cross-checks the provenance set and refuses a plan that omits it", () => {
  const sql = migrationBody();
  assert.match(sql, /v_server_prov_keys/, "the server must recompute the set independently");
  assert.match(
    sql,
    /if not \(p_client_plan \? 'provenance_refreshes'\)/,
    "an out-of-date runner must be refused, never accepted under the old narrower check",
  );
  assert.match(
    sql,
    /p_client_plan -> 'provenance_refreshes'/,
    "the runner's set must actually be read",
  );
});

/**
 * The migration's EXECUTABLE text — every `--` comment stripped. This file's job is to assert
 * what the migration DOES, and the migration is heavily commented (deliberately: it documents
 * a guard's blind spot). Matching raw text would let a sentence of prose satisfy an assertion
 * about SQL, which is a test that passes for the wrong reason.
 */
function migrationBody() {
  return (
    readFileSync(MIGRATION, "utf8")
      // NORMALISE LINE ENDINGS FIRST. Without this, these tests FAIL on any Windows
      // checkout and pass in CI, which is the worst possible split: a developer or agent
      // sees two red tests that main does not have, and the obvious conclusion ("main is
      // broken") is wrong. Measured 2026-08-07 on this exact file with git's autocrlf
      // checkout: comment stripping left the `--` comments in place, so the SQL body
      // still contained commentary, `grant` appeared inside a comment, and one term
      // matched 3 times instead of 2.
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n")
  );
}

test("the 5.6 assertion predicate is the 5.8 UPDATE predicate, term for term", () => {
  const sql = migrationBody();
  // If these two ever drift apart the guard silently stops covering what it claims to cover,
  // which is precisely the fault being corrected. Compare the distinguishing terms rather
  // than the whole statement, because 5.8 aliases the provenance table and 5.6 reads the
  // columns off the decision set.
  const terms = [
    /and p\.resolution_status = 'manually_matched'/g,
    /and p\.present_this_cycle/g,
    /and p\.quarantine_reason is distinct from 'wrong_type'/g,
  ];
  for (const term of terms) {
    const hits = sql.match(term) ?? [];
    assert.equal(hits.length, 2, `\`${term.source}\` must appear in BOTH 5.6 and 5.8`);
  }
  // Both halves of the OR — the name drift and the code drift — must be asserted, not just
  // the name half. The code half is one of the two paths that had no cross-check at all.
  assert.match(sql, /or coalesce\(p\.ref_source_code, ''\) <> p\.mg_code/);
  assert.match(sql, /or coalesce\(r\.source_code, ''\) <> p\.mg_code/);
});

test("the migration changes no signature, no grants and no tables", () => {
  const sql = migrationBody();
  // `create or replace` on the identical signature is what keeps the public.* wrapper and
  // every existing grant valid. A drop-and-recreate would silently revoke service_role.
  assert.match(sql, /create or replace function plm\.promote_coldlion_source_owned\(/);
  for (const forbidden of [
    /\bdrop\s+function\b/i,
    /\bcreate\s+table\b/i,
    /\balter\s+table\b/i,
    /\bgrant\b/i,
    /\brevoke\b/i,
    /\bcreate\s+policy\b/i,
  ]) {
    assert.equal(forbidden.test(sql), false, `migration must not contain ${forbidden.source}`);
  }
});

test("the migration does not enable the production lane", () => {
  // Step 8 approval owns that switch. The variable must not be created, set, or read here.
  const sql = readFileSync(MIGRATION, "utf8");
  const mentions = sql.match(/COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED/g) ?? [];
  assert.equal(mentions.length, 1, "mentioned once, in prose, saying it stays uncreated");
  assert.match(sql, /still not created/);
  assert.equal(/qsllyeztdwjgirsysgai/.test(sql), false, "no production project ref");
});
