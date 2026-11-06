# ColdLion `/items` merchandise-group description flap — vendor report (#5758 Step 1v)

Prepared 2026-11-05 for ColdLion support. Albert Hazan (POP Creations) sends this;
the data below was captured read-only from our landing database on 2026-11-05
6:18 PM EST. These are product labels, not secrets; nothing is redacted.

## Summary

Across consecutive **successful** `/items` full-snapshot pulls with identical
parameters, the same item returns the same `merchGroupNN` **code** but its
`merchGroupNNDesc` alternates between the real label and null/blank. Measured on
the newest 3,000 changed item headers: **2,981 changed descriptions only**; the
same holds for 2,994 of 3,000 merch-group slot rows. The descriptions are not
missing from your master data: `/merchGroupDetails` returns them non-null at both
times. It looks like the `/items` response intermittently omits the description
family for some pages/items — and because `/items` is requested without a sort
parameter, unstable page boundaries are a second way the same symptom could
appear.

## The two runs compared

| | Run A (earlier state) | Run B (flap observed) |
|---|---|---|
| sync_run id | `0b9f28b7-1b22-4182-8914-dcdaef38e421` | `adefd39d-9eac-41d7-b26c-f5087898a65f` |
| Started | 2026-11-04 8:06:32 AM EST | 2026-11-05 9:46:19 AM EST |
| Finished | 2026-11-04 8:08:54 AM EST | 2026-11-05 9:48:37 AM EST |
| Wire HTTP / body status | 200 / none | 200 / none |
| `totalElements` (rows received) | 19,891 | 19,935 |
| Pages (`totalPages`) | 10 | 10 |
| Request per page | `companyCode=EDGEHOME&page=<0..9>&size=2000` | identical |

Both runs are the same documented call (no filters, no sort). The only
difference is time of day.

## Evidence pairs (three items)

For each item, the previous state is the raw payload recorded at that item's
last logged change before run B (the blank-description era of Nov 3–4), and the
new state is run B's payload. Fields not listed did not change.

### 1. Item `AAA1301` (division `CW001`)

- Changed fields: `merchGroup01Desc`, `merchGroup02Desc`, `merchGroup03Desc`, `merchGroup04Desc`
- Previous (blank era): all four `merchGroup0N` codes present, all four
  `merchGroup0NDesc` **null**
- Run B: codes unchanged —
  `merchGroup01Desc` "Stretched/Box", `merchGroup02Desc` "Canvas",
  `merchGroup03Desc` "Plain", `merchGroup04Desc` "10X13.5\""

### 2. Item `AAA1401` (division `CW001`)

- Changed fields: `merchGroup01Desc` … `merchGroup04Desc`
- Previous (blank era): codes present, descriptions **null**
- Run B: codes unchanged —
  `merchGroup01Desc` "Stretched/Box", `merchGroup02Desc` "Canvas",
  `merchGroup03Desc` "Plain", `merchGroup04Desc` "11X14\""

### 3. Item `AAA14DYLS01` (division `CW001`)

- Changed fields: `merchGroup01Desc` … `merchGroup05Desc`
  (`merchGroup06Desc` "Disney Stitch Franchise" was present on BOTH sides)
- Previous (blank era): codes present, `merchGroup01Desc`–`merchGroup05Desc`
  **null**
- Run B: codes unchanged — slots 01–04 as item 2, plus
  `merchGroup05Desc` "DISNEY"

The slot-grain trail shows the same thing, e.g. item `AAA20SWDV01` slot 4:
`mg_desc` null → "20X30\""; slot 5: null → "STAR WARS"; item `AAA2101` slot 2:
null → "Canvas" (code unchanged in every case).

## The master data is intact at both times

`/merchGroupDetails` (`coldlion.merch_group_detail`) carries the labels for
these codes with `mg_desc` non-null and unchanged across the same period — the
omission is specific to the `/items` response, not to the data.

## Second issue: `/items` paging has no sort parameter

`/items` is requested with only `companyCode`, `page`, `size`. If the server's
row order is not stable between page requests, one item can appear on two pages
while another appears on none; the page envelope still counts
`totalElements` correctly, so the corruption is invisible to counts. We now
refuse a snapshot whose fetched keys are not exactly `totalElements` **distinct**
natural keys (loader guard added 2026-11-05). We have not yet observed this
firing (no duplicate or missing key has been caught as of 2026-11-05), but a
sort parameter (or a documented stable order) on `/items` would remove the risk
class.

## What we ask

1. Confirm whether `merchGroupNNDesc` on `/items` (and `/itemDetails`, same
   family, same behavior) is best-effort, and if not, investigate why successful
   full snapshots intermittently omit it.
2. Add a `sort` parameter to `/items`/`itemDetails`, or document the guaranteed
   stable order.
