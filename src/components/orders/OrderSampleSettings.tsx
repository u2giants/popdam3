import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCustomerSuffixes, useSampleDepths } from "@/hooks/useOrderIntegration";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import type { CustomerSuffix, SampleDepth } from "@/types/order-integration";

function val(value: unknown): string { return value == null || value === "" ? "Unknown" : String(value); }

export function OrderSampleSettings({ onRowsChanged }: { onRowsChanged?: () => void } = {}) {
  const [depthPage, setDepthPage] = useState(0);
  const [suffixPage, setSuffixPage] = useState(0);
  const [skuSearch, setSkuSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [suffixSearch, setSuffixSearch] = useState("");
  const [depthTarget, setDepthTarget] = useState<SampleDepth | null | "new" | null>(null);
  const [suffixTarget, setSuffixTarget] = useState<CustomerSuffix | null | "new" | null>(null);
  const { isAdmin } = useIsAdmin();
  const depths = useSampleDepths({ page: depthPage, skuSearch, customerSearch });
  const suffixes = useCustomerSuffixes({ page: suffixPage, customerSearch: suffixSearch });

  const resetDepthSearch = (field: "sku" | "customer", value: string) => {
    if (field === "sku") setSkuSearch(value); else setCustomerSearch(value);
    setDepthPage(0);
  };
  const editDepth = async (values: { sku: string; customerName: string; depth: string }) => {
    await depths.upsertSampleDepth(values);
    setDepthTarget(null);
    onRowsChanged?.();
  };
  const editSuffix = async (values: { customerName: string; suffix: string }) => {
    await suffixes.upsertCustomerSuffix(values);
    setSuffixTarget(null);
    onRowsChanged?.();
  };

  return (
    <section className="space-y-8" aria-label="Sample Settings">
      <section className="space-y-3" aria-label="Sample depth settings">
        <div><h2 className="text-lg font-semibold">Sample depth</h2><p className="text-sm text-muted-foreground">Current order depth inputs by style and customer. Imported source values remain visible as history if the current value is cleared.</p></div>
        <div className="flex flex-wrap gap-2"><Input className="max-w-xs" aria-label="Search style number" maxLength={200} placeholder="Search style #" value={skuSearch} onChange={(event) => resetDepthSearch("sku", event.target.value)} /><Input className="max-w-xs" aria-label="Search depth customer" maxLength={200} placeholder="Search customer" value={customerSearch} onChange={(event) => resetDepthSearch("customer", event.target.value)} /><Button variant="outline" onClick={() => void depths.refetch()}>Refresh depths</Button>{isAdmin && <Button onClick={() => setDepthTarget("new")}>Add depth setting</Button>}</div>
        {depths.isError && <div role="alert" className="flex items-center gap-2 text-sm text-destructive"><span>Could not load sample depths.</span><Button variant="outline" onClick={() => void depths.refetch()}>Retry</Button></div>}
        {depths.isLoading ? <p className="text-sm text-muted-foreground">Loading sample depths…</p> : !depths.isError && depths.rows.length === 0 ? <p className="text-sm text-muted-foreground">No sample depth settings found.</p> : <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[950px] text-left text-sm"><thead className="bg-muted/60"><tr>{["Style #", "Customer", "Current depth (in)", "Source value history", "Source row", "Updated"].map((x) => <th key={x} className="p-2">{x}</th>)}{isAdmin && <th className="p-2">Action</th>}</tr></thead><tbody>{depths.rows.map((row) => <tr key={`${row.sku_normalized}:${row.customer_normalized}`} className="border-t"><td className="p-2">{row.sku_normalized}</td><td className="p-2">{row.customer_normalized}</td><td className="p-2">{val(row.depth_inches)}</td><td className="p-2">{val(row.depth_raw)}{row.source_workbook_id && <span className="ml-1 text-xs text-muted-foreground">(import history)</span>}</td><td className="p-2">{val(row.source_row_number)}</td><td className="p-2">{new Date(row.updated_at).toLocaleDateString()}</td>{isAdmin && <td className="p-2"><Button size="sm" variant="outline" onClick={() => setDepthTarget(row)}>Edit</Button></td>}</tr>)}</tbody></table></div>}
        <Pager page={depthPage} hasNextPage={depths.hasNextPage} setPage={setDepthPage} />
      </section>

      <section className="space-y-3" aria-label="Customer suffix settings">
        <div><h2 className="text-lg font-semibold">Customer suffix</h2><p className="text-sm text-muted-foreground">A suffix is required and cannot be cleared. Update it to change the value used for matching.</p></div>
        <div className="flex flex-wrap gap-2"><Input className="max-w-xs" aria-label="Search suffix customer" maxLength={200} placeholder="Search customer" value={suffixSearch} onChange={(event) => { setSuffixSearch(event.target.value); setSuffixPage(0); }} /><Button variant="outline" onClick={() => void suffixes.refetch()}>Refresh suffixes</Button>{isAdmin && <Button onClick={() => setSuffixTarget("new")}>Add customer suffix</Button>}</div>
        {suffixes.isError && <div role="alert" className="flex items-center gap-2 text-sm text-destructive"><span>Could not load customer suffixes.</span><Button variant="outline" onClick={() => void suffixes.refetch()}>Retry</Button></div>}
        {suffixes.isLoading ? <p className="text-sm text-muted-foreground">Loading customer suffixes…</p> : !suffixes.isError && suffixes.rows.length === 0 ? <p className="text-sm text-muted-foreground">No customer suffix settings found.</p> : <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-muted/60"><tr>{["Customer", "Suffix", "Updated"].map((x) => <th key={x} className="p-2">{x}</th>)}{isAdmin && <th className="p-2">Action</th>}</tr></thead><tbody>{suffixes.rows.map((row) => <tr key={row.customer_normalized} className="border-t"><td className="p-2">{row.customer_normalized}</td><td className="p-2">{row.suffix}</td><td className="p-2">{new Date(row.updated_at).toLocaleDateString()}</td>{isAdmin && <td className="p-2"><Button size="sm" variant="outline" onClick={() => setSuffixTarget(row)}>Edit</Button></td>}</tr>)}</tbody></table></div>}
        <Pager page={suffixPage} hasNextPage={suffixes.hasNextPage} setPage={setSuffixPage} />
      </section>
      {depthTarget !== null && <DepthEditor target={depthTarget} saving={depths.isSaving} onClose={() => setDepthTarget(null)} onSave={editDepth} />}
      {suffixTarget !== null && <SuffixEditor target={suffixTarget} saving={suffixes.isSaving} onClose={() => setSuffixTarget(null)} onSave={editSuffix} />}
    </section>
  );
}

function Pager({ page, hasNextPage, setPage }: { page: number; hasNextPage: boolean; setPage: (value: number | ((previous: number) => number)) => void }) {
  return <div className="flex justify-end items-center gap-2 text-sm"><span>Page {page + 1}</span><Button variant="outline" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Previous</Button><Button variant="outline" disabled={!hasNextPage} onClick={() => setPage((n) => n + 1)}>Next</Button></div>;
}

function DepthEditor({ target, saving, onClose, onSave }: { target: SampleDepth | "new"; saving: boolean; onClose: () => void; onSave: (values: { sku: string; customerName: string; depth: string }) => Promise<void> }) {
  const [sku, setSku] = useState(target === "new" ? "" : target.sku_normalized);
  const [customer, setCustomer] = useState(target === "new" ? "" : target.customer_normalized);
  const [depth, setDepth] = useState(target === "new" ? "" : target.depth_inches == null ? "" : String(target.depth_inches));
  const [error, setError] = useState<string | null>(null);
  const save = async () => { try { setError(null); await onSave({ sku, customerName: customer, depth }); } catch (e) { setError(e instanceof Error ? e.message : "Could not save sample depth."); } };
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{target === "new" ? "Add sample depth" : "Edit sample depth"}</DialogTitle><DialogDescription>Enter a positive depth or leave it blank to clear the current value. Source history is retained.</DialogDescription></DialogHeader>
    <label className="block text-sm">Style #<Input aria-label="Depth style number" value={sku} onChange={(e) => setSku(e.target.value)} /></label><label className="block text-sm">Customer<Input aria-label="Depth customer" value={customer} onChange={(e) => setCustomer(e.target.value)} /></label><label className="block text-sm">Depth in inches<Input aria-label="Depth inches" type="number" step="any" value={depth} onChange={(e) => setDepth(e.target.value)} /></label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save depth"}</Button></DialogFooter></DialogContent></Dialog>;
}

function SuffixEditor({ target, saving, onClose, onSave }: { target: CustomerSuffix | "new"; saving: boolean; onClose: () => void; onSave: (values: { customerName: string; suffix: string }) => Promise<void> }) {
  const [customer, setCustomer] = useState(target === "new" ? "" : target.customer_normalized);
  const [suffix, setSuffix] = useState(target === "new" ? "" : target.suffix);
  const [error, setError] = useState<string | null>(null);
  const save = async () => { try { setError(null); await onSave({ customerName: customer, suffix }); } catch (e) { setError(e instanceof Error ? e.message : "Could not save customer suffix."); } };
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{target === "new" ? "Add customer suffix" : "Edit customer suffix"}</DialogTitle><DialogDescription>Suffix cannot be blank. Enter 1 to 50 characters.</DialogDescription></DialogHeader>
    <label className="block text-sm">Customer<Input aria-label="Suffix customer" value={customer} onChange={(e) => setCustomer(e.target.value)} /></label><label className="block text-sm">Suffix<Input aria-label="Customer suffix" maxLength={50} required value={suffix} onChange={(e) => setSuffix(e.target.value)} /></label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button type="button" disabled={saving || !suffix.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save suffix"}</Button></DialogFooter></DialogContent></Dialog>;
}

export default OrderSampleSettings;
