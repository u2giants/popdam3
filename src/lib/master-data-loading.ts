export const MASTER_DATA_FETCH_BATCH_SIZE = 1000;
export const MASTER_DATA_FETCH_CONCURRENCY = 4;

// Keep this projection explicit. The page needs these values for its cells,
// editing, link/match indicators, and RFQ history; unrelated view additions
// must not silently become part of every Master Data download.
export const STYLE_TRACKER_ROW_SELECT = [
  "id",
  "source_sheet",
  "source_row_number",
  "tracker_type",
  "sku",
  "group_id",
  "description",
  "customer",
  "customer_id",
  "designer",
  "commissioned",
  "upc",
  "customer_sku",
  "licensor",
  "license_status",
  "royalty",
  "concept_status",
  "pre_production_status",
  "production_status",
  "default_vendor",
  "discontinued",
  "notes",
  "row_data",
  "match_status",
  "match_notes",
  "erp_item_id",
  "style_group_id",
  "company_id",
  "public_licensor_id",
  "core_licensor_id",
  "creative_designer_id",
  "canonical_designer_name",
  "canonical_customer_name",
  "factory_id",
  "plm_item_id",
  "rfq_groups",
].join(",");

export function masterDataPageOffsets(pageOffset: number) {
  return Array.from(
    { length: MASTER_DATA_FETCH_CONCURRENCY },
    (_, index) => pageOffset + index * MASTER_DATA_FETCH_BATCH_SIZE,
  );
}

export function nextMasterDataPageOffset(pageOffset: number) {
  return pageOffset + MASTER_DATA_FETCH_BATCH_SIZE * MASTER_DATA_FETCH_CONCURRENCY;
}

export function flattenMasterDataPages<T extends { id: string }>(pages: Array<{ rows: T[] }>) {
  const seen = new Set<string>();
  return pages.flatMap((page) => page.rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  }));
}

export function shouldFetchNextMasterDataBatch(batchLength: number) {
  return batchLength === MASTER_DATA_FETCH_BATCH_SIZE;
}
