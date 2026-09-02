# Implementation plan — ColdLion raw landing layer, phases 2 to 6

> ### 🧭 ColdLion front door
> New to ColdLion, or about to conclude something is broken/unknown? Start at
> [`coldlion.md`](coldlion.md), and **check
> [`coldlion-open-questions.md`](coldlion-open-questions.md) before asking ColdLion anything** —
> twelve questions are already answered there.

**Written:** 2026-08-19 · **Repo:** `u2giants/shared-db` · **Branch:** your own, PR to `main`
**Governing issue:** [#1184](https://github.com/u2giants/shared-db/issues/1184) · **Companions:** [#1204](https://github.com/u2giants/shared-db/issues/1204) (phases 2-6 authorized), [#1202](https://github.com/u2giants/shared-db/issues/1202) (rulings that supersede the design doc), [#1031](https://github.com/u2giants/shared-db/issues/1031) (backfill runner — reconcile, do not duplicate)
**Handoff:** [`../HANDOFF.d/2026-08-19T1500Z-al8960ofc-claude-coldlion-phases-2-6-plan.md`](../HANDOFF.d/2026-08-19T1500Z-al8960ofc-claude-coldlion-phases-2-6-plan.md)

## STATUS

| # | Step | State | Evidence |
|---|---|---|---|
| 0 | Field decisions captured from the owner | ✅ done 2026-08-19 | [`coldlion-field-decisions-20260819.csv`](coldlion-field-decisions-20260819.csv) |
| 1 | Supersede the design doc for the 2026-08-19 rulings | ⬜ open | |
| 4a | Resolve the `orderHistory` line key | ✅ **REDONE 2026-09-01** | The 2026-08-20 key was superseded — it collides on 181 of 1,243 groups. Current key: `(salesOrderNo, salesOrderLineNo, itemNo, subItemNo)`, zero duplicates on 1,823 rows. See the superseded box in step 4 |
| 2 | `coldlion.merch_group_header` + `merch_group_detail` | ⬜ open | |
| 3 | `coldlion.item_header` + `item_merch_group` + `item_detail` | ⬜ open | |
| 4 | `coldlion.order_history_line` + `order_history_component` | ⬜ open | |
| 5 | `coldlion.prod_history_line` + `_component` + `_last_lookup` | ⬜ open | |
| 6 | `coldlion.customer` + `coldlion.vendor`, retire the generic bucket | ⬜ open | |
| 7 | Loaders (ongoing sync) for every table above | ⬜ open | |

**A fresh session starts at step 1.** Steps 2-6 are independent of each other once step 1 is done.

**Owner's priority, 2026-08-19: build these tables next** (steps 1-6). The two other candidate jobs
were weighed and deliberately not chosen first — see §13 open question 9 for the one that is still
actively losing data, which the owner has seen and has not scheduled.

---

# Part 1 — Why

## 1. The ultimate goal, in plain business English

POP Creations runs its business in an ERP called ColdLion. ColdLion knows what we sell, what we
bought, what it cost, who we bought it from and who we sold it to. Our own applications — design
tools mostly, sales tools a little — cannot see most of that today.

**When this work is done, a faithful copy of the ColdLion data we care about lives in our own
database, refreshed automatically, so our applications can use it without anyone re-typing
anything and without hammering ColdLion's API.**

Three specific things that are broken today and will be fixed:

- The item feed has been silently failing since 2026-05-21 (five consecutive `403`s, last attempt
  2026-07-26). Three months of item changes are missing and nothing alerted anyone.
- The item copy we do have comes from DesignFlow, not ColdLion, and it drops the division code. So
  we cannot answer "which division is this product in" — the question that started this work.
- Sales history and purchase history have never been captured at all.

> **If any step below conflicts with this goal, the goal wins. Stop and flag it.** A step that is
> technically correct but leaves us unable to answer a basic business question about our own
> products has failed, regardless of whether it matched the letter of this plan.

## 2. What this application is

`u2giants/shared-db` is the governed home of the **structure** of the shared Supabase database
(project ref `qsllyeztdwjgirsysgai`, region us-east-1). Many POP applications read from that
database: PopDAM, PopCRM, PopPIM, and DesignFlow-adjacent tooling.

- **Structure changes are authored here, never in an app repo.** Branch + PR + preview rehearsal +
  guarded merge. Read `AGENTS.md` (the repo router) before your first commit.
- **This repo does not hold row data for applications.** The rows an app creates belong to that
  app's session. This plan is structural, so it belongs here.
- Migrations live in `supabase/migrations/`, applied through the repo's own workflow. **The
  Supabase MCP is read-only** — you cannot apply a migration through it.

**ColdLion** is the ERP, at `http://x5.coldlion.com/EhpApi`. It is a third party. We do not control
it, it has changed shape three times in the last month, and it rate-limits us.

## 3. What triggered this work

On 2026-08-19 the owner (Albert Hazan) asked which product categories each division sells. The
answer required knowing an item's division. Investigation found the division is present in
ColdLion's item record and is a request parameter on `/items`, but our stored copy has the column
empty on all 17,703 rows, because the loader was pointed at DesignFlow rather than ColdLion.

That opened the wider question — is our ingest layer shaped to receive ColdLion's data at all? —
and the answer was no. This plan is the fix.

**Reproduce the original symptom:**

```sql
select count(*) total, count(division_code) with_division from public.erp_items_current;
-- observed 2026-08-19: 17703 total, 0 with_division
```

## 4. Scope

**In scope:** phases 2 to 6 of issue #1184 — ColdLion landing tables for merch groups, items, item
details, sales history, purchase history, customers and vendors, plus the ongoing sync loaders.

**NOT in this plan — do not start these:**

- **The 7-year backfill run itself.** Deliberately separate (#1204 §2; reconcile with #1031). This
  plan builds the tables and the ongoing sync.
- **Images.** Owner ruling 2026-08-18: no image bytes, ever. Thumbnails are matched from PopDAM by
  item number. `coldlion.item_image` metadata is deferred to phase 6 and must re-justify itself.
- **Fixing `public.erp_items_*`** (the DesignFlow-sourced mirror). Separate decision once
  `coldlion.item_header` exists. Leave it alone.
- **Writing back to ColdLion.** Fields are flagged so the schema carries the flag; no write path is
  built here. See §8 decision D6.
- **Promotion into `core.*`.** Decided per feed, later. This layer has no foreign keys into `core.*`.
- **Repairing the 181 orphaned `brandAssuranceNo` values** found on orders whose item record is
  blank. Real work, separate job.
- **Inventory, prepacks, seasons, salespersons, pickticket, receiving, prod detail/tracking.**
  Phase 6 "as consumers ask", and nobody has asked.

---

# Part 2 — What we already know

## 5. Current state of the code

**Phase 1 is merged and in production.** Commit `203a034`, migration
`supabase/migrations/20260818232639_coldlion_raw_landing_spine.sql`. It created the `coldlion`
schema and three bookkeeping tables. Verified live on production 2026-08-19: all three exist and
hold **zero rows** — correct, since no feed table exists yet.

| Table | Columns |
|---|---|
| `coldlion.sync_run` | `id, endpoint, company_code, division_code, request_params, window_from, window_to, status, requested_by, started_at, finished_at, duration_ms, http_status, body_status, rows_fetched, rows_inserted, rows_updated, rows_unchanged, error_message, notes, created_at` |
| `coldlion.window_ledger` | `id, endpoint, company_code, window_from, window_to, state, attempt_count, last_run_id, row_count, first_attempted_at, loaded_at, last_error, created_at, updated_at` |
| `coldlion.change_log` | `id, table_name, natural_key, change_kind, previous_source_hash, new_source_hash, previous_raw, new_raw, run_id, changed_at` |

`sync_run` keeps `http_status` and `body_status` **separately**, and `change_log.natural_key` is
`jsonb` so multi-part keys survive whole. Both are deliberate — reuse them, do not add parallel
columns.

**Nothing else exists.** No feed tables, no loader, no scheduled job.

**What exists elsewhere and must not be disturbed:**

| Thing | State |
|---|---|
| `public.erp_items_current` / `_raw` / `erp_sync_runs` | DesignFlow-sourced item mirror. 17,703 / 300,213 / 25 rows. Sync broken since 2026-05-21. Out of scope, leave running. |
| `ingest.raw_record` | Generic bucket. 122,039 rows; ColdLion customers (836) and vendors (97) among them. Step 6 re-lands these. |
| `ingest.coldlion_product_size_landing` / `_run` | Correctly built, zero rows. Superseded by `coldlion.merch_group_detail`. Migrate then retire. |
| `plm.erp_customer`, `erp_vendor`, `erp_licensor`, `erp_property`, `merch_group_header` | **Keep.** Staging-and-matching layer carrying curation. They become consumers of `coldlion.*`. |
| `public.prod_order_headers_*` | Exist, zero rows, never used. Wrong grain for ColdLion. Do not extend; step 5 builds fresh. |

## 6. Key findings and root cause

Every number below was measured on 2026-08-19 against the live ColdLion API or production Postgres.
Re-derive any of them with the method in §12.

1. **Division is in the ColdLion item feed.** `GET /items` takes `divisionCode` as a parameter and
   the returned record carries `divisionCode`. Live counts: `CW001` 12,914 items, `EH001` 3,860,
   `SP001` 2,101 — **18,875 total**, against 17,703 in our mirror.
2. **Root cause of the empty division column:** `public.erp_items_current.source_system` defaults to
   `'designflow'` (`supabase/ci-bootstrap/010_pre_adoption_baseline.sql:1885`). The feed is a
   29-field DesignFlow projection; ColdLion's own item record has 132 fields including division.
3. **The item key is wrong and it has already bitten us.** `erp_items_current` has
   `UNIQUE (external_id)` — item number alone. ColdLion identity is **division + item number**.
   Proof it matters: `CW001` genuinely contains items numbered `01`, `02`, `03`, `04`, `05`
   (verified live). A March 2026 sync run failed with *"ON CONFLICT DO UPDATE command cannot affect
   row a second time"*, the exact signature of two same-numbered rows in one batch.
4. **Merch groups on the history feeds are duplicated item attributes — ON NON-PREPACK ROWS ONLY.**
   519 order lines joined against the full item master: `merchGroup01`-`06` **identical on 519 of
   519, zero differences.** Hence owner ruling D2. **Corrected 2026-09-01: that sample was
   non-prepack.** Inside a single prepack line the same codes vary across component rows
   (`merchGroup05` in 135 of 176 groups, `merchGroup06` in 162 of 176), so there they describe the
   component, not the parent. Owner ruling **D14** keeps them on prepack component rows.
5. **`brandAssuranceNo` on an order is NOT duplication.** Same join: identical where both present
   (287), **never conflicting (0)**, and present on the order while blank on the item on **181**
   lines. The order is the only source for those. Keep it.
6. **26% of order lines have no matching item master row** (184 of 703). Discontinued items purged
   from the master while their history survives. **The history tables therefore cannot carry a
   foreign key to `item_header`.**
7. **Sparse is not dead.** `subUpc` measured 0 of 1,985 populated, and ColdLion explained it is
   genuine business practice (component barcodes on one Walmart assortment). Never infer "drop this
   field" from a zero count alone.

## 7. Approaches considered and REJECTED

- **Extend `public.erp_items_*` instead of building `coldlion.*`.** Rejected: owner direction
  2026-08-18 is that ColdLion data arrives into a schema built to receive it raw, with DesignFlow
  out of the path. Widening the mirror keeps the two-hop path and its lossy projection.
- **Fourteen merch-group columns on the item table.** Rejected in the design doc: slot meaning is
  division-dependent, so columns hardcode an interpretation. Row-per-slot instead.
- **Dropping merch-group slots 11-14 because they measure 0% populated.** Explicitly rejected by
  owner ruling D1. Row-per-slot means an unused slot costs nothing, while an omitted slot silently
  discards data the day ColdLion starts using it.
- **Keeping the complete raw JSON record on every row.** This was the design-doc default and the
  planner recommended it. **Rejected by the owner 2026-08-19** — see D5. Do not reinstate it because
  the design doc still says so; the doc is superseded in step 1.
- **A single loader with different date ranges for backfill and ongoing sync.** Rejected by #1202:
  they are different jobs. The history endpoints return current state per window, not a change feed,
  so deriving "versions" from successive pulls fabricates history.
- ~~**Paging the two history endpoints.**~~ **NO LONGER TRUE — corrected 2026-09-01.** ColdLion
  added the standard paged envelope to both history endpoints on 2026-08-31. They now honour
  `page`/`size` and MUST be paged: the page size caps silently at **200 rows**, so a single
  request returns 200 rows and no error however large `size` is. Loop until `last` is true, and
  still chunk by date window on top of that.
- **Trusting the response body's status code.** A too-wide window arrives as **HTTP 400 on the wire**
  with `"status": 500` in the body. A loader reading the body treats a permanent input error as
  transient and retries forever.
- **Per-item API lookups to compare fields.** Tried during investigation; many lookups returned no
  rows and it burned calls. Pull the full item master per division once and join locally instead.

## 8. Design decisions already made

**LOCKED — do not relitigate.**

| # | Decision | Authority |
|---|---|---|
| D1 | Land **all 14** merch-group slots on items, even though 11-14 measure 0% | Albert, 2026-08-19 |
| D2 | **Drop LINE-LEVEL merch-group codes and their `Desc` twins from both history feeds** — item attributes, not order attributes. **Scope is `merchGroupNN` / `merchGroupNNDesc` ONLY.** ~~`subMerchGroup*` and `ppkMerchGroup*` are a DIFFERENT GRAIN and are KEPT~~ — those two field families **do not exist**; see the corrected box below. **NARROWED BY D14 (2026-09-01): D2 now applies to NON-PREPACK rows only.** On prepack component rows of `orderHistory` the codes describe the component and are KEPT | Albert, 2026-08-19, on the 519/519 evidence; narrowed by Albert, 2026-09-01 |
| D3 | **Division identity is the letter code** (`CW001`, `SP001`, `EH001`), never a number. No numeric division id in any new table | Albert, 2026-08-19; recorded in `business-rules/merchandise-and-product-taxonomy.md` |
| D4 | **Only fields marked `ingest`** in the decisions CSV get a typed column | Albert, 2026-08-19 |
| D5 | **No raw JSON archive column.** Accepted consequence: an `ignore` decision on the two history feeds is effectively permanent, and reversing one means re-pulling 7 years | Albert, 2026-08-19 |
| D6 | Write-back to ColdLion is **flagged in the schema, not built** in this plan | Albert, 2026-08-19 |
| D7 | No image bytes, ever | Albert, 2026-08-18 (#1202) |
| D8 | Versioning is **forward-only**; retention keeps the 3 most recent versions | Albert, 2026-08-18 (#1202) |
| D9 | History depth 2019-01-01 to today, one 7-day grid anchored at that date | Albert, 2026-08-18 (#1202) |
| D10 | **`change_log` keeps the full payload, but only for rows that actually changed.** This is the agreed reconciliation of D5 with the already-shipped phase 1 spine: no per-row archive on feed tables, but a change *is* worth its evidence. Most master rows never change, so the volume stays small | Albert, 2026-08-19 |
| D11 | **Exclude retired division `EP001`.** Filter it at the loader on every feed | Albert, 2026-08-19 |
| D12 | **Colour and size stay out of `item_detail`** — reaffirmed after the consequence was spelled out. *"We don't make clothing."* Key on `item_pkey` | Albert, 2026-08-19 |
| D13 | **`orderHistory.lineCancelledQty` is `ingest`**, reversing the CSV's original `ignore`. The 0.8% fill it was dropped on came from too small a window; wider samples give 11.5% and 24% | Albert, 2026-08-19 |
| D14 | **Keep `merchGroup01`-`06` (and their `Desc` twins) on PREPACK COMPONENT rows of `orderHistory`.** Measured 2026-09-01: inside a single prepack line, `merchGroup05` (licensor) varies across component rows in 135 of 176 groups and `merchGroup06` (property) in 162 of 176 — so on those rows the codes describe the COMPONENT, not the parent item. D2's 519/519 evidence was measured on non-prepack rows and does not generalise. D2 continues to apply unchanged to non-prepack rows | Albert, 2026-09-01 |
| D15 | **All eight fields new since the decisions CSV get typed columns** — `orderQty`, `invoiceQty`, `pickTicketNoString`, `prepackQty`, `quantity`, `labelDesc`, `warehouseDesc`, and the `merchGroup01Desc`-`14Desc` family. This is an explicit `ingest` marking under D4; the CSV predates these fields and its silence is absence, not a decision. `orderQty` and `invoiceQty` are now the ONLY correct per-SKU quantities | Albert, 2026-09-01 |
| D16 | **Licensor (`merchGroup05`) and property (`merchGroup06`) are attributes of the COMPONENT style, never of the Master assortment (prepack).** One Master routinely holds four designs with four different licensors and properties, so any single value at Master level is meaningless. Never read either from the parent and never fall back to the parent when the component value is blank; explode assortments to components before grouping any report, royalty calculation or licence-expiry check by licensor or property; a Master's licensor set is DERIVED and is a set, not a value. Documented as [`business-rules-erp-data.md`](business-rules-erp-data.md) §9 | Albert, 2026-09-01 |
| D17 | **D14 applies to `prodHistory` prepack rows too.** Both feeds now carry ONE `merchGroup*` family and on an exploded prepack row it holds the COMPONENT's values, so step 5 keeps `merchGroup01`-`06` on prepack component rows on the same terms as step 4. Recorded because D14 named `orderHistory` only and an implementer could otherwise drop the columns on production prepacks | Derived from D14 and D16, 2026-09-01 |

**OPEN — your judgment; record the reasoning in the migration comment.**

- Exact Postgres types per field. The decisions CSV carries real sample values; pick the narrowest
  type that cannot truncate. When genuinely unsure, `text` — a wrong numeric type loses data, a
  `text` column merely disappoints.
- Index choice beyond the natural key.
- Whether `item_detail` and `item_header` share a loader module.

> ### ⚠️ CORRECTED 2026-09-01 — the fields this box used to name do not exist
>
> An earlier version of this box kept `subMerchGroup*` (sales side) and `ppkMerchGroup*`
> (production side) out of D2's drop, and raised the field counts to 31 and 83 on that basis.
> **Neither field family exists.** Live spec, 2026-09-01: `OrderHistory` has 63 properties and
> `ProdHistory` has 105; a name search for `subMerchGroup` or `ppkMerchGroup` returns nothing in
> either. `ProdHistory` does carry a `prepack*` family (`prepackItemNo`, `prepackColorCode`,
> `prepackQty`, `ppkDetailCost` and siblings), which is probably what was meant — but those are
> identity and cost fields, not merchandise groups.
>
> **Consequence: the 31 and 83 field counts are void. Re-derive both from the live spec before
> writing the step-4 or step-5 tables.** Do not carry the old numbers forward.
>
> The concern behind the original box was real, and D14 now answers it correctly: the component
> taxonomy lives in the ordinary `merchGroup01`-`06` fields ON the exploded component row, and D14
> keeps those on prepack rows. See [`business-rules-erp-data.md` §10](business-rules-erp-data.md).

**D6 has a live conflict you must not silently resolve.** Albert marked write-back on
`orderHistory.brandAssuranceNo`, `prodHistory.depositPerc`, and `vendors.femaExpDate` /
`nbcExpDate`. **ColdLion has only four writable endpoints** — verified against its live spec
(`GET /EhpApi/v2/api-docs`) on 2026-08-19: `PUT /items`, `PUT /itemDetails`, `PUT /itemImages`,
`POST /order`. There is no write path for vendors or either history feed. Record the flag as
*wanted but not currently possible*; do not invent one, and do not drop the flag.

---

# Part 3 — How to build it

## 9. The plan

Every step: one migration, preview rehearsal, PR, guarded merge. **Steps 2-6 are independent** once
step 1 lands — any order, or parallel sessions.

**Context cut points:** after step 1, and after each of steps 3, 4 and 5. Re-read the remaining
steps at the start of each session (drift check) before writing code.

---

### Step 1 — Supersede the design doc for the 2026-08-19 rulings

**File:** `docs/coldlion-raw-landing-schema-design.md`

This doc is the spec phases 2-6 are built from, and it is now wrong in three places. **Supersede,
never rewrite** — the original text is the audit trail. Add a dated pointer at each stale claim.

1. §2.1 lists `raw` and `source_hash` as columns every table carries. **`raw` is removed** by D5.
   `source_hash` **stays** — it is the change-detection mechanism and D8 depends on it. Compute it
   over the fetched record **before** projection, so it still detects changes in ignored fields.
2. §1 argues for keeping the original bytes as evidence. Mark superseded by D5 and state the
   accepted consequence in the owner's own terms.
3. §3.7 lists merch-group fields on the history tables. Superseded by D2.
4. §3.3 `item_image_content` — already flagged by #1202; fold it in while you are here.

Also apply D1 and D3 if branch `plan-coldlion-landing-phases-2-6` has not merged by the time you
start.

**Done when:** the doc contains no un-superseded statement contradicting D1-D9, and a reader who
finds the old text also finds the pointer to the new ruling. No migration in this step.

---

### Step 2 — Merch groups (2 tables)

**New migration.** `coldlion.merch_group_header`, `coldlion.merch_group_detail`.

| Table | Natural key | Fields |
|---|---|---|
| `merch_group_header` | `company_code, division_code, mg_type_code` | the 6 marked `ingest` |
| `merch_group_detail` | `company_code, division_code, mg_type_code, mg_code` | the 11 marked `ingest` |

- **The four-part key is mandatory.** `mgCode` collides across types inside one division — `1P` is
  both a licensor and a property in `CW001`. Never key on `mg_code` alone.
- `mg_type_code` meaning is division-dependent. Never hardcode `05 = Licensor`.
- `/merchGroupDetails` returns a **plain array**, not a paged envelope.
- Current-state behaviour: upsert on the natural key, bump `last_seen_at`, write `change_log` on
  `source_hash` change.
- Migrate rows out of `ingest.coldlion_product_size_landing` (sizes are a merch-group type), then
  retire that table **in a later migration**, not this one.

**You'll know it worked when:** `select count(*) from coldlion.merch_group_detail where
division_code='CW001' and mg_type_code='01' and active='Y'` returns **20** — the twenty live MG01
product types, matching `core."merchGroup"` today.

---

### Step 3 — Items (3 tables)

**New migration.** `coldlion.item_header`, `coldlion.item_merch_group`, `coldlion.item_detail`.

| Table | Grain | Natural key |
|---|---|---|
| `item_header` | one item | `company_code, division_code, item_no` |
| `item_merch_group` | one merch-group slot on an item | `+ slot_no` (01-14) |
| `item_detail` | one SKU | `company_code, division_code, item_no, item_pkey` — ⚠️ see below |

> ### ⚠️ `item_detail` key corrected 2026-08-19 after external review
>
> Earlier drafts keyed a SKU on `color_code, size_code`. **The owner marked both `ignore`**, so
> under D4 they get no column and the key was impossible to build. `itemPkey` is marked `ingest`
> at 100% fill and is what the API itself uses to locate a detail row
> (`coldlion-erp-api-reference.md:153`). Key on `item_pkey`.
>
> **State this consequence in the migration comment rather than hiding it:** with colour and size
> ignored and no raw archive (D5), the landing layer cannot answer "what colour and size is this
> SKU". That is an accepted loss flowing from D4 plus D5, not an oversight. If it later proves
> wrong, recovery is a re-pull of `/itemDetails`, which is cheap — it is a master feed, not history.
>
> **Reaffirmed by the owner on 2026-08-19 after that consequence was put to him explicitly:** colour
> and size stay out (D12). POP does not make clothing, so a SKU's colour/size axis carries little
> business meaning here. Do not reopen this.

- **The three-part item key is the whole point of this step** (finding 3). `CW001` contains items
  literally numbered `01`. A two-part key silently overwrites.
- Fields: the **78** marked `ingest` for `items`, the **59** for `itemDetails`. Merch-group slots
  move to `item_merch_group` as rows and must **not** also be columns on `item_header`.
- **All 14 slots** (D1). A slot with no value produces no row — correct, not a bug.
- `has_image` lives on `item_header`. It is the cheap image-coverage map. No image bytes (D7).
- Mark the 27 write-back-wanted fields (D6). Flag only, no write path.
- `1900-01-01` is the **owner-confirmed** empty-date marker — store NULL, never a real 1900 date.
  `1899-12-31` also appeared in the 2026-08-19 samples and is almost certainly the same marker shifted
  by a timezone conversion, but it is **not** owner-confirmed. Treat it as empty, and say so in the
  migration comment rather than presenting it as settled.
- ColdLion sends `""` on some feeds and JSON `null` on others. Normalise both to NULL.

**You'll know it worked when:** after a first sync,
`select division_code, count(*) from coldlion.item_header group by 1` returns approximately
`CW001` 12,914 · `EH001` 3,860 · `SP001` 2,101. Exact numbers will have drifted; the shape is what
matters. **A total near 17,703 with one division dominant means the division key is broken** — that
is the old bug reappearing.

---

### Step 4 — Sales history (2 tables)

**New migration.** `coldlion.order_history_line`, `coldlion.order_history_component`.

| Table | Grain | Key |
|---|---|---|
| `order_history_line` | one sales order line | `(salesOrderNo, salesOrderLineNo)` — resolved 2026-09-01. **The API never returns a line row**; it must be synthesised by de-duplicating fields that are constant within the group, and the load must assert that constancy |
| `order_history_component` | one component style in that line | `(salesOrderNo, salesOrderLineNo, itemNo, subItemNo)` — zero duplicates on 1,823 rows |

> ### ❌ SUPERSEDED 2026-09-01 — the 2026-08-20 line key is WRONG. Use the key below.
>
> **Correct key:** `(salesOrderNo, salesOrderLineNo, itemNo, subItemNo)` — zero duplicates across
> 1,823 rows / 409 orders, 2019-2026, measured 2026-09-01. Adding `subColorCode` and `subLabelCode`
> does not change that, so they are not needed in the key.
>
> **What the old box said and why it failed.** It gave the key as `(salesOrderNo, itemNo,
> labelCode)`, verified on 1,671 rows with the claim that *no field other than `linePrice` varies
> inside any group*, and instructed the next session not to re-derive it. On 1,823 rows that key
> **collides on 181 of 1,243 groups**, and the claim is false by a wide margin: inside those groups
> `itemDesc` varies in 176, `subItemNo` in 176, `merchGroup06` in 162, `brandAssuranceNo` in 158,
> `merchGroup05` in 135 — and `linePrice` in only 7.
>
> The 2026-08-20 verification was not wrong when it was made. It was made **before ColdLion exposed
> `salesOrderLineNo`, `subItemNo`, `orderQty` and `invoiceQty` on 2026-08-31**, against a payload
> that could not distinguish a parent line from its components. The measurement expired; the ✅
> marker did not, and that is what made it dangerous.
>
> **Rule for every ✅ box in this plan:** record the payload version or field list it was measured
> against, so a later session can tell whether the ground has moved.
>
> Still true from the old box: `lineNo` does not exist; and `linePrice` is per COMPONENT, not per
> line (ColdLion's JamieLynn, 2026-08-20) — for a prepack the system divides the line quantity into
> component quantities and prices each component. See
> [`business-rules-erp-data.md` §10](business-rules-erp-data.md).
>
> ~~ColdLion does have a `Line #` on Sales Order internally, but it is not exposed in the API.~~
> **It is exposed now** — `salesOrderLineNo` arrived on 2026-08-31 and is part of the key above.
> Register question 2.10 is answered.

- **Append-only.** Never updated. Identity key plus `source_hash` makes a re-pull a no-op.
- **Versioning:** the unique constraint must be `(identity, source_hash)`, not `(identity)` alone.
  A re-pulled window returning changed data must land as a new version (D8 keeps the 3 most recent),
  and a plain identity-unique constraint would reject it. The D8 prune is a separate provable job
  that must never delete the newest version.
- `lineCancelledQty` is **in** (D13). It was originally marked ignore on a 0.8% fill figure measured
  on too small a window; wider samples give 11.5% and 24%. Under D5 that drop would have been
  permanent. Treat this as the worked example of why a low fill percentage is not, by itself, a
  reason to discard a field.
- **Field count: RE-DERIVE FROM THE LIVE SPEC.** The old "31 fields" figure is void — it was built
  on `subMerchGroup*`, a family that does not exist (see the corrected box in §8). `OrderHistory`
  carries **63** properties as of 2026-09-01. Keep `brandAssuranceNo` (finding 5), keep
  `merchGroup01`-`06` on prepack component rows (D14), and give the eight fields listed in D15
  typed columns.
- Non-prepack lines: one line row plus a single component row keyed on `item_no`.
- **No foreign key to `item_header`** (finding 6) — 26% of lines have no item master row. Put that
  in a table comment, or a future session will "fix" it into a broken constraint.
- Component quantities must sum to `prepackQty` — 413 of 413 verified. Enforce as a check or a
  post-load assertion. A mismatch means **our extraction is wrong**, not their data.

**You'll know it worked when:** a single 7-day window loads, `sync_run.rows_fetched` matches the
array length, and the sum assertion passes with zero violations.

---

### Step 5 — Purchase history (3 tables)

**New migration.** `coldlion.prod_history_line`, `_component`, `_last_lookup`.

| Table | Grain | Key |
|---|---|---|
| `prod_history_line` | one real buy line | `prod_order_no, prod_line_seq` |
| `prod_history_component` | one component in that line | `+ prepack_item_no` |
| `prod_history_last_lookup` | the seven `last*` fields | same key as the line |

**Three rules that belong in the table comments, not just here:**

1. **Distinct `prod_line_seq` = distinct real purchases. Never merge them.** ColdLion added this
   field on 2026-08-17 to close the ambiguity. Merging two lines erased a 3,000-pack purchase in the
   pre-fix data.
2. **The seven `last*` fields are a "most recent production" lookup, not part of this purchase.**
   That is why they get their own table. **`lastProdCost` is NOT this order's cost** — `extCost` is.
3. `salesOrderNo = 0` means "no linked sales order", not a foreign key. Reading it as one creates
   ~1,500 broken links per sample.

**Field count: RE-DERIVE FROM THE LIVE SPEC.** Both the old "83" and the earlier "55" are void —
"83" was built on `ppkMerchGroup*`, a family that does not exist (see the corrected box in §8).
`ProdHistory` carries **105** properties as of 2026-09-01. It does have a `prepack*` family
(`prepackItemNo`, `prepackColorCode`, `prepackQty`, `ppkDetailCost` and siblings) — identity and
cost fields, not merchandise groups.

**You'll know it worked when:** one window loads and a self-join on `prod_order_no` with differing
`prod_line_seq` returns rows — i.e. multi-line orders survive as separate rows rather than being
collapsed.

---

### Step 6 — Customers and vendors (2 tables)

**New migration.** `coldlion.customer` (7 fields), `coldlion.vendor` (10 fields).

Lowest urgency — this data already flows through `ingest.raw_record` and is curated downstream.
Re-land it out of the generic bucket, repoint `plm.erp_customer` / `plm.erp_vendor` at the new
tables, then retire those `ingest.raw_record` rows in a **separate** migration.

Note the aggressive cuts the owner made: customers 7 of 39 fields, vendors 10 of 29. Addresses,
phone numbers and emails are all `ignore`. That is deliberate — do not "helpfully" keep them.

**You'll know it worked when:** `coldlion.customer` holds ~836 rows and `coldlion.vendor` ~97,
matching the `ingest.raw_record` counts, and the `plm.erp_*` consumers still pass their tests.

---

### Step 7 — The ongoing sync loaders

Where the loaders run is an **open decision** — Supabase Edge Function with `pg_cron` was the
Option B direction (`coldlion-direct-sync-and-taxonomy-plan.md` Part A), with no Google Cloud in
this path. Confirm that is still current before building.

**The loader contract, all verified live — violating any of these breaks the feed:**

| Rule | Why |
|---|---|
| History windows are **7 days inclusive, max**. Wider is refused outright | ColdLion's own limit, set at our request |
| **Page both history endpoints and loop until `last` is true.** The page size caps silently at **200** — `size=5000` returns 200 rows with no error | Corrected 2026-09-01: paging works since 2026-08-31. Believing the old rule cost us a wrong row count (1,375 reported against a true 1,823) |
| Branch on the **wire** HTTP status, never the body's `status` | A refusal is HTTP 400 with `"status": 500` in the body |
| One request at a time, 2-3 second pause, 60s+ timeout | Rate limiting |
| `companyCode=EDGEHOME` returns **four** divisions incl. retired `EP001`. **Filter `EP001` out (D11)** | A short window showing one division is misleading; and retired-division rows must never land |
| `orderHistory` accepts `divisionCode`; **`prodHistory` does not** | No such parameter |
| Backfill and ongoing sync are **separate code paths** (D8) | The backfill writes no `change_log` rows |

**Every failure must alert loudly.** The most expensive fact in this plan is that the existing item
sync died in May and nobody noticed for three months. A loader that fails silently is a defect even
if the SQL is perfect. Standing rule: no silent failures.

**You'll know it worked when:** a deliberately bad window (8 days) is recorded as a permanent input
error and **not retried**, and a forced failure raises an alert you can point to.

## 10. Tests required

Repo convention: `tools/*.test.mjs` (node test runner) and SQL assertions under `supabase/tests/`.
The existing suite must stay green — that is what CI runs on the PR.

**New unit tests, by name and behaviour:**

- `coldlion-window-arithmetic.test.mjs` — a window is exactly 7 days inclusive; `toDate = fromDate +
  6`; windows advance without overlap; the 2019-01-01 anchor is honoured.
- `coldlion-error-classification.test.mjs` — HTTP 400 wire status with body `"status": 500` is
  classified **permanent, not retryable**. Without this the suite does not cover the failure mode
  that actually costs money.
- `coldlion-item-identity.test.mjs` — two items with the same `item_no` in different divisions both
  survive an upsert. Seed with `CW001`/`01` and `SP001`/`01`. Regression test for finding 3.
- `coldlion-merch-group-slots.test.mjs` — 14 slots in; only populated slots produce rows; slot
  numbering preserved; an empty slot 11 is not an error.
- `coldlion-history-grain.test.mjs` — two `prod_line_seq` values on one `prod_order_no` stay two
  rows; component quantities summing to `prepackQty` passes and a deliberate mismatch fails.
- `coldlion-empty-markers.test.mjs` — `1900-01-01`, `1899-12-31`, `""` and JSON `null` all become
  NULL; a real date is untouched.
- SQL: a natural-key uniqueness assertion per new table, and an assertion that no `coldlion.*` table
  has a foreign key into `core.*`.

## 11. Constraints, standing rules and gotchas

**Repo and process:**

- Structure changes are authored **here**, never in an app repo. Branch + PR; Claude merges its own
  shared-db PRs. Do not commit to `main` directly.
- `main` is protected by **9 required checks** taking about 4 minutes. **Other sessions merge
  frequently**, which resets your branch to "behind" and restarts them. Update the branch via
  `gh api -X PUT repos/u2giants/shared-db/pulls/<n>/update-branch` rather than checking out, because
  the working tree may belong to another session.
- **This checkout is shared.** Check `git status` before assuming which branch you are on; it
  changed underneath the planning session mid-task. Never `git add -A`.
- Commit identity must be `Albert Hazan <u2giants@users.noreply.github.com>`. Verify with
  `git var GIT_COMMITTER_IDENT` before your first commit.
- Preview rehearsal before production. The Supabase MCP is read-only; apply via the repo workflow.

**Engineering:**

- No band-aids, no silent failures, nothing hard-coded that should be configurable.
- **This repo is PUBLIC.** Licensed licensor rows, item descriptions carrying property names, vendor
  emails and customer names must never be committed. The decisions CSV here is deliberately stripped
  of sample values for exactly that reason; the sample-bearing originals stay out of the repo.
- Secrets by 1Password location only, never by value.

**ColdLion-specific traps, each already paid for:**

- `mgTypeCode` has no fixed meaning — it is division-dependent.
- `mgCode` collides across types within a division.
- Live merch-group descriptions differ in capitalisation from the workbook. Compare
  case-insensitively and trimmed.
- ColdLion has **no licensor-to-property relationship** and **no active/inactive licence flag**.
  Never invent either. A direct sync assuming otherwise resurrects lapsed licences.
- ColdLion has changed shape three times in a month. Expect it again during this build.

## 12. Access and environment

- **CLIs kept authenticated:** `gh`, `gcloud`, `az`, `supabase`, `vercel`, `op`. Verify with a real
  call before claiming a capability is missing.
- **Production database (read-only work):** Supabase pooler host
  `aws-1-us-east-1.pooler.supabase.com`, port `6543`, database `postgres`, user
  `postgres.qsllyeztdwjgirsysgai`. Assemble the DSN yourself at use time; this repository is
  PUBLIC and does not publish `user@host` connection strings (AGENTS.md writes host, port and
  user separately for exactly this reason).
  Password: 1Password vault `vibe_coding`, item *"Supabase DB Password - shared POP database"*,
  field `password`. Direct 5432 is IPv6-only; use the pooler.
- **ColdLion API key:** 1Password vault `vibe_coding`, item *"Coldlion ERP API key
  x5.coldlion.com"*, field `credential`. Header `X-API-Key`. A missing key returns **400, not 401**.
- **Serialize all 1Password reads.** Never fan out `op read` in parallel.
- **Re-deriving this plan's numbers:** pull the full item master per division with
  `items?companyCode=EDGEHOME&divisionCode=<D>&page=N&size=2000` and join locally against a history
  window. Do not loop per-item lookups — that was tried and wasted calls.
- **Live API spec:** `GET /EhpApi/v2/api-docs` — the authority on what is writable. It disagreed
  with our own docs once already; trust the spec.

---

# Part 4 — Landing it

## 13. Definition of done, risks, open questions

**Done means, for every step:**

- [ ] Migration written, preview-rehearsed, PR opened, 9 checks green, guarded merge to `main`.
- [ ] New unit tests from §10 added and passing; existing suite still green.
- [ ] Applied to production and verified by that step's "you'll know it worked when" gate, with the
      query output recorded under `docs/verification/`.
- [ ] The STATUS table at the top of this file updated — state, date, and an artifact (commit SHA,
      CI run id, or verification file). **A bare number is not evidence.**
- [ ] Design doc and `AGENTS.md` pointers updated if the shape changed.
- [ ] Issue #1184 updated; #1031 reconciled rather than duplicated.
- [ ] The handoff file linked at the top updated, or deleted once its work is proven done.

**Risks and rollback:**

| Risk | Mitigation |
|---|---|
| ColdLion changes shape mid-build (3× in a month) | Loaders fail loudly on unknown shape. With D5 there is no raw archive, so a shape change is visible *only* if the loader reports it — this raises the cost of a silent loader |
| A migration is wrong in production | Additive-only, new schema, no application reads it yet. Rollback is a drop of the new tables |
| The backfill is started by accident | Explicitly out of scope. `window_ledger` makes a partial run resumable and provably gapless |
| An `ignore` decision turns out wrong on a history feed | Accepted by the owner (D5). Recovery means re-pulling 7 years. Say so out loud rather than quietly widening scope |
| The 9-check gate plus concurrent merges stalls the PR | Use the API update-branch route; budget for it |

**Open questions — decide with evidence, do not guess:**

1. **Where do the loaders run?** Supabase Edge Function + `pg_cron` was the Option B direction.
   Confirm still current before building step 7.
2. **Line identity on pickticket/receiving** (phase 6, not this plan) must be confirmed against a
   live pull; with no line identity, key on `source_hash` and document that in the table comment
   rather than hiding it.
3. ~~The four-division question.~~ **CLOSED by D11 — exclude `EP001`.** Filter it at the loader,
   not in a view, so the rows never land. Note this is a deliberate departure from "a raw layer
   lands everything": the owner does not want retired-division data in the new tables. Consequence
   to state in the migration comment: totals from these tables will NOT tie out to a ColdLion report
   run across all four divisions. That is expected, not a loading bug.
4. ~~What goes in `change_log.new_raw`?~~ **CLOSED by D10 — write the complete fetched payload.**
   `change_log` rows are written only when `source_hash` changes, so this is not a per-row archive
   and does not conflict with D5. Do **not** author a migration to drop `previous_raw` / `new_raw`,
   and never insert `'{}'` to satisfy the NOT NULL constraint. Hash and payload must describe the
   same thing: compute `source_hash` over the complete fetched record before projection, and store
   that same complete record in `new_raw`. History tables write no `change_log` rows at all, so D5
   remains fully in force there — an `ignore` decision on the history feeds is still permanent.
5. ~~Does `merchGroupDetails.active` exist?~~ **CLOSED 2026-08-20 — yes, it does.** A live pull of
   `/merchGroupDetails` on 2026-08-19 returned `active` populated on 100% of rows. The API
   reference's claim that the payload has no active flag is **stale** (dated 2026-07-23) and should
   be corrected when someone next touches that file. Step 2's verification query is therefore valid
   as written. Note this does **not** mean ColdLion has a licence-expiry flag — it does not, and
   that remains true.
6. **When a merch-group slot is cleared on an item, is the child row deleted?** Upsert-only leaves a
   stale slot and therefore silently wrong taxonomy. Decide and state it in the table comment.
7. **Which `last*` copy wins** when a re-pull yields two rows differing only in those fields? The
   history-shape doc says pick one deterministically; the plan must say which rule.
8. **`ingest.coldlion_product_size_landing` retirement** — migrate rows in step 2, drop in a later
   migration once nothing reads it. Confirm nothing does.

---

## Self-audit (required by the implementation-plan-writer skill)

**1. Could a brand-new session execute this without asking anything?** Yes. §2 explains the repo and
the ERP from zero. §5 states exactly what is built (phase 1, commit `203a034`, columns listed) and
what must not be touched. §9 names every table, key, field count and verification gate. §12 gives
connection routes and credential locations. The one place a question would arise — the write-back
conflict — is pre-answered in §8 with live-spec evidence and an explicit instruction not to resolve
it silently.

**2. Does it carry every piece of background and nuance, including what was ruled out?** Yes. §7
lists eight rejected approaches including the two most likely to be "re-improved" by a fresh
session: reinstating the raw column (the design doc still recommends it, so §7 and step 1 both warn
against it) and dropping the empty merch-group slots. §6 records all seven measured findings with
their numbers and how to re-derive them. §8 separates nine locked decisions from three open ones.

**3. Is the goal clear enough to make a correct judgment call when a step is wrong?** Yes. §1 states
the goal in business terms, names the three broken things, and instructs the implementer explicitly
that the goal wins over any conflicting step. Each step in §9 states the intent alongside the edit,
so a slightly wrong step can still be implemented correctly — step 3's gate even names the specific
wrong answer (a total near 17,703) that indicates the old bug has returned.

9. **The broken item sync is still broken.** `public.erp_items_*` has been failing with `403` since
   2026-05-21 and is out of scope here (§4). It is the only one of the three candidate jobs that is
   actively losing data every day. The owner has seen this and chose to build the tables first; it
   is recorded here so the next session does not assume it was forgotten. Raise it again if this
   plan runs long.
10. **Two `orderHistory` quantity fields read zero on every row ever sampled** — `lineInvoiceQty`
    and `lineOpenQty`, 374 of 374 lines in one 2024 window and 5,874 of 5,874 in the earlier census.
    A question has been drafted for ColdLion. Until they answer, **never build a report on
    "invoiced" or "open" quantity from this feed** — it would silently read zero for everything.

## Self-audit — second pass, 2026-08-19 (after the owner's four new decisions)

Re-graded against the full checklist. All items still pass.

- **13 sections:** intact; the new decisions extended §8 (D10-D13) and §13 rather than adding
  sections.
- **No unanswered questions for the implementer:** two open questions CLOSED (EP001, and what goes
  in `change_log.new_raw`) — both now carry the decision *and* the consequence to write into the
  migration comment. Two new open items added (9, 10) are explicitly flagged as *not* blocking.
- **Locked vs open still labeled:** D10-D13 added to the locked table with dates and authority.
- **The one thing a fresh session could still get wrong** — reopening the colour/size decision on
  seeing that a SKU table cannot describe its own SKU — is now pre-empted in step 3 with the owner's
  own reasoning quoted.

**Gap found and fixed during this second audit:** the plan recorded the owner's priority choice
(build tables next) but not the job he *didn't* pick, which would have read as an oversight to a
future session. Open question 9 now states it explicitly, including that he has seen it.

**Gap found and fixed during the first audit:** the first draft did not say where the loaders should run.
Rather than invent an answer, it is now open question 1 in §13, pointing at the Option B direction
with an instruction to confirm before building.
