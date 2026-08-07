# What it would take to make ColdLion the source for our Supabase database

**Date:** 2026-08-07
**Author:** sub-agent `coldlion-source`, dispatched by the `u2giants/shared-db` coordinator session.
**Branched from:** `origin/main` at `f9d1d3757a35fdaf837ba80245095d001bc481e4`.
**Status:** **INVESTIGATION AND PLAN ONLY.** No migration written. No database write of any kind.
Nothing under `supabase/` was touched. Nothing here is approved for production.

**Albert's question, verbatim (2026-08-07):**

> *"What is needed in order to have ColdLion API as the source for our Supabase without breaking
> anything? If ColdLion doesn't match DesignFlow we will have to map some of those values."*

**Who this is written for.** Two readers. (1) Albert Hazan, the owner, who is not a programmer —
**§8 is written for him and reads standalone; skip to it.** (2) A developer who joined this morning
and knows nothing about this project. Every technical term gets a short plain-English tag in
brackets the first time it appears.

**How to read the labels.** Every factual claim is tagged **[MEASURED 2026-08-07]** — this agent
measured it today against production `qsllyeztdwjgirsysgai`, the live ColdLion API, or the
repositories on this machine — or **[DOC]** — it comes from a document in this repo and was not
re-measured.

---

## 0. The answer in six lines

1. **ColdLion is already the declared boss of this data** — owner ruling, `AGENTS.md` §6.3,
   2026-07-31. The question is not *whether*, it is *how to arrive without breaking anything*.
2. **The two systems agree far more than anyone assumed.** Of the 252 properties and 19 licensors
   that exist in both, **the names match exactly — zero differences.** [MEASURED]
3. **So the mapping table Albert expects is small: 47 rows, not hundreds.** 33 ColdLion properties
   we do not have, 4 of ours ColdLion does not have, 3 ColdLion licensors we do not have, 7 of ours
   ColdLion does not have. §2 sizes and shapes it.
4. **The danger is not mismatched names. It is deletion.** ColdLion cannot express a parent or a
   lifecycle status, and 92,173 PopDAM asset rows point at `core.licensor`. §3.
5. **Almost nothing of the ColdLion licensor/property machinery is in production.** It was built,
   tested and rehearsed on preview, merged to `main` — and never promoted. Production holds **zero**
   ColdLion licensor/property rows and **none** of the promotion functions. §4.
6. **The verdict from the previous plan still stands, unsoftened: this is the hardest table set to
   move, and `age_group` should still be the rehearsal first.** ColdLion-as-source does not make it
   easier. In one specific way it makes it harder. §7.

---

## 1. The two feeds as they actually are today

### 1.1 DesignFlow PLM — the live production path, and it is dead

| Fact | Value | Evidence |
|---|---|---|
| What it is | DesignFlow PLM's own production database (Google Cloud SQL), exposed over an HTTP endpoint | [DOC] `docs/designflow-master-data-migration/README.md` §4.2 |
| Endpoint | `GET https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties` (plus `/getCustomers`) | [MEASURED] hosted at `C:/repos/dflow/designflow-item-master/routes/item_library.router.js:25`, implemented `services/item_library.service.js:71-138` |
| Where it reads | Cloud SQL table `merchGroup`, `mgTypeCode='06'` for properties and `'05'` for licensors, parent via `merchGroup.parent_id` | [MEASURED] same file, lines 74-112 |
| What it writes into Supabase | `plm.import_master_data()` → `core.licensor`, `core.property`, `core.taxonomy_source_ref`, `plm.licensor_import` | [MEASURED] function exists in production `pg_proc` |
| Runner | `tools/sync-plm-master-data.mjs` | [MEASURED] present in repo |
| Schedule | `systemd` timer `plm-sync.timer` on host `hetz`, daily 03:30 | [DOC] `systemd/plm-sync.timer` |
| **Last successful run** | **2026-07-08 03:30:19 -04 — 30 days ago** | [MEASURED] `ingest.sync_run`, production |
| Run history | 15 runs, **every one recorded `succeeded`. Not one `failed` row exists.** | [MEASURED] production |

**The most important operational fact in this whole document.** The feed has been dead for 30 days
from an upstream HTTP 502, and **the database contains no trace of it**. `ingest.sync_run` has no
failed row, no row at all after 2026-07-08. Nothing in Supabase would ever raise a hand. This is a
textbook silent failure, and it is why every `core.property` row still carries `updated_at`
2026-07-08. [MEASURED, corroborating `AGENTS.md` §6.10-A]

**Three things this endpoint throws away before we ever see them** [MEASURED in the DesignFlow
source, 2026-08-07]:

1. `item_library.service.js:131` — `.filter((licensor) => licensor.properties.length)`. **A licensor
   with no properties is silently dropped from the payload.**
2. `item_library.service.js:74-77` — properties are filtered `is_active: true`. **Inactive
   properties never arrive.**
3. The payload is nested JSON (licensor → properties). **A property with no parent has nowhere to
   sit, so it structurally cannot be sent.**

That is why Supabase holds 26 licensors and 256 properties while DesignFlow holds 82 and 614.
[DOC `AGENTS.md` §6.10-A]

Asymmetry worth recording, not previously written down: the licensor query at lines 102-112 does
**not** filter `is_active`, so an *inactive* licensor is emitted if it still parents an active
property. The drop rules are not symmetric.

### 1.2 ColdLion ERP — canonical by owner ruling, and absent from production

| Fact | Value | Evidence |
|---|---|---|
| What it is | the Edge Home ERP ("CLAPIServerEhp"), the system the business actually runs on | [DOC] `docs/coldlion-erp-api-reference.md` |
| Base URL | `http://x5.coldlion.com/EhpApi` (plain HTTP), header `X-API-Key` | [MEASURED] called live today |
| Endpoint for this data | `GET /merchGroupDetails?companyCode=EDGEHOME&divisionCode=…&mgTypeCode=…` | [MEASURED] |
| Licensors | `mgTypeCode='05'` in divisions `CW001` and `SP001` | [MEASURED] |
| Properties | `mgTypeCode='06'` in the same two divisions | [MEASURED] |
| Owner ruling | **"ColdLion ERP data is canonical."** Albert Hazan, 2026-07-31 | [DOC] `AGENTS.md` §6.3 |
| What it writes into production Supabase **today** | **Customers and vendors only. Nothing else.** | [MEASURED] |
| ColdLion customers | `plm.import_coldlion_customers(jsonb)`; 3 runs ever, last **2026-07-17**; **no runner script exists in this repo** — a human pastes JSON | [MEASURED] + [DOC] `docs/coldlion-source-of-truth-plan.md` §7 C3 |
| ColdLion vendors | `plm.sync_coldlion_vendors(jsonb)` via `tools/sync-coldlion-vendors.mjs`; 8 runs, last **2026-07-22** | [MEASURED] |
| Schedule for either | **None. Both are hand-run only.** | [MEASURED] no workflow, no systemd unit |
| ColdLion licensors/properties in production | **ZERO runs. ZERO rows.** | [MEASURED] |

