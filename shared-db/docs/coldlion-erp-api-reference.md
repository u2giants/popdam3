# Coldlion ERP (Edge Home) API — Reference & Sync Map

**Purpose:** authoritative map of the Coldlion "CLAPIServerEhp" API used to import Edge
Home ERP data into the shared Supabase backend (`qsllyeztdwjgirsysgai`). Derived from the
live OpenAPI spec plus real calls made 2026-07-15.

- **Base URL:** `http://x5.coldlion.com/EhpApi` (plain HTTP — not HTTPS)
- **OpenAPI spec (machine-readable):** `http://x5.coldlion.com/EhpApi/v2/api-docs` (Swagger 2.0, API v1.5.1)
- **Swagger UI (human):** `http://x5.coldlion.com/EhpApi/swagger-ui.html#/`
- **Auth:** header `X-API-Key: <key>` on **every** endpoint. Key lives in 1Password →
  vault `vibe_coding` → item *"Coldlion ERP API key x5.coldlion.com"*, field `credential`.
  Use it via `op run` with `op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential`
  — never paste the value. No key → `400 Missing request header 'X-API-Key'`.
- **Company scope:** `companyCode=EDGEHOME` is the tenant. `divisionCode` (e.g. `EP001`,
  `SP001`) narrows further.

## Paging & incremental-sync conventions
List endpoints are Spring-paged:
- `page` (0-based, default 0), `size` (default 50), `sort=property,asc|desc`
- Response envelope: `{ content: [...], totalElements, totalPages, number, size, first, last }`
- Most masters accept **`modifiedFrom` / `modifiedTo`** (some also `createdFrom`/`createdTo`)
  → use for nightly delta pulls instead of full reloads.

Live row counts (2026-07-15): customers **836**, vendors **539**, inventory **8,711**
(items table is large too).

## Endpoint map (all GET unless noted)
| Endpoint | Purpose | Key params |
|---|---|---|
| `/customers` | Customer master | companyCode, customerCode, modifiedFrom/To, paging |
| `/vendors` | Vendor master | companyCode, vendorCode, modifiedFrom/To, paging |
| `/items` | Item **header** master (carries `hasImage` Y/N) | companyCode, divisionCode, itemNo, merchGroup01–06, created/modifiedFrom/To, paging |
| `/itemDetails` | Item **detail** (SKU level: dims, costs, UPC/EAN/GTIN, prices A–H). **PUT** to update | companyCode, divisionCode, itemNo, itemPkey |
| `/itemImages` | Item image content (base64 + thumbnail128). **PUT** to update | itemNo *(req)*, companyCode, divisionCode |
| `/inventory` | On-hand qty by SKU/warehouse | itemNo, warehouseSku, paging |
| `/merchGroupHeaders` | Merch group headers | companyCode, divisionCode, mgTypeCode |
| `/merchGroupDetails` | Merch group values | companyCode, divisionCode, mgTypeCode, mgCode |
| `/prepackDetail` | Prepack breakdowns | prepackCode *(req)*, companyCode |
| `/salespersons` | Sales reps | companyCode, salesPersonCode, lastName |
| `/seasons` | Season codes | companyCode, divisionCode, seasonCode |
| `/pickticket` | Outbound pick transactions | createdFrom/To, transactionDate, minTransactionNo |
| `/receiving` | Inbound receipts | createdFrom/To, transactionDate, minTransactionNo |
| `/proddetails` | Production order detail | companyCode *(req)*, prodOrderNo *(req)* |
| `/prodtracking` | Production tracking | prodOrderNo, created/modifiedFrom/To |
| `/order` | **POST** — insert a sales order | body = `OrderHeader` (with `OrderDetail[]`) |

**Read vs write:** all pulls are read-only GET **except** `PUT /itemDetails`, `PUT /itemImages`,
`PUT /items`, and `POST /order`. The import only needs GETs. Any write path (pushing data
back into the ERP) requires explicit sign-off before use.

