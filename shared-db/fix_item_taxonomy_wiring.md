# fix_item_taxonomy_wiring.md — Wire ERP items to the canonical taxonomy (with real FKs)

**Repo:** `u2giants/shared-db` (shared Supabase `qsllyeztdwjgirsysgai`).
**Relationship to `fix_schema_for_api.md`:** this IS the detailed build for **Phases 2–4** of that
plan. `fix_schema_for_api.md` is the umbrella (5 phases, Phase 1 done/live). This file is the
drill-down for the item→taxonomy resolver specifically. Keep both in sync.
**Status:** DRAFT for review (Kimi K3 debate → Codex implementation). Not yet started in code.
**Unblocked by:** Coldlion `GET /items` returning 200 again as of 2026-07-20 (was a 500).

---

## 1. The problem, precisely

The served item table **`public.erp_items_current`** (exposed 1:1 by the read view
`api.plm_item_list`, `security_invoker`, in `20260715193000_erp_phase1_api_plm_item_list.sql`)
stores an item's licensor and property as **plain text codes**:
- `licensor_code` (text), `property_code` (text), `mg01_code..mg06_code`, `division_code`.

There is **no foreign key** from an item into `core.property` / `core.licensor`. So the question
"show me every item under this property" cannot be answered by a reliable join — only by fuzzy
text matching that silently misses renames, casing, and division-scoped code collisions.

Meanwhile the **correct** table already exists and is **empty**: `plm.item`
(`20260621151024_domain_tables.sql`) has genuine FKs:
`licensor_id → core.licensor(id)`, `property_id → core.property(id)`,
`product_type_id → core.product_type(id)`, `merch_group_id → core.merch_group(id)`.

So this is a **wiring job, not a rebuild**: resolve each item's flat codes to existing `core.*`
taxonomy ids and store strict FKs in `plm.item`.

## 2. Hard truths about the source data (do not design around wishful assumptions)

From `docs/merch-group-taxonomy-architecture.md` (the authority):
1. **Coldlion owns the vocabulary; DesignFlow owns the relationships.** Coldlion `/items` gives
   per-item codes (`merchGroup05` = licensor, `merchGroup06` = property, per current mapping) but
   **no** licensor↔property edge and **no** active flag. The parent→child edges live in `core.*`,
   sourced from `designflow_plm` (505 `taxonomy_source_ref` rows).
2. **`mgTypeCode` has no fixed global meaning.** `05` = Licensor in CW001/SP001 but "Big Theme" in
   EH001, "Product Line" in EP001. **Resolve meaning via `(divisionCode, mgTypeCode) → mgTypeDesc`,
   never by the bare number.** A resolver that hard-codes "05 = licensor" is wrong for EH001.
3. **Codes are unique only within `(division, mgTypeCode)`.** The same string (`FR`) is a licensor
   in one context and a *property* in another. **The resolver key must be
   `(division_code, mg_type, code)`, never `code` alone.**
4. There is a documented defect where the merch-group header sync is hard-coded to
   `divisionCode=EH001` — do not copy that pattern.

## 3. Target design

```
Coldlion /items  ──►  ingest.raw_record (source_system='coldlion', source_table='items')
                        │  (bronze: exact payload, keyed by (companyCode,divisionCode,itemNo))
                        ▼
                     plm.item_import           (silver: typed mirror, one row per ERP item,
                        │                        raw codes preserved as text)
                        ▼  plm.import_item_master_data()  ← the RESOLVER
                     plm.item                   (gold: strict FKs to core.licensor/property/...)
                        │
                        ▼
                     api.plm_item_list          (repointed from erp_items_current → plm.item)
```

### 3.1 The resolver contract (`plm.import_item_master_data()`)
For each imported item row, resolve taxonomy ids via `core.taxonomy_source_ref` /
`core.property` / `core.licensor` using the **composite key**
`(division_code, mg_type, code)`:
- `property_id` ← resolve `(division, 'property'-typed mg, property_code)`.
- `licensor_id` ← prefer the property's own `licensor_id` (strict FK parent) when a property
  resolved; fall back to resolving the licensor code directly only if no property matched.