**Live ColdLion counts, pulled today 2026-08-07:**

| `mgTypeCode` | Meaning in CW001 / SP001 | Rows in CW001 | Rows in SP001 |
|---|---|---|---|
| 05 | **Licensor** | 22 | 22 |
| 06 | **Property** | 285 | 285 |
| 07 | Style Guide | **0** | **0** |
| 08 | Art Source | 3 | 3 |
| 09 | Artist | 53 | 53 |
| 10 | Demographic | 3 | 3 |

**New measurement, not recorded anywhere before:** CW001 and SP001 are **byte-for-byte identical**
for types 05 and 06 — every code exists in both divisions and **zero codes have a different name
between them**. [MEASURED] The "44 licensor rows / 570 property rows" quoted in earlier documents is
therefore pure two-division duplication of 22 and 285 distinct values. The division dimension adds
no information for licensor and property today. **That does not make it safe to collapse
permanently** — see §4, blocker B12.

### 1.3 What is in production right now — the numbers

[MEASURED 2026-08-07, production `qsllyeztdwjgirsysgai`, read-only. `n_live_tup` is unreliable in
this database; every figure below is `count(*)`.]

| Table | Rows | What it means |
|---|---|---|
| `core.licensor` | **26** | the shared licensor list. All 26 written by DesignFlow |
| `core.property` | **256** | the shared property list. All parented; **zero orphans in Supabase** |
| `core.taxonomy_source_ref` | **505** | provenance. **100% `designflow_plm`** (37 licensor + 468 property refs). **Zero `coldlion` rows.** |
| `plm.licensor_import` | 37 | the DesignFlow landing table |
| `plm.erp_licensor` | **0** | the ColdLion licensor mirror — table exists, **empty** |
| `plm.erp_property` | **0** | the ColdLion property mirror — table exists, **empty** |
| `plm.merch_group_header` | **0** | the "what does type 05 mean here" dictionary — **empty in production** |
| `core.merch_group` | **0** | designed home for the other eight ColdLion lists — never filled |
| `core.customer` | 862 | ColdLion-sourced, last refreshed by hand 2026-07-17 |
| `core.factory` | 93 | ColdLion-sourced, last refreshed by hand 2026-07-22 |

**Production does not contain the ColdLion promotion machinery at all.** `pg_proc` holds
`plm.import_coldlion_customers` and `plm.sync_coldlion_vendors` and nothing else ColdLion-shaped —
**`promote_coldlion_source_owned` and `verify_coldlion_approved_mapping_identity` do not exist in
production.** [MEASURED]

**Production is 39 merged migrations behind the repository.** Ledger latest `20260802194100`,
361 applied; `supabase/migrations/` holds 400 files. [MEASURED]

### 1.4 Zero orphans in Supabase — a correction people will otherwise get wrong

Every one of the 256 `core.property` rows has a licensor. [MEASURED — the per-licensor child counts
sum to exactly 256.] The widely quoted **111 unparented properties (51 active) are in DesignFlow's
Cloud SQL**, not in Supabase, and they are unparented *there*. They have never reached Supabase
precisely because the feed cannot carry them. Do not restate "111 orphans" as a Supabase condition.

---

## 2. The gap analysis — where ColdLion and DesignFlow actually disagree

**This is the core deliverable and the direct answer to the second half of Albert's question.**

Method: the live ColdLion `/merchGroupDetails` pull of 2026-08-07 (22 licensor codes, 285 property
codes, distinct across both divisions) compared against production `core.licensor` and
`core.property` on `code`, case- and whitespace-insensitive on `name`.

### 2.1 Licensors — 22 in ColdLion, 26 in Supabase

| Bucket | Count | Detail |
|---|---|---|
| **Present in both, names match exactly** | **19** | `1P AA CB CC DC DY HP MV NB PN PP SE SM SS SW VM WB WW ZZ` |
| Present in both, **names differ** | **0** | — |
| **ColdLion only** | **3** | `FK` FRIDA KAHLO · `NA` NASA · `ZG` ZAG |
| **Supabase only** | **7** | `FR` FRIENDS TV (active, 1 property) · `X-NASA` NASA (active, 0 properties) · `X-ANHEUSERBUSCH` · `X-FORD` · `X-MILLERCOORS` · `X-NCAA` · `X-NFL` (all five `potential`, 0 properties) |

### 2.2 Properties — 285 in ColdLion, 256 in Supabase

| Bucket | Count | Detail |
|---|---|---|
| **Present in both, names match exactly** | **252** | — |
| Present in both, **names differ** | **0** | — |
| **ColdLion only** | **33** | `55 75 90 AM1 AM2 BB BH CHR CU EP EX FB FE FG FSD GE1 GRE HDS LB MG1 MG2 MGM MY SGT SM1 SM6 SM7 TNT TZ1 TZ2 TZ3 WND YS` |
| **Supabase only** | **4** | `ADT` ADVENTURE TIME · `OGW` OVER THE GARDEN WALL · `RS` REGULAR SHOW · `SFS` SMILING FRIENDS — all four under licensor `WB`, and **all four carry zero PopDAM assets** |

**The 252/33 split reproduces the 2026-07-31 figures exactly, one week later, and this time against
PRODUCTION rather than preview.** That document measured 33 and 3 on preview; the same numbers hold
on production today. The stale "66 unmatched" figure in older handovers is confirmed dead.

### 2.3 The single most useful finding: there is no name-mapping problem

**Across all 271 entities that exist in both systems — 19 licensors and 252 properties — not one
name differs.** [MEASURED] Albert's premise that "ColdLion doesn't match DesignFlow" is correct at
the level of *which rows exist*, and **wrong at the level of what the rows are called**. Nobody has
to build a spelling-normalisation table, a fuzzy matcher, or a 500-row translation sheet.

That collapses the mapping problem from "hundreds of judgement calls" to **47 rows**.

