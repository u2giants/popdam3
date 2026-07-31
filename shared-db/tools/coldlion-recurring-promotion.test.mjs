// Row-by-row contract tests for the guarded recurring promotion (Step 7A item 3).
//
// Every fault case the plan names has a test here, and each one asserts the SPECIFIC
// quarantine reason — not merely "something was rejected". A test that only checks
// "count of rejects > 0" would pass while the code quarantined the wrong row for the
// wrong reason, which is how a compensating pair of errors slips through.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ACCENT_FOLD_FROM,
  ACCENT_FOLD_TO,
  PROMOTION_RULE_ID,
  PROTECTED_FIELDS,
  SOURCE_OWNED_FIELDS,
  compareStableC,
  computeProvenanceRefreshes,
  decideNamePromotion,
  findProtectedFieldViolations,
  isNoOpCycle,
  normalizeName,
  planRecurringPromotion,
  rankFanInArms,
  typedKey,
} from "./coldlion-recurring-promotion.mjs";

const LIC_UUID = "11111111-1111-4111-8111-111111111111";
const PROP_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_UUID = "33333333-3333-4333-8333-333333333333";

function licensorSource(over = {}) {
  return { company: "EDGEHOME", division: "CW001", mgTypeCode: "05", mgCode: "BM", entityType: "licensor", name: "Batman", ...over };
}
function licensorLink(over = {}) {
  return {
    company: "EDGEHOME", division: "CW001", mgTypeCode: "05", mgCode: "BM", entityType: "licensor",
    canonical_id: LIC_UUID, canonical_name: "Batman", canonical_code: "BM",
    canonical_status: "active", canonical_licensor_id: null, source_ref_name: "Batman", ...over,
  };
}
function propertySource(over = {}) {
  return { company: "EDGEHOME", division: "CW001", mgTypeCode: "06", mgCode: "GOTHAM", entityType: "property", name: "Gotham", ...over };
}
function propertyLink(over = {}) {
  return {
    company: "EDGEHOME", division: "CW001", mgTypeCode: "06", mgCode: "GOTHAM", entityType: "property",
    canonical_id: PROP_UUID, canonical_name: "Gotham", canonical_code: "GOTHAM",
    canonical_status: "active", canonical_licensor_id: LIC_UUID, source_ref_name: "Gotham", ...over,
  };
}

const reasonsOf = (plan) => plan.quarantines.map((q) => q.reason).sort();

// =====================================================================================
// The typed key
// =====================================================================================

test("resolution uses the full typed key, never the code alone", () => {
  assert.equal(typedKey(licensorSource()), "EDGEHOME/CW001/05/BM");
  // The `FR` trap: the same code in a different division/type is a DIFFERENT key.
  assert.notEqual(
    typedKey({ company: "EDGEHOME", division: "CW001", mgTypeCode: "05", mgCode: "FR" }),
    typedKey({ company: "EDGEHOME", division: "SP001", mgTypeCode: "06", mgCode: "FR" }),
  );
});

test("a source row whose code matches but whose typed key does not is NOT promoted", () => {
  const plan = planRecurringPromotion({
    // Same mgCode BM, but division SP001 and type 06 — a different entity entirely.
    sourceRows: [licensorSource({ division: "SP001", mgTypeCode: "06", name: "Bruce Manor" })],
    linkedRows: [licensorLink()],
  });
  assert.equal(plan.promotions.length, 0);
  assert.ok(reasonsOf(plan).includes("new_source_record"));
  assert.ok(reasonsOf(plan).includes("missing_source_record"));
});

// =====================================================================================
// Cycle 1 then cycle 2 — idempotency
// =====================================================================================

test("cycle 1 applies the legitimate source-owned change and cycle 2 is idempotent", () => {
  // ColdLion recases the name: same name, different presentation.
  const source = [licensorSource({ name: "BATMAN" })];
  const cycle1 = planRecurringPromotion({ sourceRows: source, linkedRows: [licensorLink()] });

  assert.equal(cycle1.refuse, false);
  assert.equal(cycle1.promotions.length, 1);
  assert.equal(cycle1.counts.curated_name_changes, 1);
  assert.equal(cycle1.promotions[0].rule, PROMOTION_RULE_ID);
  assert.equal(cycle1.promotions[0].proposed_fields["core.licensor.name"], "BATMAN");
  assert.equal(cycle1.promotions[0].proposed_fields["core.taxonomy_source_ref.source_name"], "BATMAN");
  assert.equal(cycle1.promotions[0].old_values["core.licensor.name"], "Batman");
  assert.equal(cycle1.quarantines.length, 0);

  // Cycle 2 sees the state cycle 1 produced. Nothing further changes.
  const cycle2 = planRecurringPromotion({
    sourceRows: source,
    linkedRows: [licensorLink({ canonical_name: "BATMAN", source_ref_name: "BATMAN" })],
  });
  assert.equal(cycle2.promotions.length, 0);
  assert.equal(cycle2.unchanged.length, 1);
  assert.equal(cycle2.quarantines.length, 0);
  assert.equal(isNoOpCycle(cycle2), true);
  assert.equal(isNoOpCycle(cycle1), false);
});

