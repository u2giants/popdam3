// Reads every row of the style_guide_folders view for the PopSG filter tree.
// The API caps each response (PostgREST max_rows), so a single .limit(n) call
// silently drops later licensors/properties. Page through until an empty page.
export const POPSG_FOLDER_PAGE_SIZE = 500;

export type PopSGFolderPageFetcher<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: unknown }>;

export async function fetchAllPopSGFolderRows<T>(
  fetchPage: PopSGFolderPageFetcher<T>,
  pageSize: number = POPSG_FOLDER_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    if (page.length === 0) return rows;
    rows.push(...page);
  }
}