### 2.4 The three shapes of disagreement, and what each needs

**Shape 1 — same entity, different code (needs a mapping row).**
`NA` (ColdLion, NASA) and `X-NASA` (Supabase, NASA) are the same organisation under two codes. This
is the only confirmed instance in the licensor set, and it already has an owner ruling: reconcile
`X-NASA` → `NA`, X-NASA goes. [DOC `AGENTS.md`, intake 7-step sequence]

**Shape 2 — the same code means different things (needs a TYPED mapping, never a code-only one).**
This is the real trap and it is worse than previously documented. **15 of ColdLion's 22 licensor
codes are also ColdLion property codes:** `1P CB CC DC DY FK HP MV PN PP SE SM SS SW WW`. [MEASURED]
Concretely, in ColdLion `FK` is a licensor (FRIDA KAHLO); in Supabase `FK` is a *property* named
FRIDA KAHLO sitting under licensor `FR` (FRIENDS TV). And `FR` in ColdLion is a *property*
("1ST ORDER TROOPER") while `FR` in Supabase is a *licensor* (FRIENDS TV).

**A mapping keyed on code alone is guaranteed to corrupt this data.** The mapping key must be the
full four-part ColdLion identity `(companyCode, divisionCode, mgTypeCode, mgCode)` → our UUID. This
is exactly what the already-approved 542-row artifact does — see §2.5.

**Shape 3 — present in one and not the other (needs a business ruling, not a mapping).**
The 33 + 4 + 3 + 7 rows. For each, someone must answer one of three questions: is this a live
licence we are missing, a dead licence ColdLion never retired, or a duplicate under another code?
That is a business decision. Engineering cannot guess it.

### 2.5 The mapping table already exists, is already approved, and is already frozen

**Do not design a new one.** Albert approved 542 typed matches on 2026-07-25 —
38 licensor references + 504 property references resolving to 271 canonical rows (19 licensors,
252 properties). [DOC] Artifact:
`docs/verification/coldlion-licensor-property-phase4-20260725/approved-mapping.json`,
md5 `1230f5a12d0f2a3029f1d3df17fc5b5f`. It is enforced by
`tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs`, which re-resolves every row by
full typed identity to the exact expected UUID; row counts alone cannot pass.

**[MEASURED] the arithmetic of that artifact matches production today.** 19 licensors and 252
properties is exactly the intersection this agent measured independently on 2026-08-07. The approved
mapping is **still valid one week and 285 live ColdLion properties later.** That is the single
strongest piece of good news in this document.

**Do not confuse it with** the Phase 3 placeholder at
`…/phase3-20260725/phase4-approved-mapping.json`, whose hash `d41d8cd9…` is the md5 of the *empty
set* with `approved_by: null`.

### 2.6 The shape of what still has to be decided

The 47 rows outside the approved set, as a decision sheet. **This is a business worksheet, not a
schema.** The engineering artifact is a *new version of the approved-mapping JSON with a new hash
and a new Albert approval* — that machinery already exists and must be reused.

| Column | Meaning |
|---|---|
| `coldlion_identity` | `(EDGEHOME, CW001\|SP001, 05\|06, mgCode)` — the four-part typed key. Never the bare code |
| `coldlion_name` | the ERP description. **Per §6.10 ruling 2, the description decides the licensor, never the code** |
| `supabase_entity` | `core.licensor.id` / `core.property.id`, or `NULL` if we hold nothing |
| `disposition` | one of: `same_entity_different_code` · `admit_as_new` · `dead_licence_do_not_admit` · `ours_only_keep` · `ours_only_retire` |
| `landing_status` | for `admit_as_new`, must be **`potential`, never `inactive`** — settled ruling, `AGENTS.md` §6.9 rule 3 |
| `parent_licensor` | **mandatory for every admitted property.** ColdLion cannot supply it. §3.2 |
| `decided_by` / `evidence` | named human + evidence. Non-blank |

**Rows already ruled on and NOT open for re-litigation** [DOC `AGENTS.md` §6.9, §6.10, intake]:
`FK`/`NA`/`ZG` are imported; property `FK` is re-pointed; anything under `FR` is re-homed; `X-NASA`
reconciles to `NA`; **`FR` is removed entirely and LAST**; FRIDA KAHLO stays as a real licensor;
Coco IS a Disney licence; `DY` and `DS` are one company.

### 2.7 A caveat on my own numbers, stated so nobody launders it into a fact

The 33 / 4 / 3 / 7 figures are **code-only matches**. `core.property` is really keyed
`(licensor_id, code)` — property codes are **not** globally unique
(`AGENTS.md` §6.10 ruling 3). My diff is exact *today* only because production's `core.property`
copy is crippled to 256 rows with one row per code. **The moment the feed is repaired and the same
code appears under two licensors, a code-only diff becomes wrong.** Treat these as the right order
of magnitude, verified today, and re-derive them by full typed identity at the time of the work.
This is the same warning `docs/coldlion-source-of-truth-plan.md` §2 gives, and it still applies.

---

## 3. What "without breaking anything" actually requires

### 3.1 The blast radius, measured

**20 tables carry a foreign key to `core.licensor`; 18 carry one to `core.property`.** [MEASURED]

| Referencing table | Rows carrying the id | On delete | App |
|---|---|---|---|
| **`public.assets`** | **92,173 licensor · 49,309 property** | `SET NULL` | **PopDAM** |
| `plm.style_tracker_item_bridge` | 15,619 | `SET NULL` | shared |
| `public.style_groups` | 45 licensor · 32 property | `SET NULL` | PopDAM |
| `core.property` → `core.licensor` | 256 | **`RESTRICT`** | shared |
| `plm.licensor_import` / `plm.property_import` | 37 / — | **`RESTRICT`** | shared |
| **`core.character`** | **0** | **`CASCADE`** | shared |
| `dam.asset`, `dam.style_group`, `dam.style_guide_file` | **0** | `SET NULL` | PopDAM (unpopulated) |
| `pim.product`, `pim.project`, `pim.product_submission` | **0** | `SET NULL` | Poppim (unpopulated) |
| `crm.licensor_approval_thread` | **0** | `SET NULL` | PopCRM |
| legacy `public.licensors` / `public.properties` | 10 / 500 | — | PopDAM legacy |

**The one number that matters: 92,173.** If a ColdLion-authoritative feed ever *deletes* a licensor
row, PostgreSQL will silently blank the licensor on up to 92,173 PopDAM asset rows. No error, no
alert, no way to tell which ones. That is the concrete meaning of "breaking something" here, and it
is a direct collision with the §6.3 owner ruling that says *follow ColdLion when it removes a row*.

