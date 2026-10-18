---
issue: 107
status: BLOCKED
owner: codex/01a14ff9-ffe1-7bd0-af94-79af01b95f1c
---

# PopSG sequential coordinator — preserved native recovery

## 0. Business decisions only the owner can make

None. Albert authorized the coordinator to finish database work and then **all** remaining PopSG #107 obligations, using sequential implementation subagents. He wrote: “Resolve existing ownership only through the current native recovery/release/accepted-transfer route.” and “the coordinator acts on authorized recovery”. Never request technical permission, impersonate an old owner, infer custody from expiration, or reduce existing search capabilities. No business choice is hidden below.

## 1. Application context

PopSG is the licensed style-guide library at [sg.designflow.app](https://sg.designflow.app), sharing frontend/edge/worker runtime with PopDAM. App source is [u2giants/popdam3](https://github.com/u2giants/popdam3); canonical shared schema is [popcre/shared-db](https://github.com/popcre/shared-db). Virginia production is `qsllyeztdwjgirsysgai`; Ohio is retired. GitHub owns source, Coolify frontend, Supabase edge/database, Railway worker. NAS reads use the canonical read-side topology; licensed paths stay private.

## 2. Objective and authorization

Database implementation worker first reconciles [repair #4210](https://github.com/popcre/shared-db/issues/4210)/[protected claim #4212](https://github.com/popcre/shared-db/issues/4212), then authors [semantic contract #4437](https://github.com/popcre/shared-db/issues/4437). Root retains schema/security decisions, reviews, merges, production actions and independent final verification. Only after required contracts are live-proven and first-worker custody is natively released/accepted may a **different** application worker complete [#107](https://github.com/u2giants/popdam3/issues/107). Do not stop at semantic search or discard PDF/source, crawl, previews, settings, fallback, observation and rollback obligations.

Read the approved [combined semantic plan](https://github.com/u2giants/popdam3/blob/main/plan_semantic_search_popdam_popsg.md), [production-readiness plan](https://github.com/u2giants/popdam3/blob/main/plan_popsg_production_readiness.md) and [planning handoff](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-18T1632Z-hetz-codex-semantic-search-plan.md), plus current comments/rulebooks. Use pgvector/HNSW, exact identifiers, full counts/facets/paging and caller-scoped access.

## 3. Current state

[PR #422](https://github.com/u2giants/popdam3/pull/422) merged as [f6273c5bdb9dbd9a7e7447ee79a93cd394f18a3c](https://github.com/u2giants/popdam3/commit/f6273c5bdb9dbd9a7e7447ee79a93cd394f18a3c). [Refreshed baseline](https://github.com/u2giants/popdam3/blob/main/docs/verification/popsg-coordinator-20261018.md) records source, production identity, aggregates and their limits. Original canonical inspection head: [e5e6245e7cf7708ef47fe613f372c2f50e821309](https://github.com/popcre/shared-db/commit/e5e6245e7cf7708ef47fe613f372c2f50e821309). Refresh all moving facts before continuation.

Read-only production proof at approximately 1:05–1:08 PM EDT October 18: repair `20261012005136` **absent**; SG documents have no embedding/lease columns. Active files 220,676, non-null previews 218,457, difference 2,219 unclassified by this session. Active PDFs 4,391: 4,077 extracted, 312 skipped, 2 missing. Current identity/freshness and terminal reasons remain to verify. Seven ordinary October 11–17 crawls completed with guard ok/zero stale remainder; changed-night/source acceptance remains unproven here. These refreshed facts supersede counts, not acceptance requirements or protected-operation instructions.

One database subagent was spawned: actual worker `01a14ffa-6ae0-75c1-b984-2135cc659938`; it prepared no migration and made no database/production mutation. It created the required exact [native recovery audit #4442](https://github.com/popcre/shared-db/issues/4442) and an independent clean source clone at PR #4213 head `c208d24c8592ba51a310bf6e10fb014c64498ba0`, original branch. Original worktrees are untouched. Exact custody details remain in #4442/#4212, not guessed from local copies. No application worker has been spawned; its prerequisite failed.

## 4. Failed attempts and exclusions

Native expired-merged adoption through the current canonical entry point was refused, exit 1:

> refs/db-coordination/author-acquisition remained occupied at 5ff471f2192fae901bd3726774661e5cc32e1fbb; inspect it and use --recover-author-mutex with that exact SHA only if it is stale

No accepted adoption receipt or claim mutation resulted. Holder commit message:

> db-coordination reviewer-assignment-lock issue=4395 pr=4396 head=4942faa9b1652dabf8858056ccb0c0ca336f544a

GitHub timestamp: October 18, 2026, 1:07:47 PM EDT. [#4395](https://github.com/popcre/shared-db/issues/4395) names MiMo's handoff-hygiene work; its current contract was published at 12:57:56 PM EDT, with Windows custody. Remote process liveness is unverified. Minimum-age eligibility is not independent proof the holder is dead; no foreign lock was deleted or recovered solely from age. Native bounded recovery workflow exists but requires an honest stale determination.

Ordinary voluntary handoff has no #4212 ready receipt. Expiry/merged PR/Claude's “can release” evaluation do not transfer ownership. Completed-foreign-release code is narrowly scoped to a different issue and cannot release #4212. Do not fabricate a ready receipt, recreate an original remote path, declare unknown custody clean, or manually edit claim fences.

The first read-only PDF query referenced nonexistent `extension`; corrected filename-suffix query succeeded. Task-class name `documentation` was rejected; actual classes are `prose` and protected `reviewer-safety` for handoff/plan paths. These were local non-mutating preparation errors, not production failures.

## 5. Findings and native routes

Current canonical [anti-collision rules](https://github.com/popcre/shared-db/blob/main/docs/agents/section-4-anti-collision-rules.md) include explicit **expired merged-source custody recovery** via [transfer entry point](https://github.com/popcre/shared-db/blob/main/scripts/transfer-expired-merged-claim-author.mjs). The operator must prove exact open repository-maintenance abandonment audit, original identity/head, preserved remote artifact, current real chat authority, clean successor at original source branch/head, permanent reservation, objects, main ancestry and no foreign exclusive stages. #4442 provides the required audit; it is not a replacement feature or live-proof card.

The original chat was inspected read-only; its last turn says wrap-up/stopped execution. Remote original uncommitted state/current process is not independently known. Original recorded remote custody and an older untouched local source copy differ; preserve both honestly.

The historical claim that a merged PR cannot get another risk review is stale. [Production procedure](https://github.com/popcre/shared-db/blob/main/docs/production-promotion-procedure.md) explicitly supports allocator-assigned fresh review slots on merged exact source for the required `production-risk-assessment`. Fresh review must bind current main/ordered versions/source PR and all flagged classes. No hand-built production dispatch is authorized.

## 6. Exact next steps and gates

1. Refresh original owner/claim, #4442, MiMo #4395/PR #4396 and exact mutex. If normally released, rerun native adoption with fresh actual recipient/current authority. If genuinely stale, use only the exact native serialized recovery workflow after proving its criteria. Gate: accepted immutable adoption receipt plus changed claim readback, permanent reservation preserved; no foreign lock bypass.
2. Coordinator independently verifies that receipt and confirms authorized repair scope. Actual new owner checks in natively before protected work. Obtain fresh allocator review at merged source with complete risk fence, then prepare the existing native preview dispatch and recheck selector/preview ledger. Gate: accepted review and current stored dispatch instruction, not historical green artifacts.
3. Root launches only the approved merged-preview route after task gates. Let its independent automatic production checks act. Independently prove ledger, exact definition/privileges and signed-in keyword/search/filter/page/count behavior. Gate: repair actually live and protected original claim natively released/accepted.
4. Database worker finalizes exact #4437 objects for storage/digest/freshness/leases/caller search. Root owns design/security; reserve versions, author/test, independent review, preview parity, guarded merge, automatic promotion. Gate: live target/catalog/permission and keyword parity evidence, then native worker custody cleanup.
5. Spawn a **different** application implementation worker for the entire remaining #107 scope. Preserve DAM shared-runtime ownership and separate settings; do not make DAM #97 completion a prerequisite. Gate: source/tests/review/merge, frontend/edge/worker deployment, saved-row coverage, role journeys, exact counts/facets/stable pages, keyword fallback, freshness and rollback.
6. Complete approved 24-hour observation including ordinary refresh; evaluate existing crawl/source/PDF evidence freshly. Gate: every #107 outcome live-proven before closure; incomplete proof remains on the same issue with named owner.

## 7. Constraints and gotchas

No app-side DDL, privileged ranking shortcut, timeout increase, top-K fake totals, corpus scope reduction or unsupported index change. No DAM switch changes or protected tagging side effects. Preserve no-rotation/no-original-ambiguous-operation-recovery directions; never duplicate paid tagging. PDF status aggregates do not authorize resetting old cohorts. Read current issue directions rather than stale credential notes.

Every writer uses isolated current-upstream custody; merged-source recovery's exact historical-head clone is deliberately distinct from fresh authoring. Preserve foreign dirty files/worktrees. Prose shipping is different from runtime delivery. Do not retire predecessor handoffs: their obligations are not delivered.

## 8. Access, evidence and cleanup

GitHub read/write, app prose PR merge, read-only Supabase management API and protected 1Password injection worked. Credentials remain in vault `vibe_coding`; token item is `Supabase CLI Personal Access Token`. No new secret, rotation or exposed value arose. Root/worker closeout results and final blocker publication belong in current #107/#4437/#4442 comments.

Root's dedicated application worktree and worker's current-upstream investigation worktree/source-head recovery clone are intentionally retained for continuation. Exact machine custody is in #4442 and native claim records. No destructive cleanup; all older/concurrent work preserved. No background continuation is promised at stop. Native checker must use each actor's actual session UUID; report its real result, never substitute a predecessor identity.

## 9. Open risks and decision sweep

Immediate external holder is MiMo's #4395 reviewer-assignment operation, last verified lock action 1:07:47 PM EDT October 18; process activity unverified. Coordinator owns tracking/rechecking the existing PopSG issues and resuming ready work when safe. Feature remains blocked, not completed. Native recovery/audit source is not live delivery. No technical/business approval is needed from Albert.

All ten sections are present; failed routes, current source, moving facts, real identities, exact refusal, next gates, access and protected operations are explicit. The approved plans retain detailed schema/runtime/tests/acceptance requirements. No schema/application implementation, paid tagging run, production mutation or claim release occurred in this blocked stage.
