# ColdLion prepacks — how one order line becomes many SKUs

**Status: authoritative. Source: ColdLion tech team via JamieLynn, 2026-09-01, plus a live
verification pull of 1,823 `orderHistory` rows across 409 sales orders spanning 2019–2026.**

This document exists because the single largest misreading we have made of the ColdLion feed —
the "quantities are multiplied 49×" fault we reported as issue 7 on 2026-08-31 — **was not a
fault.** It was us summing parent-level totals as if they were per-SKU totals. Everything below is
the corrected mental model.

---

## 1. What a prepack is, in ColdLion's terms

A **prepack** is a pre-assembled assortment sold to a retailer as one thing. Burlington does not
order seven hampers and bins; it orders 239 units of prepack **PPK2760**, and each unit contains a
fixed recipe of component SKUs.

ColdLion's ERP records the customer's intent as **one sales-order line** — item `NHNQ601`, label
`BC`, prepack `PPK2760`. The API does **not** return that line. It returns the line **exploded**:
**one row per component SKU**, seven rows for PPK2760. The parent line itself never appears as its
own row.

This is the whole reason order 7127866 looked wrong to us. Seven rows all reading 1,673 is not seven
copies of a quantity — it is seven different products, each carrying the same **parent** total in the
parent-level fields.

## 2. The real SKU is not `itemNo`

On an exploded row, `itemNo` is the **parent prepack's** item number and is identical on every row of
the group. The product actually being shipped is identified by three fields together:

| Field | Meaning |
|---|---|
| `subItemNo` | the component's item number — the real SKU |
| `subColorCode` | the component's colour |
| `subLabelCode` | the component's label |

ColdLion's instruction: **use the sub-item fields as the SKU whenever they are not blank; fall back
to `itemNo` when they are.** `subDimCode`, `subSizeCode` and `subUpc` follow the same rule.

**Loader rule:** the SKU key for an order-history row is
`COALESCE(NULLIF(subItemNo,''), itemNo)`, and the same pattern for colour and label. Never key on
`itemNo` alone; on a prepack order it collapses seven distinct products into one.

## 3. Which quantity fields are per-SKU and which are parent totals

This is the distinction that cost us a false fault report.

| Field | Level | Trust for a SKU-level loader? |
|---|---|---|
| `lineQty` | **parent line total** | No |
| `lineInvoiceQty` | **parent line total** | No |
| `prepackQty` | units of the assortment implied by the recipe (denominator) | context only |
| `quantity` | the component's multiplier within the recipe | context only |
| **`orderQty`** | **per SKU, already computed by ColdLion** | **Yes — use this** |
| **`invoiceQty`** | **per SKU, already computed by ColdLion** | **Yes — use this** |
| `shipQty`, `orderAmount`, `shipAmount` | per SKU, follow `orderQty` | Yes |

ColdLion states the arithmetic as:

    orderQty   = (lineQty        / prepackQty) * quantity
    invoiceQty = (lineInvoiceQty / prepackQty) * quantity

**Verified live on 751 prepack rows: the formula reproduces `orderQty` and `invoiceQty` exactly on
734 of them (97.7%).** The 17 exceptions are all one order and are explained in §6.

On the 1,072 **non-prepack** rows in the same sample, `orderQty` equals `lineQty` and `invoiceQty`
equals `lineInvoiceQty` on **100%** of rows. So `orderQty`/`invoiceQty` are safe everywhere — they
simply mean "the quantity of this row's SKU", prepack or not. **Our loader should read only those two
and ignore `lineQty`/`lineInvoiceQty` entirely.**

### Worked example — order 7127866, prepack PPK2760

Burlington PO 669900501, start 2026-07-20, cancel 2026-07-24, parent item `NHNQ601`, label `BC`.
Parent fields on every one of the seven rows: `lineQty` = `lineInvoiceQty` = **1,673**,
`prepackQty` = 7, `quantity` = 1. Per-SKU result on every row: `orderQty` = `invoiceQty` = **239**
= (1673 / 7) × 1.

