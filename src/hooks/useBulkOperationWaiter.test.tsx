import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const maybeSingle = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}));

import { useBulkOperationWaiter, waitForBulkOperation } from "./useBulkOperationWaiter";

const opsRow = (ops: Record<string, unknown>) => ({ data: { value: ops } });

describe("waitForBulkOperation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    maybeSingle.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("resolves completed once the op reports completed", async () => {
    maybeSingle
      .mockResolvedValueOnce(opsRow({ k: { status: "running" } }))
      .mockResolvedValueOnce(opsRow({ k: { status: "completed" } }));
    const p = waitForBulkOperation("k", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(p).resolves.toEqual({ status: "completed" });
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it("treats a missing op record as completed", async () => {
    maybeSingle.mockResolvedValue(opsRow({}));
    const p = waitForBulkOperation("k", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(p).resolves.toEqual({ status: "completed" });
  });

  it("reports failed and interrupted with the op error", async () => {
    maybeSingle.mockResolvedValue(opsRow({ k: { status: "interrupted", error: "boom" } }));
    const p = waitForBulkOperation("k", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(p).resolves.toEqual({ status: "failed", error: "boom" });
  });

  it("times out after maxWaitMs", async () => {
    maybeSingle.mockResolvedValue(opsRow({ k: { status: "running" } }));
    const p = waitForBulkOperation("k", new AbortController().signal, { maxWaitMs: 6_000 });
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(p).resolves.toEqual({ status: "timeout" });
    expect(maybeSingle).toHaveBeenCalledTimes(3);
  });

  it("stops immediately when aborted", async () => {
    maybeSingle.mockResolvedValue(opsRow({ k: { status: "running" } }));
    const ac = new AbortController();
    const p = waitForBulkOperation("k", ac.signal);
    await vi.advanceTimersByTimeAsync(2_000);
    ac.abort();
    await expect(p).resolves.toEqual({ status: "aborted" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });
});

describe("useBulkOperationWaiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    maybeSingle.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("aborts in-flight polls on unmount", async () => {
    maybeSingle.mockResolvedValue(opsRow({ k: { status: "running" } }));
    const { result, unmount } = renderHook(() => useBulkOperationWaiter());
    const p = result.current("k");
    await vi.advanceTimersByTimeAsync(2_000);
    unmount();
    await expect(p).resolves.toEqual({ status: "aborted" });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns a stable function", () => {
    const { result, rerender } = renderHook(() => useBulkOperationWaiter());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
