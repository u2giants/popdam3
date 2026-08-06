import { describe, expect, it } from "vitest";

import { approvalHighlightForRow } from "@/lib/style-tracker-row-highlighting";

describe("Master Data approval row highlighting", () => {
  it("highlights a row yellow when Concept Approval has a date", () => {
    expect(approvalHighlightForRow({ row_data: { concept_approval: "8/6/2026" } })).toBe("concept");
  });

  it("highlights a row green when Production Approval has a date", () => {
    expect(approvalHighlightForRow({ production_status: "2026-08-06" })).toBe("production");
  });

  it("gives Production Approval priority when both dates are entered", () => {
    expect(
      approvalHighlightForRow({
        production_status: "8/7/2026",
        row_data: { concept_approval: "8/6/2026" },
      }),
    ).toBe("production");
  });

  it("does not highlight blank or non-date approval values", () => {
    expect(approvalHighlightForRow({ row_data: { concept_approval: "Approved" } })).toBeNull();
    expect(approvalHighlightForRow({ production_status: "" })).toBeNull();
  });
});
