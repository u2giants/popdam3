import { isProductCodeSearch, type ProductCodeLookup } from "./product-code.ts";
import { editDistance, type SpellingResult } from "./search-spelling.ts";

/**
 * Decide intentional keyword-only queries separately from embedding failures.
 * Meaning-based PopSG search uses the query's text vector only to recognise the
 * licensor or property it means (nameExpansion). Picture matches are not sent:
 * they stop near 100 files and cost ~2 s, and lost to names-only on the judged
 * set (2026-11-05, #706). Words with no catalog meaning (gibberish) get no help.
 * Spelling and embedding run side by side so the help adds no serial wait.
 */
export async function getPopSGQueryEmbedding(
  mode: "keyword" | "hybrid",
  query: string,
  lookup: (pattern: string) => PromiseLike<ProductCodeLookup>,
  embed: (query: string) => Promise<number[] | null>,
  spelling: (query: string) => Promise<SpellingResult> = async () => ({ corrected: null, meaningful: true }),
) {
  const productCode = mode === "hybrid" && !!query && await isProductCodeSearch(query, lookup);
  if (mode !== "hybrid" || !query || productCode) return { embedding: null, skipped: productCode ? "product_code" : null };
  const [checked, embedding] = await Promise.all([spelling(query), embed(query)]);
  if (!checked.meaningful) return { embedding: null, skipped: "not_meaningful" };
  if (!embedding) throw new Error("Search unavailable. Please try again.");
  return { embedding, skipped: null };
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
 * The licensor or property a query clearly means, from its text vector, added to
 * the keyword words to reach the whole property ("harry poter" -> Harry Potter).
 * Null when no name stands out.
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

/**
 * What to search instead when the words as typed find nothing in PopSG: every
 * word must match there, so one extra or misspelt word empties the page
 * ("chase paw patrol" when the files only say Paw Patrol; "spidermen").
 * The longest known name inside the query wins; otherwise each word moves to
 * its nearest known word. Null when neither changes the query. The caller uses
 * a "spelling" or "narrowed_name" fallback only after an empty first search, so
 * it can never narrow or reorder results that already exist.
 *
 * Kind "name" (#887): a known name plus words that are not product words
 * ("amazing hero"). The search lists the name's own files after the files that
 * match every word. A known name plus a product word ("hero canvas") is a
 * deliberate narrowing and stays "narrowed_name": nothing is added to it.
 */
export type PopSGFallbackKind = "name" | "narrowed_name" | "spelling";
export function zeroResultFallback(
  query: string,
  knownNames: Set<string>,
  vocabulary: Map<string, number> | null,
  productWords: ReadonlySet<string> = new Set(),
): { fallback: string; kind: PopSGFallbackKind } | null {
  const words = query.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length || words.length > 8) return null;
  for (let size = words.length - 1; size >= 1; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      const phrase = words.slice(start, start + size).join(" ");
      if (phrase.length < 4 || !knownNames.has(phrase)) continue;
      const others = [...words.slice(0, start), ...words.slice(start + size)];
      return { fallback: phrase, kind: others.some((word) => productWords.has(word)) ? "narrowed_name" : "name" };
    }
  }
  if (!vocabulary) return null;
  const corrected = words.map((word) => nearestKnownWord(word, knownNames, vocabulary) ?? word).join(" ");
  return corrected !== words.join(" ") ? { fallback: corrected, kind: "spelling" } : null;
}

/**
 * Nearest other known word. On a tie a word that is a whole name by itself wins
 * over one that only exists as two name words joined ("spidermen" -> spiderman,
 * not the joined form of a two-word character name), then alphabetical.
 */
function nearestKnownWord(word: string, knownNames: Set<string>, vocabulary: Map<string, number>): string | null {
  if (word.length < 5 || !/^[a-z]+$/.test(word)) return null;
  const max = word.length >= 8 ? 2 : 1;
  let best: string | null = null, bestDistance = max + 1, bestWhole = false;
  for (const candidate of vocabulary.keys()) {
    if (candidate === word) continue;
    const distance = editDistance(word, candidate, max);
    if (distance > max || distance > bestDistance) continue;
    const whole = knownNames.has(candidate);
    if (distance < bestDistance || (whole && !bestWhole) || (whole === bestWhole && candidate < best!)) {
      best = candidate;
      bestDistance = distance;
      bestWhole = whole;
    }
  }
  return best;
}
