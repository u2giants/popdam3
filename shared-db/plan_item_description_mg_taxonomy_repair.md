# Implementation plan: complete the Item Description taxonomy and exact MG matching

## STATUS

| Step | Status | Date | Evidence / starting point |
|---|---|---|---|
| 1. Freeze the baseline and reproduce the current audit | ✅ complete | 2026-08-17 | Existing 8 tests pass. Private rerun reproduced 19,302 total, 3,658 post-change, 15,644 historical, and the exact five outcome counts recorded in Section 3. |
| 2. Recover and inventory the existing draft dictionary | ✅ complete | 2026-08-17 | All 15,570 observed wordings are now recorded in `product_type_dictionary.csv`. |
| 3. Define the governed dictionary contract | ✅ complete | 2026-08-17 | The generator records stable family IDs, product, construction, treatment, status, counts, and the decision basis. |
| 4. Complete semantic review of every distinct parser output | ✅ complete | 2026-08-17 | Every wording is explicitly accepted as an alias, held for review, or marked as a placeholder. Nothing silently falls through. |
| 5. Replace provisional and fuzzy live assignment | ✅ complete | 2026-08-17 | Live proposals now use exact reviewed signatures only. Loose word similarity was removed from assignment. |
| 6. Rebuild clean post-change MG maps | ✅ complete | 2026-08-17 | The three maps admit only accepted/alias post-change descriptions and are built independently at each depth. |
| 7. Add precision, contamination, and authority tests | ✅ complete | 2026-08-17 | Fourteen tests pass and the deterministic 20% holdout review is included in the workbook. |
| 8. Rerun, review, and regenerate the final workbook | ✅ complete | 2026-08-17 | The final eight-sheet workbook contains all combinations, all 15,644 historical recommendations, the ledger, residuals, and precision review. |
| 9. Update permanent documentation and every skill copy | ✅ complete | 2026-08-17 | The permanent process and repository runbook describe the implemented governed-dictionary method. |
| 10. Land the implementation safely | ✅ complete | 2026-08-17 | Implementation, workbook, tests, governed Skill, PR, and issue closure were completed together. |

**Current state:** Complete. The workbook and repeatable implementation are the permanent result of issue #1113.

---

## 1. Ultimate goal

POP Creations needs a defensible answer for each historical item created on or before May 13, 2025: what product it is, and how deeply that product can be classified under the merchandise-group system used from May 14, 2025 onward.

When this plan is complete:

- every old and new Item Description has been separated into physical product type, size, licensor, property, and artwork wording;
- every physical product phrase has an explicit reviewed status and an auditable canonical family;
- only accepted product types and reviewed aliases can teach or receive merchandise-group assignments;
- historical items are matched through three independent post-change maps in this order: MG01+MG02+MG03, then MG01+MG02, then MG01;
- no artwork, license, property, slogan, character, color, or size can influence the MG result;
- fuzzy similarity can suggest review candidates but cannot populate proposed MG fields;
- unsupported MG02 or MG03 values remain blank;
- unreadable/placeholder descriptions are counted separately from readable products that lack a post-change analog;
- the final workbook is safe for business review because a low unresolved count cannot conceal bad assignments.

**If any step conflicts with this goal, the goal wins. Stop and flag the conflict rather than following the step mechanically.**

## 2. What this application is

This is a file-based analysis inside `u2giants/shared-db`. It is not a production web application and does not write to the shared Supabase database. By Albert's recorded 2026-08-15 ruling in the data-folder README, the two source files and their product descriptions are deliberately published in this repository and are not confidential. Newly generated row-level workbooks and intermediate outputs remain private and uncommitted.

Inputs:

- `docs/verification/item-mg-reclassification-20260814/data/full_item_master.csv`: 19,302 Item Master rows going back to company founding.
- `docs/verification/item-mg-reclassification-20260814/data/MerchGroup_Rework.xlsx`: the merchandise-group definition workbook introduced after May 13, 2025.
- `docs/verification/coldlion-licensor-property-phase3-20260725/designflow-fresh-edges.json`: licensor/property names used only to separate description chunks.

Core implementation:

- `docs/verification/item-mg-reclassification-20260814/hierarchical_item_taxonomy.py`
- `docs/verification/item-mg-reclassification-20260814/test_hierarchical_item_taxonomy.py`
- earlier mining/consolidation helpers in the same directory, especially `build_semantic_product_types.py`.

Permanent business rules:

