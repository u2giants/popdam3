/**
 * Is this search exactly one of our real product codes (style group SKUs)?
 *
 * A code has no visual meaning, so the picture leg can only return lookalikes.
 * This asks the catalog rather than guessing from the query's shape: only a
 * code that exists counts, and no format rule is involved.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface ProductCodeLookup {
  data: unknown[] | null;
  error: { message: string } | null;
}

/** Fails open: a lookup error must not change results, only skip this check. */
export async function isExactProductCode(
  query: string,
  lookup: (ilikePattern: string) => PromiseLike<ProductCodeLookup>,
): Promise<boolean> {
  const code = query.trim();
  if (!code) return false;
  try {
    const { data, error } = await lookup(escapeLikePattern(code));
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
