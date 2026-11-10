import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  parseBuySheetGrid,
  readBuySheetGrid,
  sha256Hex,
  type BuySheetGrid,
  type BuySheetParse,
} from "@/lib/buy-sheet-import";

type ResultLine = {
  sku: string;
  delivery_date: string;
  quantity: number;
  group: string;
  outcome: "new" | "updated" | "unchanged" | "held" | "skipped" | "revision";
  reason: string | null;
  order_number: string | null;
  previous_quantity: number | null;
  item_match: string;
};

type ImportResult = {
  applied: boolean;
  import_id: string | null;
  customer: string;
  counts: Record<string, number> | null;
  unmatched_styles: string[];
  lines: ResultLine[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
  customerOptions: Array<{ id: string; label: string }>;
};

const OUTCOME_LABEL: Record<ResultLine["outcome"], string> = {
  new: "New",
  updated: "Updated",
  unchanged: "Unchanged",
  held: "Held",
  skipped: "No quantity",
  revision: "Revision",
};

/** Raw sheet, kept with the import: formulas as text, values as written. */
function rawSheet(sheetName: string, grid: BuySheetGrid) {
  return {
    sheet: sheetName,
    rows: grid.map((row) => (row ?? []).map((c) => (c != null && typeof c === "object" ? `=${c.formula}` : c ?? null))),
  };
}

export function BuySheetImportDialog({ open, onClose, onApplied, customerOptions }: Props) {
  const defaultCustomer = useMemo(
    () => customerOptions.find((c) => c.label.trim().toLowerCase() === "burlington")?.id ?? "",
    [customerOptions],
  );
  const [customerId, setCustomerId] = useState("");
  const [file, setFile] = useState<{ name: string; sha: string; sheetName: string; grid: BuySheetGrid } | null>(null);
  const [parsed, setParsed] = useState<BuySheetParse | null>(null);
  const [orderNumbers, setOrderNumbers] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customer = customerId || defaultCustomer;

  const reset = () => {
    setFile(null);
    setParsed(null);
    setPreview(null);
    setOrderNumbers({});
    setError(null);
  };

  const call = async (apply: boolean, numbers = orderNumbers): Promise<ImportResult> => {
    if (!file || !parsed) throw new Error("Choose a buy sheet first.");
    const { data, error: rpcError } = await (supabase.rpc as any)("import_dam_buy_sheet", {
      p_customer_id: customer,
      p_file_name: file.name,
      p_file_sha256: file.sha,
      p_raw_sheet: apply ? { ...rawSheet(file.sheetName, file.grid), header_fields: parsed.headerFields } : {},
      p_lines: parsed.lines,
      p_order_numbers: Object.fromEntries(Object.entries(numbers).filter(([, v]) => v.trim())),
      p_apply: apply,
    });
    if (rpcError) throw rpcError;
    return data as ImportResult;
  };

  const runPreview = async (numbers = orderNumbers) => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await call(false, numbers));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (picked: File | undefined) => {
    reset();
    if (!picked) return;
    setBusy(true);
    try {
      const bytes = await picked.arrayBuffer();
      const [{ sheetName, grid }, sha] = await Promise.all([readBuySheetGrid(bytes), sha256Hex(bytes)]);
      const result = parseBuySheetGrid(grid);
      setFile({ name: picked.name, sha, sheetName, grid });
      setParsed(result);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await call(true);
      setPreview(result);
      const c = result.counts ?? {};
      toast.success(`Buy sheet imported: ${c.new ?? 0} new, ${c.updated ?? 0} updated, ${c.held ?? 0} held.`);
      onApplied();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const heldGroups = useMemo(() => {
    const groups = new Map<string, ResultLine[]>();
    for (const l of preview?.lines ?? []) {
      if (l.outcome === "held" && /order number/.test(l.reason ?? "")) groups.set(l.group, [...(groups.get(l.group) ?? []), l]);
    }
    for (const g of Object.keys(orderNumbers)) {
      if (!groups.has(g)) groups.set(g, (preview?.lines ?? []).filter((l) => l.group === g));
    }
    return [...groups.entries()].sort();
  }, [preview, orderNumbers]);

  const counts = preview?.counts ?? {};
  const isRevision = (counts.revision ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { reset(); onClose(); } }}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import customer buy sheet</DialogTitle>
          <DialogDescription>
            Upload a bulk buy sheet (Burlington purchase order worksheet). You see a preview first; nothing changes until you
            press Import. Each style and delivery becomes one OrderList line. A sheet that revises one already imported is stopped.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Customer
            <select
              aria-label="Customer"
              className="h-9 rounded-md border bg-background px-2"
              value={customer}
              onChange={(e) => { setCustomerId(e.target.value); setPreview(null); }}
            >
              <option value="">Choose customer</option>
              {customerOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Buy sheet (.xlsx)
            <Input aria-label="Buy sheet file" type="file" accept=".xlsx" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <Button type="button" disabled={!parsed || !customer || busy} onClick={() => void runPreview()}>
            Preview
          </Button>
        </div>

        {parsed && (
          <p className="text-sm text-muted-foreground">
            {parsed.itemRowCount} styles, {parsed.lines.filter((l) => l.quantity > 0).length} style-deliveries.{" "}
            {parsed.deliveries.map((d) => `${d.date}: ${(parsed.totalsByDelivery[d.date] ?? 0).toLocaleString()} units`).join(" · ")}
          </p>
        )}

        {error && <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}

        {preview && (
          <div className="space-y-3 text-sm">
            <p className="font-medium">
              {preview.applied ? "Imported" : "Preview"}: {counts.new ?? 0} new · {counts.updated ?? 0} updated · {counts.unchanged ?? 0} unchanged ·{" "}
              {counts.held ?? 0} held · {preview.unmatched_styles.length} styles not linked to Item Master
            </p>
            {isRevision && (
              <div role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive">
                Stop: this sheet revises a buy sheet that was already imported ({counts.revision} lines). Revised buy sheets
                are not supported yet, so nothing can be imported. Do not enter the changes by hand; report this sheet to
                Albert.
              </div>
            )}
            {preview.unmatched_styles.length > 0 && (
              <p className="text-amber-700">Not linked to Item Master (fix the style, then re-import): {preview.unmatched_styles.join(", ")}</p>
            )}

            {!preview.applied && heldGroups.length > 0 && (
              <div className="space-y-1 rounded border p-2">
                <p>These packs have no OrderList order yet. Type the order number (D-number) to create them, or leave blank to hold them:</p>
                {heldGroups.map(([group, lines]) => (
                  <label key={group} className="flex items-center gap-2">
                    <span className="w-72">Ship {group.split("|")[0]}, pack {group.split("|")[1]} ({lines.map((l) => l.sku).join(", ")})</span>
                    <Input
                      aria-label={`Order number for ${group}`}
                      className="h-8 w-32"
                      value={orderNumbers[group] ?? ""}
                      onChange={(e) => setOrderNumbers((prev) => ({ ...prev, [group]: e.target.value }))}
                      onBlur={() => void runPreview()}
                    />
                  </label>
                ))}
              </div>
            )}

            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-1">Result</th><th className="p-1">Order</th><th className="p-1">Style</th><th className="p-1">Ship</th>
                  <th className="p-1 text-right">Qty</th><th className="p-1 text-right">Was</th><th className="p-1">Item Master</th><th className="p-1">Why</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.filter((l) => l.outcome !== "skipped").map((l) => (
                  <tr key={`${l.sku}|${l.delivery_date}`} className="border-b">
                    <td className="p-1">{OUTCOME_LABEL[l.outcome]}</td>
                    <td className="p-1">{l.order_number ?? ""}</td>
                    <td className="p-1">{l.sku}</td>
                    <td className="p-1">{l.delivery_date}</td>
                    <td className="p-1 text-right">{l.quantity.toLocaleString()}</td>
                    <td className="p-1 text-right">{l.previous_quantity == null ? "" : Number(l.previous_quantity).toLocaleString()}</td>
                    <td className="p-1">{l.item_match === "matched" ? "linked" : l.item_match}</td>
                    <td className="p-1">{l.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Close</Button>
          <Button
            type="button"
            disabled={!preview || preview.applied || busy || isRevision || ((counts.new ?? 0) + (counts.updated ?? 0) === 0)}
            onClick={() => void apply()}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
