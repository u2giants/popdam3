# ColdLion unit 5b — live grain proof for `/prepackDetail` and `/proddetails`

Measured 2026-09-15 against `http://x5.coldlion.com/EhpApi`. Issue #2863 (split from
#2179), tracker #2081, plan `plan_coldlion_landing_schema_completion.md` §9 Step 6.
Migration `20260916001944_coldlion_prepack_and_prod_detail_landing.sql`, test
`supabase/tests/coldlion_prepack_prod_detail_landing_contracts.sql`.

Field names, counts, shapes and distinct-key counts only. No row values, no customer or
vendor identifiers, no licensed data.

## 0. Why these two feeds are authorable now

Unit 5a recorded both as unauthorable because each needs a request key we believed we
could not obtain. That was our error and it was withdrawn on 2026-09-03
(`docs/coldlion-open-questions.md` item 2.33): `prodOrderNo` comes off `/prodHistory`
rows, and `prepackCode` comes off `/inventory` rows and off `/proddetails` itself.
**Nothing is needed from ColdLion.** Both feeds were enumerated and sampled live for this
migration.

Unlike the unit 5a feeds, `GET /v2/api-docs` **does** type these two (`PrepackDetail`,
`ProdOrderDetail`), and on this date the live field union matched the typed definition
exactly on both — 18 and 21 fields. That is a coincidence of freshness, not a contract:
the spec is wrong about other feeds, so a loader's unknown-field refusal must still be
keyed to the sampled shape below.

## 1. `/prepackDetail` — 18 fields, bare array

Request: `GET /prepackDetail?companyCode=EDGEHOME&prepackCode=<PPK code>`. Both
parameters are required; there is **no page envelope** — the response is a bare JSON
array. The feed cannot be paged, only enumerated: 335 distinct `prepackCode` values were
harvested from `/inventory?size=2000&page=0`, plus the populated `prepackCode` values on
`/proddetails`. 120 codes were requested; **every one returned rows**, 456 rows in total.

An early probe using `prepackItemNo` values off `/prodHistory` returned `[]` on all 14
tries. Those are item numbers, not prepack codes. The request key is `prePackCode` /
`prepackCode` in `PPK####` form.

### Grain

| candidate key | distinct | of 456 | duplicate groups | verdict |
|---|---|---|---|---|
| `companyCode + prePackCode + sequence` | 456 | 456 | 0 | **unique — chosen** |
| `companyCode + prePackCode + itemNo` | 456 | 456 | 0 | unique here, but descriptive |
| `companyCode + divisionCode + prePackCode + itemNo + colorCode + sizeCode + dimCode + labelCode` | 456 | 456 | 0 | unique here, but descriptive |

The descriptive tuples do not *disprove* the key, but they describe the row rather than
identify it. `sequence` is the line identity the vendor emits within one prepack
(observed 1..12).

This feed carries **no vendor row id** — there is no `pkey`. The chosen key is therefore
the smallest proven *source* identity, and the table's surrogate is that key itself, not
a generated UUID. It is not a guess: it is the vendor's own line numbering, and it is
asserted as the primary key so a pull that breaks it fails loudly.

`companyCode` **is** present in this payload (`EDGEHOME` on all 456 rows). It still leads
the key so a second tenant cannot collide on one prepack code.

**Chosen grain: `(company_code, prepack_code, sequence_no)`. Zero duplicate collapse.**

### Disposition — all 18 fields land

`docs/coldlion-field-decisions-20260819.csv` is the owner's field authority, but it
covers only `/items`, `/itemDetails`, `/prodHistory`, `/orderHistory`, `/customers`,
`/vendors`, `/merchGroupDetails` and `/merchGroupHeaders`. **It does not cover this feed
or `/proddetails`.** No field of either feed is marked ignore by the owner, so the
landing layer takes all of them, as unit 5a did; promotion out of landing remains a
separate owner decision.

| source field | type | column | distinct | blank |
|---|---|---|---|---|
| `companyCode` | string | `company_code` (PK) | 1 | 0 |
| `prePackCode` | string | `prepack_code` (PK) | 120 | 0 |
| `sequence` | int | `sequence_no` (PK) | 12 | 0 |
| `divisionCode` | string | `division_code` | 3 | 0 |
| `itemNo` | string | `item_no` | 430 | 0 |
| `colorCode` | string | `color_code` | 1 | 0 |
| `sizeCode` | string | `size_code` | 1 | 0 |
| `dimCode` | string | `dim_code` | 1 | 456 |
| `labelCode` | string | `label_code` | 3 | 446 |
| `quantity` | int | `quantity` | 3 | 0 |
| `detailPrepack` | string | `detail_prepack` | 1 | 456 |
| `itemCost` | float | `item_cost` | 12 | 0 |
| `itemPrice` | float | `item_price` | 17 | 0 |
| `ItemPrice` | float | `item_price_capitalized` | 17 | 0 |
| `createdTime` | string | `created_time` | 123 | 0 |
| `createdUser` | string | `created_user` | 3 | 0 |
| `modTime` | string | `mod_time` | 127 | 0 |
| `modUser` | string | `mod_user` | 4 | 0 |

