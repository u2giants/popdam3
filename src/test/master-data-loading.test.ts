import { describe, expect, it } from "vitest";

import { MASTER_DATA_FETCH_BATCH_SIZE, shouldFetchNextMasterDataBatch } from "@/lib/master-data-loading";

describe("Master Data loading", () => {
  it("continues loading while a complete database page is returned", () => {
    expect(MASTER_DATA_FETCH_BATCH_SIZE).toBe(1000);
    expect(shouldFetchNextMasterDataBatch(1000)).toBe(true);
  });

  it("stops only after the final partial database page", () => {
    expect(shouldFetchNextMasterDataBatch(999)).toBe(false);
    expect(shouldFetchNextMasterDataBatch(0)).toBe(false);
  });
});
