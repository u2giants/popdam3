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
  /** #1430: exact whole-group file total for style-group searches; null when not reported. */
  total_group_files?: number | null;
};

/**
 * Shape the database answer into one response.
 *
 * Total semantics (owner ruling: numbers must be exact, never estimates): a single-variant search
 * gets exactly one page from search_dam_documents; a multi-variant search gets one page from
 * search_dam_documents_multi, which unions, deduplicates, pages and counts in the database
 * (popdam3#1430 Step 7). Either way there is one page and its totals are passed through as they
 * are. Several pages are still merged by best rank for callers that send them, but their total is
 * only a floor and the app no longer sends several.
 */
export function mergeSearchPages(pages: SearchPage[]): SearchPage {
  const byKey = new Map<string, SearchHit>();
  let totalCount = 0;
  let hasMore = false;
  let facets: Record<string, unknown> = {};
  let totalGroupFiles: number | null = pages.length > 0 ? (pages[0].total_group_files ?? null) : null;
  for (const page of pages) {
    if (page.total_count > totalCount) {
      totalCount = page.total_count;
      facets = page.facets;
      totalGroupFiles = page.total_group_files ?? null;
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
  // search_dam_documents' own rank is the order (#1037): it already blends the keyword,
  // picture and text-meaning legs. Recomputing a picture-lead blend here dropped the
  // text-meaning score and put a planter above the framed Marie products.
  const results = [...byKey.values()]
    .sort(
      (a, b) => (b.rank ?? 0) - (a.rank ?? 0) || a.document_type.localeCompare(b.document_type) || a.entity_id.localeCompare(b.entity_id),
    );
  // Never report fewer documents than the rows returned on this page: the
  // union of variant windows can exceed every single variant's total.
  const total_count = Math.max(totalCount, results.length);
  return { results, total_count, has_more: hasMore, facets, total_group_files: totalGroupFiles };
}
