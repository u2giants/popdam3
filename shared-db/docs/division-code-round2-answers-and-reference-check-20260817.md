# Division codes, round 2: Uma's second answers + the itemHeader reference check

**Date:** 2026-08-17
**Answered by:** Uma (developer), returned as a filled-in workbook
(`division-codes-questions-for-uma -Answers.xlsx`, shared from
`popcre-my.sharepoint.com`, owner `umeka`).
**Reference check by:** Claude session, read-only against production
`qsllyeztdwjgirsysgai`. **Nothing was changed.**

Round 1 lives in
[`division-code-answers-from-uma-20260813.md`](division-code-answers-from-uma-20260813.md)
(questions Q1–Q8 plus corrections). This file is round 2: the 12 follow-up questions, the
answers, the conclusions drawn from them, and the live reference check Uma asked for
before anything is cleaned up.

> **If you read nothing else:** three findings below change the plan and are not in any
> earlier document — [78% of items sit in the "dead" division 2](#finding-1-78-of-all-items-live-in-the-deprecated-division-2),
> [EP001 is a real retired product line, not a typo](#finding-2-ep001-is-a-real-retired-book-and-education-division),
> and [only 178 of the 363 unclean rows are actually safe to touch](#the-reference-check-results).

---

## How the answers were given

Uma did not use the dropdowns; he wrote free-text notes against every question and added
two data tabs (`B6 - CW001-8`, `B7 - EP001`) plus a screenshot of the bridge table. The
notes are recorded verbatim below because several are conditional, and the condition
matters more than the answer.

**A condition he repeated on eight of the twelve questions:**

> "These are old and inactive now, but please check whether any of these codes are still
> present in the itemHeader table. If not, you can clean up the ones that are no longer
> being used. We may still need some of these codes for existing records that were created
> using them, so please review them carefully and confirm they are not being referenced
> anywhere before proceeding with the cleanup."

That check is the second half of this document. It has now been run.

---

## The answers, verbatim, with what they settle

### 1. The 5 live conflicting rows (`CW001` text / `8` integer, EDGEHOME, active)

> "'Other', 'Glass', 'Plain', 'Foil', 'Glitter/Sequins/Rhinest' These are part of Wall and
> TableTop category. Now Spruce Lic Doesn't Have those categories. Wall and TableTop are
> only part of Pop Lic and Spruce Non-Lic.
> We may still need these codes for existing records that were created using them, so
> please review them carefully before proceeding with the cleanup."

**Settled: these 5 rows are POP Lic.** The integer `8` is the wrong half, not the text.
Fix is `divisionCode_id_fk` → `1`, **not** rewriting the text to `SP001`.

**Independently confirmed by the reference check.** Under the text division (POP Lic)
these 5 codes are used by **348** item records; under the integer division (Spruce Lic),
by **4**. The items agree with Uma.

This is the second time the original Block B rule has been contradicted, once by
reasoning and once by data. It stays withdrawn.

### 2. The other 49 (`CW001` text / `8` integer, company SPRUCE, all inactive)

> "The remaining 49 rows are old and inactive. You can clean up the ones that are no
> longer being used. However, we may still need some of these codes for existing records
> that were created using them, so please review them carefully and confirm they are not
> being referenced anywhere before proceeding with the cleanup."

**Conditional delete.** The check says **34 of the 49 are referenced** and must stay;
15 are safe.

### 3. The 217 rows (`EH001` text / `2` integer)

> "These are old and inactive now, but please check whether any of these codes are still
> present in the itemHeader table. If not, you can clean up the ones that are no longer
> being used. Also, please check whether altering the divisionCodes and divisionCode_id_fk
> values would impact any existing records. If there is no impact, please update the
> records to EH001 and 9 (as an integer)."

**Confirms the Block A fix (integer → 9), conditionally.** The check says **142 of the 217
are referenced**, and the references are overwhelmingly from items *in division 2* — see
[finding 1](#finding-1-78-of-all-items-live-in-the-deprecated-division-2). This fix is no
longer a simple rewrite.

> **A second, independent reason Block A cannot run as written**, found the same day by
> another session and recorded in
> [`merchgroup-271-division-conflicts-back-to-uma-20260817.md`](merchgroup-271-division-conflicts-back-to-uma-20260817.md):
> applying it creates **142 duplicate rows** on `(division, mgTypeCode, mg_code)`, 23 of
> them landing on a code that already means something different in `EH001`. There is no
> unique constraint to stop it, so the update would succeed silently. Read that file
> alongside this one; the two findings are separate and both are blocking.

### 4. The 49 EP001 rows

> "There are two possibilities with EP001, 1. These must have been updated wrongly, it
> should have been EH001 2. Or earlier there could have been code with EP001 (Highly
> Unlikely) […] please check whether any of these codes are still present in the itemHeader
> table."

**His guess is wrong — see [finding 2](#finding-2-ep001-is-a-real-retired-book-and-education-division).**
The rows are a real retired division. The check says 48 of 49 are unreferenced and 1 is
referenced.

### 5. The 39 rows with no division text

> "These are old and inactive now, but please check whether any of these codes are still
> present in the itemHeader table. If not, you can clean up the ones that are no longer
> being used."

**Conditional delete.** The check says **all 39 are unreferenced**. Safe.

### 6. The 4 completely empty rows

> Same conditional wording as above.

**Careful — 3 of the 4 are referenced**, one of them by 536 items. Not safe to delete.

### 7. Companies other than EDGEHOME

> "SPRUCE and UCI are Legacy now, These are old and inactive now, but please check whether
> any of these codes are still present in the itemHeader table."

**Settled: EDGEHOME is the only live company.** SPRUCE and UCI are legacy labels on old
rows, not additional tenants. The item key company component stays `EDGEHOME`.

### 8. The NULL active flag on ids 2 and 7

> "yes We can update these to false (Refer the screenshot)"

**Approved.** Set `is_divcode_active = false` on `divCode_id` 2 and 7.

### 9. Which copy of the division map is authoritative

> "plm.divisionCode should be single source of truth (Refer the screenshot)"

**Settled.** The hardcoded map in `designflow-data-syncing/helpers/utility.js`
(`CW001`→1, `SP001`→8, `EH001`→9) must stop being a second source of truth. The sync
should read the table.

### 10. EP001 in future

> "We don't need EP001, we only use CW001, SP001 and EH001 (Refer the screenshot)"

**Settled.** Three divisions only. EP001 is retired, not planned.

### 11. Backfilling `erp_items_current.division_code`

> "yes We can update these, but will have to be careful while updating these, we will have
> to check divisionCode_fk, divisionCode_id_fk and in merchGroup carefully and then map it."

**Approved in principle — but blocked in practice.** See
[finding 1](#finding-1-78-of-all-items-live-in-the-deprecated-division-2): most items
cannot be mapped to any ColdLion division code today.

### 12. Items with company NULL or `2` ("OTHER")

> "Yes These should be EDGEHOME"

**Settled.** Normalise to EDGEHOME.

### The screenshot he attached

A database view of the bridge table, confirming the five rows exactly as recorded in round
1: ids 1 / 8 / 9 `true`, ids 2 and 7 `[null]`, `company_name_fk` = `EDGEHOME` on all five,
and the real column-name typo `external_divisoncode`.

---

## Three findings from the live data

### Finding 1: 78% of all items live in the deprecated division 2

`dflow."itemHeader"`, live 2026-08-17:

| `div_code_fk` | Division | Items | Active items |
|---|---|---|---|
| **2** | **Everyday — the "deprecated" one** | **15,185** | **0** |
| 1 | POP Lic | 2,770 | 393 |
| 8 | Spruce Lic | 766 | 176 |
| 9 | Spruce non-Lic | 740 | 458 |
| `NULL` | — | 2 | 0 |

Division 2 is deprecated as a *destination* — nothing active is filed there — but it is
where **78% of item history** lives. Two consequences:

1. **The backfill (question 11) cannot simply run.** The agreed rule is "never accept
   `2` as a division code" and there is no ColdLion code for it. Mapping id → ColdLion
   spelling covers only 4,276 of 19,463 item headers. What happens to the other 15,185 is
   an unanswered question, and it is the reason `erp_items_current.division_code` should
   not be filled in yet. Options are to map 2 → `CW001` (the bridge table says id 2's
   `external_divisoncode` **is** `CW001`), to leave those rows blank, or to exclude them.
   **This needs an owner decision and is not in any answer we have.**
2. **The 217-row fix (question 3) is not cosmetic.** Those merch-group rows are referenced
   by 29,250 item-code links from division-2 items. Rewriting their integer from 2 to 9
   re-files taxonomy that division-2 items depend on.

### Finding 2: EP001 is a real retired book and education division

Uma guessed these rows were mis-keyed `EH001`. His own data tab disproves it. The 49
EP001 rows are a coherent product line, created 2019–2020:

- **Type 01** — grade and age bands: `GRD 1`, `GRD 2,3`, `GRD PK-5`, `PREK`, `AGES 6+`
- **Type 02** — `ACTIVITY`, `Early Education`, `MISC`
- **Type 03** — `Orig Flash Cards`, `SA2 Bindup`, `Kenny Kangaroo`, `Sabio Octavio`
- **Type 04** — page and book counts: `114 books`, `168 pgs`, `288 pgs`, `576 books`
- **Type 05** — `SA2`, `SA3`, `SA4`, `SO1`, `Five Below Prompts`

Created by `JSeguine` and `AHazan`. This is not a typo; `EH001` (home decor) has no
concept of grade levels or page counts. It matches ColdLion's own dictionary, where EP001
type codes mean Product Line and Product Type rather than Licensor and Property.

**Treat EP001 as a deliberate retirement, not a correction.** Rewriting these rows to
`EH001` would file school books under home decor and destroy the only record that the
division existed. 48 of the 49 are unreferenced, so retiring them cleanly is easy — but it
should be recorded as a retirement.

### Finding 3: the id columns cover only 14% of items, so code matching is required

`dflow."itemHeader"` stores merch groups **twice**: as text codes
(`udf_merchgroup01`…`udf_merchgroup25_fk`) and as integer keys
(`udf_merchgroup01_id`…`udf_merchgroup15_fk_id`).

| | Rows with a value |
|---|---|
| `udf_merchgroup01` (text) | 18,877 of 19,463 |
| `udf_merchgroup01_id` (integer key) | **2,694** of 19,463 |
| `udf_merchgroup05_fk` (text) | 15,750 |
| `udf_merchgroup05_fk_id` (integer key) | **2,618** |

A reference check on the integer keys alone would have declared 353 of the 363 rows
unused, and been wrong. **Matching by text code alone is also wrong**, because the same
code exists in several divisions — `V` = CANVAS appears as `mg_id` 473 *and* 909, and a
naive code match credits both with the same 6,033 items.

The check below therefore counts a row as referenced if **either** its `mg_id` appears in
an item's integer key, **or** its code appears at its own type position on an item whose
own division matches that row's division. Both interpretations of the contradictory rows
(by text, and by integer) are counted separately.

---

## The reference check results

Scope: all **363** rows of `core."merchGroup"` whose division text and integer are not one
of the three clean pairs (`CW001`/1, `SP001`/8, `EH001`/9).

| Block | Rows | Unreferenced (safe) | Referenced (must keep) | id-key refs | refs under text division | refs under integer division |
|---|---|---|---|---|---|---|
| A: `EH001`/2 | 217 | 75 | **142** | 4 | 1,371 | **29,250** |
| B-dead: `CW001`/8 SPRUCE | 49 | 15 | **34** | 349 | 3,873 | 802 |
| B-live: `CW001`/8 EDGEHOME | 5 | 0 | **5** | 0 | **348** | 4 |
| EP001 | 49 | 48 | 1 | 16 | 0 | 0 |
| No division text, integer 1 | 39 | **39** | 0 | 0 | 0 | 0 |
| Completely empty | 4 | 1 | **3** | 573 | 0 | 0 |
| **Total** | **363** | **178** | **185** | | | |

### What is safe to clean, and what is not

**Safe now (178 rows, no references of any kind):**

- All **39** rows with no division text — a block of finish and construction codes
  (`HI-GLOSS`, `DIECUT`, `LED`, `Tapestry`, `Clocks`…), never used.
- **48 of the 49** EP001 rows. The exception is `mg_id 15` `YA` "Young Adult", used by 16
  items.
- **75 of the 217** Block A rows — mostly artwork-subject codes (`BUTTERFLY`, `FLAMINGO`,
  `PARIS`) and unused sizes.
- **15 of the 49** dead SPRUCE rows.
- **1 of the 4** empty rows.

**Must not be touched without a plan (185 rows).** The notable ones:

| mg_id | Code | Description | Division text / int | Company | References |
|---|---|---|---|---|---|
| 2 | `B` | GREYBOARD | *(blank)* / *(blank)* | *(blank)* | **536** items by integer key |
| 1636 | `SG` | STYLE GUIDE | `CW001` / 8 | SPRUCE | 294 by key, 575 by code |
| 473 | `V` | CANVAS | `EH001` / 2 | EDGEHOME | **5,337** division-2 items |
| 468 | `M` | MDF | `EH001` / 2 | EDGEHOME | **3,780** division-2 items |
| 465 | `G` | GLASS | `EH001` / 2 | EDGEHOME | 1,205 division-2 items |
| 477 | `Q` | PLAQUE | `EH001` / 2 | EDGEHOME | 1,016 division-2 items |
| 538 | `62` | 16X20" | `EH001` / 2 | EDGEHOME | 1,010 division-2 items |
| 1295 | `CU` | Storage Cube | `CW001` / 8 | SPRUCE | 50 by integer key |
| 4 | `D` | WORKSPACE/DESK | *(blank)* / *(blank)* | *(blank)* | 32 by integer key |
| 3 | `B` | BOX | *(blank)* / *(blank)* | *(blank)* | 5 by integer key |
| 3121 | `G1` | Glass | `CW001` / 8 | EDGEHOME | 137 POP Lic items |
| 3580 | `A2` | Plain | `CW001` / 8 | EDGEHOME | 128 POP Lic items |
| 3581 | `11` | Foil | `CW001` / 8 | EDGEHOME | 42 POP Lic items |
| 3582 | `Q3` | Glitter/Sequins/Rhinest | `CW001` / 8 | EDGEHOME | 40 POP Lic items |
| 3120 | `91` | Other | `CW001` / 8 | EDGEHOME | 1 POP Lic item |

The three blank-division rows (`mg_id` 2, 3, 4) are the sharpest trap in the set: they
carry no division at all, they look like obvious junk, and between them **573 items**
point straight at them by integer key.

### The exact query

Re-runnable, read-only. `pos` is the merch-group position, matched against the row's own
`mgTypeCode`; `txt_as_int` translates the ColdLion-shaped text to the DesignFlow id so a
row can be tested under both of its contradictory divisions.

```sql
with bad as (
  select mg_id, mg_code, mg_desc, "mgTypeCode" mgtype, "divisionCode_fk" txt,
         "divisionCode_id_fk" intg, "companyCode_fk" co, is_active,
         case "divisionCode_fk" when 'CW001' then 1 when 'SP001' then 8
                                when 'EH001' then 9 end txt_as_int
  from core."merchGroup"
  where coalesce("divisionCode_fk",'~')||':'||coalesce("divisionCode_id_fk"::text,'~')
        not in ('CW001:1','SP001:8','EH001:9')
), ids as (
  select v mg_id, count(*) n from dflow."itemHeader",
  lateral (values (udf_merchgroup01_id),(udf_merchgroup02_id),(udf_merchgroup03_id),
   (udf_merchgroup04_id),(udf_merchgroup05_fk_id),(udf_merchgroup06_fk_id),
   (udf_merchgroup07_fk_id),(udf_merchgroup08_fk_id),(udf_merchgroup09_fk_id),
   (udf_merchgroup10_fk_id),(udf_merchgroup15_fk_id)) t(v)
  where v is not null group by 1
), codes as (
  select pos, val, div_code_fk, count(*) n from dflow."itemHeader",
  lateral (values (1,udf_merchgroup01),(2,udf_merchgroup02),(3,udf_merchgroup03),
   (4,udf_merchgroup04),(5,udf_merchgroup05_fk),(6,udf_merchgroup06_fk),
   (7,udf_merchgroup07_fk),(8,udf_merchgroup08_fk),(9,udf_merchgroup09_fk),
   (10,udf_merchgroup10_fk),(11,udf_merchgroup11_fk),(12,udf_merchgroup12_fk),
   (13,udf_merchgroup13_fk),(14,udf_merchgroup14_fk),(15,udf_merchgroup15_fk)) t(pos,val)
  where val is not null and val <> '' group by 1,2,3
)
select b.mg_id, b.mg_code, b.mg_desc, b.mgtype, b.txt, b.intg, b.co, b.is_active,
       coalesce(i.n,0) id_refs, coalesce(t.n,0) text_div_refs, coalesce(x.n,0) int_div_refs,
       case when coalesce(i.n,0)+coalesce(t.n,0)+coalesce(x.n,0) = 0
            then 'UNREFERENCED' else 'REFERENCED' end verdict
from bad b
left join ids   i on i.mg_id = b.mg_id
left join codes t on t.pos = b.mgtype::int and t.val = b.mg_code and t.div_code_fk = b.txt_as_int
left join codes x on x.pos = b.mgtype::int and x.val = b.mg_code and x.div_code_fk = b.intg
order by 11 desc, 10 desc;
```

### What this check does NOT cover

Stated plainly so nobody reads it as broader proof than it is:

- Only `dflow."itemHeader"` was checked, because that is what Uma asked for. Other
  consumers of `core."merchGroup"` — RFQs, art pieces, style-guide links, PopDAM,
  reporting views — were **not** checked. An unreferenced verdict here means "no item
  uses it", not "nothing uses it".
- Positions 16–25 have text columns on `itemHeader` but no merch-group types in use;
  they were included in the code sweep and matched nothing.
- Counts are link counts, not distinct items; one item can reference several codes.

---

## Where this leaves each action

| Action | Status |
|---|---|
| Fix the 5 live rows → integer `1` (POP Lic) | **Ready.** Answered and confirmed by 348 item references. |
| Set `is_divcode_active = false` on ids 2 and 7 | **Ready.** Approved outright. |
| Normalise item company NULL / `2` → EDGEHOME | **Ready.** Approved outright. |
| Make `plm."divisionCode"` the only division map | **Ready to plan.** Requires a change in `designflow-data-syncing`, not in shared-db. |
| Delete the 178 unreferenced rows | **Ready, with the caveat above** that only items were checked. |
| Fix the 217 Block A rows → integer `9` | **Blocked, twice over.** 142 are referenced by division-2 items (finding 1), and the same update creates 142 duplicate rows with no constraint to stop it ([duplicate analysis](merchgroup-271-division-conflicts-back-to-uma-20260817.md)). |
| Retire the 49 EP001 rows | **Ready, but record it as a retirement**, not a correction to `EH001`. |
| Delete the 4 empty rows | **Blocked.** 3 of them carry 573 item references. |
| Backfill `erp_items_current.division_code` | **Blocked.** 15,185 of 19,463 items are in division 2, which has no ColdLion code under the agreed rule. |
| `CHECK` constraint on division shape | **Last.** Cannot be enforced while 363 rows violate it. |

**The one open question for the owner:** what division should 15,185 division-2 items
carry in the shared item key? The bridge table maps id 2 to `CW001`, but the agreed rule
says id 2 is dead and must never be accepted. Both cannot be true.

---

## Sources

- Uma's workbook, `division-codes-questions-for-uma -Answers.xlsx` (SharePoint, owner
  `umeka`), read 2026-08-17, including tabs `Questions`, `Evidence`, `B6 - CW001-8`,
  `B7 - EP001` and one embedded screenshot of the bridge table.
- Live read-only queries against `qsllyeztdwjgirsysgai`, 2026-08-17, all reproduced above
  or in the block tables.
- Round 1: [`division-code-answers-from-uma-20260813.md`](division-code-answers-from-uma-20260813.md).
- Q8 proof and the division map:
  [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md).
