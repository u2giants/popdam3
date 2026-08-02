# Characters / style guides — Phase 1 re-verification and open-blocker register

**Run date:** 2026-08-02 · **UTC:** 2026-08-02 13:00 · **Server-local (`America/New_York`):**
2026-08-02 09:00 (`current_setting('TimeZone')` = `America/New_York`, measured, see §2)

**Mode:** READ-ONLY. No `INSERT` / `UPDATE` / `DELETE` / DDL was issued. No migration was
authored. No file outside `docs/characters-*` was written.

**Database target, proven before reading:** the Supabase MCP takes no project parameter, so
`get_project_url` was called first. It returned `https://qsllyeztdwjgirsysgai.supabase.co` —
**production `qsllyeztdwjgirsysgai`**. Every figure in §2–§4 of this document is a **production**
measurement taken through that MCP. Preview `rjyboqwcdzcocqgmsyel` was **not** contacted (this
worktree has no `supabase/.temp/project-ref`, and no preview link was created); preview figures
quoted here are cited from committed evidence and are labelled UNVERIFIED-TODAY.

**Repo state at the moment of writing:** `origin/main` = `4444d7228c8fdd3b5ffa9cca0ce65d364f856868`
(committed 2026-07-31T19:29:12-04:00), highest local migration file `20260731230000`.

---

## 0. Why this document exists — a scope correction, stated first

This work was dispatched as *"Characters / style-guides **Phase 1** — read-only, dispatchable
now"*, with *"Phase 0 blocked on the owner"*. **That phase numbering is stale by six days and
does not match the authoritative plan.**

Per [`fix_characters_style_guides.md`](../fix_characters_style_guides.md) status table (lines
16–18) and [`fix_characters_style_guides_handoff.md`](../fix_characters_style_guides_handoff.md)
§3:

| Plan phase | Real state | Evidence |
|---|---|---|
| **Phase 0 — source decision** | ✅ **COMPLETE 2026-07-26.** Owner approved the hybrid rule. **Not blocked on Albert.** | plan §"Phase 0" |
| **Phase 1 — reconcile the two property populations** | ✅ **COMPLETE 2026-07-26.** It *was* the read-only comparison document. | [`docs/verification/characters-property-reconcile-20260726/`](verification/characters-property-reconcile-20260726/README.md) |
| **Phase 2 — additive schema on preview** | ✅ **COMPLETE 2026-07-28** (preview only) | migration `20260727230000_core_style_guide_axis.sql` |
| **Phase 3 — backfill on preview** | 🟡 **The genuinely open phase.** Rules built and tested; backfill not started. | plan §Phase 3 |

Re-running Phase 1 as if it were unstarted would have produced a duplicate of an existing merged
document. Instead this document does the thing that is actually useful and still strictly
read-only:

1. **Re-verifies** every load-bearing Phase 0/1/2 claim against the live production database
   today, because the underlying figures are 4–7 days old and other workstreams have been
   writing to this repo daily; and
2. **Registers** what Phase 3 actually needs, separating what is blocked on Albert from what is
   blocked on Laura.

---

## 1. Method

Every claim below is one of:

- **VERIFIED (production, 2026-08-02)** — re-measured today via the Supabase MCP against
  `qsllyeztdwjgirsysgai`. The SQL is described inline.
- **VERIFIED (repo artifact, 2026-08-02)** — re-measured today by reading the committed file
  itself (row counts, XML data-validation counts), not by trusting prose about it.
- **UNVERIFIED-TODAY** — quoted from committed evidence measured on a different day or against
  preview, and *not* re-measured here. Treat as an assertion, not a fact.

Nothing in this document is inferred from a document restating another document.

---

## 2. Phase 1's conclusion re-measured on production — it reproduces EXACTLY

**VERIFIED (production, 2026-08-02).** The Phase 1 reconciliation was re-executed from scratch:
normalize property names (`lower`, strip non-alphanumeric), map legacy `public.licensors` to
`core.licensor` by the same documented aliases (`DS → DY`, `WWE → WW`) or normalized name, match
`public.properties` to `core.property` within that licensor, and count `public.characters` rows
under each legacy parent.

