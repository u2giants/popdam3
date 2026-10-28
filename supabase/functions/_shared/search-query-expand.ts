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
const PRODUCT_PHRASES: ReadonlyArray<{ pattern: RegExp; replacements: readonly string[] }> = [
  { pattern: /\bfloor\s*coverings?\b/gi, replacements: ["mat", "rug"] },
  { pattern: /\bfloorcoverings?\b/gi, replacements: ["mat", "rug"] },
  { pattern: /\bfloor\s*mats?\b/gi, replacements: ["mat"] },
  { pattern: /\bdoor\s*mats?\b/gi, replacements: ["mat"] },
  { pattern: /\bdoormats?\b/gi, replacements: ["mat"] },
  { pattern: /\barea\s*rugs?\b/gi, replacements: ["rug"] },
  { pattern: /\bthrow\s*rugs?\b/gi, replacements: ["rug"] },
  { pattern: /\bkitchen\s*mats?\b/gi, replacements: ["mat"] },
  { pattern: /\bcoir\s*mats?\b/gi, replacements: ["mat"] },
  // Bare "coir" means a coir door mat; "coir mat" above wins when both appear.
  { pattern: /\bcoir\b(?!\s*mats?\b)/gi, replacements: ["coir mat"] },
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
  const query = normalizeSpaces(rawQuery);
  if (!query) return [];

  const out = new Set<string>([query]);
  for (const { pattern, replacements } of PRODUCT_PHRASES) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const rx = new RegExp(pattern.source, flags);
    if (!rx.test(query)) continue;
    rx.lastIndex = 0;
    for (const replacement of replacements) {
      const rewritten = normalizeSpaces(query.replace(rx, replacement));
      if (rewritten) out.add(rewritten);
    }
  }
  return [...out];
}