test("an unchanged cycle promotes nothing at all", () => {
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource(), propertySource()],
    linkedRows: [licensorLink(), propertyLink()],
  });
  assert.equal(plan.promotions.length, 0);
  assert.equal(plan.unchanged.length, 2);
  assert.equal(plan.quarantines.length, 0);
  assert.equal(isNoOpCycle(plan), true);
});

// =====================================================================================
// The one approved deterministic name rule
// =====================================================================================

test("the approved rule applies presentation-only changes", () => {
  for (const [canonical, source] of [
    ["Batman", "BATMAN"],
    ["TOM AND JERRY", "Tom & Jerry"],
    ["Paw  Patrol", "Paw Patrol"],
    ["Pokemon", "Pokémon"],
    ["harry potter", "Harry Potter"],
  ]) {
    const d = decideNamePromotion(canonical, source);
    assert.equal(d.decision, "apply", `${canonical} -> ${source} should apply`);
    assert.equal(d.rule, PROMOTION_RULE_ID);
  }
});

test("the approved rule QUARANTINES a genuine rename instead of overwriting", () => {
  const d = decideNamePromotion("WARNER BROS", "WARNER BROS DISCOVERY");
  assert.equal(d.decision, "quarantine");
  assert.equal(d.reason, "source_name_divergence");
  // The FR class of bug: a re-pointed code arrives looking exactly like a rename.
  const fr = decideNamePromotion("FRIENDS TV", "FRUIT RANGE");
  assert.equal(fr.decision, "quarantine");
  assert.equal(fr.reason, "source_name_divergence");
});

test("a blank source name never overwrites a curated name", () => {
  for (const blank of ["", "   ", null, undefined]) {
    const d = decideNamePromotion("Batman", blank);
    assert.equal(d.decision, "quarantine");
    assert.equal(d.reason, "source_name_divergence");
  }
});

test("an identical name is 'unchanged', not a write", () => {
  assert.equal(decideNamePromotion("Batman", "Batman").decision, "unchanged");
});

test("normalizeName is only an equivalence test, never a matching key", () => {
  assert.equal(normalizeName("Tom & Jerry"), normalizeName("TOM AND JERRY"));
  assert.notEqual(normalizeName("Batman"), normalizeName("Batman Beyond"));
});

test("the accent-fold map is well formed and identical in the SQL migration", () => {
  // Equal length is what makes translate() and the JS map agree character for character.
  assert.equal([...ACCENT_FOLD_FROM].length, [...ACCENT_FOLD_TO].length);
  assert.equal([...ACCENT_FOLD_FROM].length, 245);
  assert.equal(new Set([...ACCENT_FOLD_FROM]).size, [...ACCENT_FOLD_FROM].length, "no duplicate source characters");

  // The migration must carry the SAME two literals. If either side is edited alone, the
  // promotion function's independent SQL recomputation would disagree with the runner's
  // plan and fail closed — a safe outcome, but a confusing one. Catch it here instead.
  const migration = readFileSync(
    fileURLToPath(new URL(
      "../supabase/migrations/20260729230000_coldlion_licensor_property_recurring_promotion.sql",
      import.meta.url,
    )),
    "utf8",
  );
  assert.ok(migration.includes(ACCENT_FOLD_FROM), "migration is missing the ACCENT_FOLD_FROM literal");
  assert.ok(migration.includes(ACCENT_FOLD_TO), "migration is missing the ACCENT_FOLD_TO literal");
});

test("a divergent name still records ColdLion's truth in the provenance layer", () => {
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource({ name: "TOTALLY DIFFERENT" })],
    linkedRows: [licensorLink()],
  });
  const q = plan.quarantines.find((x) => x.reason === "source_name_divergence");
  assert.ok(q);
  assert.equal(q.source_name, "TOTALLY DIFFERENT");
  assert.equal(q.canonical_name, "Batman");
  assert.equal(q.provenance_fields["core.taxonomy_source_ref.source_name"], "TOTALLY DIFFERENT");
  // ...but the curated name is untouched.
  assert.equal(plan.promotions.length, 0);
});

