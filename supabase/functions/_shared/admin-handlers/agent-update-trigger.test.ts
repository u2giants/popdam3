import { describe, expect, it } from "vitest";
import { shouldFlagWindowsRenderers } from "../agent-update-scope.ts";

describe("shouldFlagWindowsRenderers (#1093)", () => {
  it("never flags Windows renderers for a check", () => {
    expect(shouldFlagWindowsRenderers("check", "bridge")).toBe(false);
    expect(shouldFlagWindowsRenderers("check", undefined)).toBe(false);
  });
  it("does not flag Windows renderers for a bridge-only apply", () => {
    expect(shouldFlagWindowsRenderers("apply", "bridge")).toBe(false);
  });
  it("keeps flagging Windows renderers for an unscoped apply", () => {
    expect(shouldFlagWindowsRenderers("apply", undefined)).toBe(true);
  });
});
