/**
 * Prefer rows that match the query's concept groups (character + product type)
 * over rows that only look like the product via picture similarity.
 *
 * Albert 2026-10-25: "spiderman floor covering" must return Spider-Man mats,
 * not every floor covering (Deadpool mats) and not every Spider-Man item
 * (clocks, hampers). Picture similarity alone cannot make that distinction.
 */

const PRODUCT_RX = /\b(mat|mats|rug|rugs|carpet|carpets|floor|floors|covering|coverings|coir|doormat)\b/i;

/** Character synonym family so "spiderman" query matches "Spider-Man" rows. */
function characterFamily(query: string): RegExp | null {
  const q = query.toLowerCase();
  if (/spider/.test(q)) return /\b(spider[-\s]?man|spiderman|spidey)\b/i;
  if (/deadpool/.test(q)) return /\bdeadpool\b/i;
  if (/mickey/.test(q)) return /\bmickey\b/i;
  if (/minnie/.test(q)) return /\bminnie\b/i;
  if (/stitch/.test(q)) return /\bstitch\b/i;
  if (/batman/.test(q)) return /\bbatman\b/i;
  if (/hulk/.test(q)) return /\bhulk\b/i;
  if (/wolverine/.test(q)) return /\bwolverine\b/i;
  if (/iron\s?man/.test(q)) return /\biron[-\s]?man\b/i;
  if (/star\s?wars/.test(q)) return /\bstar[-\s]?wars\b/i;
  return null;
}

/**
 * Score how many query concept groups the row's text satisfies.
 * Higher is better. Used AFTER hybrid rank so picture matches that miss
 * the named character cannot outrank true hits.
 */
export function conceptMatchScore(query: string, text: string): number {
  const q = query.trim();
  if (!q || !text) return 0;
  let score = 0;
  const family = characterFamily(q);
  if (family) score += family.test(text) ? 2 : 0;
  if (PRODUCT_RX.test(q) && PRODUCT_RX.test(text)) score += 2;
  return score;
}

/**
 * Re-order rows so concept-complete matches lead, then keep prior rank order.
 */
export function sortByConceptThenRank<T>(
  rows: T[],
  query: string,
  textOf: (row: T) => string,
): T[] {
  const q = query.trim();
  if (!q || rows.length < 2) return rows;
  const family = characterFamily(q);
  const wantsProduct = PRODUCT_RX.test(q);
  if (!family && !wantsProduct) return rows;

  return rows
    .map((row, index) => ({ row, index, score: conceptMatchScore(q, textOf(row) ?? "") }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.row);
}
