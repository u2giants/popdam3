import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

import { fetchHybridSearchPage, parseDamSearchFacets } from "@/lib/dam-search";
import { formatCount } from "@/lib/format-count";
import PaginationBar from "@/components/library/PaginationBar";

// Owner ask 2026-10-29: search counts are exact only. search_dam_documents
// (shared-db exact-totals migration) always reports facets.totalExact=true /
// totalKind='exact', and the "+" lower-bound plumbing was removed from the
// app. These tests pin that the UI can no longer render an "N+" count.
describe("exact search totals", () => {
  it("formats counts without any suffix", () => {
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(42)).toBe("42");
    expect(formatCount(0)).toBe("0");
  });

  it("drops the legacy lower-bound facet flag instead of propagating it", async () => {
    invoke.mockResolvedValue({
      data: {
        results: [],
        total_count: 1325,
        has_more: true,
        // A pre-migration backend response may still carry the legacy flags;
        // the app must show the number as-is, never append "+".
        facets: { totalExact: false, totalKind: "lower_bound" },
      },
      error: null,
    });
    const page = await fetchHybridSearchPage({ query: "spiderman", documentType: "style_group", limit: 1 });
    expect(page.totalCount).toBe(1325);
    expect(page.facets.totalKind).toBe("lower_bound");
    const facets = parseDamSearchFacets(page.facets);
    expect("lowerBound" in facets).toBe(false);
  });

  it("pagination always shows a plain exact number", () => {
    render(<PaginationBar page={0} totalCount={1325} pageSize={100} onPageChange={() => {}} onPageSizeChange={() => {}} />);
    expect(screen.getByText(/of 1,325$/)).toBeTruthy();
    expect(screen.queryByText(/1,325\+/)).toBeNull();
  });
});
