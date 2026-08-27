# Implementation plan: match merchandise groups on the three axes the taxonomy actually uses

## STATUS

| Step | Status | Date | Evidence / starting point |
|---|---|---|---|
| 0. Freeze the baseline and reproduce the current shortfall | ⬜ not started | | Reproduce the 2026-08-17 run: 2,294 three-level, 7,496 two-level, 2,600 MG01-only, and the 10,096-item depth-3 shortfall in Section 3. |
| 1. Add the merchandise-group code-validity layer | ⬜ not started | | 13.2% of post-change teaching rows carry an MG03 undefined for their MG01+MG02 (Finding F8). |
| 2. Rebuild the parser on three independent axes | ⬜ not started | | Form / material / embellishment, replacing the blended product-type string (Findings F5-F7). |
| 3. Give embellishment an explicit "none" state and map it to MG03 `0` | ⬜ not started | | MG03 `0` exists and is used by 581 post-change items (Finding F4). |
| 4. Re-key the association maps and matcher onto the axes | ⬜ not started | | MG01 from form, MG02 from form+material, MG03 from form+material+embellishment. |
| 5. Add axis-separation, contamination, and validity tests | ⬜ not started | | Extends the existing 14 tests; none of them currently detect Findings F7 or F8. |
| 6. Rerun, re-measure, regenerate the workbook, update documentation | ⬜ not started | | Report the new match distribution against the Section 3 baseline. |

**Current state:** Written and awaiting owner review. Nothing implemented. The 2026-08-17 method described in `plan_item_description_mg_taxonomy_repair.md` remains the live method until this plan lands.

---

## 1. Ultimate goal

POP Creations needs a defensible merchandise-group assignment for each item created on or before May 13, 2025, expressed in the system introduced on May 14, 2025.

The 2026-08-17 implementation achieved that goal but reached a full `MG01+MG02+MG03` result for only 2,294 of 12,390 classifiable historical items. Investigation on 2026-08-26 established that the largest causes are defects in our own parsing and evidence handling, not limits of the source data.

When this plan is complete:

- item descriptions are parsed into the three axes the merchandise-group system actually encodes — physical form, material, and embellishment — and never into a single blended product name;
- a material word alone never determines what a product is, so a storage bin made of canvas is classified as storage, not as a canvas;
- an item whose description fully describes a plain, unembellished product receives the real "no embellishment" MG03 code rather than a blank;
- an item whose description is merely silent about embellishment still receives a blank, and the two cases are distinguishable in the output;
- no post-change item teaches the matcher a merchandise-group combination that the rework workbook does not define;
- the reported match distribution reflects genuine evidence limits rather than parser artifacts.

**If any step conflicts with this goal, the goal wins. Stop and flag the conflict rather than following the step mechanically.**

## 2. What this application is

File-based analysis inside `u2giants/shared-db`. It reads two source files and writes spreadsheets. It is not a production application.

**This work is out of scope for the shared-db structure orchestrator (AGENTS.md §0.0-B).** It changes no schema, table, column, view, function, trigger, policy, index, or migration, and it reads and writes no database row. No `db-work` issue is required and none should be opened.

Inputs:

- `docs/verification/item-mg-reclassification-20260814/data/full_item_master.csv` — 19,302 Item Master rows.
- `docs/verification/item-mg-reclassification-20260814/data/MerchGroup_Rework.xlsx` — the merchandise-group definition workbook. Sheet `Final Version` holds the code dictionary; sheet `Sizes` holds MG04.
- `docs/verification/coldlion-licensor-property-phase3-20260725/designflow-fresh-edges.json` — licensor and property names, used only to strip those chunks out of descriptions.

Per Albert Hazan's 2026-08-15 ruling recorded in the data-folder README, the two source files and their product descriptions are not confidential and are published in this repository. Generated row-level workbooks stay in `outputs/issue-1113-taxonomy/`, which ignores everything except the one published final workbook.

Code to be changed:

- `docs/verification/item-mg-reclassification-20260814/hierarchical_item_taxonomy.py` — parser, association maps, matcher.
- `docs/verification/item-mg-reclassification-20260814/product_type_dictionary.py` and `product_type_dictionary.csv` — the governed dictionary.
- `docs/verification/item-mg-reclassification-20260814/test_hierarchical_item_taxonomy.py` — the 14 existing tests.
- `docs/verification/item-mg-reclassification-20260814/build_mg_ruling_review_workbook.py` — the reviewer workbook generator added 2026-08-26.

