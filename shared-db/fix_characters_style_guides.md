# Characters and style guides — canonical migration plan

**Status (2026-07-26): PHASES 0–1 COMPLETE. Waiting for the licensing team's
corrected 335-row review sheet, expected in 24–48 hours.**
No schema change has been written. No database has been modified. All work so far is
read-only investigation and documentation.

**Repository:** `u2giants/shared-db` · **Preview:** `rjyboqwcdzcocqgmsyel` ·
**Production:** `qsllyeztdwjgirsysgai`

---

## 0. Read this first

**Do not start any phase before reading
[`docs/style-guides-characters-and-royalties.md`](docs/style-guides-characters-and-royalties.md)
end to end.** It is the model. This file is only the execution sequence; it deliberately does not
repeat the model, and acting on this plan without that doc has already caused three modelling
errors (recorded in its §6).

The three things that trip everyone up, in one paragraph: the licensing table
`dflow.properties_and_characters` is **misleadingly named** — its `type='PROPERTY'` rows are
**style guides**, not properties, and its `type='CHARACTER'` rows are character **appearances**
(one per style guide), not distinct characters. Ownership is linear
(`Licensor → Property → Character`, one property per character) but style is many-to-many
(a style guide holds many characters; a character appears in many style guides). A style guide is
**not** a level between property and character.

Also read, in this order:
1. [`AGENTS.md`](AGENTS.md) §4 (anti-collision), §4.1 (shared vs app-owned), §5 (merge protocol), §8.1 (`dam` is not PostgREST-exposed).
2. [`docs/merch-group-taxonomy-architecture.md`](docs/merch-group-taxonomy-architecture.md) — the other, separate licensor spine.
3. [`fix_coldlion_licensor_property_cutover.md`](fix_coldlion_licensor_property_cutover.md) — **check its status header before every phase**; it owns properties and is mid-flight (§8 below).

## 1. What this plan delivers

Characters and style guides currently exist in three disconnected places and in **no** canonical
table. `core.character` has **0 rows**. This plan lands them canonically:

| Deliverable | Home | Why |
|---|---|---|
| Character identities (one row per character) | `core.character` | DAM + PM + probably PLM read it |
| Style guide names | `core.style_guide` (new) | same |
| Style guide ↔ character links | `core.style_guide_character` (new) | same |
| Style guide **files** (279,783) | `dam.style_guide_file` | PopDAM/PopSG only — stays app-owned |
| Asset ↔ character links (117,012) | `dam.asset_character` | PopDAM only |

Target DDL is in the model doc §5A. The shared/app-owned split and its rationale are in §5A.0a.

## 2. Where the data physically is today

| Data, where it lives now | Rows | Destination | Rows now |
|---|---:|---|---:|
| `public.characters` — **already carries `property_id` on every row** | 9,622 | `core.character` | 0 |
| `public.style_guide_files` — crawled from `edge1`, folder tree **already parsed** into licensor/property/style-guide columns | 279,783 | `dam.style_guide_file` | 0 |
| `public.asset_characters` | 117,012 | `dam.asset_character` | 0 |
| `dflow.properties_and_characters` (500 style guides + 9,622 appearances) | 10,122 | source for `core.style_guide` + bridge | — |
| `dflow.property_character_associations` — **is** the style-guide↔character bridge | 9,622 | `core.style_guide_character` | 0 |

`public.*` is PopDAM's legacy pre-shared-db schema, not a naming convention. The correctly-named
destinations already exist and are empty.

---

## Phase 0 — source decision (COMPLETE 2026-07-26)

**Owner decision:** use the hybrid approach.

Every character in `public.characters` already has a `property_id`, covering the same 335 parent
style guides as the legacy spine. The licensing sheet now contains all 335 style guides in one
complete decision list (§9).

- **Branch A — promote DAM's existing mapping.** Trust `public.characters.property_id`, verify a
  sample, skip the manual review. Fast; depends on DAM's mapping being correct and on its
  `public.properties` (500, licensing-catalogue scope) reconciling to `core.property`
  (256, Coldlion scope) — which the model doc §5A.2 says is deliberately narrower.
- **Branch B — licensing-team review.** Send the sheet, get authoritative MG06 codes back,
  build from that. Slower, higher confidence, and resolves the 74 titles that have no property
  anywhere.

Phase 1 proved that DAM's `property_id` points at licensing/style-guide catalogue parents that
mostly do not exist in `core.property`: only **367 of 9,622** appearances directly agree with a
canonical property, while **9,255** require another mapping rule or review.

The approved hybrid rules are:

1. Accept the **367 direct agreements**.
2. Apply the already-decided Disney Classics → `CP` and no-code rules.
3. Use the licensing team's corrected **335-row** sheet. It contains 21 accepted direct parents,
   five accepted Classics, three accepted no-code titles, and **306 rows needing review**.

