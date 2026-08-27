import { Ban, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { OrderListRow } from "@/types/order-list";

type Props = {
  row: OrderListRow | undefined;
  onEditOrder: (row: OrderListRow) => void;
};

/**
 * The row's way into the order editor. Without it the editor is only reachable
 * for a NEW order, which left the whole edit path -- and voiding, which lives in
 * that dialog -- unreachable from the UI.
 */
export function OrderActionsCell({ row, onEditOrder }: Props) {
  if (!row) return null;
  const voided = Boolean(row.order_voided_at);

  return (
    <div className="flex h-full items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs"
        aria-label={`Edit order ${row.production_order_number ?? ""}`}
        title={voided ? "This order is voided. Open it to restore it." : "Open this order in the editor"}
        onClick={() => onEditOrder(row)}
      >
        <Pencil className="h-3 w-3" aria-hidden="true" />
      </Button>
      {voided && (
        <span title={row.order_void_reason ?? "Voided"} className="text-muted-foreground">
          <Ban className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

export default OrderActionsCell;
