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

## 1a. Scrapes win. Owner ruling, 2026-08-13.

**A licensor-portal scrape is canonical. It comes straight from the source.**

When a scrape and an internal system disagree about what a property is called,
which characters belong to it, which style guides or assets exist for it, or which
licensor owns it, **the scrape is right and the internal record is corrected to
match**. DesignFlow and ColdLion are our own bookkeeping; Disney, NBCUniversal,
Paramount and Warner are the licensors themselves. A code typed into an ERP years
ago does not outrank the licensor's own portal.

Practical consequences:

- A scrape-sourced name replaces an ERP-sourced name on conflict, and the ERP
  spelling is kept as an alias, never as the canonical value.
- A scrape-sourced property -> licensor attribution replaces a DesignFlow
  `parent_id` attribution on conflict. DesignFlow seeds the edge only where no
  scrape covers it.
- Characters, style guides and assets have **no** internal authority to compete
  with: they exist only in the portals, so the scrape is the only source.
- Where the two agree, nothing changes and no review is needed.

**The limits of the rule.** It settles *identity and relationships*, not *what we
transact*. Whether a property is `active` still comes from the ColdLion mapping
(§4), because no portal knows what Edge Home currently sells. And a scrape only
carries authority for its own licensor's properties — the Warner scrape says
nothing about a Disney title.

### Scrape coverage, measured 2026-08-13

> ⚠️ **Counting `plm.dcp_property` / `plm.wb_property` and concluding "the scrape
> landed nothing" is WRONG, and an AI session did exactly that on 2026-08-13.**
> The capture-scoped `<source>_property` / `<source>_character` tables are source observations.
> Durable Paramount and NBCU source-to-canonical decisions live in
> `plm.source_resolution`, keyed without a capture ID, and are written only through
> `plm.set_source_resolution()`. A refresh therefore cannot replace a human decision.
> Older source-table resolution columns remain only as guarded compatibility fields.
>
> The source tables may still participate in **resolution** reads —
> they hold entities already reconciled to a canonical `core.*` row. They are empty
> for Disney because the resolution pass has not been run, **not** because the
> scrape has no data. Disney has 156,644 assets loaded.
>
> **Never guess which table a loader wrote to. Ask:**
>
> ```sql
> select * from api.source_capture_inventory order by source_system, row_count desc;
> ```
>
> Exact live counts for every `plm` landing table, grouped by source, built from the
> catalog so a new scrape's tables appear automatically. The numbers in the table
> below are a dated snapshot; that view is always current. Note its
> `carries_resolution` column describes the table's *shape* — it never tells you
> whether a scrape ran.

| Source | Assets | Properties | Characters | Style guides |
|---|---|---|---|---|
| **Disney** (OPA + DCP Vault) | **156,644** `dcp_asset` | **1,444** distinct in `opa_property_character` | **9,591** distinct in `opa_property_character` | **2,967** `dcp_style_guide` |
| **Paramount** (Creative Library) | 119,304 `pmt_asset` | 254 `pmt_property` | 228 `pmt_character` | 1,928 `pmt_collection` |
| **NBCU** (Creative Asset Factory) | 113,331 `nbcu_asset` | 249 `nbcu_property` | 190 `nbcu_character` | 461 `nbcu_style_guide` |
| **Warner** (STARLABS) | **0** | **0** | **0** | **0** |

Disney also holds 198,753 asset-to-tile observations, 11 portal tiles, and a
complete crawl and chunk ledger.

**Three separate gaps, and they are not the same problem:**

