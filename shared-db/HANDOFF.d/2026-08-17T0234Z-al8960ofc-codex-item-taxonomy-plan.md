---
issue: 1097
status: OPEN
owner: codex/item-taxonomy-plan
---

# HANDOFF — Item Description taxonomy implementation plan (2026-08-17 02:34 UTC, al8960ofc/codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### BLOCKING

None before implementation begins.

### RECOVERABLE

- After the clean exact-only rematch, if accepted historical products still have no post-change analog, decide whether MG01-only may be inferred from `MerchGroup_Rework.xlsx`. **Recommendation:** do not approve that authority now. First quantify and review the residual group under the clean method.

### NOT PART OF THIS WORK, AND NOBODY IS ON IT

None discovered.

### Already settled — do not re-ask

- 2026-08-16: MG01 itself does not need repair; only analysis logic is in scope.
- 2026-08-16: post-change learning begins May 14, 2025; historical rows end May 13, 2025.
- 2026-08-16: historical MG values cannot teach or rescue proposals.
- 2026-08-16: match three independent levels deepest-first and leave unsupported children blank.
- 2026-08-16: approximately 50 readable-unmatched rows is an alarm, not a quota.

## 1. What this application is

This is an offline Item Master analysis in `u2giants/shared-db`. It parses 19,302 historical and current product descriptions, learns product-to-MG relationships only from items created May 14, 2025 or later, and proposes the deepest defensible new-system MG hierarchy for 15,644 older items. The source files are intentionally published under Albert's 2026-08-15 ruling; new row-level outputs remain private. It does not write to a database or production application. The complete build specification is [`../plan_item_description_mg_taxonomy_repair.md`](../plan_item_description_mg_taxonomy_repair.md).

## 2. What we set out to do this session, and why

Albert asked to rewrite the remediation plan using the corrections reached in a two-round Grok 4.6 debate, then run the improved plan by GLM 5.3. The plan must be executable by a brand-new session and must prevent a lower unmatched count from hiding wrong assignments.

## 3. Current state — what is true right now

- PR #1091 previously merged the three-map fallback architecture at commit `b262a9fd698b60ab0e455d63b8b97a965eb9bfbb`.
- A fresh run produced 2,035 full, 7,588 pair-only, 2,520 MG01-only, 2,726 readable-unmatched, and 775 no-usable-description rows. The workbook remains an audit artifact, not final.
- Grok agreed with the diagnosis and required removal of fuzzy live assignment, exclusion of provisional teachers, governed dictionary statuses, separate product/construction/treatment, broader unusable detection, precision-first tests, and updates to all skill copies.
- The implementation plan is written at [`../plan_item_description_mg_taxonomy_repair.md`](../plan_item_description_mg_taxonomy_repair.md) with all implementation steps open.
- Issue #1097 tracks the work.
- Planning branch: `codex/item-taxonomy-plan`, based on `origin/main` commit `93a337719dbc39a071d9ae78f191a3954fac2371`.
- No implementation has begun. No Item Master, MG code, `mgCategory`, database, or production system was changed.
- GLM 5.3 completed a two-turn adversarial review using model `glm-5.3`. It found four specification blockers, all now incorporated: depth-scoped keys, locked evidence floors, removal of historical-MG contamination from the old draft, and exact five-outcome precedence. Its final verdict was that no blocker remains.
- GLM also required retiring the unreviewed hard-coded alias map, blocking generic-noun aliases, auditing post-change temporal shifts, recording singleton exceptions, and correcting the owner-approved source-data wording. These changes are in the plan.

## 4. Everything we tried that did NOT work

- Full-key-only matching mislabeled failures as MG01 failures and produced the rejected 9,155 count.
- Finite regex phrases plus provisional description prefixes contaminated product maps.
- A 25% word-overlap path created 2,091 fuzzy assignments and false-friend risk.
- Treating the current workbook as final would expose unreviewed product wording and unsupported recommendations.
- Adding more MG01 keyword rules, using historical MG values, or forcing the unresolved count toward 50 were rejected as circular or precision-destroying.
- Restarting review from 19,302 rows while ignoring the existing 750-phrase/216-family draft was rejected as wasteful; stopping at the 216 preliminary families was also rejected as incomplete.

## 5. Root causes and key findings

