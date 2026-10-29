/**
 * Search-page merge for product-phrase query variants (dam-search-ai).
 * Browser and Deno shared code: keep this dependency-free.
 */

export type SearchHit = {
  document_type: string;
  entity_id: string;
  asset_id: string | null;
  style_group_id: string | null;
  keyword_rank: number | null;
  semantic_rank: number | null;
  rank: number;
};

export type SearchPage = {
  results: SearchHit[];
  total_count: number;
  has_more: boolean;
  facets: Record<string, unknown>;
};

/**
 * Merge the per-variant RPC answers into one response.
 *
 * Total semantics (owner ruling: numbers must be exact, never estimates):
 * each variant page's total_count is the EXACT number of documents matching
 * that one variant's query. The merged result list is the deduplicated UNION
 * across variants, and the union's true size is not derivable from per-variant
 * totals alone (it lies between max and sum depending on overlap), because
 * only the page windows — not the full variant sets — are visible here.
 * The merged total is therefore max(largest variant total, merged rows on
 * this page): exact whenever one variant's matches contain the others'
 * (nested sets), never smaller than the rows actually returned, and a floor
 * — never an invented estimate — when variants match disjoint sets. Computing
 * the exact disjoint union would require a DB-side multi-query union
 * (search_dam_documents takes one query per call).
 */
export function mergeSearchPages(pages: SearchPage[]): SearchPage {
  const byKey = new Map<string, SearchHit>();
  let totalCount = 0;
  let hasMore = false;
  let facets: Record<string, unknown> = {};
  for (const page of pages) {
    if (page.total_count > totalCount) {
      totalCount = page.total_count;
      facets = page.facets;
    }
    hasMore = hasMore || page.has_more;
    for (const hit of page.results) {
      const key = `${hit.document_type}:${hit.entity_id}`;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { ...hit });
        continue;
      }
      // Keep the best score from any product-type variant (mat vs rug vs original).
      byKey.set(key, {
        ...prev,
        keyword_rank: Math.max(prev.keyword_rank ?? 0, hit.keyword_rank ?? 0),
        semantic_rank: Math.max(prev.semantic_rank ?? 0, hit.semantic_rank ?? 0),
        rank: Math.max(prev.rank ?? 0, hit.rank ?? 0),
      });
    }
  }
  // Picture match leads: greatest(keyword, semantic + 0.35*keyword).
  // Exact-title keyword stays 1.0+ so SKU search still wins on identifiers.
  const pictureLeadRank = (hit: SearchHit) => {
    const kw = hit.keyword_rank ?? 0;
    const sem = hit.semantic_rank ?? 0;
    return Math.max(kw, sem + 0.35 * kw);
  };
  const results = [...byKey.values()]
    .map((hit) => ({ ...hit, rank: pictureLeadRank(hit) }))
    .sort(
      (a, b) => (b.rank ?? 0) - (a.rank ?? 0) || a.document_type.localeCompare(b.document_type) || a.entity_id.localeCompare(b.entity_id),
    );
  // Never report fewer documents than the rows returned on this page: the
  // union of variant windows can exceed every single variant's total.
  const total_count = Math.max(totalCount, results.length);
  return { results, total_count, has_more: hasMore, facets };
}
