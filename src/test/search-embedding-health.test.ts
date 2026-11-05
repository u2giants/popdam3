import { describe, expect, it } from "vitest";
import { parseSearchEmbeddingHealth } from "@/lib/search-embedding-health";
const healthy = [
  { corpus: "dam", pending: 0, errored: 3, last_write: null, minutes_since_last_write: null, stale: false },
  { corpus: "popsg", pending: 100, errored: 0, last_write: "2026-11-05T00:00:00Z", minutes_since_last_write: 130, stale: true },
];
describe("search embedding health", () => {
  it("preserves stale and excluded error counts independently", () => {
    expect(parseSearchEmbeddingHealth(healthy)).toEqual(healthy);
  });
  it.each([null, [], [healthy[0]], [healthy[0], healthy[0]], [{ ...healthy[0], pending: null }, healthy[1]], [{ ...healthy[0], last_write: "invalid" }, healthy[1]]])("rejects incomplete data instead of reporting healthy", value => {
    expect(() => parseSearchEmbeddingHealth(value)).toThrow("Search health is unavailable");
  });
});
