import type { OrderListRow } from "@/types/order-list";

/** Band contiguous POs across every cached block, using canonical PO identity. */
export function buildOrderListPOBands(rows: Array<{ rowIndex: number; data: OrderListRow }>) {
  const bands = new Map<string, { alternate: boolean; start: boolean }>();
  let previous: typeof rows[number] | undefined;
  let alternate = false;
  for (const row of [...rows].sort((a, b) => a.rowIndex - b.rowIndex)) {
    const differentPO = previous != null && previous.data.order_id !== row.data.order_id;
    if (differentPO) alternate = !alternate;
    bands.set(row.data.order_line_id, {
      alternate,
      start: Boolean(differentPO && previous!.rowIndex + 1 === row.rowIndex),
    });
    previous = row;
  }
  return bands;
}
