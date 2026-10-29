import { describe, expect, it } from "vitest";
import { mergeSearchPages, type SearchHit, type SearchPage } from "./dam-search-merge.ts";

function hit(entity_id: string, over: Partial<SearchHit> = {}): SearchHit {
  return {
    document_type: "style_group",
    entity_id,
    asset_id: null,
    style_group_id: entity_id,
    keyword_rank: 0.4,
    semantic_rank: null,
    rank: 0.4,
    ...over,
  };
}

function page(over: Partial<SearchPage> = {}): SearchPage {
  return { results: [], total_count: 0, has_more: false, facets: {}, ...over };
}

describe("mergeSearchPages totals", () => {
  it("passes a single variant's exact total through unchanged", () => {
    const merged = mergeSearchPages([
      page({ results: [hit("a"), hit("b")], total_count: 10, has_more: true, facets: { totalKind: "exact" } }),
    ]);
    expect(merged.total_count).toBe(10);
    expect(merged.has_more).toBe(true);
    expect(merged.facets).toEqual({ totalKind: "exact" });
  });

  it("never reports fewer documents than the merged rows (union can exceed each variant total)", () => {
    // Live defect this pins: 15 merged rows across two variants while every
    // variant total was smaller ("15 rows, total 10").
    const variantA = page({
      results: Array.from({ length: 8 }, (_, i) => hit(`a${i}`)),
      total_count: 8,
      facets: { totalKind: "exact" },
    });
    const variantB = page({
      results: Array.from({ length: 7 }, (_, i) => hit(`b${i}`)),
      total_count: 7,
    });
    const merged = mergeSearchPages([variantA, variantB]);
    expect(merged.results).toHaveLength(15);
    expect(merged.total_count).toBe(15);
  });

  it("keeps the largest variant total when it already covers the merged rows", () => {
    const merged = mergeSearchPages([
      page({ results: [hit("a"), hit("b")], total_count: 40 }),
      page({ results: [hit("c")], total_count: 3 }),
    ]);
    expect(merged.results).toHaveLength(3);
    expect(merged.total_count).toBe(40);
  });

  it("takes facets from the page carrying the largest total", () => {
    const merged = mergeSearchPages([
      page({ results: [hit("a")], total_count: 5, facets: { fileType: { psd: 5 }, totalKind: "exact" } }),
      page({ results: [hit("b")], total_count: 9, facets: { fileType: { ai: 9 }, totalKind: "exact" } }),
    ]);
    expect(merged.total_count).toBe(9);
    expect(merged.facets).toEqual({ fileType: { ai: 9 }, totalKind: "exact" });
  });

  it("ors has_more across variants", () => {
    const merged = mergeSearchPages([
      page({ results: [hit("a")], total_count: 1, has_more: false }),
      page({ results: [hit("b")], total_count: 1, has_more: true }),
    ]);
    expect(merged.has_more).toBe(true);
  });
});

describe("mergeSearchPages rows", () => {
  it("dedupes the same document across variants keeping the best ranks", () => {
    const merged = mergeSearchPages([
      page({ results: [hit("x", { keyword_rank: 0.2, semantic_rank: 0.5, rank: 0.2 })], total_count: 1 }),
      page({ results: [hit("x", { keyword_rank: 0.6, semantic_rank: null, rank: 0.6 })], total_count: 1 }),
    ]);
    expect(merged.results).toHaveLength(1);
    const row = merged.results[0];
    expect(row.keyword_rank).toBe(0.6);
    expect(row.semantic_rank).toBe(0.5);
  });

  it("recomputes rank with the picture-lead blend and sorts by it", () => {
    const keywordOnly = hit("kw", { keyword_rank: 0.9, semantic_rank: null });
    const picture = hit("pic", { keyword_rank: 0.1, semantic_rank: 0.9 });
    const merged = mergeSearchPages([page({ results: [keywordOnly, picture], total_count: 2 })]);
    // picture: max(0.1, 0.9 + 0.35*0.1) = 0.935 beats keywordOnly 0.9.
    expect(merged.results[0].entity_id).toBe("pic");
    expect(merged.results[0].rank).toBeCloseTo(0.935, 5);
    expect(merged.results[1].entity_id).toBe("kw");
  });
});