- `product_type_id`, `merch_group_id` ← resolve their respective `(division, mg_type, code)`.
- **Unresolved codes are a first-class outcome, not a silent NULL.** Every code that fails to
  resolve is recorded to a reject/quarantine table (e.g. `plm.item_import_unresolved`) with the
  item id, the code, and the reason. The run summary counts resolved vs unresolved. This satisfies
  the "no silent failures" rule — a drifted/missing taxonomy code must surface loudly.
- The run writes a durable `ingest.sync_run` row (`status`, `rows_seen`, `rows_resolved`,
  `rows_unresolved`, `error`) that **survives failure** (learn from the PLM master-data sync bug
  fixed in PR #107 — do not put the failure record inside a transaction that rolls back).

### 3.2 Active-flag reconciliation
Coldlion has no reliable licensor/property active flag; DesignFlow owns it. The resolver must
**not** resurrect a lapsed license: if an item references a property/licensor that DesignFlow has
marked inactive/absent, wire the FK (for history) but do **not** flip the taxonomy row active.
Naming names from the plan: NASA, ZAG, FRIDA KAHLO are known lapsed — a naive sync would revive
them. Add a guard + test for exactly this.

## 4. Phased rollout (additive first, cutover last — reversible at each step)

| Phase | Action | Touches live reads? |
|---|---|---|
| **2a** | Create `ingest` item raw path + `plm.item_import` + `plm.item_import_unresolved`. Additive. | No |
| **2b** | Build `plm.import_item_master_data()` resolver + `ingest.sync_run` accounting + tests. Additive. | No |
| **3** | Dual-write: run the resolver to **backfill `plm.item`** from a full `/items` pull. Compare `plm.item` counts/spot-checks against `erp_items_current`. First phase that writes live data. | No (reads unchanged) |
| **4** | Repoint `api.plm_item_list` from `public.erp_items_current` → `plm.item` (+ repoint the style-tracker bridge FK `plm.style_tracker_item_bridge.erp_item_id`). **Cutover.** | **Yes** |
| **5** | Retire legacy `public.erp_*` once nothing reads them. | Yes |

**Cutover-safety gate before Phase 4 (the "are you sure nothing breaks?" gate):** grep every
consuming app repo (popdam, popcrm-web, dflow, poppim) for `erp_items_current`, `licensor_code`,
`property_code`, and name/text-based taxonomy lookups. Any hit must be repointed to `api.plm_item_list`
(shape-compatible) or explicitly signed off BEFORE the view is repointed. Do not cut over on faith.

## 5. Compatibility rule for `api.plm_item_list`
When Phase 4 repoints the view onto `plm.item`, the **output columns must stay shape-compatible**
with today's `erp_items_current`-backed view (same column names/types) so existing readers don't
break — additive columns (`property_id`, `licensor_id`) are fine, removed/renamed columns are not.
The FK ids are added; the legacy text codes stay in the view during a deprecation window.

## 6. Tests (Albert rule #13 — required)
- Resolver resolves a known Marvel/Avengers item (CW001) to the right `property_id`/`licensor_id`.
- `(division, mg_type, code)` composite key: a code that is a licensor in one division and a
  property in another resolves correctly in each (the `FR` case).
- An unresolved code lands in `plm.item_import_unresolved` and increments `rows_unresolved` — not a
  silent NULL.
- A lapsed license (NASA/ZAG/FRIDA KAHLO) referenced by an item does **not** flip the taxonomy active.
- A forced resolver failure writes a durable `status='failed'` `ingest.sync_run` row.

## 7. Open questions to settle in the Kimi debate (before Codex builds)
1. **`merchGroup05/06` → licensor/property mapping across divisions.** Is the 05=licensor/06=property
   mapping valid for all divisions we care about, or must the resolver derive it from
   `(divisionCode, mgTypeCode) → mgTypeDesc` per division? (Strongly suspect the latter.)
2. **Property vs licensor precedence** when both a `property_code` and a `licensor_code` are present
   but disagree — trust the property's parent FK, or the item's licensor code? Proposal: property parent wins.
3. **Ingest cadence** — one-time backfill now, then hook into the existing sync cadence, or a
   dedicated item-sync timer? (Coldlion `/items` = 19,066 items / 9,533 pages at size=2; page at size=200.)
4. **Where the resolver runs** — pure SQL function fed a JSONB payload (like `import_master_data`),
   or Node-side resolution? Proposal: SQL function fed JSONB, for parity + testability.
5. **`plm.item` scope** — items only, or items + production orders in the same pass? Proposal: items first.

## 7b. LOCKED DECISIONS — Kimi K3 adversarial review + live DB verification (2026-07-20)

The plan was reviewed adversarially by Kimi K3 (23-point critique) and debated to convergence,
then the open questions were settled against the **live** shared DB. These decisions supersede
§7 and harden §§3–5. Codex implements to THIS section.

### 7b.1 Verify-first results (run live 2026-07-20)
- `core.product_type` = **0 rows**, `core.merch_group` = **0 rows**, `core.character` = **0 rows**.
  `core.licensor` = 20, `core.property` = 256. `taxonomy_source_ref`: 468 property refs, 37 licensor refs.
- **Consequence:** the resolver populates **only `plm.item.licensor_id` and `plm.item.property_id`**.
  `product_type_id` and `merch_group_id` are **explicitly out of scope** until their target tables are
  populated from `designflow_plm` (a separate upstream job). Do not resolve FKs to empty tables.

### 7b.2 The join key (THE critical determination)
- The item's merch-group codes are **short codes**, and they join to `core.*.code` directly —
  **NOT** to the numeric `taxonomy_source_ref.source_id` ids.
  - `merchGroup05` → `core.licensor.code` (e.g. item `MV` → licensor MARVEL).
  - `merchGroup06` → `core.property.code` **scoped to the resolved `licensor_id`**.
- **Property MUST resolve within its licensor.** Codes collide across types: `SM` is licensor
  SESAME STREET *and* property SUPERMAN (under DC); `WW` is licensor WWE *and* property WONDER
  WOMAN (under DC). Resolving property by code alone is wrong. Resolve licensor first (from the
  licensor slot), then `property = (licensor_id, code)` — matches `core.property unique(licensor_id, code)`.
- `licensor_id` is taken from the **resolved property's parent FK** when a property resolves
  (property parent wins, per debate). The licensor slot (`merchGroup05`) is used to resolve the
  licensor and to **flag disagreements** to a review table when property.licensor_id ≠ slot licensor —
  those mismatches are the only signal for a stale parent or a mis-keyed item; never silently drop them.

### 7b.3 Division scoping (the mgTypeCode trap)
- The `merchGroup05=licensor / merchGroup06=property` mapping holds for the **licensed divisions**
  (CW001, SP001 confirmed). For **EH001** (`05`=Big Theme) and **EP001** (Product Line) those slots
  are NOT licensor/property. The resolver must derive slot meaning per division from a **fresh
  `/merchGroupHeaders` pull for ALL divisions** (stored as a dictionary table; hard Phase-2a
  prerequisite — the existing header sync only ever fetched EH001, so the dictionary is missing).
- Unknown `(division, mgTypeCode)` pairs and non-licensed divisions → route to **unresolved**,
  never defaulted. EP001 has no taxonomy in `core.*` at all (expected 100% unresolved there) — state
  the expected unresolved rate up front; unresolved items still keep their legacy text codes in the view.
- **Division 9 (EH001) taxonomy import is OUT of scope** for this plan; the licensor-collapse
  division-9 policy is deferred to the taxonomy pipeline roadmap. The resolver treats EH001 slots as
  merch-group/NULL, so it is safe against today's data.

### 7b.4 Resolver is READ-ONLY on `core.*`
Hard rule (stronger than "don't flip active"): the resolver **never writes `core.*`**. Lapsed
licenses (NASA/ZAG/FRIDA KAHLO) were filtered out upstream (`is_active:true`) and simply won't
resolve → their items go to unresolved and keep legacy codes. No resurrection is even possible.

### 7b.5 Outcomes are {resolved, partially-resolved, ambiguous, unresolved} — all first-class
- **ambiguous** (a code matching >1 candidate) is a distinct quarantine outcome with a stated
  tiebreak, not a silent pick. (Live check: no property code currently sits under >1 licensor, but
  the rename-creates-duplicate defect can introduce it — model it anyway.)
- `plm.item_import_unresolved` is upserted by `(item, slot)` and **auto-cleared** when a later run
  resolves, so the unresolved count stays truthful.

### 7b.6 Ingest = full sweep + staging swap (no cursor resume)
- Dedicated item sync (do NOT hook the PLM master-data sync). Full sweep, ~96 pages at size=200.
- Pull all pages into a **staging holding table**; promote to silver (`plm.item_import`) **only on a
  completeness assertion** — but assert "reached terminal/empty page", NOT `pages==totalPages` exactly
  (a live insert mid-sweep shifts the count and would spuriously block forever → the §8 invisible outage).
- **Sanity-band guard before swap:** promoted row count within an agreed % of current silver, and
  per-division counts non-zero — else a partial upstream response would delete most of silver.
- **Alert on ≥2 consecutive non-promotions.** Keep last-good silver; the resolver never runs on a
  partial pull. Natural/upsert key everywhere: `(companyCode, divisionCode, itemNo)`.
- Durable `ingest.sync_run` accounting (learn from PR #107): status survives failure, and record
  **per-division/per-type** breakdowns + honest `rows_updated`, not just green totals.

### 7b.7 Cutover (Phases 4–5) hardening
- **Bridge FK repoint is deferred to Phase 5** (not Phase 4). Requirement: `public.erp_items_current`
  stays **refreshed** (legacy pull keeps running — dual pipeline) through the window, NOT frozen —
  otherwise new items can't get style-tracker bridge rows. The window needs a **hard end date**;
  Phase 5's orphan policy must cover bridge rows whose item never resolved into `plm.item`.
- **Phase 4 view repoint is `security_invoker` on `plm.*`:** every new table (`plm.item`,
  `plm.item_import`, `plm.item_import_unresolved`, the headers dictionary, staging) needs explicit
  **grants + RLS policies** in Phase 2a, or every reader gets 403/42501 at cutover (RLS ≠ grant).
- **Cutover gate = row parity, not just column shape:** compare the repointed view's *output* (row
  count keyed by item, unresolved-inclusive) against today's, plus the app-repo grep pass
  (`erp_items_current`, `licensor_code`, `property_code`, name-based lookups). No cutover on faith.

### 7b.8 Scope for the FIRST Codex handoff
Codex implements **Phase 2a + 2b ONLY** (additive, no live-data cutover): the ingest/staging path,
the `/merchGroupHeaders` all-division dictionary table, `plm.item_import` + `plm.item_import_unresolved`,
the `plm.import_item_master_data()` resolver (licensor_id + property_id only), grants/RLS, and the
full §6 test matrix (add EH001-routes-to-merch-group, EP001-unresolved, ambiguous, and re-run/idempotency
cases). Phases 3–5 (backfill, cutover, retire) are separate, gated handoffs.

## 8. References
- `fix_schema_for_api.md` (umbrella 5-phase plan; this file details Phases 2–4).
- `docs/merch-group-taxonomy-architecture.md` (§ ownership rules, the `mgTypeCode`/composite-key traps).
- `docs/coldlion-direct-sync-and-taxonomy-plan.md` (Part B — the item↔taxonomy disconnect + fix).
- `docs/coldlion-erp-api-reference.md` (`/items` shape, auth, paging).
- Migrations: `20260621151024_domain_tables.sql` (`plm.item` FKs), `20260715193000_erp_phase1_api_plm_item_list.sql`.
- PR #107 (the durable-failure pattern the resolver's `sync_run` accounting must follow).
