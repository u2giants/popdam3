import { describe, expect, it } from "vitest";
import { basenameOf, pickMoveCandidate } from "./move-candidates.js";

describe("basenameOf", () => {
  it("returns the exact basename, whitespace included", () => {
    expect(basenameOf("Decor/a/ x.ai")).toBe(" x.ai");
    expect(basenameOf("Decor/a/x.ai")).toBe("x.ai");
    expect(basenameOf("x.ai ")).toBe("x.ai ");
  });
});

describe("pickMoveCandidate", () => {
  const twins = [
    { relative_path: "Decor/sku/ x.ai", id: "space" },
    { relative_path: "Decor/sku/x.ai", id: "plain" },
    { relative_path: "Decor/sku/PRODUCTION/x.ai", id: "prod" },
    { relative_path: "Decor/sku/x.psd", id: "other-name" },
  ];

  it("does not treat a whitespace twin as a move (the flip-flop case, #1233)", () => {
    const rows = [
      { relative_path: "Decor/sku/ x.ai", id: "space" },
      { relative_path: "Decor/sku/x.ai", id: "plain" },
    ];
    expect(pickMoveCandidate(rows, "Decor/elsewhere/ x.ai")?.id).toBe("space");
    expect(pickMoveCandidate(rows, "Decor/elsewhere/x.ai")?.id).toBe("plain");
    expect(pickMoveCandidate(twins, "Decor/elsewhere/x.ai")).toBeNull();
  });

  it("ignores same-hash rows with different basenames", () => {
    const rows = [
      { relative_path: "Decor/a/sewn-in label.ai", id: "a" },
      { relative_path: "Decor/b/sewn-in label.ai", id: "b" },
      { relative_path: "Decor/c/other.ai", id: "c" },
    ];
    expect(pickMoveCandidate(rows, "Decor/d/other.ai")?.id).toBe("c");
  });

  it("returns null when several rows share the basename (ambiguous)", () => {
    expect(pickMoveCandidate(twins, "Decor/new/x.ai")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(pickMoveCandidate(twins, "Decor/new/zz.ai")).toBeNull();
    expect(pickMoveCandidate([], "Decor/new/zz.ai")).toBeNull();
  });
});