| Measurement | Phase 1 doc (2026-07-26) | Re-measured 2026-08-02 | Match |
|---|---:|---:|:--:|
| `public.properties` rows | 500 | **500** | ✅ |
| Legacy properties with character appearances | 335 | **335** | ✅ |
| `public.characters` (appearances) | 9,622 | **9,622** | ✅ |
| `core.property` rows | 256 | **256** | ✅ |
| `core.property` rows with no code | 0 | **0** | ✅ |
| `core.licensor` rows | 26 | **26** | ✅ |
| Property provenance rows in `core.taxonomy_source_ref` | 468 | **468** | ✅ |
| Legacy props matching canonically by normalized name + licensor | 39 | **39** | ✅ |
| …of those, ones that actually contain characters | 21 | **21** | ✅ |
| **Appearances on those matches** | **367** | **367** | ✅ |
| Residual legacy properties with characters | 314 | **314** | ✅ |
| **Residual appearances** | **9,255** | **9,255** | ✅ |

**Conclusion: Phase 1's finding stands unchanged.** `public.characters.property_id` still cannot
be promoted wholesale — 96.2% of appearances still sit under licensing/style-guide catalogue
parents with no direct canonical counterpart. The hybrid Phase 0 decision remains correctly
founded. **No re-work of Phase 0 or Phase 1 is warranted.**

**These are frozen while §2b shows `public.style_guide_files` growing by 2,986 rows in the same
window. That is not a contradiction, but the reason is UNVERIFIED-TODAY.** The verified facts are
only these: nine taxonomy counts are byte-identical to 2026-07-26, and one file-crawl count is
not. The most likely explanation — different tables with different writers, the crawler being
live while the legacy licensing tables are historic — was **not** tested here (no write-audit or
`pg_stat_user_tables` check was run). A future session that needs to rely on the taxonomy tables
being stable should verify that directly rather than infer it from this document.

Supporting production facts measured in the same pass:

- `core.character` = **0 rows** (never populated — as documented).
- `dflow.properties_and_characters` = **10,122**; `dflow.property_character_associations` =
  **9,622**. Both unchanged from the handoff's 2026-07-26 figures.
- `core.taxonomy_source_ref` on production contains **only** `designflow_plm/merchGroup`
  (37 licensor + 468 property rows). **The 542 `coldlion/merchGroupDetails` refs quoted in the
  plan are absent from production** — that much is verified. That they are therefore
  "preview-only" is an **inference**, not a measurement: preview was not contacted. The verified
  claim is the useful one either way — the ColdLion cutover has not touched production.
- `current_setting('TimeZone')` = `America/New_York`; the read ran at 13:00 UTC / 09:00 local.

## 2a. Production is still untouched by this workstream — re-proven at object level

**VERIFIED (production, 2026-08-02),** by object lookup, not by ledger (per `AGENTS.md` §4 rule 5):

- `to_regclass('core.style_guide')` → **null**
- `to_regclass('core.style_guide_character')` → **null**
- migration version `20260727230000` (Phase 2) → **absent** from
  `supabase_migrations.schema_migrations`
- highest production ledger version → `20260731230000`
- `20260731210000` / `20260731220000` (the licensor-alias pair) → **absent** from production;
  `core.licensor_alias` does **not exist** there. (Where they *have* been applied was not
  measured — preview was not contacted.)

The plan's claim "Production is untouched" is therefore **still true as of 2026-08-02 13:00 UTC**.

## 2b. One number in the plan has drifted, and it is drifting continuously

**VERIFIED (production, 2026-08-02):** `public.style_guide_files` = **282,769**.

| Source | Value | Where measured |
|---|---:|---|
| plan §2 / handoff §3 | 279,783 | production, 2026-07-26 |
| plan Phase 3 readiness table | 274,906 | preview, 2026-07-28 |
| **this document** | **282,769** | **production, 2026-08-02** |

That is **+2,986 rows in seven days** — the PopDAM crawler is actively writing. `public.asset_characters`
is stable at **117,012** (production), matching 2026-07-26.

**Consequence:** the plan's own warning that "Phase 4 must re-measure both on the database it is
actually working against" is not a formality — `style_guide_files` is a **moving target** and any
Phase 4 copy must be reconciled against a count taken inside the same transaction/window, not
against a number written into a document. This document's 282,769 will itself be stale within days.

---

## 3. Two defects found in the current documentation

These are new findings, not restatements. Both affect Phase 3.