**`itemPrice` and `ItemPrice` are two distinct properties on every row** — a genuine
duplicate-cased field, present in `/v2/api-docs` as well. They were equal on all 456
sampled rows, but nothing in the source guarantees that, so both land and neither is
dropped. A loader must not fold them.

`sequence` is renamed to `sequence_no` only to keep a bare SQL keyword out of the column
list. `quantity` is the recipe multiplier (observed 1..3).

## 2. `/proddetails` — 21 fields, bare array

Request: `GET /proddetails?companyCode=EDGEHOME&prodOrderNo=<n>`. Both parameters are
required; **bare array, no page envelope**. `prodOrderNo` values were harvested from
`/prodHistory` across seven 7-day windows (2026-04-14, 05-12, 06-09, 07-07, 08-04, 08-18,
09-08). 45 production orders were requested; **every one returned rows**, 166 rows in
total.

### Grain

| candidate key | distinct | of 166 | duplicate groups | verdict |
|---|---|---|---|---|
| `pkey` | 166 | 166 | 0 | **unique on its own — real vendor row id, chosen as PK** |
| `prodOrderNo + prodLineSeq` | 166 | 166 | 0 | ~~independently unique — asserted as a unique constraint~~ **FALSIFIED on the full population 2026-09-20 — see the note below this table** |
| `prodOrderNo + itemPkey` | 158 | 166 | 4 | **not unique** — one item appears on several lines of an order |

Two identities were proven independently and **both are asserted**: `pkey` as the primary
key, `(prodOrderNo, prodLineSeq)` as a unique constraint. A future pull that breaks
either one fails visibly instead of collapsing two lines into one. The third row above is
the reason: a plausible-looking key really does collapse rows here, and only measurement
tells them apart.

The payload carries **no `companyCode`** even though the request requires one, so
`company_code` is stamped from the request and leads the primary key.

**Chosen grain: `(company_code, pkey)`, with `(company_code, prod_order_no,
prod_line_seq)` unique. Zero duplicate collapse on either.** *(The second half of this
sentence is falsified — see the note below.)*