// =====================================================================================
// Protected invariants — refuse the WHOLE cycle, never partially promote
// =====================================================================================

test("UUID, parent and status mutations are refused, not quarantined", () => {
  for (const field of ["core.licensor.id", "core.property.licensor_id", "core.licensor.status", "core.property.status"]) {
    const violations = findProtectedFieldViolations([
      { ...licensorSource(), proposed_fields: { [field]: "anything" } },
    ]);
    assert.equal(violations.length, 1, `${field} must be a protected violation`);
    assert.equal(violations[0].field, field);
  }
});

test("the canonical code is protected: ColdLion cannot re-key a canonical row", () => {
  assert.ok(PROTECTED_FIELDS.includes("core.licensor.code"));
  assert.ok(PROTECTED_FIELDS.includes("core.property.code"));
  assert.equal(findProtectedFieldViolations([{ ...licensorSource(), proposed_fields: { "core.property.code": "NEW" } }]).length, 1);
});

test("an unknown field is treated as protected (allowlist, not denylist)", () => {
  const v = findProtectedFieldViolations([{ ...licensorSource(), proposed_fields: { "core.licensor.metadata": {} } }]);
  assert.equal(v.length, 1);
});

test("only the four source-owned fields are promotable", () => {
  assert.deepEqual([...SOURCE_OWNED_FIELDS], [
    "core.taxonomy_source_ref.source_name",
    "core.taxonomy_source_ref.source_code",
    "core.licensor.name",
    "core.property.name",
  ]);
  for (const f of SOURCE_OWNED_FIELDS) assert.ok(!PROTECTED_FIELDS.includes(f));
});

test("a plan containing a protected violation refuses the entire cycle", () => {
  const plan = planRecurringPromotion({ sourceRows: [licensorSource({ name: "BATMAN" })], linkedRows: [licensorLink()] });
  assert.equal(plan.refuse, false);
  // Inject a protected field the way a defective payload would.
  plan.promotions[0].proposed_fields["core.property.licensor_id"] = OTHER_UUID;
  const violations = findProtectedFieldViolations(plan.promotions);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].field, "core.property.licensor_id");
});

// =====================================================================================
// Quarantine cases, each asserting its exact reason
// =====================================================================================

test("a NEW ColdLion record quarantines and is never auto-created", () => {
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource(), licensorSource({ mgCode: "NEWCO", name: "Brand New Co" })],
    linkedRows: [licensorLink()],
  });
  const q = plan.quarantines.find((x) => x.key === "EDGEHOME/CW001/05/NEWCO");
  assert.equal(q.reason, "new_source_record");
  assert.equal(plan.promotions.length, 0);
});

test("a MISSING record quarantines and never inactivates or deletes", () => {
  const plan = planRecurringPromotion({ sourceRows: [], linkedRows: [licensorLink(), propertyLink()] });
  assert.deepEqual(reasonsOf(plan), ["missing_source_record", "missing_source_record"]);
  for (const q of plan.quarantines) {
    assert.match(q.detail, /absence never deletes, inactivates, or unlinks/);
  }
  assert.equal(plan.promotions.length, 0);
});

test("an AMBIGUOUS match quarantines", () => {
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource()],
    linkedRows: [licensorLink(), licensorLink({ canonical_id: OTHER_UUID })],
  });
  assert.deepEqual(reasonsOf(plan), ["ambiguous_match"]);
});

test("a duplicate typed key in one snapshot quarantines", () => {
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource(), licensorSource({ name: "Batman Two" })],
    linkedRows: [licensorLink()],
  });
  assert.ok(reasonsOf(plan).includes("ambiguous_match"));
  assert.equal(plan.promotions.length, 0);
});

test("a CROSS-TYPED row quarantines (a property can never promote onto a licensor)", () => {
  const plan = planRecurringPromotion({
    sourceRows: [{ ...licensorSource(), entityType: "property" }],
    linkedRows: [licensorLink()],
  });
  assert.deepEqual(reasonsOf(plan), ["cross_typed"]);
});

