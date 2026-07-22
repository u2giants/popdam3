# DAM customer free-text → hub reconciliation (2026-07-22)

Purpose: move every DAM customer list onto `api.dam_customer_list` (the curated
`core.customer` hub). Today DAM stores customer as **free text** in
`public.style_groups.customer`, `public.assets.customer`, and
`public.style_tracker_rows.customer`, and builds pickers/filters from those
strings. The canonical `dam.style_group` / `dam.asset` tables (which have a real
`company_id` FK) are **empty** — the app runs on the `public.*` tables.

## Coverage (187 distinct free-text names, 57,896 rows across the 3 tables)

| Bucket | Names | Rows | Share |
|---|---:|---:|---:|
| Exact/alias match → **active** hub customer | 63 | 53,402 | 92% |
| Match → inactive hub customer | 1 | 1 | ~0% |
| **Unmatched** (the tail below) | 123 | 4,493 | 8% |

## The unmatched tail — disposition

### A. Style-code suffixes (mechanical: strip after " - "/" -" and re-match)
`Burlington - <code>` (~40), `Ross - <code>` (~13), `Hobby Lobby - <code>` (~8),
`Rooms to Go - <code>` (5), `Dollar General - <code>` (2), `Danawares- <code>` (2),
`Burlington VSY14... and VSY21...` (1). All resolve to their base active customer.

### B. Obvious typos/variants (mechanical: seed as core.customer_alias → active hub)
| Free text | → Hub customer |
|---|---|
| Kohl's | KOHLS |
| Books-a-Million / Books-A-Million / BAM | Books A Million |
| Sams Club | Sam's Club |
| Hobby Lobbby (typo) | Hobby Lobby |
| Barnes and Noble | Barnes & Noble |
| Beall's Outlets | BEALL'S OUTLET STORES INC |
| 5 Below | Five Below |
| DD's / dd's / DD | DD's Discounts |
| Ollie's | Ollies |
| Christmas Tree Shops | CHRISTMAS TREE SHOPS INC |
| Spirit of Halloween / Spirit Halloween Christmas | Spirit Halloween |
| Spirit of Christmas | (confirm — Spirit Halloween? or Christmas Tree Shops?) |
| Gabriel Bros | Gabes |
| Shoppers Worlds | SW GROUP-SHOPPERS WORLD |
| IKONICK | IKONICK.COM |
| Rooms 2 Go | Rooms to Go |
| TJMaxx / TJX Giftables | TJX |
| BCF | Burlington (Burlington Coat Factory) — CONFIRM |
| Ltd Commodities | LTD COMMODITIES LLC (inactive) |
| Bed Bath and Beyond | BED BATH & BEYOND (inactive) |

### C. Comma multi-customer cells (single FK can't represent — leave unlinked)
`Burlington, Ross` · `TJX, HomeGoods` · `HomeGoods, TJX, Burlington` ·
`Box Lunch, Hot Topic` · `Home Goods, Ross` · `Ross, HomeGoods` ·
`Barnes and Noble, HomeGoods` · `Stock, HomeGoods` · `TJX, Burlington` ·
`Burlington, HomeGoods` · `HomeGoods, Burlington` (each 1–2 rows).

### D. RULING SET — Albert's decisions (2026-07-22)
| Free text | Rows | RULING |
|---|---:|---|
| **Stallion** (+ "Stallion Wholesale Art", "Stallion Art Wholesale") | 943 | **Internal / not a customer → leave unlinked** (keep free text). |
| **Multicustomer** | 785 | Sentinel → **leave unlinked**. |
| **Stock** | 233 | House stock → **leave unlinked**. |
| **Stock, HomeGoods** | 1 | User error — meant HomeGoods → **link to HomeGoods (= TJX in hub)**. |
| **Licensor Requests** | 129 | Internal category → **leave unlinked**. |
| **CVS** | 115 | **ADD to hub as `potential`**, link rows. |
| **Costco** | 95 | **ADD to hub as `potential`**, link rows. |
| **Meijer** | 38 | **ADD to hub as `potential`**, link rows. |
| **Four Seasons** | 67 | **→ 4SGM** (alias to active FOUR SEASONS GENERAL MERCH). |
| **Nissan** | 10 | Licensor/property, not a customer → **leave unlinked**. |
| **NONE** | 1 | Sentinel → **leave unlinked**. |

Proceeding on the doc's proposed defaults (reversible aliases) for the smaller items:
Goldenlink → Golden Link Inc. (active) · Desperate Signs → Desperate Enterprises
(active) · BCF → Burlington · Jon Scheerz → leave unlinked (hub JONATHAN SHEERZ is
inactive; 33 rows, revisit later) · comma multi-customer cells with two *different*
customers → leave unlinked.

### Hub display_name fixes (active + in picker but ugly ERP name)
`HOBBY LOBBY LLC` → "Hobby Lobby" · `HOT TOPIC MERCHANDISCING INC` → "Hot Topic" ·
`Golden Link Inc. DBA Only In Theatres` → "Goldenlink" · `KOHLS` → "Kohl's" ·
`AT HOME STORES LLC`/display "AT HOME STORES" → "At Home".
(Ross, Ollies, BoxLunch, Walmart, 4SGM, Desperate Enterprises already have display_name.)

Note: HomeGoods, Marshalls, TJ Maxx are already merged into one **TJX** hub customer
(aliases), so any HomeGoods/TJMaxx free text resolves to TJX and displays as "TJX".

## Downstream once reconciled
1. shared-db migration: add `customer_id` FK to `public.style_groups` +
   `public.assets`; backfill A+B (+ approved D); set hub `display_name` where the
   matched name is an ugly ERP string (ROSS STORES INC SUPPLIERS → "Ross", etc.);
   expose `customer_id` + canonical name in the DAM reads; add a curated
   customers-with-assets facet source.
2. popdam3: single `useDamCustomers()` hook → `api.dam_customer_list`; Styles
   editor writes `customer_id`; Library filter uses curated options + filters by
   `customer_id`.
