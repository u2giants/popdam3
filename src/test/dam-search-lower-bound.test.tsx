import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

import { fetchHybridSearchPage, isLowerBoundTotal, parseDamSearchFacets } from "@/lib/dam-search";
import { formatCount } from "@/lib/format-count";
import PaginationBar from "@/components/library/PaginationBar";

// popdam3#97: search_dam_documents (shared-db 20261021190510) reports
// facets.totalExact = false / totalKind = 'lower_bound' past the 1,000 probe.
describe("lower-bound search totals", () => {
  it("formats lower bounds as N+ and exact counts plainly", () => {
    expect(formatCount(1000, true)).toBe("1,000+");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(42, false)).toBe("42");
  });

  it("reads the RPC flag", () => {
    expect(isLowerBoundTotal({ totalExact: false, totalKind: "lower_bound" })).toBe(true);
    expect(isLowerBoundTotal({ totalKind: "lower_bound" })).toBe(true);
    expect(isLowerBoundTotal({ totalExact: true, totalKind: "exact" })).toBe(false);
    expect(isLowerBoundTotal({})).toBe(false);
    expect(isLowerBoundTotal(null)).toBe(false);
  });

  it("carries the flag on the page and facets", async () => {
    const facets = { fileType: { psd: 700 }, totalExact: false, totalKind: "lower_bound" };
    invoke.mockResolvedValue({ data: { results: [], total_count: 1000, has_more: true, facets }, error: null });
    const page = await fetchHybridSearchPage({ query: "mickey", documentType: "asset", limit: 1 });
    expect(page.totalIsLowerBound).toBe(true);
    expect(parseDamSearchFacets(page.facets).lowerBound).toBe(true);

    invoke.mockResolvedValue({ data: { results: [], total_count: 12, has_more: false, facets: { totalExact: true, totalKind: "exact" } }, error: null });
    const exact = await fetchHybridSearchPage({ query: "mickey", documentType: "asset", limit: 1 });
    expect(exact.totalIsLowerBound).toBe(false);
    expect(parseDamSearchFacets(exact.facets).lowerBound).toBe(false);
  });

  it("pagination shows 1,000+ for a lower-bound total", () => {
    const { rerender } = render(
      <PaginationBar page={0} totalCount={1000} totalIsLowerBound pageSize={100} onPageChange={() => {}} onPageSizeChange={() => {}} />,
    );
    expect(screen.getByText(/of 1,000\+/)).toBeTruthy();
    rerender(<PaginationBar page={0} totalCount={1000} pageSize={100} onPageChange={() => {}} onPageSizeChange={() => {}} />);
    expect(screen.getByText(/of 1,000$/)).toBeTruthy();
  });
});
