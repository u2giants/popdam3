import { describe, expect, it } from "vitest";
import { escapeLikePattern, isProductCodeSearch, keepUnknownCodePictures } from "./product-code.ts";

describe("isProductCodeSearch", () => {
  it("is true only when the catalog has that code", async () => {
    expect(await isProductCodeSearch("VDD83MVSP01", async () => ({ data: [{ id: "x" }], error: null }))).toBe(true);
    expect(await isProductCodeSearch("spiderman", async () => ({ data: [], error: null }))).toBe(false);
  });

  it("does not query for a blank search", async () => {
    let called = false;
    expect(
      await isProductCodeSearch("  ", async () => {
        called = true;
        return { data: [], error: null };
      }),
    ).toBe(false);
    expect(called).toBe(false);
  });

  it("escapes wildcards so a search cannot match by pattern", async () => {
    let seen = "";
    await isProductCodeSearch("VD%_\\1", async (pattern) => {
      seen = pattern;
      return { data: [], error: null };
    });
    expect(seen).toBe("VD\\%\\_\\\\1%");
    expect(escapeLikePattern("ABC")).toBe("ABC");
  });

  it("matches the start of a code only from four characters", async () => {
    const patterns: string[] = [];
    const lookup = async (pattern: string) => {
      patterns.push(pattern);
      return { data: [], error: null };
    };
    await isProductCodeSearch("VDD83", lookup);
    await isProductCodeSearch("CAN", lookup);
    expect(patterns).toEqual(["VDD83%", "CAN"]);
  });

  it("fails open on a lookup error or throw", async () => {
    expect(await isProductCodeSearch("A1", async () => ({ data: null, error: { message: "down" } }))).toBe(false);
    expect(
      await isProductCodeSearch("A1", async () => {
        throw new Error("down");
      }),
    ).toBe(false);
  });
});

describe("unmatched code picture intent", () => {
  it("retains guesses only for the established grouped intent", () => {
    expect(keepUnknownCodePictures("ABC12DEFG34")).toBe(true);
    expect(keepUnknownCodePictures("abc12defg34")).toBe(true);
    for (const value of ["xqzvplm", "xqz9vplm", "abc123", "yellow character", "12345678901"]) {
      expect(keepUnknownCodePictures(value)).toBe(false);
    }
  });
});
