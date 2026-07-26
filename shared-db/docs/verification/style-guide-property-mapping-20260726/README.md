# Style guide → property mapping — review sheet for the licensing team

**Captured:** 2026-07-26 · **Source of truth for the model:**
[`../../style-guides-characters-and-royalties.md`](../../style-guides-characters-and-royalties.md)

This folder holds the inputs, the generator, and the output for the sheet the licensing team
fills in. It exists so the sheet can be **regenerated and audited** rather than trusted as a
one-off export.

## Regenerate

```bash
node tools/generate-style-guide-property-mapping.mjs          # 174 rows needing a decision
node tools/generate-style-guide-property-mapping.mjs --all    # all 335 style guides
```

Reads only the files in this folder. No database or network access required.

## Files

| File | What it is |
|---|---|
| `style-guide-property-mapping.csv` | **The deliverable.** 174 style guides that need a human decision, each with up to two suggestions and a blank column for the answer. |
| `style-guide-source-rows.json` | The 335 style guides that actually have characters, pre-bucketed (149 name-matched, 8 classics→`CP`, 4 no-code, 174 needs-review). |
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

Columns: `licensor · style_guide · characters · folder_property · folder_leaf_match ·
folder_confidence · coldlion_mg06_code · coldlion_mg06_desc · coldlion_confidence ·
final_mg06_code (licensing team fills in)`

The licensing team puts **one MG06 code per row** in the last column — the code the style guide
belongs to, `CP` for a Disney Classic, a marker such as `NEW` where a code must be created, or
blank/`NONE` where there genuinely is no property.

### The two suggestion columns are hints, not authority

Both are **fuzzy text similarity**. They are a starting point, and the confidence percentage
says how much to trust each one; anything below ~50% deserves a human look. Known bad example:
"Disney Princess" suggests `DISNEY VILLAINS` at 33%.

The two sources also **group differently on purpose**, and neither is wrong:

- the folder tree files Batman under `WB/DC`
- Coldlion gives Batman its own code `BM`

Both columns are shown so a human reconciles them rather than a script picking a winner.

### A blank suggestion is a finding

Coverage of the 174: **79** have a folder-tree property, **62** have a Coldlion guess, **74** have
neither. That last group is the real work — titles with no property code in Coldlion *and* no
property folder on the server. Verified absent from Coldlion: Pirates of the Caribbean, the
Matrix films, the Hobbit films, Scooby-Doo, Shazam, Suicide Squad, The Incredibles, Tsum Tsum.
Those need a code created or a bucket chosen.

## Scope note

This sheet resolves **style guide → property** only. It does not decide character identity
(§7 open question 4 of the model doc) and it does not touch the database.
