import { describe, expect, it } from "vitest";

import { mergeComputedLicenseStatus, workflowCellValue } from "@/lib/master-data-workflow";

describe("Master Data workflow source precedence", () => {
  it("treats a present semantic null as an intentional clear over historical sheet data", () => {
    const row = {
      concept_status: "typed current value",
      row_data: { concept_sent: null, O: "historic sheet date" },
    };
    expect(workflowCellValue(row, {
      letter: "O",
      typedField: "concept_status",
      legacyKey: "concept_sent",
    })).toBeNull();
  });

  it.each([
    { key: "sample_eta", letter: "SAMPLE_ETA" },
    { key: "sample_received", letter: "V" },
  ])("does not revive a historic $letter milestone when $key is explicitly cleared", ({ key, letter }) => {
    expect(workflowCellValue({ row_data: { [key]: null, [letter]: "historic milestone" } }, {
      letter,
      legacyKey: key,
    })).toBeNull();
  });

  it("uses legacy and typed values only when no semantic workflow key is present", () => {
    expect(workflowCellValue({ concept_status: null, row_data: { O: "sheet date" } }, {
      letter: "O",
      typedField: "concept_status",
      legacyKey: "concept_sent",
    })).toBe("sheet date");
    expect(workflowCellValue({ concept_status: "typed date", row_data: {} }, {
      letter: "O",
      typedField: "concept_status",
      legacyKey: "concept_sent",
    })).toBe("typed date");
  });

  it("returns computed licensing by row ID even when the result order differs", () => {
    const rows = [
      { id: "first", license_status: "stored-first", label: "one" },
      { id: "second", license_status: "stored-second", label: "two" },
    ];
    expect(mergeComputedLicenseStatus(rows, [
      { id: "second", license_status: "Current second" },
      { id: "first", license_status: "Current first" },
    ])).toEqual([
      { id: "first", license_status: "Current first", label: "one" },
      { id: "second", license_status: "Current second", label: "two" },
    ]);
  });

  it("fails visibly when a loaded row has no computed licensing result", () => {
    expect(() => mergeComputedLicenseStatus(
      [{ id: "missing", license_status: "stale stored value" }],
      [{ id: "other", license_status: "Approved" }],
    )).toThrow("Current license status is unavailable for a loaded Master Data row. Retry loading.");
  });

  it("keeps a linked row with a missing current status Unknown instead of showing its import snapshot", () => {
    expect(workflowCellValue({
      license_status: null,
      row_data: { N: "Approved at import", license_status: "Approved at import" },
    }, { letter: "N", typedField: "license_status", legacyKey: "license_status" })).toBe("Unknown");
  });
});
