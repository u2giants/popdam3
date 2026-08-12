# PopDAM OrderList source profile and 48-column contract

## Purpose

This document finishes Phase 0 of [`plan_popdam_order_list.md`](../../plan_popdam_order_list.md). It profiles the live Google `Order` tab, maps every source column, and defines how a future Coldlion feed can claim the same canonical orders without creating duplicates.

The related formula and workbook-dependency audit is [`popdam-order-list-formula-audit-20260807.md`](popdam-order-list-formula-audit-20260807.md).

## Locked business decisions

Albert ruled on 2026-08-07 that:

1. Google OrderList rows and future Coldlion production-order rows represent the **same business orders**.
2. Both sources must resolve into the same `plm.production_order` and `plm.production_order_line` records.
3. `plm.item` is the ultimate item list. There is no intended `core.item`.

## Source evidence

| Property | Value |
|---|---|
| OrderList spreadsheet ID | `1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk` |
| Tab | `Order`, `gid=0` |
| Drive modified time used for this profile | `2026-08-08T02:45:38.164Z` |
| Fresh XLSX export | 10,677,903 bytes, downloaded read-only 2026-08-09 |
| XLSX SHA-256 | `4958B4B7B783A46B968A0D5C9438364216303AD8B856B9B7E9AEBBDFFC6ABBE4` |
| Grid size | 12,925 rows by 48 columns |
| Populated business/data rows | 12,328, ending at sheet row 12,424 |

The sheet was read only. No Google file was changed.

## Re-profile 2026-08-12 — owner-accepted 2026-08-11 workbook (issue #727)

Albert ruled on 2026-08-11 ("accept today's sheet") that the export at
`C:\Users\ahazan2\Downloads\OrderList.xlsx` is authoritative, superseding the 2026-08-09
export above. It was re-profiled honestly on 2026-08-12 by running the importer's own
`read_workbook_rows` + `build_plan` over the real `Order` tab with an empty catalog. The
2026-08-09 numbers above are kept as history; the numbers below are current.

| Property | Value |
|---|---|
| XLSX SHA-256 | `68C9B03A0EC183E08B3A8F2344397E1BC4F61E73457849E7BF8C0CF7FB2409FE` |
| Size | 10,679,199 bytes |
| Physical rows read (`Order` tab) | 12,924 |
| Populated business/data rows | **12,354** |

Row shapes (they balance: 8,438 + 3,899 + 3 + 14 = 12,354), read through the corrected
column-AR logic described below:

| Shape | Rows (2026-08-09) | Rows (2026-08-12) |
|---|---:|---:|
| Direct SKU only | 8,412 | 8,438 |
| Assortment only | 3,899 | 3,899 |
| Both SKU and assortment | 3 | 3 |
| Neither SKU nor assortment | 14 | 14 |

The **eight conditional reconciliation assertions** (the ones that fire only when the
workbook SHA-256 matches the approved constant) are: populated rows **12,354**; direct-only
rows **8,438**; assortment-only rows **3,899**; both-shape rows **3**; neither-shape rows
**14**; assortment components **15,713**; blank-PO rows **138**; normalized PO numbers
**3,087**. All eight are re-derived from the corrected logic and armed against the new
SHA-256.

Separately (not one of the eight assertions), structurally-invalid assortment rows number
**28**, and `ambiguous_matches` is catalog-dependent (449 in the 2026-08-09 profile) and is
re-confirmed against live Master Data at import time rather than asserted here.

### Column AR now mirrors column P — root-caused and fixed

In this workbook column `AR` ("Sub SKU") is populated on 12,338 of 12,354 rows, and on all
8,441 direct-SKU rows its normalized value **exactly equals** column `P` ("Style#") — 8,441
exact matches, zero exceptions, none containing a newline. In the approved 2026-08-09 export
`AR` was blank on direct rows. This is a spreadsheet fill artifact (AR copies the Style# on
direct rows), not a real assortment component list.

**The rule (`sub_sku_mirrors_style` in `scripts/import-order-list-xlsx.py`):** column `AR`
is treated as an assortment signal *except* when it exactly equals the direct `Style#` under
the importer's own SKU normalization (trim + case-fold) **and** contains no component
separator (`\r`/`\n`). A genuine assortment list is newline-separated, so any multiline `AR`
— even one whose first line equals the `Style#` — stays an assortment, as does any `AR` that
differs from the `Style#` or appears on a row with no direct `Style#`. Column `O`
("Assortment ID") still counts as an assortment signal on its own, which is why 3 rows
(direct `Style#` plus a populated `O`) remain both-shape. The raw `AR` cell is preserved in
each direct line's staged metadata (`sub_sku_raw`, `sub_sku_is_style_mirror`); no source
evidence is discarded.

