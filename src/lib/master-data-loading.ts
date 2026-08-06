export const MASTER_DATA_FETCH_BATCH_SIZE = 1000;

export function shouldFetchNextMasterDataBatch(batchLength: number) {
  return batchLength === MASTER_DATA_FETCH_BATCH_SIZE;
}