// REGRESSION GUARD for the worst defect found in this workstream.
// The first version of the collision rule quarantined ANY canonical row reachable from more
// than one typed key. Run against preview it quarantined 542 of 542 approved rows — the
// entire feed — because Albert's approved Phase 4 mapping deliberately points 542 source
// rows at 271 canonical rows (every canonical row is fed by both CW001 and SP001).
// Fan-in is the approved design. Do NOT "simplify" the rule back to key_count > 1.
test("approved fan-in with AGREEING names is NOT a collision", () => {
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource(), licensorSource({ division: "SP001" })],
    linkedRows: [licensorLink(), licensorLink({ division: "SP001" })],
  });
  assert.equal(plan.quarantines.length, 0, JSON.stringify(reasonsOf(plan)));
  assert.equal(plan.unchanged.length, 2);
  assert.equal(plan.refuse, false);
});

// =====================================================================================
// FIX 5 — the deterministic fan-in tie-break
// =====================================================================================
// Two approved arms of one canonical row whose raw names differ ONLY IN CASE normalize to
// the same value, so they are correctly NOT a collision — but both used to qualify to write
// the curated name, and the winner followed row order. Identical input could yield a
// different curated name from run to run, and flip back and forth across cycles.
// The winner must now be a stated property of the data: byte order on
// (normalized name, raw name, typed key). Do NOT replace compareStableC with `<` or
// localeCompare — a locale-aware comparison ranks the two spellings EQUAL and hands the
// choice straight back to row order, which is the bug.

// Two arms of ONE canonical licensor, differing only in the case of the source name.
// The curated name is a third presentation of the same name, so both arms are eligible.
function caseOnlyFanIn() {
  return {
    sourceRows: [
      licensorSource({ division: "CW001", name: "ACME Studios" }),
      licensorSource({ division: "SP001", name: "Acme Studios" }),
    ],
    linkedRows: [
      licensorLink({ division: "CW001", canonical_name: "acme studios", source_ref_name: "ACME Studios" }),
      licensorLink({ division: "SP001", canonical_name: "acme studios", source_ref_name: "Acme Studios" }),
    ],
  };
}

const curatedWinner = (plan) => {
  const writers = plan.promotions.filter((p) => p.curated_name_changed);
  return writers.length === 1 ? writers[0] : null;
};

test("case-only fan-in is not a collision, and EXACTLY ONE arm writes the curated name", () => {
  const plan = planRecurringPromotion(caseOnlyFanIn());

  assert.equal(plan.quarantines.length, 0, JSON.stringify(reasonsOf(plan)));
  assert.equal(plan.refuse, false);
  // The bug: both arms wrote core.licensor.name and the survivor depended on row order.
  assert.equal(plan.counts.curated_name_changes, 1);

  const winner = curatedWinner(plan);
  assert.ok(winner, "exactly one arm must carry the curated name change");
  // Byte order: "ACME Studios" < "Acme Studios" because 'C' (0x43) < 'c' (0x63).
  assert.equal(winner.key, "EDGEHOME/CW001/05/BM");
  assert.equal(winner.proposed_fields["core.licensor.name"], "ACME Studios");
  assert.equal(winner.curated_name_tiebreak.outcome, "won");
  assert.equal(winner.curated_name_tiebreak.arm_count, 2);
});

test("the losing fan-in arm is recorded, never silently dropped", () => {
  const plan = planRecurringPromotion(caseOnlyFanIn());
  const all = [...plan.promotions, ...plan.unchanged];
  const loser = all.find((p) => p.key === "EDGEHOME/SP001/05/BM");

  assert.ok(loser, "the losing arm must still appear in the plan");
  assert.equal(loser.curated_name_tiebreak.outcome, "lost");
  assert.equal(loser.curated_name_tiebreak.winner_key, "EDGEHOME/CW001/05/BM");
  assert.equal(loser.curated_name_tiebreak.winner_name, "ACME Studios");
  // And it never writes the curated name.
  assert.equal(loser.proposed_fields?.["core.licensor.name"], undefined);
});

test("a losing arm still refreshes its OWN provenance — ColdLion owns that unconditionally", () => {
  // Same fan-in, but SP001's provenance row is stale, so that arm has real work to do.
  const input = caseOnlyFanIn();
  input.linkedRows[1] = licensorLink({
    division: "SP001", canonical_name: "acme studios", source_ref_name: "something stale",
  });
  const plan = planRecurringPromotion(input);

  const loser = plan.promotions.find((p) => p.key === "EDGEHOME/SP001/05/BM");
  assert.ok(loser, "the losing arm keeps its provenance promotion");
  assert.equal(loser.curated_name_changed, false);
  assert.equal(loser.proposed_fields["core.taxonomy_source_ref.source_name"], "Acme Studios");
  assert.equal(loser.proposed_fields["core.licensor.name"], undefined);
  assert.equal(plan.counts.curated_name_changes, 1);
});

