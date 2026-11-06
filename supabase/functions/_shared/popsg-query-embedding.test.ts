import { expect, it } from "vitest";
import { getPopSGQueryEmbedding } from "./popsg-query-embedding.ts";

it("PopSG hybrid awaits the catalog and embeds ordinary words", async () => {
  let calls = 0;
  const result = await getPopSGQueryEmbedding("hybrid", "friendly animal", async () => ({ data: [], error: null }), () => {
    calls++;
    return Promise.resolve([1]);
  });
  expect(calls).toBe(1);
  expect(result).toEqual({ embedding: [1], skipped: null });
});
it("PopSG product codes intentionally skip embedding", async () => {
  const result = await getPopSGQueryEmbedding("hybrid", "TEST123", async () => ({ data: [{ id: "1" }], error: null }), () => {
    throw new Error("must not embed");
  });
  expect(result).toEqual({ embedding: null, skipped: "product_code" });
});
it("PopSG keyword mode never calls the catalog or embedding service", async () => {
  const result = await getPopSGQueryEmbedding("keyword", "words", () => {
    throw new Error("must not lookup");
  }, () => {
    throw new Error("must not embed");
  });
  expect(result).toEqual({ embedding: null, skipped: null });
});
it("PopSG hybrid embedding outage fails rather than returning keyword results", async () => {
  await expect(getPopSGQueryEmbedding("hybrid", "words", async () => ({ data: [], error: null }), () => Promise.resolve(null)))
    .rejects.toThrow("Search unavailable");
});
it("PopSG hybrid embeds the corrected words", async () => {
  const seen: string[] = [];
  const result = await getPopSGQueryEmbedding("hybrid", "batmn", async () => ({ data: [], error: null }), (q) => {
    seen.push(q);
    return Promise.resolve([1]);
  }, async () => ({ corrected: "batman", meaningful: true }));
  expect(seen).toEqual(["batman"]);
  expect(result).toEqual({ embedding: [1], skipped: null });
});
it("PopSG hybrid skips pictures for words with no catalog meaning", async () => {
  const result = await getPopSGQueryEmbedding("hybrid", "xqzvplm", async () => ({ data: [], error: null }), () => {
    throw new Error("must not embed");
  }, async () => ({ corrected: null, meaningful: false }));
  expect(result).toEqual({ embedding: null, skipped: "not_meaningful" });
});
it("PopSG name expansion needs a clear winner", async () => {
  const { nameExpansion } = await import("./popsg-query-embedding.ts");
  const names = { names: ["Harry Potter", "Harry Potter TV Series", "Mickey"], vectors: [[1, 0, 0], [0.8, 0.6, 0], [0, 0, 1]] };
  expect(nameExpansion([1, 0.05, 0], names)).toBe("Harry Potter");
  expect(nameExpansion([0.95, 0.31, 0], names)).toBeNull();
  expect(nameExpansion([0.5, 0.5, 0.5], names)).toBeNull();
  expect(nameExpansion(null, names)).toBeNull();
  expect(nameExpansion([1, 0, 0], null)).toBeNull();
});
