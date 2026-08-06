import { describe, expect, it } from "vitest";

import { MASTER_DATA_DEFAULT_PAGE_SIZE, MASTER_DATA_PAGE_SIZE_OPTIONS } from "@/lib/master-data-pagination";

describe("Master Data pagination", () => {
  it("defaults to 500 rows and offers only the approved larger page sizes", () => {
    expect(MASTER_DATA_DEFAULT_PAGE_SIZE).toBe(500);
    expect(MASTER_DATA_PAGE_SIZE_OPTIONS).toEqual([500, 1000, 1500]);
  });
});
