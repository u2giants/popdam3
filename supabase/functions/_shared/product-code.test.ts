import { describe, expect, it } from "vitest";
import { escapeLikePattern, isExactProductCode } from "./product-code.ts";

describe("isExactProductCode", () => {
  it("is true only when the catalog has that code", async () => {
    expect(await isExactProductCode("VDD83MVSP01", async () => ({ data: [{ id: "x" }], error: null }))).toBe(true);
    expect(await isExactProductCode("spiderman", async () => ({ data: [], error: null }))).toBe(false);
  });

  it("does not query for a blank search", async () => {
    let called = false;
    expect(
      await isExactProductCode("  ", async () => {
        called = true;
        return { data: [], error: null };
      }),
    ).toBe(false);
    expect(called).toBe(false);
  });

  it("escapes wildcards so a search cannot match by pattern", async () => {
    let seen = "";
    await isExactProductCode("VD%_\\1", async (pattern) => {
      seen = pattern;
      return { data: [], error: null };
    });
    expect(seen).toBe("VD\\%\\_\\\\1");
    expect(escapeLikePattern("ABC")).toBe("ABC");
  });

  it("fails open on a lookup error or throw", async () => {
    expect(await isExactProductCode("A1", async () => ({ data: null, error: { message: "down" } }))).toBe(false);
    expect(
      await isExactProductCode("A1", async () => {
        throw new Error("down");
      }),
    ).toBe(false);
  });
});