- `docs/item-description-mg-classification-process.md`
- `C:\Users\ahazan2\.codex\skills\item-description-taxonomy\SKILL.md`
- the corresponding Claude skill installed under `C:\Users\ahazan2\.claude\skills\item-description-taxonomy\`.

Users are Albert Hazan and POP Creations staff reviewing historical Item Master categorization. Generated CSV/JSON/XLSX outputs are private working artifacts written under ignored `.private/` folders and are not committed.

No URL, host, deployment, database migration, or production service applies. This is an offline analysis and workbook-generation workflow.

## 3. What triggered this work

The business changed how MG01, MG02, MG03, and MG04 were assigned after business closed on May 13, 2025. Someone was expected to reassign historical items under the new approach, but the work was missing or incomplete.

An earlier analysis claimed 9,155 historical rows could not even be matched to MG01. Albert rejected that result because MG01 should normally be easy to infer from a readable product description. The failure was real: the old logic tested a full semantic signature and treated its failure as a broad MG01 failure.

The hierarchy was refactored and merged in PR #1091, commit `b262a9fd698b60ab0e455d63b8b97a965eb9bfbb`, to build independent maps and fall back from three levels to two to one. A full rerun produced:

- 19,302 source rows;
- 3,658 post-change learning rows dated May 14, 2025 or later;
- 15,644 historical rows dated May 13, 2025 or earlier;
- 2,035 full three-level proposals;
- 7,588 pair-only proposals;
- 2,520 MG01-only proposals;
- 2,726 readable descriptions unmatched even to MG01;
- 775 rows labeled as having no usable description.

Those five historical outcomes reconcile exactly to 15,644. However, inspection showed that the product-type maps still contained test wording, `asst`, artwork-like phrases, and license/character fragments. The workbook was therefore an audit surface, not a final recategorization file.

Grok 4.6 independently reviewed the code and evidence in two debate turns. It agreed with the hierarchy and root-cause diagnosis, then found the critical remaining defect: the program already uses loose word overlap for live assignment. Fresh evidence showed 2,091 historical assignments came from semantic token overlap rather than exact reviewed types: 1,959 MG01-only, 124 pair-level, and 8 full-key assignments. The final debate consensus is incorporated throughout this plan.

GLM 5.3 then reviewed the full plan and live code in a two-turn adversarial debate. It agreed with the architecture but found four missing specifications: depth-scoped map keys, retained evidence-quality floors, contamination of the old dictionary draft by historical MG values, and exact dictionary-status-to-outcome precedence. It also found the old hard-coded alias layer, generic-noun alias risk, output-path/confidentiality contradictions, and post-change temporal drift risk. The binding corrections are incorporated in Sections 8-10. GLM's final verdict was that no blocker remained after those corrections.

## 4. Scope

### In scope

- complete and govern the product-type dictionary;
- preserve separate physical product, construction/shape, and treatment fields;
- classify every parser output as accepted, reviewed alias, rejected non-product, unusable placeholder, or needs review;
- prevent provisional/needs-review/rejected wording from teaching MG maps;
- remove fuzzy matching from live MG proposals;
- rebuild the three post-change association maps from accepted evidence only;
- rerun all 19,302 rows;
- create a final review workbook with all combinations and all 15,644 historical rows;
- add tests that measure precision, contamination, authority, and mutually exclusive reporting;
- update the permanent process document and all installed/source-of-truth skill copies;
- preserve source data and report unresolved reasons honestly.

### Explicitly out of scope

- changing, rebuilding, renumbering, or “fixing” MG01 itself;
- changing MG02, MG03, MG04, `mgCategory`, the Item Master, or database rows;
- using historical stored MG values, item-number patterns, or current category codes to teach or rescue a recommendation;
- assigning MG01 from `MerchGroup_Rework.xlsx` when no post-change product analog exists, unless Albert later makes that separate policy decision;
- inventing default MG02 or MG03 values;
- database structure work or a shared-db migration;
- production deployment;
- forcing readable-unmatched rows to approximately 50;
- committing newly generated row-level workbooks or intermediate review outputs.

## 5. Current state of the code

### What works

- The May 14, 2025 cutoff is explicit at `hierarchical_item_taxonomy.py:24`.
- The parser produces product type, size, licensor, property, artwork, and parse basis.
- `build_associations()` independently builds depth 1, 2, and 3 maps at `hierarchical_item_taxonomy.py:244-268`.
- `classify_product_type()` tries depth 3, then 2, then 1 at `hierarchical_item_taxonomy.py:324-329`.
- Historical stored MG values are not passed into the matcher.
- Eight unit tests cover the two user examples, consolidation cases, canvas treatments, distinct crumb-rubber mat constructions, full-key selection, pair fallback, MG01 fallback, and historical-code exclusion at `test_hierarchical_item_taxonomy.py:14-70`.
- The permanent process document and Codex skill describe the three-map fallback and separate unusable descriptions from readable MG01 failures.

### What is half-done or unsafe

- `PRODUCT_RULES` at `hierarchical_item_taxonomy.py:31-131` is a finite hard-coded phrase list. It is useful for proposing candidates but is not a governed taxonomy.
- `extract_product_type()` at lines 184-194 falls back to a description prefix and labels it provisional. Those provisional values currently flow into post-change maps.
- `choose_at_level()` at lines 293-322 performs token/Jaccard similarity. MG01 accepts a threshold of 0.25, and that result writes real proposed fields.
- `usable_description()` at lines 332-341 is too narrow. Some test, testing, fee, `asst`, and material-only rows remain labeled readable and can be assigned.
- Usability is evaluated after matching in `run()` rather than acting as a precondition.
- The dictionary mining work under `.private/item-mg-reclassification-20260814/` contains a reported 750 proposed phrases and 216 preliminary families, but all are still proposals and the live matcher ignores them.
- The current maps contain provisional/test/artwork wording.
- The current workbook at `outputs/item-mg-refactored-20260816/item_mg_refactored_review.xlsx` is an audit artifact. It must not be treated as a recode file.
- The Claude skill copy still teaches the older single-full-key method.

### Repository state

- PR #1091 is merged to `main` at `b262a9fd698b60ab0e455d63b8b97a965eb9bfbb`.
- This plan is being authored on branch `codex/item-taxonomy-plan`, based on `origin/main` commit `93a337719dbc39a071d9ae78f191a3954fac2371`.
- Issue #1097 tracked planning and is complete. Issue #1113 tracks implementation.
- No implementation from this plan has started.
- No database or Item Master data has been changed.

## 6. Key findings and root cause

1. **The first failure was hierarchy logic.** A full-key miss was incorrectly reported as an MG01 miss. Independent depth maps fixed that structural error.
2. **The remaining failure is vocabulary governance plus unsafe matching.** A finite regex list cannot semantically normalize the complete company history. Provisional description fragments become fake product types.
3. **Dirty later evidence teaches dirty maps.** `build_associations()` does not require an accepted review status. Post-change test/artwork fragments therefore become trusted associations merely because their dates are new.
4. **Fuzzy live assignment hides errors.** Current word overlap created 2,091 proposals. Most were MG01-only and many used 25–50% token agreement. Grok found sanitized false-friend cases such as fee wording sharing `foil` with canvas and unrelated `mat`/`box` families sharing generic nouns.
5. **The product concept needs three reviewed components.** Physical product, construction/shape, and treatment must be preserved separately. Over-consolidating `Foil Canvas`, `LED Canvas`, and `High-Gloss Canvas` into undifferentiated `Canvas` destroys MG03 evidence.
6. **The unresolved population contains different problems.** It includes missed real products, unusable/test wording not recognized as such, accepted products with no post-change analog, and conflicting later evidence. These reasons must not be combined.
7. **The five published outcome buckets happened to be exclusive in the last run, but the guard is weak.** All 775 rows labeled unusable received no proposals. However, the detector mislabeled some test/fee rows as usable, so exclusivity needs to become a tested invariant rather than an accident.
8. **Approximately 50 is not a justified acceptance number.** It is a business alarm indicating the logic probably still lacks coverage. It must not become a quota that encourages forced assignments.
9. **A draft dictionary already exists.** Ignoring the 750 proposed phrases/216 preliminary families would waste prior work. Treat them as a seed, not as accepted truth or the complete review set.
10. **Skill drift can recreate the bug.** Codex and Claude copies currently disagree. The process document also uses “semantically equivalent variants,” which must be narrowed to “reviewed aliases” so no future agent reads it as permission for live fuzzy assignment.

## 7. Approaches considered and rejected

### Rejected: rebuild or repair MG01

MG01 is an existing business code. The user explicitly ruled that only analysis logic is in scope. Changing MG01 would destroy the trusted hierarchy rather than classify historical products into it.

### Rejected: treat a full-key miss as an MG01 miss

This produced the false 9,155 figure. Failure to justify MG03 says nothing about whether MG01 or MG01+MG02 is supported.

### Rejected: use old stored MG values as training evidence

The historical values are the data under review. Using them to infer their replacements is circular and can preserve the old method the project is trying to replace.

### Rejected: add more broad MG01 keyword rules

An earlier private classifier assigned broad categories from manually hard-coded product keywords. This can appear to reach high coverage but bypasses the required post-change association evidence.

### Rejected: keep the 25% word-overlap matcher

Generic nouns such as `mat`, `box`, `frame`, `foil`, or `storage` create false friends. Grok found that current fuzzy matching can assign fees/tests or unrelated products. Fuzzy similarity is allowed only as a review suggestion.

### Rejected: allow provisional later phrases to teach

This makes trusted date equal trusted semantic interpretation. A post-change test row is chronologically trusted for its stored MG values but is not automatically a valid product-type phrase.

### Rejected: review all 19,302 rows individually from scratch

The review unit should be distinct proposed product phrases and families, seeded by the existing 750/216 work. Row examples support semantic decisions, but re-deciding identical phrases row by row is wasteful and inconsistent.

### Rejected: stop at the existing 216 families

Those families are preliminary and do not cover every current parser output. Every distinct output must receive a governed status, including rejected and placeholder entries.

### Rejected: collapse treatment into a broad product noun

Doing so loses the exact evidence needed for MG03. Treatment and construction must remain explicit in the semantic signature.

### Rejected: force the residual count to about 50

Coverage without precision is worse than an honest unresolved result. About 50 is a reason to investigate deviations, not permission to invent evidence.

### Rejected: treat the existing workbook as final

It visibly contains provisional product wording and fuzzy proposals. It is useful for diagnosing the current system only.

## 8. Locked and open design decisions

### Locked decisions, do not relitigate

Locked by Albert and the Grok/Codex consensus on 2026-08-16:

- MG01 itself is not being changed.
- May 14, 2025 onward is the teaching population; May 13, 2025 and earlier is historical.
- Historical MG values do not teach, vote for, or rescue proposals.
- Parse five chunks for all descriptions.
- The classification signature is accepted physical product + reviewed construction/shape + reviewed treatment.
- License, property, artwork, slogan, character, color, and size have zero classification weight.
- Build three independent maps and match three, then two, then one.
- Unsupported child codes remain blank.
- Only accepted types and reviewed aliases can teach or receive MG proposals.
- Fuzzy matching is suggestion-only and cannot write Proposed MG, Matched Level, or Evidence Share.
- Unusable rows are excluded before matching and counted separately.
- Precision gates run before coverage is judged.
- About 50 is an alarm, not a quota.
- Matching keys are depth-scoped. MG01 uses canonical physical product. MG01+MG02 uses physical product plus the reviewed dimension, or per-product-class dimensions, that the rework workbook and post-change evidence prove MG02 represents. MG01+MG02+MG03 uses the full reviewed signature. Do not assume MG02 always means construction.
- Missing treatment or another deeper modifier never blocks a supported shallower match. Treatment-distinct families are never merged merely to gain a deeper match.
- Evidence floors remain 0.80/0.75/0.60 winning share at depths three/two/one, and the winner must have at least 1.5 times the runner-up's support. These are conservative floors, not coverage controls.
- An automatic depth-three assignment needs at least two supporting post-change items. A singleton is suggestion-only unless an explicit reviewed exception is recorded and validated. The same reviewed-exception rule applies at any depth when a family's entire teaching evidence is one row.
- Temporal shifts inside the post-change population are quarantined from teaching until reviewed; quarantine is an evidence hold, not a sixth dictionary status.

### Open implementation judgment

- Exact storage format for the reviewed dictionary: prefer a versioned UTF-8 CSV for business review plus JSON generated from it for the application. The CSV is authoritative; generated JSON is reproducible.
- Whether canonical product, construction, and treatment live in one row or normalized tables: prefer one flat review row per observed variant for easy auditing, with stable family IDs linking variants.
- Candidate-suggestion algorithm: any method is acceptable if it cannot write classifications and clearly labels why it suggested a family.
- Workbook styling and review ergonomics, provided all evidence remains visible and every sheet passes visual verification.

### Owner decision deferred until after clean rematch

If accepted product types still have no post-change analog, Albert must decide whether MG01-only may be inferred from the definition workbook. Recommendation: abstain under the current authority until the clean exact-only run proves the size and content of this residual group.

## 9. Executable implementation plan

### Phase 1: freeze and reproduce the baseline

#### Step 1. Reproduce the committed current behavior

Files:

- `hierarchical_item_taxonomy.py`
- `test_hierarchical_item_taxonomy.py`
- the three source files listed in Section 2.

Actions:

1. Create a new ignored run directory under `.private/item-mg-taxonomy-<date>/`.
2. Run all existing tests.
3. Run all 19,302 rows.
4. Save the five-count summary, row-level CSV, three map JSON files, and parse/match-basis counts.
5. Calculate these baseline diagnostics:
   - provisional versus curated rows;
   - exact versus fuzzy assignments by depth;
   - unusable rows receiving any proposed MG;
   - distinct provisional phrases in post-change and historical populations;
   - map entries containing placeholders/tests/fees;
   - accepted-looking types with no post-change analog.
6. Audit post-change MG combinations by creation month for the 30 product families with the highest historical volume. Flag in-window changes or transitional coding and quarantine affected evidence before it teaches.
7. Compare `MerchGroup_Rework.xlsx` with clean post-change examples to determine which reviewed description dimension MG02 represents. Permit a recorded per-product-class policy if the axis is heterogeneous.

Verification gate: the five outcomes reconcile to 15,644 and the diagnostics reproduce or explain any difference from the 2026-08-16 audit. Store commands and outputs in `docs/verification/item-mg-reclassification-<date>/` without licensed row contents.

Natural context cut: none. Continue to Step 2 in the same session if context permits.

#### Step 2. Recover and inventory the existing draft dictionary

Files/data:

- `.private/item-mg-reclassification-20260814/proposed_item_type_phrase_list.csv`
- `.private/item-mg-reclassification-20260814/semantic_product_type_families.csv`
- `.private/item-mg-reclassification-20260814/semantic_product_type_rows.csv`
- `build_semantic_product_types.py`

Actions:

1. Recompute counts; do not trust the reported 750/216 without reading the files. The reported 750 was a selection cap, not a measured phrase population.
2. Identify every distinct output currently emitted by the new parser.
3. Join current outputs to the old draft by normalized wording.
4. Produce four inventory groups: already represented, new current output, old draft no longer observed, and obvious placeholder/non-product.
5. Recompute every draft count, distribution, rank, and agreement value from May 14, 2025+ rows only before semantic review. Do not show reviewers the old full-history `MG Agreement` or `Dominant MG01-MG03` values.
6. Discard family boundaries or merges justified only by historical MG agreement. Rejustify each retained family from physical-product meaning in the decision field or split it.
7. Do not mark any draft entry accepted solely because it already exists.

Verification gate: every distinct current parser output appears exactly once in the inventory and has a trace to source examples. Counts reconcile to the distinct output count.

### Phase 2: define and populate the governed dictionary

#### Step 3. Create the dictionary contract and validator

New recommended tracked files:

- `docs/verification/item-mg-reclassification-20260814/product_type_dictionary.csv`
- `docs/verification/item-mg-reclassification-20260814/product_type_dictionary.schema.json`
- `docs/verification/item-mg-reclassification-20260814/validate_product_type_dictionary.py`
- generated `product_type_dictionary.json` if the application needs faster lookup.

Required columns:

- stable family ID;
- observed normalized wording;
- canonical physical product;
- construction/shape;
- treatment;
- status: `accepted`, `alias`, `rejected`, `placeholder`, `needs_review`;
- alias target family ID when status is `alias`;
- plain-English semantic decision;
- representative example identifiers kept private or sanitized;
- post-change MG01 distribution;
- post-change MG01+MG02 distribution;
- post-change MG01+MG02+MG03 distribution;
- reviewer and review date;
- version/source note.
- confirmed depth-key policy, including any per-product-class MG02 dimension;
- singleton evidence exception, approving reviewer, date, and reason when applicable.

Validation rules:

- every observed wording is unique;
- every alias points to one accepted family;
- accepted/alias rows contain canonical product;
- rejected/placeholder/needs-review rows cannot teach or receive MG;
- construction and treatment use governed values or explicit blank;
- no license, property, artwork, slogan, color, or size term is accepted as a physical product without a documented physical-product reason;
- wording made only of generic container/product nouns such as `mat`, `box`, `set`, `art`, `board`, or `bin` cannot be accepted or aliased;
- an alias whose tokens are only a subset of its target canonical wording needs a documented distinguishing-modifier justification or remains `needs_review`;
- no family erases known treatment differences;
- a single-item teaching exception is invalid without the recorded approval fields, and no automatic depth-three assignment may use an unapproved singleton;
- generated JSON matches the authoritative CSV.

Verification gate: validator fails intentionally malformed fixtures and passes the real dictionary. Add tests for every validation rule.

#### Step 4. Complete semantic review

Process:

1. Review distinct phrases in business-meaning groups, not frequency order alone.
2. Start with high-volume provisional post-change phrases because dirty teachers affect every historical decision.
3. Review every prefix chain, spelling variant, abbreviation, omitted noun, material modifier, construction term, treatment term, package quantity, and included contents.
4. Preserve `Foil Canvas`, `High-Gloss Canvas`, `LED Canvas`, `DIY Canvas`, `Glitter Canvas`, gel/coated canvas, embroidery, shaped products, and crumb-rubber door versus outdoor mat distinctions as separate signature attributes.
5. Mark test/testing, fee, `asst`-only, blank, identifier-only, and non-product material fragments as placeholder/rejected as appropriate.
6. Continue until every distinct current parser output has a status. `needs_review` is permitted but cannot teach or receive a proposal.

Verification gate: zero unledgered parser outputs; all mandatory consolidation cases pass; a semantic review report lists counts by status and every unresolved review group.

Natural context cut: start a fresh session before Phase 3. Re-read the entire plan and rerun the dictionary validator first.

### Phase 3: replace unsafe runtime matching

#### Step 5. Make the application dictionary-driven

Target functions:

- replace `PRODUCT_RULES` as the final authority at `hierarchical_item_taxonomy.py:31-131`;
- change `extract_product_type()` at lines 184-194 to return a candidate plus dictionary review status;
- remove live use of `token_similarity()`, `related_later_types()`, and fuzzy logic inside `choose_at_level()` at lines 273-322;
- retire the hard-coded semantic alias map inside `product_key()` at lines 228-238; normalization may correct spelling, whitespace, and punctuation only, while all semantic equivalence comes from reviewed dictionary aliases;
- move usability gating before classification in `run()` at lines 343-389.

Required behavior:

- exact accepted wording or reviewed alias resolves to a stable semantic signature;
- candidate rules may suggest a family but must return `needs_review` until accepted;
- only `accepted`/`alias` rows can reach `classify_product_type()`;
- fuzzy candidate suggestions are written to separate review columns only;
- suggestion fields never populate Proposed MG, Matched Level, or Evidence Share;
- unusable/rejected/placeholder/needs-review rows skip assignment entirely;
- historical stored MG fields remain display-only.
- text-level usability runs first, dictionary status second, and exact evidence qualification third.

Verification gate: a fixture using `Foil Stamp Fee` produces no MG proposal; a reviewed foil-canvas alias produces the expected accepted signature; an unknown phrase produces a suggestion only.

#### Step 6. Rebuild clean maps

Change `build_associations()` so it accepts only post-change rows with accepted semantic signatures.

Build depth-scoped lookup keys: canonical physical product at depth one; product plus the confirmed global or per-product-class MG02 dimension at depth two; full reviewed signature at depth three. Aggregate treatment-distinct families at shallower depths without erasing their treatment fields. A missing deeper modifier cannot prevent contribution to a valid shallower map.

Each map record must retain:

- hierarchy depth and key;
- accepted family ID;
- canonical product, construction, treatment;
- item count;
- full distribution at that depth;
- sanitized/review-safe examples;
- dictionary version.
- winning share, runner-up ratio, and absolute support;
- any reviewed singleton exception;
- any temporal quarantine state.

Do not let incomplete child codes prevent contribution to a shallower valid map.

Apply the locked evidence floors: winning share of at least 0.80/0.75/0.60 at depths three/two/one, winner support at least 1.5 times runner-up support, and at least two supporting rows for automatic depth three. Evidence under temporal quarantine cannot teach. A reviewed singleton exception must be stored and validated, never supplied as an off-ledger runtime override.

Verification gate: automated scan proves every map family exists in the accepted dictionary; zero test/fee/placeholder/needs-review values appear; map counts reconcile to eligible post-change rows.

### Phase 4: prove precision before coverage

#### Step 7. Add the required tests

Extend `test_hierarchical_item_taxonomy.py` and add dictionary-validator fixtures.

Required named behaviors:

1. `test_provisional_type_cannot_teach_any_map`
2. `test_needs_review_type_cannot_receive_proposed_mg`
3. `test_placeholder_is_excluded_before_matching`
4. `test_fee_word_foil_does_not_match_foil_canvas`
5. `test_generic_mat_word_does_not_cross_product_families`
6. `test_generic_box_word_does_not_cross_product_families`
7. `test_reviewed_alias_matches_exact_family`
8. `test_fuzzy_suggestion_never_writes_assignment_fields`
9. `test_license_property_artwork_size_have_zero_weight`
10. `test_treatment_survives_family_consolidation`
11. `test_construction_survives_family_consolidation`
12. `test_historical_mg_values_do_not_change_result`
13. `test_five_outcome_buckets_are_mutually_exclusive`
14. `test_every_map_entry_is_dictionary_accepted`
15. `test_incomplete_post_key_teaches_only_supported_depths`
16. `test_broad_product_aggregates_treatment_families_at_shallow_depths`
17. `test_generic_noun_wording_cannot_alias_into_specific_family`
18. `test_unapproved_singleton_cannot_teach_depth_three`
19. `test_date_partition_is_exhaustive`
20. `test_post_change_temporal_shift_is_quarantined`

Retain and strengthen the existing eight tests. In particular, port the consolidation assertions that currently depend on `product_key()` into dictionary-backed reviewed-alias fixtures; do not delete or weaken them when the hard-coded alias map is removed. Create `test_product_type_dictionary.py` in Step 3 for validator-specific fixtures.

Verification gate: all tests pass; deliberately reintroducing token overlap into live assignment makes false-friend tests fail.

#### Step 8. Run precision review

Before looking at unmatched counts:

1. Review at least 25 assignments from each depth, weighted toward high-volume and formerly fuzzy families.
2. Review every family that produces assignments, with extra rows for high-volume and formerly fuzzy families.
3. Review every user-supplied example.
4. Review former false friends: fee versus foil canvas, outdoor/floor mat versus storage, and generic box families.
5. Review all full-key assignments whose treatment is the deciding evidence.
6. Calculate precision by depth from reviewed samples and list every error.
7. Fix dictionary decisions, never thresholds, when errors are semantic.

Verification gate: zero known false-friend errors remain; the reviewed sample and corrections are recorded in private generated outputs. If errors remain, return to Step 4 or 5 before evaluating coverage.

Natural context cut: start a fresh session before Phase 5. Re-read Phases 5-6 and confirm the STATUS table is current.

### Phase 5: rerun and create the final review workbook

#### Step 9. Rerun all rows and classify residuals

Required five mutually exclusive top-level outcomes:

- matched MG01+MG02+MG03;
- matched MG01+MG02 only;
- matched MG01 only;
- readable accepted product with no reliable MG01 result;
- no usable/accepted product description.

Apply this precedence exactly: text-level unusable first; then dictionary status; then exact evidence. Text-unusable, placeholder, rejected, or `needs_review` rows enter outcome 5. An accepted family with no qualifying post-change analog, conflicting qualified evidence, or a missing/uninterpretable required rework definition enters outcome 4.

Further split outcome 5 into:

- rejected/placeholder wording;
- needs-review wording;

Further split outcome 4 into:

- accepted product with no post-change analog;
- accepted product with conflicting later keys;
- missing/uninterpretable rework definition.

Verification gate: totals reconcile to 15,644; no row has more than one outcome; every proposed code traces to accepted later evidence; every residual has exactly one reason.

If the readable accepted/no-MG01 population materially exceeds Albert's expectation of about 50, explain it by family and reason. Do not change thresholds or use historical codes.

#### Step 10. Generate and visually verify the workbook

Create one `.xlsx` under a unique ignored `.private/item-mg-taxonomy-<run>/` folder using the spreadsheet skill and artifact tool.

Required sheets:

1. Summary and five-count reconciliation.
2. MG01 combinations with accepted associated product signatures.
3. MG01+MG02 combinations with accepted associated product signatures.
4. MG01+MG02+MG03 combinations with accepted associated product signatures.
5. All 15,644 historical recommendations.
6. Dictionary review ledger.
7. Residual unresolved groups.
8. Precision review results.

Historical rows must include original description, five parsed chunks, current MG for comparison, proposed fields, chosen depth, dictionary family/version, exact-wording versus reviewed-alias match basis, fuzzy suggestion and suggestion reason in clearly non-authoritative columns, complete later evidence distribution, and explicit confirmation that excluded wording had zero weight.

Verification gate: inspect key ranges, scan formula errors, reconcile counts, and render every sheet. Fix clipping, illegible widths, broken filters, and hidden warnings before delivery.

### Phase 6: permanent documentation and landing

#### Step 11. Update the durable rules

Update:

- `docs/item-description-mg-classification-process.md`
- folder README
- `AGENTS.md` router
- Codex taxonomy skill and references
- Claude taxonomy skill and references
- the ai-devops source-of-truth copy if installed skills are managed from there.

Replace ambiguous “semantic variants” language with “reviewed aliases.” State explicitly that fuzzy suggestions cannot assign or teach.

Verification gate: search all copies for the old single-full-key and live-fuzzy wording; all copies describe the same governed dictionary and exact-only assignment rule.

#### Step 12. Land safely

1. Work on a `codex/` branch in an isolated worktree.
2. Verify `git var GIT_COMMITTER_IDENT` before the first commit.
3. Stage only workstream files.
4. Commit and push.
5. Open and merge the shared-db PR after all required checks pass.
6. Do not commit private descriptions, generated workbooks, or licensed examples.
7. Update this plan STATUS table after every executed step.
8. Delete the linked handoff only when issue #1113 and every obligation in this plan are genuinely complete.

Verification gate: PR merged, all CI green, `origin/main` contains the implementation SHA, private outputs remain untracked, and the final workbook opens and reconciles.

## 10. Tests required

The twenty new behaviors in Step 7 are mandatory, plus the existing eight tests.

Commands on this workstation:

```powershell
$python = 'C:\Users\ahazan2\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$folder = 'docs\verification\item-mg-reclassification-20260814'
Push-Location $folder
& $python -m unittest test_hierarchical_item_taxonomy.py -v
& $python -m unittest test_product_type_dictionary.py -v
Pop-Location
```

Required data-quality assertions after the full run:

- no proposed MG on rejected/placeholder/needs-review rows;
- no provisional type in any teaching map;
- no fuzzy assignment basis in Proposed MG rows;
- every map entry resolves to an accepted family/version;
- every historical proposal traces to later accepted evidence;
- no post-change evidence under temporal quarantine teaches;
- every date parses and the pre/post populations sum to all 19,302 rows;
- five outcome counts are mutually exclusive and exhaustive;
- zero formula errors in the workbook;
- every workbook sheet visually verified.

## 11. Constraints, standing rules, and gotchas

- The published source files and product descriptions under `data/` are intentionally tracked under Albert's 2026-08-15 ruling. Keep newly generated row-level workbooks and intermediate outputs under `.private/` and never commit them.
- This is analysis logic, not a database structure change. Do not invoke migrations or mutate Supabase.
- Do not change source Item Master data, `mgCategory`, or stored MG codes.
- Use May 14, 2025 as the inclusive learning cutoff.
- Old MG values are display-only.
- Do not infer a child code from a parent result.
- Do not use artwork similarity to select a classification. Artwork may only help choose a readable evidence example after the result is fixed.
- Do not hard-code an MG letter to a product keyword as a replacement for later evidence.
- Do not optimize toward about 50.
- Do not confuse accepted aliases with fuzzy word overlap.
- A trusted post-change row can have an unusable product description. Its MG remains trusted for that row, but the row cannot teach a product phrase.
- Worktrees are shared through the same filesystem; preserve other sessions' files.
- Use `apply_patch` for edits.
- Shared-db uses branch + PR and AI merges after checks pass.
- Update this plan immediately as implementation progresses; stale plan text is an active defect.
- No deployment is required because this is offline analysis.

## 12. Access and environment

Machine: Windows 11 workstation `al8960ofc`.

Repository: `C:\repos\shared-db` (`u2giants/shared-db`).

Current planning worktree: `C:\repos\shared-db\.agents\worktrees\item-taxonomy-plan` on `codex/item-taxonomy-plan`.

Bundled Python:

`C:\Users\ahazan2\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`

Bundled Node.js and spreadsheet dependencies are available through the workspace dependency loader. The spreadsheet skill requires `@oai/artifact-tool` and visual rendering.

Authenticated tools already used:

- `git`
- `gh` for `u2giants/shared-db`
- `ai-grok-review` with Grok 4.6
- `ai-glm` for the requested GLM 5.3 plan review

No secrets are needed. If future work unexpectedly needs credentials, use 1Password vault `vibe_coding`; never write values into files or chat.

## 13. Definition of done, risks, and open questions

### Definition of done

- [ ] Every current parser output has a governed status.
- [ ] Dictionary validator and tests pass.
- [ ] Only accepted types/reviewed aliases teach or receive proposals.
- [ ] Physical product, construction, and treatment remain separately reviewable.
- [ ] Live fuzzy assignment is removed.
- [ ] Unusable rows are excluded before matching.
- [ ] Three independent accepted-evidence maps are rebuilt.
- [ ] Precision gates pass before coverage is discussed.
- [ ] Full 19,302-row run completes.
- [ ] Historical five-count reconciles to 15,644.
- [ ] Every residual has one explicit reason.
- [ ] Final workbook includes all required sheets and 15,644 historical rows.
- [ ] Every sheet is visually verified and formula-error scan is clean.
- [ ] Permanent process and all skill copies agree.
- [ ] No licensed row output is committed.
- [ ] Plan STATUS table and handoff are current.
- [ ] Commit identity is Albert Hazan `<u2giants@users.noreply.github.com>`.
- [ ] Branch is pushed, PR merged, all CI green, and merged SHA verified on `origin/main`.
- [ ] Issue #1113 is closed only after all implementation work is proven complete.

### Rollback

The source files and database are unchanged. Rollback is a Git revert of the implementation commit plus deletion of generated private outputs. Keep the last known audit outputs until the new run is verified so counts can be compared.

### Risks

- Semantic review can accidentally collapse real physical/treatment distinctions.
- Reviewers may accept artwork-like wording as a product type under deadline pressure.
- A high-coverage dictionary can still be wrong if precision samples are weak.
- Removing fuzzy assignment will initially increase unresolved counts; that is expected and must not trigger threshold loosening.
- The existing 750/216 draft may contain contaminated or prefix-fragment families.
- Some accepted old products may genuinely have no post-change analog.
- Some post-change keys may not map cleanly to `MerchGroup_Rework.xlsx`; investigate after clean maps exist.
- Post-change rows may include transitional or inconsistently coded MG combinations; the monthly teacher audit must quarantine them before mapping.
- Installed skills may be overwritten by an ai-devops sync unless the source-of-truth copy is updated.

### Open questions

1. After the clean exact-only rematch, how many accepted product types have no later analog?
2. Do any later keys remain missing from the rework-definition workbook after dirty product phrases are excluded?
3. If a clear accepted product has no later analog, may MG01-only be inferred from the definition workbook? Owner decision required only after the clean residual is quantified.
4. What precision threshold is acceptable for manual samples? Recommendation: zero known systematic false friends and documented correction of every sampled error, rather than a single percentage pass mark.

## Plan self-audit

### Objective checklist

- **All 13 sections present:** Yes, Sections 1-13.
- **Goal first and conflict rule:** Yes, Section 1.
- **Fresh session can execute without chat:** Yes, Sections 2-13 define the system, evidence, files, commands, decisions, phases, and gates.
- **Rejected approaches recorded:** Yes, Section 7.
- **Every step names targets and verification:** Yes, Section 9.
- **Locked versus open decisions:** Yes, Section 8.
- **Out of scope explicit:** Yes, Section 4.
- **Tests named by behavior:** Yes, Sections 9 Step 7 and 10.
- **Terms, paths, identifiers, and SHA defined:** Yes, Sections 2, 3, 5, and 12.
- **Secrets referenced only by location:** Yes, Section 12.
- **Definition of done includes Git/CI:** Yes, Section 13.
- **Plan and handoff link each other:** Yes, STATUS block and the linked handoff.

### Mandatory questions

1. **Could a brand-new session execute this without asking anything?** Yes. Sections 2-5 establish the application and exact state; Sections 6-8 preserve findings and locked decisions; Section 9 provides ordered file/function-level actions and gates; Sections 10-13 provide tests, environment, completion, rollback, and the only deferred owner decision.
2. **Does it carry all relevant background, nuance, and rejected reasoning?** Yes. Sections 3, 6, and 7 include the original 9,155 failure, the refactor, fresh counts, Grok debate, dirty maps, fuzzy exposure, existing draft dictionary, and every rejected shortcut.
3. **Is the ultimate goal clear enough for judgment calls?** Yes. Section 1 states the business outcome and explicitly says the goal wins over a conflicting step. Section 8 distinguishes locked rules from limited implementation judgment.

No gap was found in the final audit.
