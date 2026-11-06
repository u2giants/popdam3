import { isProductCodeSearch, type ProductCodeLookup } from "./product-code.ts";
import type { SpellingResult } from "./search-spelling.ts";

/**
 * Decide intentional keyword-only queries separately from embedding failures.
 * Picture vectors cannot read typos, so the corrected words are embedded, and words
 * with no catalog meaning (gibberish) skip the picture leg, as DAM search does.
 */
export async function getPopSGQueryEmbedding(
  mode: "keyword" | "hybrid",
  query: string,
  lookup: (pattern: string) => PromiseLike<ProductCodeLookup>,
  embed: (query: string) => Promise<number[] | null>,
  spelling: (query: string) => Promise<SpellingResult> = async () => ({ corrected: null, meaningful: true }),
) {
  const productCode = mode === "hybrid" && !!query && await isProductCodeSearch(query, lookup);
  const wanted = mode === "hybrid" && !!query && !productCode;
  const checked = wanted ? await spelling(query) : null;
  if (checked && !checked.meaningful) return { embedding: null, skipped: "not_meaningful" };
  const embedding = wanted ? await embed(checked?.corrected ?? query) : null;
  if (wanted && !embedding) throw new Error("Search unavailable. Please try again.");
  return { embedding, skipped: productCode ? "product_code" : null };
}