test("the winner is the SAME no matter what order the rows arrive in, every time", () => {
  const base = caseOnlyFanIn();
  const orderings = [
    base,
    { sourceRows: [...base.sourceRows].reverse(), linkedRows: base.linkedRows },
    { sourceRows: base.sourceRows, linkedRows: [...base.linkedRows].reverse() },
    { sourceRows: [...base.sourceRows].reverse(), linkedRows: [...base.linkedRows].reverse() },
  ];

  for (const input of orderings) {
    for (let repeat = 0; repeat < 5; repeat += 1) {
      const plan = planRecurringPromotion(input);
      const winner = curatedWinner(plan);
      assert.ok(winner, "one and only one curated-name writer, in every ordering");
      assert.equal(winner.proposed_fields["core.licensor.name"], "ACME Studios");
      assert.equal(winner.key, "EDGEHOME/CW001/05/BM");
      assert.equal(plan.counts.curated_name_changes, 1);
    }
  }
});

test("the winning spelling does not flip back on the next cycle", () => {
  // Cycle 1 settles the curated name on "ACME Studios". Cycle 2 sees exactly that state and
  // the same two source arms. It must be a clean no-op — a flip back to "Acme Studios" would
  // be churn with no upstream cause, which is what made this a bug rather than a preference.
  const cycle2 = planRecurringPromotion({
    sourceRows: caseOnlyFanIn().sourceRows,
    linkedRows: [
      licensorLink({ division: "CW001", canonical_name: "ACME Studios", source_ref_name: "ACME Studios" }),
      licensorLink({ division: "SP001", canonical_name: "ACME Studios", source_ref_name: "Acme Studios" }),
    ],
  });

  assert.equal(cycle2.counts.curated_name_changes, 0);
  assert.equal(cycle2.quarantines.length, 0);
  assert.equal(isNoOpCycle(cycle2), true);
});

test("rankFanInArms orders by normalized name, then raw name, then typed key — as bytes", () => {
  const arm = (key, source_name) => ({
    key, entity_type: "licensor", canonical_id: LIC_UUID, source_name,
  });

  // Raw name breaks the tie when the normalized names match.
  assert.deepEqual(
    rankFanInArms([arm("B/x/05/1", "Acme Studios"), arm("A/x/05/1", "ACME Studios")]).map((a) => a.key),
    ["A/x/05/1", "B/x/05/1"],
  );
  // Byte-identical names fall through to the typed key, so the order is TOTAL.
  assert.deepEqual(
    rankFanInArms([arm("Z/x/05/1", "Acme"), arm("A/x/05/1", "Acme")]).map((a) => a.key),
    ["A/x/05/1", "Z/x/05/1"],
  );
  // Byte order, not locale order: uppercase sorts before lowercase, and a locale-aware
  // comparison would call these equal.
  assert.ok(compareStableC("ACME", "Acme") < 0);
  assert.equal(compareStableC("Acme", "Acme"), 0);
  assert.equal("ACME".localeCompare("Acme", "en"), -("Acme".localeCompare("ACME", "en")));
});

test("the SQL side carries the same explicit ordering", () => {
  // If the migration's ORDER BY is ever dropped or its collations removed, the database
  // silently returns to row-order-dependent winners while this JavaScript stays correct —
  // and the two would then disagree about the curated name with nothing to catch it.
  const migration = readFileSync(
    fileURLToPath(new URL(
      "../supabase/migrations/20260731200000_coldlion_recurring_promotion_fanin_name_tiebreak.sql",
      import.meta.url,
    )),
    "utf8",
  );
  const normalized = migration.replace(/\s+/g, " ");
  assert.match(
    normalized,
    /order by e\.normalized_source_name collate "C", e\.source_name collate "C", e\.typed_key collate "C"/,
    "the migration must rank fan-in arms by normalized name, raw name, then typed key — all collate \"C\"",
  );
  assert.match(normalized, /partition by e\.entity_type, e\.canonical_id/);

  // The subtle regression: restoring `source_name is distinct from canonical_name` to the
  // ELIGIBILITY filter looks harmless, keeps every within-cycle test green, and brings back
  // the cross-cycle flip — the arm that already matches must stay in the ranking.
  const eligibleBlock = normalized.slice(
    normalized.indexOf("with eligible as ("),
    normalized.indexOf("ranked as ("),
  );
  assert.ok(eligibleBlock.length > 0, "the eligible CTE must still exist");
  assert.doesNotMatch(
    eligibleBlock,
    /is distinct from r\.canonical_name/,
    "the tie-break group must include the arm that already spells the curated name",
  );
  // ...and the distinctness test must live on the UPDATEs instead.
  assert.equal(
    (normalized.match(/and e\.source_name is distinct from e\.canonical_name/g) ?? []).length,
    2,
    "both curated-name UPDATEs must write only when the winner's spelling actually differs",
  );
  // Exactly one arm may write the curated name: both UPDATEs must read from `winner`.
  assert.match(normalized, /update core\.licensor l set name = e\.source_name, updated_at = now\(\) from winner e/);
  assert.match(normalized, /update core\.property p set name = e\.source_name, updated_at = now\(\) from winner e/);
  // And the losing arms must still be audited.
  assert.match(normalized, /where r\.arm_rank > 1/);
});