Permanent business rules that must be updated when this lands:

- `docs/item-description-mg-classification-process.md`
- the `item-description-taxonomy` Skill copies (Codex and Claude)
- the classification section of `AGENTS.md`

## 3. What triggered this work

On 2026-08-26 the owner challenged the match rate: 2,294 full three-level matches out of 12,390 classifiable historical items. The following measurements were taken by re-running the committed 2026-08-17 implementation against the committed source data. They are reproducible and are the baseline this plan must improve on.

**Baseline outcome distribution (2026-08-17 method, unchanged):**

| Result | Items |
|---|---|
| Source rows | 19,302 |
| Post-change rows (created 2025-05-14 or later) | 3,658 |
| Historical rows (created on or before 2025-05-13) | 15,644 |
| Historical rows with an accepted or alias product type | 12,390 |
| — matched to MG01+MG02+MG03 | 2,294 |
| — blocked short of MG03 | 10,096 |
| Historical rows with no accepted physical product type | 3,254 |

**Why the 10,096 are blocked:**

| Cause reported by the matcher | Items |
|---|---|
| Evidence exists but the winning candidate holds under the 80% share required | 7,917 |
| No post-change item has ever used that signature | 1,785 |
| Evidence exists but only one post-change item (fails the n≥2 rule) | 394 |

**How concentrated the shortfall is** — the shortfall is carried by a small number of description signatures:

| Signatures | Items blocked | Share of shortfall |
|---|---|---|
| Top 5 | 4,968 | 49% |
| Top 10 | 6,331 | 63% |
| Top 15 | 7,060 | 70% |
| Top 25 | 7,974 | 79% |
| Top 50 | 9,226 | 91% |

The reviewer workbook covering the top 25 is `outputs/issue-1113-taxonomy/mg_depth3_ruling_review.xlsx`, generated by `build_mg_ruling_review_workbook.py` (commit `fd39838`). It is private by `.gitignore` and is not committed.

## 4. Scope

### In scope

- Rebuilding description parsing onto form, material, and embellishment axes.
- Adding an explicit "no embellishment" state and mapping it to the real MG03 code.
- Validating post-change teaching rows against the rework workbook's code dictionary.
- Re-keying the three association maps and the matcher onto the axes.
- Extending the test suite to cover axis separation, contamination, and code validity.
- Regenerating the review workbook and the final workbook, and re-measuring.
- Updating the permanent process document, the Skill copies, and AGENTS.md.

### Explicitly out of scope

- Any database read or write. This plan touches no schema and no rows.
- Changing `full_item_master.csv` or `MerchGroup_Rework.xlsx`. They are source records.
- Correcting miscoded post-change items in the ERP. This plan *reports* invalid codes; fixing them in the source system is a separate owner decision (Open question Q2).
- Applying any proposed merchandise group to a live item. The output remains a review artifact.
- Lowering the confidence thresholds to buy a better headline number (Rejected approach R5).
- Re-opening the settled decisions in `plan_item_description_mg_taxonomy_repair.md` §8 that this plan does not explicitly supersede.

## 5. Current state of the code

### What works and must be preserved

- The May 13 / May 14 2025 date split, which accounts for every source row and raises if it does not.
- The rule that pre-cutoff stored MG values are never evidence. They are carried to the output for comparison only.
- The rule that licensor, property, character, artwork, slogan, colour and size never influence an MG decision.
- The governed dictionary contract: every observed wording carries an explicit status, and only `accepted` or `alias` entries may teach or receive an MG value.
- Deepest-first matching with fallback, and the principle that a failed three-level match is not an MG01 failure.
- The 14 existing tests, which all pass.

### What is wrong

The four defects below are the subject of this plan. Each is evidenced in Section 6.

1. Description parsing produces one blended product string that mixes all three taxonomy axes.
2. A material word with no form word is treated as a product, so items made *of* a material are classified as that material.
3. "No embellishment stated" and "embellishment not readable" are the same value, so neither can be proposed.
4. Post-change rows teach the matcher without being checked against the merchandise-group code dictionary.

### Repository state

