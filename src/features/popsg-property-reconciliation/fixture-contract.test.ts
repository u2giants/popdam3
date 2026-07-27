import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  PSG2_APPROVED_BATCH_SOURCE_SHA256,
  PSG2_FIXTURE_ROWS,
  PSG2_SIGNED_BATCH_KEYS,
} from "./generated-psg2-fixture";
import { APPROVED_BATCH, isEffectivelyAmbiguous, queueForDisposition } from "./contract";

describe("signed PSG-2 fixture adapter", () => {
  it("preserves the complete frozen population", () => {
    expect(PSG2_FIXTURE_ROWS).toHaveLength(372);
    expect(PSG2_FIXTURE_ROWS.reduce((sum, row) => sum + row.activeFileCount, 0)).toBe(216_417);
  });

  it("preserves only the exact owner-approved batch as preparable scope", () => {
    const approved = PSG2_FIXTURE_ROWS.filter((row) => row.batchId === APPROVED_BATCH.id);
    expect(approved).toHaveLength(APPROVED_BATCH.rowCount);
    expect(approved.reduce((sum, row) => sum + row.activeFileCount, 0)).toBe(
      APPROVED_BATCH.activeFileCount,
    );
    expect(approved.every((row) => row.disposition === "exact_existing")).toBe(true);
    expect(PSG2_APPROVED_BATCH_SOURCE_SHA256).toBe(APPROVED_BATCH.sha256);
    expect(PSG2_SIGNED_BATCH_KEYS).toHaveLength(51);
    expect(new Set(approved.map((row) => row.observationKey))).toEqual(
      new Set(PSG2_SIGNED_BATCH_KEYS),
    );
    expect(
      createHash("sha256").update(`${[...PSG2_SIGNED_BATCH_KEYS].sort().join("\n")}\n`).digest("hex"),
    ).toBe("7e8972e4db7e5c91c4e35d38b659d8101c798e159bf390706d620cce5df09029");
    expect(
      approved.every(
        (row) =>
          row.licensorId &&
          row.targetPropertyId &&
          row.targetPropertyCode &&
          row.targetPropertyName &&
          row.targetPropertyStatus === "active" &&
          row.targetPropertyParentLicensorId === row.licensorId &&
          !row.currentlyTaggedAtRisk,
      ),
    ).toBe(true);
  });

  it("keeps create candidates and the Lion King open", () => {
    expect(
      PSG2_FIXTURE_ROWS.filter((row) => row.disposition === "canonical_create_candidate"),
    ).toHaveLength(2);
    const lionKing = PSG2_FIXTURE_ROWS.find((row) => row.observedValue === "the lion king");
    expect(lionKing?.disposition).toBe("ambiguous");
    expect(queueForDisposition(lionKing!.disposition)).toBe("needs_review");
  });

  it("uses effective ambiguity for exactly the 43 ambiguous rows", () => {
    const ambiguous = PSG2_FIXTURE_ROWS.filter((row) => isEffectivelyAmbiguous(row));
    expect(ambiguous).toHaveLength(43);
    expect(ambiguous.some((row) => row.observedValue === "the lion king")).toBe(true);
  });
});
