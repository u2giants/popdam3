/**
 * Is this search one of our real product codes (style group SKUs), whole or its start?
 *
 * A code has no visual meaning, so the picture leg can only return lookalikes.
 * This asks the catalog rather than guessing from the query's shape: only a
 * code that exists counts, and no format rule is involved.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Four or more characters also match the start of a code (VDD83). Shorter text
 * must match whole: three-letter code starts include real words (CAN, SPA, NUT).
 */
export const MIN_PARTIAL_CODE_LENGTH = 4;

export interface ProductCodeLookup {
  data: unknown[] | null;
  error: { message: string } | null;
}

/** Fails open: a lookup error must not change results, only skip this check. */
export async function isProductCodeSearch(
  query: string,
  lookup: (ilikePattern: string) => PromiseLike<ProductCodeLookup>,
): Promise<boolean> {
  const code = query.trim();
  if (!code) return false;
  try {
    const { data, error } = await lookup(
      escapeLikePattern(code) + (code.length >= MIN_PARTIAL_CODE_LENGTH ? "%" : ""),
    );
    if (error) {
      console.error("product code lookup failed; searching normally", error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (e) {
    console.error("product code lookup failed; searching normally", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Retain picture guesses for the established, unrecognized product-code intent.
 * This is only a positive picture hint AFTER a catalog miss. It never establishes
 * identity or turns picture search off. Arbitrary mixed letters/digits are not
 * sufficient: require the recorded three-letter/two-digit/four-letter/two-digit
 * grouping, as distinct from true nonsense.
 */
export function keepUnknownCodePictures(query: string): boolean {
  return /^[a-z]{3}\d{2}[a-z]{4}\d{2}$/i.test(query.trim());
}
