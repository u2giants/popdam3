export type BuySheetItemRow = {
  sku_normalized: string;
  item_description: string | null;
  master_data_licensor: string | null;
};

/** Read every matching order line, including styles beyond the first API page. */
export async function loadBuySheetItemInfo(
  skus: string[],
  fetchPage: (skus: string[], offset: number, pageSize: number) => PromiseLike<{
    data: BuySheetItemRow[] | null;
    error: unknown;
  }>,
) {
  const info: Record<string, { itemDescription: string | null; licensor: string | null }> = {};
  const pageSize = 500;
  for (let start = 0; start < skus.length; start += 50) {
    const batch = skus.slice(start, start + 50);
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await fetchPage(batch, offset, pageSize);
      if (error) throw error;
      if (!data) throw new Error("Item Master details unavailable");
      for (const row of data) {
        const key = row.sku_normalized.trim().toLowerCase();
        const previous = info[key];
        info[key] = {
          itemDescription: previous?.itemDescription || row.item_description,
          licensor: previous?.licensor || row.master_data_licensor,
        };
      }
      if (data.length < pageSize) break;
    }
  }
  return info;
}
