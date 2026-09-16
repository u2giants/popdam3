# Implementation plan — product-type reader (issue #3024)

Handoff for this plan: [`HANDOFF.d/2026-09-16T1200Z-edge-dev-claude-product-type-reader-plan.md`](HANDOFF.d/2026-09-16T1200Z-edge-dev-claude-product-type-reader-plan.md)

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 0 | Plan written, issue opened | ✅ done 2026-09-16 | this file; issue u2giants/shared-db#3024 |
| 0a | Orchestrator ticket #3036 opened for columns | ✅ done 2026-09-16 | issue u2giants/shared-db#3036 |
| 1 | Move reader into a permanent module | ⬜ open | — |
| 2 | Build the full-catalog gold set | ⬜ open | — |
| 3 | Measure baseline accuracy | ⬜ open | — |
| 4 | Fix rules until the gold set is 100% | ⬜ open | — |
| 5 | Owner acceptance of the gold set results | ⬜ open | — |
| 6 | Discover the `plm.item` writer | ⬜ open | — |
| 7 | Columns land via #3036 (orchestrator) | ⬜ open, runs in parallel with Phase A | — |
| 8 | Populate + keep populated | ⬜ open (depends on #3036 merged + applied on production, and step 5 acceptance) | — |
| 9 | Live acceptance and doc updates | ⬜ open | — |

**Fresh session starts at step 1.** Re-read Phases 2 and 3 before starting each phase (drift check).

---

## Part 1 — Why

### 1. The ultimate goal

POP Creations' item descriptions mix everything into one line: licensor, property, artwork, slogan,
size and — somewhere in there — the actual product (e.g. *"Disney Cars Nonwoven storage closet toy
chest with playmat Group shot Take the open 10x15""* is really a **fabric storage toy chest**).

When this is done, **every item in our own product table (`plm.item`) carries a clean, trustworthy
"what physical product is this" value**, derived automatically from its description and kept current
as items arrive. It is used to (a) match products against each other to assign MG codes to old items,
and (b) classify HTS (customs tariff) codes, where the physical product and material are what matter.

"100% perfect" means: on every usable description in the live catalog the value is correct as judged
against a reviewed gold set, and every description the reader cannot read is **explicitly marked
unreadable** — never guessed. A wrong value is worse than a blank one, because HTS classification is a
legal/customs matter.

**If a step in this plan conflicts with this goal, the goal wins — stop and flag it in issue #3024.**

### 2. What this application is

`u2giants/shared-db` (this repo) governs the *structure* of POP Creations' shared Supabase database
(project `qsllyeztdwjgirsysgai`), used by PIM `poppim-web`, CRM `popcrm-web`, DAM `popdam-web` and the
`popcre/designflow-*` PLM repos. Read `AGENTS.md` first. Issue #3024 is `repo-maintenance` scope — the
umbrella for the reader work; the column change itself is orchestrator issue #3036. Schema changes go only through
`supabase/migrations/` and the single orchestrator session (skills `shared-db-change`,
`shared-db-orchestrator`). Default branch `main`, protected; work on a branch + PR.

Relevant tables (verified live 2026-09-16):
- `plm.item` — **our canonical product table** ("the ultimate item list", owner ruling in AGENTS.md).
  19,362 rows, all `source_system = 'coldlion'`, 19,118 with `description`. Columns include
  `item_number, description, licensor_id, property_id, product_type_id (all null), merch_group_id, raw`.
- `coldlion.item_header` — landing mirror of the ColdLion ERP (a.k.a. "Item Master"); has `item_desc`,
  `hts_number`, `hts_number2`, `mg_category`. **Refreshed from ColdLion; never add derived columns here.**
- `core.product_type` — existing product-type lookup referenced by `plm.item.product_type_id`
  (currently unused on `plm.item`).

### 3. What triggered this work

Albert, 2026-09-16: the MG01–03 classification work already wrote code that strips licensor, property,
size and artwork out of the description to leave the product type. He wants it tested to 100%, then
stored in a new field so it can also feed HTS classification. He ruled the field goes on **our own
product table (`plm.item`)**, not the ColdLion mirror.

### 4. Scope

In: hardening the reader; a gold-set test over the full live catalog; a permanent module + tests; one
new column on `plm.item` via the orchestrator; populating it and keeping it current.

**NOT in this plan:**
- Changing any MG01–MG04 code on any item (that is `plan_historical_mg_reclassification_apply.md`).
- Assigning HTS codes (this plan only supplies the input).
- Filling `plm.item.product_type_id` / reorganizing `core.product_type` (possible later; see §7).
- Writing anything to `coldlion.*` or asking ColdLion to change descriptions.
- Licensor/property/size/artwork extraction quality beyond what is needed to strip them.

---

## Part 2 — What we already know

### 5. Current state of the code

All in `docs/verification/item-mg-reclassification-20260814/` (analysis area, merged to `main`, never deployed):
- `product_type_dictionary.py` — **the reader**. `normalize()` (:17) lowercases, strips accents and
  expands abbreviations (`cnvs`→canvas, `shdwbx`→shadowbox…). `unusable_reason()` (:51) flags blank,
  `PENDING`, `ASSORTMENT`, fees, tests, bare item numbers. `PRODUCT_PATTERNS` holds curated regexes →
  (physical product, construction/shape). `classify_semantic_signature()` (:327) picks the longest
  matching phrase and returns `physical_product`, `construction_shape`, `treatment` (embellishment:
  glitter, foil, LED…), `material`, `form`, `subtype`, `status` (`accepted` / `placeholder` /
  `needs_review`).
- `hierarchical_item_taxonomy.py` — `parse_description()` (:233) wraps the reader and also extracts
  size (`DIMENSION` regex), licensor and property (name lexicons) and leaves the rest as artwork text.
- `extract_description_chunks.py` — older chunking script; superseded by the two above.
- `test_hierarchical_item_taxonomy.py` — 39 tests, **all pass** (2026-09-16, `python -m pytest -q`,
  needs `pandas`).
- Source CSVs formerly in `data/` were moved to the private repo `u2giants/licensor-source-data`
  (#1871). Do not copy them back. Use live `coldlion.item_header` / `plm.item` instead.
- Method doc: `docs/item-description-mg-classification-process.md` (Step 1 defines the five fields).

Nothing is committed for this plan yet except this file and its handoff.

### 6. Key findings

Spot check 2026-09-16: 150 random `coldlion.item_header.item_desc` (ordered by `md5(item_no)`), 55
real-product ones run through `classify_semantic_signature`:
- 44 correct.
- 7 no answer (`needs_review`), e.g. "Marvel Acrylic **Pencil Case** …", "Disney MDF **die-cut block** …",
  "DC Comics MDF **floating character box** …", "**MDF Print Framed** 16"x20" …" (word order),
  "Disney **dome block tabletop décor** …", "Peanuts XLarge **Box Lift-Off Greyboard Storage** …",
  "Marvel **DoubleLayer Diecut Art** Hulk".
- 4 wrong: "Memory Foam **Floor Mat**" → Door Mat; "canvas **growth chart**" → Canvas;
  "3pcs **folding canvas-texture frame set with 3 markers**" → Canvas; "Coca-Cola **Desk Mat**" →
  material Rubber with no material in the text (a default was invented).
- The `Canvas` fallback (`product != "Canvas"` tiebreak, default rule
  `bare_canvas_means_stretched_wall_art`) swallows other products that merely mention canvas.
- Fixed-default materials in `subtype_for_product`/`form_for_product` produce values not stated in
  the description — acceptable for MG grouping, **not** for HTS.
- The mixed-assortment lines ("Disney, NBC, and Marvel framed 3D Lenticular") read fine; "ASSORTED
  CONTRACTUAL … ORGANIZERS" is flagged placeholder though it names a product — decide in step 2.

### 7. Approaches considered and rejected

- **Column on `coldlion.item_header`** — rejected by owner 2026-09-16: ColdLion refreshes overwrite it
  and it is a source mirror (memory: owner rulings survive syncs).
- **Using `plm.item.product_type_id` → `core.product_type` instead of a text column** — not now: the
  lookup is unpopulated and its vocabulary does not match the reader's; forcing a mapping would hide
  reader errors. Revisit after this plan.
- **An LLM classifying each description** — rejected as the source of record: not deterministic, not
  auditable; the MG work already ruled AI mapping "a draft only". An LLM MAY be used in step 2 to
  *propose* gold labels that a human then confirms.
- **Declaring success from unit tests or a sample** — rejected: the 39 green tests coexisted with a
  20% miss rate. Success is measured on the full live catalog.
- **Using historical MG codes to guess product type** — forbidden by the process doc.

### 8. Design decisions

Locked:
- (2026-09-16, Albert) Store on `plm.item`, not ColdLion tables.
- Deterministic rules, no AI at runtime.
- Unreadable descriptions store an explicit "unreadable" status, never a guess.
- Licensor, property, artwork, color, size never influence the product type.
- Only material/treatment actually stated in the description may be stored in the HTS-facing value;
  inferred defaults are kept separately flagged or dropped.
- (2026-09-16, Albert) Column shape — requested up front in orchestrator issue #3036 so the slow
  orchestrator queue is not the bottleneck. On `plm.item`, all nullable: `product_type text`,
  `product_construction text`, `product_material text` (material stated in the description only),
  `product_treatment text`, `product_type_status text check in ('accepted','unreadable','placeholder')`,
  `product_type_rules_version text`, `product_type_read_at timestamptz`.

Open (implementer decides, with criteria):
- Where the reader runs (step 6): a database function (SQL port) vs. the existing ColdLion ingest job
  (Python). Criterion: whichever already writes `plm.item`, so the value can never go stale; one
  implementation only — no second copy of the rules.

---

## Part 3 — How to build it

### 9. Steps

**Phase A — make the reader right (repo code; no database writes).**

1. **Permanent module.** Create `tools/product_type_reader/` (package) by moving the reader logic from
   `product_type_dictionary.py` (normalize, unusable_reason, PRODUCT_PATTERNS, classify) plus
   `DIMENSION`/size stripping. Leave thin re-exports in the old file so
   `test_hierarchical_item_taxonomy.py` keeps passing. Expose `read_product_type(description) ->
   {product_type, product_construction, product_material, product_treatment, product_type_status,
   product_type_rules_version, matched_wording}` — exactly the #3036 columns (`product_type_read_at` is set
   by the writer; `product_material` holds stated material only, so there is no `material_stated` flag;
   `matched_wording` is for evaluation, not stored).
   Gate: `python -m pytest -q docs/verification/item-mg-reclassification-20260814 tools/product_type_reader` all green.

2. **Gold set from the full catalog.** Read-only: export every distinct `item_desc` from
   `coldlion.item_header` (join to `plm.item` on item number) to the scratchpad — **not** into this public
   repo (descriptions may be committed only as the approved small fixture below). Group by the reader's
   matched wording; for every distinct product wording, record the correct product type in
   `tools/product_type_reader/gold/labels.csv` (wording → expected product, material, treatment, status),
   plus ≥3 real example descriptions per label and every item in categories found wrong in §6. An LLM
   may propose labels; each label must be confirmed by the implementer against the description, and
   ambiguous ones listed for owner review (step 5). Gate: every distinct matched wording and every
   `needs_review` cluster has a label row; script `gold/coverage.py` prints `uncovered: 0`.

3. **Baseline.** `tools/product_type_reader/evaluate.py` runs the reader over all live descriptions and
   the gold labels, writes `docs/verification/product-type-reader/baseline-<date>.md` (counts only +
   up to 50 example misses). Gate: report exists, shows correct / wrong / unreadable counts.

4. **Fix rules.** For each miss cluster add or correct patterns, ordering, abbreviations; remove
   fallbacks that invent product or material. Each fix gets a unit test with the real description
   (fixture `tests/fixtures/descriptions.csv`, owner approved publishing descriptions 2026-08-15).
   Iterate until evaluate shows **wrong = 0** and every unreadable row is genuinely unreadable (listed
   in the report for review). Gate: `evaluate.py --strict` exits 0; report committed.

5. **Owner acceptance.** Publish the final report as a private artifact summarizing: counts, the
   unreadable list, and ambiguous labels. Albert (or his named reviewer) confirms. Record the ruling
   date in §8. Gate: acceptance comment on #3024.

**Cut point — fresh session allowed here.**

**Phase B — store it (structural).**

6. **Find the writer.** Determine what inserts/updates `plm.item` from ColdLion (not in migrations as
   of 2026-09-16; `plm.import_item_master_data` is the only SQL function inserting into `plm.item` — check
   it and the ColdLion sync repo/job). Gate: named file/function + evidence line in #3024.

7. **Columns land via #3036 (orchestrator; runs in parallel with Phase A).** The implementer does NOT
   author the migration. Check #3036's status (`gh issue view 3036`). If reader work shows a column is
   wrong or missing, comment on #3036 immediately (or open a follow-up structural issue) — do not wait
   for Phase A to finish. Gate: #3036 merged and applied on production with drift check clean;
   `select count(*) from information_schema.columns where table_schema='plm' and table_name='item' and column_name in ('product_type','product_construction','product_material','product_treatment','product_type_status','product_type_rules_version','product_type_read_at')`
   returns 7.

8. **Populate and keep current.** Requires #3036 merged + applied on production and step 5 acceptance. In the writer found in step 6, call the single reader implementation
   on insert/update of `description`; backfill all existing rows in batches (application row data — owned
   by that writer, not a migration). Gate: `select product_type_status, count(*) from plm.item group by 1`
   has no nulls; values equal a fresh `evaluate.py` run for 100 random items.

9. **Live acceptance + docs.** Update `docs/item-description-mg-classification-process.md`, AGENTS.md
   pointer, this STATUS table; close #3024. Gate: #3024 closed with evidence links.

### 10. Tests required
- Existing: `test_hierarchical_item_taxonomy.py` (39) stays green.
- New `tools/product_type_reader/test_reader.py`: one test per §6 miss (pencil case, die-cut block,
  floating box, word-order "MDF Print Framed", dome block, lift-off storage box, double-layer die-cut art,
  floor mat ≠ door mat, growth chart ≠ canvas, folding frame set ≠ canvas, desk mat has no invented
  material); placeholders stay placeholder; licensor/property/size removal never changes the product;
  `16x20` vs `20x16` same result; determinism (same output across `PYTHONHASHSEED` values).
- `evaluate.py --strict` against gold labels as a CI-runnable check.
- Migration: repo migration checks + ledger drift.

### 11. Constraints and gotchas
- Structure only through `supabase/migrations` + orchestrator; never dashboard edits. Every issue needs
  `db-work` label and scope block.
- Public repo: do not commit full-catalog exports; private outputs go to `u2giants/licensor-source-data`.
- Historical MG values must never teach the reader.
- Don't reuse the `data/` CSV paths in README — those files are gone.
- `normalize` replacements are substring replacements (`"cvs"` hits inside words) — check for collateral.
- Many sessions touch this repo: check open PRs before editing shared docs; stage only owned files.
- Git Bash converts POSIX-looking args; use PowerShell or `MSYS_NO_PATHCONV=1` if paths break.

### 12. Access and environment
- Supabase MCP (`execute_sql`) read access verified 2026-09-16; production project `qsllyeztdwjgirsysgai`.
- `gh` authenticated as `u2giants`.
- Python 3.13 with `pandas`, `pytest` (`python -m pip install pandas openpyxl pytest`).
- Secrets: 1Password vault `vibe_coding` only; none needed for Phase A.

---

## Part 4 — Landing it

### 13. Definition of done, risks, open questions
Done when: reader module + tests merged; strict evaluation report committed with wrong = 0; owner
acceptance on #3024; migration merged and applied on production with drift check clean; every
`plm.item` row populated and kept current by the writer; docs updated; #3024 closed; handoff file closed.

Risks: rules tuned to today's catalog miss new wordings → new items land `unreadable` (visible, not
wrong) and `evaluate.py` should run on a schedule; two copies of rules drift → exactly one
implementation; backfill load on shared DB → batch.
Rollback: columns are additive; drop via a follow-up migration.

Issue scope: #3024 is `repo-maintenance` (umbrella for the reader work); columns are orchestrator issue #3036.
Open: runtime location (criteria in §8); whether "ASSORTED CONTRACTUAL …
ORGANIZERS"-style lines count as usable (decide in step 2, confirm in step 5).

---

## Self-audit (2026-09-16)
1. *Could a fresh session execute without asking?* Yes — goal §1, tables/row counts §2, code locations §5,
   concrete misses §6, steps with gates §9, access §12. Gap found and fixed: data CSVs no longer exist
   (added to §5, §11).
2. *Does it carry all background, including what was ruled out?* Yes — §7 (ColdLion column, LLM,
   sample-only success, product_type_id), §8 locked rulings with dates.
3. *Is the goal clear enough to overrule a wrong step?* Yes — §1 defines "100%" as wrong = 0 with
   explicit unreadable status and says a blank beats a guess.