Branch `claude/merchgroup-reassignment-history-cp94v3` carries `build_mg_ruling_review_workbook.py` (commit `fd39838`) and this plan. `main` carries the 2026-08-17 implementation, closed under issue #1113 by merged PR #1138. Follow-on issue #1187 (merged PR #1564) covers mgCategory replay diagnostics and is separate from this work.

## 6. Key findings and root cause

### F1 — The merchandise-group system encodes three independent axes

From `MerchGroup_Rework.xlsx`, sheet `Final Version`:

| Level | Meaning | Values observed for MG01 = A |
|---|---|---|
| MG01 | physical form and placement | Stretched/Box, Framed, Plaque, Functional, Other Wall, Block, Box, Photo Frames, Object, Other Tabletop, Clocks, Soft Storage, Hard Storage, Other Storage, Stationery org, Desk Acc, Other workspace, Floor coverings, Garden |
| MG02 | material or substrate | Canvas, Special Material, Greyboard, Fabric, MDF Box |
| MG03 | embellishment or treatment | *(blank = none)*, Foil, Shaped, Other Embellishment, Other, Embroidery, DIY, LED, Staggered, Hi-Gloss, Glitter/Sequins/Rhinestone, Handpaint, Physical Attachment, Gel/Other Coat |

MG02 is a **material**, not a product. This is the structural fact the current implementation does not model.

Stored codes in the Item Master are two characters where the workbook defines one; the first character is the workbook code and the second is a suffix. `A|A2|01` is Stretched/Box + Canvas + no embellishment. `A|A2|11` is the same product with Foil. Any validity check must compare on the first character.

### F2 — The parser blends the three axes into one string

`PRODUCT_RULES` in `hierarchical_item_taxonomy.py` emits product types such as `Printed Canvas`, `Glitter Canvas`, `Foil Canvas`, `High-Gloss Canvas`, `Gel-Coated Canvas`, `Embroidered Canvas`, `LED Canvas`. Under the real taxonomy every one of these is the same MG01+MG02 (`A|A`) and differs only in MG03.

The consequence is evidence fragmentation. The same product is split into competing pools that then individually fail the majority test:

| Signature | Historical items blocked | Post-change items voting | Top candidate share |
|---|---|---|---|
| `canvas\|stretched\|plain or printed` | 2,491 | 391 | 42% |
| `canvas\|stretched\|printed` | 677 | 187 | 66% |

These are one product. Together they block **3,168 items — 31% of the entire shortfall** — and neither pool can reach 80% while split.

### F3 — A material word alone is treated as a product

Confirmed by direct measurement: 25 post-change items mention canvas together with a storage form. The parser assigns product type `Canvas` to every one of them, while the ERP correctly classifies them as Soft Storage:

```
stored=N|B1|X1   parsed='Canvas'   Disney Toy Story Canvas Storage Bin Woody Running Stars Baby Pattern
stored=N|B1|X1   parsed='Canvas'   Disney Stitch Canvas w EVA Bin Stitch with planets stars pattern
stored=N|B1|R1   parsed='Canvas'   Disney Cars Half Canvas Half Cotton Rope Storage Bin White McQueen
```

These hampers and bins are inside the wall-art canvas evidence pool, where 14 of them vote for `N|B1|X1` as the correct merchandise group for a canvas wall art. The owner named the cause precisely: *canvas is a material, and we use it as a product name because our stretched canvas wall art is called "canvas" in house shorthand.*

None of the 14 existing tests detect this.

### F4 — "No embellishment" is a real code that we never propose

The rework workbook defines MG03 code `0` with a deliberately blank description — the no-embellishment case — for `A|A` Canvas, `A|M` MDF Box and others. It is in live use: **581 post-change items (16%)** carry an MG03 beginning with `0`.

The parser records embellishment as a string that is either populated or empty, and empty carries two incompatible meanings:

- the description describes a plain product and there is genuinely no embellishment;
- the description is too sparse and we could not determine one.

Because the second meaning is real ignorance, the matcher conservatively proposes nothing for either. **37.5% of classifiable historical rows have an empty treatment**, and 3,192 of the 7,974 items in the top-25 workbook sit on signatures whose treatment is empty.

This is the finding the owner identified. Some items truly have no embellishment, there is a code for exactly that, and we never propose it.

### F5 — The teaching data is not validated against the code dictionary

Every post-change row is currently trusted as ground truth. Checking the stored codes against the combinations the rework workbook defines:

| Check on 3,627 post-change rows carrying a full MG01-MG03 | Result |
|---|---|
| MG01+MG02 pair is defined in the workbook | 96.7% |
| Full MG01+MG02+MG03 combination is defined in the workbook | 86.8% |
| Rows whose MG03 is not a defined code for their MG01+MG02 | 480 |

The largest single invalid combination is `A|A|A` with **210 items** — and this is the rival candidate in the worst signature in the entire analysis. For Stretched/Box + Canvas the workbook defines MG03 codes `0, 1, 2, 8, 9, B, D, E, G, H, P, Q, W, Y`. **There is no `A`.**

So the rank-1 conflict — `A|A2|01` at 163 items against `A|A2|A2` at 134 — is substantially a contest between a valid code and one the taxonomy does not define. It is likely a data-quality problem in the ERP rather than a business distinction requiring a ruling. Any earlier statement of mine that framed rank 1 purely as a business ruling was wrong, and this finding supersedes it.

### F6 — Thin evidence and a hard threshold interact badly

Only 3,305 post-change rows are usable at depth 3, spread across 176 signatures. At small sample sizes the fixed 80% gate makes arbitrary distinctions:

- `framed lenticular art|3d lenticular|` — 769 items blocked, 19 votes, top candidate at **79%**. It failed by one percentage point.
- `tabletop box|mdf|` — 654 items blocked on **two** votes that disagree one apiece.
- `tabletop monogram|letter|` — 321 items blocked with **zero** post-change items in existence.

F6 is genuine evidence scarcity and is largely not fixable in code. It is recorded here so it is not mistaken for a defect and "fixed" by weakening the thresholds.

### Root cause

**We modelled the merchandise-group system as a three-level hierarchy of product names, when it is a three-axis description of form, material, and embellishment.** Every defect above follows from that single mismatch: blended product strings (F2), material treated as product (F3), embellishment as a nullable string rather than a described attribute (F4). F5 is an independent gap — trusting teaching data we never checked.

## 7. Approaches considered and rejected

### R1 — Rejected: lower the 80% share gate

It would convert genuine ambiguity into confident-looking wrong answers. The plan's founding rule is that a low unresolved count must not conceal bad assignments. Rejected outright, and Section 4 puts it out of scope.

### R2 — Rejected: map every blank treatment straight to MG03 `0`

Superficially it would resolve thousands of items at once. It is unsafe because the blank bucket currently also absorbs every parse failure, so this would stamp "no embellishment" on items that have one. The tri-state split in Phase 3 must come first. This is the single most tempting shortcut in this plan and it must not be taken.

### R3 — Rejected: hand-split the top 25 signatures in the dictionary

Treats the symptom. The blended-axis defect would keep generating new fragmented signatures as items are added, and the material/product collision would remain. Rejected in favour of fixing the parser, though the reviewer workbook remains useful for the genuinely ambiguous residue.

### R4 — Rejected: use MG04 or Season to break the rank-1 tie

Tested on 2026-08-26. Season shows a skew (Christmas 23 and Easter 11 appear under `A|A2|A2` and neither appears under `A|A2|01`; MG04 `36` covers 63% of `A2` against 24% of `01`) but "NONE" is the most common season in both groups, so neither field separates them. More fundamentally, F5 indicates the rival code is invalid, and reverse-engineering a rule to justify an undefined code would encode a data error as a business rule.

### R5 — Rejected: treat the match rate as a target to be hit

Some portion of the shortfall is correct behaviour. Items whose descriptions genuinely do not state an embellishment, and signatures with no post-change evidence at all, must stay unresolved. The measure of success is that every remaining gap has a named, defensible cause — not that the number is high.

### R6 — Rejected: infer embellishment from the artwork description

Would violate the standing rule that artwork never influences an MG decision. Rejected without qualification.

### R7 — Rejected: rebuild the parser as a general free-text classifier

The governed-dictionary contract exists because an earlier fuzzy matcher produced unreviewable assignments. Every wording must keep an explicit reviewed status. The three axes are added *inside* that contract, not as a replacement for it.

## 8. Design decisions

### Locked — do not relitigate

