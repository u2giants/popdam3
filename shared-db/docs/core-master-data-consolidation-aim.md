# Aim: consolidated scrape results in `core.*`, ColdLion mapped onto them

**Written:** 2026-08-13
**Owner ruling:** Albert Hazan, 2026-08-13, recorded here as the target-state
statement for licensor/property/character/asset/style-guide master data.
**Repository:** `u2giants/shared-db` (canonical; mirrored read-only into every
consumer repo's `shared-db/` folder, including the six `popcre/designflow-*` PLM repos).
**Screen:** DB Data Admin, `https://data.designflow.app` (`apps/db-data-admin/`).

This document states the **destination**. It does not authorize a migration, a
data load, or a cutover. Each step below still goes through the normal gates:
structure through a `db-work` GitHub issue and the orchestrator (`AGENTS.md` §0.0),
curated Master Data loads through §6.4.

---

## 1. The aim in one paragraph

Every licensed-source scrape we run — Disney (OPA / DCP Vault), NBCUniversal
(Creative Asset Factory), Paramount (Creative Library), Warner (STARLABS), and
any portal added later — is consolidated and loaded into the canonical tables
`core.property`, `core.character`, `core.style_guide`, and the canonical asset
table. That consolidated set is the **complete universe** of properties we know
about, far larger than the set we currently transact on. The ColdLion ERP API
then supplies the **operational subset**: the properties Edge Home actually
buys, sells, and ships against. Each ColdLion property is **mapped** onto the
correct row in the big canonical `core.property` table — automatically first,
then by human review for whatever automation cannot resolve. Every canonical
property that ColdLion does **not** carry is set **inactive**. The mapping
function is exposed as a screen on `https://data.designflow.app`, and
`app.profile` `8f383a14-f303-4890-90a2-80306a2d4665` is granted access to operate it.

## 2. Why this shape

- The portals are the **authority on what a property IS** — its real name, its
  characters, its style guides, its artwork. They carry no knowledge of what we
  sell.
- ColdLion is the **authority on what we transact** — it carries our merch-group
  codes, and every item, order, and SKU keys off them. It carries no characters,
  no assets, no style guides, and (measured live, 2026-08-13) no parent
  licensor edge and no active/inactive flag.
- Neither side can be the single master. The canonical `core.*` tables are the
  master; both sides attach to them by source reference.
- "Inactive" is therefore a **derived operational state**, not a source fact:
  it means *not currently carried in ColdLion*, not *not a real property*.

## 3. Target model

```text
Disney / NBCU / Paramount / Warner scrapes        ColdLion ERP API
  plm.<source>_property / _character /              merchGroupDetails
  _asset / _style_guide  (faithful mirrors)         (mgTypeCode 05/06)
            |                                              |
            | consolidate + de-duplicate                   | mirror
            v                                              v
   core.property  core.character                    plm.erp_property
   core.style_guide  <canonical asset>              plm.erp_licensor
            |                                              |
            +------------ MAPPING ------------------------+
                 automated pass, then manual review
                              |
                              v
             core.property.status: active where ColdLion
             carries it, inactive where it does not
```

Rules the model must keep:

1. **One canonical row per real-world property.** Duplicates across portals are
   merged, never stored twice.
2. **Provenance is never lost.** Every canonical row keeps a
   `core.taxonomy_source_ref` entry per contributing source, keyed by that
   source's own composite key. ColdLion's key is
   `companyCode/divisionCode/mgTypeCode/mgCode` — never `mgCode` alone, which is
   unique only within a division and type.
3. **The licensor -> property edge stays a single foreign key**
   (`core.property.licensor_id`). Measured 2026-08-13 across all DesignFlow
   divisions: 503 parent edges, 261 distinct properties, **zero** properties with
   two different licensors. It is a true one-to-many. A junction table would be
   denormalization, not normalization, and must not be introduced.
4. **Status is curated in Supabase**, driven by the ColdLion mapping. It is never
   read from a source system, because no source system supplies it.
5. **Licensed source rows never leave their approved private repository.**

## 4. The mapping function

Exposed as a screen in DB Data Admin (`apps/db-data-admin/`), alongside the
existing Licensors and Properties tabs.

**Automated pass.** Proposes a canonical `core.property` for each ColdLion
property. Signals, strongest first: an existing `core.taxonomy_source_ref` for
the same ColdLion composite key; exact normalized name match; alias match via
`core.property_alias`; fuzzy name match above a configured threshold. Every
proposal is stored with its score and its reason. **Nothing auto-commits above
the configured confidence floor without a recorded decision** — the same
matched-row abstention rule that governs §6.4 loads.

**Manual pass.** Everything the automated pass leaves unresolved or low-confidence
appears in a review queue: ColdLion row on one side, ranked canonical candidates
on the other, with accept / choose-another / create-new / mark-not-a-property.
Every decision is written to the DB Data Admin audit event store and is
reversible.

**Deactivation.** Once mapping for a cycle is complete, canonical properties with
no accepted ColdLion mapping are set `inactive`. This is a reversible status
change, never a delete, and it must be a reviewable proposed list before it is
applied — a ColdLion pull that silently short-returns must never be able to
deactivate the catalog. The existing short-pull floors and maximum-count-drop
guards in `tools/sync-coldlion-licensors-properties.mjs` apply.

## 5. Access

`app.profile` `8f383a14-f303-4890-90a2-80306a2d4665` is to be granted access to the mapping screen.

DB Data Admin authorizes through `app.require_db_data_admin_access()`, which
requires **both**:

- the `administrator` role (`app.user_role` -> `app.role`), and
- explicit `admin` application access (`app.app_access`, `revoked_at is null`).

As of 2026-08-13 that profile is active with the `Designer` role and `crm` access
only, so both grants are outstanding.

**Owner ruling, 2026-08-13: do not grant that profile `administrator`.** The person
who runs the mapping screen is a licensing manager, not a company-wide
administrator. Administrator carries the whole DB Data Admin surface — Customers,
Vendors, merges, product depth — and every other screen gated on
`app.has_role('administrator')`.

The `licensing` role already exists in `app.role` and in the `app_role` enum; it is
simply not wired to anything in DB Data Admin. The wiring needed:

1. A narrower gate — `app.require_licensing_manager_access()` — satisfied by either
   `administrator` **or** `licensing`, plus explicit application access.
2. The mapping and Licensor/Property read RPCs gated on that narrower function
   instead of `app.require_db_data_admin_access()`. Customers, Vendors, merge and
   product-depth RPCs keep the administrator gate unchanged.
3. The DB Data Admin tab strip showing only the permitted tabs for a licensing
   manager, with the server gate remaining the real boundary — a hidden tab is not
   a permission.
4. An `app_access` value for the licensing surface, so a licensing manager never
   needs the blanket `admin` grant.

Tracked as a `db-work` issue; the gate function is structure and goes through the
orchestrator. Every grant is recorded in the DB Data Admin audit store.

## 6. Current state, measured 2026-08-13

Live ColdLion (`x5.coldlion.com/EhpApi`, licensed divisions `CW001` and `SP001`):

| Fact | Value |
|---|---|
| Licensors | 28 distinct (identical in both divisions) |
| Properties | 300 distinct (identical in both divisions) |
| Parent licensor edge | **not supplied** — no such field |
| Active/inactive flag | **not supplied**; `mgCategory` empty on every row |
| Most recent change | 2026-08-11 |

Canonical Supabase: 26 licensors, 256 properties, 256 parent edges, 0 orphans.
The DesignFlow feeder that populated it has never recorded a run in
`ingest.sync_run`; `plm.licensor_import` and `plm.property_import` are empty. The
Licensors and Properties tabs therefore serve a one-time June 2026 snapshot.

Gap between live ColdLion and canonical: 48 ColdLion properties absent from
`core.property` (42 of them created in ColdLion after the canonical load), 9
ColdLion licensors absent, 7 canonical licensors and 4 canonical properties
absent from ColdLion. Against the DesignFlow mirror the canonical edge set is
missing 5 properties (`CHR`, `EX`, `GW`, `LB`, `SGT`) and disagrees on one
(`CC`: canonical `DY`, DesignFlow `ZZ`).

## 7. Sequence

1. Reconcile the canonical licensor -> property edge against the DesignFlow
   mirror (5 additions, 1 disagreement). Curated Master Data — §6.4 gate.
2. Complete the ColdLion source cutover already planned in
   [`fix_coldlion_licensor_property_cutover.md`](../fix_coldlion_licensor_property_cutover.md)
   and [`plan_coldlion_licensor_property_accelerated_cutover.md`](../plan_coldlion_licensor_property_accelerated_cutover.md).
   Do not restart that plan; read its STATUS table.
3. Consolidate the portal scrapes into `core.property` / `core.character` /
   `core.style_guide` / canonical asset. Structure — `db-work` issue.
4. Build the mapping function and its review queue. Structure plus app work.
5. Expose it in DB Data Admin and grant `app.profile` `8f383a14-f303-4890-90a2-80306a2d4665`.
6. Turn on ColdLion-driven deactivation, proposed-list-first.

## 7a. What a ColdLion refresh is allowed to touch (owner ruling, 2026-08-13)

A ColdLion pull is **additive and column-scoped**. It is not a replacement of the
canonical tables, and reading it as one has already produced one over-stated risk
assessment.

| Column | ColdLion refresh |
|---|---|
| `name`, `code`, source/division context | **may write** — ColdLion is the authority |
| `licensor_id` (parent edge) | **never touched** — curated, seeded from DesignFlow |
| `status` (active/inactive) | **never touched by the pull** — curated; only the reviewed deactivation pass in §4 may change it |
| existing rows absent from ColdLion | **never deleted, never auto-deactivated by the pull** |
| new rows present only in ColdLion | inserted, landing in a review state, never silently `active` |

Consequences worth stating plainly, because each was previously described as a
loss:

- **The parent edge survives every future pull.** It lives in
  `core.property.licensor_id`, seeded once from DesignFlow's `parent_id`. ColdLion
  not supplying it is a reason it must never be overwritten, not a reason it
  disappears.
- **Active/inactive survives every future pull**, for the same reason.
- **Canonical-only licensors and properties survive.** Rows ColdLion does not carry
  (for example `FRIENDS TV`, `NFL`, `NCAA`, `ADVENTURE TIME`) stay exactly as they
  are. Additive means additive.
- **ColdLion rows we did not previously carry are correct data**, including the
  advertising/automotive `- DESPERATE` merch groups. They are real merch groups and
  belong in the canonical set.

**Key discipline.** Match on the full composite key
`companyCode/divisionCode/mgTypeCode/mgCode`, never on `mgCode` alone. With the type
component included, ColdLion's reuse of a short code across a licensor and a
property is harmless: `FR` as a licensor and `FR` as a property are two different
keys and can never collide. Note that `mgCode2` and `itemNoCode` are **not** better
keys — measured live 2026-08-13, `mgCode2` has only 264 distinct values across 300
property rows, because it is a legacy two-character code that several rows share
(`AM1` and `AM2` both carry `AM`).

## 8. What this document does NOT change

- ColdLion does not become authoritative for the parent edge or for status.
- Portal scrapes do not become authoritative for what we transact.
- `core.property.licensor_id` stays a single foreign key.
- No step here is authorized by this document alone.
