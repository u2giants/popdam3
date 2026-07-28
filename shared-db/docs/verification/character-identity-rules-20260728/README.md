# Character identity resolution rules — proposal and evidence

**Captured:** 2026-07-28 · **Database:** preview `rjyboqwcdzcocqgmsyel`

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
second question — which single property each character belongs to — leaves **173
characters** (425 appearances) needing a human decision.

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
| `SINGLE_CANDIDATE` | 4,638 | Every style guide agreed. |
| `NO_PROPERTY_CANDIDATE` | 1,302 | Only `NEVER_DESIGNED` / no-code guides — `property_id` stays null, no placeholder invented. |
| `REVIEWED_FRANCHISE_RULE` | 193 | The already-reviewed DC/Marvel character→franchise table decides it. |
| `MOST_SPECIFIC_CODE` | 204 | Franchise code beats a group umbrella (`AV`, `JG`, `SX`, `GM`, `CP`, `MP`), which beats an assorted-styles bucket (`MV`, `DC`). |
| `MAJORITY_OF_APPEARANCES` | 28 | A strict majority among equally specific codes. |
| **`NEEDS_HUMAN`** | **173** | Equally specific, equally frequent — a coin flip. |

`property-decisions-for-owner.csv` holds those 173 (425 appearances), each with its
candidate codes, their Coldlion descriptions, and the style guides they came from.
Typical cases: `Steve Rogers → AV / CA`, `Erik Killmonger → AV / BP`, and two genuine
same-name-different-character collisions (`Judy → A9 Annabelle Comes Home / C3 The
Conjuring 2`).

### One licensing answer looks wrong and should be re-asked

The licensing review answered the **`Marvel Universe`** style guide (1,041
appearances) with code **`MU`**. In the captured Coldlion MG06 dictionary
**`MU` = MUPPETS**. The code validates, so no existing check caught it, but it
attaches a Muppets property to ~1,000 Marvel character appearances. Correcting it
(most likely to `MV`, Marvel Assorted Styles) on its own removes 25 of the 173
property decisions. **Confirm this before the backfill.**

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
| `property-decisions-for-owner.csv` | the 173 characters needing a human property decision |
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
  `core.style_guide_character` are still empty on preview.
- Production was never connected to.
- No property code was created and none outside the Coldlion MG06 list was used.