- The hierarchy is now correct, but vocabulary governance and assignment precision are not.
- `hierarchical_item_taxonomy.py:31-131` contains the finite phrase list.
- `extract_product_type()` at lines 184-194 emits provisional description fragments.
- `build_associations()` at lines 244-268 admits those fragments into teaching maps.
- `choose_at_level()` at lines 293-322 allows fuzzy live assignments, including a 25% MG01 threshold.
- `usable_description()` at lines 332-341 misses some tests, fees, `asst`, and material-only wording.
- Product, construction, and treatment must remain separate reviewed signature fields.
- Only accepted types and reviewed aliases may teach or receive proposals.
- The complete evidence, rejected alternatives, and exact plan are in Sections 5-9 of the linked plan.

## 6. Exact next steps

1. Commit and push only the plan, handoff, and necessary router links on `codex/item-taxonomy-plan`; open and merge a PR after CI passes. **Worked when:** `origin/main` contains the plan and issue #1097 links to it.
2. A new implementation session begins at Step 1 in the plan and updates its STATUS table after every step. **Worked when:** the first implementation commit cites its verification artifact rather than an unsupported count.

## 7. Constraints and gotchas in force

- Do not edit Item Master data, MG codes, `mgCategory`, or a database.
- Published sources remain tracked under the owner ruling. Keep new workbooks and row-level intermediate outputs under `.private/` and do not commit them.
- Historical MG values are display-only.
- Fuzzy matching may suggest review candidates but cannot assign or teach.
- Never invent child codes or optimize toward 50.
- Shared-db requires branch + PR; AI merges after checks pass.
- Do not rewrite `HANDOFF.md` or touch another session's handoff.
- Update the plan STATUS table whenever work executes.

## 8. Access and environment

- Repo: `C:\repos\shared-db`.
- Worktree: `C:\repos\shared-db\.agents\worktrees\item-taxonomy-plan`.
- Branch: `codex/item-taxonomy-plan`.
- `gh`, `git`, `ai-grok-review`, and `ai-glm` are available.
- No secrets are needed. If that changes, use 1Password vault `vibe_coding`; never record values.

## 9. Open questions and risks

- Depth-two meaning may differ by product class; the Step 1 axis audit must record the policy rather than assume MG02 always means construction.
- Post-change rows may contain transitional MG coding; quarantine monthly shifts before they teach.
- Removing fuzzy assignment will likely increase unresolved counts initially; do not weaken precision controls in response.
- The 750/216 draft is a seed, not accepted truth.
- Later accepted products with no analog may require the deferred owner ruling in Section 0.
- Installed skills may drift unless the ai-devops source-of-truth copies are updated.

## Self-audit

1. **Can a street-new developer continue without asking a question?** Yes. Sections 1-3 explain the application, objective, evidence, branch, issue, and exact current state; Section 6 gives ordered actions with proof gates.
2. **Can they continue as effectively as this session?** Yes. Sections 4-5 preserve every failed approach, file/function root cause, Grok correction, and current output status; the linked plan carries the full build specification.
3. **Are failed attempts included?** Yes, Section 4 records full-key-only matching, provisional regex fallback, fuzzy assignment, forced-coverage shortcuts, and dictionary restart/stop errors.
4. **Are next steps executable and verifiable?** Yes, every item in Section 6 ends with a worked-when gate.
5. **Are identifiers and paths defined?** Yes, Sections 1, 3, 5, and 8 define repo, worktree, branch, issue, commit, plan, files, and tools.
6. **Was the Section 0 sweep completed?** Yes. The only owner judgment anywhere in Sections 1-9 is whether definition-workbook MG01 may be used after a clean residual is quantified; it appears in Section 0 with a recommendation.

### Final synthesis

1. **Is this handoff comprehensive enough for a brand-new developer?** Yes; Sections 1-9 plus the linked plan provide the complete background, current state, failures, decisions, constraints, next actions, and verification.
2. **Can they continue as well as this session?** Yes; Sections 4-6 preserve the reasoning and exact operational sequence.
3. **Is every relevant detail present for flawless execution?** Yes; the handoff covers planning continuation, while the linked audited plan contains the full implementation specification and definition of done.
4. **Would Albert see every required decision from Section 0 alone?** Yes. The sweep found one deferred recoverable decision and it is listed with the recommendation to wait for clean evidence.
