---
issue: 1113
status: OPEN
owner: codex/issue-1113-item-taxonomy-implementation
---

# HANDOFF — Item Description taxonomy implementation (2026-08-17 12:40 UTC, al8960ofc/codex)

## 0. DECISIONS ONLY THE OWNER CAN MAKE

No decision blocks starting the implementation. After the clean exact-only rematch, Albert may need to decide whether an accepted historical product with no later analog may receive MG01 from `MerchGroup_Rework.xlsx`. Recommendation: do not decide until the residual group is quantified. This is already recorded in the plan.

Already settled: do not change MG01 or source data; do not use historical MG values as evidence; fuzzy similarity may suggest review candidates but may never assign an MG value.

## 1. What this application is

This is an offline analysis inside `u2giants/shared-db`. It parses Item Descriptions, learns product-to-merchandise-group relationships from items created May 14, 2025 or later, and proposes the deepest defensible MG01/MG02/MG03 classification for older items. It does not write to Supabase, Item Master, or production. The complete standalone build specification is [`../plan_item_description_mg_taxonomy_repair.md`](../plan_item_description_mg_taxonomy_repair.md).

## 2. What we set out to do and why

Issue #1097 requested a planning-only deliverable. PR #1098 merged the reviewed implementation plan. Issue #1113 now owns executing it: complete the reviewed product dictionary, remove fuzzy live assignment, rebuild clean depth-specific maps, prove precision, and regenerate the private review workbook.

## 3. Current state

Planning is complete and merged in commit `a1793c56` through PR #1098. All PR checks were green. Every implementation row in the plan STATUS table remains open. The current matcher still permits provisional phrases to teach maps and loose token overlap to populate proposals. No database, Item Master, or source-file mutation occurred.

## 4. Everything tried that did not work

The plan Section 7 contains the full dead-end record: full-key failure mislabeled as MG01 failure, historical codes as circular evidence, broader keyword rules, 25% word overlap, provisional later phrases as teachers, reviewing all rows from scratch, accepting the preliminary 216 families, collapsing treatment, forcing a target count, and treating the audit workbook as final. Do not retry them.

## 5. Root causes and key findings

Independent depth maps fixed the first hierarchy error. The remaining root cause is an ungoverned vocabulary plus live fuzzy assignment. The existing draft dictionary is useful seed evidence but not approved truth. Product, construction, and treatment must remain separate. Only accepted dictionary entries and reviewed aliases may teach or receive assignments. See plan Sections 5-8 for code locations, measured exposure, locked decisions, and evidence floors.

## 6. Exact next steps

1. Open the plan and start at STATUS Step 1. Reproduce the baseline using the commands in Phase 1. Success means the committed sources reproduce the documented totals and private outputs remain ignored.
2. Execute Phases 2-6 in order, updating the STATUS table after each completed gate. Each plan step names exact files, functions, tests, and success evidence.
3. Use fresh sessions at the plan's marked context cuts and reread downstream phases before continuing.
4. Close issue #1113 only after every Definition of Done checkbox passes, the PR is merged, CI is green, and private outputs remain uncommitted.

## 7. Constraints and gotchas

No database migration or database write. No Item Master or source CSV/XLSX mutation. Generated row-level workbooks stay under ignored `.private/` paths. May 14, 2025 is the inclusive teaching cutoff. Historical MG values are display-only. Fuzzy suggestions cannot populate assignment fields. Unsupported children remain blank. Precision is judged before coverage, and approximately 50 unresolved rows is an alarm, not a quota.

## 8. Access and environment

Repository: `C:\repos\shared-db`. Machine: `al8960ofc`. GitHub CLI is authenticated for `u2giants/shared-db`. Bundled Python is documented in plan Section 12. No secrets are required. If that changes, credentials belong only in 1Password vault `vibe_coding`, never in files or chat.

## 9. Open questions and risks

Open implementation questions and the only deferred owner ruling are in plan Sections 8 and 13. Main risks are collapsing real treatment distinctions, accepting artwork-like wording, optimizing for coverage, contaminated seed families, later products with no historical analog, and skill copies drifting apart.

## Self-audit

Yes, a new developer can continue without this chat: Sections 1-3 define the system, goal, and exact state; Sections 4-5 preserve failed attempts and root causes; Section 6 points to executable steps with gates; Sections 7-9 cover constraints, access, risks, and the only possible owner decision. Every obligation is also preserved in the linked 13-section plan. The Section 0 sweep found no other owner decision. The predecessor handoff was retired only after its planning obligation merged and every future obligation was carried into this handoff and the plan.
