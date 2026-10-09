export const MASTER_DATA_FETCH_BATCH_SIZE = 1000;
export const MASTER_DATA_RANGES_PER_PAGE = 4;

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
    { length: MASTER_DATA_RANGES_PER_PAGE },
    (_, index) => pageOffset + index * MASTER_DATA_FETCH_BATCH_SIZE,
  );
}

export function masterDataPageSchedule(sourceSheet: string) {
  return sourceSheet === "License.Style" ? "sequential" : "parallel";
}

export async function fetchMasterDataPageRanges<T>(
  pageOffset: number,
  fetchBatch: (offset: number) => Promise<T>,
  sourceSheet: string,
) {
  const offsets = masterDataPageOffsets(pageOffset);
  if (masterDataPageSchedule(sourceSheet) === "parallel") {
    return Promise.all(offsets.map(fetchBatch));
  }

  const results: T[] = [];
  for (const offset of offsets) results.push(await fetchBatch(offset));
  return results;
}

export function nextMasterDataPageOffset(pageOffset: number) {
  return pageOffset + MASTER_DATA_FETCH_BATCH_SIZE * MASTER_DATA_RANGES_PER_PAGE;
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

export type MasterDataLoadStatusInput = {
  loadedRows: number;
  knownTotal?: number;
  initialLoading: boolean;
  initialError: boolean;
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  nextPageError: boolean;
  refetchError: boolean;
};

export function masterDataLoadStatus(input: MasterDataLoadStatusInput) {
  const loaded = `${input.loadedRows.toLocaleString()} rows loaded`;
  if (input.initialLoading && input.loadedRows === 0) return { message: "Loading Master Data…", showRetry: false, retryDisabled: true };
  if (input.nextPageError && input.fetchingNextPage) return { message: `${loaded} — retrying the remaining rows…`, showRetry: true, retryDisabled: true };
  if (input.initialError && input.loadedRows === 0) return { message: "Master Data could not be loaded.", showRetry: true, retryDisabled: input.initialLoading };
  if (input.nextPageError) return { message: `${loaded} — more rows could not be loaded.`, showRetry: true, retryDisabled: input.fetchingNextPage };
  if (input.refetchError) return { message: `${loaded} — refresh failed.`, showRetry: true, retryDisabled: input.initialLoading };
  if (input.hasNextPage || input.fetchingNextPage) {
    const progress = input.knownTotal == null
      ? loaded
      : `${input.loadedRows.toLocaleString()} of ${input.knownTotal.toLocaleString()} rows loaded`;
    return { message: `${progress} — loading the rest. Find and filters cover loaded rows.`, showRetry: false, retryDisabled: true };
  }
  return { message: input.knownTotal == null || input.knownTotal === input.loadedRows
    ? loaded
    : `${loaded} (${input.knownTotal.toLocaleString()} total)`, showRetry: false, retryDisabled: true };
}

export async function retryMasterDataLoad(
  nextPageError: boolean,
  fetchNextPage: () => Promise<unknown>,
  refetch: () => Promise<unknown>,
) {
  return nextPageError ? fetchNextPage() : refetch();
}

export function shouldAutoFetchMasterDataNextPage(hasNextPage: boolean, fetching: boolean, hasError: boolean) {
  return hasNextPage && !fetching && !hasError;
}
