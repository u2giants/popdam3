import type { SortField } from "@/types/assets";

/**
 * The sort the library uses: the user's pick, otherwise Relevance while a search is
 * typed and Last modified when browsing (#1037).
 */
export function effectiveSortField(chosen: SortField | null, search: string): SortField {
  if (chosen) return chosen;
  return search.trim() ? "relevance" : "modified_at";
}