The licensing-team sheet is expected in **24–48 hours**. Its delay blocks the Phase 3 backfill,
not the additive Phase 2 schema design. The owner's earlier instruction not to write a migration
remains in force until new approval is given.

**Merge rule:** the 367 figure counts appearances under 21 accepted parents. It is not combined
arithmetically with the old 149/8/4/174 suggestion buckets. The corrected sheet is the single
row-level source for all 335 style guides. Only rows marked `ACCEPTED_*` are automatic.

---

## Phase 1 — reconcile the two property populations (COMPLETE 2026-07-26)

**Goal:** a written, evidence-backed answer to "can `public.characters.property_id` be trusted as
the canonical parent, and for how many rows?"

**Do:** compare `public.properties` (500) against `core.property` (256) by code, by normalized
name, and by provenance in `core.taxonomy_source_ref`. Quantify: how many of the 9,622 characters
land on a property that exists canonically, how many do not, and why not (classics → `CP`,
no-code titles, genuinely missing).

**Result:** complete in
[`docs/verification/characters-property-reconcile-20260726/`](docs/verification/characters-property-reconcile-20260726/README.md).
The read-only evidence found 367 directly reconcilable appearances and a 9,255-appearance
residual across 314 populated licensing/style-guide parents. No database writes occurred.

**Before finishing:** re-read Phases 2–7 and report drift.

---

## Phase 2 — additive schema on preview

**Goal:** create `core.style_guide` and `core.style_guide_character` per model doc §5A.

**Do:** one new timestamped migration. **Additive only** — creates two tables, touches nothing
existing. Include the `parent_style_guide_id` self-reference for sub-style guides. Do **not** add
a likeness column to any of these (likeness lives on the app-owned file row, model doc §2.2).
Apply to **preview only**. Add grants/RLS following the pattern of neighbouring `core.*` tables —
remember an RLS policy is **not** a grant (AGENTS.md §11).

**Exit:** `scripts/check-sql.sh` clean, `supabase db push --dry-run` clean, applied on preview,
tables exist and are empty. Production untouched.

**Before finishing:** re-read Phases 3–7 and report drift.

---

## Phase 3 — backfill on preview, with reconciliation

**Goal:** populate the three canonical tables on **preview** from the agreed source (Phase 0).

**Order matters:** style guides → characters → bridge. Every insert carries provenance into
`core.taxonomy_source_ref` (`source_system`, `source_table`, `source_id`) — new `source_table`
values for this spine, never `merchGroup`.

**Must exclude the royalty sentinels** — `NO REPORTABLE ELEMENTS` (154 style guides),
`NO CHARACTER LIKENESS` (15), `LOGO` (13). They are reporting placeholders, not characters
(model doc §2.3). Loading them as characters is a data-quality failure that is hard to unpick.

**Must resolve character identity before insert.** The 9,622 legacy rows are *appearances*; each
must map to one canonical character, or the duplication is recreated. Distinct normalized names
cap at 8,307, but names carry qualifiers (`ROBIN AKA DICK GRAYSON`) so this needs an explicit
rule — see model doc §7 question 4. **This is the single most likely place to get it wrong.**

**Reconciliation checks (all must pass, all recorded):**
- row counts in vs out, with every exclusion explained by number
- zero duplicate `(style_guide, character)` bridge rows
- zero characters with a missing/dangling `property_id`
- zero orphan bridge rows at either end
- **idempotency:** running the backfill twice changes nothing the second time
- sentinels absent from `core.character`
- spot-check Batman: **one** character row, **15** bridge rows

**Exit:** all checks green on preview, evidence written to `docs/verification/`.

**Before finishing:** re-read Phases 4–7 and report drift.

---

## Phase 4 — app-owned relocation (DAM), preview

**Goal:** move DAM's private data into its correctly-named homes —
`public.style_guide_files` → `dam.style_guide_file`, `public.asset_characters` →
`dam.asset_character`.

> **The order is not negotiable: COPY → REPOINT THE APP → RETIRE THE OLD TABLE.**
> Never `ALTER TABLE ... SET SCHEMA` a table a live app reads. Doing exactly that broke dflow's
> sample tracking on 2026-07-21 and had to be reverted by migration
> `20260721201500_restore_dflow_sample_tracking_tables.sql`. See the warning box in
> [`docs/designflow-master-data-migration/designflow-schema-segregation.md`](docs/designflow-master-data-migration/designflow-schema-segregation.md).

Note `dam` is **not** PostgREST-exposed and must not be exposed (AGENTS.md §8.1). DAM's workers
reach `dam.*` through `public` `SECURITY DEFINER` functions. Confirm DAM's actual read paths
before moving anything.

**Exit:** copies populated and verified on preview; app repointing specified (not yet done — app
changes are a separate repo and happen only after the shared change is applied and verified).

