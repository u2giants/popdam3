> **⚠️ SUPERSEDED 2026-07-21 — read [`DB_Data_Admin.md`](DB_Data_Admin.md) instead.**
> The approved direction is a **standalone** admin application, **DB Data Admin**, owned in
> this repo (`apps/db-data-admin/`) and served at `https://data.designflow.app`, built on
> **RevoGrid Core (MIT)** — NOT a page inside popcrm-web. `DB_Data_Admin.md` is authoritative
> for product ownership, URL, grid engine, architecture, screens, the admin-only serving-API
> contract, and the delivery plan. **Do NOT implement the popcrm-web ownership/location below.**
> What in this file remains useful: the database-surface inventory (exact `core.*` / `api.*`
> object names, the merge/alias RPCs, the Licensor→Property FK), and the §5 cutover-safety grep
> gate. Treat everything about *where the page lives* as history.

# fix_impl_visual_admin_page.md — Build the canonical-data Admin page in popcrm-web

**Repo to work in:** `popcrm-web` (already cloned on the `hetz` Ubuntu server that runs the app).
**Repo that owns the data contract:** `u2giants/shared-db` (this repo — the shared Supabase backend `qsllyeztdwjgirsysgai`).
**Status:** NOT STARTED. This document is a cold-start handoff. A brand-new session with zero prior context should be able to build the entire feature from this file alone.
**Author of this spec:** shared-db session, 2026-07-20.

---

## 0. TL;DR — what we are building and why

We have spent weeks turning four messy, duplicated, multi-source entity sets into clean
**canonical** tables in the shared Supabase database:

| Business entity | Canonical table | Rows (as of 2026-07-17) |
|---|---|---|
| **Customers** | `core.customer` | 859 (140 active / 12 potential / 707 inactive) |
| **Vendors / Factories** | `core.factory` | ~529 (status seeding + not-a-factory purge pending) |
| **Licensors** | `core.licensor` | 20 |
| **Properties** (belong to a Licensor) | `core.property` | 256 |

The database now has display names, alias tables, merge functions, and de-duplication.
**But there is no human-facing screen to see or curate any of it.** Everything that has
been built is reachable only by SQL or by the type-ahead picker. Albert (the business
owner) cannot look at the Licensor→Property tree, cannot see which of two duplicate vendors
survived a merge, cannot rename a display name, and cannot flip an entity active/inactive
from a screen.

**Goal of this task:** build an **Admin** area in popcrm-web that visually presents and
curates these four entity sets and, critically, **the Licensor → Property relationship**.

This is the "gold layer made visible" — the payoff for all the canonicalization work.

---

## 1. Background a stranger needs (read this before touching code)

### 1.1 The three-layer data model
The shared DB is organized bronze → silver → gold:
- **`ingest.*`** (bronze) — raw API payloads exactly as pulled (`ingest.raw_record`, `ingest.sync_run`).
- **`plm.*` / mirror** (silver) — typed mirrors of a source system (`plm.erp_customer`, `plm.erp_vendor`).
- **`core.*`** (gold) — the **canonical** entities the whole company shares. **This is what the Admin page reads and writes.**
- **`api.*`** (serving) — thin, RLS-safe views/RPCs that browser clients are allowed to touch. **The frontend must talk to `api.*` and the `core.*` RPCs listed below — never to `ingest.*`, `plm.*`, or `public.erp_*` directly.**

### 1.2 How identity survives re-pulls (the `*_source_ref` pattern) — READ THIS
Every canonical row keeps back-pointers to the source system it came from:
- `core.company_source_ref` — customers ↔ their ERP/CRM origin.
- `core.factory_source_ref` — factories ↔ their Coldlion vendor origin (531 coldlion rows).
- `core.taxonomy_source_ref` — licensors/properties/characters ↔ DesignFlow PLM origin (505 rows).

