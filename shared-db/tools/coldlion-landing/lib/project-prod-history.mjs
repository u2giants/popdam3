// /prodHistory -> coldlion.prod_history_line + _component + _last_lookup
//
// Three things here are not obvious and each has a database guard behind it:
//
// 1. THE STAGE IS ASSERTED, NOT STAMPED. We record the stage we ASKED for and the stage
//    the payload RETURNED, and a row whose returned stage differs from the requested one
//    aborts the whole window. Stamping the request onto the row would have hidden the
//    2026-08-26 change where ColdLion began returning stageCode at all.
//
// 2. THE last* FIELDS ARE A DIFFERENT PRODUCTION. lastProdCost is the cost of an
//    EARLIER production of the item, not of this order. It lives on its own table, the
//    copies are never summed, and at most one copy may be marked selected — with the
//    rule that picked it recorded beside it.
//
// 3. PARENT TOTALS REPEAT ON EXPLODED ROWS. prodOrderQty, prepackQty and totalPpkQty are
//    header values echoed on every component row. Only ppkDetailQty is per component,
//    and the only thing it is ever summed for is asserting it equals totalPpkQty.

import { randomUUID } from "node:crypto";
import { EXCLUDED_DIVISION } from "./scopes.mjs";
import { bigint, date, num, sourceHash, text } from "./values.mjs";

const PPK_SLOTS = Array.from({ length: 14 }, (_, index) => String(index + 1).padStart(2, "0"));

export function projectLine(row, requestedStage) {
  return {
    company_code: text(row.companyCode),
    prod_order_no: bigint(row.prodOrderNo),
    prod_line_seq: bigint(row.prodLineSeq),
    requested_stage_code: requestedStage,
    stage_code: text(row.stageCode)?.toUpperCase() ?? null,
    division_code: text(row.divisionCode),
    customer_code: text(row.customerCode),
    customer_desc: text(row.customerDesc),
    prod_type_code: text(row.prodTypeCode),
    ship_date: date(row.shipDate),
    ship_cancel_date: date(row.shipCancelDate),
    orig_ship_date: date(row.origShipDate),
    orig_due_date: date(row.origDueDate),
    orig_ship_cancel_date: date(row.origShipCancelDate),
    prod_order_date: date(row.prodOrderDate),
    due_date: date(row.dueDate),
    receive_date: date(row.receiveDate),
    cust_start_date: date(row.custStartDate),
    cust_cancel_date: date(row.custCancelDate),
    prod_country: text(row.prodCountry),
    freight_forwarder_code: text(row.freightForwarderCode),
    warehouse_code: text(row.warehouseCode),
    vendor_code: text(row.vendorCode),
    vendor_desc: text(row.vendorDesc),
    arrival_port_code: text(row.arrivalPortCode),
    // 0 is the vendor's "no linked sales order". It is stored as sent and never joined.
    sales_order_no: bigint(row.salesOrderNo),
    prod_reference_no: text(row.prodReferenceNo),
    cust_po_number: text(row.custPONumber),
    item_no: text(row.itemNo),
    item_desc: text(row.itemDesc),
    short_item_no: text(row.shortItemNo),
    label_code: text(row.labelCode),
    pre_pack_code: text(row.prePackCode),
    warehouse_sku: text(row.warehouseSku),
    prod_order_qty: num(row.prodOrderQty),
    prepack_qty: num(row.prepackQty),
    total_ppk_qty: num(row.totalPpkQty),
    prod_cost: num(row.prodCost),
    ext_cost: num(row.extCost),
    total_prod_cost: num(row.totalProdCost),
    deposit_perc: num(row.depositPerc),
  };
}

export function projectComponent(row) {
  const component = {
    prepack_item_no: text(row.prepackItemNo),
    prepack_item_pkey: text(row.prepackItemPKey),
    prepack_dim_code: text(row.prepackDimCode),
    prepack_division_code: text(row.prepackDivisionCode),
    ppk_detail_qty: num(row.ppkDetailQty),
    ppk_detail_qty2: num(row.ppkDetailQty2),
    ppk_detail_cost: num(row.ppkDetailCost),
    sub_item_no: text(row.subItemNo),
    line_price: num(row.linePrice),
  };
  for (const slot of PPK_SLOTS) {
    component[`ppk_merch_group${slot}`] = text(row[`ppkMerchGroup${slot}`]);
    component[`ppk_merch_group${slot}_desc`] = text(row[`ppkMerchGroup${slot}Desc`]);
  }
  return component;
}

/** The seven last* fields — a lookup at a DIFFERENT production, kept apart deliberately. */
export function projectLastLookup(row) {
  return {
    last_prod_ref_no: text(row.lastProdRefNo),
    last_due_date: date(row.lastDueDate),
    last_prod_date: date(row.lastProdDate),
    last_warehouse_code: text(row.lastWarehouseCode),
    last_vendor_code: text(row.lastVendorCode),
    last_vendor_desc: text(row.lastVendorDesc),
    last_prod_cost: num(row.lastProdCost),
  };
}

export function isEmptyLookup(lookup) {
  return Object.values(lookup).every((value) => value === null);
}

export const LOOKUP_SELECTION_RULE =
  "maximum last_prod_date, then maximum last_prod_cost, then lookup_source_hash";

/**
 * Pick exactly one lookup copy per line, deterministically, and say which rule picked it.
 * NULLs sort last so a dated copy always beats an undated one.
 */
export function selectLookup(copies) {
  if (copies.length === 0) return null;
  const ranked = [...copies].sort((a, b) => {
    const byDate = compareDesc(a.last_prod_date, b.last_prod_date);
    if (byDate !== 0) return byDate;
    const byCost = compareDesc(a.last_prod_cost, b.last_prod_cost);
    if (byCost !== 0) return byCost;
    return a.lookup_source_hash < b.lookup_source_hash ? -1 : 1;
  });
  return ranked[0];
}