1. Descriptions are parsed into three independent axes: **form**, **material**, **embellishment**. The blended product-type string is removed as a matching key.
2. **Form beats material.** When a description contains both, the form determines the product. "Canvas Storage Bin" is a bin.
3. **A material word alone never implies a form**, except through a named default rule (decision 4).
4. House shorthand is expressed as **explicit, recorded default rules**, never as regex ordering. The first is: bare *canvas* with no form word means stretched canvas wall art. Each default is named, listed in the dictionary ledger, individually switchable, and reported with its own count so its effect is always visible.
5. Embellishment is **tri-state**: `stated`, `none`, `unreadable`. Only `none` maps to MG03 `0`. `unreadable` continues to produce a blank.
6. A post-change row whose MG01+MG02+MG03 is not defined in the rework workbook **does not teach**. It is excluded from the association maps and reported.
7. Pre-cutoff stored MG values remain non-evidence. Unchanged from the existing plan.
8. Licensor, property, character, artwork, slogan, colour and size remain non-evidence. Unchanged.
9. Confidence thresholds are **not** relaxed as part of this work. If the axis rebuild justifies revisiting them, that is a separate proposal with its own evidence.
10. Only `accepted` and `alias` dictionary entries teach or receive MG values. Unchanged.

### Open — implementation judgment

- How finely to enumerate form words. Start from the 19 MG01 families in the workbook and let the observed wordings drive the rest.
- Whether material should fall back to a broad family when an exact material is unrecognised.
- Whether to keep the blended product name in the output as a display column for reviewer familiarity. Recommended yes, clearly marked as non-authoritative.

### Owner decisions required before Phase 4 completes

Recorded as Q1-Q4 in Section 12.

## 9. Executable implementation plan

### Phase 0 — freeze and reproduce

1. Re-run the committed 2026-08-17 implementation against the committed source files.
2. Confirm the Section 3 baseline exactly: 19,302 / 3,658 / 15,644, and 2,294 / 7,496 / 2,600.
3. Confirm all 14 existing tests pass.
4. Record the run in the STATUS table. **Do not change any code before this reproduces.** If it does not reproduce, stop and reconcile — every number in this plan depends on it.

### Phase 1 — merchandise-group code-validity layer

1. Parse `MerchGroup_Rework.xlsx` sheet `Final Version` (header row 3) into a code dictionary of valid `(MG01, MG02, MG03)` combinations, with their human-readable names.
2. Compare on the **first character** of the stored MG02 and MG03 values (F1).
3. Classify every post-change row as `valid`, `invalid_mg03_for_pair`, or `invalid_pair`.
4. Exclude non-valid rows from all three association maps.
5. Emit `post_change_code_validity_report.csv`: every excluded row with its stored codes, description, and which check it failed, sorted by frequency.
6. Assert the Phase 0 counts are unchanged for valid rows, so the exclusion is the only difference.

**Expected at this phase:** roughly 480 rows leave the teaching pool, including the 210 `A|A|A` rows. Coverage may *fall* slightly here. That is correct — bad evidence is being removed. Do not compensate for it elsewhere.

### Phase 2 — three-axis parser

1. Introduce three vocabularies in the governed dictionary, each with the existing reviewed-status contract:
   - **FORM** — wall art, framed art, plaque, storage bin, hamper, toy chest, clock, tabletop box, photo frame, desk organiser, and the rest, aligned to the 19 MG01 families.
   - **MATERIAL** — canvas, MDF, greyboard, fabric, polyresin, glass, metal, rubber, paper, plush, and so on, aligned to the MG02 values.
   - **EMBELLISHMENT** — foil, glitter, sequins, rhinestones, hi-gloss, gel coat, LED, embroidery, handpaint, shaped, staggered, DIY, physical attachment, aligned to the MG03 values.
2. Rewrite `parse_description` to populate the three axes independently, applying:
   - form always wins over material (locked decision 2);
   - a material with no form yields a form only through a named default rule (locked decision 4);
   - a description may carry several embellishments; record all, rank by dictionary specificity.
3. Extend `product_type_dictionary.csv` with `form`, `material`, `embellishment`, `embellishment_state`, and `default_rule_applied`.
4. Re-review every wording whose axis assignment changes. The reviewed-status contract is not weakened: nothing silently falls through.
5. Emit an axis-migration report — old blended product type against new triple — so the change is auditable wording by wording.

### Phase 3 — embellishment tri-state