| `subItemNo` | Component | Unit price | Line value |
|---|---|---|---|
| NHNQ6MVSP01 | Linen hamper | 6.0000 | 1,434.00 |
| NBX04DYLS01 | Canvas w/ EVA bin | 2.6000 | 621.40 |
| NBX9TMVSP02 | Canvas w/ EVA bin 13x9" | 2.2500 | 537.75 |
| NBXM2MVSP01 | Canvas w/ EVA bin 16x12" | 2.9000 | 693.10 |
| NHN1SNBHD01 | Linen hamper | 4.5000 | 1,075.50 |
| NHN4RDYWP01 | Linen hamper | 5.2500 | 1,254.75 |
| NHN52DYLS01 | Linen hamper | 5.5000 | 1,314.50 |

239 units of the assortment. Not 1,673, and certainly not 11,711.

## 4. `salesOrderLineNo` = 0 means "prepack component row"

Reported as issue 7. **It is not a defect and needs no fix.** In the verification sample, 12 of the
13 line-0 rows carry a `prePackCode`; the thirteenth matches ColdLion's own 2026-08-28 explanation
that most line-0 rows are cancelled items or orders. A line number of 0 is the ERP saying *this row
has no line of its own — it is a piece of its parent's line.*

**Loader rule:** treat `salesOrderLineNo` = 0 as a prepack-explosion marker, not as missing data.
The earlier instruction to quarantine line-0 rows is **withdrawn.**

## 5. There is still no unique key, but the rows are no longer ambiguous

`(salesOrderNo, salesOrderLineNo)` repeats on **179** groups in the sample. Adding the item and
sub-item makes it unique: `(salesOrderNo, salesOrderLineNo, itemNo, subItemNo)` has **zero**
duplicates across all 1,823 rows.

**Loader rule:** that four-part tuple is the natural key for an order-history row. It is an empirical
result on our sample, not a guarantee from ColdLion, so the loader should still detect and report a
collision rather than assume one cannot happen.

## 6. The rounding edge — a fractional component quantity truncates to zero

Order **7121892**, lines 1–4 (prepacks PPK1008, PPK1009, PPK1010, PPK1011), 17 rows in total.
`lineQty` = 1, `prepackQty` = 4 or 5, `quantity` = 1. The true per-SKU quantity is 0.25 or 0.2 —
a quarter of a prepack cannot be shipped — and ColdLion returns `orderQty` = **0**.

This is arithmetic, not corruption, and it is the only case in the sample where the formula and the
returned value disagree. **Loader consequence: a prepack row with `orderQty` = 0 and a non-zero
parent `lineQty` is a rounding artefact of a partial prepack, not an empty line.** Worth a one-line
note to ColdLion under issue 7; not blocking.

## 7. Fields that are lists, not scalars

`invoiceNoString` and `pickTicketNoString` can hold a **comma-separated list** — order 7126086
returns `6015220,6015221,6015222`. **31 rows in the sample carry a comma in each.** The `String`
suffix on the field name was the clue and we missed it.

**Loader rule:** split on comma. A schema typing these as a single integer will truncate or fail.
`invoiceDateString` should be assumed to have the same shape.

## 8. An invoice number does not prove the row was invoiced

Order 7121891 carries invoice numbers on lines whose `invoiceQty` is 0. Across the sample, 58 rows
have a pick ticket but no invoice, and 336 have neither.

**Loader rule:** fulfilment state must be read from the **quantities** (`invoiceQty`, `shipQty`),
never from the presence of a document number.

---

## Related

- [`coldlion-open-questions.md`](coldlion-open-questions.md) — the single question register; read §4 before asking ColdLion anything
- [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) — endpoint and field map
- [`business-rules/erp-orders-and-source-meaning.md`](business-rules/erp-orders-and-source-meaning.md) — what an order-history row means in business terms