Before this fix the pre-fix logic read every mirrored `AR` as an assortment, so the same
file profiled as direct-only = 0 / both-shape = 8,441 and a real import would have created
zero direct-SKU lines. With the fix the 8,438 direct rows load as direct lines again.

**On the "12,323" figure.** Earlier issue comments cited 12,323 populated rows for this
sheet lineage. That is not the importer's populated definition (any mapped cell non-empty),
which counts **12,354**; column `A` ("PO Status") or the any-core definition give 12,349.
The 12,323 came from a narrower manual count, so it was never the number the reconciliation
asserts against. No owner decision remains open: the workbook is accepted and the loader
handles its column-AR shape correctly.

## What one Google row means

There are two materially different row shapes:

| Shape | Rows | Meaning |
|---|---:|---|
| Direct SKU only | 8,412 | One visible Google row describes one SKU line. |
| Assortment only | 3,899 | One visible Google row bundles several component SKUs into newline-separated helper cells. |
| Both SKU and assortment | 3 | Needs reconciliation review before import. |
| Neither SKU nor assortment | 14 | Incomplete/placeholder row. Keep as rejected-source evidence, not a valid order line. |

The 3,899 assortment rows contain 15,816 component SKU lines. In 3,889 rows the component SKU count and Licensed/Generic count align. Ten rows do not align and must be rejected for review. Therefore a literal "one spreadsheet row equals one database line" importer would be wrong. It must create one source row record and then one canonical child line per direct SKU or valid assortment component.

## Order and line counts

- 3,088 raw Import PO values collapse to **3,083 normalized PO numbers** after trimming and case-folding.
- 1,165 normalized PO numbers have one Google row.
- 1,918 have multiple rows.
- The largest group has 84 rows.
- 130 populated rows have no Import PO number. They must never be collapsed into one blank-number order.
- Column `AQ`, labelled `Order Tab Line#`, is unusable. It has one `#REF!` and 12,327 blanks.

The Google idempotency keys must therefore be generated, not inferred from `AQ`:

- normal line: `order:row:<sheet-row-number>`;
- assortment component: `order:row:<sheet-row-number>:component:<1-based-ordinal>`;
- nonblank header: `order:po:<normalized-import-po>`;
- blank-PO header: `order:row:<sheet-row-number>` so unrelated blank rows cannot merge.

## Header consistency

The following fields are stable within nearly every normalized Import PO and are safe header candidates: seal-container date, sent-PO date, vendor-delivery date, booked-container state, ETD, ETA, warehouse date, container/booking group, MBL, and close-tracking state.

The sheet still contains real header conflicts:

- five PO groups contain different ordering-vendor names and vendor IDs;
- five contain different customers;
- one contains different PO status values;
- one contains different ordering-company values.

Those groups must be quarantined for review. The importer must not choose the first or most common value silently.

Many fields that look like headers are actually line scoped in this workbook. Customer PO differs inside 806 PO groups, order person inside 341, order type inside 329, and suffix inside 313. They belong on the line or in line metadata.

## Master Data matching

The profile compared the live Order rows against the live MasterData workbook:

- licensed catalog: 12,160 normalized SKUs, including 70 duplicate SKUs covering 192 rows;
- generic catalog: 3,152 normalized SKUs, including 5 duplicate SKUs covering 10 rows.

### Direct SKU rows

| Result | Rows |
|---|---:|
| Exact unique SKU + type match | 8,394 |
| Ambiguous because Master Data contains duplicate SKU/type rows | 11 |
| Invalid/missing discriminator | 10 |
| Unmatched SKU | 0 |

### Assortment components

For the 3,889 structurally aligned assortment rows:

| Result | Components |
|---|---:|
| Exact unique SKU + per-component type match | 15,362 |
| Ambiguous because Master Data contains duplicate SKU/type rows | 438 |
| Unmatched SKU | 0 |

Ten assortment rows are structurally invalid before matching. Examples include a four-SKU assortment with only three type values and five rows whose lookup helper is `#N/A`.

No fuzzy item matching is allowed. Ambiguous and malformed rows remain visible for review.

## Google-to-Coldlion identity proof

The Google sheet does not contain a reliable Coldlion line ID. Several tempting business keys are not unique:

| Candidate direct-line key | Eligible rows | Duplicate keys | Rows affected by duplicates | Result |
|---|---:|---:|---:|---|
| Import PO + SKU | 8,306 | 1,220 | 2,858 | Unsafe |
| Import PO + SKU + quantity | 8,305 | 822 | 1,651 | Unsafe |
| Import PO + customer PO + SKU + quantity | 5,622 | 1 | 2 | Nearly unique, but only covers rows with customer PO |

The remaining duplicate is `D1683 / 1995542 / VSQ14DYFZ01 / 5`, appearing twice. Therefore no current Google-only business tuple can be declared the universal Coldlion reconciliation key.

The safe design is:

1. Give every Google row/component its deterministic Google source reference.
2. When a Coldlion payload arrives, first match an already-attached Coldlion source ID.
3. For an unclaimed record, propose a candidate using exact normalized production-order number, customer PO, SKU/item, quantity, and any Coldlion line/assortment identifier.
4. Auto-claim only when the candidate is unique and header facts agree.
5. Quarantine zero-match or multiple-match cases. Never create a second order merely because matching was uncertain.
6. Finalize the exact Coldlion key only after a real production-order payload sample exists. The current API contract does not expose enough evidence to invent that key safely.

### Required source-reference tables

The existing canonical tables have one `(source_system, source_id)` pair. That is insufficient because one canonical row must retain both a Google identity and a Coldlion identity.

Phase 1 must add:

- `plm.production_order_source_ref(production_order_id, source_system, source_id, metadata, ...)` with `unique(source_system, source_id)`;
- `plm.production_order_line_source_ref(production_order_line_id, source_system, source_id, metadata, ...)` with `unique(source_system, source_id)`.

Google refs make the historical import idempotent. Coldlion refs later claim those same canonical rows. Do not overwrite or discard the Google evidence when Coldlion becomes authoritative.

## Invalid and mixed values

- 130 populated rows have blank Import PO numbers.
- `AQ` contains a broken `#REF!` instead of line numbers.
- Vendor ID contains 2,846 `#N/A` results, largely from a missing vendor lookup for Chloe Huang.
- Five Licensed/Generic cells are `#N/A`; 24 are blank.
- Start Ship and Cancel Date contain about 2,500 text values, mainly `ASAP`, so the typed date and the raw instruction must be separate.
- Cargo forecast contains text such as `N/A`, `unknow`, and `NODATE` in addition to dates.
- Seal-container date contains malformed `1//12/2022` and `CANCELLED` values.
- ETD contains two impossible serial dates (`6693547`).
- Cases contains 531 `Wrong QTY` strings and other text. It cannot be imported as an always-numeric field.
- Direct and assortment items have no unmatched normalized SKU/type pairs, but duplicates create 449 ambiguous direct/component matches.

Every rejected or coerced value must be counted in the reconciliation report and preserved in the raw source snapshot.

## Complete 48-column destination map

`Header` means `plm.production_order`. `Line` means `plm.production_order_line`. `Snapshot` means immutable source evidence under line/header metadata. `Projection` means the UI reads the current value from `plm.item` or Master Data rather than trusting the copied Google value.

