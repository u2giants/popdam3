import { describe, expect, it } from "vitest";
import { canCompleteSgCrawl, countAcceptedExtensions, evaluateSgDropGuard } from "./sg-crawl-state";

const config = { absoluteDrop: 1_000, percentageDrop: 0.01, minimumPriorCount: 10_000 };

describe("countAcceptedExtensions", () => {
  it("tracks received, accepted, and rejected separately", () => {
    const result = countAcceptedExtensions([
      { file_extension: "PSD" },
      { file_extension: "pdf" },
      { file_extension: "zip" },
      {},
    ], new Set(["psd", "pdf"]));
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toBe(2);
  });
});

describe("evaluateSgDropGuard", () => {
  it("blocks empty and inaccessible crawls", () => {
    expect(evaluateSgDropGuard(0, 200_000, 0, config).reason).toBe("empty");
    expect(evaluateSgDropGuard(199_999, 200_000, 1, config).reason).toBe("inaccessible");
  });

  it("allows ordinary variance", () => {
    expect(evaluateSgDropGuard(219_700, 219_900, 0, config).blocked).toBe(false);
  });

  it("blocks suspicious nonzero drops by absolute or percentage threshold", () => {
    expect(evaluateSgDropGuard(218_500, 219_900, 0, config).reason).toBe("absolute_drop");
    expect(evaluateSgDropGuard(9_850, 9_999, 0, { ...config, minimumPriorCount: 1 }).reason).toBe("percentage_drop");
  });
});

describe("canCompleteSgCrawl", () => {
  it("requires finished reconciliation and fresh aggregates", () => {
    expect(canCompleteSgCrawl("reconciling", { remaining: 0 }, true)).toBe(false);
    expect(canCompleteSgCrawl("refreshing", { remaining: 1 }, true)).toBe(false);
    expect(canCompleteSgCrawl("refreshing", { remaining: 0 }, false)).toBe(false);
    expect(canCompleteSgCrawl("refreshing", { remaining: 0 }, true)).toBe(true);
  });
});
