import type { GridApi } from "ag-grid-community";

type RefreshApi<TData> = Pick<
  GridApi<TData>,
  "purgeInfiniteCache" | "getEditingCells" | "addEventListener" | "removeEventListener" | "isDestroyed"
>;

type PendingRefresh<TData> = {
  api: RefreshApi<TData>;
  listener: () => void;
  queued: boolean;
};

const pendingRefreshes = new WeakMap<object, PendingRefresh<unknown>>();

function isAlive<TData>(api: RefreshApi<TData>): boolean {
  return !api.isDestroyed();
}

function finishPending<TData>(pending: PendingRefresh<TData>, refresh: boolean) {
  const { api } = pending;
  if (pendingRefreshes.get(api) !== pending) return;
  pendingRefreshes.delete(api);
  if (!isAlive(api)) return;
  api.removeEventListener("cellEditingStopped", pending.listener);
  if (refresh) api.purgeInfiniteCache();
}

/** Refresh visible OrderList rows without interrupting an in-progress cell edit. */
export function refreshOrderListRows<TData>(api: RefreshApi<TData> | null | undefined) {
  if (!api || !isAlive(api)) return;

  const current = pendingRefreshes.get(api) as PendingRefresh<TData> | undefined;
  if (api.getEditingCells().length === 0) {
    if (current) finishPending(current, false);
    api.purgeInfiniteCache();
    return;
  }
  if (current) return;

  const pending: PendingRefresh<TData> = {
    api,
    queued: false,
    listener: () => {
      if (pending.queued) return;
      pending.queued = true;
      queueMicrotask(() => {
        pending.queued = false;
        if (pendingRefreshes.get(api) !== pending) return;
        if (!isAlive(api)) {
          finishPending(pending, false);
          return;
        }
        if (api.getEditingCells().length > 0) return;
        finishPending(pending, true);
      });
    },
  };
  pendingRefreshes.set(api, pending as PendingRefresh<unknown>);
  api.addEventListener("cellEditingStopped", pending.listener);
}

type InPlaceApi<TData> = RefreshApi<TData> &
  Pick<GridApi<TData>, "getFirstDisplayedRowIndex" | "getLastDisplayedRowIndex" | "getDisplayedRowAtIndex" | "getColumnState" | "getFilterModel">;

export type OrderListRangeFetcher<TData> = (request: {
  startRow: number;
  endRow: number;
  sortModel: Array<{ colId: string; sort: string }>;
  filterModel: Record<string, unknown>;
}) => Promise<TData[]>;

/**
 * Background refresh (timer, focus, realtime): re-read only the rows on screen
 * and update them in place, so the grid never empties and "blinks". If rows were
 * added, removed or reordered, fall back to the full block reload.
 */
export async function refreshOrderListRowsInPlace<TData>(
  api: InPlaceApi<TData> | null | undefined,
  fetchRange: OrderListRangeFetcher<TData>,
  getId: (row: TData) => string,
) {
  if (!api || !isAlive(api)) return;
  if (api.getEditingCells().length > 0) return; // next tick retries
  const first = api.getFirstDisplayedRowIndex?.() ?? -1;
  const last = api.getLastDisplayedRowIndex?.() ?? -1;
  if (first < 0 || last < first) return refreshOrderListRows(api);

  const sortModel = (api.getColumnState() ?? [])
    .filter((column) => column.sort)
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    .map((column) => ({ colId: column.colId, sort: column.sort as string }));
  const rows = await fetchRange({ startRow: first, endRow: last + 1, sortModel, filterModel: api.getFilterModel() ?? {} });
  if (!isAlive(api) || api.getEditingCells().length > 0) return;

  const nodes = rows.map((_, offset) => api.getDisplayedRowAtIndex(first + offset));
  const sameShape = rows.length === last - first + 1 && nodes.every((node, i) => node?.data && getId(node.data) === getId(rows[i]));
  if (!sameShape) return refreshOrderListRows(api);
  nodes.forEach((node, i) => node!.setData(rows[i]));
}
