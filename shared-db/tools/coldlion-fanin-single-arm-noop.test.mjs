// Regression pin for the SINGLE-ARM NO-OP that the defect-4 fix rests on.
//
// Defect 4 (fixed on PR #362): rehearsal cases 3, 11 and 12 flipped ONE typed arm of a
// canonical row and then asserted a guard fired. Since migration
// 20260731200000_coldlion_recurring_promotion_fanin_name_tiebreak.sql every canonical row is
// fed by TWO typed keys, and the section 5.9 tie-break picks between them deterministically.
// Flipping a single arm leaves the OTHER arm — the one that already spells the curated name
// exactly — winning the tie-break, so the promotion correctly writes no curated name at all.
// A promotion that writes nothing never reaches the guard, which made those three cases look
// like they were passing when they were merely never invoking the thing under test. The fix
// was to flip ALL ARMS.
//
// That fix is only correct while the single-arm flip really is a curated-name no-op. If the
// tie-break ever regresses so a single-arm flip DOES write, cases 3/11/12 quietly revert to
// never firing their guard again — with no failing test anywhere, because they would still be
// flipping all arms. This file is the pin: it fails the moment that premise stops holding.
//
// FULLY OFFLINE. Pure planner functions only — no database, no network, no rehearsal run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { planRecurringPromotion } from "./coldlion-recurring-promotion.mjs";

const LIC_UUID = "11111111-1111-4111-8111-111111111111";
const CURATED = "BATMAN";

function arm(division, name) {
  return {
    company: "EDGEHOME",
    division,
    mgTypeCode: "05",
    mgCode: "BM",
    entityType: "licensor",
    name,
  };
}

function link(division, sourceRefName) {
  return {
    company: "EDGEHOME",
    division,
    mgTypeCode: "05",
    mgCode: "BM",
    entityType: "licensor",
    canonical_id: LIC_UUID,
    canonical_name: CURATED,
    canonical_code: "BM",
    canonical_status: "active",
    canonical_licensor_id: null,
    source_ref_name: sourceRefName,
  };
}

/**
 * A SETTLED two-arm canonical row: both typed keys feed one licensor and both already spell
 * the curated name exactly. This is the state the rehearsal's fault cases start from.
 * `flip` names the arms whose ColdLion source name changes presentation this cycle.
 */
function settledFanIn(flip = []) {
  const nameFor = (d) => (flip.includes(d) ? "Batman" : CURATED);
  return {
    sourceRows: [arm("CW001", nameFor("CW001")), arm("SP001", nameFor("SP001"))],
    linkedRows: [link("CW001", CURATED), link("SP001", CURATED)],
  };
}

const curatedWriters = (plan) =>
  plan.promotions.filter((p) => p.proposed_fields?.["core.licensor.name"] !== undefined);

test("the settled two-arm state is already stable — nothing to promote", () => {
  const plan = planRecurringPromotion(settledFanIn());
  assert.equal(plan.refuse, false);
  assert.equal(plan.quarantines.length, 0);
  assert.equal(plan.counts.curated_name_changes, 0);
  assert.equal(curatedWriters(plan).length, 0);
});

test("flipping a SINGLE typed arm is a curated-name NO-OP (the defect-4 premise)", () => {
  // "BATMAN" < "Batman" in byte order ('A' 0x41 < 'a' 0x61), so the UNFLIPPED SP001 arm wins
  // the tie-break. It already spells the curated name, so nobody rewrites it — rewriting it to
  // the flipped arm's spelling would flip the value back and forth every cycle.
  const plan = planRecurringPromotion(settledFanIn(["CW001"]));

  assert.equal(plan.refuse, false);
  assert.equal(plan.quarantines.length, 0, JSON.stringify(plan.quarantines));
  assert.equal(
    plan.counts.curated_name_changes,
    0,
    "a single-arm flip must NOT write the curated name — rehearsal cases 3/11/12 depend on it",
  );
  assert.equal(curatedWriters(plan).length, 0);

  // And it is a reasoned withdrawal, not an accidental silence.
  const all = [...plan.promotions, ...plan.unchanged];
  const flipped = all.find((p) => p.key === "EDGEHOME/CW001/05/BM");
  assert.ok(flipped, "the flipped arm must still appear in the plan, never silently dropped");
  assert.equal(flipped.curated_name_tiebreak?.outcome, "lost");
  assert.equal(flipped.curated_name_tiebreak.winner_key, "EDGEHOME/SP001/05/BM");
  assert.match(flipped.curated_name_tiebreak.detail, /already spells the curated name exactly/);
});

test("the single-arm no-op holds whichever arm is flipped, in every row order", () => {
  for (const flipped of ["CW001", "SP001"]) {
    const base = settledFanIn([flipped]);
    const orderings = [
      base,
      { sourceRows: [...base.sourceRows].reverse(), linkedRows: base.linkedRows },
      { sourceRows: base.sourceRows, linkedRows: [...base.linkedRows].reverse() },
      { sourceRows: [...base.sourceRows].reverse(), linkedRows: [...base.linkedRows].reverse() },
    ];
    for (const input of orderings) {
      const plan = planRecurringPromotion(input);
      assert.equal(
        plan.counts.curated_name_changes,
        0,
        `single-arm flip of ${flipped} wrote a curated name in one row ordering`,
      );
    }
  }
});

test("flipping ALL ARMS — what the fixed rehearsal does — DOES write, exactly once", () => {
  // This is the other half of the pin. If the all-arms flip ever stopped writing, cases
  // 3/11/12 would go back to never invoking their guard by a different route.
  const plan = planRecurringPromotion(settledFanIn(["CW001", "SP001"]));

  assert.equal(plan.refuse, false);
  assert.equal(plan.quarantines.length, 0, JSON.stringify(plan.quarantines));
  assert.equal(
    plan.counts.curated_name_changes,
    1,
    "flipping all arms must produce exactly one curated-name write for the guard to fire on",
  );

  const writers = curatedWriters(plan);
  assert.equal(writers.length, 1);
  assert.equal(writers[0].proposed_fields["core.licensor.name"], "Batman");
  // Both arms now spell it "Batman", so the raw-name comparison ties and the typed key breaks
  // it: CW001 < SP001 in byte order.
  assert.equal(writers[0].key, "EDGEHOME/CW001/05/BM");
  assert.equal(writers[0].curated_name_tiebreak.outcome, "won");
  assert.equal(writers[0].curated_name_tiebreak.arm_count, 2);
});
