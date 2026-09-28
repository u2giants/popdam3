import { describe, expect, it, vi } from "vitest";
import { bridgeWriteCounts, refreshStyleTrackerBridgeWithRetry, StyleRowSavedBridgeRefreshError } from "@/lib/style-tracker-save";

describe("style tracker split save", () => {
  it("retries only the idempotent bridge refresh", async () => {
    const refresh = vi.fn()
      .mockResolvedValueOnce({ error: { message: "temporary lock" } })
      .mockResolvedValueOnce({ error: null });
    const delay = vi.fn().mockResolvedValue(undefined);

    await refreshStyleTrackerBridgeWithRetry(refresh, { delay });

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(250);
  });

  it("reports that the row was saved when every bridge refresh fails", async () => {
    const refresh = vi.fn().mockResolvedValue({ error: { message: "statement timeout" } });

    await expect(refreshStyleTrackerBridgeWithRetry(refresh, { delay: async () => undefined }))
      .rejects.toMatchObject<Partial<StyleRowSavedBridgeRefreshError>>({ rowSaved: true });
  });
});

describe("bridge indexed-write receipt", () => {
  it("includes public-wrapper designer updates without changing the returned total", () => {
    expect(bridgeWriteCounts([{ inserted_count: 1, updated_count: 5, total_count: 4 }], null))
      .toEqual({ attempted_rows: 6, succeeded_rows: 6, inserted_rows: 1,
        updated_rows: 5, base_total_rows: 4 });
  });

  it("fails closed on errors or missing counts", () => {
    expect(bridgeWriteCounts([{ inserted_count: 0, updated_count: 1, total_count: 1 }], { message: "failed" })).toBeNull();
    expect(bridgeWriteCounts([{ inserted_count: null, updated_count: 1, total_count: 1 }], null)).toBeNull();
    expect(bridgeWriteCounts([{ inserted_count: 0, updated_count: 0, total_count: 1 }], null)).toBeNull();
  });
});
