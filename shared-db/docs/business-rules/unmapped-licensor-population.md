# Measuring the "missing Licensor" population

**Status:** Settled

The owner rulings recorded here are Settled. The counts are **verified
measurements** dated 2026-09-06 and 2026-09-07, not rules; the superseded chain
below is explicitly marked Historical at the point a reader meets it.

This page exists because the same question — "how many of our items have no
Licensor?" — was answered four different times with four different numbers, and
three of those answers were wrong. It records the correct method, the correct
answer, and the specific mistakes, so that the next person to ask does not
repeat them.

The business meaning of the fields used here is not restated. Licensor and
Property live in MG05 and MG06 in the licensed divisions — see
[`merchandise-and-product-taxonomy.md`](merchandise-and-product-taxonomy.md).
Prepacks, assortments and non-inventory rows are defined in
[`product-items-and-identifiers.md`](product-items-and-identifiers.md). Licensor
identity and authority are in
[`licensing-master-data.md`](licensing-master-data.md).

## The bottom line

A headline figure of thousands of "unmapped" items resolved, on evidence, to a
single real product needing a Licensor.

## Three different starting populations, three different questions

These three numbers were all reported at some point as "the unresolved items".
They are not the same measurement and must never be compared to each other.

| Count | What it actually measures |
|---|---|
| **6,350** | Every ColdLion item with no Licensor or Property resolved, **across all divisions** — including the two divisions that carry no licensed product at all. |
| **2,016** | The licensed divisions only, taken from our loaded copy: `plm.item_import_unresolved` joined to `plm.item` where the load outcome is `unresolved`. CW001 **1,870** + SP001 **146**. This measures what *our loader* failed to resolve. |
| **15,049** | The live ColdLion `/items` feed for company `EDGEHOME` restricted to `CW001` + `SP001` — the full licensed item population, not a gap. This is the correct denominator, and the authoritative chain below starts here. |

The gap between 6,350 and 2,016 is entirely the non-licensed divisions. The gap
between "our loader failed" and "the source has no Licensor" is a different
question again: the first is a defect in our code, the second is a data gap at
the ERP.

## The authoritative chain — from the live ColdLion feed

**Measured 2026-09-07 against the live `/items` feed, one division at a time.**

| Step | Count | Exclusion applied |
|---|---|---|
| Licensed item population | **15,049** | `companyCode=EDGEHOME`, `divisionCode` in `CW001`, `SP001`. |
| No Licensor evidence of any kind | **1,634** | Both `merchGroup05` (the Licensor code) **and** `royaltyCode` are blank. |
| Not an assortment or a bookkeeping row | **214** | Remove prepack heads, prepack members, and rows whose description or item number identifies an ERP charge line. |
| Recent, real style numbers | **23** | `createdTime` on or after 2022 (owner ruling below), and drop 7-character style numbers. |

By year the 23 split **2022: 2, 2023: 6, 2024: 2, 2025: 7, 2026: 6**. That is
**flat**. An earlier report that the problem was getting worse every year was
built on the wrong field and is withdrawn.

## What the 23 actually are

23 rows covering 22 unique items — `FOILCORNER` appears once per division.

- **14 are ERP charge lines**, not products. No Licensor applies.
- **5 are multi-license assortments** — `MB9306`, `MB9307`, `VS6216`, `VS1408`,
  `21341`. Blank is the correct state for an assortment head.
- **2 are uncleaned test rows** — `V6B87W201` and `V6B87W202`, both described
  "Uma – Test Item" and both carrying property `W2 WICKED PART II`. They should
  be deleted, not filled in.
- **1 is a genuinely routable product**: **`VSZ93SH01`**, created 2024,
  `13x19"x1.5" NBC Shrek Green Vibes Only Palin Canvas`, property `SH SHREK`.
  It routes to **NBCUniversal, not Disney** — the basis is the item's own
  property code `SH SHREK` plus the "NBC" in its controlled description, not a
  guess from the artwork.

## Superseded: the database-derived chain, and why it was invalidated

**Historical.** This chain was produced on 2026-09-06 from our loaded copy of
the item master. Every individual step below was a legitimate exclusion, and
several of them are still the right thing to do. The chain as a whole is void.

