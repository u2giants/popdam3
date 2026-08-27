import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { coerceFieldValue, patchKeyFor } from "@/lib/order-list";
import type { OrderHeaderPatch, OrderLinePatch, OrderListRow } from "@/types/order-list";

// `field` is the view column, which is what a row carries. It is translated to
// the RPC's patch key by `patchKeyFor` when the form is submitted.
type HeaderFieldSpec = { field: string; label: string; type: "text" | "date" };
type LineFieldSpec = { field: string; label: string; type: "text" | "date" | "number" };

const HEADER_FIELDS: HeaderFieldSpec[] = [
  { field: "production_order_number", label: "Import PO #", type: "text" },
  { field: "order_status", label: "PO Status", type: "text" },
  { field: "order_date", label: "Order Date", type: "date" },
  { field: "requested_ship_date", label: "Requested Ship", type: "date" },
  { field: "etd", label: "ETD", type: "date" },
  { field: "eta", label: "ETA", type: "date" },
];

const LINE_FIELDS: LineFieldSpec[] = [
  { field: "sku", label: "Style #", type: "text" },
  { field: "source_style_type", label: "Licensed / Generic", type: "text" },
  { field: "customer_po_number", label: "Customer PO", type: "text" },
  { field: "quantity_ordered", label: "Quantity", type: "number" },
  { field: "case_pack", label: "Case Pack", type: "number" },
  { field: "start_ship_date", label: "Start Ship", type: "date" },
  { field: "cancel_date", label: "Cancel", type: "date" },
];

export type OrderEditorMode = "create" | "edit";

type Props = {
  mode: OrderEditorMode;
  row: OrderListRow | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (payload: { order: OrderHeaderPatch; line: OrderLinePatch }) => void;
};

function initialValues(row: OrderListRow | null) {
  const values: Record<string, string> = {};
  for (const spec of HEADER_FIELDS) values[spec.field] = row ? String((row as any)[spec.field] ?? "") : "";
  for (const spec of LINE_FIELDS) values[spec.field] = row ? String((row as any)[spec.field] ?? "") : "";
  return values;
}

/**
 * Create or edit one order and its line. Validation happens before the call so a
 * bad value is refused here rather than turning into a database error.
 */
export function OrderEditorDialog({ mode, row, isSaving, onClose, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(row));
  const [error, setError] = useState<string | null>(null);

  const title = mode === "create" ? "New order" : `Edit order ${row?.production_order_number ?? ""}`;

  const canSubmit = useMemo(() => {
    if (mode === "create") return values.production_order_number.trim().length > 0;
    return true;
  }, [mode, values]);

  function handleSubmit() {
    const styleType = values.source_style_type.trim().toLowerCase();
    if (styleType && styleType !== "licensed" && styleType !== "generic") {
      setError('Licensed / Generic must be exactly "licensed" or "generic".');
      return;
    }
    const quantity = values.quantity_ordered.trim();
    if (quantity && !Number.isFinite(Number(quantity))) {
      setError("Quantity must be a number.");
      return;
    }
    setError(null);

    const order: OrderHeaderPatch = {};
    for (const spec of HEADER_FIELDS) {
      (order as any)[patchKeyFor(spec.field as string)] = coerceFieldValue(spec.field as string, values[spec.field]);
    }
    const line: OrderLinePatch = {};
    for (const spec of LINE_FIELDS) {
      (line as any)[patchKeyFor(spec.field as string)] = coerceFieldValue(spec.field as string, values[spec.field]);
    }
    onSubmit({ order, line });
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Order facts stay on the order. Product facts come from Master Data through the linked Style #.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Order</h3>
            {HEADER_FIELDS.map((spec) => (
              <label key={spec.field} className="block text-xs font-medium text-muted-foreground">
                {spec.label}
                <Input
                  className="mt-1"
                  type={spec.type === "date" ? "date" : "text"}
                  value={values[spec.field] ?? ""}
                  aria-label={spec.label}
                  onChange={(event) => setValues((prev) => ({ ...prev, [spec.field]: event.target.value }))}
                />
              </label>
            ))}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Line</h3>
            {LINE_FIELDS.map((spec) => (
              <label key={spec.field} className="block text-xs font-medium text-muted-foreground">
                {spec.label}
                <Input
                  className="mt-1"
                  type={spec.type === "date" ? "date" : spec.type === "number" ? "number" : "text"}
                  value={values[spec.field] ?? ""}
                  aria-label={spec.label}
                  onChange={(event) => setValues((prev) => ({ ...prev, [spec.field]: event.target.value }))}
                />
              </label>
            ))}
          </section>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit || isSaving} onClick={handleSubmit}>
            {isSaving ? "Saving..." : mode === "create" ? "Create order" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OrderEditorDialog;
