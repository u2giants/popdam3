import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { TRACKING_INPUTS, type TrackingInputKey } from "@/lib/order-integration";
import type { OrderTrackingRow } from "@/types/order-integration";

type Props = {
  row: OrderTrackingRow;
  isSaving: boolean;
  onClose: () => void;
  onSave: (row: OrderTrackingRow, changes: Record<string, unknown>) => Promise<unknown>;
};

function inputValue(value: unknown, kind: string): string {
  if (kind === "boolean") return value == null ? "" : value ? "true" : "false";
  return value == null ? "" : String(value);
}

export function OrderTrackingEditor({ row, isSaving, onClose, onSave }: Props) {
  const { isAdmin } = useIsAdmin();
  const [draft, setDraft] = useState<Partial<Record<TrackingInputKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  if (!isAdmin) return null;

  const change = (key: TrackingInputKey, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    try {
      setError(null);
      await onSave(row, draft as Record<string, unknown>);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save tracking changes.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isSaving) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>PO tracking · {row.production_order_number}</DialogTitle>
          <DialogDescription>Only changed manual tracking fields are saved. Derived dates, totals and product facts stay read-only.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {TRACKING_INPUTS.map((field) => {
            const current = Object.prototype.hasOwnProperty.call(draft, field.key)
              ? draft[field.key] ?? ""
              : inputValue(row[field.key], field.kind);
            return (
              <label className="space-y-1 text-sm" key={field.key}>
                <span>{field.label}</span>
                {field.kind === "boolean" ? (
                  <select aria-label={field.label} className="h-10 w-full rounded-md border border-input bg-background px-3" value={current} onChange={(event) => change(field.key, event.target.value)}>
                    <option value="">Unknown / not set</option><option value="true">Yes</option><option value="false">No</option>
                  </select>
                ) : (
                  <Input aria-label={field.label} type={field.kind === "number" ? "number" : field.kind} step={field.kind === "number" ? "any" : undefined} value={current} onChange={(event) => change(field.key, event.target.value)} />
                )}
              </label>
            );
          })}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isSaving} onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={isSaving || Object.keys(draft).length === 0} onClick={() => void submit()}>{isSaving ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OrderTrackingEditor;
