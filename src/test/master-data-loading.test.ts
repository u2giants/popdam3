import { describe, expect, it, vi } from "vitest";

import {
  MASTER_DATA_FETCH_BATCH_SIZE,
  MASTER_DATA_RANGES_PER_PAGE,
  STYLE_TRACKER_ROW_SELECT,
  fetchMasterDataPageRanges,
  flattenMasterDataPages,
  masterDataPageOffsets,
  masterDataLoadStatus,
  masterDataPageSchedule,
  retryMasterDataLoad,
  shouldAutoFetchMasterDataNextPage,
  nextMasterDataPageOffset,
  shouldFetchNextMasterDataBatch,
} from "@/lib/master-data-loading";

describe("Master Data loading", () => {
  it("continues loading while a complete database page is returned", () => {
    expect(MASTER_DATA_FETCH_BATCH_SIZE).toBe(1000);
    expect(shouldFetchNextMasterDataBatch(1000)).toBe(true);
  });

  it("stops only after the final partial database page", () => {
    expect(shouldFetchNextMasterDataBatch(999)).toBe(false);
    expect(shouldFetchNextMasterDataBatch(0)).toBe(false);
  });

  it("forms each progressive page from four non-overlapping database ranges", () => {
    expect(MASTER_DATA_RANGES_PER_PAGE).toBe(4);
    expect(masterDataPageOffsets(0)).toEqual([0, 1000, 2000, 3000]);
    expect(nextMasterDataPageOffset(0)).toBe(4000);
    expect(masterDataPageOffsets(4000)).toEqual([4000, 5000, 6000, 7000]);
  });

  it("starts the next Licensed GET only after the preceding GET and status RPC have resolved", async () => {
    const calls: number[] = [];
    const releases = new Map<number, (rows: Array<{ id: string }>) => void>();
    const page = fetchMasterDataPageRanges(0, async (offset) => {
      calls.push(offset);
      return new Promise<Array<{ id: string }>>((resolve) => releases.set(offset, resolve));
    }, "License.Style");
    expect(calls).toEqual([0]);

    for (const [index, offset] of [0, 1000, 2000, 3000].entries()) {
      releases.get(offset)?.(Array.from({ length: 1000 }, (_, row) => ({ id: `${offset + row}` })));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(calls).toEqual([0, 1000, 2000, 3000].slice(0, index + 2));
    }
    const results = await page;
    expect(calls).toEqual([0, 1000, 2000, 3000]);
    expect(results.flat()).toHaveLength(4000);
    expect(results.flat()[0].id).toBe("0");
    expect(results.flat()[3999].id).toBe("3999");
  });

  it("starts Generic ranges in parallel and keeps result order when responses finish out of order", async () => {
    const calls: number[] = [];
    expect(masterDataPageSchedule("Generic.Style")).toBe("parallel");
    const releases = new Map<number, (result: { offset: number }) => void>();
    const page = fetchMasterDataPageRanges(4000, async (offset) => {
      calls.push(offset);
      return new Promise<{ offset: number }>((resolve) => releases.set(offset, resolve));
    }, "Generic.Style");
    expect(calls).toEqual([4000, 5000, 6000, 7000]);
    for (const offset of [7000, 5000, 4000, 6000]) releases.get(offset)?.({ offset });
    const results = await page;
    expect(results.map((result) => result.offset)).toEqual(calls);
  });

  it("stops at the first failed range and propagates the original error", async () => {
    const calls: number[] = [];
    const failure = new Error("range unavailable");
    await expect(fetchMasterDataPageRanges(0, async (offset) => {
      calls.push(offset);
      if (offset === 1000) throw failure;
      return { offset };
    }, "License.Style")).rejects.toBe(failure);
    expect(calls).toEqual([0, 1000]);
  });

  it("reports loading, unknown totals, and completed counts from rows actually loaded", () => {
    const loading = masterDataLoadStatus({ loadedRows: 0, initialLoading: true, initialError: false, hasNextPage: false, fetchingNextPage: false, nextPageError: false, refetchError: false });
    expect(loading).toMatchObject({ message: "Loading Master Data…", showRetry: false, retryDisabled: true });

    const partial = masterDataLoadStatus({ loadedRows: 1000, initialLoading: false, initialError: false, hasNextPage: true, fetchingNextPage: false, nextPageError: false, refetchError: false });
    expect(partial.message).toContain("1,000 rows loaded — loading the rest");
    expect(partial.message).not.toContain("of");

    const complete = masterDataLoadStatus({ loadedRows: 2750, knownTotal: 12747, initialLoading: false, initialError: false, hasNextPage: false, fetchingNextPage: false, nextPageError: false, refetchError: false });
    expect(complete.message).toBe("2,750 rows loaded (12,747 total)");
  });

  it("offers retry for initial and next-page errors, and announces a disabled retry in progress", () => {
    const initialError = masterDataLoadStatus({ loadedRows: 0, initialLoading: false, initialError: true, hasNextPage: false, fetchingNextPage: false, nextPageError: false, refetchError: false });
    expect(initialError).toMatchObject({ showRetry: true, retryDisabled: false });
    expect(initialError.message).toBe("Master Data could not be loaded.");

    const nextPageError = masterDataLoadStatus({ loadedRows: 1000, initialLoading: false, initialError: false, hasNextPage: true, fetchingNextPage: false, nextPageError: true, refetchError: false });
    expect(nextPageError).toMatchObject({ showRetry: true, retryDisabled: false });
    expect(nextPageError.message).toContain("more rows could not be loaded");

    const refreshError = masterDataLoadStatus({ loadedRows: 1000, initialLoading: false, initialError: false, hasNextPage: false, fetchingNextPage: false, nextPageError: false, refetchError: true });
    expect(refreshError).toMatchObject({ showRetry: true, retryDisabled: false });
    expect(refreshError.message).toContain("1,000 rows loaded — refresh failed");

    const retrying = masterDataLoadStatus({ loadedRows: 1000, initialLoading: false, initialError: false, hasNextPage: true, fetchingNextPage: true, nextPageError: true, refetchError: false });
    expect(retrying).toMatchObject({ showRetry: true, retryDisabled: true });
    expect(retrying.message).toContain("retrying the remaining rows");
    expect(shouldAutoFetchMasterDataNextPage(true, false, false)).toBe(true);
    expect(shouldAutoFetchMasterDataNextPage(true, false, true)).toBe(false);
    expect(shouldAutoFetchMasterDataNextPage(true, true, false)).toBe(false);
  });

  it("retries only the failed next page, or refetches the first page after an initial error", async () => {
    const fetchNextPage = vi.fn(async () => "next");
    const refetch = vi.fn(async () => "first");
    await expect(retryMasterDataLoad(true, fetchNextPage, refetch)).resolves.toBe("next");
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();

    await expect(retryMasterDataLoad(false, fetchNextPage, refetch)).resolves.toBe("first");
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate rows while pages append or refresh", () => {
    expect(flattenMasterDataPages([
      { rows: [{ id: "a" }, { id: "b" }] },
      { rows: [{ id: "b" }, { id: "c" }] },
    ])).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });

  it("uses an explicit projection that retains every required bridge and editable value", () => {
    for (const field of [
      "id", "source_sheet", "source_row_number", "row_data", "match_notes", "rfq_groups",
      "match_status", "canonical_customer_name", "canonical_designer_name", "customer_id",
      "erp_item_id", "style_group_id", "company_id", "public_licensor_id", "core_licensor_id",
      "creative_designer_id", "factory_id", "plm_item_id",
    ]) {
      expect(STYLE_TRACKER_ROW_SELECT.split(",")).toContain(field);
    }
  });

  it("excludes view metadata the page does not consume", () => {
    for (const field of [
      "source_workbook_id", "imported_at", "created_at", "updated_at", "updated_by", "bridge_id",
      "match_confidence", "last_matched_at", "canonical_description", "canonical_licensor_name",
      "canonical_factory_name", "style_group_sku", "erp_style_number",
    ]) {
      expect(STYLE_TRACKER_ROW_SELECT.split(",")).not.toContain(field);
    }
  });
});
