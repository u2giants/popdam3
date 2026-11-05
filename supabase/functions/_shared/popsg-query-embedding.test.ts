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
