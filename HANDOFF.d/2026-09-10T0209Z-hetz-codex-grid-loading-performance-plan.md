---
issue: 121
status: OPEN
owner: codex/grid-loading-performance-plan-121
---

# Grid loading-performance plan handoff

Plan: [`../plan_master_data_orderlist_loading_performance.md`](../plan_master_data_orderlist_loading_performance.md)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

One later decision is required: after shared-db #2665 passes preview, Albert must explicitly approve applying that exact migration/function to production. Recommendation: approve only when SQL tests, low-privilege permission proof, query plan and parity with the old lookup all pass. This blocks OrderList production integration, not Master Data work.

Already settled — do not re-ask: on 2026-09-10 Albert requested one plan for all three improvements and selected first-4,000 rendering, unused-field reduction and a governed OrderList lookup. The next session must put the whole owner-decision list above to Albert in one message before any production database apply, not raise decisions one at a time.

## 1. What this application is

PopDAM (`u2giants/popdam3`, `/worksp/popdam`) is POP Creations' internal digital asset manager. React/Vite/AG Grid pages `/styles` and `/orders` run at `https://dam.designflow.app`. They share Supabase with other POP apps; database structure belongs to `u2giants/shared-db` and its single orchestrator.

## 2. What we set out to do this session, and why

Albert asked for a standalone implementation plan to make the grids feel faster without losing completeness: display Master Data's first 4,000 rows immediately, stop downloading unused Master Data fields, and replace OrderList Find's up-to-25-request ID-position scan with a small governed lookup.

## 3. Current state — what is true right now

The complete plan is written and linked from the router and topic docs. No implementation step has started. PopDAM behavior preceding the plan is committed/pushed/deployed at `629670862af0204d6640393c03e31c81baf1b8f4`. PopDAM tracking issue #121 and shared-db structural issue #2665 are open. The plan STATUS table says a fresh session begins at Step 1.

## 4. Everything we tried that did NOT work

No implementation was attempted. The plan records rejected designs: waiting for the full Master Data load, increasing concurrency without progressive rendering, infinite/server-side Master Data, deferring required JSON fields, client-side AG Grid Find for infinite OrderList, retaining the multi-request ID scan, unchecked dynamic SQL, rejoining row/count queries, and timeout/error suppression.

## 5. Root causes and key findings

`StylesPage.tsx` already downloads four 1,000-row ranges concurrently but withholds them until every wave finishes. Its `.select("*")` also downloads at least thirteen view fields the page does not consume. OrderList is correctly bounded for normal browsing, but `useOrderList.ts` Find discovers an index by downloading every preceding order-line ID; PostgreSQL can compute the same row number in one invoker-secure call.

## 6. Exact next steps

1. Execute plan Step 1 and save sanitized cold-cache baselines. You'll know it worked when the evidence README contains reproducible timing/request/byte measures.
2. Execute Steps 2–3 together in PopDAM, adding progressive-query and projection tests. You'll know it worked when delayed later pages still leave 4,000 usable rows and payload fields/bytes are reduced without behavioral loss.
3. Let the current shared-db orchestrator dispatch issue #2665 in its own worktree. You'll know it worked when the new RPC is preview-proven, reviewed and merged with artifact-backed STATUS evidence.
4. Obtain Albert's exact production-apply approval, promote and verify the migration, then execute Step 5 app integration. You'll know it worked when one RPC locates a late match under active filters/sort.
5. Execute Step 6, deploy, visually verify and close both issues only after production acceptance. You'll know it worked when the plan STATUS table links the CI, SHAs, traces and screenshots and this handoff can be deleted.

## 7. Constraints and gotchas in force

PopDAM is direct-to-main; shared-db is orchestrator/worktree/branch/preview/PR/AI-merge. No PopDAM migration, direct SQL, generated-type edit, timeout increase, broad staging, force push, capability loss or secret exposure. Preserve Master Data full-tab client-side behavior and OrderList infinite loading. Label partial Master Data honestly. Production DB apply requires exact approval and immediate target proof.

## 8. Access and environment

GitHub CLI is authenticated; issues are PopDAM #121 and shared-db #2665. App commands and URLs are in plan Section 12. Database CLI/password items live in 1Password vault `vibe_coding`; the plan names item titles but contains no values. Production project is Virginia `qsllyeztdwjgirsysgai`, never retired Ohio.

## 9. Open questions and risks

Only the production apply approval in Section 0 is open. Implementation choice between SQL-language and PL/pgSQL is deliberately left to the shared-db implementer under locked security/performance criteria. Main risks are partial-data misconception, page races/duplication, projection omissions, RPC semantic drift, injection and deployment skew; plan Section 13 defines mitigations and rollback.

### Handoff self-audit — PASSED

1. A newcomer can continue without context: Sections 1–3 define the system, goal and exact state; Section 6 points to executable plan steps and gates.
2. They can continue as effectively as this session: Sections 4–5 preserve rejected paths and root causes; Sections 7–9 preserve constraints, access, risks and judgment boundaries.
3. Every execution detail is carried in the reciprocal plan, while this handoff covers all ten required sections, status, SHAs, issues and next actions.
4. Owner-decision sweep passed: the only owner judgment in Sections 1–9 is the exact production apply approval, and it appears in Section 0 with recommendation and blocking consequence.
