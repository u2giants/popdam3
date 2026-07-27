# Style guide → property mapping review sheet

**Captured:** 2026-07-26 · **Source of truth for the model:**
[`../../style-guides-characters-and-royalties.md`](../../style-guides-characters-and-royalties.md)

This folder holds the inputs, the generator, and the output for the sheet the licensing team
fills in. It exists so the sheet can be **regenerated and audited** rather than trusted as a
one-off export.

## Current decision model

The generator accounts for all 335 populated style guides. The delivered review
sheet contains only the **153 truly uncertain rows**. The accepted rows remain
reproducible with `--all` but do not consume licensing-team time.

| Status | Rows | Meaning |
|---|---:|---|
| `ACCEPTED_DIRECT` | 21 | The owner accepted the exact normalized DAM parent + licensor match. These 21 parents contain 367 appearances. |
| `ACCEPTED_CLEAR_MG06` | 153 | Clear existing MG06 property name matches, such as Lizzie McGuire → `MCG`, Monsters University → `MS`, and strong matches scoring 70% or higher. |
| `ACCEPTED_CLASSIC_CP` | 5 | Owner-confirmed Disney Classics: 101 Dalmatians, Aristocats, Bambi, Jungle Book, Lion King. |
| `ACCEPTED_NO_CODE` | 3 | Owner-confirmed no-code titles: Inside Out, Kim Possible, Luca. No placeholder may be created. |
| `NEEDS_REVIEW` | 153 | Only unclear choices, conflicts, missing codes, and unconfirmed Classics/no-code guesses. |

This replaces the old incomplete story that combined 367 accepted appearances
with a 174-row sheet built from a different 149/8/4/174 bucket split.

Weak fuzzy matches remain in review. For example, `Wreck-It Ralph 2 → IT 2017`
scores only 63% and is not accepted.

## Regenerate

```bash
node tools/generate-style-guide-property-mapping.mjs        # 153 review rows
node tools/generate-style-guide-property-mapping.mjs --all  # all 335 audit rows
```

Reads only the files in this folder. No database or network access required.

## Files

| File | What it is |
|---|---|
| `style-guide-property-mapping.csv` | **The deliverable.** Only the 153 style guides that need a human decision. |
| `style-guide-source-rows.json` | The 335 style guides that actually have characters. Its older buckets are input hints only; the generator applies the approved decision rules. |
| `coldlion_mg06.json` | Coldlion MG06 property dictionary, all four divisions, 576 rows / 318 distinct descriptions. |
| `styleguide_tree.txt` | Folder listing from `edge1:/volume1/styleguides`, 1,958 directories to depth 3. |

## How each input was captured

**`styleguide_tree.txt`** — over SSH to the Synology (`edge1`). Names only; no files were read.

```bash
ssh edge1 'find /volume1/styleguides -mindepth 1 -maxdepth 3 -type d \
  -not -path "*@eaDir*" -not -path "*#recycle*"'
```

Structure is `/volume1/styleguides/<licensor>/<property>/<style-guide folder>` — **the level-2
folders are the property layer**, which is the human-curated grouping that exists nowhere in the
database. 21 licensors, 368 property folders, 1,569 leaf style-guide folders.

**`coldlion_mg06.json`** — Coldlion ERP, per division. Auth per
[`../../coldlion-erp-api-reference.md`](../../coldlion-erp-api-reference.md); on Windows use the
1Password MCP `op_run` with a **native** shell (a bare `bash` is WSL and drops the injected key).

```
GET http://x5.coldlion.com/EhpApi/merchGroupDetails
      ?companyCode=EDGEHOME&divisionCode={CW001|SP001|EH001|EP001}&mgTypeCode=06
```

Only `CW001`/`SP001` are used for matching — they are the two divisions where `mgTypeCode 06`
means "Property" at all (see the merch-group doc §2).

**`style-guide-source-rows.json`** — from production `qsllyeztdwjgirsysgai`: the `type='PROPERTY'`
rows of `dflow.properties_and_characters` that have at least one character through
`dflow.property_character_associations`. Remember the legacy naming trap: those `type='PROPERTY'`
rows **are style guides**, not properties.

## Reading the sheet

Every delivered row is marked `NEEDS_REVIEW`. The licensing team fills in
`final_mg06_code`.

The answer must be an **existing Coldlion MG06 code**, `CP` for a confirmed
Disney Classic, or `NONE` where no property code exists. `NEW` is not allowed.
If a new property is truly needed, the business must create its code in Coldlion
first. This sheet must never create a placeholder in `core.property`.

### The two suggestion columns are hints, not authority

Both are **fuzzy text similarity**. They are a starting point, and the confidence percentage
says how much to trust each one; anything below ~50% deserves a human look. Known bad example:
"Disney Princess" suggests `DISNEY VILLAINS` at 33%.

The two sources also **group differently on purpose**, and neither is wrong:

- the folder tree files Batman under `WB/DC`
- Coldlion gives Batman its own code `BM`

Both columns are shown so a human reconciles them rather than a script picking a winner.

### A blank suggestion is a finding

The folder and fuzzy MG06 columns are suggestions only. Clear existing MG06
property-name matches are handled automatically. This includes harmless wording
differences such as `Lizzie McGuire - TV Series → LIZZIE MCGUIRE` and franchise
members such as `Monsters University → MONSTERS`.

Titles with no match need an existing bucket chosen or `NONE`. If the business
needs a new code, it must be added to Coldlion before this migration can use it.

## Scope note

This sheet resolves **style guide → property** only. It does not decide character identity
(§7 open question 4 of the model doc) and it does not touch the database.

## Corrections after independent review

Grok independently checked the Phase 0/1 work on 2026-07-26. It confirmed the
counts but found that the 367 direct agreements and old 174-row sheet came from
different matching tracks. The old wording left 128 populated parents without
a stated decision path.

The correction:

- accounts for all 335 style guides in the generator;
- keeps the 21 owner-accepted direct parents automatic;
- accepts 153 clear existing MG06 name matches automatically;
- keeps only the five owner-named Classics automatic;
- keeps only the three owner-named no-code titles automatic;
- returns Dumbo, Dumbo (2019), Lion King (2019), and Inside Out 2 to review;
- removes `NEW`;
- delivers only the remaining 153 uncertain rows to the licensing team.
