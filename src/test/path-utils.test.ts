import { describe, expect, it } from "vitest";
import { normalizeRelativePath } from "../lib/path-utils";

describe("normalizeRelativePath", () => {
  it("normalizes separators and trims edges", () => {
    expect(normalizeRelativePath("Decor\\Art//final.psd")).toBe("Decor/Art/final.psd");
    expect(normalizeRelativePath("/Decor/final.psd/")).toBe("Decor/final.psd");
  });

  it("allows filenames that merely contain dots", () => {
    expect(normalizeRelativePath("Decor/Final..v2.psd")).toBe("Decor/Final..v2.psd");
    expect(normalizeRelativePath("Decor/v1...psd")).toBe("Decor/v1...psd");
  });

  it("rejects any .. path segment", () => {
    expect(() => normalizeRelativePath("Decor/../secret.psd")).toThrow(/traversal/);
    expect(() => normalizeRelativePath("..")).toThrow(/traversal/);
    expect(() => normalizeRelativePath("a/b/../../c")).toThrow(/traversal/);
  });
});
