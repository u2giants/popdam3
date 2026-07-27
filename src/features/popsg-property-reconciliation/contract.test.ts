import { describe, expect, it } from "vitest";
import {
  APPROVED_BATCH,
  assertPendingSetCanAdd,
  canPreparePending,
  preparePendingProposal,
  queueForDisposition,
  stableDecisionExport,
  type ReconciliationRow,
} from "./contract";

const validRow: ReconciliationRow = {
  observationKey: "154bf54b-6f7d-4999-b0fb-c2828b12b56a|big lebowski",
  batchId: APPROVED_BATCH.id,
  licensorId: "licensor",
  licensorName: "Licensor",
  observedValue: "property",
  activeFileCount: 12,
  disposition: "exact_existing",
  rationaleCode: "exact",
  targetPropertyId: "property",
  targetPropertyCode: "P",
  targetPropertyName: "Property",
  targetPropertyStatus: "active",
  targetPropertyParentLicensorId: "licensor",
  currentlyTaggedAtRisk: false,
  ambiguity: false,
  representativeExamples: [],
};

describe("PSG-3 pending proposal contract", () => {
  it("blocks viewer and designer proposal preparation", () => {
    expect(canPreparePending("viewer", validRow)).toBe(false);
    expect(canPreparePending("designer", validRow)).toBe(false);
    expect(() => preparePendingProposal("viewer", validRow)).toThrow();
    expect(() => preparePendingProposal("designer", validRow)).toThrow();
  });

  it("lets an administrator prepare only an approved same-parent pending row", () => {
    expect(canPreparePending("administrator", validRow)).toBe(true);
    expect(preparePendingProposal("administrator", validRow, " checked ")).toMatchObject({
      state: "pending",
      note: "checked",
      ownerBatchSha256: APPROVED_BATCH.sha256,
    });
    expect(() =>
      preparePendingProposal("administrator", {
        ...validRow,
        targetPropertyParentLicensorId: "different-parent",
      }),
    ).toThrow();
    expect(() =>
      preparePendingProposal("administrator", {
        ...validRow,
        batchId: "batch-02-non-property",
        disposition: "non_property",
      }),
    ).toThrow();
    expect(() =>
      preparePendingProposal("administrator", {
        ...validRow,
        observationKey: "synthetic|off-key",
      }),
    ).toThrow();
  });

  it("has no activation field or activation action in its export", () => {
    const proposal = preparePendingProposal("administrator", validRow);
    const exported = stableDecisionExport([proposal]);
    expect(exported).toContain('"activationAvailable": false');
    expect(exported).not.toContain('"activated"');
    expect(exported).not.toContain('"effective"');
    expect(() =>
      stableDecisionExport([{ ...proposal, observationKey: "synthetic|off-key" }]),
    ).toThrow(/signed same-parent contract/);
  });

  it("blocks mixed-Licensor pending sets at prepare and export", () => {
    const first = preparePendingProposal("administrator", validRow);
    const second = {
      ...first,
      observationKey: "88313675-0089-4072-87be-5b989df8a3fc|looney tunes",
      licensorId: "other",
      targetPropertyParentLicensorId: "other",
    };
    expect(() => assertPendingSetCanAdd([first], second)).toThrow(/different Licensor/);
    expect(() => stableDecisionExport([first, second])).toThrow(/different Licensor/);
    const mixedDisposition = {
      ...first,
      observationKey: "licensor|other",
      disposition: "classics_cp",
    } as unknown as typeof first;
    expect(() => assertPendingSetCanAdd([first], mixedDisposition)).toThrow(
      /different disposition/,
    );
    expect(() => stableDecisionExport([first, mixedDisposition])).toThrow();
  });

  it("keeps the four business queues separate", () => {
    expect(queueForDisposition("ambiguous")).toBe("needs_review");
    expect(queueForDisposition("non_property")).toBe("intentionally_untagged");
    expect(queueForDisposition("exact_existing")).toBe("mapped");
    expect(queueForDisposition("canonical_create_candidate")).toBe("create_approval_required");
    expect(queueForDisposition("licensor_unresolved")).toBe("licensor_unresolved");
  });
});