### 3.1 `JL` is wrongly grouped with `EX` and `LB` — it is a different class of problem

The plan (`fix_characters_style_guides.md`, "Licensing round 1" and §8a) states that `C033`
(Maxwell Lord) was answered `JL`, "which was not offered and **is absent from `core.property`**
(same class as `EX`/`LB`)", and §8a then lists "`EX`, `LB` and `JL`" together as blocked on the
owner's ColdLion-code policy ruling. The dispatch brief for this work repeated it, adding that all
three are correctly absent from the round-2 sheet because Laura already answered them properly.

**That is wrong for `JL`, on three independently verified counts:**

1. **VERIFIED (production, 2026-08-02):** none of `EX`, `LB`, `JL` has a `core.property` row —
   true for all three, so far so good.
2. **VERIFIED (repo artifact, 2026-08-02):** `EX` and `LB` **are real ColdLion codes**. Both are
   listed in [`docs/coldlion-unmatched-properties-by-licensor-20260731.md`](coldlion-unmatched-properties-by-licensor-20260731.md)
   lines 58–59 as `EX` = THE EXORCIST and `LB` = THE LOST BOYS, both Warner Bros, both annotated
   "Confirmed by Laura, round 1". **`JL` appears nowhere in that file** — `grep -c "JL"` returns
   `0`. `JL` is therefore **not among the unmatched ColdLion codes awaiting an admission
   ruling.** Stated precisely: `JL` is absent from `core.property` **and** absent from the
   unmatched-ColdLion register — those are the two sources actually checked. Whether it exists
   anywhere else in ColdLion was **not** tested (the ColdLion API was not called). That is
   sufficient for the actionable point: **admitting the 66 unmatched ColdLion codes would resolve
   `EX` and `LB` and would not resolve `JL`.**
3. **VERIFIED (repo artifact, 2026-08-02):** `C033` / Maxwell Lord **is in the round-2 sheet**,
   contrary to the claim that `JL` is absent from it. Extracted from
   `licensing-questions-for-laura-round2-20260731.xlsx`, sheet 2, its row reads:
   `C033 | Character sits under two or more MG06 codes | Warner Bros | Justice League Core | Supergirl: Television Series (2015) | Superman (2025) | Wonder Woman 1984 (2020) | Maxwell Lord | JL | You answered "JL". That code was not one of the choices and does not exist in our property list. | Pick exactly ONE code.`
   Its dropdown is `"JG,SG,SM,WW,NONE"` — `JL` is deliberately **not** offered.

**Impact.** `JL` is **not** blocked on Albert. It is blocked on **Laura**, and it was correctly
re-asked. The plan's §8a and the coordinator's blocker register both misfile it, which would cause
a future session either to hold Phase 3 waiting for an owner ruling that cannot resolve it, or to
put `JL` back in front of Albert as a policy question when the answer must come from licensing.

`EX` and `LB` are correctly filed: they are genuine ColdLion codes, Laura's answers were right,
and the gap is ours.

**Recommended correction (not applied — this document changes no other file):** in
`fix_characters_style_guides.md` §8a, list only `EX` and `LB` as the owner-policy blockers, and
move `JL` / `C033` into the round-2-outstanding list.

### 3.2 Two round-1 property codes resolve to a "NO LICENSE" property

**Two evidentiary layers here — read the labels.**

**UNVERIFIED-TODAY (plan prose only):** the plan records that of the 154 combination rows returned
in round 1, some came back as MG06 codes — `TS` 27, `LT` 13, `CR` 7, `HSM` 7, `MM` 4 — and 95 came
back `NONE`. **Those code counts sum to 58, not 154**; 58 + 95 = 153 of the 154, with one row
(`C004`, Blade) recorded as blank. This subset structure is the plan's own account and could not
be re-verified, because **Laura's returned round-1 workbook is not committed to this repo** (§3.3).
The association of `CR` specifically with *Camp Rock* likewise rests on plan prose and is
**UNVERIFIED-TODAY**.

**VERIFIED (production, 2026-08-02):** what each of those codes actually resolves to in
`core.property` joined to `core.licensor` today:

