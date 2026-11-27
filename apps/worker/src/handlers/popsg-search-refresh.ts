type RefreshResult = {
  data: { search_documents_synced?: number } | { search_documents_synced?: number }[] | null;
  error: { message: string } | null;
};

let batchSize = 1000;

export async function refreshQueuedSearch(
  refresh: (size: number) => PromiseLike<RefreshResult>,
  maxCalls: number,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxCalls; i++) {
    const size = batchSize;
    const { data, error } = await refresh(size);
    if (error) {
      if (/statement timeout/i.test(error.message) && size > 50) {
        batchSize = Math.max(50, Math.floor(size / 2));
        continue;
      }
      throw new Error(`search refresh: ${error.message}`);
    }
    const row = Array.isArray(data) ? data[0] : data;
    const count = Number(row?.search_documents_synced ?? 0);
    total += count;
    if (count < size) break;
    batchSize = Math.min(1000, size * 2);
  }
  return total;
}
