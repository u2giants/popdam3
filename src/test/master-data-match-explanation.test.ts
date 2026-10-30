import { describe, expect, it } from "vitest";
import { matchStatusExplanation } from "@/pages/styles/helpers";
import type { StyleRow } from "@/pages/styles/types";

const row = (over: Partial<StyleRow>) => ({ id: "r", sku: "AB123", ...over }) as StyleRow;

describe("matchStatusExplanation", () => {
  it("is empty for linked lines", () => {
    expect(matchStatusExplanation(row({ match_status: "matched" }))).toBeNull();
  });
  it("names the near-miss customer", () => {
    const text = matchStatusExplanation(row({ match_status: "needs_review", customer: "Ollie's", match_notes: { fuzzy: { customer: { score: 0.85, target_label: "Ollies" } } } }));
    expect(text).toContain('Customer "Ollie\'s" is not an exact match; closest is "Ollies" (85% similar)');
  });
  it("counts competing candidates", () => {
    expect(matchStatusExplanation(row({ match_status: "needs_review", match_notes: { plm_item_candidates: 3 } }))).toContain("3 possible ColdLion items");
  });
  it("explains partial and unlinked lines", () => {
    expect(matchStatusExplanation(row({ match_status: "partial", core_licensor_id: "x" }))).toBe('Partial: SKU "AB123" was not found in ColdLion or the item master. Only the licensor matched.');
    expect(matchStatusExplanation(row({ match_status: "unmatched" }))).toContain("no customer, licensor or vendor matched");
  });
});