| Code | `core.property.name` | Licensor |
|---|---|---|
| `TS` | TOY STORY 4 | `DY` DISNEY |
| `LT` | LOONEY TUNES | `WB` WARNER BROS |
| **`CR`** | **CREATURE** | **`ZZ` DTR - NO LICENSE** |
| `HSM` | HIGH SCHOOL MUSICAL | `DY` DISNEY |
| `MM` | MICKEY MOUSE | `DY` DISNEY |
| `CC` | COCO | **`ZZ` DTR - NO LICENSE** |
| `MU` | MUPPETS | `DY` DISNEY |
| `MV` | MARVEL ASSORTED STYLES | `MV` MARVEL |

The plan already flags `CC` (Coco under `ZZ`) as unresolved. It does **not** flag `CR`. `CR` in
`core.property` is **CREATURE under `ZZ` DTR - NO LICENSE** (verified), and per the plan's prose
the seven `CR` answers were Camp Rock rows — a Disney property (unverified). This is the same
defect class as `MU`→`MV`
(a code that looks right and means something else entirely), which the owner already had to correct
by hand.

**Impact.** Those round-1 answers were correctly discarded as unusable, so **nothing is corrupted
today**. The risk is forward-looking: if any future step salvages the round-1 code answers rather
than waiting for round 2, seven Camp Rock rows would attach to a no-license property. The
cross-licensor validation rule the owner authorised on 2026-07-29 would catch it — **provided it
is run over round-2 answers too.**

**Recommended action (not applied):** state explicitly in the plan that
`tools/validate-licensing-answers.mjs` plus the cross-licensor rule must be run over the round-2
return before any answer is accepted, exactly as round 1 required.

### 3.3 A gap in the evidence trail (finding, not a defect in anyone's work)

**VERIFIED (repo artifact, 2026-08-02).** `docs/verification/character-identity-rules-20260728/`
contains the round-1 **questions** file
(`licensing-questions-for-laura-20260729.csv`, 195 rows, `YOUR_ANSWER` column blank) but **not
Laura's returned round-1 workbook**. `git log` on that directory shows four commits, none adding a
returned file. The round-1 answers exist in this repo only as prose summary inside
`fix_characters_style_guides.md`.

Every statement in this document about *what Laura answered in round 1* is therefore
**UNVERIFIED-TODAY** — it rests on that prose, not on the artifact. The one exception is `C033`,
whose round-1 answer (`JL`) is independently preserved inside the round-2 workbook's
"what you answered last time" column, which is how §3.1 could verify it.

**Recommended action (not applied):** commit Laura's returned round-1 file, and commit her round-2
return the moment it arrives. Without it, the audit trail for a royalty-bearing taxonomy decision
is a paragraph.

---

## 4. Round-2 sheet — claims re-verified against the file itself

**VERIFIED (repo artifact, 2026-08-02),** by reading the XLSX package XML directly:

| Claim in the plan | Verified? | Evidence |
|---|:--:|---|
| Two sheets, guidance first | ✅ | `xl/workbook.xml` names: `How to fill this in`, `Open questions` |
| **166 open rows** | ✅ | sheet 2 contains **167** `<row>` elements = 1 header + **166** data rows |
| **166 data validations** — every answer cell a locked dropdown | ✅ | **166** `<dataValidation>` elements on sheet 2 |
| 154 × `NOT CHARACTERS - DROP THE ROW` / `REAL CHARACTERS - I LISTED THEM` | ✅ | that exact `formula1` occurs **154** times |
| The 11 remaining property rows carry only their own valid codes plus `NONE` | ✅ | the other 12 validations are `"DP,XM,NONE"` ×7, `"DP,MV,XM,NONE"`, `"MV,AV,GM,NONE"`, `"BM,SM,WW,NONE"`, `"JG,SG,SM,WW,NONE"` (= `C033`), `"CC,NONE"` (= `A005` Coco). 11 property tie-breaks + Coco = 12. |
| `A005` (Coco) carries `CC` / `NONE` | ✅ | `"CC,NONE"` present exactly once |
| The 29 resolved rows were removed | ✅ (partially) | `Lost Boys`, `Exorcist`, `Black Adam`, `Big Hero` all absent from the sheet text |

**Reconciliation.** 154 combination + 11 property tie-breaks + 1 Coco = **166** ✓, matching both
the plan's decomposition and the file. The plan's "11" **includes** `C033`. §5 splits `C033` out
separately, giving 154 + 10 + 1 + 1 = 166; the two decompositions are alternatives, not addends.

