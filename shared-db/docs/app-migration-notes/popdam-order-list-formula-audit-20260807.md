# PopDAM OrderList workbook formula audit

## Decisions this audit locks

Albert confirmed on 2026-08-07 that a Google OrderList row and a future Coldlion production-order row describe the **same business record**. They are not two order systems to preserve side by side.

- Google OrderList is the historical and pre-API source.
- Coldlion becomes the recurring source when its production-order API is available.
- Both sources must resolve to the same `plm.production_order` and `plm.production_order_line` rows.
- The Coldlion identifier is the durable external identity once available. A Coldlion pull updates or claims an imported Google row; it must not insert a duplicate.
- `plm.item` is the final canonical item list. There is no intended `core.item`.
- `core.*` remains the shared reference-data layer for companies, customers, factories, licensors, properties, and similar entities.

## What the workbook actually does

The workbook is several tools bundled into one file. The `Order` tab is the line-level order register. Most of its values are typed or pasted values, not formulas. Other tabs summarize orders, track purchase-order tasks, calculate container volume, import vendor and style catalogs, and build assortment descriptions.

The most important finding is that **`Order` does not use a formula to look up Master Data**. Its Style number, description, license status, vendor, and Licensed/Generic value are stored directly in the order row. The relationship to `License.Style` or `Generic.Style` is a human/business convention based on:

1. `Order!P` Style number;
2. `Order!AM` Licensed or Generic discriminator; and
3. `License.Style!B` or `Generic.Style!B` Style number / SKU.

That explains why the spreadsheet can drift. PopDAM must replace this implied match with a stored item relationship.

## Audit method and coverage

- Source: Google spreadsheet `1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk`.
- Export format: complete `.xlsx` workbook, downloaded read-only on 2026-08-07 and refreshed after a later sheet edit on 2026-08-09.
- Current SHA-256: `4958B4B7B783A46B968A0D5C9438364216303AD8B856B9B7E9AEBBDFFC6ABBE4` (Drive modified time `2026-08-08T02:45:38.164Z`).
- Coverage: every formula cell in all 16 tabs, including hidden `DashBoard`.
- Current total formula cells inspected: **321,616**. The 2026-08-09 rerun added 72 cached/imported formulas outside the `Order` business logic. `Order` itself remains unchanged at 43 formulas.
- The workbook was not edited. The export is a local temporary artifact and is not committed.

Google-only formulas are represented imperfectly in an Excel export. In particular, `IMPORTRANGE`, `ARRAYFORMULA`, and many calculated imported cells appear as `IFERROR(__xludf.DUMMYFUNCTION(...), cached value)`. Those cells were still counted and classified. A cached value is evidence of the last Google calculation, not a formula implementation that PopDAM should copy.

## Formula inventory by tab

| Tab | Formula cells | What the formulas do | PopDAM meaning |
|---|---:|---|---|
| `Order` | 43 | 37 display-only header labels and 6 one-off arithmetic quantity entries | The business rows are not formula-linked to Master Data. Import evaluated values and validate the six arithmetic results. |
| `PO.Tracking` | 11,170 | Pulls PO identity from `Order`, calculates total cases, and flags missing photos/test reports | Rebuild as database-backed order status and task fields, not copied spreadsheet formulas. |
| `CL.PKK.Report` | 0 | No formulas | Source/report data used by `Assort.List`. Not part of the first OrderList page. |
| `AdamView` | 0 | No formulas | A value-only view/copy of order data. Do not import as a second order source. |
| `Item.Tracking` | 0 | No formulas | A value-only tracking view. Do not import as a second order source. |
| `VendorStatistics` | 367 | Unique vendor list, latest active PO date, recency, and Active/Inactive calculation from `PO.Tracking` | A derived report. Build later from canonical orders if still needed. |
| `Vendor` | 1,691 | `IMPORTRANGE`-derived cached vendor directory | Use canonical `core.factory` and related company records. Do not create another vendor master. |
| `Assort.List` | 31,989 | For each assortment, `FILTER` + `JOIN` gathers SKUs, quantities, descriptions, status, type, and flags from `CL.PKK.Report` | This is an assortment report, not the order record. Preserve assortment ID on order lines and rebuild only if requested. |
| `CBM` | 88 | `VLOOKUP` against a carton table plus `SUM`/`ROUNDUP` for container-volume scenarios | A calculator. It is not a source of order identity. |
| `Product Dimensions` | 0 | No formulas | Value-only reference data. Product dimensions ultimately belong with the canonical item model. |
| `License.Style` | 246,926 | One `IMPORTRANGE` plus cached imported values across the copied licensed catalog | A copied Master Data catalog. Never import it as a new table. |
| `parameter` | 0 | Holds source spreadsheet URLs/ranges used by imports | Configuration for the workbook only. |
| `Generic.Style` | 25,599 | One `IMPORTRANGE` plus cached imported values across the copied generic catalog | A copied Master Data catalog. Never import it as a new table. |
| `SAMPLE` | 1 | One `IMPORTRANGE`, currently cached as `#REF!` | Broken/unused auxiliary import. Not part of OrderList. |
| `EH001` | 3,740 | One imported, cached item/order working set | Auxiliary snapshot. It is not a canonical source. |
| hidden `DashBoard` | 2 | `COUNTIFS` over `PO.Tracking` for two outstanding-work counts | Rebuild from canonical order/task status if the dashboard is retained. |

