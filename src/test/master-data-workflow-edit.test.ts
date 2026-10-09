import { describe, expect, it } from "vitest";

import { normalizeWorkflowEditValue, workflowCellValue } from "@/lib/master-data-workflow";

describe("Master Data workflow edit values", () => {
  it("clears production approval despite a historical AC value", () => {
    const column = { letter: "AC", typedField: "production_status", legacyKey: "production_approval" };
    const historicalRow = {
      production_status: "2024-03-12",
      row_data: { AC: "2024-03-12", production_approval: "2024-03-12" },
    };
    const cleared = normalizeWorkflowEditValue(null, column);
    const updatedRow = {
      ...historicalRow,
      production_status: cleared,
      row_data: { ...historicalRow.row_data, AC: cleared, production_approval: cleared },
    };

    expect(cleared).toBeNull();
    expect(workflowCellValue(updatedRow, column)).toBeNull();
  });

  it("treats nullish and blank editor values as clears", () => {
    expect(normalizeWorkflowEditValue(null, {})).toBeNull();
    expect(normalizeWorkflowEditValue(undefined, {})).toBeNull();
    expect(normalizeWorkflowEditValue("", {})).toBeNull();
  });

  it("preserves false values and normal date strings", () => {
    expect(normalizeWorkflowEditValue(false, { yesNo: true })).toBe(false);
    expect(normalizeWorkflowEditValue(false, { typedField: "discontinued" })).toBe(false);
    expect(normalizeWorkflowEditValue("2026-10-09", { typedField: "production_status" })).toBe("2026-10-09");
  });
});
