# Character identity resolution rules — proposal and evidence

**Captured:** 2026-07-28 · **Updated:** 2026-07-29 with the owner's answers ·
**Database:** preview `rjyboqwcdzcocqgmsyel`

> **2026-07-29 — two of the three open questions are answered.**
>
> 1. **The `MU` answer is confirmed wrong and corrected.** Owner: *"MU for Marvel was a typo
>    from Laura. MU is MUPPETS, under Disney. MV is Marvel Assorted Styles."* The Marvel Universe
>    style guide now resolves to `MV`, recorded as an authorized correction in
>    `authorized-licensing-corrections.csv`. The original licensing answer is untouched in
>    `../style-guide-licensing-review-20260727/`.
> 2. **A cross-licensor validation rule now exists**, because "is this a real Coldlion code" was
>    never enough to catch this. It found **4 more defective rows** — see §4a.
> 3. **Likeness and movie detail do not split a character, but the detail is now KEPT** on the
>    bridge row's `metadata` — see §4b. Batman is one character resolving to `BM` regardless.
>
> **Still open, still blocking the backfill:** the 154 combination rows (§3) and the remaining
> 36 property tie-breaks (§4).

**Database work: READ ONLY. No row and no schema object was created, changed, or
deleted. Production `qsllyeztdwjgirsysgai` was never contacted.**

This is the deliverable that the Phase 3 backfill is blocked on
([`fix_characters_style_guides.md`](../../../fix_characters_style_guides.md) Phase 3,
model doc [§7 question 4](../../style-guides-characters-and-royalties.md)):
**how do 9,622 character *appearances* collapse into canonical character identities?**

Nothing is loaded until the owner approves the rules below.

## The answer in one line

**9,622 appearances → 6,538 canonical characters.** 8,878 appearances (92.3%) are
resolved by rule; 590 are excluded by rule as things that are not characters; **154
appearances need a human decision, and they concentrate in 30 style guides.** A
second question — which single property each character belongs to — leaves **36
characters** (98 appearances) needing a human decision, down from 173 once the `MU` typo was
corrected and cross-licensor validation began failing bad answers closed.

**The three canonical tables still hold 0 rows on preview.** The analyzer asserts that on every
run and aborts if any of them is non-empty.

## 1. Reconciliation: in, excluded, out

| | Appearances | Rule |
|---|---:|---|
| **In** — legacy `dflow.property_character_associations` | **9,622** | |
| Excluded — royalty sentinels | 182 | `SENTINEL` (model doc §2.3) |
| Excluded — the row's only name is its style guide's name | 135 | `SELF_NAMED_GUIDE` |
| Excluded — "(General)" / "No Name, Likeness or Voice Royalty" labels | 111 | `GENERAL_ROYALTY_LABEL` |
| Excluded — logo artwork | 101 | `LOGO_LABEL` |
| Excluded — royalty grouping combinations ("… grp of 4") | 31 | `GROUPING_LABEL` |
| Excluded — "do not use" rows | 13 | `DO_NOT_USE_LABEL` |
| Excluded — combination row whose every component is already a resolved character | 17 | `COMBINATION_COVERED` |
| **Needs a human decision** | **154** | `COMBINATION_UNCOVERED` |
| **Out** — resolved appearances | **8,878** | |
| **Out** — canonical `core.character` rows | **6,538** | |

590 excluded + 8,878 resolved + 154 pending = 9,622. Every exclusion is explained by number and by rule,
and every row appears in `appearance-identity-resolution.csv` with the exact rule
chain that decided it.

The 182 sentinels are `NO REPORTABLE ELEMENTS` (154), `NO CHARACTER LIKENESS` (15)
and `LOGO` (13) — **absent from every canonical identity by construction**.

## 2. The identity rules, with the count each resolves

Applied in this order. Each rule is deterministic, unit-tested
(`tools/resolve-character-identity.test.mjs`, 21 tests) and recorded per row.

