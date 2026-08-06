# Characters and style guides — canonical migration plan

**Status (2026-07-31): PHASES 0–2 COMPLETE. Phase 3 is BLOCKED on a second licensing round.**
The additive style-axis schema exists and is empty on **preview only**
(`rjyboqwcdzcocqgmsyel`). **Production is untouched** — `core.style_guide` and
`core.style_guide_character` do not exist there and migration `20260727230000` is not in its
ledger. **No row has been written to any database by this plan.**

> **A fresh session starts here:** round 2 returned 157/166 on 2026-08-04 and **round 3 is 8 rows**
> (built 2026-08-04, see "Licensing round 3"). Wait for those 8 answers and the
> owner's ruling on the missing property codes `EX` / `LB` / `JL` (§8a). The third open owner
> decision — whether multi-character rows get split — was **answered on 2026-08-04: they do
> not** (§8a point 2). Do **not** start the
> Phase 3 backfill before both land — it writes to three shared tables and must be scheduled by
> whoever owns collision control.

| Phase | State | Date | Evidence / next action |
|---|---|---|---|
| 0. Source decision | ✅ Complete | 2026-07-26 | Owner-approved hybrid rules; §Phase 0 |
| 1. Reconcile the two property populations | ✅ Complete | 2026-07-26 | `docs/verification/characters-property-reconcile-20260726/` |
| 2. Additive schema on preview | ✅ Complete | 2026-07-28 | Migration `20260727230000_core_style_guide_axis.sql` (PR #284); both tables verified present and **empty** on preview; production verified untouched. **Do not redo.** |
| 3. Backfill on preview | 🟡 Rules built and tested; **backfill NOT started** | 2026-07-31 | `tools/resolve-character-identity.mjs` (**32 unit tests pass**), evidence in `docs/verification/character-identity-rules-20260728/`. 9,622 appearances → 6,538 characters. **Blocked on** licensing round 2 + the §8a code ruling. |
| 4. App-owned relocation (DAM) | ⬜ Open | — | Not started |
| 5. Production apply | ⬜ Open | — | Needs the full AGENTS.md §5 checklist plus explicit owner approval |
| 6. Consumer wiring (app repos) | ⬜ Open | — | Only after Phase 5 is verified in production |
| 7. Retire the legacy copies | ⬜ Open | — | Months away; needs explicit owner sign-off |

**Licensing is NOT finished.** An earlier version of this header said "no licensing follow-up
remains". That was true of the 2026-07-27 review and is now wrong: round 1 came back with only 29
of 195 answers usable, and **166 questions went back out on 2026-07-31**. See "Licensing round 1"
and "Licensing round 2" below.

> A concurrent closeout session wrote a status here on 2026-07-28 saying the Phase 2 work was an
> unmerged draft with "no PR and no recorded preview rehearsal" and that owner approval was still
> outstanding. That was a true snapshot of an in-flight branch, not a standing block: the owner
> instructed "start Phase 2" in-session, which is the new approval Phase 0 was waiting for, and
> Phase 2's own text authorizes the preview apply. The apply and its object-level verification are
> recorded in the Phase 2 section below.

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
3. Automatically accept 153 clear existing MG06 name matches.
4. Use the licensing team's **153-row** sheet only for uncertain choices.

The licensing team returned all 153 answers on 2026-07-27:

- **32** style guides received an existing MG06 code; every code validates against Coldlion.
- **118** are `NEVER_DESIGNED`; keep the style guide, leave `property_id` null, and never create
  a placeholder property.
- **3** are `MULTIPLE`; leave the style guide's `property_id` null because property depends on
  the character: Marvel Cross-Franchise Art Packs, DC Super Friends Collection Comics, DC Women Core.

Read-only character and franchise rules classify all 338 `MULTIPLE` appearances:
248 by the closest specific existing MG06 franchise, 13 by one unique same-licensor historical
match, and 66 by the existing `MV` Marvel Assorted Styles catch-all. Nine non-character labels
and two royalty sentinels are excluded. **No licensing follow-up remains.** Evidence:
[`docs/verification/style-guide-licensing-review-20260727/`](docs/verification/style-guide-licensing-review-20260727/README.md).

This remaining character review blocks the Phase 3 backfill, not the additive Phase 2 schema
design. The owner's earlier instruction not to write a migration remains in force until new
approval is given.

**Merge rule:** the 367 figure counts appearances under 21 accepted parents. It is not combined
arithmetically with the old 149/8/4/174 suggestion buckets. The generator is the single
row-level source for all 335 style guides: 182 automatic decisions and 153 human decisions.

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

## Phase 2 — additive schema on preview (COMPLETE 2026-07-28)

**Goal:** create `core.style_guide` and `core.style_guide_character` per model doc §5A.

**Current state (2026-07-28):** migration
`supabase/migrations/20260727230000_core_style_guide_axis.sql` is committed and pushed only on
`codex/characters-style-guides-phase2-20260727` at `e0657f7`. It has no PR and no recorded
preview dry-run or apply. Rebase it onto current `origin/main`, review it against the current
migration ledger, and obtain owner approval before any preview write.

**Do:** one new timestamped migration. **Additive only** — creates two tables, touches nothing
existing. Include the `parent_style_guide_id` self-reference for sub-style guides. Do **not** add
a likeness column to any of these (likeness lives on the app-owned file row, model doc §2.2).
Apply to **preview only**. Add grants/RLS following the pattern of neighbouring `core.*` tables —
remember an RLS policy is **not** a grant (AGENTS.md §11).

**Exit:** `scripts/check-sql.sh` clean, `supabase db push --dry-run` clean, applied on preview,
tables exist and are empty. Production untouched.

**Result:** complete. Migration
[`supabase/migrations/20260727230000_core_style_guide_axis.sql`](supabase/migrations/20260727230000_core_style_guide_axis.sql).

Verified directly against preview objects (not the ledger — AGENTS.md §4 rule 5):

- both tables exist and hold **0 rows**;
- `property_id` and `parent_style_guide_id` are nullable, with the
  `style_guide_not_own_parent` check constraint;
- FKs: `licensor_id`/`property_id`/`parent_style_guide_id` → `on delete set null`; both bridge
  FKs → `on delete cascade`; bridge PK is `(style_guide_id, character_id)`;
- RLS on for both, each with `shared_read` (SELECT) and `admin_write` (ALL);
- grants: `select` to `authenticated`, full to `service_role` (the policy is not the grant);
- `set_updated_at` trigger present on `core.style_guide` only (the bridge has no `updated_at`);
- indexes: licensor, property, parent, `(status, name)`, the partial unique
  `(licensor_id, code) where code is not null`, and the reverse bridge index on `character_id`.
- **Production checked and untouched:** both `to_regclass` lookups return null and version
  `20260727230000` is absent from its ledger.

No likeness column was added, and no placeholder property was invented — both deliberate
(model doc §2.2 and §5A.0 rule 3).

**Blocker cleared on the way (worth knowing):** the first preview dry-run aborted with
`Remote migration versions not found in local migrations directory` naming three ColdLion
versions (`20260727221500`, `20260727223000`, `20260727224500`). They were a concurrent
workstream's rehearsal that had not yet reached `main`; they landed in `main` shortly after, and a
plain `git fetch origin main` + rebase cleared it. The suggested
`supabase migration repair --status reverted` was **not** run and must never be — see
AGENTS.md §4 rule 1 and
[`docs/ai-session-instructions/shared-supabase-branch-workflow.md`](docs/ai-session-instructions/shared-supabase-branch-workflow.md).
Preview was also three merged migrations behind `main`
(`20260726190000`, `20260726200000`, `20260726210000`), which sort *before* preview's head, so the
apply needed `--include-all`. That flag is forbidden for **production** (AGENTS.md §5.1); on
preview it was safe here only because the pending set was verified first to be exactly those three
merged migrations plus this one, with nothing on preview that was missing from the branch.

**Before finishing:** re-read Phases 3–7 and report drift.

**Drift reported 2026-07-28:**

1. **§8's ColdLion snapshot is stale and understates the risk.** It is dated 2026-07-26 and reads
   as though ColdLion is between phases. In fact the accelerated plan applied its Step 3/4
   migrations (readiness evaluator, circuit breaker, verifier cast fix) to **preview** on
   2026-07-27 and ran monitor cycles on 2026-07-28. ColdLion is actively mid-flight on the same
   preview database this plan now uses.
2. ~~**Phase 3 has a new sequencing exposure that §8 does not cover.**~~ **Withdrawn on
   2026-07-28 after checking the code and the preview database — it was overstated.** The concern
   was that ColdLion re-sources `core.property` and could re-key the identities Phase 3 binds to.
   It cannot, by construction:
   - `link_approved` (the only implemented write mode) **"never creates or deletes canonical
     rows … never touches status/parents/codes/names/UUIDs"**, and a canonical-immutability guard
     aborts the whole transaction if `core.licensor`/`core.property` row counts move
     (`20260726030000_coldlion_licensor_property_phase4_link_approved.sql`).
   - `promote_approved` — the only mode that could ever create a canonical property — is
     **intentionally not implemented**.
   - Measured on preview 2026-07-28: `core.property` = 256 rows, 0 without a code, and ColdLion's
     542 `coldlion/merchGroupDetails` source refs are **already written**. Its preview linking is
     done and property identity did not move.

   What survives is narrower and worth keeping: ColdLion's Steps 6–9 are still open and its
   production cutover is unauthorized, so this stays a **Phase 5** (production) sequencing
   question exactly as §8 already says — not a Phase 3 one.
3. **Phase 3 says "the three canonical tables"; Phase 2 created only two.** The third is
   `core.character`, which already exists and is empty (model doc §5A.0b). Not a contradiction,
   but Phase 3 owns populating all three, not just the two added here.

Phases 4–7 read correctly and need no change.

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

**Property rules from licensing review (2026-07-27):**

- `EXISTING_MG06`: map the style guide and its appearances to the answered property code.
- `NEVER_DESIGNED`: keep the style guide with null `property_id`; do not use that appearance
  alone to assign a character property and do not invent a property.
- `MULTIPLE`: keep the style guide with null `property_id`; resolve property per character.
- For `MULTIPLE`, use the closest specific existing MG06 franchise code first.
- If there is no specific rule, preserve one unique same-licensor historical match.
- If neither exists, use the current licensor catch-all: `MV` for Marvel or `DC` for DC.
- Never create a property code, and never use a code outside the captured Coldlion MG06 list.

**Reconciliation checks (all must pass, all recorded):**
- row counts in vs out, with every exclusion explained by number
- zero duplicate `(style_guide, character)` bridge rows
- zero characters with a **dangling** `property_id` (a **missing** one is expected and required —
  see the correction below)
- zero orphan bridge rows at either end
- **idempotency:** running the backfill twice changes nothing the second time
- sentinels absent from `core.character`
- spot-check Batman: **one** character row, **15** bridge rows

**Exit:** all checks green on preview, evidence written to `docs/verification/`.

**Before finishing:** re-read Phases 4–7 and report drift.

### Phase 3 readiness, measured on preview 2026-07-28

Everything Phase 3 needs is present and the ground is stable. Verified directly:

| Check | Result |
|---|---|
| `core.property` | 256 rows, **0 without a code** |
| `core.licensor` | 26 rows |
| `core.character` | 0 rows — Phase 3 populates it |
| `core.style_guide` / `core.style_guide_character` | exist, 0 rows (Phase 2) |
| `public.characters` | 9,622 |
| `public.properties` | 500 |
| `dflow.properties_and_characters` | 10,122 |
| `dflow.property_character_associations` | 9,622 |
| `public.style_guide_files` | 274,906 |
| `public.asset_characters` | 117,011 |

**`source_table` values already in use in `core.taxonomy_source_ref`:** only
`coldlion/merchGroupDetails` (542) and `designflow_plm/merchGroup` (505). Phase 3's new
`source_table` values must not reuse either — the table's unique key is
`(source_system, source_table, source_id)`, so a reused pair would silently collide.

Two file counts differ slightly from the numbers quoted earlier in this plan
(`public.style_guide_files` 274,906 vs 279,783; `public.asset_characters` 117,011 vs 117,012).
Those earlier figures were measured on **production** on 2026-07-26. The gap is expected drift
between the two databases, not a fault — but **Phase 4 must re-measure both on the database it is
actually working against** rather than trusting either number.

**The real Phase 3 risk is not sequencing — it is character identity resolution.** The plan
already says so above, and nothing found on 2026-07-28 reduces it.

### Phase 3 identity rules — PROPOSED, AWAITING OWNER APPROVAL (2026-07-28)

Read-only evidence and the proposed rule set:
[`docs/verification/character-identity-rules-20260728/`](docs/verification/character-identity-rules-20260728/README.md).
Rules are implemented in `tools/resolve-character-identity.mjs` (21 unit tests) and measured by
`tools/analyze-character-identity-resolution.mjs`. **No rows were written; production was never
contacted.**

- **9,622 appearances → 6,538 canonical characters.** 8,878 auto-resolved, 590 excluded by rule
  (182 sentinels, 135 self-named guides, 111 "general" royalty labels, 101 logos, 31 grouping
  combinations, 13 do-not-use, 17 covered combinations).
- **154 appearances need a human identity decision**, concentrated in 30 style guides (Pirates,
  Toy Story 3, Looney Tunes, Camp Rock…). All are one-row-names-many-characters combinations whose
  components exist nowhere else, so splitting would invent names. Answerable as **one policy
  question**, not 154 rows.
- **36 characters need a human property decision** (98 appearances): a character's style guides
  carry equally specific, equally frequent property codes. The rules resolve the rest by the
  reviewed franchise table, code specificity, or majority.

**Owner answers recorded 2026-07-29 (two of three):**

1. **`MU` → `MV` for the `Marvel Universe` style guide is authorized.** *"MU for Marvel was a typo
   from Laura. MU is MUPPETS, under Disney. MV is Marvel Assorted Styles."* Recorded as a dated,
   attributed correction in `authorized-licensing-corrections.csv`; the licensing evidence file is
   untouched and still shows the original `MU`.
2. **New cross-licensor validation rule.** A style guide's resolved property must belong to the
   **same licensor** as the style guide. Mismatches **fail closed** and are reported, never
   auto-corrected. Re-run over all 211 coded style guides it found **five failures** the old
   code-only validation could never catch: `Lost Boys (1987)` → `LB` and `Exorcist (1973)` → `EX`
   (valid Coldlion codes with **no `core.property` row** — dangling FKs), `Black Adam (2022)` →
   `BP` (BLACK PANTHER, licensor Marvel), `Big Hero 6 TV` → `BK` (BIG LEBOWSKI, licensor NBC), and
   `Coco` → `CC` (licensor `ZZ` DTR - NO LICENSE). **All five still need an answer.**
3. **Likeness and movie do not split a character, but the detail is now preserved.** *"For Batman,
   with likeness we still use code BM… But we do add the fact that it's movie to the description."*
   Identity and property are unchanged (one Batman, `BM`); the stripped text is captured onto the
   existing `core.style_guide_character.metadata` jsonb — never on `core.character`, and no
   likeness boolean anywhere in `core.*` (likeness stays on `dam.style_guide_file`, model doc
   §2.2). 3,543 appearances carry preserved detail: 2,132 guide context, 1,036 portrayal, 319
   alias, 91 likeness label, 58 title/year.

### Licensing round 1 — RETURNED AND VALIDATED (2026-07-31)

The 195 open decisions (5 bad codes + 154 combination rows + 36 property tie-breaks) were put to
licensing as one sheet,
[`licensing-questions-for-laura-20260729.csv`](docs/verification/character-identity-rules-20260728/licensing-questions-for-laura-20260729.csv)
(PR #323), generated by `tools/build-licensing-questions-csv.mjs`.

Laura returned **194 of 195 answered**. **Only 29 are usable.** Every answer was validated against
`core.property` on preview before being accepted — **do not skip that step on round 2.** The check
is committed as `tools/validate-licensing-answers.mjs` (7 unit tests): it reports blanks,
multi-code answers, answers outside the offered options, and codes absent from `core.property`,
and exits non-zero if it finds any. **Never accept a returned sheet on its answered-count alone.**

**Resolved — do not re-ask:**

- 25 of the 36 property tie-breaks: single, valid, in-options codes.
- `Black Adam (2022)` and `Big Hero 6 TV`: answered `NONE`. Settled as drops.
- `Lost Boys (1987)` → `LB` and `Exorcist (1973)` → `EX`: **her answers were correct.** Verified in
  the ColdLion feed — `EX` = THE EXORCIST, `LB` = THE LOST BOYS, both parented to `WB`. **The gap
  is ours, not licensing's:** neither code has a `core.property` row. **These are no longer
  licensing questions.** They join the missing-property-code problem (§8a).

**Not resolved — and mostly our own fault:**

- **All 154 combination rows.** The sheet asked *"real characters, or a label — DROP or list the
  names"*; the answers came back as **MG06 property codes** (`TS` 27, `LT` 13, `CR` 7, `HSM` 7,
  `MM` 4) or `NONE` (95, ambiguous between "drop the row" and "no property code"). **Root cause:
  the sheet asked for names in an answer column where every other row wanted a code.** Not a
  reviewer error. **The lesson: when one sheet mixes question types, constrain the answer format
  per row — free text will be answered in the format the surrounding rows imply.**
- 8 Deadpool/X-Men characters answered `DP, XM` — two codes where axis 1 permits exactly one.
- `C004` (Blade) blank; `C006` answered with a sentence naming three characters;
  `C033` (Maxwell Lord) answered `JL`, which was not offered and **is absent from
  `core.property`** (same class as `EX`/`LB`).
- `Coco` re-confirmed as `CC`, which still sits under licensor `ZZ` (DTR - NO LICENSE) while the
  guide is Disney.

### Licensing round 2 — SENT (2026-07-31)

[`licensing-questions-for-laura-round2-20260731.xlsx`](docs/verification/character-identity-rules-20260728/licensing-questions-for-laura-round2-20260731.xlsx),
generated by `tools/build-licensing-questions-round2.py`. **166 open rows**; the 29 resolved rows
were removed. Sent to licensing by the owner on 2026-07-31.

**Every answer cell is a locked dropdown (166 data validations)** so the round-1 format failure
cannot recur:

- 154 × `NOT CHARACTERS - DROP THE ROW` / `REAL CHARACTERS - I LISTED THEM`, with a separate
  free-text column for names used only in the second case;
- the 11 remaining property rows carry only their own valid codes plus `NONE`;
- `A005` (Coco) carries `CC` / `NONE`.

Each row also shows *what you answered last time* and *why I am asking again*, and the workbook's
first sheet states plainly that the mix-up was our sheet's fault.

**Still open and still blocking the backfill:** the 166 round-2 rows, plus the missing property
codes `EX`, `LB` and `JL` (§8a) which are an owner policy decision, not a licensing one.

> **Superseded 2026-08-04.** Round 2 has since returned 157/166. What is still open is 8 rows
> (round 3) plus the same `EX`/`LB`/`JL` policy decision. See the two sections below.

### Licensing round 2 — RETURNED (2026-08-04)

**157 of 166 answered. The format failure is fully fixed:** zero wrong-question answers, zero
invented codes, zero double answers. The locked dropdowns worked and that design is kept.
Breakdown of the 154 combination rows: **126 `REAL CHARACTERS`, 20 `DROP`, 8 blank.**

**Nine rows came back blank. Only eight are re-asked.**

| Ref | Why it was blank | Disposition |
|---|---|---|
| `B038` (`Yosemite Sam & Harley Davidson`) | Dropdown blank, but the note reads *"This is a collab they did. Not an actual character"* | **Recorded as DROP. Not re-asked** — the note is unambiguous. |
| `B007` (`Cars - King, Mario and Ferrari car only`) | Picked `REAL CHARACTERS`, left the names cell empty | **Not re-asked.** Under the 2026-08-04 ruling the row stays whole and the resolver never consumed a name list, so nothing is missing. |
| `B039`–`B042` (Ant-Man & Wasp Logo ×3, Moon Girl & Devil Dinosaur - Gen) | Answered a different question in NOTES (*"No property code"*) — the wording mentioned codes | Re-asked, codes removed from the wording entirely. |
| `B043`–`B045` (Mickey & Donald Show, Mickey & Pluto, Morty & Ferdy) | Same failure | Re-asked as characters-or-label only. |
| `A005` (Coco) | Dropdown blank, but the note reads *"CC is the code used for products made by POP in the past. (MBZ80DYCC01)"* | Re-asked as a one-line confirmation tick. The licensor conflict behind it is ours to fix (§8a) and is not put to the reviewer. |

### Licensing round 3 — BUILT (2026-08-04)

**8 rows: `A005`, `B039`–`B045`.** Same two-sheet structure and locked-dropdown mechanism as round
2, because that mechanism is the reason round 2 succeeded. Three changes, all aimed at the one
failure mode round 2 still had — a blank cell whenever the reviewer had something the dropdown did
not allow:

- every answer cell is **required** (`allow_blank` false, stop-style error) — no cell can be left
  empty;
- every dropdown carries a **`NONE OF THESE FIT - SEE MY NOTES`** option plus a free NOTES column;
- the re-worded questions **never mention property codes**, and the instructions sheet states that
  the round-2 blanks were our sheet's fault.

**No character names are requested** — the 2026-08-04 ruling removed the need.

> The workbook contains a third party's name and free-text notes and is **deliberately not
> committed to this repository.** It is delivered out of band. Round 1 and round 2 artifacts that
> are already committed stay as they are.

### Licensing round 3 — RETURNED, AND THE LICENSING QUESTION STREAM IS CLOSED (2026-08-06)

**Source:** Laura, round-3 workbook, returned 2026-08-06. Verified cell-by-cell against the
delivered workbook by the recording session (sheet `Open questions`, rows 2–9, answer column `I`).

**8 of 8 answered. Zero blanks. Zero uses of the `NONE OF THESE FIT` escape. Zero format
failures.** The round-3 design (required cells + per-row option lists + escape hatch) worked.

These are **settled rulings**, not proposals:

| Ref | Row | Laura's answer | Disposition |
|---|---|---|---|
| `A005` | Disney / `Coco` / `Coco` | **`CC`** | **SETTLED as a licensing fact:** `CC` is the property code POP used for Coco. Her note states `CC` is the code used for products POP made in the past and cites one concrete produced item number as evidence. **That item number is deliberately NOT reproduced here** — it is a real internal POP item identifier and the workbook carrying it is deliberately uncommitted (see the note above); the coordinator holds it out of band. ⚠️ **Her answer names a CODE, not a row.** Property codes are not globally unique (see the 2026-08-06 owner rulings below), so *which licensor's* `CC` she meant is an open technical question, not something this table settles. |
| `B039` | Marvel / `...Quantumania - No Likeness` / `Marvel Studios\` Ant-Man & Wasp Logo ( Marvel Studios\` Ant-Man Wasp Quantuma` | **IT IS JUST A LOGO OR TITLE** | **SETTLED — DROP.** Non-character. Also settles the round-2 `NONE` ambiguity ("drop the row" vs "no property code") as *drop*. |
| `B040` | Marvel / `...Quantumania - No Likeness` / `Marvel Studios\` Ant-Man & Wasp Logo ( MS\` Ant-Man Wasp Quantumania )` | **IT IS JUST A LOGO OR TITLE** | **SETTLED — DROP.** Non-character. |
| `B041` | Marvel / `...Quantumania - With Likeness` / same logo row | **IT IS JUST A LOGO OR TITLE** | **SETTLED — DROP.** Non-character. Confirms the likeness variant behaves identically, consistent with the owner's likeness rule. |
| `B042` | Marvel / `Marvel's Moon Girl and Devil Dinosaur` / `Moon Girl & Devil Dinosaur - Gen ( Marvel\`s Moon Girl and Devil Dinosaur )` | **IT SHOWS THE CHARACTERS** | **SETTLED — KEEP as ONE row.** See the `- Gen` ruling below: this answer is authoritative. |
| `B043` | Disney / `Mickey Mouse` / `Mickey & Donald Show` | **IT SHOWS THE CHARACTERS** | **SETTLED — KEEP as ONE row**, named by its own label, per the 2026-08-04 ruling. |
| `B044` | Disney / `Mickey Mouse` / `Mickey & Pluto - Back To School` | **IT SHOWS THE CHARACTERS** | **SETTLED — KEEP as ONE row**, named by its own label. |
| `B045` | Disney / `Mickey Mouse Family` / `Morty & Ferdy` | **IT SHOWS THE CHARACTERS** | **SETTLED — KEEP as ONE row**. |

Rolled up: **3 DROP (`B039`–`B041`), 4 KEEP-as-one-character (`B042`–`B045`), 1 code confirmation
(`A005` = `CC`).**

**⛔ THE LICENSING QUESTION STREAM IS CLOSED. There is no round 4.** Rounds 1 → 2 → 3 are done and
all 195 original decisions now carry a usable licensing answer or a recorded disposition.
**Nothing is outstanding with Laura, and no session should record the workstream as "awaiting
Laura's reply" again.** Any document that still says so is stale as of 2026-08-06.

**Consequence for `B043`/`B044`:** the canonical characters will literally be named
`Mickey & Donald Show` and `Mickey & Pluto - Back To School`. That looks odd and is **exactly what
the 2026-08-04 ruling mandates.** Do not "fix" it later.

**Still outstanding (NOT licensing, and NOT closed by the above):** the `EX` / `LB` / `JL`
canonical-property-code policy decision (§8a) — an owner decision — and the Phase 3 backfill
itself, which has not been run. The blocker on this workstream moved from Laura to Albert.

**Formal step not yet done:** `tools/validate-licensing-answers.mjs` has not been run against the
round-3 answer set (the recording session was forbidden database calls). Only `A005`/`CC` would be
affected. Recorded as a queue entry, not skipped silently — see `COORDINATOR_INTAKE.md`.

### 8-OWNER. OWNER RULINGS — 2026-08-06 (Albert Hazan) — SETTLED, DO NOT RE-LITIGATE

#### Ruling 1 — **Coco IS a Disney license.**

Albert, 2026-08-06. This is a **settled owner decision** about a commercial fact, not a data guess.

**What it supersedes.** Every previous statement in this repository that treats *"`Coco` sits
under a licensor named NO LICENSE"* as possibly deliberate — a real commercial fact that should
stay — is **SUPERSEDED as of 2026-08-06**. The open question *"is the property `Coco` correctly
filed under a licensor named NO LICENSE?"* is **ANSWERED: no.** Coco is a Disney license.

**⚠️ READ THIS BEFORE ACTING ON THE RULING — the obvious next step is NOT the right one.**

**Property codes are NOT globally unique.** Licensor → Property is a **parent-child**
relationship, and the *same* property code can exist as a **separate property row under many
different licensors at the same time**. There could be a `CC` under twenty different licensors.
Confirmed by Albert, 2026-08-06.

Therefore *"re-parent `CC` from `ZZ` to Disney"* is **not a meaningful instruction** and **must
not be queued, planned, or implemented in those words.** Any earlier text in this repository that
describes this as a re-parenting job, or that treats a bare code like `CC` as identifying one
global row, is **wrong and superseded**.

**What follows.**

- The `A005` cross-licensor conflict is **RESOLVED as a licensing/ownership question.** Laura's
  `CC` answer and the Disney `Coco` style guide are consistent with each other: Coco is Disney.
  The fail-closed cross-licensor rule (owner answer #2, 2026-07-29) is not in dispute; what is
  unresolved is purely *which row the style guide should point at*.
- Item **A3** in `docs/characters-style-guides-phase1-reverification-20260802.md` is **no longer
  an open OWNER question.** The owner has ruled. What remains is a **technical open question**,
  below.
- **The database work is an OPEN QUESTION, not a defined change.** Three candidate fixes, none
  chosen, and **this document does not choose between them**:
  1. point the Disney `Coco` style guide at a `CC` property row that **already exists under the
     Disney licensor**, if one does; or
  2. **create** a `CC` property under the Disney licensor; or
  3. something else entirely — including that the Disney-side Coco property may carry a code other
     than `CC`, or that the `ZZ` row is a separate, legitimately distinct row that is simply not
     the one this style guide should use.
- Answering it requires reading the live licensor → property hierarchy. **No session may decide
  this from documents.** Filed as a QUESTION TO RESOLVE in `COORDINATOR_INTAKE.md`. **No migration
  has been written and none may be written outside coordinator dispatch.**

**Read-only evidence gathered 2026-08-06 (repo only, NO database calls).** Recorded so the session
that answers this does not re-derive it:

- **The SCHEMA already agrees with Albert.** `supabase/migrations/20260621150815_app_core.sql:200`
  declares `core.property … unique nulls not distinct (licensor_id, code)` — property codes are
  unique **per licensor**, never globally. By contrast `core.licensor` (`:188`) *is*
  `unique nulls not distinct (code)`, so **licensor** codes genuinely are global. The two are
  routinely confused; they are not the same rule.
- Whether a `CC` row already exists under the Disney licensor **could not be determined from the
  repository** — no committed artifact enumerates `core.property` rows by `(licensor, code)`. It
  needs a live read. **Do not guess.**
- The repo is mostly *already* correct on this point and says so loudly — e.g.
  `fix_item_taxonomy_wiring.md:147` (*"Resolving property by code alone is wrong. Resolve licensor
  first"*), `AGENTS.md` §6 standing rule 3, and
  `docs/licensor-property-parent-child-design-20260802.md:227`. The global-uniqueness framing was
  introduced in the *description of this task*, not by the schema or the design docs.

**⚠️ FLAGGED, NOT FIXED — two places that DO appear to assume a property code is globally
unique.** Both are filed as queue entries; neither was changed by this session:

1. **`tools/validate-licensing-answers.mjs:86-96`** — the mandated licensing validator queries
   `where p.code = any($1)` with **no licensor scope**, then builds its "present" set from
   `p.code` alone. A code that exists only under the *wrong* licensor is reported as present and
   usable. It selects `l.name as licensor` but never uses it. This is the exact defect class that
   would have waved `A005`/`CC` through. **Real defect; needs its own queue entry.**
2. **§8a below (`fix_characters_style_guides.md:575-576`)** — *"ColdLion exposes 322 distinct
   property codes; `core.property` holds 256; 66 are missing"*. That is a set difference computed
   on **bare codes across all licensors**. Under a `(licensor_id, code)` model the figure does not
   mean what it says, and the "66 missing / 51 active" owner decision is framed on top of it.
   **Flagged; the numbers are NOT corrected here** — re-deriving them requires a live read.

#### Ruling 2 — **`B042` "- Gen" is authoritative; the `GENERAL_ROYALTY_LABEL` risk is RESOLVED.**

Albert, 2026-08-06: **Albert himself put the `Moon Girl & Devil Dinosaur - Gen` question to
Laura.** The question therefore reached her with the owner's own framing, and her answer —
**IT SHOWS THE CHARACTERS** — is **authoritative**.

**What it supersedes.** The previously flagged risk that `- Gen` is an abbreviation of *General*
and therefore collides with the `GENERAL_ROYALTY_LABEL` exclusion in
`tools/resolve-character-identity.mjs:66-70` (which excluded 111 "general" royalty labels) is
**CLOSED as of 2026-08-06.** `B042` is a real character row, kept as one row. Do not re-open it,
do not hold `B042` behind a further question, and do not put `- Gen` to Albert again.

**Low-priority follow-up, recorded as a queue entry and NOT actioned here.** The exclusion regexes
match only the spelled-out word `general` (`/(^|\s)general$/`, `/\(general\)/`,
`/general (family )?(char|character)/`). The abbreviation `Gen` is **not** matched. That is why
`B042` escaped the exclusion and reached the sheet at all. Other `- Gen` / `Gen.` rows may
therefore behave inconsistently with the 111 excluded siblings. **This is a consistency question
about the rest of the corpus, not a doubt about `B042`** — `B042` is settled. Filed in
`COORDINATOR_INTAKE.md`; do not fix it as a drive-by.

**Related rule gap, also filed and NOT actioned here.** `B039`–`B041` are obvious logo rows that
the `LOGO_LABEL` rule (`tools/resolve-character-identity.mjs:65`) did **not** catch, because it
matches `logo` only at the **start or end** of a name and these read
`... & Wasp Logo ( ... )` — `Logo` mid-string before a parenthetical. Three obvious logo rows
burned two full licensing round trips as a result.

### 8a. Missing canonical property codes — OWNER DECISION, NOT A LICENSING ONE

**Verified 2026-07-31 on preview:** ColdLion type-`06` exposes **322 distinct property codes**;
`core.property` holds **256**. **66 are missing, 51 of them still active.**

> **⚠️ FLAGGED 2026-08-06 — these three numbers may not mean what they say.** They are a set
> difference computed on **bare property codes**, ignoring the licensor. But `core.property` is
> keyed `unique (licensor_id, code)` — **property codes are unique only per licensor, never
> globally** (owner ruling 2026-08-06, §8-OWNER; schema at
> `supabase/migrations/20260621150815_app_core.sql:200`). A code counted as "present" may exist
> only under the wrong licensor, and a code counted as "missing" may exist under several.
> **Not corrected here** — re-deriving it needs a live read, and this session was docs-only.
> Filed as a queue entry. Treat "66 missing / 51 active" as **unverified** until re-derived per
> licensor. See also `docs/coldlion-source-of-truth-plan.md:72-73`, which already records these
> counts as stale for a *different* reason (ColdLion now returns 285, not 322).

This is **policy, not a bug**. ColdLion has **no expiry flag**, so it still returns lapsed licences
(NASA, ZAG, FRIDA KAHLO among them). Admitting the unmatched codes wholesale would resurrect dead
licences into master data. Widening the approved set is an explicit owner decision — see the
frozen 542-mapping artifact described in
[`plan_coldlion_licensor_property_accelerated_cutover.md`](plan_coldlion_licensor_property_accelerated_cutover.md).

**Consequence for this plan:** `EX`, `LB` and `JL` are correct answers that cannot be used until
the owner rules on those codes. Until then the affected style guides must keep a null
`property_id` — **never invent a placeholder property** (model doc §5A.0 rule 3).

Three things the owner must decide before the backfill runs:

1. ~~**Batman resolves to 17 bridge rows, not the 15 in this plan's exit check.**~~ **ANSWERED
   2026-07-29 — accepted.** The extra two are `Batman As Portrayed By Christian Bale` (*Batman
   Begins 2005*) and `Batman (non-talent likeness)` (*Dark Knight Rises 2012*), both Batman under
   the owner's own likeness rule. Movies and actor renditions do not split the character and do not
   get their own MG06 code. **This plan's "15 bridge rows" exit check is superseded by 17.**
2. ~~**STILL OPEN — the 154 combination rows:** exclude them (recommended, invents nothing), split
   them, or decide the 30 style guides individually.~~ **ANSWERED 2026-08-04 — rows stay whole.**
   The owner ruled: *"When a style guide row lists several characters together, leave it as one
   row."* A combination row is therefore **never split into its component characters**. The only
   decision any such row still needs is the binary one round 2 asked for: it is either a real
   character row (kept as one row, named by its own label) or not a character at all (dropped).
   **What follows from this:**
   - **The free-text names column is dead.** `tools/resolve-character-identity.mjs` never consumed
     it — it classifies only — so the rows where the reviewer echoed the row label back into that
     column need **no further work and must not be re-asked**. (Measured on the returned round-2
     workbook: of 126 `REAL CHARACTERS` rows, 13 echo the row label exactly and 109 echo it under a
     loose match. A "92 echoed rows" figure quoted in session notes does not reproduce from that
     file under either definition; the count is moot now, since none of them are re-asked.)
   - `MULTI_CHARACTER_UNRESOLVED` / `COMBINATION_UNCOVERED` stop being identity failures. A row the
     reviewer confirms is real resolves to exactly **one** character; splitting logic must not run
     against it. `COMBINATION_COVERED` exclusion is unaffected.
   - **Round 3 is 8 rows, not 154.** See "Licensing round 3" below.
Two of this phase's own exit checks were unachievable as originally written and are corrected
above:

- **"zero characters with a missing/dangling `property_id`" contradicted the `NEVER_DESIGNED`
  rule.** 1,302 of the 6,538 characters appear only under never-designed or no-code style guides,
  so by the owner's own rule they must carry a **null** `property_id` and no placeholder property
  may be invented. Only a *dangling* FK is a failure.
- **"spot-check Batman: 15 bridge rows"** measures 17 under these rules (see point 1 below).

3. ~~**The licensing answer `MU` for the `Marvel Universe` style guide is almost certainly wrong.**~~
   **CONFIRMED AND CORRECTED 2026-07-29** — see the owner answers above. Four further defective
   answers surfaced by the new cross-licensor rule remain open.

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
| Licensing-team decision sheet (153 uncertain rows) + full 335-row generator + capture notes | [`docs/verification/style-guide-property-mapping-20260726/`](docs/verification/style-guide-property-mapping-20260726/README.md) |
| Regenerator for that sheet | `tools/generate-style-guide-property-mapping.mjs` |

The final 153-row sheet was returned by licensing on 2026-07-27 and is preserved with normalized
results under
[`docs/verification/style-guide-licensing-review-20260727/`](docs/verification/style-guide-licensing-review-20260727/README.md).

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
   tracks look complete when they were not. The generator now covers all 335 rows while the
   delivered sheet contains only the 153 uncertain decisions.
9. **Treating the automatic `NONE` marker as an MG06 code.** `NONE` means the earlier audit
   intentionally assigned no code. The returned-sheet processor now keeps that as a no-code
   outcome instead of failing code validation.
10. **Loading `pg` as a normal ESM package on Windows.** The read-only processor could not see
    the shared package path through ESM resolution. It now uses `createRequire`, which honors the
    supplied package path without installing anything in this repository.
11. **Using name history alone for `MULTIPLE`.** Same-licensor character names resolved only 18
    of 338 appearances and produced an unacceptable 305-row licensing follow-up. The corrected
    approach uses specific existing franchise codes, preserves unique history, then uses the
    existing licensor catch-all. The final Grok-reviewed rules map 327 appearances and exclude
    nine non-character labels plus two sentinels, without inventing a code or asking licensing
    to repeat known franchise classification.
12. **Treating `grok models` as an authentication test.** It printed "not authenticated" even
    though the real headless task path worked. The first review was also stopped during a long
    silent run. Verify Grok with a short `--single` task, then allow focused reviews to finish.

## 11. Document history

| Date | Change |
|---|---|
| 2026-07-26 | Created. Phases 0–7 defined; Phase 0 open pending owner decision. |
| 2026-07-26 | Phases 0–1 completed. Owner approved the hybrid source: accept 367 direct agreements, apply Classics/no-code rules, and wait for the 174-row licensing review for the residual mapping. |
| 2026-07-26 | Grok review found the 367 and 174 tracks did not cover the same population. Replaced the sheet with one 335-row list: 21 accepted direct parents, 5 confirmed Classics, 3 confirmed no-code titles, 306 review rows. |
| 2026-07-27 | Licensing returned all 153 uncertainty rows: 32 existing codes, 118 never designed, 3 multiple. Read-only character reconciliation reduced the 338 multiple appearances to 305 distinct licensing exceptions. |
| 2026-07-27 | Replaced the 305-row follow-up with character/franchise rules: 256 specific franchise, 18 unique history, 62 Marvel catch-all, 2 sentinels excluded, 0 licensing rows. |
| 2026-07-27 | Grok review corrected four DC alias mappings, moved six weak franchise guesses to `MV`, excluded nine non-character labels, and expanded tests. Final: 248 specific, 13 unique history, 66 Marvel catch-all, 9 non-character labels, 2 sentinels, 0 licensing rows. |
| 2026-07-28 | A concurrent closeout session recorded the Phase 2 work as an unmerged draft at `e0657f7` with no PR or preview apply. That was a mid-flight snapshot and is superseded by the next row. |
| 2026-07-28 | Phase 2 completed. Migration `20260727230000_core_style_guide_axis.sql` created `core.style_guide` and `core.style_guide_character`, applied to preview only and verified empty; production untouched. Recorded three drift findings, chiefly that ColdLion is actively mid-flight on the same preview database and that Phase 3 (not just Phase 5) now carries a `core.property` identity exposure. |
| 2026-07-28 | Withdrew that Phase 3 exposure as overstated: ColdLion's `link_approved` provably never creates, deletes, or re-keys canonical rows and is guarded by a row-count immutability check, `promote_approved` is not implemented, and preview shows `core.property` at 256 rows with ColdLion's 542 source refs already written. Added a measured Phase 3 readiness table and flagged that the two file-row counts quoted earlier were production figures. |
| 2026-07-31 | Licensing round 1 returned 194/195 answered but only **29 usable**. All 154 combination rows came back as MG06 property codes because the sheet asked for names in a code-shaped answer column — our defect, not the reviewer's. `LB`/`EX` confirmed correct and reclassified as our missing-property problem (§8a). Round 2 built with **166 locked dropdowns** and sent. Recorded the 66 missing ColdLion property codes as an owner policy decision, not a bug. |
| 2026-08-04 | **Owner ruling: multi-character style-guide rows are NOT split — they stay as one row.** Closes §8a point 2, the last of the three pre-backfill owner decisions. Combination rows need only the binary real-or-drop classification; the free-text names column is dead and the echoed-name rows need no further work. Round 2 returned 157/166 with zero format failures. Round 3 built as **8 rows** (`A005`, `B039`–`B045`): `B038` recorded as DROP from its own note and `B007` closed by the ruling, so neither is re-asked. Round 3 keeps the locked dropdowns and adds required answers plus a `NONE OF THESE FIT` escape. |
| 2026-08-06 | **Licensing round 3 RETURNED — 8 of 8 answered, zero blanks, zero format failures. THE LICENSING QUESTION STREAM IS CLOSED; there is no round 4.** `A005` = `CC`; `B039`–`B041` DROP as logos; `B042`–`B045` KEEP as one character row each. Source: Laura, round-3 workbook, 2026-08-06. Nothing further is outstanding with Laura — every document still saying "awaiting Laura's reply" is stale from this date. |
| 2026-08-06 | **OWNER RULING (Albert Hazan): Coco IS a Disney license.** Supersedes any reading that `Coco` under a "NO LICENSE" licensor was deliberate, and closes that open question. **Same date, same owner: property codes are NOT globally unique** — licensor→property is parent-child and the same code may exist under many licensors, so *"re-parent `CC` to Disney"* is not a meaningful instruction and must not be planned in those words. The remaining database work is an **OPEN QUESTION** (point the guide at an existing Disney `CC`, create one, or something else), filed as a question in `COORDINATOR_INTAKE.md`, **not** a defined change. |
| 2026-08-06 | **OWNER RULING (Albert Hazan): the `B042` "- Gen" answer is authoritative** — Albert put that question to Laura himself. The `GENERAL_ROYALTY_LABEL` collision risk against `B042` is **RESOLVED, not open.** The separate observation that the exclusion regex matches only the spelled-out word "general" (so other `- Gen` rows may behave inconsistently) is recorded as a **low-priority** queue entry, not work. |
