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
  it("preserves both licensor ambiguity counts", () => {
    const text = matchStatusExplanation(row({ match_status: "needs_review", match_notes: { public_licensor_candidates: 2, core_licensor_candidates: 3 } }));
    expect(text).toContain("2 possible public licensors");
    expect(text).toContain("3 possible core licensors");
  });
  it.each([
    { creative_designer_id: "d", label: "designer" },
    { customer_id: "c", label: "customer" },
  ])("recognizes a partial $label link", ({ label, ...ids }) => {
    expect(matchStatusExplanation(row({ match_status: "partial", ...ids }))).toContain(`Only the ${label} matched.`);
  });
  it.each(["erp_item_id", "plm_item_id", "style_group_id"])("does not deny an existing %s link", (key) => {
    const linked = { [key]: "item", creative_designer_id: "d" };
    expect(matchStatusExplanation(row({ match_status: "partial", ...linked }))).toContain("An item or style group is linked");
    const text = matchStatusExplanation(row({ match_status: "unmatched", ...linked }));
    expect(text).not.toContain("was not found");
    expect(text).not.toContain("no customer");
  });
  it("explains partial and unlinked lines", () => {
    expect(matchStatusExplanation(row({ match_status: "partial", core_licensor_id: "x" }))).toBe('Partial: SKU "AB123" was not found in ColdLion or the item master. Only the licensor matched.');
    expect(matchStatusExplanation(row({ match_status: "unmatched" }))).toContain("has not been fully linked");
  });
});
