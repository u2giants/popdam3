# Coldlion ERP → Supabase item mirror — field mapping

Companion to [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md). Maps the
Coldlion item data onto the existing Supabase mirror (`public.erp_items_current`, served by
`api.plm_item_list`). Written 2026-07-15 against live production.

> **Relocation in progress.** This mirror is being moved out of `public` into the designed
> `ingest` / `plm` / `api` layers — see [`../fix_schema_for_api.md`](../fix_schema_for_api.md).
> Phase 1 (the `api.plm_item_list` serving view) is already live. The "two source options"
> decision below (through-dflow vs. Coldlion-direct) is the open input to that plan's Phase 3.

## Key finding first: the current mirror is fed *through dflow*, not from Coldlion directly

`public.erp_items_current` holds **17,703** items, all `source_system = 'designflow'`. The
landing table `public.erp_items_raw.raw_payload` is **DesignFlow's** item shape, **not** the
Coldlion `CLAPIServerEhp` shape. Example raw payload keys:

```
id:18850, itemNum, item_name, size, mgCategory, licensor, property, refNum, season, status,
pic:{Thumbnail, FullSizePicture}, licensor_id/property_id/material_id/feature_id/construction_id,
"Product Type ( Material)", "Product Sub-Type (Construction)", "Product Sub-Sub-Type (feature)",
prepackCode, prepackCodes[], prodOrderDetails[]
```

So today's pipeline is **Coldlion → dflow (Cloud SQL + enrichment) → dflow item API → Supabase
`erp_items_raw` → `erp_items_current`**. The dflow layer is where raw Coldlion merch-group codes
get *enriched* into human labels (licensor/property names, Product Type/Sub-Type/feature).

**Design decision this forces:** do we keep sourcing the Supabase item mirror **through dflow**
(get the enrichment for free, one upstream) or pull **Coldlion `/items` directly** (fresher, no
dflow dependency, but we'd re-implement the merch-group → licensor/property enrichment)? See
"Two source options" below.

## Existing ingest pipeline (already built)
| Table | Role |
|---|---|
| `public.erp_items_raw` | raw landing — `raw_payload` jsonb per item, `sync_run_id`, `fetched_at` |
| `public.erp_items_current` | current/clean mirror (25 cols) — the served state |
| `public.erp_sync_runs` | one row per sync run |
| `public.erp_enrichment_log` | enrichment audit |
| `api.plm_item_list` | read-facing view (Phase 1 migration) |

## `erp_items_current` columns → source
| Column | dflow raw_payload key (current source) | Coldlion `/items` field (direct-pull equivalent) |
|---|---|---|
| `external_id` / `style_number` | `itemNum` | `itemNo` |
| `item_description` | `item_name` | `itemDesc` |
| `mg_category` | `mgCategory` | `mGCategory` |
| `mg01_code` | `Product Type ( Material)` | `merchGroup01` |
| `mg02_code` | `Product Sub-Type (Construction)` | `merchGroup02` |
| `mg03_code` | `Product Sub-Sub-Type (feature)` | `merchGroup03` |
| `mg04_code`–`mg06_code` | (further dflow merch fields) | `merchGroup04`–`merchGroup06` |
| `licensor_code` | `licensor` (enriched label) | ⚠️ **gap** — Coldlion has no explicit licensor; it lives in a `merchGroupNN`/`royaltyCode`. Needs a code→label map |
| `property_code` | `property` (enriched label) | ⚠️ **gap** — same as licensor |
| `size_code` | `size` | `sizeRangeCode` (header) / `sizeCode` (detail) |
| `division_code` | *(null in dflow path)* | `divisionCode` ✅ (direct pull would populate this) |
| `prepack_code` | `prepackCode` | `prePackCode` (itemDetails) |
| `prepack_codes` | `prepackCodes[]` | derive from `/prepackDetail` |
| `dismissed` | dflow `is_item_active`/`is_item_old` | derive from `itemStatus`/`itemDiscontinued` |
| `erp_updated_at` | `created_date`/modified | `modTime` |
| `raw_mg_fields` | original merch-group jsonb | pack `merchGroup01`–`14` |
| `source_system` | `'designflow'` | would be `'coldlion'` |

## Fields available from Coldlion but NOT in the mirror today (candidates)
Direct Coldlion pull unlocks fields the dflow path drops:
- **`hasImage` (Y/N)** on `/items` — cheap image-coverage flag (see reference doc). Not stored today.
- **`divisionCode`** — currently null in the mirror; Coldlion populates it.
- **Pricing & cost** — `itemPriceA`–`H`, `retailPrice`, `sellingPrice`, `itemCost`, cost components (`/itemDetails`).
- **Identifiers** — `upc`, `ean`, `gtin`, `isbn`, `warehouseSKU`, `variantSKU` (`/itemDetails`).
- **Physical** — dimensions, weight, carton pack data (`/itemDetails`).
- **Vendor** — `vendorCode` per item.
- **Images** — `/itemImages` returns `resourceContent` (base64) + `thumbnail128`; dflow's `pic{}` was empty in sampled rows.

## Image coverage (Albert's question)
- To know **which items have images**: pull `/items` and read `hasImage`. One sweep = full map.
- To **fetch** an image: call `/itemImages?itemNo=…` only for `hasImage='Y'` items (`[]` = none).
- No image bytes are stored in `erp_items_current` today. If we want image coverage/thumbnails
  in Supabase, add a companion table (e.g. `erp_item_images`: external_id, has_image, thumbnail,
  fetched_at) rather than widening the item row.

## Two source options for the Supabase mirror
1. **Keep sourcing through dflow (status quo).** Pro: licensor/property/type enrichment already
   done upstream; one integration. Con: depends on dflow's sync cadence; misses pricing/UPC/
   dimensions/images/division unless dflow adds them; `division_code` stays null.
2. **Pull Coldlion `/items`+`/itemDetails`+`/itemImages` directly into `erp_items_raw`.** Pro:
   fresher, full field set (pricing, UPC, dimensions, division, images, hasImage), no dflow
   dependency. Con: must re-implement the merch-group → licensor/property enrichment that dflow
   does today (needs the code→label maps from Coldlion `/merchGroupDetails`).

**Recommendation:** if the Supabase item mirror only needs the catalog/merch view it has now,
option 1 is fine and cheapest. If downstream apps need pricing, UPC/barcodes, division, or image
coverage, go option 2 for `items`/`itemDetails`/`itemImages` and keep licensor/property enrichment
by joining `/merchGroupDetails`. Decide by the consumer requirements before building the loader.

## Open questions to confirm before building a loader
1. Which Coldlion `merchGroupNN` position encodes **licensor** and which encodes **property**?
   (dflow already knows this mapping — extract it, or derive from `/merchGroupDetails` by `mgTypeCode`.)
2. Do downstream Supabase consumers need pricing/UPC/dimensions/images? (Picks option 1 vs 2.)
3. Is `dismissed` driven by `itemStatus`, `itemDiscontinued`, or dflow's `is_item_active`?
