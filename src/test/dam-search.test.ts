import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, maybeSingle } = vi.hoisted(() => ({ invoke: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) },
}));

import { buildDamSearchFilters, fetchHybridSearchIds, fetchHybridSearchPage, fetchSearchIds, getSearchMode, invalidateSearchMode, parseSearchMode, sortByRank } from "@/lib/dam-search";
import { defaultFilters } from "@/types/assets";

describe("DAM hybrid search", () => {
  beforeEach(() => { invoke.mockReset(); maybeSingle.mockReset(); invalidateSearchMode(); });

  it("maps only matching edge results to ranked entity IDs", async () => {
    invoke.mockResolvedValue({
      data: { results: [
        { document_type: "asset", entity_id: "second" },
        { document_type: "style_group", entity_id: "ignored" },
        { document_type: "asset", entity_id: "first" },
      ] },
      error: null,
    });

    await expect(fetchHybridSearchIds("snowman", "asset", 500)).resolves.toEqual(["second", "first"]);
    expect(invoke).toHaveBeenCalledWith("dam-search-ai", {
      signal: expect.any(AbortSignal),
      body: {
        action: "search",
        query: "snowman",
        limit: 500,
        offset: 0,
        filters: {},
        min_rank: 0,
        document_types: ["asset"],
      },
    });
  });

  it("passes ranked pagination and returns count, continuation, and facets", async () => {
    invoke.mockResolvedValue({
      data: {
        results: [{ document_type: "style_group", entity_id: "group-2" }],
        total_count: 23,
        has_more: true,
        facets: { fileType: { psd: 12 } },
      },
      error: null,
    });

    await expect(fetchHybridSearchPage({
      query: "snowman",
      documentType: "style_group",
      limit: 10,
      offset: 10,
      filters: { customerId: "customer-id" },
      minRank: 0.1,
    })).resolves.toEqual({
      ids: ["group-2"],
      totalCount: 23,
      hasMore: true,
      facets: { fileType: { psd: 12 } },
    });
    expect(invoke).toHaveBeenCalledWith("dam-search-ai", {
      signal: expect.any(AbortSignal),
      body: {
        action: "search",
        query: "snowman",
        limit: 10,
        offset: 10,
        filters: { customerId: "customer-id" },
        min_rank: 0.1,
        document_types: ["style_group"],
      },
    });
  });

  it("preserves relevance order independently of database row order", () => {
    const rows = [{ id: "third" }, { id: "first" }, { id: "second" }];
    expect(sortByRank(rows, ["second", "third", "first"], (row) => row.id))
      .toEqual([{ id: "second" }, { id: "third" }, { id: "first" }]);
  });

  it("maps every active library filter to the ranked contract", () => {
    expect(buildDamSearchFilters({
      ...defaultFilters,
      contentType: ["product_photo"],
      productMaterial: ["wood"],
      fileStatus: ["has_preview"],
      productCategory: ["Wall"],
      customer: "customer-id",
    })).toMatchObject({
      contentType: ["product_photo"],
      productMaterial: ["wood"],
      fileStatus: ["has_preview"],
      productCategory: ["Wall"],
      customerId: "customer-id",
    });
  });

  it("keeps keyword mode as the default for absent or invalid config", () => {
    expect(parseSearchMode(undefined)).toBe("keyword");
    expect(parseSearchMode("anything-else")).toBe("keyword");
    expect(parseSearchMode("hybrid")).toBe("hybrid");
  });

  it("invalidates the cached mode so activation and rollback are visible", async () => {
    invoke.mockResolvedValueOnce({ data: { modes: { dam: "hybrid" } }, error: null });
    await expect(getSearchMode()).resolves.toBe("hybrid");
    invoke.mockResolvedValueOnce({ data: { modes: { dam: "keyword" } }, error: null });
    invalidateSearchMode();
    await expect(getSearchMode()).resolves.toBe("keyword");
  });

  it("keeps keyword mode on the existing keyword callback", async () => {
    const keywordSearch = vi.fn().mockResolvedValue(["keyword-first", "keyword-second"]);
    await expect(fetchSearchIds("keyword", "snowman", "asset", 500, keywordSearch))
      .resolves.toEqual(["keyword-first", "keyword-second"]);
    expect(keywordSearch).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([401, 403])("auth_denial_never_keyword_fallback (%s)", async (status) => {
    const denied = { context: new Response(null, { status }) };
    invoke.mockResolvedValue({ data: null, error: denied });
    const keyword = vi.fn();
    await expect(fetchSearchIds("hybrid", "snowman", "asset", 50, keyword)).rejects.toBe(denied);
    expect(keyword).not.toHaveBeenCalled();
    await expect(getSearchMode()).rejects.toBe(denied);
  });

  it("uses keyword fallback for provider outage", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(null, { status: 503 }) } });
    const keyword = vi.fn().mockResolvedValue(["keyword"]);
    await expect(fetchSearchIds("hybrid", "snowman", "asset", 50, keyword)).resolves.toEqual(["keyword"]);
    expect(keyword).toHaveBeenCalledOnce();
    await expect(getSearchMode()).resolves.toBe("keyword");
  });

  it("cancels a stalled semantic request after six seconds before keyword fallback", async () => {
    vi.useFakeTimers();
    try {
      invoke.mockImplementation((_name, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
      const keyword = vi.fn().mockResolvedValue(["retained-keyword"]);
      const pending = fetchSearchIds("hybrid", "snowman", "asset", 50, keyword);
      await vi.advanceTimersByTimeAsync(5999);
      expect(keyword).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual(["retained-keyword"]);
      expect(keyword).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("uses the capability cache until its 30-second expiry", async () => {
    vi.useFakeTimers();
    try {
      invoke.mockResolvedValueOnce({ data: { modes: { dam: "hybrid" } }, error: null });
      await expect(getSearchMode()).resolves.toBe("hybrid");
      await expect(getSearchMode()).resolves.toBe("hybrid");
      expect(invoke).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(30_001);
      invoke.mockResolvedValueOnce({ data: { modes: { dam: "keyword" } }, error: null });
      await expect(getSearchMode()).resolves.toBe("keyword");
      expect(invoke).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
