import { describe, expect, it } from "vitest";
import { expandProductPhrases } from "./search-query-expand.ts";

describe("expandProductPhrases", () => {
  it("keeps the original query first", () => {
    expect(expandProductPhrases("spiderman floor covering")[0]).toBe("spiderman floor covering");
  });

  it("expands floor covering to mat and rug", () => {
    const variants = expandProductPhrases("spiderman floor covering");
    expect(variants).toContain("spiderman mat");
    expect(variants).toContain("spiderman rug");
  });

  it("expands floor coverings and no-space floorcovering", () => {
    expect(expandProductPhrases("deadpool floor coverings")).toContain("deadpool mat");
    expect(expandProductPhrases("deadpool floorcovering")).toContain("deadpool mat");
  });

  it("expands door mat / carpet phrases", () => {
    expect(expandProductPhrases("spiderman door mat")).toContain("spiderman mat");
    expect(expandProductPhrases("mickey carpet")).toContain("mickey rug");
  });

  it("does not rewrite single-word mat/rug queries", () => {
    expect(expandProductPhrases("spiderman mat")).toEqual(["spiderman mat"]);
    expect(expandProductPhrases("spiderman rug")).toEqual(["spiderman rug"]);
  });

  it("ignores blank queries", () => {
    expect(expandProductPhrases("   ")).toEqual([]);
  });
});

describe("expandProductPhrases coir", () => {
  it("treats bare coir as a coir or outdoor door mat", () => {
    expect(expandProductPhrases("spiderman coir")).toEqual([
      "spiderman coir",
      "spiderman coir mat",
      "spiderman outdoor mat",
    ]);
  });
  it("leaves coir mat to the existing rule", () => {
    expect(expandProductPhrases("spiderman coir mat")).toEqual(["spiderman coir mat", "spiderman mat"]);
  });
});
