// /orderHistory -> coldlion.order_history_line + _component + _invoice_ref + _pick_ticket_ref
//
// The vendor NEVER returns the parent line. It returns the line already exploded into
// component SKUs with the parent totals REPEATED VERBATIM on every component row. So:
//
//   * the parent is SYNTHESISED, one per (salesOrderNo, salesOrderLineNo, itemNo,
//     line_source_hash), and its totals are stored ONCE;
//   * lineQty / prepackQty / lineCancelledQty are parent totals and are never summed
//     across components — a repeated quantity on sibling rows is a header field, not a
//     multiplication;
//   * orderQty / invoiceQty / linePrice are per-design and live on the component;
//   * merchGroup01-06 live on the COMPONENT, not the line: D14 (2026-09-01) narrowed D2
//     because on an exploded prepack row they vary per component.
//
// Order + line number alone is NOT business identity: ColdLion reassigns line numbers
// across documents. The identity therefore includes the item and the line-grain hash,
// and two differing projections of one line are two VERSIONS, never one merged row.

import { randomUUID } from "node:crypto";
import { EXCLUDED_DIVISION } from "./scopes.mjs";
import { EMPTY_DATE_MARKER, bigint, date, num, sourceHash, splitTokens, text } from "./values.mjs";

/** Line-grain projection: every approved field proven constant across components. */
export function projectLine(row) {
  return {
    company_code: text(row.companyCode),
    sales_order_no: bigint(row.salesOrderNo),
    sales_order_line_no: bigint(row.salesOrderLineNo),
    master_item_no: text(row.itemNo),
    label_code: text(row.labelCode),
    pre_pack_code: text(row.prePackCode),
    division_code: text(row.divisionCode),
    customer_code: text(row.customerCode),
    customer_desc: text(row.customerDesc),
    po_number: text(row.poNumber),
    sales_person_code1: text(row.salesPersonCode1),
    start_date: date(row.startDate),
    cancel_date: date(row.cancelDate),
    line_qty: num(row.lineQty),
    line_cancelled_qty: num(row.lineCancelledQty),
    prepack_qty: num(row.prepackQty),
    item_desc: text(row.itemDesc),
    short_item_no: text(row.shortItemNo),
    brand_assurance_no: text(row.brandAssuranceNo),
    warehouse_code: text(row.warehouseCode),
    prod_cost: num(row.prodCost),
    prod_reference_no: text(row.prodReferenceNo),
  };
}

/**
 * ColdLion's own entry/edit stamps for the sales-order line (owner request, Albert Hazan,
 * 2026-10-09: ColdLion added createdTime/createdUser/modTime/modUser to /orderHistory so
 * the sales-order received time can be compared with the production-PO created time).
 *
 * Deliberately OUTSIDE projectLine and therefore outside line_source_hash: modTime moves
 * on every edit, and hashing it would turn each edit into a new line version. The vendor
 * sends a zone-less wall-clock time ("2026-03-27 11:37:34.557"); it is landed as that
 * wall clock read as UTC, the same convention plm."ProdOrderHeader"."createdTime" carries,
 * so the two ColdLion clocks compare directly. Never parsed in the machine's local zone.
 */
export function wallClockTimestamp(value) {
  const raw = text(value);
  if (raw === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)(Z|[+-]\d{2}:?\d{2})?$/.exec(raw);
  if (!match) throw new Error("a timestamp field was not an ISO timestamp");
  if (match[1] <= EMPTY_DATE_MARKER) return null;
  const parsed = new Date(`${match[1]}T${match[2]}${match[3] ?? "Z"}`);
  if (Number.isNaN(parsed.valueOf())) throw new Error("a timestamp field was not an ISO timestamp");
  return parsed.toISOString();
}

export function projectLineStamps(row) {
  return {
    created_time: wallClockTimestamp(row.createdTime),
    created_user: text(row.createdUser),
    mod_time: wallClockTimestamp(row.modTime),
    mod_user: text(row.modUser),
  };
}

/** Earliest creation and latest modification across the components of one line. */
export function mergeLineStamps(into, stamps) {
  if (stamps.created_time !== null && (into.created_time === null || stamps.created_time < into.created_time)) {
    into.created_time = stamps.created_time;
    into.created_user = stamps.created_user;
  }
  if (stamps.mod_time !== null && (into.mod_time === null || stamps.mod_time > into.mod_time)) {
    into.mod_time = stamps.mod_time;
    into.mod_user = stamps.mod_user;
  }
}

/** Component-grain projection: the per-design facts and the verbatim document lists. */
export function projectComponent(row) {
  return {
    sub_item_no: text(row.subItemNo),
    sub_label_code: text(row.subLabelCode),
    sub_upc: text(row.subUpc),
    line_price: num(row.linePrice),
    quantity: num(row.quantity),
    order_qty: num(row.orderQty),
    invoice_qty: num(row.invoiceQty),
    ship_qty: num(row.shipQty),
    order_amount: num(row.orderAmount),
    ship_amount: num(row.shipAmount),
    sub_merch_group01: text(row.subMerchGroup01),
    sub_merch_group02: text(row.subMerchGroup02),
    sub_merch_group03: text(row.subMerchGroup03),
    sub_merch_group04: text(row.subMerchGroup04),
    sub_merch_group05: text(row.subMerchGroup05),
    sub_merch_group06: text(row.subMerchGroup06),
    merch_group01: text(row.merchGroup01),
    merch_group02: text(row.merchGroup02),
    merch_group03: text(row.merchGroup03),
    merch_group04: text(row.merchGroup04),
    merch_group05: text(row.merchGroup05),
    merch_group06: text(row.merchGroup06),
    invoice_no_string: text(row.invoiceNoString),
    invoice_date_string: text(row.invoiceDateString),
    pick_ticket_no_string: text(row.pickTicketNoString),
  };
}