| # | Rule | Fires on | What it does and why |
|---|---|---:|---|
| 1 | `SENTINEL` / `LOGO_LABEL` / `GENERAL_ROYALTY_LABEL` / `DO_NOT_USE_LABEL` / `GROUPING_LABEL` / `SELF_NAMED_GUIDE` | 573 | Rows that are not characters at all. |
| 2 | `STRIP_LIKENESS` | 91 | Removes `(non-likeness)`, `(non talent likeness)`. Likeness is a property of the **file**, never the character (model doc §2.2), so it cannot split an identity. |
| 3 | `STRIP_PORTRAYAL` | 1,036 | Removes `as portrayed by <actor>`. An actor is a rendition of one character. |
| 4 | `STRIP_TITLE_YEAR` | 58 | Removes a trailing `(Batman Begins 2005)`. A film is a style, not an identity. |
| 5 | `STRIP_GUIDE_CONTEXT` | 2,133 | Removes a trailing parenthetical that repeats the appearance's own style guide (`Ant-Man ( Avengers )`). The bridge row already carries the guide. |
| 6 | `INVERT_SURNAME_FIRST` | 229 | `Rogers, Steve` → `Steve Rogers`, only for a plain two-token personal name. |
| 7 | `SPLIT_SLASH_ALIAS` | 96 | `Batman/Bruce Wayne` → primary + alias. |
| 8 | `SPLIT_AKA` | 484 | `Robin aka Dick Grayson` → primary + alias. |
| 9 | `ALIAS_UNIQUE_MERGED` | 319 | The primary has **one** secondary name in the whole corpus, so that name is a known alias of the same identity — merged. (`Harley Quinn` + `Harley Quinn aka Dr. Harleen Francis Quinzel` = one character.) |
| 10 | `ALIAS_DISAMBIGUATED` | 165 | The primary has **several** distinct secondary names, so the alias is a disambiguator, not decoration — kept apart. (`Robin aka Dick Grayson` ≠ `Robin aka Damian Wayne` ≠ `Robin aka Duke Thomas`.) |
| 11 | `BARE_PRIMARY_KEPT` | 84 | The unqualified name under a polysemous primary stays its own identity and is never silently folded into one of the variants. |
| 12 | `PRIMARY_ONLY` | 8,310 | No alias structure; identity is the normalized name, scoped to the legacy licensor. |
| 13 | `COMBINATION_COVERED` | 17 | A combination row (`BATMAN & ROBIN`) where **every** named component already resolved under the same licensor. It adds no identity, so it is dropped without loss. |

Two supporting details:

- **Alias clustering.** Two alias tails are the same secondary identity when one is a
  token-prefix of the other (`clark kent` ⊂ `clark kent kal el`), when they differ by a
  single-character typo (`komand r` / `kommand r`), or after abbreviation expansion
  (`Dr.` = `Doctor`). This is what keeps Superman one character instead of five.
- **Scope.** Identity is keyed by `(legacy licensor, normalized primary [, alias
  cluster])`. Only 3 normalized names occur under more than one licensor, so the
  scope costs almost nothing and prevents cross-licensor collisions.

### Batman spot-check — 1 character, but **17** bridge rows, not 15

The plan's exit check expects 15. The rules give **20 appearances across 17 style
guides**, all one identity. The extra two are real Batman rows that the plan's
earlier exact-name count missed because they carry a qualifier:

- `Batman As Portrayed By Christian Bale` in *Batman Begins (2005)*
- `Batman (non-talent likeness)` in *Dark Knight Rises, The (2012)*

Both are Batman by the owner's own likeness rule (model doc §2.2). **This is the one
place the proposal deliberately exceeds a stated exit number, and it needs the owner's
yes before the backfill runs.** If the owner prefers the literal 15, rules 2 and 3
must not apply to bare-primary merging — which would also split ~1,100 other
appearances back out.

## 3. What genuinely needs a human — 154 appearances, 30 style guides

`identity-decisions-for-owner.csv`. All 154 are the same shape: **a single legacy row
that names several characters at once, where at least one component appears nowhere
else under that licensor**, so there is nothing to attach it to and splitting it would
invent character names.

| Style guide | Appearances | Example row |
|---|---:|---|
| Pirates of the Caribbean 3: At Worlds End | 33 | `Pirates 3: At Worlds End - Barbossa & Will` |
| Pirates of the Caribbean 2: Dead Man's Chest | 25 | `Pirates: DMC - Jack, Will, Pintel, D Jones, B Bill & Palifico` |
| Toy Story 3 | 25 | |
| Looney Tunes Core | 13 | `Bugs Bunny & Harley Davidson` |
| Pixar Collection | 7 | |
| 25 further style guides | 51 | Camp Rock, High School Musical, Disney Zombies, Cars 2/3, Mickey Mouse, … |

**Why no rule can decide these.** Splitting `Pirates: DMC - Jack, Will, Pintel, D
Jones, B Bill & Palifico` would create characters called `b bill`, `d jones`, `t
dalma` and `guard`. Those abbreviations exist nowhere else in the corpus, so the
resolver cannot expand them, and guessing would put invented names into the shared
catalogue that every app reads. Equally, `Bugs Bunny & Harley Davidson` pairs a
character with a **brand**, not a second character.

**This is one policy question, not 154.** The owner can answer it once:

