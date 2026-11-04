import { describe, expect, it } from "vitest";
import { shouldSkipPath } from "../../packages/path-filters/index";

describe("shouldSkipPath", () => {
  it("does not apply folder prefix rules to filenames", () => {
    expect(shouldSkipPath("Decor/#1 Dad.psd")).toBe(false);
    expect(shouldSkipPath("Decor/@home.ai")).toBe(false);
  });
  it("still excludes hidden files and excluded folders", () => {
    expect(shouldSkipPath("Decor/._art.psd")).toBe(true);
    expect(shouldSkipPath("Decor/@eaDir/art.psd")).toBe(true);
    expect(shouldSkipPath("#archive/art.psd")).toBe(true);
  });
});