| Col | Google heading | Scope | Destination and rule |
|---|---|---|---|
| A | PO Status | Header | Existing `production_order.status`; reject the one PO group with conflicting values. |
| B | Import PO# | Header | Existing `production_order.production_order_number`; normalized value also seeds the Google header source ref. Blank values use a row-specific header. |
| C | Order vendor | Header evidence | Resolve `factory_id` through column H when possible; preserve the name in header snapshot. Five conflicting groups require review. |
| D | Seal Container Day | Header | Add typed `seal_container_date`; preserve malformed/cancelled text in snapshot and leave typed value null. |
| E | Sent PO Date | Header | Add typed `sent_po_date`. Do not assume it equals Coldlion `order_date`. |
| F | Default Vendor | Item snapshot | The values are mainly dates/`No data`, not vendor identities. Preserve raw value only; current default vendor comes through the canonical item/Master Data relationship. |
| G | Sampled Vendor | Item snapshot | Same issue as F, including multiline dates. Preserve raw only. |
| H | Vendor ID | Header | Resolve existing `factory_id` through canonical factory source refs; preserve errors/raw code. Never create a second vendor master. |
| I | Company | Header metadata | Store `ordering_company` metadata (`POP`, `Splash`, or `Pop/Splash`). It is not the customer FK. One conflict requires review. |
| J | Order Person | Line | Add/project line `order_person`; it differs inside 341 PO groups. |
| K | Order Type | Line | Add/project line `order_type`; it differs inside 329 PO groups. |
| L | Customer | Header | Resolve existing `company_id` FK, whose referenced table was renamed to `core.customer`; five conflicting groups require review. |
| M | Suffix | Line | Store line `customer_suffix` or typed line metadata; it differs inside 313 PO groups. |
| N | Customer PO# | Line | Add line `customer_po_number`; preserve as text because identifiers may contain letters and leading zeroes. |
| O | Assortment ID | Line | Add line `assortment_id`; triggers component expansion when P is blank. |
| P | Style# | Line | Existing `sku` plus resolved existing `item_id -> plm.item.id`. Never use SKU alone without type during Google matching. |
| Q | Sample Depth (Inch) | Omit/snapshot | All 8,416 populated values are `N/A`; retain only in raw source snapshot. |
| R | Order Depth (Inch) | Line | Nullable numeric `order_depth_inches`; preserve five nonnumeric values in snapshot. |
| S | Description | Projection + snapshot | Snapshot the historical text; current UI description comes from linked `plm.item`/Master Data. Multiline assortment descriptions split by component. |
| T | License Status | Projection + snapshot | Snapshot historical value; current UI status comes from the linked item/Master Data. Split by component for assortments. |
| U | Quantity | Line | Existing `quantity_ordered`. For assortments, this is the assortment/order quantity; component quantity requires the helper quantity or future Coldlion payload and must not be guessed. |
| V | Case Pack | Line | Add nullable numeric `case_pack`; preserve 380 text/multiline values for review. |
| W | Cases | Line evidence | Add nullable numeric `cases_reported`; preserve text such as `Wrong QTY` separately. Do not silently calculate over invalid values. |
| X | Ship To | Line | Add line `ship_to`; it differs inside 283 PO groups. |
| Y | Start Ship Date | Line | Add nullable `start_ship_date` plus raw instruction. `ASAP` remains raw text, not a fake date. |
| Z | Cancel Date | Line | Add nullable `cancel_date` plus raw instruction. `ASAP` remains raw text. |
| AA | Vendor Delivery Date | Header | Add nullable `vendor_delivery_date`; only 76 rows are populated. |
| AB | Cargo Day forecast | Line | Nullable `cargo_forecast_date` plus raw text for `N/A`, `unknow`, and `NODATE`; line scoped because 407 PO groups differ. |
| AC | Book Container | Header | Convert the sole value `Booked` to nullable booking state/boolean while preserving raw text. |
| AD | ETD | Header | Add nullable `etd`; reject two impossible serial dates. |
| AE | ETA | Header | Add nullable `eta`. |
| AF | Test Report | Line | Add nullable status/boolean. For assortments, split newline values by component and reject count mismatches. |
| AG | Professional Photos | Line | Add nullable status/boolean. For assortments, split by component and reject count mismatches. |
| AH | Warehouse Day | Header | Add nullable `warehouse_date`. |
| AI | Container# / Booking group | Header | Add `container_booking_group` text. |
| AJ | MBL | Header | Add `mbl` text. |
| AK | Close tracking | Header | Add `close_tracking boolean`; this is not deletion. |
| AL | New repeat order? | Omit | Entire column is blank. Keep the column in the source contract but create no database field. |
| AM | Licensor or Generic | Line matching evidence | Store normalized per-line/per-component discriminator. It controls which Master Data catalog is eligible during import. |
| AN | Contractual Samples RE-Order | Line | Add `contractual_sample_reorder boolean` derived only from exact populated marker; preserve raw marker. |
| AO | blank | Omit | Entire column is blank. |
| AP | For Wrinting PO | Derived helper | Do not store separately. It duplicates direct SKU or assortment-derived PO helper output. Preserve raw snapshot only. |
| AQ | Order Tab Line# | Reject/omit | Broken: one `#REF!`, otherwise blank. Use deterministic source refs based on physical row and component ordinal. |
| AR | For Writing PO Sub SKU | Assortment expansion helper | Split newline SKUs into canonical child lines. Do not expose as a second SKU field after import. |
| AS | For Writing PO Sub QTY | Omit | Entire column is blank. Component quantities must not be invented. |
| AT | For Writing PO Dscription | Assortment expansion helper | Split alongside AR for historical descriptions; reject mismatched counts and retain raw source. |
| AU | blank | Omit | Entire column is blank. |
| AV | blank | Omit | Entire column is blank. |

Every one of the 48 columns appears exactly once above.

## Import rules that follow from the profile

1. Stage the untouched Google row first with spreadsheet ID, tab gid, sheet row, export hash, and raw values.
2. Reject the 14 rows with neither SKU nor assortment from canonical line creation.
3. Create one direct child line for a normal SKU row.
4. For an assortment, split AR plus the newline-aligned fields. Create child lines only when required lists align. Never guess missing component quantities.
5. Resolve the child SKU against the eligible licensed/generic Master Data catalog, then through the style-item bridge to `plm.item`.
6. Auto-link only one exact match. Record ambiguous matches for review.
7. Quarantine header conflicts instead of choosing a value silently.
8. Parse typed dates/numbers only when valid. Keep raw text in the source snapshot.
9. Write Google source refs separately from Coldlion source refs.
10. Produce a reconciliation report whose arithmetic balances: staged rows = imported direct rows + imported assortment rows + rejected rows, and staged components = linked + ambiguous + rejected components.

## Remaining dependency before schema work

Phase 0 is complete. Phase 1 must still coordinate with [`fix_schema_for_api.md`](../../fix_schema_for_api.md), because that plan owns populating `plm.item`, repointing `plm.style_tracker_item_bridge`, and building the native Coldlion production-order path. OrderList must not start a parallel incompatible change to those objects.
