# Coldlion direct sync (Option B) + taxonomy wiring & de-duplication plan

Date: 2026-07-15
Repo: `u2giants/shared-db` · Production project `qsllyeztdwjgirsysgai`

This is the detailed plan for two intertwined pieces of work:
1. **Pull Coldlion ERP data straight into Supabase** (the "Option B" decision), replacing
   the current two-hop path through DesignFlow.
2. **Wire the item catalog to the strict, queryable taxonomy** that already exists in
   `core.*`, and resolve the taxonomy-table duplication **without breaking any app**.

It is the concrete follow-on to the **Phase 3 "open decision"** in
[`../fix_schema_for_api.md`](../fix_schema_for_api.md) / [`../HANDOFF.md`](../HANDOFF.md):
Albert chose **Option B (direct Coldlion)** on 2026-07-15.

> **⚠️ Read [`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md)
> before implementing any of this.** Verified live 2026-07-19, it supersedes the taxonomy
> assumptions below in three ways that would otherwise corrupt data:
> 1. `mgTypeCode` has **no fixed meaning** — `05` is Licensor in CW001/SP001 but "Big Theme"
>    in EH001 and "Product Line" in EP001. Keying on the number alone is a data-corruption bug.
> 2. Coldlion **does** have explicit licensors and properties (22 and 258 in CW001). What it
>    lacks is the relationship between them **and any active/inactive flag** — so a direct
>    Coldlion sync would resurrect lapsed licenses (NASA, ZAG, FRIDA KAHLO) unless `is_active`
>    keeps coming from DesignFlow or becomes ours to own.
> 3. Merch-group codes are unique only within `(division, mgTypeCode)`. `FR` is a licensor in
>    our DB and a *property* in Coldlion.
>
> See §10 of that doc for the non-negotiable rules for this sync.

Companion references:
[`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md) (**taxonomy — read first**),
[`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) (API map),
[`coldlion-erp-to-supabase-field-mapping.md`](coldlion-erp-to-supabase-field-mapping.md) (field mapping),
[`unified-supabase-schema-map.md`](unified-supabase-schema-map.md) (canonical schema plan).

> **Nothing here is built yet. No code, no migration, no deletion has been executed.**
> This is a plan awaiting sign-off on the open decisions in Part F.

---

## Part A — The sync architecture (Option B)

**End state:** `Coldlion API → one Supabase Edge Function → ingest/plm/core tables`,
scheduled by Supabase's own `pg_cron`, with the `X-API-Key` in **Supabase Vault**. No Google
Cloud anywhere in this path.

| Concern | Decision |
|---|---|
| Where the code lives | **`shared-db`** (AGENTS.md: import code belongs to the data layer). Today's `erp-sync` function lives in the DAM `popdam3` repo — ownership moves here. |
| Runtime | A standalone **Edge Function** in the shared project — not embedded in any of the 4 apps' runtimes. |
| Scheduler | **`pg_cron`** (already runs 9 nightly jobs in this project). **No Google Cloud Scheduler.** GCS stays only for dflow's *own* Cloud SQL. |
| Secret | Coldlion `X-API-Key` in **Supabase Vault**; the function reads it at runtime. Never hard-coded, never in git. |
| Source data | Coldlion `CLAPIServerEhp` `/items` (+ `/customers`, `/vendors`, `/merchGroupDetails`). **Catalog/operational data only.** |
| Images | **NOT synced from Coldlion.** DesignFlow PLM is the source of truth for images (Coldlion holds downstream copies). If Supabase ever needs images, that is a separate DesignFlow→DAM path. `hasImage` from Coldlion is at most a cross-check. |

**Reuse vs build vs delete**
- *Reuse* the good bones of the existing `erp-sync`: watermark incremental (`modifiedFrom`),
  raw-copy + clean-copy, run tracking (`erp_sync_runs`), run-lock, configurable endpoint.
- *Build*: Coldlion paging (`page`/`size`) + `X-API-Key` auth; the new field mapping; the
  item→taxonomy resolution (Part B); the `pg_cron` schedule; the reconciliation job (below).
- *Delete*: the ~300-line `_shared/mg-codes.ts` reverse-description→code map. Coldlion returns
  the codes natively, so the guessing layer is unnecessary.

**Two lanes (respecting Edge Function time/memory limits)**
- **Nightly incremental** — only what changed since the last run. Small, fast.
- **Periodic full reconciliation (NEW — was missing entirely).** Today the pipeline is
  incremental-only with no scheduled full compare, so **deletes and missed windows drift
  silently** (violates the "no silent failures" rule). Add a weekly job that pulls the full
  Coldlion set, compares counts + a checksum against our tables, **alerts loudly on drift**,
  and self-heals. This is a first-class requirement, not an optional extra.

**Field mapping** — see [`coldlion-erp-to-supabase-field-mapping.md`](coldlion-erp-to-supabase-field-mapping.md).
Direct Coldlion additionally populates fields the dflow path drops: `divisionCode`, pricing
(`itemPriceA–H`, cost), UPC/EAN/GTIN, dimensions, `vendorCode`.

---

## Part B — Wiring items to the strict taxonomy (the crux)

The taxonomy Albert needs — *strict, queryable parent-child* — **already exists and is
populated** in `core.*`. It is **sourced from DesignFlow PLM** (`taxonomy_source_ref` shows
all 505 mappings come from `designflow_plm`), which is correct: DesignFlow owns the
relationships; Coldlion does not expose them.

Confirmed live taxonomy (row counts 2026-07-15):
- `core.licensor` (20) → `core.property` (256), strict `licensor_id` FK. Verified sample:
  AARDMAN ANIMATIONS → {Shaun the Sheep, Wallace & Gromit}; CARE BEARS → {Baby, Classic, Unlock the Magic}.
- `core."merchGroup"` (3,645) + `core."merchGroupRelations"` (1,389 grandparent→parent→child edges)
  + `core."merchGroupMaster"` (2,017) + `core."merchGroupHeaders"` (45).
- `core.taxonomy_source_ref` (505) bridges `designflow_plm` source codes → `core.property` (468) / `core.licensor` (37).

**What Coldlion gives us:** each item carries flat *pointer codes* only —
`merchGroup01/02/03` (product Type/Sub-Type/Sub-Sub-Type), **`merchGroup05` = licensor**,
**`merchGroup06` = property** (both confirmed empirically: `DY`→DISNEY, `LS`→LILO AND STITCH;
`AN`→ANIMAL NON-JUVENILE, `AKF`→LAKE/FISHING). Coldlion's `/merchGroupDetails?mgTypeCode=NN`
returns the code→name dictionary per division, but **no parent-child edges** — those only
exist in DesignFlow.

**The actual job (this is what's incomplete today):** on ingest, resolve each item's codes to
the existing `core` taxonomy and store **strict foreign keys** (e.g. `item.property_id →
core.property.id`), not loose text. Today `erp_items_current` stores `licensor_code` /
`property_code` as **plain text sitting next to** the taxonomy rather than joined into it —
that disconnect is the likely "the whole system falls apart" symptom. Fixing it is a wiring
job against tables that already exist, **not** a from-scratch taxonomy build, and **not**
something to source from Coldlion.

---

## Part C — Taxonomy duplication: the real picture (premise correction)

Task as originally framed was "delete the empty duplicate tables after checking references."
**Investigation shows the empty tables are NOT strays — they are the *planned canonical
target* in [`unified-supabase-schema-map.md`](unified-supabase-schema-map.md) (§ Product
taxonomy → `core.product_category`, `core.product_type`, `core.product_subtype`,
`core.merch_group`).** Deleting them would contradict the documented plan and break the apps'
generated `types.ts`. So this section replaces "delete empties" with an accurate map and a
safe procedure.

There are **four overlapping layers** today:

| Layer | Tables | Rows | Referenced by | Verdict |
|---|---|---|---|---|
| **Live canonical (in use)** | `core.licensor`, `core.property`, `core."merchGroup"`, `"merchGroupMaster"`, `"merchGroupRelations"`, `"merchGroupHeaders"`, `properties_and_characters`, `property_character_associations` | 20 / 256 / 3,645 / 2,017 / 1,389 / 45 / 10,122 / 9,622 | `core.licensor`←13 FKs+8 views; `core.property`←11 FKs+6 views; `core."merchGroup"`←10 FKs (`designflow.art_piece`); `taxonomy_source_ref` | **Keep.** De-facto canonical. |
| **Planned scaffolding (empty, per schema map)** | `core.merch_group`, `core.product_category`, `core.product_type`, `core.product_subtype`, `core.product_material` | 0 / 0 / 0 / 0 / 11 | FKs only from other empty scaffolding (`plm.item`=0, `core.product_type`=0) + apps' generated `types.ts` | **Do NOT delete.** Intended target model, not yet populated. Decision needed (Part F). |
| **Duplicate island** | `dflow.merchGroup`, `dflow.merchGroupMaster`, `dflow.merchGroupRelations`, `dflow.merchGroupHeaders`, `dflow.properties_and_characters`, `dflow.property_character_associations`, `dflow.product_category` | identical copies (3,645 / 2,017 / 1,389 / …) | **0 external FKs** (nothing outside the `dflow` schema references them) | **Most likely safe to drop — but verify first** (Sequelize models in the 6 `designflow-*` repos may bind to `dflow.*` by name). |
| **DAM-owned** | `public.product_categories`, `public.product_types`, `public.product_subtypes`, `public.licensors`, `public.properties` | 0 / … / … / 10 / 500 | DAM `assets` FK to `product_subtypes`; `public.licensors`←4 FKs+2 views; `public.properties`←4 FKs | **Keep** (DAM's own taxonomy; separate consolidation question). |

**Key facts established:**
- `plm.item`, `core.product_type`, `core.product_subtype`, `core.merch_group`,
  `core.product_category`, `public.product_categories` are all **empty (0 rows)**.
- **Nothing outside the `dflow` schema has a foreign key into `dflow.*`** (0 external FKs).
- The apparent references to the empty tables in `popdam3` are in **auto-generated
  `src/integrations/supabase/types.ts`** (a mirror of the DB), not active queries. GitHub
  code-search hit counts for `merch_group`/`product_subtype`/`product_material` (9/18/15 in
  `u2giants`, **0 in `popcre`**) are dominated by these generated types.

---

## Part D — Is `taxonomy_source_ref` named/placed correctly? (Q1)

- **Placement: correct.** It is in `core`, which matches the schema map (source-reference
  tables live in `core`). It maps into the live canonical `core.property`/`core.licensor`. ✅
- **Naming: deviates from the documented convention.** The schema map (§ First Migration
  Shape) specifies **per-entity** source refs: `core.company_source_ref`,
  `core.licensor_source_ref`, `core.property_source_ref`, `core.character_source_ref`, etc.
  The actual table is a **single generic `taxonomy_source_ref`** covering all taxonomy
  entities via polymorphic `entity_schema`/`entity_table`/`entity_id` columns.
- **Design trade-off (matters for "strict"):** a polymorphic table **cannot enforce a real
  foreign key** on `entity_id` (it points at different tables per row), so referential
  integrity is weaker than the planned per-entity tables — which is at odds with the
  "real, strict" requirement.

**Recommendation:** make a deliberate choice and record it in the schema map:
- **(preferred, strict)** split into `core.licensor_source_ref` + `core.property_source_ref`
  (+ `core.merch_group_source_ref` as needed) with **real FKs** to their canonical parents,
  matching the documented convention; or
- **(if keeping generic)** formally bless `core.taxonomy_source_ref` in the schema map as the
  chosen pattern, and add a validation trigger to compensate for the missing FK.

Either way it is a small, additive migration — not urgent, but it should be settled before the
Option B loader writes through it at volume.

---

## Part E — Non-breaking de-duplication procedure

**Guardrails:** every step is a `shared-db` branch → PR → preview-apply → verify → prod-apply
migration (AGENTS.md flow). Nothing is dropped without (a) confirmed 0 rows, (b) confirmed 0
DB dependents, and (c) confirmed 0 references across **all 4 apps + 6 designflow repos**
(distinguishing generated `types.ts` from real queries).

1. **Decide the canonical model (blocks everything — see Part F).** Is the target the
   *live camelCase* `core."merchGroup"` set, or the *planned snake_case* `core.merch_group` /
   `core.product_*` set? This decides whether the empties get built-into or retired.
2. **Do NOT touch the empty planned scaffolding** (`core.merch_group`, `core.product_category/type/subtype`)
   until step 1 is answered. They are the documented target, not strays.
3. **Retire the `dflow.*` duplicate island (most likely first safe win).** It has 0 external
   FKs. Before dropping: grep all 6 `designflow-*` repos for Sequelize models with
   `schema: 'dflow'` / `tableName` binding to these tables. If unused, drop the 7 `dflow.*`
   taxonomy tables in one migration. If used, first re-point those models at the canonical
   `core.*` set, then drop.
4. **Regenerate `types.ts` in each affected app** after any drop, so app builds don't
   reference removed tables.
5. **`public.*` DAM taxonomy consolidation** (`product_categories`/`types`/`subtypes` vs
   `core.*`) is a **separate** effort — DAM `assets` FK to it. Out of scope here; note only.

---

## Part F — Open decisions (need Albert / the team before building)

1. **Canonical taxonomy model:** keep the live **camelCase `core."merchGroup"`** set as
   canonical (and retire/repurpose the empty snake_case scaffolding), or invest in migrating
   to the **planned snake_case `core.merch_group`/`core.product_*`** model? *Everything in
   Parts B and E branches on this.*
2. **`taxonomy_source_ref`:** split into per-entity source-ref tables with real FKs
   (strict, matches plan) vs keep generic + add a validation trigger (Part D)?
3. **Confirm** images stay DesignFlow-sourced only (Part A) — assumed yes.
4. **Backfill scope & cadence:** how far back does the first full Coldlion backfill go, and is
   nightly + weekly-reconcile the right schedule?

## Part G — Sequencing against `fix_schema_for_api.md`

- This work **is** the Phase 3 source decision (Option B). It should land **after** Phase 2
  (stand up `ingest.*` + `plm.item_import` + resolver), because the Coldlion loader writes
  into those structures.
- Recommended order: **(1)** answer Part F decisions → **(2)** finish Phase 2 scaffolding →
  **(3)** build the Coldlion Edge Function writing to `ingest.*`/`plm.*` with taxonomy FKs →
  **(4)** parallel-run vs the existing dflow-fed mirror and reconcile → **(5)** cut over,
  retire the dflow-fed path, and do the `dflow.*` island cleanup (Part E).
