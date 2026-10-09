import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVendorStatistics } from "@/hooks/useOrderIntegration";

export function VendorStatisticsPanel() {
  const [page, setPage] = useState(0);
  const [vendorSearch, setVendorSearch] = useState("");
  const query = useVendorStatistics({ page, vendorSearch });
  return <section className="space-y-3" aria-label="Vendor Statistics">
    <div><h2 className="text-lg font-semibold">Vendor Statistics</h2><p className="text-sm text-muted-foreground">Read-only purchase order activity. Active means a sent order in the last 14 months.</p></div>
    <div className="flex gap-2"><Input className="max-w-sm" aria-label="Search vendors" maxLength={200} placeholder="Search vendor" value={vendorSearch} onChange={(event) => { setVendorSearch(event.target.value); setPage(0); }} /><Button variant="outline" onClick={() => void query.refetch()}>Refresh</Button></div>
    {query.isError && <div role="alert" className="flex items-center gap-2 text-sm text-destructive"><span>Could not load vendor statistics.</span><Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>}
    {query.isLoading ? <p className="text-sm text-muted-foreground">Loading vendor statistics…</p> : !query.isError && query.rows.length === 0 ? <p className="text-sm text-muted-foreground">No vendor statistics found.</p> : <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[950px] text-left text-sm"><thead className="bg-muted/60"><tr>{["Vendor", "Factory ID", "Total orders", "Closed", "Open", "Last sent PO", "14-month activity"].map((name) => <th key={name} className="p-2">{name}</th>)}</tr></thead><tbody>{query.rows.map((row) => <tr className="border-t" key={`${row.factory_id ?? "no-factory"}:${row.vendor_name.toLowerCase()}`}><td className="p-2">{row.vendor_name}</td><td className="p-2">{row.factory_id ?? "Unknown"}</td><td className="p-2">{row.order_count}</td><td className="p-2">{row.closed_orders}</td><td className="p-2">{row.open_orders}</td><td className="p-2">{row.last_sent_po_date ?? "Unknown"}</td><td className="p-2">{row.activity_status}</td></tr>)}</tbody></table></div>}
    <div className="flex items-center justify-end gap-2 text-sm"><span>Page {page + 1}</span><Button variant="outline" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="outline" disabled={!query.hasNextPage} onClick={() => setPage((current) => current + 1)}>Next</Button></div>
  </section>;
}

export default VendorStatisticsPanel;