- **(A) Exclude them** as royalty combination rows — the same class as the 31 already
  excluded `… grp of 4` rows. Cost: the Pirates and Toy Story 3 style guides then
  contribute no characters at all, because those guides only ever recorded
  combinations. **Recommended** — it invents nothing, and the guides themselves still
  land in `core.style_guide`.
- **(B) Split them** on `&`/`,` and accept names like `b bill` in `core.character`.
- **(C) Decide the 30 style guides individually** — the full list is in the CSV.

## 4. The second decision nobody had costed: one property per character

Axis 1 requires exactly one `property_id` per character (model doc §1.0), but a
canonical character appears in several style guides, and those guides carry
**different** property codes. Iron Man appears under *Avengers* (`AV`), *Marvel Games*
(`GM`), *Marvel Universe* (`MU`) and *Marvel's Spidey and His Amazing Friends* (`SX`).

Resolution rules, in order (`resolvePropertyForIdentity`). **No code is ever created,
and no code outside the captured Coldlion MG06 list is ever used** — these rules only
choose among codes already assigned by the licensing review.

| Rule | Characters | Meaning |
|---|---:|---|
| `SINGLE_CANDIDATE` | 4,665 | Every style guide agreed. |
| `NO_PROPERTY_CANDIDATE` | 1,317 | Only `NEVER_DESIGNED` / no-code / validation-blocked guides — `property_id` stays null, no placeholder invented. |
| `REVIEWED_FRANCHISE_RULE` | 193 | The already-reviewed DC/Marvel character→franchise table decides it. |
| `MOST_SPECIFIC_CODE` | 310 | Franchise code beats a group umbrella (`AV`, `JG`, `SX`, `GM`, `CP`, `MP`), which beats an assorted-styles bucket (`MV`, `DC`). |
| `MAJORITY_OF_APPEARANCES` | 17 | A strict majority among equally specific codes. |
| **`NEEDS_HUMAN`** | **36** | Equally specific, equally frequent — a coin flip. |

`property-decisions-for-owner.csv` holds those 36 (98 appearances), each with its
candidate codes, their Coldlion descriptions, and the style guides they came from.
Typical cases: `Steve Rogers → AV / CA` and two genuine same-name-different-character
collisions (`Judy → A9 Annabelle Comes Home / C3 The Conjuring 2`).

## 4a. Cross-licensor validation — the general fix for the `MU` defect

**Added 2026-07-29.** The old check asked only "is this a real Coldlion MG06 code". `MU` is a
real code, so the typo passed. The new rule asks a second question:

> **A style guide's resolved property must belong to the same licensor as the style guide.**
> A mismatch **fails closed** — the appearance gets no property and is reported. It is **never**
> auto-corrected.

Approved licensor sets, derived from the style guides actually present under each legacy licensor
id on preview: `1 Disney → DY, SW` · `2 Warner Bros → WB, DC, HP, FR` · `3 Marvel → MV` ·
`12 → WW` · `13 → CC` · `14 → SS`. An unrecognised legacy licensor also fails closed.

Re-run across all **211** style guides that carry a code (153 licensing answers + 182 automatic
decisions). **Five failures, 34 appearances** — full detail in
`cross-licensor-validation-failures.csv`:

| Style guide | Answer | What that code actually is | Appearances | Source | Failure |
|---|---|---|---:|---|---|
| Lost Boys, The (1987) | `LB` | valid in Coldlion, **absent from `core.property`** | 20 | automatic name match | `CODE_NOT_IN_CORE_PROPERTY` |
| Black Adam (2022) | `BP` | `BLACK PANTHER`, licensor **MARVEL** — Black Adam is DC | 10 | licensing review | `LICENSOR_MISMATCH` |
| Exorcist, The (1973) | `EX` | valid in Coldlion, **absent from `core.property`** | 2 | automatic name match | `CODE_NOT_IN_CORE_PROPERTY` |
| Big Hero 6 TV | `BK` | `BIG LEBOWSKI`, licensor **NBC** | 1 | licensing review | `LICENSOR_MISMATCH` |
| Coco | `CC` | `COCO`, but licensor **`ZZ` DTR - NO LICENSE** | 1 | automatic name match | `LICENSOR_MISMATCH` |

So the `MU` typo was **not** the only one. `BP` for Black Adam and `BK` for Big Hero 6 are the
same class of mistake from the same review sheet, and two automatic matches point at codes that
have no `core.property` row and would have produced dangling foreign keys.

**All five need an answer before the backfill** — the rule refuses to guess. `MU` no longer
appears here because the owner authorized its correction; the other five are not authorized.

## 4b. Preserved rendition detail — one character, but the movie fact is kept

Owner, 2026-07-29: *"For Batman, with likeness we still use code `BM`. We don't separate the
movies from comics when it comes to MG06. But we do add the fact that it's movie to the
description."*

