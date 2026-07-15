# Migration Plan — Fix the schema for Coldlion ERP API-pull tables

**Repo:** `u2giants/shared-db` · **DB:** Supabase `qsllyeztdwjgirsysgai`
**Status:** IN PROGRESS — **Phase 1 shipped & live in production 2026-07-15** (PR #70); Phases 2–5 pending · **Author:** engineering session 2026-07-15
**Change discipline:** shared-db branch + PR + preview-first + author-merges (never app-repo migrations, never direct DDL on prod)

---

## 0. TL;DR for the implementing developer

The Coldlion ERP data (items + production orders) is pulled from an external API and mirrored into
this database. Today that mirror lives in **seven `public.*` tables** with an `erp_*` / `prod_order_*`
name prefix. That is the *legacy PopDAM* location. The repo's own architecture (`docs/shared-database-vision.md`)
already specifies where this data is *supposed* to live: raw payloads in the **`ingest`** schema, the
typed authoritative mirror in the **`plm`** schema, and browser-facing shapes in the **`api`** schema.

**Crucially, the correct pattern already exists in this database for a sibling data set:** ERP *customers*
were already migrated to `plm.customer_import` (typed ERP mirror) → `plm.import_master_data()` (entity
resolution) → `core.customer` (canonical hub) → `api.crm_customer_list` (browser view). **This plan does
for ERP items and production orders exactly what was already done for ERP customers.** We are not inventing
an architecture; we are finishing one, following a template that is already live and proven in this repo.

The work is real (data backfill + repointing PopDAM's reads through `api` views), not a rename. It ships
in **five reviewable phases**, each independently deployable and reversible, with PopDAM staying live the
whole time.

---

## 1. Background — what "authoritative elsewhere" means here

Coldlion is the **system of record** for items and production orders. Our database holds a **replica /
mirror**: a read-only copy refreshed by a sync worker (the PopDAM "admin-api" sync; rows are stamped
`created_by = 'admin-api'`, `source_system = 'designflow'`). Nobody in our apps hand-edits these rows;
the only writer is the sync job, and the only correct response to bad data is to fix Coldlion and re-pull.

The industry-standard shape for exactly this situation has three layers:

| Layer | Job | Standard name |
|---|---|---|
| **Raw / landing** | Store the exact API payload, untouched, append-only, one row per pull. Enables replay + audit. | "bronze" / staging |
| **Current / typed mirror** | The de-duplicated "latest version per source id", with typed columns apps can query. | "silver" / import table |
| **Serving** | Stable views/RPCs the frontends read, decoupled from physical tables. | "gold" / API contract |

We already have all three ideas in the database. The problem is **where** they physically live and the
fact that the ERP path **duplicates** generic infrastructure that already exists.

---

## 2. WHAT WE HAVE NOW (exact, current production state)

### 2.1 The seven live ERP tables (all in `public`)

| Table | Rows (live 2026-07-15) | Role | RLS | Writer |
|---|---:|---|---|---|
| `public.erp_items_raw` | **300,213** | Raw item payloads, append-only, 1 row/pull | on, 1 policy | admin-api sync |
| `public.erp_items_current` | **17,703** | Deduped "latest" item master, typed columns | on, 1 policy | admin-api sync |
| `public.erp_sync_runs` | **24** | Item-pull run log / running-lock | on, 1 policy | admin-api sync |
| `public.erp_enrichment_log` | 0 (built, unused) | Field-level enrichment audit | on, 1 policy | (unused) |
| `public.prod_order_headers_raw` | 0 (scaffolded, not pulling) | Raw production-order payloads | on, 2 policies | (not yet) |
| `public.prod_order_headers_current` | 0 | Deduped latest production orders | on, 3 policies | (not yet) |
| `public.prod_order_sync_runs` | 0 | Production-order run log | on, 2 policies | (not yet) |

So: the **items** pipeline is live and carries real data; the **production-order** pipeline is fully
scaffolded but has never pulled a row. This matters — the prod-order half can be built *correctly from
day one* with zero backfill, while the items half needs a careful data move.

### 2.2 Exact column layout of the live tables

**`public.erp_items_raw`** (the landing table)
```
id            uuid  pk   default gen_random_uuid()
external_id   text  not null          -- Coldlion item id (the natural key)
raw_payload   jsonb not null          -- exact API row
sync_run_id   uuid                    -- FK → public.erp_sync_runs(id)
fetched_at    timestamptz not null default now()
```

**`public.erp_items_current`** (the typed mirror — note the ERP-specific merch-group columns)
```
id            uuid pk default gen_random_uuid()
external_id   text not null           -- Coldlion item id (natural key; dedupe target)
style_number  text
item_description text
mg_category   text
mg01_code .. mg06_code  text (x6)      -- Coldlion merchandise-group hierarchy codes
size_code     text
licensor_code text
property_code text
division_code text
erp_updated_at timestamptz            -- last-changed timestamp from Coldlion
synced_at     timestamptz not null default now()
sync_run_id   uuid                    -- FK → public.erp_sync_runs(id)
source_system text not null default 'designflow'
raw_mg_fields jsonb default '{}'
created_at / updated_at timestamptz
dismissed     boolean not null default false   -- app-side curation flag (NOT from ERP)
prepack_code  text
prepack_codes jsonb
```

**`public.erp_sync_runs`**
```
id uuid pk · status text default 'running' · started_at · ended_at
total_fetched / total_upserted / total_errors int · error_samples jsonb
run_metadata jsonb · created_by text
```

(`prod_order_headers_raw/current` and `prod_order_sync_runs` mirror the same three-part shape;
`prod_order_headers_current` carries typed columns: `prod_order_number, style_number, order_status,
customer_code, customer_name, quantity, due_date, order_date, erp_updated_at, …`.)

### 2.3 What already reads/depends on these tables (the real migration surface)

This is the coupling that makes it "a migration, not a rename." Inbound dependencies on
`public.erp_items_current`:

| Dependent object | Type | How it couples |
|---|---|---|
| `plm.style_tracker_item_bridge.erp_item_id` | **FK** | `→ public.erp_items_current(id)` `ON DELETE SET NULL` |
| `public.product_category_predictions` | **FK** | `→ public.erp_items_current(id)` |
| `public.style_tracker_rows_with_bridge` | **VIEW** | selects from `public.erp_items_current` |
| `plm.refresh_style_tracker_item_bridge()` | **FUNCTION** | reads `public.erp_items_current` |
| `plm.style_tracker_item_bridge` resolver | function | resolves SKUs against `erp_items_current` |

Internal couplings (self-contained, move together): `erp_items_raw.sync_run_id` and
`erp_items_current.sync_run_id` both FK to `erp_sync_runs`; same for the prod-order trio.

**No `anon`/`authenticated` direct grants** were found — access is via RLS + the service role. That's
good: it means the browser is *not* hard-wired to these physical tables today, so introducing `api` views
is low-risk.

### 2.4 The destination shells that ALREADY EXIST (empty, waiting)

The target architecture is already partly built — these tables exist with zero rows:

- **`ingest.sync_run`** — generic sync-run log (richer than `erp_sync_runs`: has `source_system`,
  `source_name`, typed `sync_status` enum, `rows_seen/inserted/updated/failed`, `error`, `metadata`).
- **`ingest.raw_record`** — generic raw landing table (`source_system, source_table, source_id,
  record_hash, payload, sync_run_id, imported_at`). **This is the designed home for `erp_items_raw`.**
- **`ingest.dedupe_candidate`** — human-review queue for ambiguous entity matches.
- **`plm.item`** — canonical item (`item_number, style_number, name, licensor_id uuid, property_id uuid,
  product_type_id uuid, source_system, source_id, raw jsonb, …`). Resolved/linked, FK'd to `core.*`.
- **`plm.production_order`** + **`plm.production_order_line`** — canonical production orders (typed,
  FK'd to `core.company`, `core.factory`, `plm.item`).
- **`plm.customer_import`** — **the proven precedent**: the typed ERP *customer* mirror that
  `plm.import_master_data()` resolves into `core.customer`.
- `dam.erp_item_snapshot`, `dam.production_order_snapshot` — DAM-owned snapshot staging (also empty).

---

## 3. WHAT IS CORRECT about what we have now

Do not throw the current design away wholesale — its **bones are right**. Preserve these:

1. **The three-layer split is already present** (`_raw` → `_current` → app reads). That is the correct
   medallion shape; we are relocating it, not redesigning it.
2. **Natural key is preserved.** `external_id` = the Coldlion id, and dedupe is keyed on it. This is
   exactly right and must survive the move (it becomes `source_id`).
3. **Raw is append-only and keeps full history** (300k raw rows for 17k items ≈ 18 versions each). That
   audit/replay trail is a feature, not bloat.
4. **Sync-run tracking exists** (`erp_sync_runs` with counts, status, error samples, running-lock index).
   Observability and idempotency are already designed in.
5. **RLS is enabled on every table** and the browser has no direct grants — the security posture is sound.
6. **The typed merch-group columns** (`mg01..mg06`, `licensor_code`, `property_code`, `division_code`)
   correctly capture Coldlion's hierarchy instead of forcing everything through opaque JSON.
7. **App-curation is separated from ERP truth** — `dismissed` is our flag, not Coldlion's. Good instinct
   that must be preserved (see §5 pitfall).

---

## 4. WHAT IS INCORRECT about what we have now

1. **It lives in `public`.** `public` is Postgres's default catch-all and, in Supabase, the schema most
   exposed to PostgREST. A 300k-row external mirror there (a) obscures ownership, (b) invites accidental
   hand-edits, (c) clutters the API surface, and (d) violates this repo's own rule that raw imports go in
   `ingest` and PLM-owned data goes in `plm` (`docs/shared-database-vision.md` §Architectural Shape).

2. **It duplicates infrastructure that already exists.** `erp_items_raw` is a bespoke re-implementation
   of `ingest.raw_record`. `erp_sync_runs` is a weaker re-implementation of `ingest.sync_run` (no enum
   status, no `source_system`, fewer counters). Two parallel "raw landing" and "sync run" mechanisms is
   precisely the silo the shared-DB vision exists to remove.

3. **Grouping is by name prefix, not by schema/ownership.** "Find all ERP pull tables" today = `LIKE
   'erp_%'` string-matching in `public`. That is fragile and unenforceable; a schema boundary is
   self-documenting and grant-controllable.

4. **`source_system = 'designflow'` is inconsistent with the source-ref labels used elsewhere**
   (`'coldlion'` / `'designflow_plm'`; see vision doc §Customer identity). **Nuance (do not treat as a
   clear bug):** per [`docs/coldlion-erp-to-supabase-field-mapping.md`](docs/coldlion-erp-to-supabase-field-mapping.md),
   the items are **not** pulled from Coldlion directly — the live pipeline is
   **Coldlion → dflow (Cloud SQL + enrichment) → dflow item API → Supabase**, and the raw payload is
   DesignFlow's shape, not Coldlion's `CLAPIServerEhp` shape. So `'designflow'` is *defensible* as the
   immediate upstream. The real defect is only the **inconsistency** of the label across the repo, not
   that it is obviously wrong. Whether the canonical label should be `'coldlion'` (ultimate origin) or
   `'designflow'` (immediate source) is an open decision tied to the Phase-3 source choice below.

5. **No `api`-schema serving layer.** App-facing dependents (`style_tracker_rows_with_bridge`, the
   style-tracker bridge FK) point straight at the physical table `public.erp_items_current`. That hard
   coupling is why moving the table *feels* scary — there's no view layer to absorb the change. The fix
   (an `api` view) is also what makes every future change safe.

6. **The canonical `plm.item` / `plm.production_order` tables are bypassed.** The ERP mirror is a
   dead-end island: nothing resolves `erp_items_current` into the canonical `plm.item` the way
   `plm.customer_import` resolves into `core.customer`. So cross-app joins (DAM asset ↔ PLM item ↔ PM
   product) can't use a single canonical id; they string-match on `style_number`.

7. **`erp_enrichment_log` is built but unused (0 rows)** — either wire it up in the new location or drop
   it; don't migrate dead scaffolding as-is.

---

## 5. WHAT WE SHOULD CHANGE TO — the target design (and why)

Mirror the **already-proven customer pattern** for items and production orders. Target end-state:

```
Coldlion API
     │  (PopDAM admin-api sync worker; relabel source_system → 'coldlion')
     ▼
ingest.raw_record                     ← replaces public.erp_items_raw / prod_order_headers_raw
   (source_system='coldlion', source_table='items'|'production_orders',
    source_id=<coldlion id>, payload=<exact row>, sync_run_id, record_hash)
ingest.sync_run                       ← replaces public.erp_sync_runs / prod_order_sync_runs
     │
     ▼  typed upsert, dedupe on source_id
plm.item_import   (NEW, typed ERP item mirror — the sibling of plm.customer_import)
plm.production_order_import (NEW, typed ERP prod-order mirror)
   • keeps mg01..mg06, licensor_code, property_code, division_code, prepack_*, dismissed
     │
     ▼  entity resolution (NEW plm.import_item_master_data(), modeled on plm.import_master_data())
plm.item / plm.production_order / plm.production_order_line   (canonical, FK'd to core.*)
     │
     ▼  serving
api.plm_item_list / api.plm_production_order_list   (NEW browser/reads contract)
```

**Why this exact shape:**

- **`ingest.raw_record` + `ingest.sync_run` instead of bespoke `erp_*`** — deletes the duplicated
  infrastructure (incorrectness #2), uses the schema the vision doc reserves for raw imports, and lets
  *every* source (Coldlion items, Coldlion prod-orders, future Shopify, etc.) share one landing + one
  run-log with a `source_system` discriminator. One place to monitor freshness for all feeds.

- **A typed `plm.item_import` mirror rather than dumping straight into `plm.item`** — this is the key
  lesson from the customer migration. The ERP mirror and the canonical object are *different tables* on
  purpose: the mirror is a faithful 1:1 copy of Coldlion (safe to truncate + re-pull), while `plm.item`
  is the resolved, FK-linked, app-referenced canonical row that must never be re-pointed. Keeping them
  separate is what let customers go "potential → active" without re-pointing a single FK. Items get the
  same durability.

- **One consistent `source_system` label everywhere** — resolves incorrectness #4 so item source-refs
  slot into the same `core.company_source_ref` resolution machinery. **Pick the label deliberately in
  Phase 3**, not by assumption: `'coldlion'` if we move to pulling Coldlion `/items` directly, or keep
  `'designflow'` if we keep sourcing through the dflow item API (which gives merch-group → licensor/
  property enrichment for free). See the "two source options" analysis in
  [`docs/coldlion-erp-to-supabase-field-mapping.md`](docs/coldlion-erp-to-supabase-field-mapping.md).

- **`api.*` serving views** — fixes incorrectness #5. Once `style_tracker_rows_with_bridge` and the
  bridge resolver read an `api` view (or read `plm.item`), the physical ERP tables can change, move, or
  be re-pulled with zero app impact. This is the single highest-leverage change for future safety.

- **Production orders built native from day one** — because `prod_order_*` has 0 rows, we skip the
  bespoke `public` tables entirely and pull straight into `ingest` → `plm.production_order[_line]`. No
  backfill, no legacy tables to retire. (Only items carry a real data move.)

**Pitfalls to preserve across the move (do not lose these):**

- `dismissed` and any other app-side curation flags are **ours**, not Coldlion's. They live on the
  canonical/`api` layer, and a re-pull must **not** clobber them. In the current table they sit on
  `erp_items_current`; in the target they belong on `plm.item` (or a small side table), never on
  `plm.item_import` (which is truncate-and-replace).
- The `plm.style_tracker_item_bridge.erp_item_id` FK currently points at `public.erp_items_current(id)`.
  Those `id`s are random uuids that will **not** survive a truncate-and-re-pull. During cutover the bridge
  must be repointed to a **stable** id — either `plm.item.id` (resolved) keyed via `source_id`, or keyed
  on `source_id` directly. Plan the backfill so no bridge row is orphaned (the FK is `ON DELETE SET NULL`,
  so a careless move silently nulls links instead of erroring — a classic silent-failure trap).

---

## 6. MIGRATION PLAN — five reviewable, reversible phases

Each phase = one shared-db PR, preview-branch-tested, PopDAM verified green, then author-merged. PopDAM
stays fully live throughout. **No phase deletes a legacy table until the phase after its readers are
moved.**

### Phase 1 — Serving layer first (zero data movement, pure safety net) ✅ DONE 2026-07-15
*Goal: decouple every reader from the physical tables before anything moves.*
1. ✅ Created `api.plm_item_list` (`security_invoker`) as a faithful 1:1 view over
   **`public.erp_items_current`** with forward-looking names (`external_id` → `source_id`).
2. ✅ Repointed `public.style_tracker_rows_with_bridge` to read the ERP columns through the view.
3. ⏸️ **`plm.refresh_style_tracker_item_bridge()` was intentionally NOT repointed.** It is a
   matching function that writes the physical ERP `id` into the `erp_item_id` FK and has logic keyed on
   `target_table='erp_items_current'`; routing it through a view gives no real decoupling and adds risk.
   Its decoupling moves to **Phase 4**, when that FK repoints to `plm.item(id)`.
4. ✅ Shipped via migration `20260715193000_erp_phase1_api_plm_item_list.sql` (PR #70), rehearsed on the
   preview branch, then applied to production. Verified live: `api.plm_item_list` returns all 17,703
   items with unique `source_id`; `style_tracker_rows_with_bridge` is row-for-row identical (0 mismatches
   across 15,509 bridge rows).
**Reversible:** drop the view, revert the reader. **Risk: very low.** **Actual outcome: no behavior change.**

### Phase 2 — Stand up the ingest + import tables (still no cutover)
1. Add `plm.item_import` (typed, columns per §2.2 + `source_system`, `source_id`, `raw`, `imported_at`,
   `sync_run_id`), modeled field-for-field on `plm.customer_import`.
2. Add `plm.production_order_import` similarly.
3. Confirm `ingest.raw_record` / `ingest.sync_run` cover the item payload shape (they do; `record_hash`
   enables change-detection the old table lacked).
4. Write `plm.import_item_master_data(p_sync_run_id uuid)` — the resolver, modeled on
   `plm.import_master_data()`: upsert `plm.item_import` → resolve/link into `plm.item` with a
   `coldlion` source-ref, file ambiguous matches to `ingest.dedupe_candidate`.
5. RLS + grants on the new tables (service-role write, no browser write), matching existing `plm.*`.
**Reversible:** drop the new objects. Nothing reads them yet. **Risk: low (additive only).**

### Phase 3 — Dual-write / backfill items (the one real data move)
1. Point the PopDAM sync worker to **also** write the new path (`ingest.raw_record` +
   `plm.item_import` + `plm.import_item_master_data`), keeping the old `public.erp_*` writes on.
   (App-repo change in `popdam-web`, coordinated but downstream of this schema PR.)
2. One-time backfill: replay latest `erp_items_raw` payloads → `ingest.raw_record`; populate
   `plm.item_import` from `erp_items_current`; run the resolver to fill `plm.item`. **Decide the source
   strategy here** (keep sourcing through the dflow item API vs. pull Coldlion `/items` directly — see
   field-mapping doc) and set one consistent `source_system` accordingly.
3. Reconcile counts: `plm.item_import` row count == `erp_items_current` (17,703); every non-dismissed
   item resolves to exactly one `plm.item`.
4. Migrate the `dismissed` flags onto the canonical layer.
**Reversible:** stop reading the new tables; old path is untouched and authoritative. **Risk: medium —
this is the phase to test hardest on the preview branch.**

### Phase 4 — Cutover reads + repoint the bridge FK
1. Rebuild `api.plm_item_list` on top of **`plm.item`** (canonical) instead of `public.erp_items_current`.
2. Repoint `plm.style_tracker_item_bridge.erp_item_id` and `public.product_category_predictions` FKs to
   `plm.item(id)`, backfilled via `source_id`. Verify **zero** orphaned/nulled bridge rows before/after.
3. Verify PopDAM style-tracker, category predictions, and any DAM ERP-enrichment read paths against the
   preview branch — visually, not just row counts.
**Reversible:** point `api.plm_item_list` back at `public.erp_items_current`; FKs are the only hard part,
so snapshot the bridge table first. **Risk: medium.**

### Phase 5 — Retire the legacy tables + build prod-orders native
1. Turn off the old `public.erp_*` writes in the PopDAM worker.
2. After a soak period (one full sync cycle + spot checks), `DROP` `public.erp_items_raw`,
   `erp_items_current`, `erp_sync_runs`, `erp_enrichment_log` (decide: wire enrichment into the new path
   or drop it — it's 0 rows).
3. Build the **production-order** pull straight into `ingest` → `plm.production_order[_line]` (no bespoke
   `public.prod_order_*` tables ever go live). Drop the empty `public.prod_order_*` scaffolding.
4. Update `docs/unified-supabase-schema-map.md` line 70 and the vision doc to describe the finished state.
**Reversible:** keep the dropped-table DDL in the migration so it can be recreated; don't drop until soak
passes. **Risk: low once Phase 4 is proven (it's cleanup).**

---

## 7. Effort, ownership, and sequencing notes

- **Schema PRs (this repo):** Phases 1, 2, 4, 5 are shared-db migrations. Phase 3's *table* work is
  shared-db; its *writer* work is a `popdam-web` app change that must land **after** the Phase 2/3 schema
  is on production (schema before app, per the standing rule).
- **The only irreversible-feeling step** is the Phase 4 FK repoint; mitigate by snapshotting
  `plm.style_tracker_item_bridge` first and asserting row-match before committing.
- **Production orders are free** — no data, no legacy readers, so they can be built correctly in one clean
  Phase 5 sub-step with none of the items migration's backfill risk.
- **Biggest single win, smallest risk:** Phase 1 (the `api` view). Even if the rest is deferred, doing
  Phase 1 alone removes the hard coupling that makes every future change dangerous.

## 8. Definition of done

- [ ] All Coldlion pulls land in `ingest.raw_record` + `ingest.sync_run` (`source_system='coldlion'`).
- [ ] Typed mirrors are `plm.item_import` / `plm.production_order_import`; canonical rows are `plm.item` /
      `plm.production_order[_line]`, source-ref linked.
- [ ] Every app read goes through an `api.*` view; no app references a `public.erp_*` table.
- [ ] `public.erp_*` and `public.prod_order_*` tables are dropped (DDL retained for rollback).
- [ ] `dismissed` / app-curation flags preserved on the canonical layer and survive a re-pull.
- [ ] `docs/unified-supabase-schema-map.md` + `docs/shared-database-vision.md` updated to the finished state.
- [ ] PopDAM verified live (style-tracker, category predictions, ERP enrichment) on preview before each merge.
