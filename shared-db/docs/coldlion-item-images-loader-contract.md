# ColdLion `/itemImages` metadata — landing table and loader contract (issue #2179)

**Owner decision (2026-09-28, Albert Hazan, chat):** "keep" — ingest all fourteen
`/itemImages` metadata fields. Recorded field by field in
`docs/coldlion-field-decisions-20260819.csv` (feed `itemImages`). Image bytes
(`resourceContent`, `thumbnail128`) remain excluded under the standing
no-image-bytes ruling and have no column anywhere.

**Table:** `coldlion.item_image_metadata`, migration `20260929093750`, claim #3706.

## Grain

Evidence: private read-only census, `u2giants/licensor-source-data` commit
`2e3b9420f50298d9a7ff748a5c7c7b3e56bb47e9`,
`coldlion/verification/issue-2179-remainder-endpoint-census-20260908/`.
75 lookups on items flagged `hasImage=Y`; 63 returned rows; 75 records.

| candidate key | distinct / rows | verdict |
|---|---|---|
| `pkey` | 75 / 75 | **identity** — primary key `(company_code, pkey)` |
| `resourceId` | 63 / 75 (8 groups) | descriptive only |
| `(companyCode, divisionCode, itemNo, colorCode)` | 63 / 75 (8 groups) | vendor update selector, not an identity |

## Loader contract

The contract is code: `tools/coldlion-landing/lib/item-images-spec.mjs`, pinned by
`tools/coldlion-landing-item-images.test.mjs`. A loader must import it, not restate it.

1. **Order.** Run after the master loader: item numbers are harvested from
   `coldlion.item_header`. `itemNo` is a required request parameter; the response is a
   bare JSON array (no paging).
2. **Bytes never land.** `resourceContent` and `thumbnail128` are stripped before the
   source hash, projection, or any retained audit payload.
3. **Zero rows is evidence.** `hasImage=Y` is not proof (12 of 75 flagged items
   answered `[]`). Record zero-row items on the `sync_run`; never treat them as an
   error or as "no image".
4. **Refuse, do not guess.** Unknown field, missing approved field, blank key, a row
   answering another company or item, or two different payloads for one `pkey` abort
   the run before anything is written. An identical repeat is one row.
5. **Source rules.** Blank text lands as null; the `1900-01-01` empty-date marker lands
   as null; `divisionCode` is recorded as sent; no EP001 exclusion.
6. **Access.** Landing only: RLS on, no policy, no application-role grant. Consumers get
   a reviewed `pim.*` view under #2176, never the landing table.