**`core.character` is `ON DELETE CASCADE`.** It is empty today, but the characters/style-guides
workstream is about to fill it. Once it is populated, deleting a property **destroys character
rows outright** — no SET NULL, no recovery. This constraint must be revisited before that
workstream lands. Not previously flagged anywhere.

### 3.2 The two facts ColdLion can never supply

**Permanent limits of the ERP, not temporary gaps.** [DOC `docs/coldlion-erp-api-reference.md`,
confirmed by the live payload today: the fields are `companyCode, divisionCode, mgTypeCode, mgCode,
mgDesc, itemNoCode, mgCategory, mgCode2, createdTime/User, modTime/User` — and no more.]

1. **No licensor → property relationship.** ColdLion's merch groups are ten flat lists. There is no
   parent link between type 05 and type 06.
2. **No active / inactive flag.** Nothing in the payload says a licence has expired. ColdLion still
   returns dead licences forever.

**`core.property.licensor_id` is `NOT NULL`.** [MEASURED] So a ColdLion property **cannot be
inserted at all** without a human first deciding its parent. This is not a policy preference; it is
a hard schema constraint standing between ColdLion and every one of those 33 codes.

### 3.3 The four applications, one by one

Repos read on this machine today: `C:/repos/popcrm-web` and the six `C:/repos/dflow/designflow-*`
repos. **`popdam3` and `poppim-web` are NOT checked out on this machine** — that is an unclosed gap,
recorded in §9, not silently omitted.

Note for whoever reads next: **a full vendored copy of the `shared-db` repo exists inside all six
dflow repos and inside popcrm-web** (`C:/repos/dflow/<repo>/shared-db/…`). Those are duplicates of
this repository, not application code, and they are a real drift hazard in their own right —
seven stale copies of our migrations and docs living inside app repos.

#### DesignFlow PLM — the one that changes most

- **Reads licensor/property from its own Cloud SQL `merchGroup` table, never from Supabase.**
  [MEASURED] There is not one reference to `core.licensor` or `core.property` in any of the six
  repos' application code. The Supabase copy is a *downstream mirror* nothing reads.
- **DesignFlow already imports ColdLion itself.** `designflow-data-syncing` pulls
  `/merchGroupDetails` and writes `merchGroup` rows
  (`models/lib.model.js:701,721,790,862,900`; `helpers/utility.js:93-104`). **So ColdLion → Supabase
  and ColdLion → DesignFlow are two arms of the same source, and DesignFlow's arm has been running
  the whole time the Supabase arm was dead.**
- **What breaks:** the frontend keys off the *display string* `mgTypeDesc == "Licensor"` /
  `"Property"` in five components (`itemDetail.component.ts:347,353`;
  `newItem-dialog.component.ts:776-779`; `newArtPiece.component.ts:329-345`;
  `art-piece-detail.component.ts:180-182`; `lead-time-calculator.component.ts:130-134`). Renaming a
  merch-group-type description silently empties every licensor dropdown.
- **`designflow-tracking` joins lead-time data to licensors by fuzzy NAME match**
  (`helpers/leadTimeUtils.js:3-6,42-44` against `LicensingTime.licensor_name`). **Any canonical-name
  normalisation on the Supabase side would silently change lead-time results.** Since §2.3 found
  zero name differences, this is currently safe — and it is exactly what a "let's tidy up the names"
  change would break.
- **The type-blind write endpoint is real.** `PATCH /api/admin/updateMerchGroup`
  (`designflow-backend/routes/admin.router.js:87`, service at `admin.service.js:510-554`, writing
  `parent_id` and `is_active` at `:515,:532`) takes raw ids and never checks `mgTypeCode`. Five roles
  can reach it. It can move a licensor→property parent edge. Confirms the §6.10-B correction 3.

#### PopDAM — the one with the most to lose

- **Cannot be read** (`popdam3` absent from this machine). Everything below is from the database.
- It is by far the heaviest consumer: **92,173 + 49,309 rows** in `public.assets`. The `dam.*`
  schema is designed and **completely empty** — PopDAM lives in `public`.
- `AGENTS.md` §6.11: 136,697 `public.assets` rows and 10,618 `public.style_groups` rows were already
  rewritten onto canonical `core.licensor` UUIDs on the basis that legacy `DS` = canonical `DY`.
  **Current PopDAM data depends on that.**
- **What would break:** a deletion or re-key of any licensor/property blanks asset tagging at scale,
  silently.

#### Poppim — nothing to break yet

`pim.product`, `pim.project`, `pim.product_submission` all hold **0 rows** [MEASURED]. The wiring is
in place and unused. Cutting over costs nothing here **today**; the window closes the moment it is
populated.

#### PopCRM — almost nothing to break

- **[MEASURED] no reference anywhere in `popcrm-web/src/` or `workers/` to `core.licensor`,
  `core.property`, `plm.import_master_data` or `getLicensorsWithProperties`. No hard-coded UUIDs at
  all** (grepped the full UUID pattern — zero hits).
- It reads the view `api.crm_approval_queue` and writes a CRM-owned table
  `licensor_approval_thread` (`src/features/crm/api.ts:849-858`), which holds **0 rows**.
- Minor, unrelated: `ApprovalsPage.tsx:42-47` labels a column `'Licensor'` but binds it to
  `property_name`. Likely a mislabel; out of scope here.

### 3.4 The hard-coded strings no catalog query can see

**This is why the app repos had to be read.** A prior investigation inferred the app map from schema
and migrations alone and could not see any of this:

- `designflow-frontend/src/app/pages/rfq/helpers/desc-cleaner.ts:98-108` — **40 hard-coded licensor
  and brand names** (`'Disney'`, `'Warner Bros'`, `'Marvel'`, `'DC Comics'`, `'Nickelodeon'`,
  `'Sanrio'`, `'LEGO'`, …).
- Same file, `:115-138` — **~110 hard-coded character and property names** (Mickey Mouse,
  Spider-Man, Elsa, Snoopy, Yoda, Voldemort, …). Merged with the DB list at `:109` and regex-stripped
  from RFQ descriptions before customs classification.
- `addNewProduct.component.ts:28` — `SPRUCE_NON_LIC_DIV_CODE_ID = 9`, a literal division id that
  suppresses licensor/property entirely; the same bare `9` recurs at
  `art-piece-detail.component.ts:352`.
