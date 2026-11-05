---
issue: 680
status: BLOCKED
owner: codex/vb-search-step5
---

# Search scorecard and live-readiness custody

## 0. Business decisions only the owner can make

None. Albert already settled that unknown code-looking queries keep picture guesses, real catalog codes/prefixes are keyword-only, and genuine nonsense is empty. No human credentials, clicks or technical approval are needed. The coordinator retains merge, production, security and shared-schema decisions.

## 1. What this application is

PopDAM is POP Creations' artwork library; PopSG is its style-guide mode. Both use the same application source and shared Supabase backend. Frontends are https://dam.designflow.app and https://sg.designflow.app. Start with [AGENTS](https://github.com/u2giants/popdam3/blob/main/AGENTS.md), [vector plan](https://github.com/u2giants/popdam3/blob/main/plan_vector_consolidation.md) STATUS and [evaluation contract](https://github.com/u2giants/popdam3/blob/main/docs/SEARCH_EVAL.md).

## 2. Intended outcome

V-B owns Phase2 Step5: prove current ranking delivery, repair spelling on [#725](https://github.com/u2giants/popdam3/issues/725), run honest original119 BEFORE/AFTER plus missing-category supplementary checks, and post separate scores on existing [#680](https://github.com/u2giants/popdam3/issues/680) and [#706](https://github.com/u2giants/popdam3/issues/706). Completion requires ordinary-user live results, reliability and latency evidence; source delivery alone is insufficient. The coordinator's original whole-task handoff remains authoritative for other tracks; do not take their ownership.

## 3. Current state

[PR794](https://github.com/u2giants/popdam3/pull/794) merged at 8:15:02 AM EST on November5,2026, source [fc88ef0](https://github.com/u2giants/popdam3/commit/fc88ef0bcc2326fc10f975a0b2cdc17772a74f6e). Exact premerge head aa23af19 had all16 native checks successful/skipped; 73 focused behavior/contract tests and17 evaluator tests passed. The deployed search function v38 was downloaded independently: all14 bundled source files hash-match the accepted source. [Native deployment42034105299](https://github.com/u2giants/popdam3/actions/runs/42034105299) deployed functions successfully, then FAILED type generation at8:22:55 AM EST: `failed to get typescript types: request timed out`. Do not infer whole-workflow success.

Both BEFORE partitions are terminal and preserved: original119 DAM/65 guides/65 files, plus a separate frozen21 DAM/3 guides/3 files supplement. The [observation](https://github.com/u2giants/popdam3/blob/codex/vb-search-observations/docs/verification/search-scorecard/2026-11-05-step5-observation.md) records aggregate results and immutable hashes. Original initial DAM96/119 with13errors; supplemental12/21 with5errors. Unjudged/latency failures remain. No historic pre-ranking baseline exists. The original run was never restarted; all supplementary cases were frozen before the supplement began.

AFTER is UNSTARTED, zero search calls. First ordinary-viewer readiness attempt failed at authentication's existing30second limit, verified8:21:08 AM EST; no browser was created, so no visible UI/Retry screenshot is claimed. Keep725 open. The coordinator independently observed a shared-backend connection incident; original V-A owns readonly diagnosis. Do not add database pressure or take over diagnosis.

V-B retains custody. The canonical business-rule [draft5678](https://github.com/popcre/shared-db/pull/5678) is preserved, held and unmerged; it changes only the settled Search subsection and preserves other Proposed statuses. The coordinator controls its eventual release. No shared schema, migration or data write was authored here; no structural claim was taken.

## 4. Failed approaches

Historical full-set evidence had expired viewer authentication, so it cannot serve as a clean historic ranking baseline. New observations use actual renewed ordinary-viewer auth.

An unshipped narrow unknown-code hint covered only6388/11247 current catalog rows. The replacement complete-format probe covered all93 observed format groups in private tests, but its actual bounded readonly full-miss EXPLAIN hit SQLSTATE57014 at1000ms. It was withheld without retry or timeout increase. All new intent hints were removed from794; deployed code/picture classification is preserved. Unknown short partials and the full owner policy remain unresolved; do not claim three examples settle the whole capability.

The failed probe used one batch: BEGIN READ ONLY, SET LOCAL statement_timeout1000ms, EXPLAIN ANALYZE, ROLLBACK. Since EXPLAIN failed, the trailing explicit rollback was not executed inside that batch. MCP driver/session cleanup is unverified and was disclosed to the coordinator for V-A's readonly diagnosis. Never blindly cancel another session or issue ad hoc production cleanup.

## 5. Findings and evidence

Earlier ranking repairs shared-db5612/5614 and issue5581 were reconciled against the live ledger and exact function-body hashes; they were already live before this task's baseline. Do not redo them. The backend project is qsllyeztdwjgirsysgai; current MCP get_project_url was independently verified correct, despite the obsolete old-project warning in app documentation.

The shipped repair reads canonical core name tables, bounds optional spelling to four word readers/sixteen distinct words/1500ms while preserving the full typed query, and returns503 for required embedding failure before partial results. Checkpoints bind phase/run/source/target/label/set hash and persist by exclusive protected temp creation plus rename. Same-run resume is allowed; BEFORE-to-AFTER reuse is refused.

Original119 and supplement21 stay separate. Unified judging preserves all existing visual judgments; absent text does not prove irrelevance. Unknown picture guesses remain unjudged unless actual evidence supports relevance. Natural tagging continued, and a separate database rollout committed7:31:09 AM EST during the original baseline. This is observational phased rollout evidence, never sole causal attribution to794. T2 source796 merged, but coordinator explicitly confirmed NO T2 production writes as of this hold. Stage3 delivery was unverified; do not invent its absence or completion.

## 6. Exact next steps

1. Resume this V-B owner after the coordinator reports an observable backend-health transition from V-A. Recheck native release state without rerunning deployment blindly. Gate: actual readiness evidence, not global provider status.
2. Run a bounded ordinary-viewer UI attempt, first authenticating normally and proving the actual new canonical spelling correction. Then verify a real catalog code returns real products without pictures, ordinary semantic search returns real results, and visible Search unavailable/Retry does not show false zero. Any browser-injected503 must be labeled simulation; the Retry must recover through the real unmocked route. Stop the long evaluation if readiness fails.
3. Run the EXACT saved119 cases serially with a fresh AFTER checkpoint identity bound to actual deployed source, then the EXACT frozen21 supplement serially. Preserve separate denominators. Observe per-engine checkpoint advancement; never sit30minutes without progress or restart blindly. No canonical evaluation-set writes.
4. Capture current data context and actual intervening production timestamps from the coordinator. Judge both runs using the same final private judgment sets, preserving original labels and unresolved evidence. Report errors/timeouts and success-only/overall latency, including8s DAM and3s PopSG budgets, separately from relevance.
5. Publish safe paired aggregates on680/706 and update canonical plan/report. Close725 only after its actual live need passes; do not close whole Step5 while latency/errors/unknown policy remain. Continue the unknown-policy repair under existing issues and coordinator scope; no new cache/registry/RPC/schema without a separately reviewed need.

## 7. Constraints

NEVER stop/restart/disable or reconfigure the original full tagging run, alter its model/concurrency/checkpoint/accepted receipts, or re-embed the library. T1 records/backups and other tracks' code are not ours. No parallel dam-search-ai owner. Root retains merge/production/schema decisions. Use own current-upstream worktrees and point-of-use task gates. No new production requests during the readiness hold. No secrets, licensed names, paths, private result identities or raw auth traffic in Git/issues.

## 8. Access and private custody

Existing1Password vibe_coding ordinary-viewer and shared-runtime entries already work through secret injection; never ask Albert for credentials. Store values only in protected process environment/files. Credentials were referenced, never printed, changed or rotated.

The original V-B worktree and new observational-docs worktree on hetz are intentionally retained. Protected temporary custody includes the exact original/supplement case files, immutable BEFORE raw/report/checkpoint copies, source proof/bundle, failed-readiness receipt, held probe patch and cost failure, plus prepared UI and serial AFTER helpers. These private artifacts have no public GitHub URL and must never be published. The coordinator retains their exact local locators and hashes; recover them from that custody, not by recreating a different query set. The main source branch was merged; the canonical rule draft remains unmerged.

## 9. Open risks and self-audit

Open: shared-backend readiness, native post-deploy type-generation failure, actual spelling/UI acceptance, both AFTER runs, unified final judgments, latency/relevance/errors, full unknown-code policy and canonical-rule draft delivery. No human business decision is pending. V-B owns acceptance; V-A owns incident diagnosis; coordinator owns release decisions.

Fresh-reader audit: application, goal and authority are in sections0–2; exact merged/deployed/failed/unstarted states and evidence are in3–5; executable continuation and acceptance gates are in6–8. Failed attempts, private custody, uncertain transaction cleanup, confounds and every outstanding item are explicit in4–9. All three completeness questions pass with those sections; no unstated business decision or completed outcome is inferred.

Resume prompt: Continue V-B on PopDAM Step5 using this handoff and the vector plan STATUS. Preserve the running tagging job. First obtain the coordinator's observable backend-readiness transition; then prove ordinary-viewer spelling/known-code/semantic/error-and-Retry behavior before starting the identical saved119 and separate21 AFTER partitions with fresh source-bound checkpoints. Keep725/680/706 open for unmet live acceptance and report actual errors, unjudged hits, latency and rollout confounds.
