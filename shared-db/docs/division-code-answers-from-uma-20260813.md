# Division codes: Uma's answers (2026-08-13)

**Answered by:** Uma (developer), with owner rulings from Albert Hazan.
**Verified against:** production Supabase `qsllyeztdwjgirsysgai` (read-only),
DesignFlow Cloud SQL `designflow."divisionCode"`, the DesignFlow item UI, and the
`designflow-data-syncing` sync code. Nothing was changed.

Questions asked in [`division-code-questions-for-uma.md`](division-code-questions-for-uma.md).

> ## ⚠️ Read this before acting on anything below (added 2026-08-17)
>
> Two parts of this document were overtaken by live evidence gathered **after** it was
> written. The answers themselves stand; these two items do not.
>
> 1. **Q8 no longer needs an API call — it is proven.** See
>    [Q8 settled live](#q8-settled-live-2026-08-17) below and the recorded proof in
>    [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md).
> 2. **The Q5 Block B fix (the 54 rows) is WRONG AS WRITTEN and must not be run.**
>    Those 54 rows are two unrelated groups, and the recommended fix would revive dead
>    data inside a live division. See
>    [Q5 Block B corrected](#q5-block-b-corrected-2026-08-17).
>
> A third gap: **92 further broken rows** exist that this document does not mention at
> all. See [Rows this answer did not cover](#rows-this-answer-did-not-cover-2026-08-17).
>
> 3. **The Block A fix (the 217 rows) does not stand either.** Applying it creates
>    **142 duplicate rows** on `(division, mgTypeCode, mg_code)`, 23 of them landing on a
>    code that already means something different in `EH001`. Across both blocks the rule
>    produces **169 duplicates**, and there is no unique constraint to stop it. Full
>    row-by-row evidence:
>    [`merchgroup-271-division-conflicts-back-to-uma-20260817.md`](merchgroup-271-division-conflicts-back-to-uma-20260817.md).
>
> 4. **Round 2 is answered and supersedes several items here.** Uma answered 12 follow-up
>    questions on 2026-08-17, and the `itemHeader` reference check he asked for has been
>    run against all 363 unclean rows. Two findings change the plan: **78% of all items sit
>    in the "deprecated" division 2**, which blocks the `erp_items_current` backfill, and
>    **EP001 is a real retired book/education division, not a mis-keyed `EH001`**. Read
>    [`division-code-round2-answers-and-reference-check-20260817.md`](division-code-round2-answers-and-reference-check-20260817.md)
>    before acting on any cleanup or backfill described below.

---

## Owner rulings (binding)

1. Only three live divisions: `CW001`→1, `SP001`→8, `EH001`→9.
2. DesignFlow id **2 is deprecated** (old Everyday code, not in use).
3. Company code is **`EDGEHOME` only**.
4. `plm."divisionCode"` / DesignFlow `divisionCode` is maintained **by DesignFlow**,
   not by ColdLion.

## Live mapping

| ColdLion | DesignFlow id | Name | Active |
|---|---|---|---|
| `CW001` | 1 | POP Lic | yes |
| `SP001` | 8 | Spruce Lic | yes |
| `EH001` | 9 | Spruce non-Lic | yes |

Ids 2 (Gen / Everyday) and 7 (POP Lic duplicate) also point at `CW001` in the bridge
table, but 2 is deprecated and 7 is unused. **They must not be treated as live
divisions.** With those excluded, the reverse map ColdLion→DesignFlow is unique.

Bridge table as it stands (source: DesignFlow `designflow."divisionCode"`, mirrored as
`plm."divisionCode"`):

| divCode_id | divCode_code | division_name | company_name_fk | external_divisoncode | is_divcode_active |
|---|---|---|---|---|---|
| 1 | Lic | POP Lic | EDGEHOME | CW001 | true |
| 2 | Gen | Everyday | EDGEHOME | CW001 | null (deprecated) |
| 7 | POP Lic | POP Lic | EDGEHOME | CW001 | null (unused) |
| 8 | Spruce Lic | Spruce Lic | EDGEHOME | SP001 | true |
| 9 | Spruce non-Lic | Spruce non-Lic | EDGEHOME | EH001 | true |

ColdLion also has a fourth division, `EP001`, with no DesignFlow row (see Q4).
The column-name typo `external_divisoncode` (missing "i") is real.

---

## Q1. Is `external_divisoncode` maintained by a process, or hand-entered?

Maintained **in DesignFlow**, not by ColdLion. It is a DesignFlow lookup/seed value on
DesignFlow's `divisionCode` table (mirrored to `plm."divisionCode"`). The ColdLion
item/merch sync does not read it at runtime — it uses a **hardcoded map** in
`designflow-data-syncing/helpers/utility.js`: `CW001`→1, `SP001`→8, `EH001`→9. No job
refreshes the table from ColdLion. If the mapping ever changes, DesignFlow updates the
table **and** the sync hardcode must be changed to match.

## Q2. Ids 1, 2 and 7 all map to CW001. Which are live?

**Only id 1.** The live DesignFlow set is exactly 1, 8, 9. Always reverse-map `CW001`
to 1.

| Id | Status | Why |
|---|---|---|
| 1 | Live | POP Lic — UI, sync, `is_divcode_active = true` |
| 2 | Deprecated | Old Everyday code; owner ruling: not in use |
| 7 | Not live | Duplicate POP Lic label; 0 merchGroup rows |

## Q3. Are 2 and 7 deprecated, and why is the flag NULL?

Yes — 2 is deprecated, 7 is unused. NULL means the flag was **never set historically**;
it is not a deliberate false and does not mean active.

- Filter with `is_divcode_active = true` only (keeps 1, 8, 9).
- Do **not** use `IS NOT FALSE` — that would keep 2 and 7.
- Later cleanup: set `is_divcode_active = false` on ids 2 and 7.

## Q4. Does DesignFlow know about `EP001`?

**No.** There is no `divisionCode` row for it. Sync pulls only `CW001`, `SP001`, `EH001`
and skips unrecognized codes; the frontend only knows 1 / 8 / 9. In `EP001`, ColdLion
type codes mean different things (`MG05`/`MG06` = Product Line / Product Type, not
Licensor / Property), so treating `EP001` like `CW001` would turn product lines into
licensors. Out of scope for DesignFlow item keys today.

## Q5. Text or integer — which is authoritative?

DesignFlow's live identity is the **integer** (1 / 8 / 9): items use
`dflow."itemHeader".div_code_fk`, merch uses `divisionCode_id_fk`, UI constants are
1 / 8 / 9. The text column is the ColdLion-style copy.

For the 271 contradicting `core."merchGroup"` rows (of 3,645 total; 3,553 with both
columns populated):

| Block | Text says | Integer says | Integer really means | Rows | Fix |
|---|---|---|---|---|---|
| A | `EH001` | 2 | deprecated Everyday / CW001 | 217 | Trust text → set integer to **9** |
| B | `CW001` | 8 | Spruce Lic / SP001 | 54 | ~~Trust integer → set text to `SP001`~~ **See correction below — do not run this.** |

Worked example, all sharing MG01 code `0` ("OTHER"):

| mg_id | text | integer | Meaning | Verdict |
|---|---|---|---|---|
| 22 | CW001 | 1 | POP Lic | clean, leave alone |
| 455 | EH001 | 2 | text = Spruce non-Lic; int = deprecated | trust text → id 9 |
| 888 | CW001 | 8 | text = POP Lic; int = Spruce Lic | trust integer → text SP001 (clean POP Lic row already exists as mg_id 22) |

## Q6. Does the DesignFlow item record carry a division?

Yes: `dflow."itemHeader".div_code_fk`, DesignFlow integer (1 / 8 / 9). About 19,461 of
19,463 item headers have it set. `public.erp_items_current.division_code` is NULL on all
17,703 rows because division was dropped on the way in, not because DesignFlow lacks it.
**Backfill from `itemHeader.div_code_fk`.** Worked example: `BRT10DYWP01` has
`div_code_fk = 1`, so ColdLion division = `CW001`.

## Q7. Is EDGEHOME the only company code?

**Yes.** Matches `divisionCode.company_name_fk`, ColdLion tenant usage, and the owner
ruling. `itemHeader.compan_code_fk` is stored as an integer (1 = EDGEHOME); mirror rows
that are null or 2 ("OTHER") are data quality, not extra companies. The item-key company
component is `EDGEHOME`.

## Q8. Does DesignFlow division 1 come back from ColdLion as CW001?

**Yes.** 1 = `CW001`, 8 = `SP001`, 9 = `EH001`. Worked example: `BRT10DYWP01` has
`div_code_fk = 1`, so ColdLion `/items` should return `companyCode = "EDGEHOME"`,
`divisionCode = "CW001"`. ~~One live API call settles any remaining doubt.~~
**That call was made on 2026-08-17 and returned exactly that — see
[Q8 settled live](#q8-settled-live-2026-08-17).**

---

# Corrections and additions (2026-08-17)

Everything in this section was measured live, read-only, against production
`qsllyeztdwjgirsysgai` on 2026-08-17. Nothing was changed.

## Q8 settled live (2026-08-17)

The call was made. `GET /items` with `companyCode=EDGEHOME&itemNo=BRT10DYWP01`
returned **HTTP 200** and:

```
companyCode: EDGEHOME   divisionCode: CW001   itemNo: BRT10DYWP01
merchGroup05: DY   merchGroup06: WP        (CW001 dictionary: Licensor / Property)
```

DesignFlow holds `div_code_fk = 1` for the same item, so the 1 ↔ `CW001` mapping is
proven on a real item, not merely asserted from the bridge table. The canonical item key
`EDGEHOME | CW001 | BRT10DYWP01` is real and buildable. Recorded permanently in
[`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) (PR #956).

Incidental finding from the same call: the "`GET /items` returns HTTP 500" outage note
dated 2026-07-19 was stale. The endpoint is healthy; that note has been retired.

## Q5 Block B corrected (2026-08-17)

**Do not apply the Block B fix as originally written.** The 54 rows are not one
population. Splitting them by company and active flag:

| Text | Integer | Company | Active | Rows | What they actually are |
|---|---|---|---|---|---|
| `CW001` | 8 | `SPRUCE` | all `false` | **49** | Dead legacy Spruce rows |
| `CW001` | 8 | `EDGEHOME` | all `true` | **5** | Live rows — genuinely ambiguous |

Rewriting all 54 to `SP001`, as the original recommendation says, would give 49 dead
rows a clean, live-looking division code inside Spruce Lic. They are inactive today and
should stay that way; the fix would effectively resurrect them.

The 5 live rows are the only part that ever needed a human decision:

| mg_id | mg_code | mg_desc | mgTypeCode | mgCategory |
|---|---|---|---|---|
| 3120 | `91` | Other | 02 | Wall |
| 3121 | `G1` | Glass | 02 | Tabletop |
| 3580 | `A2` | Plain | 03 | Wall |
| 3581 | `11` | Foil | 03 | Wall |
| 3582 | `Q3` | Glitter/Sequins/Rhinest | 03 | Wall |

All five were created by `BRivera` on 2025-04-30, all are `is_active = true`, all are
company `EDGEHOME`, and each has a `parent_id`. Whichever way this is resolved, five
merch-group values land in the wrong division if it is guessed. **This needs someone to
open the DesignFlow screen and report which division these five show under.** It is on
the questionnaire as question 1.

## Rows this answer did not cover (2026-08-17)

The original answer accounted for 271 conflicting rows. There are **92 more** broken
rows in `core."merchGroup"` that it does not mention:

| Text | Integer | Company | Active | Rows | Problem |
|---|---|---|---|---|---|
| `EP001` | `NULL` | `EDGEHOME` | all `false` | 48 | Division DesignFlow does not handle (Q4) |
| `EP001` | `NULL` | `UCI` | `false` | 1 | Unknown division **and** unknown company |
| `NULL` | 1 | `NULL` | all `false` | 39 | No division text and no company at all |
| `NULL` | `NULL` | `NULL` | all `false` | 4 | Completely empty |

Two of these contradict answers given above and need resolving before any division rule
is enforced in the schema:

- **Q4 said DesignFlow does not handle `EP001`** — yet 49 `EP001` rows are already
  sitting in the shared table. In `EP001` the same type codes mean Product Line and
  Product Type rather than Licensor and Property, so if these are ever processed as
  ordinary rows, product lines become licensors.
- **Q7 said `EDGEHOME` is the only company** — yet `core."merchGroup"` also carries
  company `SPRUCE` (the 49 dead rows above, plus 122 more under `EH001`) and one row
  under `UCI`. Company is the first third of the item key, so this must be settled, not
  assumed.

## Full division-encoding census (live, 2026-08-17)

`core."merchGroup"`, every combination present:

| Text | Integer | Company | Active | Rows | Verdict |
|---|---|---|---|---|---|
| `CW001` | 1 | `EDGEHOME` | mixed | 1,269 | Clean — POP Lic |
| `SP001` | 8 | `EDGEHOME` | mixed | 1,090 | Clean — Spruce Lic |
| `EH001` | 9 | `EDGEHOME` / `SPRUCE` | mixed | 923 | Clean — Spruce non-Lic |
| `EH001` | 2 | `EDGEHOME` | all `false` | 217 | Conflict — Block A, fix creates 142 duplicates (see 2026-08-17 collision analysis) |
| `CW001` | 8 | `SPRUCE` | all `false` | 49 | Conflict — dead legacy, leave inactive |
| `CW001` | 8 | `EDGEHOME` | all `true` | 5 | Conflict — needs a human check |
| `EP001` | `NULL` | `EDGEHOME` | all `false` | 48 | Unhandled division |
| `EP001` | `NULL` | `UCI` | `false` | 1 | Unhandled division and company |
| `NULL` | 1 | `NULL` | all `false` | 39 | No division text |
| `NULL` | `NULL` | `NULL` | all `false` | 4 | Empty |

**Total 3,645 rows; 363 of them are not clean** (271 conflicting plus 92 uncovered).

## What is still blocked

Steps 3 and 4 of the "Agreed next steps" below must **not** be run yet:

- **Step 3** (fix the 271 rows) is blocked in full. The 217 Block A rows were thought
  safe, but the collision analysis of 2026-08-17 shows they create 142 duplicates. The
  54 Block B
  rows are split as described above, and 5 of them are waiting on a human.
- **Step 4** (backfill `erp_items_current.division_code`) is sound in principle — the
  mapping behind it is now proven — but has not been approved by the owner, and it
  writes to 17,703 production rows.

An outstanding-questions sheet covering all of this was sent to Uma on 2026-08-17
(12 questions, dropdown answers, with the live evidence attached).

---

## One-line summary

Two encodings of the same real divisions, joined by
`divisionCode.external_divisoncode` plus a matching hardcoded sync map. With owner
rulings applied the live set is only 1↔CW001, 8↔SP001, 9↔EH001, company `EDGEHOME`,
id 2 is dead. The 271 merchGroup conflicts have a fix rule for 217 of them; the
remaining 54 split into 49 dead rows to leave alone and 5 live rows still awaiting a
human check, and a further 92 rows are broken in ways this answer never covered
(see [Corrections and additions](#corrections-and-additions-2026-08-17)). Building
`company | division | item_no` is safe **after** those fixes and the
`erp_items_current` division backfill.

## Agreed next steps (pending Albert's go-ahead per item)

1. **Canonical encoding for new item keys:** ColdLion shape —
   `EDGEHOME | CW001|SP001|EH001 | item_no` — translating DesignFlow ids only through
   the 1 / 8 / 9 map.
2. Never accept `"1"` / `"8"` / `"9"` or deprecated `"2"` as `division_code` in shared
   PLM item tables.
3. Fix the `core."merchGroup"` rows using the Q5 rules — **217 → integer 9 only**.
   The 54-row half of that rule is withdrawn; see
   [Q5 Block B corrected](#q5-block-b-corrected-2026-08-17).
4. Backfill `public.erp_items_current.division_code` from `itemHeader.div_code_fk`.
5. Later shared-db PR: `CHECK` constraint or domain so only ColdLion-shaped division
   codes are accepted.