test("a CODE COLLISION quarantines when the fan-in arms DISAGREE on the name", () => {
  // One canonical row fed by two typed keys differing in mgTypeCode, proposing two names.
  const plan = planRecurringPromotion({
    sourceRows: [
      licensorSource({ name: "Batman" }),
      licensorSource({ mgTypeCode: "07", name: "Something Else Entirely" }),
    ],
    linkedRows: [licensorLink(), licensorLink({ mgTypeCode: "07" })],
  });
  assert.ok(reasonsOf(plan).includes("code_collision"), JSON.stringify(reasonsOf(plan)));
  assert.equal(plan.promotions.length, 0);
});

test("a CROSS-DIVISION COLLISION quarantines with its own reason when the arms DISAGREE", () => {
  // Same company/type/code, two divisions, one canonical row, two different names: codes
  // are unique only within (division, mgTypeCode).
  const plan = planRecurringPromotion({
    sourceRows: [
      licensorSource({ name: "Batman" }),
      licensorSource({ division: "SP001", name: "Totally Different" }),
    ],
    linkedRows: [licensorLink(), licensorLink({ division: "SP001" })],
  });
  assert.ok(
    reasonsOf(plan).includes("cross_division_collision"),
    JSON.stringify(reasonsOf(plan)),
  );
  assert.equal(plan.promotions.length, 0);
});

test("a WRONG TYPE row quarantines (Big Theme is not a licensed entity)", () => {
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource({ entityType: null }), licensorSource({ mgCode: "BT", entityType: "big_theme" })],
    linkedRows: [licensorLink()],
  });
  const reasons = reasonsOf(plan);
  assert.equal(reasons.filter((r) => r === "wrong_type").length, 2);
  assert.equal(plan.promotions.length, 0);
});

test("a malformed typed key quarantines as wrong_type", () => {
  for (const bad of [{ division: "" }, { mgTypeCode: "5" }, { mgTypeCode: "ab" }, { mgCode: "  " }, { company: "" }]) {
    const plan = planRecurringPromotion({ sourceRows: [licensorSource(bad)], linkedRows: [] });
    assert.ok(reasonsOf(plan).includes("wrong_type"), `${JSON.stringify(bad)} should quarantine`);
  }
});

test("a RE-KEYED record quarantines", () => {
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource({ mgCode: "BM" })],
    linkedRows: [licensorLink({ canonical_code: "BATMAN-OLD" })],
  });
  assert.deepEqual(reasonsOf(plan), ["rekeyed_record"]);
});

test("a PARENTLESS property quarantines", () => {
  const plan = planRecurringPromotion({
    sourceRows: [propertySource()],
    linkedRows: [propertyLink({ canonical_licensor_id: null })],
  });
  assert.deepEqual(reasonsOf(plan), ["parentless_record"]);
});

// =====================================================================================
// Counts can never substitute for row-by-row identity
// =====================================================================================

test("matching counts with swapped identities do NOT pass", () => {
  // Two source rows, two linked rows, counts match perfectly — but the codes are swapped,
  // so neither typed key resolves. A count-based check would call this healthy.
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource({ mgCode: "AA" }), licensorSource({ mgCode: "BB" })],
    linkedRows: [licensorLink({ mgCode: "CC", canonical_code: "CC" }), licensorLink({ mgCode: "DD", canonical_code: "DD", canonical_id: OTHER_UUID })],
  });
  assert.equal(plan.counts.source_rows, plan.counts.linked_rows);
  assert.equal(plan.promotions.length, 0);
  assert.equal(plan.quarantines.length, 4);
  assert.equal(reasonsOf(plan).filter((r) => r === "new_source_record").length, 2);
  assert.equal(reasonsOf(plan).filter((r) => r === "missing_source_record").length, 2);
});

