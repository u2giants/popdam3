import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useOrderTracking } from "@/hooks/useOrderIntegration";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import type { OrderTrackingComponent, OrderTrackingRow } from "@/types/order-integration";
import { OrderTrackingEditor } from "./OrderTrackingEditor";

function shown(value: unknown): string {
  return value == null || value === "" ? "Unknown" : String(value);
}

function flag(value: boolean | null): string {
  return value === true ? "Yes" : value === false ? "No" : "Unknown";
}

function workflowSource(value: OrderTrackingComponent["workflow_source"]): string {
  switch (value) {
    case "master_data": return "Master Data";
    case "at_import": return "At import";
    case "ambiguous": return "Conflicting Master Data";
    case "unavailable":
    default: return "Unknown";
  }
}

function complete(lineCount: number, missing: number | null | undefined): string {
  if (lineCount === 0) return "No order lines";
  if (missing == null) return "Unknown";
  return missing === 0 ? "Yes" : `No (${missing} missing)`;
}

function ComponentDetails({ component }: { component: OrderTrackingComponent }) {
  return (
    <div className="min-w-[900px] overflow-x-auto rounded-md border p-3 text-xs">
      <div className="grid grid-cols-4 gap-x-4 gap-y-2 md:grid-cols-6">
        <Fact label="Style #" value={component.sku} />
        <Fact label="Item Master description" value={component.description} />
        <Fact label="Licensing" value={component.license_status} />
        <Fact label="Workflow source" value={workflowSource(component.workflow_source)} />
        <Fact label="Default vendor" value={component.default_vendor} />
        <Fact label="Sample vendor" value={component.sample_vendor} />
        <Fact label="Current sample depth (in)" value={component.sample_depth_inches} />
        <Fact label="Imported depth history" value={component.sample_depth_raw} />
        <Fact label="Depth source row" value={component.sample_depth_source_row} />
        <Fact label="Current test report" value={component.test_report} />
        <Fact label="Current professional photos" value={component.professional_photos} />
        <Fact label="Current reorder" value={flag(component.contractual_sample_reorder)} />
        <Fact label="Quantity" value={component.quantity} />
        <Fact label="Case pack" value={component.case_pack} />
        <Fact label="Cases" value={component.cases} />
        <Fact label="Cases error" value={component.cases_error} />
        <Fact label="Assortment parent quantity" value={component.parent_quantity} />
        <Fact label="Assortment parent cases" value={component.parent_cases} />
      </div>
      <details className="mt-3 border-t pt-2">
        <summary className="cursor-pointer font-medium">Import history (not current product status)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Fact label="Test report at import" value={flag(component.snapshot_test_report === "Yes" ? true : component.snapshot_test_report === "No" ? false : null)} />
          <Fact label="Photos at import" value={flag(component.snapshot_professional_photos === "Yes" ? true : component.snapshot_professional_photos === "No" ? false : null)} />
          <Fact label="Reorder at import" value={flag(component.snapshot_contractual_sample_reorder)} />
        </div>
      </details>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: unknown }) {
  return <div><span className="text-muted-foreground">{label}: </span><span>{shown(value)}</span></div>;
}

