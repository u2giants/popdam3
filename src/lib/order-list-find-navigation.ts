import type { GridApi } from "ag-grid-community";

/**
 * Navigate to a server-found row in the infinite model without treating the
 * current row-count estimate as the dataset's end.
 */
export function navigateToOrderListMatch<TData>(api: GridApi<TData>, rowIndex: number) {
  if (!api.isLastRowIndexKnown() && rowIndex >= api.paginationGetRowCount()) {
    // Find has already established that this row exists. Extend only the
    // estimate needed to navigate; keep the true end unknown until the
    // bounded datasource returns a short block.
    api.setRowCount(rowIndex + 1, false);
  }

  api.paginationGoToPage(Math.floor(rowIndex / api.paginationGetPageSize()));
  window.requestAnimationFrame(() => api.ensureIndexVisible(rowIndex, "middle"));
}
