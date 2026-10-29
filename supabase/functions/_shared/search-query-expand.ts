/**
 * Product-type phrase expansion for DAM search.
 *
 * Designers say "floor covering" while artwork metadata says "mat", "rug",
 * "door mat", or "coir mat". The SQL synonym table only rewrites whole phrases
 * to a single expansion, so compound queries like "spiderman floor covering"
 * drop real mats. This helper emits extra query strings the search caller runs
 * alongside the original and merges.
 *
 * Keep replacements word-boundary and case-insensitive. Do not touch character
 * names (spiderman is handled by dam_search_synonyms).
 */

/** Map a product-type phrase to the canonical catalog noun(s). */
const PRODUCT_PHRASES: ReadonlyArray<{
  pattern: RegExp;
  replacements: readonly string[];
  /** Replacements that must match by words only, never by picture. */
  keywordOnly?: readonly string[];
}> = [
  { pattern: /\bfloor\s*coverings?\b/gi, replacements: ["mat", "rug"] },
  { pattern: /\bfloorcoverings?\b/gi, replacements: ["mat", "rug"] },
  { pattern: /\bfloor\s*mats?\b/gi, replacements: ["mat"] },
  { pattern: /\bdoor\s*mats?\b/gi, replacements: ["mat"] },
  { pattern: /\bdoormats?\b/gi, replacements: ["mat"] },
  { pattern: /\barea\s*rugs?\b/gi, replacements: ["rug"] },
  { pattern: /\bthrow\s*rugs?\b/gi, replacements: ["rug"] },
  { pattern: /\bkitchen\s*mats?\b/gi, replacements: ["mat"] },
  { pattern: /\bcoir\s*mats?\b/gi, replacements: ["mat"] },
  // Bare "coir" means a door mat; "coir mat" above wins when both appear.
  // "outdoor mat" brings the printed outdoor door mats whose metadata never
  // says coir; plain "mat" would also pull desk mats. Its picture leg would
  // pull any Spider-Man art (toy chests, prints), so it matches by words only.
  { pattern: /\bcoir\b(?!\s*mats?\b)/gi, replacements: ["coir mat", "outdoor mat"], keywordOnly: ["outdoor mat"] },
  { pattern: /\bcarpet\b/gi, replacements: ["rug"] },
];

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Return the original query plus one variant per product-type replacement.
 * Never returns duplicates; always includes the original first when non-blank.
 */
export function expandProductPhrases(rawQuery: string): string[] {
  return expandProductQueries(rawQuery).map((variant) => variant.query);
}

export interface ProductQueryVariant {
  query: string;
  /** False when the variant must skip the picture (semantic) leg. */
  semantic: boolean;
}

/** Like expandProductPhrases, but says which variants may match by picture. */
export function expandProductQueries(rawQuery: string): ProductQueryVariant[] {
  const query = normalizeSpaces(rawQuery);
  if (!query) return [];

  const out = new Map<string, boolean>([[query, true]]);
  for (const { pattern, replacements, keywordOnly } of PRODUCT_PHRASES) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const rx = new RegExp(pattern.source, flags);
    if (!rx.test(query)) continue;
    rx.lastIndex = 0;
    for (const replacement of replacements) {
      const rewritten = normalizeSpaces(query.replace(rx, replacement));
      if (!rewritten) continue;
      const semantic = !keywordOnly?.includes(replacement);
      out.set(rewritten, (out.get(rewritten) ?? false) || semantic);
    }
  }
  return [...out].map(([q, semantic]) => ({ query: q, semantic }));
}
