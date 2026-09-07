import { describe, expect, it, vi } from "vitest";
import { refreshStyleTrackerBridgeWithRetry, StyleRowSavedBridgeRefreshError } from "@/lib/style-tracker-save";

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
