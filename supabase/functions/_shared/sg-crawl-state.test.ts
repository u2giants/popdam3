import { describe, expect, it } from "vitest";
import {
  buildSgCrawlCompletionUpdate,
  buildSgIngestCompletionUpdate,
  canCompleteSgCrawl,
  countAcceptedExtensions,
  evaluateSgDropGuard,
  hasMoreSgSearchDocuments,
  runSteppableSgRefresh,
  SG_RECONCILE_BATCH_SIZE,
  shouldResumeSgSearch,
} from "./sg-crawl-state.ts";

describe("buildSgCrawlCompletionUpdate", () => {
  it("makes the durable lifecycle agree with the completed run status", () => {
    expect(buildSgCrawlCompletionUpdate(216_702, [], "2026-09-13T22:11:16.000Z")).toEqual({
      status: "completed",
      lifecycle_state: "completed",
      completed_at: "2026-09-13T22:11:16.000Z",
      files_found: 216_702,
    });
  });
});

const config = { absoluteDrop: 1_000, percentageDrop: 0.01, minimumPriorCount: 10_000 };

describe("buildSgIngestCompletionUpdate", () => {
  it("persists the accepted count before reconciliation can evaluate the run", () => {
    expect(buildSgIngestCompletionUpdate(216_400, 216_374, [], "2026-09-07T12:00:00.000Z")).toEqual({
      files_found: 216_400,
      files_upserted: 216_374,
      ingest_completed_at: "2026-09-07T12:00:00.000Z",
      lifecycle_state: "reconciling",
    });
  });
});

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

describe("hasMoreSgSearchDocuments", () => {
  it("continues while a full bounded batch was synchronized", () => {
    expect(hasMoreSgSearchDocuments(5_000, 5_000)).toBe(true);
    expect(hasMoreSgSearchDocuments(4_999, 5_000)).toBe(false);
    expect(hasMoreSgSearchDocuments(0, 5_000)).toBe(false);
  });
});

describe("shouldResumeSgSearch", () => {
  it("replays matview steps after an interrupted file_groups or folders step", () => {
    expect(shouldResumeSgSearch("refreshing", null, 0)).toBe(false);
    expect(shouldResumeSgSearch("reconciling", null, 0)).toBe(false);
  });

  it("resumes search after an empty result or a full batch whose stamp was cleared", () => {
    expect(shouldResumeSgSearch("refreshing", "2026-09-28T12:00:00Z", 0)).toBe(true);
    expect(shouldResumeSgSearch("refreshing", null, 5_000)).toBe(true);
    expect(shouldResumeSgSearch("completed", "2026-09-28T12:00:00Z", 5_000)).toBe(false);
  });
});

describe("runSteppableSgRefresh", () => {
  it("runs each fresh phase as its own RPC statement in order", async () => {
    const calls: string[] = [];
    const result = await runSteppableSgRefresh("run-1", 5_000, false, async (args) => {
      calls.push(args.p_step);
      expect(args).toMatchObject({ p_run_id: "run-1", p_search_batch_size: 5_000 });
      return { data: [{ search_documents_synced: args.p_step === "search" ? 5_000 : 0 }], error: null };
    });
    expect(calls).toEqual(["file_groups", "folders", "search"]);
    expect(result).toEqual({ synced: 5_000 });
  });

  it("resumes a full search batch without refreshing either matview again", async () => {
    const calls: string[] = [];
    const result = await runSteppableSgRefresh("run-1", 5_000, true, async (args) => {
      calls.push(args.p_step);
      return { data: [{ search_documents_synced: 0 }], error: null };
    });
    expect(calls).toEqual(["search"]);
    expect(result).toEqual({ synced: 0 });
  });

  it("stops at the failed step and rejects missing or impossible counts", async () => {
    const calls: string[] = [];
    const failure = await runSteppableSgRefresh("run-1", 5_000, false, async (args) => {
      calls.push(args.p_step);
      return args.p_step === "folders"
        ? { data: null, error: { message: "bounded statement failed" } }
        : { data: [{ search_documents_synced: 0 }], error: null };
    });
    expect(calls).toEqual(["file_groups", "folders"]);
    expect(failure).toEqual({ synced: 0, failedStep: "folders", error: "bounded statement failed" });
    for (const badCount of [null, -1, 5_001, 1.5]) {
      const result = await runSteppableSgRefresh("run-1", 5_000, true, async () => ({
        data: [{ search_documents_synced: badCount }],
        error: null,
      }));
      expect(result.failedStep).toBe("search");
      expect(result.error).toMatch(/invalid synchronization count/);
    }
  });
});

describe("SG_RECONCILE_BATCH_SIZE", () => {
  it("keeps each production reconciliation write bounded", () => {
    expect(SG_RECONCILE_BATCH_SIZE).toBe(250);
  });
});