The overwhelming majority of the 321,616 formula cells are Excel-export wrappers around Google-calculated/imported values. The business-critical `Order` tab still contains only 43 formulas. This distinction matters because the formula count makes the workbook look far more computational than it is.

## Detailed findings for the `Order` tab

The 48 columns are a denormalized order-line table. PO-level values repeat on sibling lines. Product facts are also copied into each line.

### Formula-driven cells

- Row 1 contains 37 formulas that generate numbered display headers such as `[02] Import PO#`. These have no business meaning and should become normal UI column labels.
- Six quantity cells contain simple arithmetic instead of final typed numbers: `2400-960`, `3282-432`, `1488+24`, `1104+48`, `2208+24`, and `10194*7`.
- No `Order` formula references `License.Style`, `Generic.Style`, or any other sheet.
- Columns used for PO-writing helpers contain stored/cached values and at least one visible `#REF!`. They are not a reliable source for canonical order or item identity.

### Header facts versus line facts

The repeated PO-level group includes Import PO number, ordering vendor, seal/container date, sent-PO date, company/customer, order person/type, customer PO, and much of the shipping/tracking state. The line-level group includes Style number, description snapshot, license status snapshot, quantity, case pack, cases, ship-to, line dates, Licensed/Generic, repeat/sample flags, and PO-writing helper values.

The importer must profile conflicts before deciding which repeated value becomes the order header. It must never silently pick the first row when sibling lines disagree.

## Cross-tab formula flow

```text
Order ──> PO.Tracking ──> VendorStatistics
                    └──> hidden DashBoard

CL.PKK.Report ──> Assort.List

external spreadsheet URLs in parameter
    ├──> Vendor
    ├──> License.Style
    ├──> Generic.Style
    ├──> SAMPLE
    └──> EH001
```

There is no formula edge from `Order` to either style tab. The apparent item link is therefore not a live spreadsheet relationship.

## Data-quality problems found while reading formulas

- `SAMPLE!B1` contains an `IMPORTRANGE` whose cached result is `#REF!`.
- At least one Order PO-writing helper value is `#REF!`.
- Thirteen cells contain numbers formatted as dates that are far outside Excel's valid date range. The same bad source values propagate into copied views:
  - `Order`: `Y10464`, `AB10464`, `AD11560`, `AD11561`;
  - `PO.Tracking`: `M2482`, `O2482`, `R2871`;
  - `AdamView`: `T10464`, `W11560`, `W11561`;
  - `Item.Tracking`: `O10464`, `R11560`, `R11561`.
- The repeated bad numbers prove that `AdamView` and `Item.Tracking` are downstream copies/views, not independent truth.
- Excel export cannot faithfully execute Google-only formulas. Imports must use cached values only as source evidence and must reject formula errors and impossible dates as typed business values.

## Correct target relationships

### Orders

`plm.production_order` and `plm.production_order_line` are the canonical order tables. Every source row needs source provenance, but source provenance does not create a second order.

The matching order should be:

1. Coldlion production-order ID when present;
2. otherwise a deterministic Google identity based on normalized Import PO number plus a stable line identity;
3. when Coldlion first returns that order, reconcile it to the Google row using PO number, item, quantities, dates, and line position, then attach the Coldlion ID;
4. ambiguous matches go to review and never create an automatic duplicate.

### Items and Master Data

`plm.item` is the ultimate item list. The intended durable order-line relationship is `plm.production_order_line.item_id -> plm.item.id`.

PopDAM Master Data is already linked toward the PLM item, but the cutover is not finished:

```text
today:
public.style_tracker_rows
  -> plm.style_tracker_item_bridge.erp_item_id
  -> public.erp_items_current.id

after ERP-plan Phase 4:
public.style_tracker_rows
  -> plm.style_tracker_item_bridge.erp_item_id
  -> plm.item.id
```

`api.plm_item_list` currently hides the legacy physical table from readers, but `plm.item` is still empty and the bridge foreign key still points to `public.erp_items_current`. Therefore the OrderList build must coordinate with `fix_schema_for_api.md`. It must not add a second permanent Master Data foreign key that competes with `production_order_line.item_id`.

For the historical Google import, Style number plus Licensed/Generic may be used to resolve the current Master Data row and its bridged ERP item. The stored final relationship must be the canonical `plm.item.id` once Phase 4 lands. Unmatched or ambiguous rows remain visible for review.

## Implementation consequences

1. Do not reproduce spreadsheet formulas cell by cell.
2. Import only the `Order` tab as historical order evidence. Do not import `AdamView`, `Item.Tracking`, or copied style/vendor tabs as competing records.
3. Keep the raw source snapshot and export hash for audit, but store typed valid values in canonical columns.
4. Implement PO tracking flags and dashboard counts as database queries over canonical order state.
5. Resolve every order line to `plm.item` where possible. Show Master Data information through the existing style-to-item bridge.
6. Treat impossible dates, `#REF!`, blanks, conflicting repeated PO values, and ambiguous item matches as reconciliation issues.
7. Design the Google importer and future Coldlion importer as idempotent upserts into the same canonical rows.
8. Finish or deliberately coordinate the existing ERP relocation plan before changing `plm.production_order*`, `plm.item`, or the style-item bridge.

## What remains for Phase 0

This formula audit completes the formula and dependency part of source discovery. The remaining Phase 0 work is a row-level profile and the 48-column destination map: populated row count, duplicate order identities, sibling-line conflicts, item match rates, invalid typed values, and a deterministic Google-to-Coldlion reconciliation key.