> **`PUT /itemImages` is update-only — it cannot create images** (verified live 2026-07-15).
> The body is an `ItemImageDTO` with `resourceContent`/`thumbnail128` as raw base64 JPEG
> (no `data:` prefix). The server locates the row to update by **`itemNo` + `colorCode`**
> (`pkey`/`resourceId` are optional — a PUT with no `pkey` still updates the matching row).
> - PUT matching an existing `(itemNo, colorCode)` image → `200`, swaps the bytes.
> - PUT for an item with **zero** images, **or a new `colorCode`** (no matching row) →
>   `500 InvalidDataAccessApiUsageException: "Target object must not be null"`.
>
> So you can neither seed an item's first image **nor add a second image (new colorCode)**
> through the API — both need a pre-existing row created elsewhere (the ERP UI). There is
> **no POST/insert and no DELETE** for images; existing images can only be overwritten,
> never cleared. Also note: a successful PUT does **not** bump `modTime`/`modUser`, so those
> can't be used to detect API-driven image changes.

## Which items have images? (the efficient pattern)
- `/items` returns a **`hasImage`** flag per item (`"Y"`/`"N"`). One paged sweep of `/items`
  = the full have/don't-have image map. Cheap.
- `/itemImages` is **per-item** (needs `itemNo`) and returns the actual bytes; an empty array
  `[]` means no image. Only call it for `hasImage="Y"` items — do **not** loop it over the
  whole catalog to discover coverage.

## Existing Coldlion sync already running (do not duplicate)
GCP project **`lithe-breaker-323913`** (the DesignFlow/PLM project), region **us-east4**,
runs 6 daily Cloud Scheduler jobs that pull Coldlion → Cloud Run service `popcre-sync-prod`
→ **dflow's Cloud SQL** (dflow does not use Supabase):

| Job | Target path | Schedule (cron) |
|---|---|---|
| `getexternalcustomer` | `/getExternalCustomer` | `0 2 * * *` |
| `getexternalvendor` | `/getExternalVendor` | `0 2 * * *` |
| `getMerchgroupDetailFromCL` | `/getMerchgroupDetailFromCL` | `0 2 * * *` |
| `syncPrepackAssociations` | prepack associations | `0 2 * * *` |
| `getprodorderheader` | `/getProdOrderHeader` | `0 1 * * *` |
| `getprodorderdetail` | `/getProdOrderDetail` | `30 1 * * *` |

**Implication for shared-db:** dflow already ingests customers, vendors, merch groups,
prepacks, and production orders into its own Cloud SQL — a *different* destination from our
Supabase import. It does **not** sync `items` / `itemDetails` / `inventory` / `itemImages`
— the item catalog and images are the gap our Supabase pipeline fills. Reuse
`popcre-sync-prod` only as a reference for cadence/endpoint choice, not as our loader.

## Key object shapes (from the spec)
- **ItemHeader** (~130 fields): itemNo, itemDesc, divisionCode, seasonCode, merchGroup01–14,
  8 price tiers (itemPriceA–H), retailPrice/sellingPrice/itemCost, dimensions/weight,
  `hasImage`, UDFs, timestamps.
- **ItemDetail** (~150 fields): SKU-level — colorCode/sizeCode, cartons/pallets, UPC/EAN/GTIN/ISBN,
  cost components 1–5, variantSKU, warehouseSKU, prices A–H.
- **ItemImageDTO:** itemNo, colorCode, fileName, fileType, `resourceContent` (base64 byte),
  `thumbnail128` (base64 byte), timestamps.
- **OrderHeader → OrderDetail[]:** customer/bill-to/ship-to, dates, `details[]` line items.

## Reproduce
```bash
# full spec
op run --env-file <(echo 'K=op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential') -- \
  curl -s http://x5.coldlion.com/EhpApi/v2/api-docs

# sample pull (customers, first page of 1)
op run --env-file <(echo 'K=op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential') -- \
  bash -c 'curl -s -H "X-API-Key: $K" "http://x5.coldlion.com/EhpApi/customers?companyCode=EDGEHOME&size=1"'
```