1. Implement the three states from locked decision 5.
2. `none` requires positive evidence: the description names a form and a material and contains no embellishment word, and the wording is dictionary-accepted. Silence in a sparse or placeholder description is `unreadable`, never `none`.
3. Map `none` to MG03 code `0` **only where the workbook defines `0` for that MG01+MG02.** Where it does not, the result stays blank and is reported.
4. Carry `embellishment_state` into every output so a reviewer can always tell "plainly has none" from "cannot tell".
5. Report the three state counts against the 37.5% empty-treatment baseline from F4.

### Phase 4 — re-key the maps and the matcher

1. Rebuild the three association maps keyed on the axes:
   - MG01 from **form**;
   - MG02 from **form + material**;
   - MG03 from **form + material + embellishment**.
2. Keep deepest-first matching with fallback and the existing thresholds unchanged (locked decision 9).
3. Keep the rule that a failed three-level match is not an MG01 failure.
4. Preserve the full candidate distribution on every decision.
5. Where all surviving candidates agree on MG01+MG02 and differ only on MG03, record MG01+MG02 as decided **and** carry the ranked MG03 candidates into the output rather than silently dropping to a two-level result.

### Phase 5 — tests

Per Section 10. Written before Phase 6 measurement, so the numbers are never the thing being fitted.

### Phase 6 — rerun, re-measure, document

1. Rerun the full pipeline; regenerate the final workbook and the reviewer workbook.
2. Produce a comparison against the Section 3 baseline, with every movement attributed to a phase.
3. Re-measure the shortfall concentration. It should be flatter; if the same signatures still dominate, the axis rebuild did not do its job and Phase 2 needs revisiting.
4. Update `docs/item-description-mg-classification-process.md`, both Skill copies, and the AGENTS.md classification section.
5. Update this STATUS table and the STATUS table of `plan_item_description_mg_taxonomy_repair.md`, marking which of its rules this plan supersedes.

## 10. Tests required

Extending the existing 14. Every one of these fails against today's code, which is the point.

**Axis separation**
1. A canvas storage bin parses to form `storage bin`, material `canvas` — never product `Canvas`.
2. A canvas hamper, a canvas tote and a canvas toy chest all parse to storage forms.
3. `Glitter Canvas`, `Foil Canvas` and `Printed Canvas` produce the **same** form and material, differing only in embellishment.
4. Form beats material whenever both appear, regardless of word order.
5. A named default rule fires only for a bare material with no form word, and is recorded in the output when it does.

**Contamination**
6. No item whose stored MG01 is a storage family may appear in a wall-art association pool.
7. The `A|A` canvas pool contains no `N|*` votes — the direct regression test for F3.
8. An artwork, licensor, property or size word alone never changes any axis.

**Embellishment tri-state**
9. A plain printed canvas with a stated size yields embellishment state `none` and proposes MG03 `0`.
10. A sparse or placeholder description yields `unreadable` and proposes nothing.
11. `none` never maps to `0` for an MG01+MG02 where the workbook does not define `0`.
12. `none` and `unreadable` are distinguishable in every output artifact.

**Code validity**
13. A post-change row with an MG03 undefined for its MG01+MG02 does not appear in any association map.
14. `A|A|A` specifically is excluded and appears in the validity report — the direct regression test for F5.
15. Validity comparison uses the first character of the stored two-character codes.

**Preserved invariants**
16. The date split still accounts for every source row.
17. Pre-cutoff stored MG values still never influence a proposal.
18. Only `accepted` and `alias` entries teach or receive.
19. A failed three-level match still falls back rather than reporting an MG01 failure.
20. Thresholds are unchanged from the 2026-08-17 implementation.

## 11. Constraints, standing rules, and gotchas

- **No database access of any kind.** Not a read, not a migration, not an MCP call.
- **The source files are records.** Never edit `full_item_master.csv` or `MerchGroup_Rework.xlsx`.
- **Row-level output stays private.** `outputs/issue-1113-taxonomy/.gitignore` allows only `item_mg_taxonomy_final.xlsx`. Do not widen it without an owner ruling.
- `full_item_master.csv` is `cp1252`, not UTF-8. Reading it as UTF-8 fails on real rows.
- Stored MG02/MG03 are two characters against the workbook's one. Comparing the full string silently marks everything invalid.
- The workbook's `Final Version` sheet has its real header on row 3, and MG03 code letters are reused with different meanings across different MG01+MG02 families. A code is only meaningful inside its family — never build a global MG03 lookup.
- Excel sheet names are capped at 31 characters; `pandas.ExcelWriter` warns rather than fails.
- Coverage is expected to fall in Phase 1 before it rises in Phase 4. Do not treat that dip as a regression and do not compensate for it.
- Report every predicted improvement as predicted until it has been measured. This plan deliberately quotes no expected match rate.