| Step | Count | Exclusion, and why it was legitimate |
|---|---|---|
| Loader-unresolved, licensed divisions | 2,016 | CW001 1,870 + SP001 146. |
| Minus non-product rows | 2,011 | 5 invoicing, sample and test rows identified from their descriptions. Correct — they are not products. |
| Minus assortments | 608 | 1,269 rows carrying an ERP prepack code, plus 134 more whose descriptions read "Asst", "Assorted" or "Mixed License". Correct in intent: an assortment head legitimately has no single Licensor. |
| Minus shape-heuristic error | 288 | The style-number "prepack shape" heuristic was replaced by the stock record's own `prepackCode`. Correct — evidence replaced a guess. |
| Minus old and bookkeeping rows | 31 | 234 rows created 2021 or earlier, 26 ERP artifacts, 2 junk descriptions, per the owner ruling below. Correct. |

**Why the whole chain is void:** it read `royaltyCode` as the Licensor. In the
licensed divisions the Licensor is **MG05**, and our own published rules already
said so. `royaltyCode` is blank on most items whether they are licensed or not,
so every count derived through it is meaningless — including the 31.

A later re-run replaced `royaltyCode` with `merchGroup05Desc` and produced
**949**, with an apparent year-on-year worsening trend. That was also wrong:
`merchGroup05Desc` is the Licensor *display name*, which is frequently blank
while the code beside it is populated. The 949 figure and the 367-item Licensor
mapping proposal built on it were both withdrawn. Only the 23 above stands.

## Method rules this produced

These are stated as rules a future reader can apply. Each is also recorded next
to the business rule it belongs to.

1. **Break the population by division before counting it.** A whole-company
   count silently mixes non-licensed divisions into a licensed-item
   measurement. This alone accounted for 4,334 of the original 6,350.
2. **Read the field the business rules already name.** This analysis was
   invalidated twice — once by reading `royaltyCode`, once by reading
   `merchGroup05Desc` instead of `merchGroup05`. Both times the correct field
   was already documented and had simply not been read.
3. **Evidence beats shape.** A prepack/assortment heuristic based on the shape
   of the item number was wrong in **both** directions: it missed 41
   assortments with normal-looking numbers and it discarded genuine components.
   It was replaced by the stock record's own `prepackCode`. Supporting measure:
   1,846 prepack heads and 4,662 prepack members, with only **3** items
   appearing in both — the two sets are effectively disjoint.
4. **The exclusions people repeatedly forget**, in the order they bite:
   non-licensed divisions, prepack heads, prepack members, ERP charge lines,
   uncleaned test rows.
5. **Prove a vendor fault with a differently-shaped query first.** A blank
   display-name finding was on the point of being reported to ColdLion as an API
   defect before a per-division pull showed it was our own query shape. The
   worked example is recorded in
   [`../coldlion-erp-api-reference.md`](../coldlion-erp-api-reference.md),
   under the `/items` division warning.

## Operational facts established by this work

These have no better home today.

- **`plm.item.style_number` is NULL on every row.** The only working lookup key
  into the loaded item master is `raw->>'itemNo'`. Any join or screen written
  against `style_number` silently matches nothing.
- **`api.plm_item_list` has no reader in any application.** A full search across
  every application repository found it only in generated type files. Changing
  or repointing it therefore has no direct screen impact on its own.
- **ColdLion exposes no Licensor or Property list endpoint.** `/licensors`,
  `/properties`, `/royalty` and similar all return 404. Licensor and Property
  values come from `/merchGroupDetails` with `mgTypeCode=05`/`06`, per the
  endpoint map in
  [`../coldlion-erp-api-reference.md`](../coldlion-erp-api-reference.md).

## Two ColdLion data faults that survived the vendor re-check

Both were re-verified against the live feed on 2026-09-07 after a third
suspected fault turned out to be our own query. These two are genuine.

- **Charge-like items are inconsistently flagged non-inventory.** Of 13
  charge-like descriptions in the licensed divisions, `CHARGE`, `LCL CHARGE`,
  `MOLD` and `PrintCharge` carry `Y`, while `COLOR CORNERS`, `DUTY`,
  `FOILCORNER`, `HANDLING`, `LABELING FEE`, `REWORK` and `SAMPLECHRG` are all
  still `N`. Total flagged `Y` in scope: **9**. This is the live-feed
  confirmation of the maintenance gap already recorded in
  [`product-items-and-identifiers.md`](product-items-and-identifiers.md).
- **Four assortments carry no assortment marking of any kind.** `MB9306`,
  `MB9307`, `VS6216` and `VS1408` have MG05, MG06 and pack type all blank and
  `nonInventoryItem = N`. They are recognisable only from their descriptions,
  which is exactly why they present as ordinary products with a missing
  Licensor. This is consistent with assortment status living on the stock
  record: an assortment that was never stocked looks like a plain item.