Identity and property are unchanged: one canonical `Batman`, property `BM`, whatever the movie or
actor. But the stripped text is **no longer discarded** — it is captured and lands on the
appearance, which is where the rendition actually varies.

**Where it goes:** `core.style_guide_character.metadata` (the `jsonb` column Phase 2 already
created). **Not** on `core.character`, and **no likeness boolean anywhere in `core.*`** — likeness
belongs to `dam.style_guide_file` (model doc §2.2).

Proposed key shape, keys present only when there is something to record:

```json
{
  "source_character_name": "Batman aka Bruce Wayne as portrayed by Christian Bale (Batman Begins 2005)",
  "source_character_id": "d34589c0-3a64-4f1a-9937-a79a1490e7d4",
  "identity_rules": ["STRIP_PORTRAYAL", "STRIP_TITLE_YEAR", "SPLIT_AKA", "ALIAS_UNIQUE_MERGED"],
  "rendition": {
    "title_year": "Batman Begins 2005",
    "portrayed_by": "Christian Bale",
    "likeness_label": "Non-Likeness",
    "guide_context": "Avengers",
    "alias": "Bruce Wayne"
  },
  "rendition_description": "Batman Begins 2005 · as portrayed by Christian Bale · non-likeness"
}
```

`source_character_name` and `identity_rules` are on **every** bridge row, so any merge is auditable
back to the legacy text. `rendition_description` is the human phrase the owner asked for.

**3,543 of 8,878 resolved appearances carry preserved detail:**

| Preserved as | Appearances | Stripped from |
|---|---:|---|
| `guide_context` | 2,132 | trailing parenthetical repeating the style guide (`Ant-Man ( Avengers )`) |
| `portrayed_by` | 1,036 | `as portrayed by Christian Bale` |
| `alias` | 319 | a merged secondary name (`Harley Quinn aka Dr. Harleen Francis Quinzel`) |
| `likeness_label` | 91 | `(non-likeness)`, `(non talent likeness)` |
| `title_year` | 58 | trailing `(Batman Begins 2005)` |

A **disambiguating** alias is deliberately *not* duplicated into `rendition` — for
`Robin aka Damian Wayne` the alias is part of the identity, not a rendition of it.
`bridge-metadata-sample.csv` holds 200 real examples.

## 5. Reproducing this

```bash
node tools/generate-style-guide-property-mapping.mjs --all --out <scratch>/audit335.csv
PREVIEW_URL=<preview url> PG_PACKAGE_PATH=<scratch dir with pg installed> \
  node tools/analyze-character-identity-resolution.mjs \
    --audit <scratch>/audit335.csv \
    --output-dir docs/verification/character-identity-rules-20260728
node --test tools/resolve-character-identity.test.mjs
```

`pg` is deliberately not a dependency of this repo (AGENTS.md §9); point
`PG_PACKAGE_PATH` at a scratch directory that has it.

## 6. Files

| File | What it holds |
|---|---|
| `appearance-identity-resolution.csv` | all 9,622 appearances with status, rule chain, resolved identity, property code |
| `canonical-character-identities.csv` | the 6,538 proposed `core.character` rows with property and property rule |
| `identity-decisions-for-owner.csv` | the 154 appearances needing a human identity decision |
| `property-decisions-for-owner.csv` | the 36 characters needing a human property decision |
| `cross-licensor-validation-failures.csv` | the 5 style-guide property answers that fail cross-licensor validation |
| `authorized-licensing-corrections.csv` | the owner-authorized `MU` → `MV` correction, with date and reason |
| `bridge-metadata-sample.csv` | 200 real `core.style_guide_character.metadata` payloads |
| `style-guide-property-decisions-335.csv` | the regenerated 335-row style-guide → property decision set used as input |
| `summary.json` | every count in this README, machine-readable |

## 7. Idempotency

The resolver is a pure function of its input and is asserted to produce identical
counts on a second run inside the analyzer itself. The Phase 3 backfill must still
prove idempotency against the database (insert on conflict, keyed on
`core.taxonomy_source_ref (source_system, source_table, source_id)` with **new**
`source_table` values — never `merchGroup`).

## 8. What was NOT done

- No rows were written anywhere. `core.character`, `core.style_guide` and
  `core.style_guide_character` are still empty on preview — asserted on every analyzer run.
- Production was never connected to.
- No property code was created and none outside the Coldlion MG06 list was used.
- The licensing evidence file was **not** overwritten. `MU` is still recorded as licensing's
  answer in `../style-guide-licensing-review-20260727/`; the correction lives beside it.
- The four other validation failures were **not** corrected. The rule reports; it does not guess.
- The 154 combination rows and the 36 property tie-breaks were left pending.
