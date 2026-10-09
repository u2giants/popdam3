import type { GridApi } from "ag-grid-community";

/** Purge cached row blocks so an active OrderList refresh re-reads the visible page. */
export function refreshOrderListRows<TData>(api: Pick<GridApi<TData>, "purgeInfiniteCache"> | null | undefined) {
  api?.purgeInfiniteCache();
}
