# The duplicate Disney licensor identity — census, evidence and options

**Status: READ-ONLY INVESTIGATION. No migration was written. No database write
was made. Nothing under `supabase/` was touched. Nothing is decided here.**

**Author:** sub-agent dispatched by the shared-db coordinator (session
`774f5010`, machine `t16`, coordinator marker: GitHub issue #473).
**Branch:** `agent/disney-licensor-identity-20260807`, rebased onto `origin/main`
at `ffb9b97c6368e2a7ff425f4ee1bf3c0066190593` (re-verified immediately before
writing; `main` moved during this run and the move was docs-only).
**Date:** 2026-08-07.

**Database target, proved before the first query.** `get_project_url` returned
`https://qsllyeztdwjgirsysgai.supabase.co`, so every measurement below is against
Supabase project **`qsllyeztdwjgirsysgai` — PRODUCTION**. The Supabase MCP takes
no project argument and is bound to production; the preview project
(`rjyboqwcdzcocqgmsyel`) was never contacted. Every statement issued was a
read-only `select` or catalog query.

**Every row count in this document was measured with `count(*)`.**
`pg_stat_user_tables.n_live_tup` is stale on this database — it reports `0` for
tables holding tens of thousands of rows — and was not used anywhere.

---

## Why this document exists

Phase 1 (`docs/verification/opa-characters-20260806/DESIGN.md`, merged in PR
#476) designed a landing table for Disney's OPA property/character extract. It
could not say which licensor the data belongs to, because our database appears to
hold **two Disney identities**: `DISNEY` code `DY` in `core.licensor`, and
`Disney` code `DS` in `public.licensors`.

Albert ruled that this must be resolved **before** the landing table is built.
This document supplies the evidence. It does not choose. **Choosing the canonical
Disney value is Albert's decision.**

**Read section 6 first if you only read one section.** It is written in plain
English and stands alone.

---

## A retracted claim you must not re-derive

An early revision of the OPA README argued that `dflow.properties_and_characters`
was a stale import of the OPA list, because the row counts were within about 1%.
**That was wrong and was retracted.** Row-count similarity is never evidence of
shared lineage. You will meet a second pair of near-identical shapes below
(`core.properties_and_characters` at 10,122 rows and
`core.property_character_associations` at 9,622 rows, mirroring the `dflow` and
`public` ones). Do not restart that argument.

---

## 1. The full census

### 1.1 What counts as a "licensor-ish" table

Searched `information_schema` across every non-system schema for tables named
like a licensor and for any column named `%licensor%`. The result is that this
database has **exactly two master lists of licensors** and a long tail of tables
that *reference* one of them.

**The two master lists:**

| Table | Rows | Key column | Created |
| --- | ---: | --- | --- |
| `core.licensor` | **26** | `code` | legacy rows `2026-06-25`, "potential" rows `2026-07-23` |
| `public.licensors` | **10** | `external_id` | all rows `2026-03-13` |

**Everything else is a reference, not a master list.** `plm.licensor_import`
(37 rows) and `plm.erp_licensor` (0 rows) are ERP mirrors that *resolve to*
`core.licensor`. `dflow.*` and `designflow.*` carry integer `licensor_id` /
`licensor_id_fk` columns inherited from the old MySQL PLM; they have no licensor
master table of their own in this database. `crm`, `dam` and `pim` all carry
`uuid licensor_id` columns pointing at `core.licensor`.

### 1.2 Every Disney-related row, in every licensor list

| Table | id | Name | Code | Status | Created |
| --- | --- | --- | --- | --- | --- |
| `core.licensor` | `7d141a6f-e229-46a2-b3f5-0ba0c97dd820` | `DISNEY` | **`DY`** | `active` | 2026-06-25 08:44:39 -04 |
| `core.licensor` | `f143c083-2dfd-48b9-ac9b-43d2290a4e4c` | `MARVEL` | `MV` | `active` | 2026-06-25 08:44:39 -04 |
| `core.licensor` | `14f2902d-42de-4820-83c5-e4f359a6e0d6` | `STAR WARS` | `SW` | `active` | 2026-06-25 08:44:39 -04 |
| `core.licensor` | `80276015-a751-4438-8c25-759c8dd005b2` | `DTR - NO LICENSE` | `ZZ` | `active` | 2026-06-25 08:44:39 -04 |
| `public.licensors` | `10a445bc-cdb8-4384-ad6f-a46fd029f2bc` | `Disney` | **`DS`** | (no status column) | 2026-03-13 14:28:35 -04 |
| `public.licensors` | `144f375d-69c5-4ba0-86d5-ffd7bfa2d4cd` | `Marvel` | `MV` | (no status column) | 2026-03-13 14:28:35 -04 |

`public.licensors` has **no Star Wars row at all** and **no `NO LICENSE` row**.
It has no `status` / active flag column — that is a real schema difference, not
an omission in this table.

Confirmed by exhaustive scan of both tables: there is **no third Disney row**, no
`Walt Disney`, no `Pixar`, no `Lucasfilm`, no misspelling.

### 1.3 Children of every `core.licensor` row — measured

`assets` = `public.assets`, `sg` = `public.style_groups`, `props` =
`core.property`, `imp` = `plm.licensor_import`, `bridge` =
`plm.style_tracker_item_bridge`. `pim.product` (17,909 rows) and `pim.project`
(651 rows) both have a `licensor_id` column but **zero rows carry a value** —
every one is null.

| Code | Name | assets | sg | props | imp | bridge |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `DY` | **DISNEY** | **46,255** | 7 | **39** | 2 | **4,048** |
| `MV` | MARVEL | 17,428 | 4 | 29 | 2 | 2,771 |
| `WB` | WARNER BROS | 10,102 | 9 | 41 | 2 | 0 |
| `NB` | NBC | 4,563 | 3 | 31 | 2 | 0 |
| `VM` | VIACOM MULTI | 4,223 | 19 | 18 | 2 | 0 |
| `SE` | SEGA | 3,500 | 0 | 3 | 2 | 374 |
| `PN` | PEANUTS WORLDWIDE | 2,434 | 0 | 1 | 2 | 0 |
| `SS` | STRAWBERRY SHORTCAKE | 1,486 | 0 | 2 | 2 | 0 |
| `CC` | COCA COLA | 632 | 0 | 4 | 1 | 0 |
| `WW` | WWE | 399 | 0 | 4 | 1 | 42 |
| `SW` | **STAR WARS** | 344 | 1 | **28** | 2 | **1,174** |
| `DC` | DC | 296 | 1 | 14 | 2 | 19 |
| `HP` | HARRY POTTER | 112 | 0 | 12 | 2 | 0 |
| `ZZ` | **DTR - NO LICENSE** | **103** | 0 | **5** | 2 | 0 |
| `SM` | SESAME STREET | 77 | 0 | 5 | 2 | 19 |
| `CB` | CARE BEARS | 71 | 0 | 3 | 2 | 72 |
| `X-NASA` | NASA | 65 | 0 | 0 | 0 | 44 |
| `AA` | AARDMAN ANIMATIONS | 40 | 0 | 2 | 2 | 5 |
| `FR` | FRIENDS TV | 13 | 0 | 1 | 1 | 0 |
| `1P` | TOEI - ONE PIECE | 9 | 0 | 6 | 2 | 0 |
| `X-NFL` | NFL | 7 | 0 | 0 | 0 | 0 |
| `X-FORD` | Ford | 5 | 1 | 0 | 0 | 0 |
| `PP` | PAW PATROL | 4 | 0 | 8 | 2 | 0 |
| `X-MILLERCOORS` | Miller Coors | 3 | 0 | 0 | 0 | 0 |
| `X-ANHEUSERBUSCH` | Anheuser Busch | 2 | 0 | 0 | 0 | 0 |
| `X-NCAA` | NCAA | 0 | 0 | 0 | 0 | 0 |

**`DISNEY` (`DY`) is the single largest licensor in the database** by asset
count. It is live, load-bearing production data.

### 1.4 Children of every `public.licensors` row — measured

`public.licensors` has exactly two live child paths: `public.properties`, and
`plm.style_tracker_item_bridge.public_licensor_id`.

| Code | Name | `public.properties` | `public.characters` (via properties) |
| --- | --- | ---: | ---: |
| `WB` | Warner Bros | 154 | 4,090 |
| **`DS`** | **Disney** | **124** | **1,097** |
| `NB` | NBCUniversal | 123 | 0 |
| `MV` | Marvel | 54 | 3,824 |
| `VM` | Paramount | 34 | 0 |
| `SE` | Sega | 6 | 0 |
| `PN` | Peanuts | 2 | 0 |
| `CC` | Coca Cola | 1 | 6 |
| `SS` | Strawberry Shortcake | 1 | 1 |
| `WWE` | WWE | 1 | 604 |

Totals: `public.properties` = 500, `public.characters` = 9,622,
`public.assets` = 136,697, `public.style_groups` = 10,618.

### 1.5 Tables that are empty (so cannot be affected by any change)

Measured with `count(*)`, because the statistics view lies on this database:
`dam.asset` = 0, `dam.style_group` = 0, `dam.style_guide_file` = 0,
`plm.item` = 0, `plm.erp_licensor` = 0, `crm.licensor_approval_thread` = 0,
`core.character` = 0.

**The `dam` and `plm` schemas are built but not yet populated.** PopDAM is still
running out of `public.assets` / `public.style_groups`, and the PLM item tables
are empty. Any consolidation therefore touches far less live data than the number
of tables suggests.

---

## 2. Are `DY` and `DS` the same company, or two different things?

### The answer: they are the same company. This is proved, not inferred.

Four independent pieces of evidence agree, and none disagrees.

### Evidence 1 — the repository's own merged migration says so, in writing

`supabase/migrations/20260723113000_dam_core_licensor_property_cutover.sql`
(commit `7c8034c`, "feat: move DAM licensor and property links to core",
2026-07-22) contains this mapping, which is already merged and already applied to
production:

```sql
where lower(c.code) = lower(
        case legacy.external_id
          when 'DS' then 'DY'
          when 'WWE' then 'WW'
          else legacy.external_id
        end
      )
```

That migration then **aborts loudly** if any legacy licensor fails to map:

```sql
if v_unmapped <> 0 then
  raise exception 'DAM core taxonomy cutover aborted: % legacy licensors have no canonical core.licensor match', v_unmapped;
end if;
```

It did not abort. So all ten `public.licensors` rows mapped, `DS` mapped to `DY`,
and **136,697 `public.assets` rows plus 10,618 `public.style_groups` rows were
rewritten to canonical `core.licensor` UUIDs on that basis.** This is not an
opinion; it is a decision that was made, reviewed, merged and executed three
weeks ago, and the current production data depends on it being right.

### Evidence 2 — the code space is shared; only two codes ever diverged

Comparing the two lists code by code:

| `public.licensors` | code | `core.licensor` | code | Agree? |
| --- | --- | --- | --- | --- |
| Coca Cola | `CC` | COCA COLA | `CC` | yes |
| Marvel | `MV` | MARVEL | `MV` | yes |
| NBCUniversal | `NB` | NBC | `NB` | yes |
| Paramount | `VM` | VIACOM MULTI | `VM` | yes |
| Peanuts | `PN` | PEANUTS WORLDWIDE | `PN` | yes |
| Sega | `SE` | SEGA | `SE` | yes |
| Strawberry Shortcake | `SS` | STRAWBERRY SHORTCAKE | `SS` | yes |
| Warner Bros | `WB` | WARNER BROS | `WB` | yes |
| **Disney** | **`DS`** | **DISNEY** | **`DY`** | **no** |
| **WWE** | **`WWE`** | **WWE** | **`WW`** | **no** |

**Eight of ten codes are byte-identical.** The two lists are plainly the same
code vocabulary. And note the *shape* of the two disagreements: `WWE` versus
`WW` is obviously one company written two ways — nobody would argue WWE and WW
are different wrestling companies. `DS` versus `DY` is the same class of error.
Two divergent spellings in a ten-row list that otherwise agrees perfectly is a
transcription drift, not a taxonomy.

Also checked and clear: **no licensor anywhere uses `DS` and `DY` as different
things.** There is no `core.licensor` row with code `DS`, and no
`public.licensors` row with `external_id` `DY`. The two codes never collide.

### Evidence 3 — a live production table already equates the two UUIDs on 4,048 rows

`plm.style_tracker_item_bridge` (15,619 rows) carries **both** a
`core_licensor_id` (FK to `core.licensor`) and a `public_licensor_id` (FK to
`public.licensors`) on the same row. Measured:

| Licensor name on the row | `core_licensor_id` | `public_licensor_id` | Rows |
| --- | --- | --- | ---: |
| **Disney** | `7d141a6f…` (**`DY`**) | `10a445bc…` (**`DS`**) | **4,048** |
| Marvel | `f143c083…` (`MV`) | `144f375d…` (`MV`) | 2,771 |
| Star Wars | `14f2902d…` (`SW`) | *null* | 1,174 |
| SEGA | `e5f1686c…` (`SE`) | `876b43ac…` (`SE`) | 374 |
| WWE | `7575d1db…` (`WW`) | `1e3ebfce…` (`WWE`) | 42 |

4,048 production rows already assert `DY` and `DS` are the same licensor. Nothing
in the database asserts the opposite.

### Evidence 4 — one is older than the other, and it is the legacy one

`public.licensors` rows were all created **2026-03-13**. `core.licensor`'s
legacy rows were created **2026-06-25**, over three months later, from the ERP
master-data import (`20260624173000_plm_master_data_import.sql`). The July 22
cutover then moved PopDAM's live asset and style-group links off
`public.licensors` and onto `core.licensor`.

**`public.licensors` is a legacy table mid-retirement.** The cutover migration
says so in its own header comment: *"Legacy rows remain temporarily because
`public.characters` still references `public.properties`."* `DS` is a leftover
from PopDAM's original standalone catalogue, not a competing business entity.

### What the property sets say — and why it is NOT evidence of difference

The 39 `core.property` rows under `DY` and the 124 `public.properties` rows under
`DS` overlap on only **13 names** (case- and whitespace-normalised). **This is
not evidence that they are different companies**, and it would be a mistake to
read it that way. The two tables count different things at different granularity:

- `core.property` under `DY` is POP's **product/design taxonomy** — `ALADDIN`,
  `CARS`, `DISNEY PRINCESSES`, `MOVIE POSTER`, `POSTER VERBIAGE`, `SPELLS`. Some
  of these are not properties at all in Disney's sense; they are internal
  grouping buckets.
- `public.properties` under `DS` is PopDAM's **style-guide taxonomy**, which
  tracks Disney's own style-guide names.

Different purposes, different granularity, same company. Low overlap is expected.

### Honest statement of the limits

What is proved: `DY` and `DS` denote the same company, Disney, and the repository
has already acted on that.

What is **not** proved and remains open: whether the correct canonical *code
string* is `DY` or `DS`. `DY` is what the ERP (ColdLion) emits — measured in
`plm.licensor_import`, `mg_code` = `DY` on both Disney rows — and the ERP is
POP's system of record for licensing and royalties. That is a strong argument for
`DY`, but it is a business judgement about which system leads, and it is Albert's
to make.

---

## 3. Which is authoritative, and what would break

### 3.1 Read/write map, per licensor list

**`core.licensor` — the canonical list. 20 tables depend on it.**

Foreign keys into `core.licensor`, measured from `pg_constraint`:

| Table | Column | Live rows using it |
| --- | --- | ---: |
| `public.assets` | `licensor_id` | 136,697 total assets |
| `public.style_groups` | `licensor_id` | 10,618 |
| `core.property` | `licensor_id` | 256 |
| `plm.style_tracker_item_bridge` | `core_licensor_id` | 15,619 |
| `plm.licensor_import` | `licensor_id` | 37 |
| `plm.property_import` | `licensor_id` | 468 |
| `plm.taxonomy_resolution_review` | `proposed_licensor_id`, `resolved_licensor_id` | — |
| `plm.item_taxonomy_disagreement` | `property_licensor_id`, `slot_licensor_id` | — |
| `pim.product` | `licensor_id` | 17,909 rows, **all null** |
| `pim.product_submission`, `pim.project` | `licensor_id` | `project` 651 rows, all null |
| `dam.asset`, `dam.style_group`, `dam.style_guide_file` | `licensor_id` | **0 rows each** |
| `plm.item`, `plm.erp_licensor`, `plm.licensing_status` | `licensor_id` | **0 rows each** |
| `crm.licensor_approval_thread` | `licensor_id` | **0 rows** |

**`public.licensors` — the legacy list. Exactly 2 tables depend on it.**

| Table | Column | Rows |
| --- | --- | ---: |
| `public.properties` | `licensor_id` | 500 (124 under Disney) |
| `plm.style_tracker_item_bridge` | `public_licensor_id` | 15,619 (4,048 Disney) |

### 3.2 Per application

These are inferences from the schema and the migration history. **They were not
confirmed against the application repositories** — no app repo was read in this
investigation. Treat the "reads / writes" column as a hypothesis to verify before
acting.

| Application | Reads Disney from | Writes | Risk if `public.licensors.Disney` is retired |
| --- | --- | --- | --- |
| **PopDAM** (asset library, style guides) | `core.licensor` for `public.assets` and `public.style_groups`; **still `public.licensors` for `public.properties`** | writes assets and style groups | **Medium.** Its asset/style-group links were already cut over. The remaining exposure is the property picker and the 9,622-row `public.characters` chain hanging off `public.properties` |
| **DesignFlow PLM** | `core.licensor` via `plm.*`; ERP mirror `plm.licensor_import` resolves to `DY` | ERP importer writes `plm.licensor_import` | **Low.** It never used `DS` |
| **PopCRM** | `crm.licensor_approval_thread` → `core.licensor` | — | **None today.** Table is empty |
| **Poppim** | `pim.product` / `pim.project` → `core.licensor` | — | **None today.** All `licensor_id` values are null |
| **Style tracker bridge** | both, simultaneously | reconciliation job | **Medium.** The one place that genuinely uses both columns; retiring `public_licensor_id` needs a plan |

### 3.3 The recommendation on authority

**`core.licensor` / `DY` is authoritative.** Reasons, in order of weight:

1. Twenty tables reference it; two reference the other.
2. The July 22 cutover already moved PopDAM's 147,000 live asset and style-group
   rows onto it, and that migration is merged and applied.
3. It matches the ERP, which is POP's system of record for licensing.
4. It carries a `status` column (`active` / `potential`); `public.licensors` has
   no such column and cannot express lifecycle at all.

**This is a cross-app data contract change and must be treated as one.** It is a
recommendation, not a decision.

---

## 4. Marvel and Star Wars — framed, not resolved

**Not resolved. This section presents both sides and stops.**

### The facts

- `core.licensor` holds `MARVEL` (`MV`, 17,428 assets, 29 properties) and
  `STAR WARS` (`SW`, 344 assets, 28 properties) as **peers** of `DISNEY`, not
  children.
- `core.licensor` has **no parent/child column at all.** It is a flat list. There
  is no hierarchy to put them into without a schema change.
- `public.licensors` has a `Marvel` row and **no Star Wars row whatsoever**. No
  Star Wars property exists in `public.properties`.
- OPA — Disney's own licensee portal — serves Marvel and Star Wars properties
  through it, alongside classic Disney.
- Commercially, Disney has owned Marvel since 2009 and Lucasfilm since 2012.

### The argument that they should stay separate — the stronger evidence

The ERP mirror settles what our upstream business system believes. Measured in
`plm.licensor_import`:

| `plm_licensor_id` | Title | `mg_code` | `division_code` | Resolves to |
| ---: | --- | --- | ---: | --- |
| 197 | DISNEY | `DY` | 1 | `core.licensor` DISNEY |
| 1111 | DISNEY | `DY` | 8 | `core.licensor` DISNEY |
| 201 | MARVEL | `MV` | 1 | `core.licensor` MARVEL |
| 1115 | MARVEL | `MV` | 8 | `core.licensor` MARVEL |
| 206 | STAR WARS | `SW` | 1 | `core.licensor` STAR WARS |
| 1121 | STAR WARS | `SW` | 8 | `core.licensor` STAR WARS |

**ColdLion, the ERP, treats DISNEY, MARVEL and STAR WARS as three distinct
licensors, in both divisions.** POP's contracts, royalty reporting and item
costing run through the ERP. Collapsing them in the database would put us out of
step with the system that actually pays the royalties.

Second supporting point: the style tracker keeps them apart at scale — 4,048
Disney rows, 2,771 Marvel rows, 1,174 Star Wars rows, all with distinct
`core_licensor_id` values. Somebody has been classifying them separately, at
volume, deliberately.

### The argument that they are Disney

OPA serves all three through one portal on one licensee account, which means POP
deals with Disney as the counterparty. If OPA is ever to be the property source,
its rows will not carry a Disney/Marvel/Star Wars split, and something will have
to supply one.

### The trap to avoid

**OPA serving Marvel and Star Wars proves Disney licenses them to us. It does not
prove how our system should model them.** Those are different questions. A
portal is a distribution channel; a licensor row is a contract and royalty
counterparty. They do not have to match.

### What is genuinely undecided

If OPA rows are ever stamped with a licensor, someone must choose between: stamp
everything `DISNEY` (contradicts the ERP), split by a name rule (invents a
classification Disney never gave us), or stamp nothing and defer (what
DESIGN.md §2.3 option B recommends). **Not resolved here.**

---

## 5. `DTR - NO LICENSE`

### What is filed under it — all five rows

`core.licensor` `DTR - NO LICENSE` (`ZZ`, id `80276015-a751-4438-8c25-759c8dd005b2`,
status `active`, created 2026-06-25) has exactly **five** `core.property`
children. Small enough to list completely:

| Property | id | code | status | `public.assets` | `public.style_groups` | `pim.product` |
| --- | --- | --- | --- | ---: | ---: | ---: |
| **COCO** | `5c03fc46-5a02-4da1-bcac-8969e74bbd8f` | `CC` | active | **15** | 0 | 0 |
| CREATURE | `8369d2ed-c8eb-4372-92af-fc0a20754307` | `CR` | active | 2 | 0 | 0 |
| AB | `4a9af8b7-1106-45fd-b259-7116c9e423b2` | `AB` | active | 0 | 0 | 0 |
| BOARDERLANDS | `b1af49a8-0ac6-4655-9961-1ed5db92f24b` | `BR` | active | 0 | 0 | 0 |
| DESTINATIONS | `a91558d9-284a-49f8-b016-5011837e99d3` | `DE` | active | 0 | 0 | 0 |

A further **103 `public.assets` rows** point at the `ZZ` licensor directly
(without going through one of these five properties).

### The contradiction, stated plainly

**Our own database already disagrees with itself about Coco.** Measured:

- `core.property` `COCO` is parented to **`DTR - NO LICENSE`**.
- `public.properties` `Coco` (id `47dfbf8a-b7bf-4311-a1a4-1c7926c582eb`, 1
  character) is parented to **`Disney` (`DS`)**.

The legacy PopDAM side already files Coco under Disney. Only the canonical
`core` side files it under "no license". Albert's 2026-08-06 ruling — *"Coco IS a
Disney license"* — agrees with the legacy side and with reality (Coco is a
Pixar/Disney film). **The ruling was never applied.**

### What applying the ruling would mean

Change `core.property` `COCO`'s `licensor_id` from the `ZZ` UUID to the `DY`
UUID. That is **one column on one row.**

Blast radius, measured:

- 1 `core.property` row changes parent.
- 15 `public.assets` rows change which licensor they roll up to (`ZZ` → `DY`).
  Their own `licensor_id` column may also need updating to stay consistent —
  check both, because `public.assets` carries `licensor_id` *and* `property_id`
  independently.
- 0 style groups, 0 PIM products, 0 PLM items, 0 CRM threads affected.
- `public.properties` `Coco` needs no change — it is already under Disney.

**Cost to undo: trivial.** Record the old UUID in the migration and reverse it.
No data is deleted. Nothing cascades.

### Watch out for this trap

`core.property` `COCO` has code **`CC`**. `core.licensor` `COCA COLA` also has
code **`CC`**. Property codes and licensor codes are separate namespaces, but any
query or script that matches on a bare `CC` string will confuse Coco with Coca
Cola. **Match on UUID, never on `CC`.**

### What else under `NO LICENSE` may need the same treatment

Unresolved, listed honestly:

- **CREATURE** (2 assets) — no evidence found either way about whose it is.
- **DESTINATIONS** (0 assets) — plausibly a Disney parks/travel grouping, but
  that is a guess. **Do not act on it.**
- **AB** (0 assets) — a two-letter code with no expansion recorded anywhere in
  this database. Meaning unknown.
- **BOARDERLANDS** (0 assets) — note the spelling; the game franchise is
  *Borderlands* (2K/Gearbox). If it is that, it is neither Disney nor "no
  license" and belongs somewhere else entirely.
- **The 103 assets pointing straight at `ZZ`** with no property — nobody has
  looked at what these are. They are the largest unexamined pile here.

Four of the five properties carry `status = 'active'`, which means nothing in the
data marks them as junk or archived.

---

## 6. Options for Albert

*This section stands alone. You do not need to read anything above it.*

### The short version

We have one Disney in our system, written down twice with two different short
codes. It is the same company, and the database already treats it that way in
several places. The duplicate is a leftover from an older system that is halfway
through being retired.

### Option 1 — Do nothing to Disney. Just fix Coco. *(recommended)*

**What changes:** one row. The property "Coco" currently says it has no license.
We change it to say it is Disney, which is what you already ruled on 6 August and
what our other system already says.

**What could break:** almost nothing. Fifteen artwork files move from "no
license" to "Disney" in reports. No other system is affected.

**Cost to undo:** minutes. One row back.

**Why this is the recommendation:** it applies a decision you already made, it is
the smallest possible change, and it removes the one place where our database
openly contradicts itself.

### Option 2 — Fix Coco, and formally write down that the two Disneys are one

**What changes:** Option 1, plus a note in the project's rules file recording
that `DY` is the official Disney code and `DS` is the old spelling. **No data
moves.** This is paperwork, not surgery.

**What could break:** nothing. No table is touched.

**Cost to undo:** delete a paragraph.

**Why you might want it:** it stops the next person, human or AI, spending
another session rediscovering this. It costs almost nothing.

### Option 3 — Retire the old Disney entirely

**What changes:** we finish the job that was started on 22 July. The 500 property
records still using the old list get moved onto the new one, and the old list is
deleted.

**What could break:** the PopDAM app still reads properties from the old list.
Its property picker and the 9,622 character records hanging off it would need
testing before and after. This is real work with real risk.

**Cost to undo:** high. Once the old list is deleted, going back means restoring
from backup. This should only be done with a preview run and a tested rollback.

**Why you might want it:** it is the permanent fix. But it is a project, not a
quick change, and it should not be attached to the Disney character work.

### Option 4 — Also reorganise Marvel and Star Wars under Disney

**What changes:** Marvel and Star Wars stop being their own licensors and become
Disney properties.

**What could break:** a lot. Our accounting system (ColdLion) lists Disney,
Marvel and Star Wars as three separate licensors in both divisions. Royalty
reporting runs off that. Over 21,000 artwork files would change which licensor
they belong to.

**Cost to undo:** very high.

**Recommendation: do not do this.** The evidence points the other way. Our
accounting system already says they are separate, and it is the system that pays
the royalties. Leave them alone.

### The one-line recommendation

**Take Option 2** — fix Coco and write the `DY`-is-official note down — because
it applies the ruling you already made, costs an afternoon, and cannot break
anything.

---

## 7. What I did NOT do, and what is still unknown

### 7.1 Explicitly not done

- **No migration written.** No file created, modified or deleted under
  `supabase/`.
- **No database write of any kind.** No `insert`, `update`, `delete`, `create`,
  `alter`, `drop`, or `apply_migration`. Read-only `select` and catalog queries
  only.
- **No `supabase` CLI command, no `psql`.**
- **No preview contact** — `rjyboqwcdzcocqgmsyel` was never touched.
- **No background task chip created.**
- **The shared checkout `C:\repos\shared-db` was never touched.** All work in an
  isolated worktree on `agent/disney-licensor-identity-20260807`.
- **`HANDOFF.md`, `AGENTS.md`, `COORDINATOR_INTAKE.md` and `supabase/**` were not
  edited.** This file is the only one added.
- **No commit to `main`, no merge.**
- **No canonical Disney value was chosen.** That is Albert's gate.
- **Coco was not fixed.** Section 5 describes what fixing it means; nothing was
  applied.

### 7.2 Still unknown

1. **Whether `DY` or `DS` is the correct code string.** The company identity is
   settled; the preferred spelling is a business call. Evidence favours `DY`.
2. **The application repositories were not read.** Section 3.2's read/write map
   is inferred from schema and migrations. **Verify against the PopDAM, PopCRM,
   DesignFlow and Poppim repos before any consolidation.** In particular, an app
   may hard-code the string `'DS'` or a literal UUID, and that would not appear
   in any database catalog.
3. **What the 103 `public.assets` rows pointing directly at `DTR - NO LICENSE`
   actually are.** Not examined. Largest unexamined item here.
4. **What `CREATURE`, `AB`, `BOARDERLANDS` and `DESTINATIONS` are.** No evidence
   found. `BOARDERLANDS` is probably a misspelling of a non-Disney game franchise.
5. **Whether `MIRACULOUS` belongs under `DISNEY`.** It is currently a `core.property`
   under `DY`, but Miraculous is a ZAG property. Note `plm.style_tracker_item_bridge`
   separately carries 11 rows named `ZAG Miraculous` with no `core_licensor_id`.
   Possible misfiling; **not investigated, not touched.**
6. **Whether the July 22 cutover's `WWE` → `WW` mapping deserves the same
   write-up.** It is the identical class of duplicate (`WWE` in `public.licensors`,
   `WW` in `core.licensor`) and nobody has documented it.
7. **How `public.characters` would follow** if `public.properties` were retired.
   9,622 rows depend on that chain. Not designed.
8. **Whether `pim` and `dam` will populate their empty `licensor_id` columns from
   `core.licensor`.** Assumed yes; not confirmed with the app owners.

### 7.3 Follow-ups for the coordinator

Per the brief, these are listed here rather than raised as task chips:

- Apply Albert's Coco ruling (§5) once he confirms the option.
- Examine the 103 unattributed `DTR - NO LICENSE` assets.
- Document the `WWE` / `WW` duplicate alongside `DS` / `DY`.
- Verify the §3.2 application read/write map against the four app repositories.
- Investigate the `MIRACULOUS` / `ZAG Miraculous` possible misfiling.
