# Coldlion raw landing layer — grain-by-grain design (DRAFT for the orchestrator)

**Status:** draft design, no migration written. Requires an orchestrator issue before any
structural work starts.
**Author session:** 2026-08-18.
**Owner direction (Albert Hazan, 2026-08-18):** Coldlion data must arrive from the Coldlion
API into a schema built to receive it raw. DesignFlow PLM is **not** in this path. No
application will ever read these tables. How the data then reaches `core.*` or app tables is a
separate decision, made per feed, after the raw data exists.

Companions, both verified against live calls — read before implementing:
- [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) — auth, base URL, all 19
  endpoints, paging rules, the merch-group division matrix.
- [`coldlion-history-endpoints-shape.md`](coldlion-history-endpoints-shape.md) — the two
  history feeds: 7-day cap, row identity, dead fields.
- [`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md) — why
  `mgTypeCode` cannot be hardcoded.

> ## ⚠️ CORRECTION ADDED 2026-08-19 — `prod_history` needs a STAGE dimension this draft does not have
>
> Added by a different session (al8960ofc/claude, the one that probed the endpoints), **without
> otherwise touching this draft.** The finding post-dates it by a day.
>
> **`GET /prodHistory` without `stageCode` returns only the `ISS` (issued) lines.** `stageCode=REC`
> returns **receipt** lines that appear nowhere in the default response — zero key overlap, verified
> across four windows. Order 22717 ordered 4,800 on its `ISS` line and received 4,548 on its `REC`
> line; only the first is in the default response. Full evidence:
> [`verification/coldlion-prodhistory-stage-discovery-20260819/README.md`](verification/coldlion-prodhistory-stage-discovery-20260819/README.md).
>
> **Three changes this design needs:**
>
> 1. **A `stage_code` column on `coldlion.prod_history_line` and `..._component`.** The stage is
>    **not in the payload** — it is knowable only from the request that fetched the row, so the
>    loader must stamp it. Without it, ordered and received quantities are indistinguishable.
> 2. **`stage_code` in the natural key**, or at minimum a documented decision not to. Measured:
>    `(prod_order_no, prod_line_seq)` does **not** collide across stages (0 collisions in three
>    windows). That makes this failure *silent* — the table accepts both stages without error and
>    every `SUM(prod_order_qty)` double-counts. No key violation will warn you.
> 3. **The fetch plan must iterate stages**, not just date windows: `ISS`, `INTRAN` and `REC`. **The stage list is authoritative as of 2026-08-19 — ColdLion confirms there are
>    exactly three: `ISS`, `INTRAN`, `REC`.** All three carry real rows, so the fetch plan is
>    3 stages × N seven-day windows per endpoint, not N.
>
> Everything else in this draft is unaffected. Its `last*` split, its `prodLineSeq` grain, and its
> "sum to `prepackQty`" assertion all still hold.

---

## 1. What this layer is, and what it must never become

**Job:** hold a faithful, replayable copy of what the Coldlion API returned, so that a bad load
can be re-run, a dispute can be settled against the original bytes, and a change in Coldlion's
shape shows up as new data rather than as a broken loader.

**Explicitly out of scope for this layer:**
- No foreign keys into `core.*` or any curated table.
- No resolution/matching columns (`resolution_status`, `licensor_id`, `resolved_by`). Those
  belong to the staging layer that already exists (`plm.erp_*`) or to a future promotion step.
- No invented relationships. Coldlion has **no licensor to property link** and **no active
  flag**. Structure we invent here would launder guesswork into something that looks
  authoritative.
- No grants to application roles. Read access is for loaders, the DB admin tool, and audits.

**Why one table per grain, not a normalized model:** normalizing is interpreting, and if the
interpretation is wrong the evidence is already gone. Coldlion has changed shape on us three
times in a month (the vendors table swap, the 7-day cap, the new `prodLineSeq` field). A
source-faithful copy absorbs that. Normalization is the job of the promotion step into `core.*`,
which is designed separately, per feed, and is reviewable.

**Where splitting IS required:** several endpoints return more than one grain flattened into one
row (an order line and the prepack components inside it; an item header and its 14 merch-group
slots). Landing those flat buries the real row identity and makes duplicate detection
impossible. Splitting repeated blocks out of a flat row is mechanical, not interpretive — and
every split row still carries the **complete original payload** in `raw`, so nothing is lost.

---

## 2. Schema and conventions

New schema: **`coldlion`**. One table per grain, named after the endpoint, columns named after
Coldlion's own field names (snake_cased). No renaming to our vocabulary at this layer.

### 2.1 Columns every table carries

| Column | Purpose |
|---|---|
| `run_id` | FK to `coldlion.sync_run` — which pull produced this row |
| `fetched_at` | when the response was received |
| `raw` | the complete original JSON row, unmodified — the evidence |
| `source_hash` | hash of `raw`, for cheap change detection |
| `first_seen_at` / `last_seen_at` | on current-state tables only |

### 2.2 Two table behaviours

- **Current-state (masters):** customers, vendors, merch groups, items, item details, images,
  prepacks, seasons, salespersons. Upsert on the natural key; bump `last_seen_at`; write a row
  to `coldlion.change_log` when `source_hash` changes. Latest truth, with a change trail.
- **Append-only (transactions, history, snapshots):** both history feeds, pickticket, receiving,
  production tracking, inventory. Never updated. Identity key plus `source_hash` prevents
  double-loading the same row; a re-pull of the same window is a no-op, not a duplicate.

### 2.3 Two data rules that apply everywhere

- **`1900-01-01` is Coldlion's empty-date marker** (owner-confirmed 2026-08-14). Typed date
  columns store **NULL**; `raw` keeps the original value. Never store a real 1900 date.
- **Empty means two different things.** `orderHistory` uses `""`, `prodHistory` uses JSON
  `null`. Typed columns normalise both to NULL; `raw` keeps what arrived.

### 2.4 Run bookkeeping

`coldlion.sync_run` — one row per pull: endpoint, request parameters (including the `fromDate`
/ `toDate` window for the history feeds), status, row counts, error text, timings.

`coldlion.window_ledger` — for the two capped history endpoints only: one row per 7-day window
per endpoint, with its state (pending / loaded / failed). This is what makes a multi-year
backfill resumable and proves no window was skipped or double-counted. Windows advance by
exactly 7 days (`toDate = fromDate + 6`); overlap duplicates rows.

---

## 3. The tables, grain by grain

### 3.1 Masters — one grain each

| Endpoint | Table | Natural key |
|---|---|---|
| `/customers` | `coldlion.customer` | company_code, customer_code |
| `/vendors` | `coldlion.vendor` | company_code, vendor_code |
| `/merchGroupHeaders` | `coldlion.merch_group_header` | company_code, division_code, mg_type_code |
| `/merchGroupDetails` | `coldlion.merch_group_detail` | company_code, division_code, mg_type_code, mg_code |
| `/seasons` | `coldlion.season` | company_code, division_code, season_code |
| `/salespersons` | `coldlion.salesperson` | company_code, salesperson_code |

`merch_group_detail` holds licensors, properties, sizes, style guides, artists and every other
merch-group value in **one** table, because Coldlion serves them from one endpoint and the
meaning of `mg_type_code` is division-dependent. The four-part key is mandatory: `mgCode`
collides across types inside one division (`1P` is both a licensor and a property in CW001).
`/merchGroupDetails` returns a plain array, not the paged envelope.

### 3.2 Items — a header plus two child grains

| Table | Grain | Key |
|---|---|---|
| `coldlion.item_header` | one item | company_code, division_code, item_no |
| `coldlion.item_merch_group` | one merch-group slot on an item | + slot_no (01–14) |
| `coldlion.item_detail` | one SKU | company_code, division_code, item_no, color_code, size_code |

> **Owner ruling, Albert Hazan, 2026-08-19 — land ALL FOURTEEN slots.** A live
> probe on 2026-08-19 measured slots 11-14 as empty in every sampled item across
> all three divisions (and empty on both history feeds too). That measurement is
> correct and is NOT a reason to drop them. The row-per-slot design means an
> unused slot costs nothing — it simply produces no row — while a slot omitted
> from the loader would silently discard real data the day ColdLion starts
> populating it. Load 01 through 14. Do not "optimise" this back down to 10.

The 14 merch-group slots become 14 rows, not 14 columns, so slot meaning can be resolved
per division against `merch_group_header` without hardcoding. `item_header` carries `has_image`
(Y/N) — the cheap way to know image coverage without touching `/itemImages`.

### 3.3 Images — metadata split from bytes

| Table | Grain | Key |
|---|---|---|
| `coldlion.item_image` | one image | item_no, color_code |
| `coldlion.item_image_content` | the bytes | same key, 1:1 |

Splitting keeps the metadata table small and scannable; base64 content is large and rarely
queried. Only call `/itemImages` for items where `has_image = 'Y'`.

### 3.4 Prepacks

`coldlion.prepack_component` — grain: one component style inside one prepack.
Key: company_code, prepack_code, component_item_no, color_code, size_code.

### 3.5 Inventory — a snapshot, not a master

`coldlion.inventory_snapshot` — grain: one SKU in one warehouse **at one point in time**.
Key: run_id, item_no, warehouse_sku. Append-only. On-hand quantity has no meaning without the
time it was true, so `run_id` is part of the key by design.

### 3.6 Transactions

| Endpoint | Table | Key |
|---|---|---|
| `/pickticket` | `coldlion.pickticket_line` | transaction_no, line_no |
| `/receiving` | `coldlion.receiving_line` | transaction_no, line_no |
| `/proddetails` | `coldlion.prod_order_detail` | company_code, prod_order_no, line_no |
| `/prodtracking` | `coldlion.prod_tracking_event` | prod_order_no, stage_code, event timestamp |

Line numbering on pickticket/receiving must be confirmed against a live pull before the
migration is written; if the feed carries no line identity, the key falls back to the full
`source_hash` and that fact gets documented in the table comment, not hidden.

### 3.7 The two history feeds — two grains each, and the one trap

`/prodHistory` (purchases we placed with factories, 133 fields) and `/orderHistory` (sales
customers placed with us, 59 fields) each return **one row per order line × prepack component**.
That is two grains flattened together, so each becomes two tables:

| Table | Grain | Key |
|---|---|---|
| `coldlion.prod_history_line` | one real buy line | prod_order_no, prod_line_seq |
| `coldlion.prod_history_component` | one component style in that line | + prepack_item_no |
| `coldlion.order_history_line` | one sales order line | sales_order_no, line_no |
| `coldlion.order_history_component` | one component style in that line | + sub_item_no |

Non-prepack lines have an empty component key and land as a line row with a single component
row keyed on `item_no`.

**Three rules that must be in the table comments, not just here:**

1. **Distinct `prod_line_seq` = distinct real purchases. Never merge them.** Coldlion added this
   field on 2026-08-17 precisely to close this ambiguity. Merging two lines erased a
   3,000-pack purchase in the pre-fix data.
2. **The seven `last*` fields are a "most recent production" lookup, not part of this
   purchase.** They are the only remaining source of duplicate rows. Land them in a separate
   `coldlion.prod_history_last_lookup` table keyed the same way, so they can never reach a cost
   report by accident. `lastProdCost` is **not** this order's cost.
3. **Component quantities must sum to `prepackQty`.** Verified 413 of 413 in the sample. Load
   this as a check constraint or a post-load assertion: a pack that does not sum means our
   extraction is wrong, not their data.

**Loader contract for these two, from the verified doc:** 7-day windows only (wider is refused);
no paging (`page`/`size` are silently ignored — a paging loop re-fetches forever); one request at
a time with a 2–3 second pause; 60s or longer timeout; refusals arrive as **HTTP 400 on the wire
with `"status": 500` in the body**, so branch on the wire status or a loader will retry a
permanent input error forever.

### 3.8 Fields that are always empty — no columns

31 of 132 `prodHistory` fields and 4 of 59 `orderHistory` fields were empty across a
seven-year sample, and `subUpc` was empty in all 1,985 component rows. Two quantity fields
(`lineInvoiceQty`, `lineOpenQty`) and `depositPerc` are always zero despite their names. Do not
create typed columns for any of them; they remain visible in `raw` if Coldlion ever populates
them. The full list is in §5.1 and §5.2 of the history-shape doc.

---

## 4. What exists today, and what happens to it

| Today | Disposition |
|---|---|
| `ingest.coldlion_product_size_landing` / `_run` | The only correctly built landing table. Superseded by `coldlion.merch_group_detail` (sizes are merch-group type values). Migrate rows, then retire. |
| Customers and vendors in `ingest.raw_record` | Generic bucket: single-text key, latest version only. Re-land into `coldlion.customer` / `coldlion.vendor`. |
| `plm.erp_customer`, `erp_vendor`, `erp_licensor`, `erp_property`, `merch_group_header` | **Keep.** These are the staging-and-matching layer, not landing — they carry curation on the row. They become consumers of `coldlion.*` instead of consumers of `ingest.raw_record`. |
| `public.erp_items_*` (DesignFlow-sourced item mirror) | Out of scope here and on the owner's exclusion list. Its future is a separate decision once `coldlion.item_header` exists. |
| `ingest.sync_run` | Stays for other sources. Coldlion pulls use `coldlion.sync_run`, which carries endpoint-specific request parameters. |

---

## 5. Suggested build order

1. **Schema, `sync_run`, `window_ledger`, `change_log`** — the spine. Nothing lands without it.
2. **The two history feeds.** Biggest gap, entirely absent today, and the feed with the most
   business value locked up. About 740 requests, roughly a weekend of wall clock.
3. **Items** (`item_header`, `item_merch_group`, `item_detail`) — unlocks division code,
   pricing, barcodes and dimensions that the DesignFlow path drops today.
4. **Merch groups** — one table replacing the size landing table, feeding the existing
   `plm.erp_*` staging.
5. **Customers and vendors** — re-land out of the generic bucket. Lowest urgency: the data is
   already flowing and already curated downstream.
6. **The remainder** — images, inventory, prepacks, seasons, salespersons, pickticket,
   receiving, production detail and tracking, as consumers ask for them.

Each step is a separate orchestrator issue and a separate migration, preview first.

---

## 6. Open questions for the owner

1. **History depth.** Backfill everything Coldlion holds (2019 onward, about 740 requests), or
   start from a chosen date and only go back if a consumer asks?
2. **Image bytes.** Store the base64 content in the database, or store only metadata plus
   `has_image` and fetch bytes on demand? Full storage is simplest but heaviest.
3. **Retention.** Do append-only history tables keep every version forever, or roll off after an
   agreed period? Forever is the safe default and the volume is low hundreds of MB.