> **SUPERSEDED IN PART — first noted 2026-09-18 (issue #3234), re-measured and
> CORRECTED 2026-09-20.** The `(prodOrderNo, prodLineSeq)` uniqueness measured below
> is a fact about THIS 166-row SAMPLE only. A full read-only scan of the population on
> 2026-09-20 (every `prodOrderNo` 1–60000 for EDGEHOME, the only company code;
> **3,819 orders return rows**) found **11 groups across 9 orders** — 20344, 20959,
> 21907, 21918, 21928, 23465 (×2), 23475 (×3), 23587 — where two or more rows share one
> `prodOrderNo` + `prodLineSeq`. **`pkey` remains distinct in every group and unique
> across the whole population.**
>
> **The 2026-09-18 note on this page and the body of #3234 both said the collisions were
> "two real distinct lines, not an echo". That is wrong, and the correction matters.**
> The groups take five distinct shapes and only some are distinct lines: an exact
> duplicate in every business field created 140 ms apart (20959 line 1); a quantity split
> across two rows of one item (23465 lines 1 and 2, 21918 line 3, 21928 line 7); one item
> on one line at many different costs (23475 line 1 carries seven rows); two different
> `itemNo` on one line (21907 line 22, 23587 line 1); and a zero-quantity row with a
> different `itemPkey` shadowing a real one (20344 line 10).
>
> **What this page may still be used for:** `pkey` as the identity, and the field
> dispositions below. **What it may NOT be used for:** asserting `(prodOrderNo,
> prodLineSeq)` as an identity, or concluding what a colliding group means.
>
> The loader refuses the colliding keys durably (`sync_run` `refused:
> identity-collision`) so nothing is recorded wrongly. The constraint decision (#3234)
> is **blocked on ColdLion** — the question was sent 2026-09-20 and is registered as
> open question 2.36 in [`coldlion-open-questions.md`](coldlion-open-questions.md),
> with blocker ticket #3351. Do not drop, re-key or keep the constraint before that
> answer: dropping it would land the exact-duplicate and split-quantity shapes as
> separate lines, and if either should have been summed the landed cost for that order
> is wrong.

### Disposition — all 21 fields land, plus the request-stamped `company_code`

Same owner-authority note as §1: the field-decisions CSV does not cover this feed.

| source field | type | column | distinct | blank |
|---|---|---|---|---|
| *(request)* | — | `company_code` (PK) | 1 | — |
| `pkey` | int | `pkey` (PK) | 166 | 0 |
| `prodOrderNo` | int | `prod_order_no` (unique) | 45 | 0 |
| `prodLineSeq` | int | `prod_line_seq` (unique) | 33 | 0 |
| `divisionCode` | string | `division_code` | 3 | 0 |
| `itemPkey` | int | `item_pkey` | 145 | 0 |
| `itemNo` | string | `item_no` | 144 | 0 |
| `itemDesc` | string | `item_desc` | 143 | 0 |
| `colorCode` | string | `color_code` | 1 | 0 |
| `sizeCode` | string | `size_code` | 1 | 0 |
| `dimCode` | string | `dim_code` | 1 | 166 |
| `labelCode` | string | `label_code` | 11 | 6 |
| `prepackCode` | string | `prepack_code` | 32 | 126 |
| `prodQty` | int | `prod_qty` | 61 | 0 |
| `wipQty` | int | `wip_qty` | 32 | 0 |
| `prodCost` | float | `prod_cost` | 76 | 0 |
| `custPONumber` | string | `cust_po_number` | 35 | 31 |
| `merchGroup05Desc` | string | `merch_group_05_desc` | 20 | 54 |
| `createdTime` | string | `created_time` | 148 | 0 |
| `createdUser` | string | `created_user` | 2 | 0 |
| `modTime` | string | `mod_time` | 96 | 0 |
| `modUser` | string | `mod_user` | 2 | 0 |

`item_desc` is free text and `merch_group_05_desc` is a licensor/property label. They are
landing-layer evidence only: the schema has no application grants, and no promotion may
expose either without an owner ruling.

`prepack_code` is blank on 126 of 166 rows — most production lines are not prepacks. When
populated it is exactly the `/prepackDetail` request key, which is how
`coldlion.prepack_detail` is enumerated.

## 3. Live values a loader must tolerate

- **Empty string, never null.** Neither feed returned a single JSON `null` in any field of
  any row. ColdLion sends `""` instead. Blank counts are in the tables above. Text columns
  are therefore nullable and are **not** check-constrained non-blank: the landing layer
  records what arrived.
- **`1900-01-01` empty-date marker: zero instances.** Every `createdTime` and `modTime` on
  both feeds was a real timestamp (earliest `2019-04-17` on `/prepackDetail`,
  `2026-04-14` on the sampled `/proddetails` window). The spine rule still holds for a
  loader; it simply has no instance here yet.
- **Division casing is not normalised.** `CW001`, `EH001` and `SP001` are all live in both
  feeds and are recorded exactly as sent.
- **Numbers.** `quantity`, `sequence`, `pkey`, `prodOrderNo`, `prodLineSeq`, `itemPkey`,
  `prodQty` and `wipQty` arrive as JSON integers; `itemCost`, `itemPrice`, `ItemPrice` and
  `prodCost` as floats. `pkey`, `prodOrderNo` and `item_pkey` land as `bigint`; the money
  and quantity floats land as `numeric` so no precision is invented or lost.
- **Neither response is paged.** A loader must not look for `content` / `totalElements`
  here, and must not assume a request key it has not harvested.

## 4. Why no EP001 exclusion check

Same reason as unit 5a: these are transactional feeds, not curated masters. An exclusion
constraint would fail an entire load rather than filter a row, and the landing layer's job
is to record what the source sent. Division filtering belongs to promotion, not landing.

## 5. Why no child tables

Neither feed contains a repeated group. Each is already flat at one row per line — the
prepack recipe line and the production-order line respectively. Plan Step 6 requires a
child table only where a repeated group exists.

## 6. Re-derivation

These counts are the 2026-09-15 measurement. Re-derive them before the loader lands
(Step 7, its own claim). The censuses above were computed over the saved sample by
grouping candidate keys and counting groups with more than one member; every "duplicate
groups" cell above is that count, and only the `prodOrderNo + itemPkey` row is non-zero.
