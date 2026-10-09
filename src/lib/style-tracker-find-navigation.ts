import type { GridApi } from "ag-grid-community";

export type StyleTrackerFindRow = { id: string };

/** Navigate to a match already present in the progressively loaded grid rows. */
export function navigateToStyleTrackerMatch<TData extends StyleTrackerFindRow>(
  api: GridApi<TData>,
  rows: TData[],
  search: string,
): boolean {
  if (!search) return false;

  const match = rows.find((row) => JSON.stringify(row).toLocaleLowerCase().includes(search));
  if (!match) return false;

  const node = api.getRowNode(match.id);
  if (node?.rowIndex == null) return false;

  api.paginationGoToPage(Math.floor(node.rowIndex / api.paginationGetPageSize()));
  api.ensureNodeVisible(node, "middle");
  api.redrawRows();
  return true;
}
