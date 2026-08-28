# ERP, orders, and source meaning

**Status:** Settled

## General rule

An ERP field name does not establish its business meaning. Every imported field must retain its source, time scope, and interpretation. Applications must not give the same source value different meanings.

## Orders and items

Google OrderList rows and future ColdLion rows describe the same real orders. They are not competing order systems. One canonical order and line must retain separate source references for each system. The ultimate item list belongs to the canonical PLM item identity.

## The customer master is not a customer list

ColdLion's customer table includes ship-to-only records (a Licensor POP ships to
must be a customer there to get a pick ticket), customers dating to 2006 that are
now defunct, and active customers too small to warrant CRM attention. It must
never be read as POP's list of customers, and it never sets a CRM
classification. See [`customers-contacts-and-organizations.md`](customers-contacts-and-organizations.md).

## Historical classification

ERP merchandise data before the approved cutoff may use codes whose historical meaning differs from current codes. Historical items must follow the approved description-based remediation process rather than being forced through the current mapping.

## Samples and production indicators

A Production PO number ending `COS` means extra pieces of a customer's item are being made for the Licensor as contractual samples and/or for POP's internal purposes as DAVID samples.

- These pieces are a real POP cost with no customer revenue and must be classifiable separately.
- `salesOrderNo = 0` on a `COS` line is correct. It is not a missing link.
- The Customer on the line is the Customer from the original order, not the sample recipient.
- `COS` does not distinguish contractual samples from DAVID samples. That split is Unknown unless another source supplies it.
- Older data also contains other sample markers, so `COS` must not be treated as the only possible indicator.

The production-history feed covers four divisions: `CW001`, `EH001`, `EP001`, and `SP001`. A short time window may show fewer divisions and must not be generalized.

`1900-01-01` is the ERP's empty-date marker. It is not a real business date. Outside `COS`, `salesOrderNo = 0` means there is no linked sales order.

A source value that is absent or ambiguous must remain Unknown rather than being silently converted to zero, false, or not applicable.

## What the ColdLion order-history feed actually is

**Status: Settled.** Authority: ColdLion (JamieLynn), 2026-08-28.

The order-history feed is **not a sales-order table**. It assembles data from four separate
documents — the Sales Order, the Prepack Detail, the Pick Ticket and the Invoice — into one flat
list of rows. A change at any stage can split a line.

Consequences that are Settled:

- **No unique key exists, and none can be constructed.** The sales-order line number is
  **re-assigned at pick and again at invoice**, so it does not carry forward. Two rows can share an
  order and a line number and be different items; the same item can appear on two rows.
- **Rows that look like duplicates are the same order line seen at a different stage.** They must
  not be de-duplicated.
- **A line split by a price change carries both prices, and both are real** — one from the sales
  order, one from the invoice. Adding them together double-counts. Any revenue or quantity figure
  taken from this feed by summing rows is wrong.
- Every row must be kept, and any landing table must carry a stage or source marker.
- **The feed does not say which of the four documents a row came from.** Until it does, the stage of
  an individual row is **Unknown** and must not be inferred.

## Quantity fields in the order-history feed

**Status: Settled.** Authority: ColdLion (JamieLynn), 2026-08-18, 2026-08-26 and 2026-08-28.

- Invoiced and open quantities are **not carried at component level**. Use the unshipped and picked
  quantities instead.
- The feed now applies the ERP report's own formulas, but **the formulas themselves were never
  disclosed** — only the computed result. Do not re-derive an invoiced or shipped quantity here.
- **A zero open or unshipped quantity on an invoiced line is a true zero**, not missing history:
  once a line is invoiced, open and unshipped drop to zero unless the shipment was short or partial.
- **This test cannot currently be applied**, because the feed returns nothing for invoice number,
  invoiced quantity, shipped quantity, shipped amount or invoice date on historical rows. Until
  those carry values, whether a historical zero is a true zero remains **Unknown row by row**.

## Negative quantities are valid business data

**Status: Settled.** Authority: ColdLion (JamieLynn), 2026-08-28.

A negative quantity records a **manual correction made after initial order entry**, not a data
error. Two confirmed causes:

- A customer ordered in cases while stock was held in pieces, so the order was manually exploded
  into pieces and the settings adjusted so the EDI went back out correctly.
- Contractual samples were being shipped and the warehouse found more units than expected; the extra
  units were added to the pick so everything could ship.

Negative quantities must be loaded as they are. They must never be rejected, clamped, zeroed or
converted to a positive value.

## Sales-order line number of zero

**Status: Settled in part; the remainder is Unknown.** Authority: ColdLion (JamieLynn), 2026-08-28.

A sales-order line number of zero occurs mostly on **cancelled items or cancelled orders**. Cases
where the line number is zero **and the order was invoiced are unexplained**; ColdLion's technical
team is investigating and has given no date.

A zero line number is therefore not a usable line reference. Rows carrying a zero line number
alongside an invoice must be held aside rather than loaded as ordinary lines.

## Blank merchandise groups on component rows

**Status: Settled.** Authority: ColdLion (JamieLynn), 2026-08-20.

A blank merchandise group on a component row is **not missing data**. ColdLion renumbered its
merchandise-group positions, and on affected rows the values still exist in the **old slot
positions**. A blank must never be treated as absent and must never be backfilled from the master
item — check the old positions first.

Separately, a set of items created through ColdLion's API around the time of the renumbering were
never re-mapped to the new merchandise groups. **Correcting those is POP's work, not ColdLion's**,
and it is done by owner decision, never by an automated mapping.

## Other Settled answers from ColdLion

**Authority: ColdLion (JamieLynn), on the dates shown.**

- **History begins 2019-01-01.** That is the load boundary. (Restated by Albert, 2026-08-20.)
- **A production line reference now separates real lines from duplicates** in production history; a
  duplicated production reference number was the original cause. (2026-08-17)
- **The history feed is capped at a seven-day window**, inclusive. ColdLion advises narrowing to a
  single day when a call is slow. There is no other hidden filter. (2026-08-17, 2026-08-26)
- **Production stage has exactly three values:** issued, in transit, and received. All three carry
  real rows, and the stage is now returned by the feed rather than assumed from the request.
  (2026-08-19, 2026-08-26)
- **Assortment-level merchandise groups are the blank ones**, because an assortment master is
  generic; the component carries the specific groups. (2026-08-18)
- **Amazon orders have no customer purchase order** because they are stock for Amazon's warehouse,
  not presold. An unlinked Amazon line is correct. (2026-08-19)
- **Hard-linking purchase orders to production orders began around 2022–2023.** Before that the
  customer purchase order was entered manually, so older lines legitimately lack the link.
  (2026-08-18)
- **Sub-UPCs are rarely populated**, because UPCs are not usually assigned to prepack components.
  (2026-08-17)
- **Merchandise groups carry an active/inactive flag**, and it is live. (2026-08-20)

## Implementation and evidence

The field-by-field source evidence and formula findings remain in [`../business-rules-erp-data.md`](../business-rules-erp-data.md), [`../app-migration-notes/popdam-order-list.md`](../app-migration-notes/popdam-order-list.md), and the linked formula audit. This page is the companywide entry point.
