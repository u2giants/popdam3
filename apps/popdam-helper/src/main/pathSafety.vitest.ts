import { describe, expect, it } from "vitest";
import { join, resolve } from "path";
import { joinWithinRoot, safePathSegment } from "./pathSafety";

describe("safePathSegment", () => {
  it("accepts ordinary filenames", () => {
    expect(safePathSegment("Mickey Tee v2.psd")).toBe("Mickey Tee v2.psd");
    expect(safePathSegment("..hidden.ai")).toBe("..hidden.ai");
    expect(safePathSegment("3f2a-uuid", "checkout id")).toBe("3f2a-uuid");
  });
  it("rejects traversal, separators, drives and device names", () => {
    for (const bad of [
      "", ".", "..", "../x.bat", "..\\..\\Startup\\x.bat", "a/b.psd", "a\\b.psd",
      "C:x.bat", "evil\u0000.psd", "line\nbreak", "CON", "nul.txt", "x".repeat(256),
    ]) {
      expect(() => safePathSegment(bad), bad).toThrow(/Unsafe/);
    }
  });
});

describe("joinWithinRoot", () => {
  const root = resolve("/tmp/helper-root");
  it("joins paths that stay inside the root", () => {
    expect(joinWithinRoot(root, "a/b.psd")).toBe(join(root, "a", "b.psd"));
    expect(joinWithinRoot(root, "")).toBe(root);
  });
  it("rejects escapes", () => {
    expect(() => joinWithinRoot(root, "../x")).toThrow(/escapes/);
    expect(() => joinWithinRoot(root, "a/../../x")).toThrow(/escapes/);
    expect(() => joinWithinRoot(root, "/etc/passwd")).toThrow(/escapes/);
  });
});
