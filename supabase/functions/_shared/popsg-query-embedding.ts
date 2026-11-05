import { isProductCodeSearch, type ProductCodeLookup } from "./product-code.ts";

/** Decide intentional keyword-only queries separately from embedding failures. */
export async function getPopSGQueryEmbedding(
  mode: "keyword" | "hybrid",
  query: string,
  lookup: (pattern: string) => PromiseLike<ProductCodeLookup>,
  embed: (query: string) => Promise<number[] | null>,
) {
  const productCode = mode === "hybrid" && !!query && await isProductCodeSearch(query, lookup);
  const needed = mode === "hybrid" && !!query && !productCode;
  const embedding = needed ? await embed(query) : null;
  if (needed && !embedding) throw new Error("Search unavailable. Please try again.");
  return { embedding, skipped: productCode ? "product_code" : null };
}
