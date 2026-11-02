import type { GridApi } from "ag-grid-community";

export type StyleTrackerFindRow = { id: string };

/** Navigate to the requested 1-based match already present in the progressively loaded grid rows. */
export function navigateToStyleTrackerMatch<TData extends StyleTrackerFindRow>(
  api: GridApi<TData>,
  rows: TData[],
  search: string,
  matchPosition = 1,
): boolean {
  if (!search || matchPosition < 1) return false;

  let seen = 0;
  const match = rows.find((row) => {
    if (!JSON.stringify(row).toLocaleLowerCase().includes(search)) return false;
    return seen++ === matchPosition - 1;
  });
  if (!match) return false;

  const node = api.getRowNode(match.id);
  if (node?.rowIndex == null) return false;

  api.paginationGoToPage(Math.floor(node.rowIndex / api.paginationGetPageSize()));
  api.ensureNodeVisible(node, "middle");
  api.redrawRows();
  return true;
}
