import { describe, expect, it } from "vitest";
import { shouldSkipFolder, shouldSkipPath } from "../../packages/path-filters/index";

describe("shouldSkipPath", () => {
  it("does not apply folder prefix rules to filenames", () => {
    expect(shouldSkipPath("Decor/#1 Dad.psd")).toBe(false);
    expect(shouldSkipPath("Decor/@home.ai")).toBe(false);
    expect(shouldSkipPath("Decor/$promo.tif")).toBe(false);
  });
  it("still excludes hidden files and excluded folders", () => {
    expect(shouldSkipPath("Decor/._art.psd")).toBe(true);
    expect(shouldSkipPath("Decor/@eaDir/art.psd")).toBe(true);
    expect(shouldSkipPath("#archive/art.psd")).toBe(true);
    expect(shouldSkipPath("Decor/node_modules/art.psd")).toBe(true);
  });
});

describe("shouldSkipFolder", () => {
  it("applies folder rules to a bare directory name", () => {
    // Directory walkers pass one name per entry; that name is a folder,
    // never a file, so the full folder rule set must apply here.
    expect(shouldSkipFolder("@eaDir")).toBe(true);
    expect(shouldSkipFolder("#recycle")).toBe(true);
    expect(shouldSkipFolder("$recycle.bin")).toBe(true);
    expect(shouldSkipFolder("node_modules")).toBe(true);
    expect(shouldSkipFolder("_old")).toBe(true);
    expect(shouldSkipFolder("Decor")).toBe(false);
  });
});