## 12. Definition of done, risks, and open questions

### Definition of done

1. Phases 0-6 complete with the STATUS table updated as each lands.
2. All 20 new tests plus the 14 existing tests pass.
3. The code-validity report exists and the invalid combinations, including `A|A|A`, are excluded from teaching.
4. No canvas storage item appears in a wall-art evidence pool.
5. `canvas|stretched|plain or printed` and `canvas|stretched|printed` no longer exist as separate competing signatures.
6. Embellishment state is reported in three values, and `none` proposes MG03 `0` wherever the workbook defines it.
7. The new match distribution is published against the Section 3 baseline, with each movement attributed.
8. Every remaining unresolved item carries a named cause: no evidence, evidence below threshold, embellishment unreadable, or awaiting an owner ruling.
9. The permanent process document, both Skill copies, and AGENTS.md describe the three-axis method.
10. No database object was read or written.

### Rollback

Every change is confined to the analysis directory and generated artifacts. Reverting the branch restores the 2026-08-17 method exactly. No migration, no deployment, nothing to unwind.

### Risks

- **A default rule quietly does too much work.** Mitigated by locked decision 4: named, counted, individually switchable, reported.
- **Re-reviewing the dictionary reintroduces subjective judgment.** Mitigated by the unchanged reviewed-status contract and the axis-migration report.
- **Excluding invalid teaching rows thins already-thin evidence.** Real. It is still correct, and Phase 1 reports the cost explicitly.
- **The `A` code turns out to be legitimate and newer than the workbook.** Q2 settles this before Phase 1 is final; the code-validity layer is data-driven and absorbs an updated dictionary without a redesign.
- **The rebuild does not move the number much.** Possible. The finding would then be that the shortfall is genuine evidence scarcity, which is itself a defensible answer and is worth knowing.

### Open questions for the owner

- **Q1 — House shorthand.** Bare *canvas* means stretched canvas wall art. Are there other shorthands where a material name implies a product? Candidates seen in the data: *greyboard*, *MDF*, *lenticular*.
- **Q2 — The `A` MG03 code for canvas.** 210 post-change items carry `A|A2|A2`, and `A` is not defined as an MG03 for Stretched/Box + Canvas. Is it a miscode to be corrected in the ERP, or a newer code the rework workbook predates? This decides whether 2,491 blocked items need a business ruling or a data fix.
- **Q3 — Scope of exclusion.** Should a post-change row with an invalid MG03 be excluded from teaching entirely, or still allowed to teach MG01 and MG02 where those are valid? Recommendation: allow it to teach the valid levels, since discarding a correct MG01+MG02 over a bad MG03 wastes scarce evidence.
- **Q4 — Proposing `0` without direct precedent.** Where a description is plainly unembellished but no post-change item exists for that exact form+material+none combination, should MG03 `0` be proposed from the workbook definition alone, or withheld for lack of observed evidence? Recommendation: propose it, flagged as definition-based rather than evidence-based, since `0` is the taxonomy's own default.

## Plan self-audit

- **Is every number in this plan measured?** Yes. Sections 3 and 6 are reproducible measurements against committed data, taken 2026-08-26. No improvement figure is claimed anywhere, because none has been measured.
- **Does it touch the database?** No. Section 4 and constraint 1 forbid it, and Section 2 records why the structure orchestrator is not involved.
- **Does it overturn settled decisions?** It supersedes the single-product-type keying of the 2026-08-17 method and that method's treatment of blank embellishment. Every other locked decision in `plan_item_description_mg_taxonomy_repair.md` §8 is preserved and restated in Section 8.
- **Could it make the output look better without being better?** The known shortcut is R2, rejected explicitly. Thresholds are locked. Coverage is expected to fall before it rises.
- **What would make this plan wrong?** If Q2 establishes `A` as a valid newer code, F5 shrinks substantially and rank 1 returns to being a business ruling. F2, F3 and F4 would be unaffected.
- **What is the single most important thing not to get wrong?** Mapping blank embellishment to MG03 `0` without first separating "plainly none" from "cannot tell". It would resolve thousands of items and quietly mislabel an unknown share of them.