**Before finishing:** re-read Phases 5–7 and report drift.

---

## Phase 5 — production apply

**Goal:** apply Phases 2–4 to production in an approved window.

**Gate:** the full AGENTS.md §5 merge checklist, plus explicit owner approval, plus §8 sequencing
below. Additive schema first; backfill second; retirement of old tables **last and separately**.

**Before finishing:** re-read Phases 6–7 and report drift.

---

## Phase 6 — consumer wiring (app repos)

Only after the shared change is applied **and verified** in production. Then DAM/PM/PLM repos may
point at `core.character` / `core.style_guide`. Per AGENTS.md, app repos never author schema.

**Before finishing:** re-read Phase 7 and report drift.

---

## Phase 7 — retire the legacy copies

Drop or archive `public.characters`, `public.asset_characters`, `public.style_guide_files` only
once every consumer is verified off them. Removal needs explicit owner sign-off (AGENTS.md §4
rule 3). **Expect this to be months later, not days.**

---

## 8. Sequencing against the ColdLion cutover (MANDATORY CHECK)

Characters hang off properties, and properties are being re-sourced right now by
[`fix_coldlion_licensor_property_cutover.md`](fix_coldlion_licensor_property_cutover.md).

As of **2026-07-26**: Phases 0–5 complete (5 not needed); the former 14-day ColdLion Phase 6
waiting rule is retired in favor of invariant readiness, preview rollback/alert proof, and explicit
production approval. Phase 7 production execution remains unauthorized and production untouched.

- This plan is **not blocked** — production properties remain stable, so Phases 0–4
  here can proceed.
- **Do not land Phase 5 (production apply) in the same window as their Phase 7.** Both touch the
  property spine; AGENTS.md §4 rule 1 allows one schema change in flight.
- **Re-read their status header before starting any phase here.** It changes daily.

## 9. Assets already produced (do not rebuild these)

| Asset | Where |
|---|---|
| The model, rules, and decisions | [`docs/style-guides-characters-and-royalties.md`](docs/style-guides-characters-and-royalties.md) |
| Licensing-team decision sheet (all 335 rows; 306 need review) + inputs + capture notes | [`docs/verification/style-guide-property-mapping-20260726/`](docs/verification/style-guide-property-mapping-20260726/README.md) |
| Regenerator for that sheet | `tools/generate-style-guide-property-mapping.mjs` |

The original 174-row sheet was replaced after independent review found that it did not cover
the residual left by the 367 accepted appearances. The corrected 335-row sheet has 306 open
rows and is **not yet returned by the licensing team**. Expected in 24–48 hours.

## 10. What was tried that did NOT work

Recording these so nobody repeats them. The first three are modelling errors, detailed in the
model doc §6.

1. **Reading `type='PROPERTY'` literally.** Concluded 313 "properties" were missing from
   `core.property` and needed creating. They are **style guides**. Creating them as properties
   would have permanently corrupted the property list and every property picker.
2. **Chaining the two axes** into `Property → Style guide → Character`. Duplicates every character
   once per style guide and makes a character's property unanswerable.
3. **Assuming the likeness split was a contract artifact** irrelevant to classification. It is a
   real royalty rule (Marvel only, +2%) and attaches to the **style-guide asset file**.
4. **Matching style guides only against `core.property` (256 rows).** Missed that Coldlion carries
   318 distinct properties, and that `TS = "TOY STORY 4"` is the Toy Story bucket. Match against
   the Coldlion dictionary, not our narrower mirror.
5. **One-directional prefix matching.** "Toy Story" is not a prefix of "TOY STORY 4", so the whole
   Toy Story franchise looked absent. Match both directions plus token overlap.
6. **Unconstrained folder matching.** Produced cross-licensor nonsense (Pirates of the Caribbean →
   a Marvel archive folder). Constrain candidates to the same licensor.
7. **Over-tightening the matcher** to remove low-confidence noise. Dropped good matches and cut
   coverage. For a human review sheet, a visible low-confidence guess beats a blank.
8. **The old 174-row-only sheet.** It hid the automatic rows and made two different matching
   tracks look complete when they were not. The corrected sheet includes all 335 rows and labels
   the 306 rows that still need a decision.

## 11. Document history

| Date | Change |
|---|---|
| 2026-07-26 | Created. Phases 0–7 defined; Phase 0 open pending owner decision. |
| 2026-07-26 | Phases 0–1 completed. Owner approved the hybrid source: accept 367 direct agreements, apply Classics/no-code rules, and wait for the 174-row licensing review for the residual mapping. |
| 2026-07-26 | Grok review found the 367 and 174 tracks did not cover the same population. Replaced the sheet with one 335-row list: 21 accepted direct parents, 5 confirmed Classics, 3 confirmed no-code titles, 306 review rows. |
