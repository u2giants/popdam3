---
issue: 3024
status: OPEN
owner: codex/product-reader-01a0bc30
---

# Product-type reader Phase A — recovered handoff, 2026-09-23

## 0. Decisions only Albert can make

- **Already decided:** Albert answered “Mark unreadable: mixed products.” A description explicitly combining separate products has status `unreadable`, reason `mixed products`; show that group separately in the acceptance evidence. Do not force one product type.
- **Later, after proof is ready:** Albert or his named reviewer must accept the full-catalog counts, independently reviewed unreadable list, and ambiguities in a comment on [#3024](https://github.com/popcre/shared-db/issues/3024). No acceptance has been recorded. The Phase B writer/backfill is forbidden until this happens. There is no owner decision to request now; make the proof complete first.

## 1. What this application is

`popcre/shared-db` coordinates the shared database and related verification tools for POP Creations. ColdLion supplies item descriptions; `plm.item` is the ultimate item list. The reader reduces description text to a deterministic product type for later HTS customs classification, with separate construction, explicitly stated material, and explicitly stated treatment. The legacy merchandise-group (MG) codes are historical classification data and cannot teach the reader. [The plan](../plan_product_type_reader.md) and [issue #3024](https://github.com/popcre/shared-db/issues/3024) are the task router. This is **non-orchestrator** code/evidence work, with no database shape change or row write in Phase A. Structural [#3036](https://github.com/popcre/shared-db/issues/3036) already landed the seven `plm.item` columns via PR #3108.

## 2. Goal and trigger

Albert asked that the reader correctly classify **every live catalog description**, leaving a blank/unreadable status when the words do not support a truthful answer. The 2026-09-16 spot check found about 20% of a 150-description sample wrong or unreadable, including pencil cases, MDF die-cut blocks, floor mats vs door mats, and invented materials. Phase A is plan steps 1–5: permanent reader package, independently labeled full-catalog gold set, baseline, zero-wrong strict evaluation with a unit test per correction, and owner acceptance on #3024. Phase B (population) is a separate session after acceptance.

## 3. Current state — independently check again before acting

- **Public code preserved locally, not pushed from this branch:** `codex/product-reader-01a0bc30` at `f0e27ec010e5f298493084579074b2128d16df7b`. Recovery worktree: `D:/product-reader-worktrees/handoff-regenerated-20260923-01a0bc30`. It contains `tools/product_type_reader/`, a legacy bridge, tests, old gold labels and baseline. It is behind `origin/main` (`0a086c318390565059f4b77613bc2d897ad30228` when checked at 18:10 UTC 2026-09-23). Do not implement from the canonical `C:/repos/shared-db` checkout; it contains other sessions' untracked files.
- **Old frozen-catalog proof, provisional:** 17,614 distinct descriptions / 18,972 source rows; labels SHA-256 `dd77f7283174f4fa7b50286831d8d2c645c9cd6576a0a2fcfafe6ef929705023`, assignments SHA-256 `5843c1477f205028a0f1d212cfd16c410abbd4737fc80316379dbd1b642bef82`; `evaluate.py --strict` returned correct 18,972, wrong 0, uncovered 0, errors 0; 1,328 tests plus four subtests passed. **This is not final acceptance**: the live catalog grew and a synthetic artwork safety case still fails.
- **Latest privately captured live sample (12:10:48 UTC 2026-09-23):** 17,627 distinct descriptions / 18,985 source rows; catalog SHA-256 `2dc8fd0eea94a0243e051d27b90a94d2a6e0a1d5bc41e085ed509dce175314f6`. The 13 new descriptions were independently reviewed; private overlay labels SHA-256 `97acd6512ded79f3a7fe8a6789d0cec2ae32f92665aa44bf5db0421faf8acefd`, assignments SHA-256 `1595b82ddd84f746db0cf78ebced6aa6201409959e9d0508e681e49eab28654d`. Coverage was 0 uncovered. Row statuses: 17,056 accepted, 1,108 unreadable, 821 placeholder; 73 source rows are mixed-product unreadable. The exact snapshot and overlay are **local/private, not a final pushed artifact**.
- **Latest delta misses:** frozen reader matched 10 of 13 new descriptions. At catalog SQL position 3203, `Storage Hamper` read unreadable; at positions 8150 and 11489, independently labeled `Faux Book` read `Hard Storage Box`. Recheck source and pinned labels before changing code. The Faux Book family also has 95 older distinct descriptions (99 rows) whose old gold label is `Hard Storage Box` despite no explicit hard/box noun. Source reviewer identified a likely family correction but **did not finish/pin the 95-row amendment**.
- **Private evidence:** `C:/repos/licensor-source-data` has local branch `codex/product-reader-private-delivery-01a0bc30` at **un-pushed** `94be38abe93e871f08b5bedd4d29ad003fc95406`, containing `product-type-reader/2026-09-23/` (catalog, assignments, labels, manifest, source inventory, and 13-row independent delta). Its original worktree disappeared, but the branch ref survives. [Private draft PR #85](https://github.com/u2giants/licensor-source-data/pull/85) remains open at older pushed head `387f54fa7bb43c32a715c1b6e793e8f6ad083ea4`; it does not yet contain that commit. The public repo must never receive a full catalog export or private assignments.
- **Open public PR to supersede:** [#3332](https://github.com/popcre/shared-db/pull/3332), head `a03be8f2dd697b08f372e9710982658bc1a7d9bc`, used self-derived gold and has a blocking comment. Do not merge it as proof. Open a corrected PR from the preserved branch after the gold and safety work are done.
- **Plan status:** `plan_product_type_reader.md` still marks steps 1–5 OPEN and step 7 DONE. No Phase A PR from this branch is merged; no owner acceptance, Phase B write, preview apply, or production apply occurred.
- **Lost local-only changes:** the old public worktree and private delivery worktree were removed between turns. Public updated labels, new baseline/report, and `.agent/work/3290/12/contract.json` that had not been committed were lost; reconstruct from the private branch and immutable contract ref rather than assuming those files are present.

## 4. What did not work

- Reusing historical MG codes as a type teacher is disallowed: the codes are the reason this work exists and do not establish a truthful product noun.
- The first legacy-reader baseline was roughly 1,890 correct and 17,095 wrong on the newer 18,985-row population; it is a baseline, not a defensible classifier.
- An artwork cutoff broad enough to block depicted `wooden bowl` and `glitter bird` also caused 46 old-gold regressions and lost separately stated `foil finish`; do not reapply it wholesale. A narrowed replay cleared those 46 but still failed the synthetic safety class. The current WIP was not put through a full strict rerun.
- A type shortcut for token `book` can confuse a real product with depicted artwork. Correct the product noun/family boundaries, not an unconditional token match.
- Incremental queries on `created_time`/`mod_time` after an earlier capture returned zero despite 13 rows appearing in the new full snapshot. Reconcile full snapshots by stable row identity; timestamps alone are insufficient.
- The old public gold contains incorrect `Hard Storage Box` labels for the Faux Book family. A passing strict run against those old labels cannot prove truth. The label correction must be source-pinned before code changes are credited.
- A privileged local Postgres password was discovered during investigation but **was not used**. Continue read-only access through the approved Supabase MCP and private-file bridge; never expose credentials or full licensed rows in chat or public repo.

## 5. Root causes and key findings

- The reader's current artwork boundary can take material/treatment words from a depicted object as if they describe the item. Synthetic checks: `Plastic tray with wooden bowl artwork` must not add Wood; `Canvas with small wooden bird artwork` must not add Wood; `Canvas with glitter blue bird artwork` must not add Glitter; `Canvas with glitter bird artwork and foil finish` must retain explicitly stated Foil. These examples are invented tests, not catalog exports.
- The Faux Book source family requires a canonical type decision based on the described product, not the old gold. `D:/product-reader-worktrees/faux-book-family-audit-20260923` has the source audit. Materials may be retained only when stated; verify explicit set counts before finalizing construction.
- `C:/repos/worktrees/product-reader-rules-20260922`, branch `codex/product-reader-rules-20260922`, holds **uncommitted experimental** artwork code/tests. At stop, reader SHA-256 began `69916da5e318`, test SHA-256 `43da15c42d93`. Inspect its diff before copying anything into the owner branch; the broad attempt is known to regress.
- Local live-delta capture survives at `D:/product-reader-worktrees/live-delta-20260923-1200/product-type-reader/2026-09-23/catalog.json`. The 2026-09-23 private branch commit is the durable local source for the complete overlay, but it is not yet pushed.
- The rulebook work-contract ref for non-orchestrator landing issue [#3290](https://github.com/popcre/shared-db/issues/3290) is `refs/db-contracts/3290/12`, published before implementation; recorded contract SHA-256 `b1d584dfde876a1bee45282ab4be43368f55d74a`. The local JSON was lost. A PR touching `plan_*.md` needs the `.agent` evidence pair introduced together in a pair-only commit, exact-head independent review, then `guarded-migration-merge.yml`; ordinary `gh pr merge` is blocked for that class.

## 6. Exact next steps and gates

1. In the recovered public worktree, fetch current `origin/main`, inspect status and owned diff, and merge main while resolving `.agent` conflicts with **main's** versions; preserve the work branch. Gate: clean merge and `git diff` shows only intended code/evidence. Confirm issue #3024 and landing issue #3290 remain non-orchestrator, with `db-work` labels.
2. Recover the private delivery branch in a **new isolated private worktree** and review commit `94be38a`; finish source-pinned Faux Book audit for all 95 old distinct descriptions plus the two new ones. Gate: reviewer evidence maps each exact source row to one corrected expected label; material/construction claims are explicitly supported. Push/merge private PR #85 only after the final private package is accurate.
3. Repair the public reader's artwork boundary, Faux Book family and Storage Hamper miss. Add a unit test per rule correction, including the four synthetic artwork cases above. Gate: original taxonomy tests and new tests all green, with no invented material/treatment and no loss of separately stated Foil.
4. Regenerate public, source-neutral `tools/product_type_reader/gold/labels.csv` grouped by matched wording; keep full-catalog labels/assignments only in private evidence. Restore the new baseline and final `docs/verification/product-type-reader/` report. Gate: every distinct wording and every review cluster covered; privacy scan shows no full catalog in public Git diff.
5. Run `evaluate.py --strict` on the complete latest live catalog against the independently reviewed private gold, then capture a **fresh full live snapshot** at the end and rerun if it changed. Gate: wrong 0, uncovered 0, errors 0, every unreadable row source-confirmed, no synthetic safety failure; publish exact counts, hashes, rules version and bounded unreadable evidence. Do not claim 100% from the old snapshot.
6. Before implementation commit of any `plan_*.md` change, restore/publish the exact `.agent` work-contract evidence pair per repo guard. Audit all sibling paths, run required tests and task gates, open a signed PR with `Closes #3290`, obtain exact-head independent approval (`REVIEWER_DOCTOR_TIMEOUT_MS=420000`), exclude `glm-5.3` if drawn for this GLM/ZCode-authored work using the assignment ref SHA, then dispatch `guarded-migration-merge.yml` with PR number and head SHA. Gate: merged `main` contains reviewed code/report, checks pass, and PR state is MERGED. If no plan file is changed, re-evaluate the contract route against the actual diff rather than assuming an exemption.
7. Publish aggregate counts, the private unreadable list, and ambiguous cases for Albert on non-orchestrator #3024; ask for acceptance there **only after** the strict gate and merge. Gate: Albert or named reviewer records acceptance. Stop here; Phase B writer/population is a separate session.

## 7. Constraints and gotchas

- `AGENTS.md` §§0.0-B, 2.1-W, 6.4 apply. Use your own worktree cut from current upstream; never edit canonical `C:/repos/shared-db` for this work. No database writes in Phase A. Structural #3036 is done; do not request the seven columns again and never write `coldlion.item_header`.
- Deterministic rules only, no AI at runtime. Licensor, property, size, artwork and color cannot influence product type. Store only material/treatment actually stated for the product; unreadable beats a wrong answer. Mixed products are unreadable by Albert's explicit decision.
- Private artifacts belong in `u2giants/licensor-source-data`; public repo may carry only small approved examples and aggregate/hash evidence. Never paste raw catalog rows or secrets into GitHub comments, logs, prompts to outside services, or this handoff.
- Before first commit verify `git var GIT_COMMITTER_IDENT` is `Albert Hazan <u2giants@users.noreply.github.com>`. Stage only owned files. Sign every GitHub body/comment `Posted by Codex chat 01a0bc30-c70c-7302-8ba3-ed0e9512e6a1 on EDGE-DEV` (use the active chat ID in a successor session). Run `ai-task-gates start` and `check --before` stronger gates. Review every exact PR diff before merge.
- The live main branch and reviewer marker can change. Resolve both afresh. For a RULEBOOK plan PR, publish the contract before the implementation commit; if main moves, merge it and use **one pair-only commit** for both `.agent` files. A prior APPROVE can carry by content equivalence; do not assume it without verifying.
- A reviewer draw may select `glm-5.3` despite this work's independence conflict because the live orchestrator marker is Claude-engine. Exclude with `--reason independence-conflict --evidence-sha <assignment-ref-SHA>` and redraw, following current script syntax. Do not bypass a failed reviewer or guarded merge.

## 8. Access and environment

- Machine: EDGE-DEV / PowerShell. Public GitHub repo: `https://github.com/popcre/shared-db`; private evidence repo: `https://github.com/u2giants/licensor-source-data`. `gh`, `git`, Python, Node, `ai-task-gates` were available during this handoff; reauthenticate/verify current state before use.
- Public recovery worktree: `D:/product-reader-worktrees/handoff-regenerated-20260923-01a0bc30`, branch `codex/product-reader-01a0bc30`. This handoff was rebuilt in a separate fresh-main worktree/branch so the unfinished code branch is untouched.
- Private branch `codex/product-reader-private-delivery-01a0bc30` survives in `C:/repos/licensor-source-data`; its delivery worktree must be recreated. Faux Book and live-delta worktrees are named in §§3–5. Secrets belong in the `vibe_coding` 1Password vault; no secret value is recorded here.
- Read first: `plan_product_type_reader.md` STATUS, `AGENTS.md` §§0.0-B/2.1-W/6.4, #3024 scope block, `docs/item-description-mg-classification-process.md`, `plan_mg_taxonomy_three_axis_repair.md`, and business-rule topic from `docs/business-rules/application-map.md` when behavior changes. The existing plan handoff `HANDOFF.d/2026-09-16T1200Z-edge-dev-claude-product-type-reader-plan.md` is background, not live proof.

## 9. Open risks and questions

- **2026-09-23, open:** The newest full snapshot may already be stale. End-of-work source recapture is required before any “full live catalog” claim.
- **2026-09-23, open:** Faux Book family source correction is not pinned; current strict zero on old gold could still conceal wrong answers.
- **2026-09-23, open:** Artwork/material/treatment synthetic P1 failure has no verified complete fix. WIP cannot be treated as accepted without full regression and strict replay.
- **2026-09-23, open:** The private new-catalog commit exists locally only. Push it via the private PR after review; until then another machine cannot reproduce the new gold.
- **2026-09-23, open:** Public grouped labels must be checked for duplicate-LED grouping and independent source support. A prior deduplication adjustment was not rerun on the final new corpus.
- **2026-09-23, decided:** Albert chose mixed-products unreadable. No further product-type guess is authorized for those rows.

## Contributor work from this phase

- **catalog_review:** independently examined live catalog/product-type truth and exposed family-level gold issues; no public PR or database write. Source review needs to be reconciled with the final private gold.
- **construction_parser:** worked on deterministic construction extraction and tests in the reader branch; verify the preserved branch diff and final suite before landing.
- **evaluation:** built/replayed strict catalog evaluation and counts; its old-snapshot zero result is provisional until current source and gold are rerun.
- **gold_mixed_audit:** audited descriptions combining products; Albert's decision is unreadable `mixed products`; check all 73 source rows remain separate in acceptance evidence.
- **material_audit:** audited unsupported material/treatment claims; the synthetic artwork leaks above remain the outstanding safety gate.
- **material_parser:** worked on explicit material/treatment rule behavior; inspect current branch and test results, not an assumed completed patch.
- **private_evidence:** prepared private catalog/gold artifacts, with local commit `94be38a` and draft PR #85; no final private merge.
- **reader:** moved/refined permanent reader and legacy bridge on preserved public branch `f0e27ec01`; no corrected public PR merge or Phase B write.

## Handoff self-audit

1. **Can a new developer continue without asking this chat? Yes:** §§1–3 identify the business task, exact branches, snapshots, hashes and partial delivery; §§6–8 give a bounded route and access.
2. **Could they continue as effectively as this session? Yes:** §§4–5 preserve failed approaches, source-label defects, synthetic safety cases, worktree locations and contract ref.
3. **Are goals, proof, constraints, risks and next actions present? Yes:** §§2–9 cover each and give a verification gate for every step in §6.
4. **Are all owner decisions in §0? Yes:** the settled mixed-product ruling and later Phase A acceptance are consolidated there; §§1–9 and contributor notes introduce no further owner decision.