**The round-2 sheet is sound.** The round-1 format failure (free-text names requested in a
code-shaped column) cannot recur — every one of the 166 answer cells is constrained.

---

## 5. What Phase 3 needs, and who each item is blocked on

Phase 3 is the next executable phase. It is **not** dispatchable today. Its preconditions:

### Blocked on **Laura** (licensing) — cannot be resolved internally

| # | Item | Rows | Status |
|---|---|---:|---|
| L1 | Round-2 return: are the combination rows real characters or labels? | 154 | Sent 2026-07-31. **Outstanding.** |
| L2 | Round-2 return: the property tie-breaks **excluding `C033`** — 7 × `DP,XM,NONE`, 1 × `DP,MV,XM,NONE`, 1 × `MV,AV,GM,NONE`, 1 × `BM,SM,WW,NONE` | 10 | Sent 2026-07-31. **Outstanding.** |
| L3 | Round-2 return: `A005` Coco — `CC` or `NONE` | 1 | Sent 2026-07-31. **Outstanding.** |
| L4 | **`C033` Maxwell Lord (`JL`)** — re-asked with `JG/SG/SM/WW/NONE` | 1 | **Outstanding. Currently misfiled as an owner blocker — see §3.1.** |
| | **Total** | **166** | 154 + 10 + 1 + 1 = 166 ✓ |

> **Note on the "11 property tie-breaks" figure in the plan.** The plan's 11 **includes** `C033`.
> This table breaks `C033` out as L4 because it is the row that has been misfiled as an owner
> blocker, so L2 is **10**, not 11. Both decompositions total 166; do not add them together.

### Blocked on **Albert** (owner policy) — licensing cannot answer these

| # | Item | Status |
|---|---|---|
| A1 | **Admit the unmatched ColdLion property codes?** Specifically `EX` (THE EXORCIST) and `LB` (THE LOST BOYS) — both real ColdLion codes, both confirmed by Laura, **neither has a `core.property` row**. 66 ColdLion codes are unmatched overall (51 still active), and ColdLion has no expiry flag, so a blanket admission would resurrect lapsed licences. | **Open.** Ready to ask; the table exists in `docs/coldlion-unmatched-properties-by-licensor-20260731.md`. **Do not re-ask Laura — she already answered correctly.** |
| A2 | **The 154 combination rows — policy fallback.** The plan recommends excluding them (invents nothing). If Laura's round-2 answers are again unusable, the owner must choose exclude / split / decide the 30 style guides individually. | **Open but NOT askable yet — contingent on L1.** Do not put this to Albert before Laura's round-2 return has been validated. |
| A3 | **`Coco` → `CC` sits under licensor `ZZ` DTR - NO LICENSE** while the style guide is Disney. Verified on production today. Even a `CC` answer from Laura leaves a cross-licensor violation the authorised fail-closed rule will reject. | **Open.** This is a master-data question, not a licensing one. |

### Not blocked — internal work that could start now if the coordinator chooses

