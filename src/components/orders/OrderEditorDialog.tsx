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
import { coerceFieldValueStrict, patchKeyFor } from "@/lib/order-list";
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

/**
 * Voiding is how a correction is made: the contract has no delete RPC, so an
 * order that should not exist is voided with a reason and its history survives.
 * `api.dam_order_list` does NOT filter voided rows out, so a voided order stays
 * visible in the grid, marked as voided, and can be restored from here.
 */
export type OrderVoidRequest = { voided: boolean; void_reason: string | null };

type Props = {
  mode: OrderEditorMode;
  row: OrderListRow | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (payload: { order: OrderHeaderPatch; line: OrderLinePatch }) => void;
  onSetVoided?: (request: OrderVoidRequest) => void;
};

function initialValues(row: OrderListRow | null) {
  const values: Record<string, string> = {};
  for (const spec of HEADER_FIELDS) values[spec.field] = row ? String((row as any)[spec.field] ?? "") : "";
  for (const spec of LINE_FIELDS) values[spec.field] = row ? String((row as any)[spec.field] ?? "") : "";
  return values;
}

/**
 * Create or edit one order and its line. Validation happens before the call so a
 * bad value is refused here rather than turning into a database error -- or, worse,
 * into a silent `null` that erases the field it was meant to change.
 */
export function OrderEditorDialog({ mode, row, isSaving, onClose, onSubmit, onSetVoided }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(row));
  const [error, setError] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [confirmingVoid, setConfirmingVoid] = useState(false);

  const isVoided = Boolean(row?.order_voided_at);
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

    // Refuse anything that cannot be parsed, rather than writing it away as null.
    const order: OrderHeaderPatch = {};
    const line: OrderLinePatch = {};
    try {
      for (const spec of HEADER_FIELDS) {
        (order as any)[patchKeyFor(spec.field)] = coerceFieldValueStrict(spec.field, values[spec.field]);
      }
      for (const spec of LINE_FIELDS) {
        (line as any)[patchKeyFor(spec.field)] = coerceFieldValueStrict(spec.field, values[spec.field]);
      }
    } catch (validationError) {
      setError((validationError as Error).message);
      return;
    }

    setError(null);
    onSubmit({ order, line });
  }

  function handleVoid() {
    if (!onSetVoided) return;
    const reason = voidReason.trim();
    if (!reason) {
      setError("Say why this order is being voided, so the record explains itself later.");
      return;
    }
    setError(null);
    onSetVoided({ voided: true, void_reason: reason });
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

        {isVoided && (
          <div className="rounded-md border border-amber-500/50 bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            This order is <strong>voided</strong>
            {row?.order_void_reason ? <> &mdash; {row.order_void_reason}</> : null}. It stays in OrderList as history.
            Restore it to put it back in use.
          </div>
        )}

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

        {mode === "edit" && onSetVoided && confirmingVoid && !isVoided && (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm font-medium text-destructive">Void this order?</p>
            <p className="text-xs text-muted-foreground">
              Nothing is deleted. The order stays in OrderList marked as voided, and can be restored.
            </p>
            <Input
              value={voidReason}
              aria-label="Void reason"
              placeholder="Why is this being voided?"
              onChange={(event) => setVoidReason(event.target.value)}
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            {mode === "edit" && onSetVoided && !isVoided && (
              <Button
                type="button"
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/10"
                disabled={isSaving}
                onClick={() => (confirmingVoid ? handleVoid() : setConfirmingVoid(true))}
              >
                {confirmingVoid ? "Confirm void" : "Void order"}
              </Button>
            )}
            {mode === "edit" && onSetVoided && isVoided && (
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => onSetVoided({ voided: false, void_reason: null })}
              >
                Restore order
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={!canSubmit || isSaving} onClick={handleSubmit}>
              {isSaving ? "Saving..." : mode === "create" ? "Create order" : "Save changes"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OrderEditorDialog;