test("the plan reports every count needed for an audit record", () => {
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource({ name: "BATMAN" }), propertySource()],
    linkedRows: [licensorLink(), propertyLink()],
  });
  assert.deepEqual(plan.counts, {
    source_rows: 2, linked_rows: 2, promotions: 1, curated_name_changes: 1,
    provenance_refreshes: 0, provenance_source_code_refreshes: 0,
    unchanged: 1, quarantines: 0, protected_violations: 0,
  });
  assert.equal(plan.human_response_owner, "Albert Hazan");
});

test("empty input is a clean no-op, not an error and not a mass quarantine", () => {
  const plan = planRecurringPromotion({});
  assert.equal(plan.refuse, false);
  assert.equal(plan.promotions.length, 0);
  assert.equal(plan.quarantines.length, 0);
  assert.equal(isNoOpCycle(plan), true);
});

// =====================================================================================
// THE PROVENANCE-REFRESH SET — the second cross-checked set (added 2026-07-31)
//
// The Step 5.6 plan cross-check used to compare ONLY the curated-name set, so two whole
// mutation paths in plm.promote_coldlion_source_owned were applied with no independent
// agreement behind them: the source_code refresh, and the refresh of a row held for review.
// Every test below is written against a row that produces NO curated-name promotion, because
// that is precisely the shape the old cross-check could not see.
// =====================================================================================

function provenanceRow(over = {}) {
  return {
    company: "EDGEHOME", division: "CW001", mgTypeCode: "05", mgCode: "BM",
    entityType: "licensor", name: "Batman",
    source_ref_id: "44444444-4444-4444-8444-444444444444",
    source_ref_name: "Batman", source_ref_code: "BM", ...over,
  };
}

test("a source_code-only drift IS a planned provenance refresh (the first blind spot)", () => {
  // Names agree everywhere. Nothing is promoted, nothing is quarantined — and yet the
  // database rewrites taxonomy_source_ref.source_code. Before this set existed, that write
  // was invisible to the cross-check on BOTH sides.
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource()],
    linkedRows: [licensorLink()],
    provenanceRows: [provenanceRow({ source_ref_code: "BM-OLD" })],
  });
  assert.equal(plan.promotions.length, 0, "no curated-name promotion — that is the point");
  assert.equal(plan.quarantines.length, 0);
  assert.deepEqual(plan.provenance_refreshes, [
    { key: "EDGEHOME/CW001/05/BM", entity_type: "licensor", fields: ["core.taxonomy_source_ref.source_code"] },
  ]);
  assert.equal(plan.counts.provenance_source_code_refreshes, 1);
});

test("a HELD row still plans its provenance refresh (the second blind spot)", () => {
  // "Superman" is not a presentation variant of "Batman", so the curated name is held for
  // review — but ColdLion's truth still lands in provenance, by design. That write was
  // outside the old assertion, which required quarantine_reason IS NULL.
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource({ name: "Superman" })],
    linkedRows: [licensorLink()],
    provenanceRows: [provenanceRow({ name: "Superman" })],
  });
  assert.deepEqual(reasonsOf(plan), ["source_name_divergence"]);
  assert.equal(plan.promotions.length, 0);
  assert.deepEqual(plan.provenance_refreshes.map((p) => p.key), ["EDGEHOME/CW001/05/BM"]);
  assert.deepEqual(plan.provenance_refreshes[0].fields, ["core.taxonomy_source_ref.source_name"]);
});

test("both fields drifting on one row report both fields, sorted, once", () => {
  const plan = planRecurringPromotion({
    provenanceRows: [provenanceRow({ source_ref_name: "BATMAN-OLD", source_ref_code: "BM-OLD" })],
  });
  assert.deepEqual(plan.provenance_refreshes[0].fields, [
    "core.taxonomy_source_ref.source_code",
    "core.taxonomy_source_ref.source_name",
  ]);
});

test("a row with nothing to refresh is NOT in the set — the steady state stays empty", () => {
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource()], linkedRows: [licensorLink()],
    provenanceRows: [provenanceRow()],
  });
  assert.deepEqual(plan.provenance_refreshes, []);
  assert.equal(isNoOpCycle(plan), true);
});

