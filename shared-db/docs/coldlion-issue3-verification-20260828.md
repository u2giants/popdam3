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
- `mgTypeCode` runs 01–14; slots 01–06 are the live hierarchy, 07–14 are legacy positions.
- The merchandise-group `active` flag is `Y`/`N` — a two-value flag.
