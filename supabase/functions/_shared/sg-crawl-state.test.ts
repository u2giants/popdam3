import { describe, expect, it } from "vitest";
import {
  buildSgCrawlCompletionUpdate,
  buildSgIngestCompletionUpdate,
  canCompleteSgCrawl,
  countAcceptedExtensions,
  evaluateSgDropGuard,
  hasMoreSgSearchDocuments,
  runScheduledSgRefresh,
  SG_RECONCILE_BATCH_SIZE,
  SG_REFRESH_TIMEOUT_RETRY_WINDOW_MS,
  shouldRetrySgRefreshTimeout,
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

describe("runScheduledSgRefresh", () => {
  const refreshedAt = "2026-10-11T21:07:14.000Z";
  const ready = async () => ({ data: [{ ready: true, refreshed_at: refreshedAt }], error: null });

  it("does not synchronize search or run aggregates while the scheduler is pending", async () => {
    let called = false;
    expect(
      await runScheduledSgRefresh("run-1", 5_000, async (args) => {
        expect(args).toEqual({ p_run_id: "run-1" });
        return { data: [{ ready: false, refreshed_at: null }], error: null };
      }, async () => {
        called = true;
        return { data: [], error: null };
      }),
    ).toEqual({ synced: 0, pending: true });
    expect(called).toBe(false);
  });

  it("runs only one bounded search slice after the scheduler proves freshness", async () => {
    const result = await runScheduledSgRefresh("run-1", 5_000, ready, async (args) => {
      expect(args).toEqual({ p_run_id: "run-1", p_search_batch_size: 5_000, p_step: "search" });
      return { data: [{ search_documents_synced: 5_000 }], error: null };
    });
    expect(result).toEqual({ synced: 5_000, refreshedAt });
    expect(hasMoreSgSearchDocuments(result.synced, 5_000)).toBe(true);
  });

  it("refuses malformed readiness and never advances search from it", async () => {
    for (
      const data of [null, [], [{ ready: true }], [{ ready: false, refreshed_at: refreshedAt }], [{ ready: "true", refreshed_at: refreshedAt }], [{
        ready: true,
        refreshed_at: "bad",
      }], [{ ready: true, refreshed_at: refreshedAt }, { ready: true, refreshed_at: refreshedAt }]]
    ) {
      let called = false;
      const result = await runScheduledSgRefresh("run-1", 5_000, async () => ({ data, error: null }), async () => {
        called = true;
        return { data: [], error: null };
      });
      expect(result.failedStep).toBe("scheduled_refresh");
      expect(called).toBe(false);
    }
  });

  it("preserves readiness and search errors without reporting completion", async () => {
    expect(
      await runScheduledSgRefresh("run-1", 5_000, async () => ({ data: null, error: { message: "scheduler expired" } }), async () => {
        throw new Error("must not search");
      }),
    ).toEqual({ synced: 0, failedStep: "scheduled_refresh", error: "scheduler expired" });
    expect(await runScheduledSgRefresh("run-1", 5_000, ready, async () => ({ data: null, error: { message: "statement timeout" } })))
      .toEqual({ synced: 0, refreshedAt, failedStep: "search", error: "statement timeout" });
  });

  it("refuses missing, fractional, negative and oversized synchronization counts", async () => {
    for (const badCount of [null, undefined, -1, 5_001, 1.5]) {
      const result = await runScheduledSgRefresh("run-1", 5_000, ready, async () => ({ data: [{ search_documents_synced: badCount }], error: null }));
      expect(result.failedStep).toBe("search");
      expect(result.error).toMatch(/invalid synchronization count/);
    }
  });

  it("rechecks scheduled freshness on restart and completes only with a valid short search slice", async () => {
    let attempts = 0;
    const search = async () =>
      ++attempts === 1 ? { data: null, error: { message: "statement timeout" } } : { data: [{ search_documents_synced: 0 }], error: null };
    expect((await runScheduledSgRefresh("run-1", 5_000, ready, search)).failedStep).toBe("search");
    expect(await runScheduledSgRefresh("run-1", 5_000, ready, search)).toEqual({ synced: 0, refreshedAt });
  });
});

describe("SG_RECONCILE_BATCH_SIZE", () => {
  it("keeps each production reconciliation write bounded", () => {
    expect(SG_RECONCILE_BATCH_SIZE).toBe(250);
  });
});

describe("shouldRetrySgRefreshTimeout", () => {
  const ingest = "2026-10-10T02:21:02.084Z";
  const ingestMs = Date.parse(ingest);
  const timeout = "canceling statement due to statement timeout";

  it("retries a statement timeout inside the window (nightly crawl 2026-10-10 failure)", () => {
    expect(shouldRetrySgRefreshTimeout(timeout, ingest, ingestMs + 10_000)).toBe(true);
  });

  it("stops retrying once the window closes", () => {
    expect(shouldRetrySgRefreshTimeout(timeout, ingest, ingestMs + SG_REFRESH_TIMEOUT_RETRY_WINDOW_MS)).toBe(false);
  });

  it("never retries other errors", () => {
    expect(shouldRetrySgRefreshTimeout("permission denied for function", ingest, ingestMs)).toBe(false);
  });

  it("fails closed on an unreadable ingest timestamp", () => {
    expect(shouldRetrySgRefreshTimeout(timeout, "not-a-date", ingestMs)).toBe(false);
  });
});