- `addNewProductGrid.component.ts:875-882` — hard-matched title strings `'spruce non-lic'`, `'snl'`.
- `item_library.service.js:20-21,196-198,367,567` — `'05'`, `'06'`, and the magic string `'nonlic'`.
- `newItemFieldPolicy.js:23` / `newItem-field-policy.ts:22` — `licensor: 'non-theme-division'`.

**These ~150 strings will drift from `core.licensor` / `core.property` / `core.character`
permanently, and no database change can fix them.** They are not a blocker to the cutover. They are
a standing correctness debt that a ColdLion-sourced feed makes slightly worse, because the
authoritative list will start moving faster than the hard-coded one.

---

## 4. The blockers, refreshed

The nine blockers come from `COORDINATOR_INTAKE.md` → REQUEST QUEUE → *"Move Licensors and Properties
off Cloud SQL"* (2026-08-03, ~line 2399), restated in
`docs/licensor-property-cloudsql-cutover-plan-20260806.md` §6. Each is re-verified below against the
live system today.

**The count went UP: nine became eleven still-open, plus three newly discovered. Two closed.**

| # | Blocker | Status 2026-08-07 | Evidence |
|---|---|---|---|
| **B1** | App-by-app cutover never surveyed | **PARTIALLY CLOSED — newly** | §3.3 of this document surveyed 7 of 9 repos. `popdam3` and `poppim-web` remain unread |
| **B2** | PLM master-data sync dead since 2026-07-08 | **STILL OPEN — and now 30 days stale** | [MEASURED] last success `2026-07-08 03:30:19`. **Under ColdLion-as-source this blocker changes character entirely — see B2′** |
| **B3** | 111 unparented properties (51 active) | **STILL OPEN, and mis-scoped in every document** | They are in **DesignFlow Cloud SQL**, not Supabase. Supabase has **zero** orphans [MEASURED]. `core.property.licensor_id` is `NOT NULL`, so the representation decision is still required |
| **B4** | No human curation path | **STILL OPEN, zero lines implemented** | `api.db_data_admin_licensor_property_list` and `…_tree` exist in production [MEASURED], but they are **read** functions. No write RPC, no audit table, no proposal table |
| **B5** | `plm.import_master_data()` overwrites `licensor_id` | **STILL OPEN — and worse than the intake says** | `AGENTS.md` §6.12 (added today) proves **no parentage-durability migration exists anywhere**, merged or held. `20260802170000` preserves `status` only. Exposure is **dormant only because the feed is dead** |
| **B6** | Three further overwrite paths | **STILL OPEN** | [DOC] `docs/google-sheets-import-authority-20260803.md` §2.6, §2.8, §2.9 |
| **B7** | 9 properties under the wrong licensor | **STILL OPEN, no evidence gathered** | Wording remains ambiguous: 34 and 38 are *product* counts, not property counts |
| **B8** | Unvalidated DesignFlow write endpoint, 5 roles | **STILL OPEN, citation now corrected** | `designflow-backend/routes/admin.router.js:87` → `admin.service.js:510-554`, writes `parent_id`/`is_active`, never checks `mgTypeCode` [MEASURED today] |
| **B9** | Promotion lane aborts at file 3 of 14 | **STILL OPEN, and it is the trunk** | Designed, not implemented. Production is **39 migrations behind** [MEASURED] |
| **~~B10~~** | **PR #331 unmerged, blocking every schema change** | **CLOSED** | Merged 2026-07-31T13:59:05Z [MEASURED via `gh`]. This was the single biggest blocker in `docs/coldlion-source-of-truth-plan.md` §6. **That document is now stale on its own headline item** |
| **~~B11~~** | Preview ahead of `main` by 4 migrations | **CLOSED** | Same merge |
| **B12** | **NEW — the division-collapse decision** | **OPEN** | `core.licensor` is `unique nulls not distinct (code)`, collapsing the division dimension. Safe today because CW001 and SP001 are identical [MEASURED]. Unsafe the instant EH001/EP001 arrive, where `05` means "Big Theme" |
| **B13** | **NEW — `core.character` is `ON DELETE CASCADE` on `core.property`** | **OPEN** | [MEASURED]. Empty today; the characters workstream is about to fill it. Then a property deletion destroys character rows with no recovery |
| **B14** | **NEW — ColdLion licensor/property never reached production at all** | **OPEN** | `plm.erp_licensor` = 0, `plm.erp_property` = 0, `plm.merch_group_header` = 0, promotion functions absent, `core.taxonomy_source_ref` 100% `designflow_plm` [MEASURED]. Everything proven on preview must still be proven again on production **from an empty start** |

### B2′ — the one blocker ColdLion-as-source genuinely changes

Under the current DesignFlow-sourced design, B2 ("revive the dead feed") is **hard-ordered after
B5/B6**, because reviving it before disarming the overwrite re-arms the destruction of curated data.
[DOC `docs/google-sheets-import-authority-20260803.md`, "Out of scope, deliberately":
*repairing the dead endpoint "must not be done first"*.]

**Under ColdLion-as-source, that edge does not disappear — it moves.** ColdLion's feed does not
overwrite `licensor_id` because ColdLion has no parent to overwrite it with. That sounds like the
problem going away. It is not: it means **the ColdLion feed can never restore a parent either**, so
parentage becomes 100% ours to hold and curate forever, and B4 (the curation path) goes from
"desirable" to **structurally mandatory**. You cannot run a ColdLion-sourced property table without
a curation screen, because there is no other place a parent can come from.

**Net effect on difficulty: neutral-to-worse.** ColdLion-as-source retires one hazard (the
overwriting import) and promotes one requirement from optional to mandatory (curation). It closes
nothing else.

### Additional live-state hazards found today

- **The Supabase branch named `main` reports `status: MIGRATIONS_FAILED`.** [MEASURED via
  `list_branches`.] Not investigated here. Somebody should look before the next promotion.
- **Preview is a Supabase branch**, `shared-db-schema-rehearsal` / `rjyboqwcdzcocqgmsyel`,
  `persistent: true`, `with_data: true`. **It will not appear in `supabase projects list` — its
  absence there is not a bug.** It holds a full production data clone; **treat its data as
  production-sensitive.**
- **`ingest.sync_run` status is not evidence of freshness.** 15 of 15 runs say `succeeded` while the
  feed has been dead for a month. Never accept it as proof.

---

## 5. The ordered plan

