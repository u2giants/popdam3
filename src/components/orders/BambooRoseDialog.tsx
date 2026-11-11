import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { buildBambooRoseRows, fillBambooRoseTemplate, type OrderListFact } from "@/lib/bamboo-rose-sheet";
import { parseBuySheetGrid, readBuySheetGrid, type BuySheetParse } from "@/lib/buy-sheet-import";

type Props = { open: boolean; onClose: () => void };

/**
 * Burlington Bamboo Rose quote sheet in three steps: the HFC buy sheet (already
 * imported into OrderList), this week's blank template from Bamboo Rose, then
 * download. The HFC links the sheet to its OrderList lines by style + ship date.
 */
export function BambooRoseDialog({ open, onClose }: Props) {
  const [hfc, setHfc] = useState<{ name: string; parsed: BuySheetParse } | null>(null);
  const [template, setTemplate] = useState<File | null>(null);
  const [opts, setOpts] = useState({ buyer: "ANNA BATMAN", vendorEmail: "jsafdieh@popcre.com", packSuffix: "V2" });
  const [checks, setChecks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setHfc(null);
    setTemplate(null);
    setChecks([]);
    setError(null);
    onClose();
  };

  const pickHfc = async (file: File | undefined) => {
    setHfc(null);
    setChecks([]);
    setError(null);
    if (!file) return;
    try {
      const { grid } = await readBuySheetGrid(await file.arrayBuffer());
      setHfc({ name: file.name, parsed: parseBuySheetGrid(grid) });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const download = async () => {
    if (!hfc || !template) return;
    setBusy(true);
    setError(null);
    try {
      const { parsed } = hfc;
      const { data: facts, error: factError } = await (supabase as any)
        .schema("api")
        .from("dam_order_list")
        .select("sku,start_ship_date,assortment_id,ship_to,vendor_name")
        .eq("customer_name", "Burlington")
        .in("sku", [...new Set(parsed.lines.map((l) => l.sku))])
        .in("start_ship_date", [...new Set(parsed.lines.map((l) => l.delivery_date))]);
      if (factError) throw factError;
      if (!facts?.length) {
        throw new Error("This HFC is not in OrderList yet. Close this, use \"Import buy sheet\" with the same HFC first, then come back.");
      }
      const { rows, checks: notes } = buildBambooRoseRows(parsed, facts as OrderListFact[], opts);
      const bytes = await fillBambooRoseTemplate(await template.arrayBuffer(), rows);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bamboo Rose - ${hfc.name.replace(/\.xlsx$/i, "")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setChecks(notes);
      toast.success(`Bamboo Rose sheet downloaded: ${rows.length} rows.`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const step = "flex flex-col gap-1 rounded border p-3";
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Burlington Bamboo Rose sheet</DialogTitle>
          <DialogDescription>
            Fills Burlington's Bamboo Rose sheet for one HFC. Import the HFC with Burlington → "Import buy sheet (HFC)" first. Carton sizes,
            weights, materials, inner packs and pallets stay blank to fill by hand.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <label className={step}>
            <span className="font-medium">1. The HFC buy sheet</span>
            <Input aria-label="HFC buy sheet" type="file" accept=".xlsx" onChange={(e) => void pickHfc(e.target.files?.[0])} />
            {hfc && <span className="text-muted-foreground">{hfc.name}: {hfc.parsed.itemRowCount} styles, {hfc.parsed.deliveries.length} ship dates</span>}
          </label>

          <label className={step}>
            <span className="font-medium">2. This week's blank Bamboo Rose sheet</span>
            <span className="text-muted-foreground">Download a fresh one from Bamboo Rose each time.</span>
            <Input aria-label="Blank Bamboo Rose sheet" type="file" accept=".xlsx" onChange={(e) => setTemplate(e.target.files?.[0] ?? null)} />
          </label>

          <div className={step}>
            <span className="font-medium">3. Check these, then download</span>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1">Buyer
                <Input aria-label="Buyer" className="h-8 w-44" value={opts.buyer} onChange={(e) => setOpts({ ...opts, buyer: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">Vendor email
                <Input aria-label="Vendor email" className="h-8 w-56" value={opts.vendorEmail} onChange={(e) => setOpts({ ...opts, vendorEmail: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">Pack name ending
                <Input aria-label="Pack name ending" className="h-8 w-20" value={opts.packSuffix} onChange={(e) => setOpts({ ...opts, packSuffix: e.target.value })} />
              </label>
            </div>
            <Button type="button" className="mt-2 w-fit" disabled={!hfc || !template || busy} onClick={() => void download()}>
              {busy ? "Working…" : "Download filled Bamboo Rose sheet"}
            </Button>
          </div>

          {error && <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive">{error}</div>}
          {checks.length > 0 && (
            <div className="text-amber-700">
              <p>Please check:</p>
              <ul className="list-disc pl-5">{checks.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