test("a row with NO provenance row is excluded — a missing ref cannot be updated", () => {
  // SQL: `and p.source_ref_id is not null`. Null id must not be conflated with a ref whose
  // stored name and code happen to be null, or the two sides disagree and the cycle aborts.
  const plan = planRecurringPromotion({
    provenanceRows: [provenanceRow({ source_ref_id: null, source_ref_name: null, source_ref_code: null })],
  });
  assert.deepEqual(plan.provenance_refreshes, []);
});

test("wrong_type is the ONE exclusion, matching the SQL predicate term for term", () => {
  for (const bad of [{ division: "" }, { mgTypeCode: "5" }, { mgTypeCode: "ab" }, { mgCode: "  " }, { company: "" }]) {
    const plan = planRecurringPromotion({
      provenanceRows: [provenanceRow({ source_ref_name: "drifted", ...bad })],
    });
    assert.deepEqual(plan.provenance_refreshes, [], `${JSON.stringify(bad)} is wrong_type and must be excluded`);
  }
  // ...and every OTHER quarantine reason is still refreshed. A rekeyed record is held for
  // review, but ColdLion's descriptive truth is still recorded.
  const rekeyed = planRecurringPromotion({
    sourceRows: [licensorSource({ name: "BATMAN" })],
    linkedRows: [licensorLink({ canonical_code: "BATMAN-OLD" })],
    provenanceRows: [provenanceRow({ name: "BATMAN" })],
  });
  assert.deepEqual(reasonsOf(rekeyed), ["rekeyed_record"]);
  assert.equal(rekeyed.provenance_refreshes.length, 1);
});

test("one typed key on two mirror rows collapses to ONE entry — sets, not bags", () => {
  // A licensor and a property can share a typed key space and resolve to the same provenance
  // row. The database compares DISTINCT keys; a bag comparison here would raise a false
  // disagreement and fail-close a healthy cycle.
  const plan = planRecurringPromotion({
    provenanceRows: [
      provenanceRow({ source_ref_name: "drifted" }),
      provenanceRow({ entityType: "property", name: "Batman", source_ref_name: "drifted" }),
    ],
  });
  assert.equal(plan.provenance_refreshes.length, 1);
});

test("the set is sorted by typed key, so both sides compare identically", () => {
  const plan = planRecurringPromotion({
    provenanceRows: [
      provenanceRow({ mgCode: "ZZ", source_ref_code: "x" }),
      provenanceRow({ mgCode: "AA", source_ref_code: "x" }),
      provenanceRow({ mgCode: "MM", source_ref_code: "x" }),
    ],
  });
  assert.deepEqual(plan.provenance_refreshes.map((p) => p.key), [
    "EDGEHOME/CW001/05/AA", "EDGEHOME/CW001/05/MM", "EDGEHOME/CW001/05/ZZ",
  ]);
});

test("the plan ALWAYS carries the provenance_refreshes key, even when empty", () => {
  // The database refuses a plan that OMITS the key (an out-of-date runner) but accepts an
  // empty array. Emitting `undefined` on a quiet cycle would fail every healthy run.
  assert.ok(Array.isArray(planRecurringPromotion({}).provenance_refreshes));
  assert.ok(Array.isArray(planRecurringPromotion({ sourceRows: [licensorSource()] }).provenance_refreshes));
});

test("a pending provenance refresh means the cycle is NOT a no-op", () => {
  // isNoOpCycle is the idempotency proof. A cycle that still writes source_code is not idle,
  // and reporting it as idle would assert idempotency about a mutating run.
  const plan = planRecurringPromotion({
    sourceRows: [licensorSource()], linkedRows: [licensorLink()],
    provenanceRows: [provenanceRow({ source_ref_code: "BM-OLD" })],
  });
  assert.equal(plan.promotions.length, 0);
  assert.equal(isNoOpCycle(plan), false);
});

test("computeProvenanceRefreshes is pure and tolerates junk input", () => {
  assert.deepEqual(computeProvenanceRefreshes(), []);
  assert.deepEqual(computeProvenanceRefreshes(null), []);
  assert.deepEqual(computeProvenanceRefreshes([null, undefined, {}]), []);
  const rows = [provenanceRow({ source_ref_code: "drift" })];
  const frozen = JSON.stringify(rows);
  computeProvenanceRefreshes(rows);
  assert.equal(JSON.stringify(rows), frozen, "input must not be mutated");
});