| # | Item |
|---|---|
| I1 | Correct §3.1 and §3.2 in `fix_characters_style_guides.md` (owned by another agent's file lock during this run; **deliberately not done here**). |
| I2 | Commit Laura's returned round-1 workbook (§3.3). |
| I3 | Extend `tools/validate-licensing-answers.mjs` coverage so the **cross-licensor** rule runs as part of answer validation, not as a separate later pass. Today they are two steps and only the code-existence half is automated at intake. |
| I4 | Re-measure `public.style_guide_files` inside the Phase 4 window rather than trusting any documented figure (§2b). |

**What is NOT blocked and is often mistakenly listed as blocked:** Phase 0 (complete 2026-07-26)
and Phase 1 (complete 2026-07-26, and re-verified here).

---

## 6. Conclusions that depend on Laura's outstanding reply

Stated explicitly, per the dispatch requirement:

- **Everything in §5's L1–L4 is contingent on her reply.** No Phase 3 backfill row count, character
  total, or exclusion count is final until it lands.
- **`A2` is a *hybrid*, not a pure owner item.** It is listed under "blocked on Albert" because
  only he can rule, but it only becomes *askable* once Laura's round-2 answers arrive and are
  judged usable or not. A reader of §5's table alone would wrongly file it as ready to ask today.
  **It is not.**
- **`A3` may not be unblocked by `L3`.** Even if Laura re-confirms `CC` for Coco, `CC` still sits
  under licensor `ZZ` (verified today), so the owner-authorised fail-closed cross-licensor rule
  will still reject it. `L3` and `A3` must be resolved together, not in sequence.
- **The "9,622 appearances → 6,538 characters" figure is *half* provisional.** The **9,622** input
  is VERIFIED on production today (§2). The **→ 6,538** derivation is UNVERIFIED-TODAY: it was
  computed on preview 2026-07-28, before round 1 returned and before the 154 combination rows
  were resolved. If Laura rules the combination rows are real characters and lists names, the
  character total rises; if they are dropped, it falls.
- **§3.1's recommendation depends on her reply only for the answer, not for the finding.** That
  `JL` is not a ColdLion code and that `C033` is in round 2 are both verified facts today,
  independent of what she returns.
- **§3.2 does not depend on her reply.** `CR` = CREATURE under `ZZ` is a production fact today.
- **§2, §2a, §2b and §4 do not depend on her reply at all.**

---

## 7. What this document deliberately did NOT do

- **No preview measurement.** No preview link existed in this worktree and creating one is a
  connection, not a read of an existing session. All preview figures are labelled
  UNVERIFIED-TODAY. If the coordinator wants preview re-verified, that is a separate dispatch.
- **No edit to `fix_characters_style_guides.md`, `HANDOFF.md`, `AGENTS.md`,
  `COORDINATOR_INTAKE.md`, or `supabase/migrations/`.** Other agents held those files during this
  run. The corrections in §3.1/§3.2 are **recommended, not applied.**
- **No re-run of Phase 0 or Phase 1 as new work.** They are complete; they were re-verified.
- **No question put to Albert or Laura.** Owner and licensing gates belong to the coordinator.
- **No write of any kind to any database.**

---

## 8. Independent review

This document was reviewed by **GLM 5.2** (read-only, via `ai-glm-agent`) before publication. It
raised nine points. **Eight were accepted and are already applied above**, including one genuine
arithmetic defect: an earlier draft of §5 decomposed the 166 round-2 rows as 154 + 11 + 1 + 1 =
**167**, double-counting `C033` (which the plan's "11 property tie-breaks" already contains).
That is now 154 + 10 + 1 + 1 = 166, with an explicit note that the plan's decomposition and this
one are alternatives rather than addends. The other accepted points tightened
VERIFIED/UNVERIFIED labelling in §2, §2a, §3.1, §3.2 and §6.

One point was **partially rejected**: GLM read §4's "11 vs 12" note as an internal contradiction
with §5. It was ambiguous wording, not a contradiction — §4's own reconciliation (154 + 11 + 1 =
166) was arithmetically correct throughout. The note has been rewritten for clarity, but §4's
figures were not wrong.

## 9. Reproduction

All production figures came from four read-only statements through the Supabase MCP against
`qsllyeztdwjgirsysgai` (proven by `get_project_url` first):

1. Row counts across `core.character`, `core.property` (total and null-code), `core.licensor`,
   `public.characters`, `public.properties`, `public.style_guide_files`,
   `public.asset_characters`, `dflow.properties_and_characters`,
   `dflow.property_character_associations`.
2. `to_regclass` on both Phase 2 tables; `supabase_migrations.schema_migrations` filtered to
   `version >= '20260726000000'`; `core.property` filtered to `code in ('EX','LB','JL')`;
   `core.taxonomy_source_ref` grouped by `entity_table, source_system, source_table`;
   `current_setting('TimeZone')` and `now()`.
3. The Phase 1 reconciliation CTE described in §2.
4. `core.property` joined to `core.licensor` filtered to 14 codes
   (`BP, BK, CC, MV, DC, CP, MU, TS, LT, CR, HSM, MM, DP, XM`); all 14 returned a row. Eight of
   them are shown in §3.2's table; the remainder (`BP`, `BK`, `DC`, `DP`, `XM`, `CP`) are cited
   in §3.1 and §5 or were queried as controls.

Repo-artifact figures came from reading the XLSX package XML
(`xl/workbook.xml`, `xl/worksheets/sheet2.xml`) and from `grep` over
`docs/coldlion-unmatched-properties-by-licensor-20260731.md`.