1. **Warner has genuinely landed nothing.** Every `plm.wb_*` table is empty. This
   is the one true "the loader was never written" case among the four
   (issue #900).
2. **Disney has landed richly but is NOT normalized.** `plm.dcp_property`,
   `plm.dcp_character`, `plm.dcp_asset_property_observation` and
   `plm.dcp_asset_character_observation` are all empty, and the Disney
   property/character universe currently exists only as **names** inside
   `plm.opa_property_character`. Until those names are resolved into entities,
   Disney data cannot participate in the scrapes-win rule or in consolidation,
   even though the raw capture is complete.
3. **Nothing has reached canonical yet.** `core.style_guide` and `dam.asset` are
   both empty for every source. Consolidation into `core.*` has not started.

So the rule is sound, and for Disney, Paramount and NBCU the source data to enforce
it with is genuinely present. What is missing is the resolution and consolidation
work between the landing tables and `core.*` — plus Warner entirely. Do not read
this rule as "the scrapes have already corrected everything", and do not read an
empty resolution table as "the scrape never ran".

**Paramount was schema-audited on 2026-08-14** (plan_pmt-duplicate-name-columns.md
and its two sibling plans). The schema is the strongest of the four; the audit's
findings are being fixed in stages. One fix is authored in the repository tree but has
not been applied to any database — migration `20260814193351`: two
non-entity tables carried a duplicated copy of the property name —
`plm.pmt_authorized_title_property.paramount_property_name` and
`plm.pmt_property_capture_log.property_name`. Migration `20260814193351` makes both
nullable, stops both writers (the client loader and `plm.load_pmt_capture_chunk`)
and drops `idx_pmt_atp_name`; the property name is read by joining
`plm.pmt_property` on `(capture_id, property_source_id)`. The columns themselves
are dropped (or renamed, if one proves to be a distinct fact) by a later migration
once the plan's Step 1 evidence is read. Note also that the Paramount asset figure
in the table above counts every retained capture, including two failed ones — see
the 2026-08-14 handoff for the per-capture breakdown.

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

**Status: SHIPPED to production 2026-08-13.** Migration
`20260814000000_licensing_manager_gate.sql` added
`app.require_licensing_manager_access()` and re-gated
`api.db_data_admin_licensor_property_tree` onto it. Application access is accepted
from `admin` (administrators keep working with no regrant) or `plm`; no new
`app_name` enum value was needed. Customers, Vendors, all merge RPCs and all
product-depth RPCs are unchanged on the administrator gate. No front-end change
was required — DB Data Admin already scopes a denial to the panel, so a licensing
manager opening Customers gets the existing Access denied panel from the server
gate, which is the real boundary.

Profile `8f383a14-f303-4890-90a2-80306a2d4665` was granted the `Licensing` role and
`plm` application access on production the same day. It was **not** granted
`administrator` or `admin`. Every grant is recorded in the DB Data Admin audit
store.

## 5a. Settled questions — read this before re-deriving any of them

Six conclusions reached with the owner on 2026-08-13, each after a wrong or
overstated first answer from an AI session. They are settled. Do not re-open them,
and do not repeat the mistaken framing.

**1. The parent edge is not lost when ColdLion becomes the source.** It lives in
`core.property.licensor_id`, seeded once from DesignFlow and never written by a
ColdLion pull. ColdLion not transmitting a parent field is the reason that column
must be protected, not evidence that the relationship disappears. Nothing new has
to be built to make it persistent — the column already exists and is already
populated for every row.

**2. Active/inactive is not lost either**, for the same reason: `status` is its own
curated column and the pull does not write it. The one genuine care point is a
**new** ColdLion row, which arrives with no status of its own. It must land in a
review state and must never default to `active`, or lapsed licenses (NASA, ZAG,
FRIDA KAHLO — all still returned by the live API with no end marker) silently
reappear as live.

**3. ColdLion's extra merch groups are correct data.** The advertising and
automotive `- DESPERATE` groups (Budweiser, Camaro, Corvette, Pabst, Miller Light
and the rest) are real merch groups and belong in the canonical set. An earlier
session described them as noise. They are not.

**4. A ColdLion pull adds; it never removes.** Canonical licensors and properties
ColdLion does not carry — `FRIENDS TV`, `NFL`, `NCAA`, `ADVENTURE TIME` and the
rest — stay exactly as they are. "Losing" them was only ever a risk of building the
sync as a replace, which §7a now forbids in writing.

**5. Short-code reuse is not a hazard, because the key is not the short code.**
The match key is `companyCode/divisionCode/mgTypeCode/mgCode`. Type is part of it,
so `FR` as a licensor and `FR` as a property are two distinct keys that cannot
collide. And there is no better code field available: ColdLion also sends
`mgCode2` and `itemNoCode`, but both are a legacy two-character code that is
**less** unique than `mgCode` — measured live 2026-08-13, 300 property rows carry
only 264 distinct `mgCode2` values, because for example `AM1` and `AM2` both
carry `AM`.

**6. Seed the edge from LIVE DesignFlow, never from the Supabase copy of it.**
The `dflow.*` schema in Supabase is a mirror whose newest row changed
**2026-06-26** — one day after the canonical tables were built, and seven weeks
stale. Seeding from it would rebuild the exact staleness this programme exists to
fix. Read DesignFlow production directly: Google Cloud SQL instance
`creatiflow-database` in GCP project `lithe-breaker-323913`, database `postgres`,
**schema `designflow`** (not `dflow` — that is the Supabase-side name and querying
it there fails), read-only user `albert_read_only`, credentials in 1Password.
Access is IP-allowlisted.

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
absent from ColdLion.

**Live DesignFlow production** (Cloud SQL `creatiflow-database`, schema
`designflow`, read 2026-08-13; newest row 2026-08-11, so genuinely current):

| Fact | Value |
|---|---|
| Parent edges (`merchGroup` type 06 -> type 05) | 513 |
| Distinct properties carrying an edge | 266 |
| Properties with two different licensors | **0** |

The zero is the important number, and it holds on live data, not just on the
stale mirror: the licensor -> property relationship is a true one-to-many, so
`core.property.licensor_id` as a single foreign key is the correct model and a
junction table would be wrong.

Canonical is missing **10** of those 266 edges, not the 5 the stale Supabase
mirror suggested:

| Property | Live parent | Note |
|---|---|---|
| `CHR` CHEERS | `VM` | also in live ColdLion |
| `EX` THE EXORCIST | `WB` | also in live ColdLion |
| `LB` THE LOST BOYS | `WB` | also in live ColdLion |
| `SGT` SUPERGIRL THEATRICAL 2026 | `WB` | also in live ColdLion |
| `MY` THE MUMMY | `NB` | also in live ColdLion |
| `DCR` COORS - DESPERATE | `DMC` | licensor `DMC` is itself absent from `core.licensor` |
| `DHM` HAMMS - DESPERATE | `DMC` | same |
| `DMT` MILLER LIGHT - DESPERATE | `DMC` | same |
| `DPB` PABST BLUE RIBBON - DESPERATE | `DMC` | same |
| `GW` OVER THE GARDEN WALL | `WB` | **not a new property** — canonical already holds this title under code `OGW`. Live DesignFlow carries both `GW` and `OGW` pointing at `WB`. Treat as a duplicate-code merge, not an insert. |

`DMC` (MILLER / COORS - DESPERATE) must be created in `core.licensor` before its
four properties can be linked, because `licensor_id` is `NOT NULL`.

One disagreement: `CC` (COCO) — canonical `DY` (DISNEY), live DesignFlow `ZZ`
(DTR - NO LICENSE).

**RESOLVED — owner ruling, Albert Hazan, 2026-08-13: COCO belongs under DISNEY.
The `ZZ` parent is a mistake in the upstream record, not a commercial statement.**

Canonical `core.property` is therefore **already correct** and must not be changed.
No data fix is required on our side; the correction is owed upstream (§6a).

Investigation behind the ruling: it is not a duplicate. Live DesignFlow holds
exactly one COCO per licensed division (`mg_id` 1728 in CW001, 1966 in SP001),
both active and both parented to `ZZ`. There is no second, Disney-parented COCO
anywhere in DesignFlow, and `core.property` holds exactly one COCO row.

The ruling stands on the owner's knowledge of the title. The Disney scrape could
not be used to settle it — not because it is empty (it is not; see §1a), but
because its properties are still only names in `plm.opa_property_character` and
have not been resolved into entities that could be matched against `CC`. Once that
resolution runs, COCO should be confirmed against the Disney source as a check on
this ruling rather than treated as settled forever.

Incidental illustration of the composite-key rule (§5a.5): in the same division,
`CC` is *both* a licensor code (COCA COLA, inactive) and a property code (COCO,
active). Only the type component keeps them apart.

`DMC` is real and current on both sides: live DesignFlow carries it as an **active**
licensor in both licensed divisions with 4 children each, and the live ColdLion
pull returns it as a licensor (`MILLER / COORS - DESPERATE`, `mgTypeCode` 05) in
both divisions along with all four of its properties. It is missing from
`core.licensor` only because the June snapshot predates it.

No canonical property is missing from live DesignFlow, and there are no orphans.

## 6a. Corrections owed upstream. Owner ruling, 2026-08-13.

**When we establish that a source system is wrong, correcting our canonical row is
only half the job. A human who can edit that source has to be told, so the error is
fixed where it originates.** Otherwise every future pull re-presents the same bad
value, every future reconciliation re-raises the same finding, and the canonical
correction has to be defended forever.

This is a standing obligation, not a one-off for COCO.

### Which system actually needs correcting — check before you send

**The parent licensor edge is NOT a ColdLion field.** Verified 2026-08-13 against
the live API: `merchGroupDetails` returns exactly
`createdTime, createdUser, modTime, modUser, companyCode, divisionCode,
mgTypeCode, mgCode, mgDesc, itemNoCode, mgCategory, mgCode2` — no parent, no
licensor reference. The full published endpoint list is `/customers`, `/inventory`,
`/itemDetails`, `/itemImages`, `/items`, `/merchGroupDetails`,
`/merchGroupHeaders`, `/order`, `/pickticket`, `/prepackDetail`, `/proddetails`,
`/prodtracking`, `/receiving`, `/salespersons`, `/seasons`, `/vendors` — **there is
no relationship, parent or hierarchy endpoint at all.** And
`designflow-data-syncing` declares `parent_id` on its `merchGroup` model but never
writes it from any sync path.

So a wrong parent is a **DesignFlow** record and must be corrected in DesignFlow.
Routing it to whoever maintains ColdLion would be a wasted request. Route by field:

| Wrong value | Correct it in |
|---|---|
| Parent licensor of a property | **DesignFlow** |
| Property or licensor name (`mgDesc`) | **ColdLion** |
| Merch-group code (`mgCode`), division, type | **ColdLion** |
| Whether we currently sell it (active/inactive) | **Neither** — curated here (§4) |
| Characters, style guides, assets | **Neither** — the licensor portal is authoritative (§1a) |

For a ColdLion-side correction, the row's own `createdUser` / `modUser` names the
person who last touched it and is the best routing hint available. Across the 300
live CW001 properties those are `JSeguine` (226), `JAshley` (68), `Jcoleman` (5)
and `SGhosh` (1).

### The register

Each finding is recorded with: the entity and its composite key, the wrong value,
the value we believe correct, the evidence, **which system owns the fix**, who was
notified and when, and whether the source has since been corrected. A finding is
closed only when a fresh pull shows the source agreeing — never when the message
is sent. `plm.taxonomy_resolution_review` already models the finding itself and
has a `conflict` status; it has no notification or upstream-fix state, so those
columns are the schema work this needs. That table is owned by the ColdLion
cutover workstream, so the change goes through a `db-work` issue rather than being
added ad hoc.

### Open items

| Entity | Key | Source says | Correct value | Fix belongs in | Status |
|---|---|---|---|---|---|
| Property `CC` COCO | `EDGEHOME/CW001/06/CC` and `.../SP001/06/CC` | parent `ZZ` DTR - NO LICENSE | parent `DY` DISNEY | DesignFlow | **CLOSED — no upstream push** |

**COCO is closed, 2026-08-13.** Owner ruling: because the wrong value is not in
ColdLion, correcting it here is enough. `core.property` already carries `DY` and is
authoritative, so no message is owed and no data change is needed.

The reason that is safe, and the condition under which it stops being safe: a
ColdLion pull never writes `licensor_id` (§7a), so DesignFlow's `ZZ` cannot
propagate into canonical on a refresh. **But if a DesignFlow-sourced edge seed is
ever run again, it will silently reintroduce `ZZ`.** Any such seed must therefore
skip properties whose canonical parent was set by an owner ruling. Record those, or
this correction gets undone the next time somebody reseeds.

There are no other open items.

## 7. Sequence

1. Reconcile the canonical licensor -> property edge against **live** DesignFlow
   (9 additions, 1 duplicate-code merge, 1 new licensor, 1 disagreement awaiting
   an owner decision — see §6). Curated Master Data — §6.4 gate. Read live Cloud
   SQL for this, not the Supabase `dflow.*` mirror (§5a.6).
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
