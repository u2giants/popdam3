import { describe, expect, it } from "vitest";

import {
  MASTER_DATA_FETCH_BATCH_SIZE,
  STYLE_TRACKER_ROW_SELECT,
  flattenMasterDataPages,
  masterDataPageOffsets,
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
    expect(masterDataPageOffsets(0)).toEqual([0, 1000, 2000, 3000]);
    expect(nextMasterDataPageOffset(0)).toBe(4000);
    expect(masterDataPageOffsets(4000)).toEqual([4000, 5000, 6000, 7000]);
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