function compareDesc(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a > b ? -1 : 1;
}

/**
 * Project one window+stage of /prodHistory into the three landing grains.
 *
 * `component_quantities_asserted` is computed here but NOT written at insert time: the
 * database guard reads the components, which do not exist until after the parent row
 * does. The loader sets it in a second statement, and the guard — not this function —
 * is what makes it true.
 */
export function projectProdHistoryWindow(
  rows,
  { runId, fetchedAt, requestedStage, observedAt, isBackfillBaseline = false, newId = randomUUID } = {},
) {
  if (!requestedStage) throw new Error("prodHistory rows must be projected under a requested stage");
  const lines = new Map();
  const components = [];
  const lookupsByLine = new Map();
  let excludedEp001 = 0;

  for (const row of rows) {
    const line = projectLine(row, requestedStage);
    if (line.division_code === EXCLUDED_DIVISION) {
      excludedEp001 += 1;
      continue;
    }
    if (line.stage_code === null) {
      throw new Error("a prodHistory row returned no stageCode");
    }
    if (line.stage_code !== requestedStage) {
      // The assertion, refused here as well as by the database: a mixed-stage payload
      // means the request scope did not hold and the window is not what we asked for.
      throw new Error(
        `a prodHistory row returned stage ${line.stage_code} for requested stage ${requestedStage}`,
      );
    }
    if (line.prod_order_no === null) throw new Error("a prodHistory row has no prodOrderNo");
    if (line.prod_line_seq === null) throw new Error("a prodHistory row has no prodLineSeq");

    const lineHash = sourceHash(line);
    // Joined on a unit separator, exactly as the order-history key is. The line hash is
    // the last part and already covers these same fields, so an empty join could not
    // actually collide two different lines today; the separator is here so that the day
    // someone drops the hash from this key, the change does not quietly become a
    // collision that folds two production lines into one parent.
    const key = [line.company_code, line.prod_order_no, line.prod_line_seq, line.stage_code, lineHash].join(
      "",
    );
    let parent = lines.get(key);
    if (!parent) {
      parent = {
        localId: newId(),
        ...line,
        line_source_hash: lineHash,
        source_observed_at: observedAt,
        source_version_seq: null,
        is_backfill_baseline: isBackfillBaseline,
        retention_ordering_ambiguous: false,
        retention_identity_ambiguous: false,
        run_id: runId,
        fetched_at: fetchedAt,
      };
      lines.set(key, parent);
      lookupsByLine.set(parent.localId, new Map());
    }

    const component = projectComponent(row);
    components.push({
      localId: newId(),
      lineLocalId: parent.localId,
      ...component,
      component_source_hash: sourceHash(component),
      run_id: runId,
      fetched_at: fetchedAt,
    });

    const lookup = projectLastLookup(row);
    if (!isEmptyLookup(lookup)) {
      const lookupHash = sourceHash(lookup);
      const forLine = lookupsByLine.get(parent.localId);
      if (!forLine.has(lookupHash)) {
        forLine.set(lookupHash, {
          localId: newId(),
          lineLocalId: parent.localId,
          ...lookup,
          lookup_source_hash: lookupHash,
          is_selected_lookup: false,
          selection_rule: null,
          run_id: runId,
          fetched_at: fetchedAt,
        });
      }
    }
  }

  const lastLookups = [];
  for (const forLine of lookupsByLine.values()) {
    const copies = [...forLine.values()];
    const chosen = selectLookup(copies);
    if (chosen) {
      chosen.is_selected_lookup = true;
      chosen.selection_rule = LOOKUP_SELECTION_RULE;
    }
    lastLookups.push(...copies);
  }

  const lineList = [...lines.values()];
  const assertable = assertableLineIds(lineList, components);

  return {
    lines: lineList,
    components,
    lastLookups,
    assertableLineIds: assertable,
    excludedEp001,
  };
}

/**
 * Which lines may have `component_quantities_asserted` set afterwards: components exist,
 * every one carries a quantity, the parent total is recorded, and the two agree exactly.
 * Anything short of that stays unasserted rather than being forced through.
 */
/**
 * Do a component sum and a parent total agree, allowing for binary floating point?
 *
 * The tolerance is relative to the magnitude being compared, with an absolute floor, so
 * it does not widen into a real discrepancy on large totals and does not vanish on small
 * ones. A genuine mismatch of one unit is never inside it.
 */
export function quantitiesAgree(sum, total) {
  return Math.abs(sum - total) <= 1e-9 * Math.max(1, Math.abs(total));
}

export function assertableLineIds(lines, components) {
  const byLine = new Map();
  for (const component of components) {
    const bucket = byLine.get(component.lineLocalId) ?? { count: 0, sum: 0, missing: 0 };
    bucket.count += 1;
    if (component.ppk_detail_qty === null) bucket.missing += 1;
    else bucket.sum += component.ppk_detail_qty;
    byLine.set(component.lineLocalId, bucket);
  }
  const ids = [];
  for (const line of lines) {
    const bucket = byLine.get(line.localId);
    if (!bucket || bucket.count === 0 || bucket.missing > 0) continue;
    if (line.total_ppk_qty === null) continue;
    // Compared with a tolerance, not with `!==`. These are JSON numbers: a parent total
    // of 10.3 and components of 5.1 + 5.2 do not sum to it EXACTLY in binary floating
    // point, and an exact test would quietly leave a line that genuinely reconciles
    // unasserted -- a guard that stops firing without ever failing.
    if (!quantitiesAgree(bucket.sum, line.total_ppk_qty)) continue;
    ids.push(line.localId);
  }
  return ids;
}