Each is **unique on `(source_system, source_table, source_id)`** where `source_id` is the
**stable ERP/PLM code** (e.g. Coldlion `vendorCode`, `customerCode`). This is *the* reason a
rename or a merge never loses the link: matching is by immutable code, never by name string.
The Admin page should **display** these source refs (so a human can see "this factory came
from Coldlion code CNSHAO") but generally should not let a user edit them.

### 1.3 Who owns what (do not fight this)
- **Coldlion ERP owns the vocabulary** (the codes, the raw customer/vendor lists).
- **DesignFlow PLM owns the relationships** (which property belongs to which licensor; the active flag). Coldlion has **no** licensor↔property edge and **no** active flag.
- **Supabase is a downstream mirror of both.** Authority doc: `shared-db/docs/merch-group-taxonomy-architecture.md`.
- **Status is app-owned:** importers set `status` on first insert only and never overwrite it on re-pull, so human curation survives syncs. Do not build anything that lets a re-pull clobber a curated status.

---

## 2. The exact database surface the Admin page uses

All object names below are current on `main` of `u2giants/shared-db`. Verify with
`\d api.<name>` before coding; if a name drifted, the shared-db repo is the source of truth.

### 2.1 Customers
- **Read:** `api.crm_customer_list`, `api.customer_list`, `api.crm_customer_overview`,
  `api.crm_customer_segment_list(...)`, `api.crm_customer_segment_counts()`. These expose
  `display_name` (added in `20260717125909_api_customer_views_expose_display_name.sql`).
- **Write / curate:** `api.crm_update_customer(...)`, `api.crm_set_customer_logo(...)`.
- **Merge duplicates:** `core.merge_customer(p_survivor, p_loser)` — folds loser's aliases +
  source refs + CRM links into survivor. Aliases live in `core.customer_alias`.
- **Match / de-dupe helper:** `core.match_customer(...)`.
- **Status values:** `active | potential | inactive` (`20260717122237_core_entity_status_add_potential.sql`).

### 2.2 Vendors / Factories
- **Read:** there is **no `api.*` factory view yet** — this is a known gap. Today apps read
  `core.factory` directly. **Part of this task is deciding whether to add `api.factory_list`
  (recommended, for RLS parity with customers) or to read `core.factory` under RLS.** The
  factory schema (display_name, `core.factory_alias`, `core.merge_factory`) shipped in
  `20260717192922_core_factory_ext_alias_merge.sql` (PR #102, merged, commit `14da5c5`).
- **Merge duplicates:** `core.merge_factory(p_survivor, p_loser)`.
- **Canonical link to a customer:** `core.factory.company_id → core.customer(id) ON DELETE SET NULL`
  (a factory can also be a customer, e.g. a supplier you also sell to).
- **Source ref:** `core.factory_source_ref` (note: it lacks a `source_name` column that
  `company_source_ref` has — cosmetic, don't block on it).

### 2.3 Licensors → Properties (the headline relationship — see §3)
- **Tables:** `core.licensor` (20) → `core.property` (256) with a **strict FK**
  `core.property.licensor_id → core.licensor(id)` (`20260621150815_app_core.sql`). Below
  properties: `core.character`.
- **Read:** there is **no dedicated `api.*` licensor/property view yet** — another gap this
  task should close. Recommended: add `api.licensor_list` and `api.property_list` (or a
  single `api.licensor_property_tree`) so the frontend never reads `core.*` directly. Until
  then, read `core.licensor` / `core.property` under RLS.
- **Source ref:** `core.taxonomy_source_ref` (polymorphic — `entity_schema/entity_table/entity_id`;
  it cannot enforce a real FK, so treat it as display-only metadata).
- **Feeder job:** `plm.import_master_data()` (fed by `tools/sync-plm-master-data.mjs`) is what
  populates licensors/properties from DesignFlow PLM. Note: that sync's upstream endpoint is
  currently returning 502 — see shared-db `HANDOFF.md`. The Admin page reads whatever is in
  `core.*`; it does not call the sync.

> **If you add any new `api.*` view or `core.*` RPC, it MUST be authored in `u2giants/shared-db`
> (branch + PR, preview-first, merged there) BEFORE popcrm-web code depends on it.** Never add a
> migration in popcrm-web. This is a hard rule (see shared-db `AGENTS.md`).

---

## 3. Licensors → Properties: what the screen must show (Albert asked for this explicitly)

This is the centerpiece. The page must make the **parent→child relationship visible and navigable**:

- A **master list of Licensors** (20) — each row: display name, # of properties, active/inactive.
- Selecting a licensor reveals its **Properties** (children) — a tree or master/detail:
  ```
  ▸ Marvel  (licensor)  — 34 properties
      • Avengers
      • Spider-Man
      • X-Men
  ▸ Disney  (licensor)  — 21 properties
      • Frozen
      • ...
  ```
- Each Property row shows: name, its Licensor (breadcrumb), source ref (which PLM code it came
  from), and — nice-to-have — its child Characters count.
- **Read-only is acceptable for v1** of the relationship view (the relationship is owned by
  DesignFlow PLM; we mirror it). Editing the licensor↔property edge is explicitly OUT of scope
  unless Albert asks — Coldlion/PLM owns that edge. What v1 must nail is *visibility*: Albert
  can finally see the whole tree and confirm it's correct.
- Guard: because `core.property.licensor_id` is a strict FK, every property has exactly one
  licensor — render orphans (should be zero) loudly if any appear.

---

## 4. Customers & Vendors: what the screen must do

For each of Customers and Factories, the Admin page provides a curation grid:
- **List** with display name, status (active/potential/inactive), source badge (Coldlion/CRM),
  and alias count.
- **Rename** the `display_name` (customers via `api.crm_update_customer`; factories via the
  equivalent — add an `api.update_factory` RPC in shared-db if none exists yet).
- **Change status** active/potential/inactive (respecting app-owned status — this is a user
  action, which is allowed; only *re-pulls* must not clobber it).
- **Merge two duplicates** → call `core.merge_customer` / `core.merge_factory`. UI: pick a
  survivor + a loser, show a confirm dialog listing what will fold in (aliases, source refs,
  linked records), then call the RPC. This is the visible payoff for the merge functions.
- **View aliases & source refs** in a detail panel (read-only).
- **Hide inactive by default**, with a toggle to show them.

---

## 5. ⚠️ The cutover-safety gate (this answers "are you 100% sure nothing breaks?")

**We are NOT 100% sure, and this task must not assume it.** Before/while wiring the Admin page
to the canonical tables, run this verification in the popcrm-web repo (and note it for popdam):

1. `grep -rn "erp_items_current\|erp_customer\|erp_vendor\|prod_order_" src/` — find any code
   still reading the **legacy `public.erp_*` mirror** instead of the canonical/`api.*` layer.
2. `grep -rn` for any place customers/vendors are matched **by name string** rather than by id
   or source code — those are the ones a rename or merge can silently break.
3. Confirm every read goes through `api.*` (or the sanctioned `core.*` RPCs). Anything reading
   `core.*` tables directly should be flagged.
4. For each duplicate that has been merged, confirm the **loser's** old id/code still resolves
   (via alias/source ref) so any app holding the old identifier doesn't 404.

If any of 1–3 turns up a legacy or name-based reference, **fix that reference before relying on
the canonical data in production**, and report it back to the shared-db owner. This is the
concrete meaning of "scratch every nook" — do it with grep, per app, not by assumption.

---

## 6. How to run popcrm-web locally to verify visually (do not skip)

Per Albert's standing rule #14: verify UI work visually before reporting done. popcrm-web needs
the Supabase backend to render. Use a dev-server proxy so the browser only talks to `localhost`
and CORS never blocks:
- Serve the local UI and proxy `/api/*` (and the supabase-js calls) to the **preview** Supabase
  project, not production, while developing.
- Take screenshots of: the Licensor→Property tree, the Customer grid, the Vendor grid, and a
  merge confirm dialog. Attach them to the PR.
- Supabase client config: `get_project_url` + publishable key from the shared-db project
  (`qsllyeztdwjgirsysgai`); use the **preview** branch project for dev.

---

## 7. Acceptance criteria (definition of done)

- [ ] An **Admin** nav entry gated to authorized users (reuse popcrm-web's existing auth/roles).
- [ ] **Licensors → Properties tree** renders all 20 licensors and 256 properties with correct
      parent→child nesting and source refs. Screenshot attached.
- [ ] **Customers** grid: list, rename display name, change status, view aliases/source refs,
      and **merge** two records via `core.merge_customer`. Screenshot attached.
- [ ] **Vendors/Factories** grid: same capabilities via `core.merge_factory`. Screenshot attached.
- [ ] Any new `api.*` view / `core.*` RPC was authored and merged in **shared-db first** (link the PR).
- [ ] §5 cutover-safety grep pass done; findings recorded; no legacy `public.erp_*` or name-based
      lookups remain in the paths this page touches.
- [ ] All new frontend logic has unit tests (Albert rule #13).
- [ ] Verified visually against the requirement, not just "compiles."

---

## 8. What we tried that did NOT work / known traps (mandatory section)

- **Reading `core.*` directly from the browser** was the original shortcut for the picker — it
  works but bypasses the `api.*`/RLS contract. For a full Admin CRUD surface, add proper `api.*`
  views/RPCs in shared-db instead of widening direct `core.*` grants.
- **RLS ≠ table privilege.** When popcrm-web writes a table directly via supabase-js and gets
  `permission denied for table X (42501)`, the cause is a missing `grant insert/update/delete
  ... to authenticated`, NOT RLS (an RLS rejection reads `new row violates row-level security
  policy`). See `docs/app-migration-notes/popcrm-web-20260716.md`. Pair every new writable table
  with an explicit grant.
- **There is no `api.*` factory/licensor/property view yet.** Don't assume one exists; you will
  likely author them (in shared-db) as part of this task.
- **Do not let a re-pull overwrite curated status/display names.** Status is app-owned by design.
- **`core.taxonomy_source_ref` is polymorphic** and cannot be a real FK — treat as display metadata.

## 9. Key references (all in `u2giants/shared-db`)
- `HANDOFF.md` — top-level "where are we."
- `docs/merch-group-taxonomy-architecture.md` — authority on Coldlion/DesignFlow/Supabase ownership.
- `docs/app-migration-notes/coldlion-customers-vendors-20260715.md` — the customer/vendor canonicalization.
- `fix_schema_for_api.md` — the ERP mirror relocation + item→taxonomy plan (related flow; see §5 gate).
- `fix_vendor_review.md` — vendor de-dup + status seeding (in progress).
- Migrations: `20260717192922_core_factory_ext_alias_merge.sql`, `20260717123020_core_merge_customer_fn.sql`,
  `20260716143231_core_customer_alias.sql`, `20260717125909_api_customer_views_expose_display_name.sql`,
  `20260621150815_app_core.sql` (licensor/property FK).