Every stage names one deliverable, one observable proof, and one rollback. "The migration applied"
is never accepted as proof — this repository has already produced a ledger row whose object was
absent (preview, 2026-07-23).

**Preview note carried into every stage:** preview holds a full clone of production data. A
rehearsal there is production-sensitive work, not a sandbox.

### Stage 0 — the rehearsal, before anything irreversible

**Deliverable:** a production promotion run that applies an approved list end to end, proven by
object existence (`to_regclass` / `pg_proc` counts), not by the ledger.

Do this on `age_group` (`docs/age-group-cloudsql-migration-plan-20260804.md`), **time-boxed to one
afternoon**. Two rows, no reader, no risk.

**Say this out loud afterwards and do not let anyone soften it:** the rehearsal proves the
*promotion machinery*. **It does not de-risk licensor/property.** That document's own §6.1 answers
"no" to all nine properties that make licensor/property hard.

**Rollback:** code and CI changes; revert the commit. Repoint DesignFlow config back at
`dflow.age_group`, which is untouched throughout.

### Stage 1 — repair the lane (blocker B9)

**Deliverable:** the lane applies a 14-version list end to end without aborting at file 3, with the
closure check that would have caught that abort.

**Mandatory companion deliverable: the mid-promote failure runbook.** PITR is excluded in writing —
restoring production would discard every application write across all four apps. Repair is
**forward-only**: a failed batch is corrected by a new migration with a later version, never by
editing or re-running the failed one. On first failure the operator stops and publishes the exact
set of applied versions.

**Rollback:** none needed — nothing has been promoted yet. That is the point of doing it first.

### Stage 2 — make parentage durable (blockers B5, B6)

**Deliverable:** no import path of any kind can overwrite a curated `licensor_id`, `status`, `name`
or `code`, proven by a regression test that fails if anyone re-adds an unguarded assignment.

**This must land before the DesignFlow feed is repaired and before any ColdLion promotion writes to
`core.property`.** `AGENTS.md` §6.12 is explicit: no such migration exists today, and the exposure
is dormant only because the feed is dead.

**Standing rule to write into the migration comment: the feed is not authoritative for absence.**
A row missing from a feed does not mean delete, does not mean deactivate, does not mean re-parent.
This matters more under ColdLion than under DesignFlow, because ColdLion has no active flag at all —
so under any absence-implies-something rule, every one of the 92,173 asset links in §3.1 is exposed.

**Note the tension with `AGENTS.md` §6.3 and resolve it explicitly with Albert.** §6.3 says *follow
ColdLion when it removes a licensor or property*. That ruling was given about **vendors**, where the
blast radius was 442 bronze rows. Applying it unmodified to licensors and properties means accepting
silent `SET NULL` on up to 92,173 PopDAM rows. **This is a real conflict between two things the owner
has said, and it needs one sentence from him. It should not be resolved by an agent.** Recommended
resolution to put to him: follow ColdLion into `inactive`, never into `deleted`.

**Rollback:** every step here *removes* a write. None adds one. None can break a reading app. The
rollback (restoring the old function) is strictly more destructive than the failure it would undo —
prefer forward fix.

### Stage 3 — build the curation path (blocker B4) — now mandatory, not optional

**Deliverable:** a named human can set a property's parent, with evidence, and the change is
recorded structurally — including changes made outside the UI.

Under ColdLion-as-source this is not a nice-to-have. **ColdLion cannot supply a parent, and
`licensor_id` is `NOT NULL`, so the curation screen is the only mechanism by which a ColdLion
property can exist at all.**

Required objects, in order: an append-only `core.property_parent_audit`; an **unconditional trigger**
on `core.property` so a direct `service_role` UPDATE is also recorded (tagged `out_of_band`); a
`SECURITY DEFINER` RPC gated on `app.require_db_data_admin_access()`; a proposal landing table where
**no trigger ever auto-promotes an accepted proposal**; and picker/health views with
`security_invoker = true` (three views in this repo previously leaked ~16,600 rows to `anon` by
omitting it).

Pair it with the triage page Albert already required
(`docs/licensor-property-triage-page-requirement-20260806.md`, `AGENTS.md` §6.10 ruling 4).

**Rollback:** purely additive — `drop` the objects. The one object with a live blast radius is the
trigger; drop it alone if it misbehaves, and the audit history survives.

### Stage 4 — fix the resolver, THEN admit the 47 (blockers B7, and the §6.9 ordering)

**Deliverable:** the 47-row decision sheet from §2.6, ruled by Albert, landed as a new approved-
mapping artifact with a new hash and a new approval.

**The order is a settled owner ruling and is not negotiable** (`AGENTS.md` §6.9): **fix the
status-blind resolver first, then admit the codes, in ONE reviewed change.** A PR that only admits
the codes is out of compliance even if the resolver fix is "planned next".

**And before any of it:** fix `tools/validate-licensing-answers.mjs` (property lookup, ~lines 86-92),
which resolves properties with `where p.code = any($1)` — **no licensor scope**. It is safe only
because today's `core.property` is crippled to one row per code. Repairing the feed before fixing
that query introduces silent wrong-licensor binding. [DOC `AGENTS.md` §6.10 ruling 3]

Execute the 7-step sequence in Albert's exact fixed order: import `FK`, `NA`, `ZG`; re-point property
`FK`; re-home anything under `FR`; reconcile `X-NASA` → `NA`; **remove `FR` LAST**. Take a full
status snapshot **before** starting — there is no history table, so without it "go back and
inactivate again" is guesswork. Respect the `AGENTS.md` §6.5 pairing: PR #408 ships in the same
production window as the `FR` removal.

**Rollback:** the audit table records `previous_licensor_id`, so parent corrections are reversible.
The `FR` removal is **not** reversible without the pre-snapshot. Take it.

### Stage 5 — promote the ColdLion lane to production (blocker B14)

**Deliverable:** `plm.erp_licensor` and `plm.erp_property` hold live ColdLion rows in production, the
promotion functions exist, and `core.taxonomy_source_ref` carries `coldlion` provenance alongside
`designflow_plm`.

Sequence: bounded migration apply → **read-only 542-row identity proof before any write** → one
mirror-only snapshot → approved promotion → hourly health plus deliberate +1h / +4h / +24h checks.

**This is an explicit owner gate.** It requires Albert to name, in chat: the project ref, the exact
migration versions, the modes, the cron strings, the repo variable
`COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED`, and creation of the `SUPABASE_DB_PASSWORD_PRODUCTION`
secret. **A general "go ahead" does not count.** Neither the variable nor the secret exists today, by
design.

