# ColdLion issue 3 — their answer, and what we measured against it

**Date: 2026-08-28.** ColdLion (JamieLynn) answered the documentation half of issue 3. Every claim
below was re-tested live the same day before being recorded as Settled. Front door:
[`coldlion-open-questions.md`](coldlion-open-questions.md).

## What they said

> **Document Updates:** MgTypeCode: Updated the documentation to reflect values from 01 to 14.
> Active values should be Y or N.
>
> **Divisions:** Company Edgehome contains 4 division codes. I have created the /divisions API to
> get them.
>
> **Maintenance Tables (LabelCode, WarehouseCode, ColorCode, DimCode):** Would you like us to create
> lookup APIs for these, or should we include their descriptions directly in the API response?
> SizeCode: NS is currently the only available option in the system (we don't make apparel, we don't
> use sizeCode). Merch Groups (01–06): These can be retrieved via /merchGroupHeaders and
> /merchGroupDetails.

## What we measured

| Claim | Test | Result |
|---|---|---|
| A `/divisions` endpoint now exists | `GET /divisions?companyCode=EDGEHOME` | **Works.** 4 rows, `totalElements = 4`, sorted by division code |
| Four division codes | same call | **Confirmed:** `CW001` POP Creations (Licensed Products), `EH001` Edge Home, `EP001` Edgeucational Publishing, `SP001` Spruce (Licensed Products). All `active = Y` |
| The size code has one value | every item on the tenant — 19,362 rows, full pagination | **Confirmed:** `NS` on 19,346 rows (99.92%), blank on 16. No third value |

Sized by **row count, not by elapsed time**: the size-code test read the entire item catalogue, not
a sample.

## Three things their answer does not say, that we found by testing

1. **The field is `sizeRangeCode`, not `sizeCode`.** No field named `sizeCode` exists on the item
   response. Their sentence is right about the business fact and wrong about the field name.
2. **`labelCode`, `warehouseCode`, `colorCode` and `dimCode` are not on `/items` at all.** They are
   fields of the order-history and production-history responses. A lookup API hung off the item
   endpoint would sit beside data that endpoint never returns.
3. **`EP001` is active in the ERP but out of scope for us.** Publishing the authoritative list
   surfaced a fourth division we had no renumbering date for. **Owner ruling, Albert 2026-08-28:
   Edgeucational Publishing will never be part of this system.** Filter it at ingestion; it is not
   a gap to close.

## What is owed, and by whom

- **Us → ColdLion:** an answer to their maintenance-table question. Recommendation and reasoning are
  in entry 2.16 of the register: **inline descriptions, and only for `labelCode` and
  `warehouseCode`.** Albert sends it.
- **ColdLion → us:** field descriptions in the spec, and the meaning of `merchGroup01`–`merchGroup06`
  (entry 2.13). Narrow, and worth bundling with the reply above.

## Loader consequences

- Stop hard-coding division codes; read `/divisions`.
- Ignore `sizeRangeCode`. **Product size is merchandise group 04**, which is populated.
- `mgTypeCode` runs 01–14. **Ten slots have headers, not six**, and the names come from
  `/merchGroupHeaders` **per division** — CW001/SP001 read 05/06/07 as Licensor / Property / Style
  Guide, EH001 reads them as Big Theme / Little Theme / Art Type. Slots 07–10 carry data on
  5.7%–27.2% of items; 11–14 are empty everywhere. Our earlier note calling 07–14 "legacy
  positions" was wrong.
- The merchandise-group `active` flag is `Y`/`N` — a two-value flag.

## Follow-up measurement, same day — order-history field population

Re-measured because a draft reply nearly re-raised a withdrawn issue.

**10,397 `orderHistory` rows, four one-week windows per year, 2019–2026.**

| Field | 2019 | 2021 | 2023 | 2025 | 2026 |
|---|---|---|---|---|---|
| `invoiceNoString` / `invoiceDateString` | 88.3% | 71.9% | 93.7% | 84.9% | 41.9% |
| `lineInvoiceQty` / `shipQty` | ~49.5% | 70.4% | 93.4% | 84.9% | 41.9% |
| `shipAmount` | 100% | 100% | 100% | 100% | 100% |
| `lineOpenQty` | 0% | 0% | 0% | 0% | 34.0% |
| `unshippedQty` | 0% | 0% | 1.7% | 0% | 55.5% |
| `warehouseCode` | 91.1% | 100% | 100% | 100% | 100% |
| `labelCode` | 5.5% | 34.5% | 50.5% | 89.5% | 100% |
| `colorCode` | 100% | 100% | 100% | 100% | 100% |
| `dimCode` | 1.6% | 0% | 0% | 0.1% | 0% |

Three conclusions:

1. **ColdLion's issue-2 rule is confirmed and applicable.** Open and unshipped are zero throughout
   2019–2025 while invoice numbers are present on most rows; only the current year carries live
   values. Historical zeros are true zeros.
2. **The invoice and shipping fields are NOT empty on history.** Issue 1 was correctly withdrawn on
   2026-08-27 and must stay withdrawn.
3. **`dimCode` is dead and `labelCode` grew into use over time.** Descriptions are worth having for
   `labelCode` and `warehouseCode` only.

## A measurement fault worth remembering

The false "all empty" reading came from a probe that expected a `content` / `totalElements` envelope.
**`orderHistory` returns a bare JSON array; `/items`, `/divisions` and `/merchGroupHeaders` return
the envelope.** The probe silently read nothing and reported 0%. Raised to ColdLion as issue 8.

Also observed: `orderHistory` already returns `merchGroup01Desc` through `merchGroup06Desc` inline
alongside the codes, populated on 99.6% of rows — which is precisely the pattern we are asking them
to extend to `labelCode` and `warehouseCode`.
