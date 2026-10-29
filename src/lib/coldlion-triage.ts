/**
 * ColdLion reconciliation triage (popcre/shared-db#5004).
 *
 * Owner request, Albert Hazan, 2026-10-28: "i need a triage section for yuchen
 * to be able to easily see everything that needs to be reconciled and an easy
 * way to reconcile it, being guided". api.dam_order_list flags the three kinds
 * of item; public.resolve_coldlion_triage applies each decision.
 */

export type TriageRow = {
  order_line_id: string;
  order_id: string;
  production_order_number: string | null;
  customer_name: string | null;
  customer_po_number: string | null;
  sku: string | null;
  quantity_ordered: number | null;
  coldlion_quantity_ordered: number | null;
  coldlion_import_po: string | null;
  coldlion_unmatched: boolean | null;
  coldlion_source_id: string | null;
  google_source_id: string | null;
  line_voided_at: string | null;
};

export type TriageKind = "quantity" | "import_po" | "unmatched";

export type TriageItem = {
  key: string;
  kind: TriageKind;
  row: TriageRow;
};

export type TriageAction =
  | "keep_google_quantity"
  | "use_coldlion_quantity"
  | "keep_google_import_po"
  | "use_coldlion_import_po"
  | "link_google_line"
  | "keep_separate";

export const TRIAGE_SELECT = [
  "order_line_id",
  "order_id",
  "production_order_number",
  "customer_name",
  "customer_po_number",
  "sku",
  "quantity_ordered",
  "coldlion_quantity_ordered",
  "coldlion_import_po",
  "coldlion_unmatched",
  "coldlion_source_id",
  "google_source_id",
  "line_voided_at",
].join(",");

export const TRIAGE_KIND_LABEL: Record<TriageKind, string> = {
  quantity: "Quantity mismatch",
  import_po: "Import PO mismatch",
  unmatched: "No matching Google line",
};

/** One line can need two decisions (quantity and Import PO): each is its own item. */
export function buildTriageItems(rows: TriageRow[]): TriageItem[] {
  const items: TriageItem[] = [];
  for (const row of rows) {
    if (row.coldlion_quantity_ordered != null) items.push({ key: `${row.order_line_id}:quantity`, kind: "quantity", row });
    if (row.coldlion_import_po) items.push({ key: `${row.order_line_id}:import_po`, kind: "import_po", row });
    if (row.coldlion_unmatched) items.push({ key: `${row.order_line_id}:unmatched`, kind: "unmatched", row });
  }
  const rank: Record<TriageKind, number> = { quantity: 0, import_po: 1, unmatched: 2 };
  return items.sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] ||
      (a.row.customer_po_number ?? "").localeCompare(b.row.customer_po_number ?? "") ||
      (a.row.sku ?? "").localeCompare(b.row.sku ?? ""),
  );
}

/** "coldlion:so:7128092:line:3:component:1" → "ColdLion order 7128092, line 3". */
export function describeColdLionSource(sourceId: string | null): string | null {
  const match = /^coldlion:so:(\d+):line:(\d+)/.exec(sourceId ?? "");
  return match ? `ColdLion order ${match[1]}, line ${match[2]}` : null;
}

const poKey = (po: string | null) => (po ?? "").trim().replace(/^0+/, "").toLowerCase();

/**
 * Google lines that could be the unmatched ColdLion line: same SKU, still open,
 * and not already carrying a ColdLion line. The same customer PO (ignoring
 * leading zeros, as the automatic merge does) comes first.
 */
export function rankLinkCandidates(item: TriageRow, rows: TriageRow[]): Array<TriageRow & { samePo: boolean }> {
  return rows
    .filter((row) => row.google_source_id && !row.coldlion_source_id && !row.line_voided_at && row.order_line_id !== item.order_line_id)
    .map((row) => ({ ...row, samePo: poKey(row.customer_po_number) !== "" && poKey(row.customer_po_number) === poKey(item.customer_po_number) }))
    .sort(
      (a, b) =>
        Number(b.samePo) - Number(a.samePo) ||
        (a.production_order_number ?? "").localeCompare(b.production_order_number ?? ""),
    );
}

export const formatQuantity = (value: number | null) =>
  value == null ? "blank" : Number(value).toLocaleString("en-US");
