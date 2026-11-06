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

/** Name vectors must beat this cosine and the runner-up by NAME_MARGIN (measured 2026-11-05, #706). */
export const NAME_MATCH_MIN = 0.92;
export const NAME_MATCH_MARGIN = 0.05;

export interface NameVectors {
  names: string[];
  vectors: number[][];
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/**
 * The licensor or property a query clearly means, from its text vector. Picture
 * matches cap near 100 files, so the name is added to the keyword words to reach
 * the whole property ("harry poter" -> Harry Potter). Null when no name stands out.
 */
export function nameExpansion(embedding: number[] | null, names: NameVectors | null): string | null {
  if (!embedding || !names?.names.length) return null;
  let best = -1, second = -1, bestName: string | null = null;
  names.vectors.forEach((vector, index) => {
    const score = cosine(embedding, vector);
    if (score > best) {
      second = best;
      best = score;
      bestName = names.names[index];
    } else if (score > second) second = score;
  });
  return best >= NAME_MATCH_MIN && best - second >= NAME_MATCH_MARGIN ? bestName : null;
}