/**
 * Split the two parallel invoice lists.
 *
 * The date is aligned by ordinal ONLY when the number and date lists have equal
 * cardinality. Where they do not, both ordered lists are still preserved, the mismatch
 * is flagged on the component, and NO pairing is invented — an invented pairing is a
 * fabricated invoice date.
 */
export function splitInvoiceTokens(component) {
  const numbers = splitTokens(component.invoice_no_string);
  const dates = splitTokens(component.invoice_date_string);
  const aligned = numbers.length > 0 && numbers.length === dates.length;
  const refs = numbers.map((invoiceNo, index) => {
    let invoiceDate = null;
    if (aligned) {
      try {
        invoiceDate = date(dates[index]);
      } catch {
        // An unparseable token is kept verbatim and simply not resolved to a date.
        invoiceDate = null;
      }
    }
    return {
      ordinal: index + 1,
      invoice_no: invoiceNo,
      invoice_date_token: aligned ? dates[index] : null,
      invoice_date: invoiceDate,
      date_alignment_proven: aligned,
    };
  });
  // ANY disagreement in cardinality is a mismatch, including a one-sided list. Requiring
  // both sides to be non-empty meant a component carrying invoice dates and no invoice
  // numbers produced no refs and no flag: the rows vanished and nothing said so. The
  // date list itself is still kept verbatim on the component either way.
  return { refs, mismatch: numbers.length !== dates.length };
}

export function splitPickTicketTokens(component) {
  return splitTokens(component.pick_ticket_no_string).map((token, index) => ({
    ordinal: index + 1,
    pick_ticket_no: token,
  }));
}

/**
 * Project one window's worth of /orderHistory rows into the four landing grains.
 *
 * EP001 is excluded by decision, and the exclusion is COUNTED rather than silent: the
 * page ledger still records what the vendor sent, so a difference between fetched and
 * landed rows must have a stated cause.
 */
export function projectOrderHistoryWindow(rows, { runId, fetchedAt, newId = randomUUID } = {}) {
  const lines = new Map();
  const components = [];
  const invoiceRefs = [];
  const pickTicketRefs = [];
  let excludedEp001 = 0;
  let cardinalityMismatches = 0;

  for (const row of rows) {
    const line = projectLine(row);
    if (line.division_code === EXCLUDED_DIVISION) {
      excludedEp001 += 1;
      continue;
    }
    if (line.sales_order_no === null) throw new Error("an orderHistory row has no salesOrderNo");
    if (line.sales_order_line_no === null) {
      throw new Error("an orderHistory row has no salesOrderLineNo");
    }
    if (line.master_item_no === null) throw new Error("an orderHistory row has no itemNo");

    const lineHash = sourceHash(line);
    const key = [line.sales_order_no, line.sales_order_line_no, line.master_item_no, lineHash].join(
      "",
    );
    let parent = lines.get(key);
    if (!parent) {
      parent = {
        localId: newId(),
        ...line,
        created_time: null,
        created_user: null,
        mod_time: null,
        mod_user: null,
        line_source_hash: lineHash,
        run_id: runId,
        fetched_at: fetchedAt,
      };
      lines.set(key, parent);
    }
    mergeLineStamps(parent, projectLineStamps(row));

    const component = projectComponent(row);
    const componentHash = sourceHash(component);
    const { refs, mismatch } = splitInvoiceTokens(component);
    if (mismatch) cardinalityMismatches += 1;

    const componentRow = {
      localId: newId(),
      lineLocalId: parent.localId,
      ...component,
      document_list_cardinality_mismatch: mismatch,
      component_source_hash: componentHash,
      run_id: runId,
      fetched_at: fetchedAt,
    };
    components.push(componentRow);

    for (const ref of refs) {
      invoiceRefs.push({
        lineLocalId: parent.localId,
        componentLocalId: componentRow.localId,
        ...ref,
        run_id: runId,
        fetched_at: fetchedAt,
      });
    }
    for (const ref of splitPickTicketTokens(component)) {
      pickTicketRefs.push({
        lineLocalId: parent.localId,
        componentLocalId: componentRow.localId,
        ...ref,
        run_id: runId,
        fetched_at: fetchedAt,
      });
    }
  }

  return {
    lines: [...lines.values()],
    components,
    invoiceRefs,
    pickTicketRefs,
    excludedEp001,
    cardinalityMismatches,
    versionFanOut: countVersionFanOut([...lines.values()]),
  };
}

/**
 * How many (order, line, item) groups produced more than one distinct line projection in
 * ONE window. Not an error — it is exactly the case the version identity exists for —
 * but it is worth saying out loud, because it is also what a projection bug looks like.
 */
export function countVersionFanOut(lines) {
  const groups = new Map();
  for (const line of lines) {
    const key = [line.sales_order_no, line.sales_order_line_no, line.master_item_no].join("");
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.values()].filter((count) => count > 1).length;
}