**Do not unblock any `HARD_BLOCKED` ColdLion migration on its own** — settled ruling,
`AGENTS.md` §6.8. The count is **six**, not four. Any unblocking ships bundled with its negative test
and a whole-batch pre-flight.

**Rollback:** the mirror tables are additive and can be truncated. Once `promote_*` has written to
`core.property`, rollback is forward-only. **That is the last reversible moment in the whole plan.**

### Stage 6 — parallel run, then cut the apps over

Run ColdLion and DesignFlow side by side and compare daily (the harness exists:
`tools/compare-coldlion-designflow-daily.mjs`). Only after a quiet parallel run does any application
change what it reads.

Order: **Poppim first (0 rows, nothing to break) → PopCRM (0 rows in its own table) → PopDAM
(92,173 rows — last, and only with a written blank-out check) → DesignFlow (its own Cloud SQL is the
real cutover, and it is DesignFlow-team work, not shared-db work).**

**Rollback:** per app, repoint its read. **But note the rollback that stops working after Stage 4:**
once the shared copy holds corrected parents and `FR` is gone, the Cloud SQL copy is no longer a
clean mirror — repointing back reinstates data we deliberately fixed.

### Stage 7 — give customers and vendors a real schedule

Both are already "cut over to ColdLion" on the scoreboard, and **neither has any recurring feed**
[MEASURED: last refreshed 2026-07-17 and 2026-07-22, by hand]. Customers has **no runner script at
all**. This is cheap, low-risk, entirely separable from everything above, and it is the one place
where "ColdLion is the source" is currently a claim rather than a fact.

---

## 6. What this document extends, and where each source is now wrong

**Say this plainly: most of this analysis already existed. This document updates and extends it. It
does not replace it.**

| Document | What I am extending | Where it is now WRONG or stale |
|---|---|---|
| `COORDINATOR_INTAKE.md` → *"Move Licensors and Properties off Cloud SQL"* (~line 2399) | the nine blockers, re-verified one by one in §4 | **"111 unparented properties" reads as a Supabase condition. It is not — Supabase has zero orphans.** Blocker 8's citation is the wrong file (corrected in §3.3). The count is now eleven open plus three new |
| `docs/licensor-property-cloudsql-cutover-plan-20260806.md` | the six-phase structure, the dependency graph, the mid-promote runbook requirement — all adopted | Written for **DesignFlow-authoritative**, not ColdLion-authoritative. Its §9 says the orphan count "required Cloud SQL access nobody had" — that is now closed in principle. It states "no database was read" — this document closes that gap for the Supabase side |
| `docs/coldlion-source-of-truth-plan.md` (2026-07-31) | the 542-mapping gate, the two permanent ColdLion limits, the merch-group type matrix | **Its headline is dead: "the one thing in the way" was PR #331, which merged 2026-07-31T13:59:05Z.** Blockers B1 and B2 of its §6 are closed. Its counts were preview-only; §1.3 here supplies production. It says `core.customer` 864 — production reads **862** today |
| `docs/coldlion-erp-api-reference.md` | endpoints, auth, paging, the division matrix | Says "22 licensors and 258 properties verified live 2026-07-23". **Live today: 22 and 285.** Property count is stale by 27 |
| `docs/merch-group-taxonomy-architecture.md` | the `(division, type)` semantics, the code-collision warning | Quotes 258 properties and 68 artists. **Live: 285 and 53.** |
| `docs/master-data-cutover-scoreboard.md` | the sequencing decision of 2026-07-23 | Marks Customer and Vendor ✅ **cut over**. Neither has a recurring feed. The honest statement is "canonical source is ColdLion; last refreshed by hand in July" |
| `AGENTS.md` §6.3 | the canonical ruling — the foundation of this whole document | Given about **vendors**. Applying "follow ColdLion into deletion" to licensors/properties puts 92,173 PopDAM rows at risk. §5 Stage 2 asks Albert to scope it |
| `AGENTS.md` §6.9 | the 33-code ordering ruling | Its own caveat ("the 33 has not been independently re-verified") is now **closed: 33 confirmed live on production, 2026-08-07** |
| `AGENTS.md` §6.10-A | the 2026-08-06 production measurements | Holds. The "241 of 322 codes under more than one licensor / 75%" figure remains **unverified** and I did not reproduce it either |
| `docs/designflow-master-data-migration/README.md` §4.2 | the endpoint documentation | Does not record that the endpoint **drops childless licensors** (`:131`) or that its licensor query does not filter `is_active`. Both measured today |

---

## 7. The honest verdict on difficulty

**It is still the hardest table set to move. ColdLion-as-source does not change that, and in one
specific way it makes it harder.**

The 2026-08-03 intake told Albert this plainly and it was right. Nothing measured today softens it:

