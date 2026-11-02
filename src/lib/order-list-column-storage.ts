import type { ColumnState } from "ag-grid-community";

const keyFor = (userId: string) => `popdam:order-list:columns:v1:${userId}`;

/** Local, per-user last-used columns; named shared saved views remain independent. */
export function readOrderListColumns(userId: string | undefined): ColumnState[] | null {
  if (!userId) return null;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(keyFor(userId)) ?? "null");
    if (!Array.isArray(value) || value.length === 0) return null;
    if (!value.every((column) => column && typeof column.colId === "string")) return null;
    return value as ColumnState[];
  } catch {
    return null;
  }
}

export function saveOrderListColumns(userId: string | undefined, columns: ColumnState[]): void {
  if (!userId) return;
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(columns));
  } catch {
    // Browser storage can be unavailable; column editing and named views still work.
  }
}