export function POTrackingPanel({ onRowsChanged }: { onRowsChanged?: () => void }) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [selected, setSelected] = useState<OrderTrackingRow | null>(null);
  const tableScroller = useRef<HTMLDivElement>(null);
  const { isAdmin } = useIsAdmin();
  const query = useOrderTracking({ page, search, onlyOpen, onRowsChanged });
  const selectedCurrent = selected
    ? query.rows.find((row) => row.order_id === selected.order_id) ?? selected
    : null;
  const save = async (row: OrderTrackingRow, changes: Record<string, unknown>) => {
    await query.saveTracking({ orderId: row.order_id, original: row, changed: changes });
  };
  return (
    <section className="space-y-3" aria-label="PO Tracking">
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-sm" aria-label="Search tracking" maxLength={200} placeholder="Search PO, customer, or vendor" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
        <label className="flex items-center gap-2 text-sm"><Switch checked={onlyOpen} onCheckedChange={(checked) => { setOnlyOpen(checked); setPage(0); }} />Open orders only</label>
        <Button variant="outline" onClick={() => void query.refetch()}>Refresh</Button>
        {query.isFetching && <span className="text-xs text-muted-foreground">Refreshing…</span>}
      </div>
      {query.isError && <div role="alert" className="flex items-center gap-3 text-sm text-destructive"><span>Could not load PO tracking.</span><Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>}
      {query.isLoading ? <p className="text-sm text-muted-foreground">Loading tracking…</p> : !query.isError && query.rows.length === 0 ? <p className="text-sm text-muted-foreground">No matching purchase orders.</p> : (
        <>
        <div className="flex items-center justify-between gap-3 rounded-t-md border border-b-0 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>More tracking details are to the right. Scroll sideways to see them.</span>
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="outline" aria-label="Scroll tracking table left" onClick={() => tableScroller.current?.scrollBy({ left: -600, behavior: "smooth" })}>← Back</Button>
            <Button size="sm" variant="outline" aria-label="Show more tracking columns" onClick={() => tableScroller.current?.scrollBy({ left: 600, behavior: "smooth" })}>More →</Button>
          </div>
        </div>
        <div ref={tableScroller} tabIndex={0} aria-label="PO tracking table; scroll sideways to see all columns" className="overflow-x-auto rounded-b-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <table className="min-w-[1600px] w-full text-left text-xs"><thead className="bg-muted/60"><tr>{["PO / details", "Vendor", "Customer", "Type", "Total cases", "Unknown case groups", "CRD", "Forecast", "Forecast status", "ETA", "WHS", "Delay", "Delay status", "Worksheet days", "Test reports", "Professional photos", "Inspection", "Booking / MBL", "Tracking"].map((name) => <th className="whitespace-nowrap p-2" key={name}>{name}</th>)}</tr></thead>
            <tbody>{query.rows.map((row) => <tr className="border-t align-top" key={row.order_id}>
              <td className="whitespace-nowrap p-2"><Button variant="link" className="h-auto p-0" onClick={() => setSelected(row)}>{row.production_order_number}</Button><div>{row.line_count === 0 ? "No order lines" : `${row.line_count} lines`}</div><div>{row.components?.length ?? 0} components</div></td>
              <td className="whitespace-nowrap p-2">{shown(row.vendor_name)}</td><td className="whitespace-nowrap p-2">{shown(row.customer_name)}</td><td className="whitespace-nowrap p-2">{shown(row.order_type)}</td>
              <td className="whitespace-nowrap p-2">{shown(row.total_cases)}</td><td className="whitespace-nowrap p-2">{shown(row.unknown_case_groups)}</td><td className="whitespace-nowrap p-2">{shown(row.vendor_delivery_date)}</td><td className="whitespace-nowrap p-2">{shown(row.seal_container_forecast)}</td><td className="whitespace-nowrap p-2">{shown(row.seal_container_forecast_status)}</td><td className="whitespace-nowrap p-2">{shown(row.eta)}</td><td className="whitespace-nowrap p-2">{shown(row.warehouse_date)}</td><td className="whitespace-nowrap p-2">{shown(row.days_delay)}</td><td className="whitespace-nowrap p-2">{shown(row.days_delay_status)}</td><td className="whitespace-nowrap p-2">{shown(row.worksheet_days_remaining)}</td><td className="whitespace-nowrap p-2">{complete(row.line_count, row.missing_test_reports)}</td><td className="whitespace-nowrap p-2">{complete(row.line_count, row.missing_photos)}</td><td className="whitespace-nowrap p-2">{shown(row.inspection_passed)}</td><td className="whitespace-nowrap p-2">{shown(row.booking_string ?? row.container_booking_group)} / {shown(row.mbl)}</td><td className="whitespace-nowrap p-2">{isAdmin && <Button size="sm" variant="outline" onClick={() => setSelected(row)}>Edit</Button>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        </>
      )}
      <div className="flex items-center justify-end gap-2 text-sm"><span>Page {page + 1}</span><Button variant="outline" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="outline" disabled={!query.hasNextPage} onClick={() => setPage((current) => current + 1)}>Next</Button></div>
      {selectedCurrent && <DialogBridge row={selectedCurrent} isSaving={query.isSaving} onClose={() => setSelected(null)} onSave={save} isAdmin={isAdmin} />}
    </section>
  );
}

function DialogBridge({ row, isSaving, onClose, onSave, isAdmin }: { row: OrderTrackingRow; isSaving: boolean; onClose: () => void; onSave: (row: OrderTrackingRow, changes: Record<string, unknown>) => Promise<unknown>; isAdmin: boolean }) {
  const [editing, setEditing] = useState(false);
  const components = row.components ?? [];
  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-label={`PO details ${row.production_order_number}`}><div className="max-h-[90vh] w-full max-w-6xl space-y-3 overflow-auto rounded-lg bg-background p-5 shadow-xl">
    <div className="flex justify-between"><h2 className="text-lg font-semibold">PO details · {row.production_order_number}</h2><Button variant="outline" onClick={onClose}>Close</Button></div>
    <div className="grid gap-2 text-sm sm:grid-cols-4"><Fact label="PO sent" value={row.sent_po_date} /><Fact label="CRD" value={row.vendor_delivery_date} /><Fact label="Booking state" value={row.booking_state} /><Fact label="ETD" value={row.etd} /><Fact label="ETA" value={row.eta} /><Fact label="Container booking group" value={row.container_booking_group} /><Fact label="MBL" value={row.mbl} /><Fact label="Close tracking" value={flag(row.close_tracking)} /><Fact label="Agent" value={row.agent} /><Fact label="CBM" value={row.cbm} /><Fact label="Comment" value={row.comment} /><Fact label="Vessel" value={row.vessel} /><Fact label="Sent to ColdLion" value={flag(row.sent_to_coldlion)} /><Fact label="Worksheet done" value={flag(row.worksheet_done)} /><Fact label="Inspection passed" value={row.inspection_passed} /><Fact label="Inspection note" value={row.inspection_note} /><Fact label="Invoice" value={flag(row.document_invoice)} /><Fact label="Packing list" value={flag(row.document_packing_list)} /><Fact label="Bill of lading" value={flag(row.document_bill_of_lading)} /><Fact label="TSCA" value={flag(row.document_tsca)} /><Fact label="Lacey Act" value={flag(row.document_lacey_act)} /><Fact label="Telex" value={flag(row.document_telex)} /><Fact label="Wire request" value={flag(row.request_wire)} /><Fact label="Payment note" value={row.payment_note} /><Fact label="Product lines unresolved" value={row.unresolved_product_lines} /></div>
    {row.line_count > 0 && row.missing_test_reports === 0 && row.missing_photos === 0 ? null : <p className="text-sm">Current report completeness: {complete(row.line_count, row.missing_test_reports)} · Current photo completeness: {complete(row.line_count, row.missing_photos)}</p>}
    <h3 className="font-semibold">Components</h3>{components.length ? components.map((component) => <ComponentDetails key={component.line_id} component={component} />) : <p className="text-sm text-muted-foreground">No order lines.</p>}
    {isAdmin && <Button variant="outline" onClick={() => setEditing(true)}>Edit PO tracking</Button>}
    {editing && <OrderTrackingEditor key={row.order_id} row={row} isSaving={isSaving} onClose={() => setEditing(false)} onSave={onSave} />}
  </div></div>;
}

export default POTrackingPanel;