- **The blocker count went up, not down.** Two closed (PR #331 and its preview drift). Nine remain
  open. Three new ones found (B12 division collapse, B13 character cascade, B14 nothing in
  production). Net **eleven open**.
- **Production is further from ready than any document implies.** Not "mostly there and waiting for
  approval" — `plm.erp_licensor` and `plm.erp_property` are **empty**, the promotion functions **do
  not exist**, provenance is **100% DesignFlow**, and production is **39 migrations behind**.
  Everything proven on preview must be proven again on production from zero.
- **ColdLion-as-source makes curation mandatory.** Under the DesignFlow feed, a parent arrives (badly,
  but it arrives). Under ColdLion, no parent ever arrives, and `licensor_id` is `NOT NULL`. The
  curation path stops being a quality improvement and becomes **the only way a row can exist**.
  That promotes blocker B4 from parallel work onto the critical path.
- **The one thing that genuinely got easier is the mapping** — and it got much easier. Zero name
  differences, 271 identities already approved and still valid, 47 rows left to rule on.

**`age_group` should still be the rehearsal first.** It is two rows, no reader, one afternoon, and it
proves the promotion lane that every one of these blockers has to pass through. It is not a detour
from Albert's priority; it is the safety rehearsal for it. Do not let anyone report afterwards that
"licensor/property is now de-risked" — it will not be.

---

## 8. Options for Albert — plain English, reads standalone

**The short version.** ColdLion and our database agree on the names of everything they share — all
271 of them, exactly. The disagreement is about *which* brands are on each list: about 47 rows.
That is a manageable list you could review in an afternoon.

The real risk is different from the one you expected. ColdLion cannot tell us two things, ever:
which brand belongs to which owner (is Batman under DC or Warner?), and whether a licence has
expired. Our database refuses to store a brand without an owner. So switching to ColdLion means
**we take over owning those two facts by hand, permanently.**

And one number should shape the decision: **92,173 PopDAM image records point at our licensor list.**
If ColdLion drops a licensor and we follow it blindly, those records lose their tag silently — no
error message, no way to tell which ones.

---

### Option A — Fix the freshness problem first, decide the source later
**What changes:** we get the ColdLion customer and vendor lists onto an automatic schedule. Right
now they were last updated by hand on 17 and 22 July. Licensors and properties are untouched.
**What could break:** almost nothing. These two lists have no image records hanging off them.
**Cost to undo:** turn off a scheduled job. Minutes.
**How long:** about a week.

### Option B — Rehearse the plumbing on a two-row table, then decide
**What changes:** we move one tiny, boring table (`age_group`, two rows, no screen reads it) through
the whole pipeline to prove the machinery works. Today that machinery **stops a third of the way
through and leaves the database half-updated**. Nobody has ever run it successfully end to end.
**What could break:** nothing user-visible. That is the point.
**Cost to undo:** one config change. Minutes.
**How long:** about an afternoon of work, plus a week to fix what it exposes.

### Option C — Do the full ColdLion switch for licensors and properties
**What changes:** ColdLion becomes the master list. It requires, in order: the plumbing fixed
(Option B), a rule that stops imports overwriting your corrections, a screen where you assign brand
owners by hand, your rulings on the 47 rows, and then a side-by-side trial run before any app
changes.
**What could break:** the big one is those 92,173 PopDAM records. There are also about 150 brand and
character names typed directly into DesignFlow's code that no database change can keep in step.
**Cost to undo:** reversible up until the moment ColdLion first writes to the shared brand list.
After that it is forward-only — no undo button, only new corrections.
**How long:** realistically two to three months, and that assumes nothing else takes priority.

### Option D — Leave the source alone, just stop the silence
**What changes:** we add an alarm so that when a feed dies, somebody is told. It has been dead 30
days and the database still reports every run as successful.
**What could break:** nothing.
**Cost to undo:** delete the alarm.
**How long:** a day or two.

---

### My recommendation

**Do D and B now, in that order, then A. Hold C until B has actually succeeded once.**

**One line of reasoning:** every path to ColdLion runs through a pipeline that has never once
completed a run, so proving that pipeline on a two-row table is the cheapest possible way to find out
what is really wrong — and an alarm costs a day and would have told you a month ago.

### The one question only you can answer

When ColdLion drops a licensor or a property, what should we do?

- **Mark it inactive, keep the record.** Nothing loses its tag. Dead brands linger on lists until
  someone tidies up.
- **Delete it, following ColdLion exactly.** Matches your 2026-07-31 ruling — but that ruling was
  about vendors, where the blast radius was small. Here it can silently blank the tag on up to
  **92,173** PopDAM image records.

**I recommend marking inactive.** Deleting is the only step in this whole plan with no undo.

---

## 9. What I did NOT do, and what is still unknown

### Did not do

- **No migration was written. No file under `supabase/` was touched. No database write of any kind
  — not preview, not production, not Cloud SQL.**
- No `supabase` CLI, no `psql`, no `apply_migration`, no branch operation, no merge.
- **No call that mutates any external system.** The ColdLion calls were read-only `GET`s.
- No background task chip.
- Did not touch `HANDOFF.md`, `AGENTS.md`, `COORDINATOR_INTAKE.md`, or any other agent's directory.
- Did not use the shared checkout at `C:/repos/shared-db`.
- **No credential value was written into any file, doc, commit, report or chat.** The ColdLion API
  key was injected into a local process from 1Password vault `vibe_coding` and never surfaced.
- Did not re-verify the approved-mapping artifact's md5 by opening the file.
- Did not resolve whether the Supabase branch named `main` reporting `MIGRATIONS_FAILED` matters.

### Still unknown, and what would close it

| Unknown | Why | What closes it |
|---|---|---|
| **How PopDAM (`popdam3`) actually reads licensor/property, and whether it hard-codes UUIDs** | the repo is **not checked out on this machine** — searched `C:/repos` and `D:/` (D: does not exist) | clone `u2giants/popdam3` and grep for UUID literals, `core.licensor`, `public.licensors`, and brand-name string constants. **This is the single largest remaining gap, and PopDAM is the heaviest consumer at 92,173 rows** |
| **How Poppim (`poppim-web`) reads it** | same — not on this machine | clone and grep. Lower urgency: its `pim.*` tables hold 0 rows |
| Whether property codes really repeat under multiple licensors (the unverified "75%" claim) | production's copy is crippled to one row per code, so it cannot be seen from Supabase | a `count(*) group by mgCode having count(distinct parent) > 1` against DesignFlow's Cloud SQL `merchGroup` — the read-only account exists (1Password `tcaf3o3u2cx52g6ivvczxbhola`) |
| The live DesignFlow orphan count (111 / 51 is from a 2026-05-07 snapshot) | same account was never used | run Q1 and Q2 from `docs/dflow-parent-logic-and-curation-home-20260803.md:165-185` |
| Whether the 9 wrong parents are 9 properties or 9 something-else | the intake says "9 properties" but cites 34 and 38 **product** counts | count it before writing any correction migration |
| Whether preview's circuit breaker is still tripped and its ~15 alerts unacknowledged | the Supabase MCP points at **production only**; preview was never contacted | a read-only session against `rjyboqwcdzcocqgmsyel` |
| Why the Supabase branch `main` reports `MIGRATIONS_FAILED` | out of scope | investigate before the next promotion |

### Systems contacted

| System | Ref / URL | Access |
|---|---|---|
| Supabase **production** | `qsllyeztdwjgirsysgai` — confirmed by `get_project_url` before every read | **read-only `select` and catalog queries only** |
| Supabase preview | `rjyboqwcdzcocqgmsyel` | **not contacted** (listed via `list_branches` metadata only) |
| ColdLion ERP API | `http://x5.coldlion.com/EhpApi/merchGroupDetails` | **read-only `GET`**, 12 calls, key from 1Password `vibe_coding` |
| GitHub | `u2giants/shared-db` | `gh pr view 331`, `gh pr list` — read-only |
| Local repos | `C:/repos/popcrm-web`, `C:/repos/dflow/designflow-*` (6) | **read-only** |
| 1Password | vault `vibe_coding`, one item, fetched once | value never surfaced |
