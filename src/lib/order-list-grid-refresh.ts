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
