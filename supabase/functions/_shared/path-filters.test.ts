/**
 * Unit tests for Deno-compatible path filters
 */

import {
  isExcludedDirectory,
  isExcludedRelativePath,
  isJunkFilename,
  isJunkPrefix,
  isMacResourceFork,
  isPdfStyleGuide,
  JUNK_FILENAMES,
  PDF_KEYWORD_EXCLUSIONS,
  shouldSkipFile,
} from "./path-filters.ts";

describe("JUNK_FILENAMES", () => {
  it("should contain expected junk filenames", () => {
    expect(JUNK_FILENAMES.has(".DS_Store")).toBe(true);
    expect(JUNK_FILENAMES.has("Thumbs.db")).toBe(true);
    expect(JUNK_FILENAMES.has("desktop.ini")).toBe(true);
  });
});

describe("isJunkFilename", () => {
  it("should return true for exact junk filenames", () => {
    expect(isJunkFilename(".DS_Store")).toBe(true);
    expect(isJunkFilename("Thumbs.db")).toBe(true);
    expect(isJunkFilename("desktop.ini")).toBe(true);
  });

  it("should return false for non-junk filenames", () => {
    expect(isJunkFilename("art.psd")).toBe(false);
    expect(isJunkFilename("photo.jpg")).toBe(false);
    expect(isJunkFilename("document.pdf")).toBe(false);
  });

  it("should return true for Office temp files matching glob pattern", () => {
    expect(isJunkFilename("~$budget.xlsx")).toBe(true);
    expect(isJunkFilename("~$report.docx")).toBe(true);
    expect(isJunkFilename("~temp.pptx")).toBe(true);
  });
});

describe("isJunkPrefix", () => {
  it("should return true for macOS resource forks", () => {
    expect(isJunkPrefix("._metadata")).toBe(true);
    expect(isJunkPrefix("._thumb")).toBe(true);
  });

  it("should return true for temp file prefixes", () => {
    expect(isJunkPrefix("~$file")).toBe(true);
    expect(isJunkPrefix("~backup")).toBe(true);
  });

  it("should return false for normal filenames", () => {
    expect(isJunkPrefix("art.psd")).toBe(false);
    expect(isJunkPrefix("photo.jpg")).toBe(false);
  });
});

describe("isMacResourceFork", () => {
  it("should return true for files starting with ._", () => {
    expect(isMacResourceFork("._foo")).toBe(true);
    expect(isMacResourceFork("._.DS_Store")).toBe(true);
  });

  it("should return false for non-resource forks", () => {
    expect(isMacResourceFork(".gitignore")).toBe(false);
    expect(isMacResourceFork("art.psd")).toBe(false);
  });
});

describe("isExcludedDirectory", () => {
  it("should return true for macOS __MACOSX", () => {
    expect(isExcludedDirectory("__MACOSX")).toBe(true);
    expect(isExcludedDirectory("__MacOSX")).toBe(false); // Case-sensitive
  });

  it("should return true for __OLD and ___OLD directories", () => {
    expect(isExcludedDirectory("__OLD")).toBe(true);
    expect(isExcludedDirectory("___OLD")).toBe(true);
    expect(isExcludedDirectory("_OLD")).toBe(false);
  });

  it("should return true for version control directories", () => {
    expect(isExcludedDirectory(".git")).toBe(true);
    expect(isExcludedDirectory(".svn")).toBe(true);
    expect(isExcludedDirectory(".hg")).toBe(true);
  });

  it("should return true for NODE_MODULES", () => {
    expect(isExcludedDirectory("node_modules")).toBe(true);
    expect(isExcludedDirectory("NODE_MODULES")).toBe(true);
  });

  it("should return true for temp directories", () => {
    expect(isExcludedDirectory(".temp")).toBe(true);
    expect(isExcludedDirectory("temp")).toBe(true);
    expect(isExcludedDirectory(".trash")).toBe(true);
  });

  it("should return false for normal directories", () => {
    expect(isExcludedDirectory("Decor")).toBe(false);
    expect(isExcludedDirectory("Projects")).toBe(false);
    expect(isExcludedDirectory("Frozen")).toBe(false);
  });
});

describe("isExcludedRelativePath", () => {
  it("should return true if path contains __MACOSX", () => {
    expect(isExcludedRelativePath("Decor/Projects/__MACOSX/file.psd")).toBe(true);
  });

  it("should return true if path contains __OLD", () => {
    expect(isExcludedRelativePath("Decor/__OLD/file.psd")).toBe(true);
  });

  it("should return true if path contains node_modules", () => {
    expect(isExcludedRelativePath("node_modules/package/file.psd")).toBe(true);
  });

  it("should return false for normal paths", () => {
    expect(isExcludedRelativePath("Decor/Projects/Disney/Frozen/art.psd")).toBe(false);
  });

  it("should check all path segments", () => {
    expect(isExcludedRelativePath("Decor/Projects/.git/config")).toBe(true);
    expect(isExcludedRelativePath("Decor/.svn/backup")).toBe(true);
  });
});

describe("shouldSkipFile", () => {
  it("should return true for junk prefix files", () => {
    expect(shouldSkipFile("._metadata")).toBe(true);
    expect(shouldSkipFile("~$temp.doc")).toBe(true);
  });

  it("should return true for exact junk filenames", () => {
    expect(shouldSkipFile(".DS_Store")).toBe(true);
    expect(shouldSkipFile("Thumbs.db")).toBe(true);
  });

  it("should return true when relativePath contains excluded directory", () => {
    expect(shouldSkipFile("art.psd", "Decor/__MACOSX/file.psd")).toBe(true);
    expect(shouldSkipFile("art.psd", "node_modules/package/file.psd")).toBe(true);
  });

  it("should return false for normal files", () => {
    expect(shouldSkipFile("art.psd")).toBe(false);
    expect(shouldSkipFile("photo.jpg")).toBe(false);
    expect(shouldSkipFile("design.ai")).toBe(false);
  });
});

describe("PDF_KEYWORD_EXCLUSIONS", () => {
  it("should contain style guide keywords", () => {
    expect(PDF_KEYWORD_EXCLUSIONS.has("cover")).toBe(true);
    expect(PDF_KEYWORD_EXCLUSIONS.has("styleguide")).toBe(true);
    expect(PDF_KEYWORD_EXCLUSIONS.has("style-guide")).toBe(true);
    expect(PDF_KEYWORD_EXCLUSIONS.has("brand guide")).toBe(true);
  });
});

describe("isPdfStyleGuide", () => {
  it("should return true for filenames with style guide keywords", () => {
    expect(isPdfStyleGuide("styleguide.pdf")).toBe(true);
    expect(isPdfStyleGuide("Style Guide.pdf")).toBe(true);
    expect(isPdfStyleGuide("brand-guide.pdf")).toBe(true);
    expect(isPdfStyleGuide("Disney Brand Guidelines.pdf")).toBe(true);
  });

  it("should return false for normal PDF filenames", () => {
    expect(isPdfStyleGuide("art.pdf")).toBe(false);
    expect(isPdfStyleGuide("tech_pack.pdf")).toBe(false);
    expect(isPdfStyleGuide("HXP8RNBHN02.pdf")).toBe(false);
  });

  it("should be case-insensitive", () => {
    expect(isPdfStyleGuide("STYLEGUIDE.PDF")).toBe(true);
    expect(isPdfStyleGuide("Brand Guide.pdf")).toBe(true);
  });
});
