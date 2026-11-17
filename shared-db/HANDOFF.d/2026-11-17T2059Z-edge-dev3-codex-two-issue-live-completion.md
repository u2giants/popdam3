---
issue: 5610
related_issues: 5609,5747
status: OPEN
owner: codex/01a1a9c5-d9e1-7160-ac26-ed9dac540870
---
# Finish asset-save acceptance and unused-index cleanup

This is the November 17, 2026 portable continuation for the two remaining issues. It supersedes this chat's November 5–6 local continuity drafts as execution guidance. GitHub issues and freshly fetched source remain authoritative. A new session has been requested, but no successor has yet accepted any native ownership. No background wake-up has been configured.

## 0. Business decisions only the owner can make

None are currently identified. The next session handles access, tooling, technical decisions, fixes, merging and production verification itself. If a genuinely new business question emerges, state its impact and recommendation once. Review the whole handoff before raising a question.

Already settled by Albert in this chat:

- Original scope was to finish issues [5609](https://github.com/popcre/shared-db/issues/5609) and [5610](https://github.com/popcre/shared-db/issues/5610), including real acceptance. Supporting code, green CI and elapsed time alone do not close either issue.
- His latest instruction is verbatim: “and give me a prompt to establish a new session as coordinator and have it spin up subagents to finish #5609 and #5610 using the reconciled plans. don't stop until they're 100% complete, including live proof.” This explicitly authorizes a task coordinator and two subagents. It does not restore the retired shared-db orchestrator, marker or approval route.
- His earlier “there's no coordinator” correction caused the obsolete standing assignment to be removed. The new coordinator is a lead for this explicitly requested task. It must execute and verify, not introduce another intake or permission dependency.
- No human technical approvals, command execution, credential setup or merge step belongs to Albert. Preserve capability and repair the actual problem.

## 1. What this application is

[Shared-db](https://github.com/popcre/shared-db) owns the shared database structure used by POP DAM, CRM, PIM and DesignFlow. [POP DAM](https://github.com/u2giants/popdam3) ingests and tags the artwork/file catalogue and maintains search documents and style-group thumbnails. Frequent writes can cause redundant search/thumbnail work and consume database write bandwidth. Unused large indexes also increase storage and write cost, but a mistaken removal can harm searches or background workers.

Start with the current [AGENTS guide](https://github.com/popcre/shared-db/blob/main/AGENTS.md), [current route](https://github.com/popcre/shared-db/blob/main/docs/agents/current-workflow.md), [merge protocol](https://github.com/popcre/shared-db/blob/main/docs/agents/merge-protocol.md), and [worktree/handoff rules](https://github.com/popcre/shared-db/blob/main/docs/agents/worktrees-and-handoffs.md). Load only task-relevant chapters. Do not execute old author-lane commands copied into historical notes.

## 2. Goal and completion contract

The next lead starts from current upstream main in isolated worktrees, spawns one subagent per issue, verifies both, and continues through actual production acceptance. The lead owns design, schema, security, merge and production decisions. Subagents return completed scoped work or exact blockers, with original evidence. Preparation does not finish an issue. Resume ready work when dependencies clear, repair recoverable failures, and keep monitoring in the active task when a genuine interval must elapse. Never promise unattended execution that the client does not provide.

Read the reconciled [asset trigger plan](https://github.com/popcre/shared-db/blob/main/plan_assets-update-trigger-scoping.md), [unused-index plan](https://github.com/popcre/shared-db/blob/main/plan_unused-index-cleanup.md), and [broader assets-bloat plan](https://github.com/popcre/shared-db/blob/main/plan_assets-bloat-permanent-fix.md) before assigning work.

For #5609, completion requires valid current correctness and performance evidence satisfying the plan, the supported production live-proof artifact, accurate plan/checklist updates and verified closure on the same issue. For #5610, completion requires trustworthy observation and complete consumer/planned-use proof for each eligible candidate, justified keep/drop decisions, delivery of any supported removals through the normal lane, and the required production no-regression proof. The current source has a committed #5609 SQL acceptance probe and no committed #5610 probe. As part of justified #5610 implementation, provide the required read-only catalog/storage/consumer and 24-hour no-regression proof through the current supported verification route. Do not dispatch a nonexistent probe and infer success. A measured zero-safe-drops conclusion must explicitly resolve the original scope and be documented as such. Never manufacture a removal quota or silently mark unexecuted migration steps done.

## 3. Current state and delivered evidence

### Reconciliation is actually published

[PR 6604](https://github.com/popcre/shared-db/pull/6604) is MERGED as [daa8ac5908465852f1bea8e769c562af9b4a055f](https://github.com/popcre/shared-db/commit/daa8ac5908465852f1bea8e769c562af9b4a055f). The lead compared all four published blobs with the reviewed source. Both issue bodies were updated and read back exactly, with existing signatures and live-proof items preserved. Public-boundary/local-link checks and historical inventory byte comparison passed. Document-health had 16 pre-existing faults and zero introduced by this change.

The split is exact. #5610 owns its existing listed assets.tags/full-text pair under the existing 50 MB cutoff and observation/consumer criteria. #5747 Step 3 consumes the same evidence, decision and delivery once. #5747 retains the wider assets inventory, including other indexes and those below #5610's size cutoff. #5610 retains style-guide and conditional HTS work. The [historical 46-index inventory](https://github.com/popcre/shared-db/blob/main/docs/verification/assets-bloat-5747/20261105T2345Z/index-audit.md) is preserved under a superseding banner. The old November 18 date is invalid.

### #5609 is implemented, with acceptance still open

The trigger-scoping migration was delivered through [PR 5618](https://github.com/popcre/shared-db/pull/5618). The original apply's catalog verification failure and supported verification-only recovery are recorded on [5609](https://github.com/popcre/shared-db/issues/5609). Do not replay applied SQL. App no-op ingest work and thumbnail-cache repair also landed. [App proof](https://github.com/u2giants/popdam3/blob/5f6bc7191794355d59f63806dbd23a61ba8510e8/docs/verification/5609-primary-cache-repair.md) preserves the 1,214 confirmed cache repairs, partial failures and concurrency limits. App PR 841 fixed render-completion cache updates, while app PR 825 already removed ingest no-op PATCH work. Verify current versions before proposing more changes.

The original hosted WAL improvement was 33.08% against 50% required. The last valid November 6 interim was 2,638 genuine calls, mean 38.0386274211523882 ms and 63,729.535253980288 WAL bytes/call against the strict ceiling approximately 29,548.582514. Those are historical failures, not new measurements or a whole-period pass. Three post-opening metadata samples, ten exact bindings, image/read access and zero thumbnail drift passed then.

The selected opening was November 6, 2026, 12:04:19.556744 PM EST, exactly 50 unfiltered original-prefix tuples with sorted typed MD5 3a2faf721ab577a88117acfbd14407ce. [Opening receipt](https://github.com/popcre/shared-db/blob/main/docs/verification/issue-5609-trigger-acceptance/20261106-second-restart-opening.md). The current [committed acceptance SQL](https://github.com/popcre/shared-db/blob/main/.github/live-proofs/5609.sql) binds this vector and the preserved stricter original PRE references. The first [failed probe](https://github.com/popcre/shared-db/blob/main/docs/verification/issue-5609-trigger-acceptance/5609-original-failed-window.sql) and [second failed probe](https://github.com/popcre/shared-db/blob/main/docs/verification/issue-5609-trigger-acceptance/5609-second-failed-window.sql) remain history. [Preparation guidance](https://github.com/popcre/shared-db/blob/main/docs/verification/issue-5609-trigger-acceptance/successor-probe-preparation.md) explains the frozen comparison.

November 17, 2:21 PM EST source/catalog check found both principal guarded UPDATE triggers still active. Postmaster start remained November 6, 11:20:19.434455 AM EST and statement reset remained November 6, 11:20:19.263334 AM EST, but statement deallocation had increased to 73. Therefore the old November 6 full-family acceptance window cannot establish a valid pass under its current controls. Eleven calendar days do not establish acceptance. Freshly diagnose and instrument a valid measurement after any necessary actual repair, using a predeclared source-pinned capture and the plan's current criteria. Do not select a favorable cohort or replacement opening to hide a failure.

### Actual preview and production writes, preserved for the next session

The protected hosted preview is a shared, populated rehearsal environment. Do not call it clean or empty. The original asset rehearsal exercised synthetic no-op/mixed updates and derived state under the [hosted preview record](https://github.com/popcre/shared-db/blob/main/docs/verification/database-efficiency/20261105T033714Z/assets-trigger-scoping-hosted-preview.md) and [rehearsal record](https://github.com/popcre/shared-db/blob/main/docs/verification/database-efficiency/20261105T033714Z/assets-trigger-scoping-rehearsal.md). Prior results and rollback limits remain evidence.

For SKU v4, governed preview [42268869549](https://github.com/popcre/shared-db/actions/runs/42268869549) actually applied immutable source 20261106171924. One full and one unchanged preview invocation against existing observations committed legitimate derived history, with 754 eligible SKUs, 334 matching output links, zero pending keys, catchup self-removed and zero resolver locks at the final November 6 check. No synthetic hosted load was performed for those v4 calls. The [exact hosted receipt](https://github.com/popcre/shared-db/blob/main/docs/verification/database-efficiency/20261106-input-snapshot/hosted-preview-v4.json) preserves producer/artifact binding, full 6.911497s, unchanged 2.244536s, nine-column parity 0/0 and the original freeze-acquisition failure. The lead released its exact preview lease. Current shared preview contents and foreign rehearsal work must be refreshed before a future write.

Production database structure went through the existing automatic promotion route. This chat did not apply manual production DDL or manually CALL the production resolver. Its app-owned thumbnail-cache repairs changed actual application rows, with 1,214 confirmed updates and preserved partial/concurrent outcomes in the app receipt above. No general rollback or cleanup of those rows is authorized. Later production SKU acceptance was completed by another session and is already closed.

### #5610 observation and candidates remain open

[Second restart/opening receipt](https://github.com/popcre/shared-db/blob/main/docs/verification/issue-5610-index-observation/20261106-second-restart-window.md) records the measured opening November 6, 2026, 11:25:52.885243 AM EST. Conditional earliest eligibility is November 20 at the same time, for each unchanged candidate with continuous trustworthy counters and complete current consumer proof. A calendar date is insufficient. Additional #5747 inventory entries need their own supported interval. Statement deallocation invalidates the #5609 family proof, but does not itself reset index scan counters.

November 17, 2:21 PM EST read-only catalog snapshot, to be refreshed before decisions:

| Index | Bytes | Scans | Meaning |
|---|---:|---:|---|
| idx_sgf_directory_path_trgm | 120111104 | 0 | Conditional candidate, not removal proof |
| idx_style_guide_files_tag_search_trgm | 79896576 | 0 | Conditional candidate, not removal proof |
| idx_assets_full_text_search | 76824576 | 0 | Shared with #5747, conditional candidate |
| idx_assets_tags | 28311552 | 0 | Below #5610's 50 MB cutoff, retained in #5747 broader inventory |

All eleven observed indexes were valid/ready. Ten original OIDs/definitions matched the November 6 record. The positive-KEEP AI-tag candidate index was intentionally rebuilt by [the cover-tier migration](https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261110192227_dam_cover_tier_comp_files.sql), issue [6011](https://github.com/popcre/shared-db/issues/6011), and has 4 observed reads. Its rebuild affects its own identity, not unrelated candidates. Existing positive KEEP decisions remain binding for that index, the style-guide tag/status index (now 3,040 reads), and the old DAM claim index (now 2 reads). Keep all protected vector indexes even where scans are zero.

The prior [nine-consumer positive-reader inspection](https://github.com/popcre/shared-db/issues/5610#issuecomment-6690134767) is limited evidence, with saturated search/HTTP429 and inaccessible/truncated-search caveats. It is not comprehensive absence. Refresh every consumer in the current sync matrix and every SQL/view/function/RLS/planned-use dependency before a drop decision.

### Completed SKU work and broader context

[5608](https://github.com/popcre/shared-db/issues/5608) is CLOSED with production live proof, recorded in [the final SKU plan](https://github.com/popcre/shared-db/blob/main/plan_sku-style-guide-link-job.md) and [official live-proof run](https://github.com/popcre/shared-db/actions/runs/43147565616). November 17's bounded check found seven final-tagged successful nightly runs under 60 seconds in the last week. Do not assign a third worker to reimplement it.

#5747's [November 16 weekly reading](https://github.com/popcre/shared-db/blob/main/docs/verification/assets-bloat-5747/20261105T2331Z/weekly-health-20261116.md) shows heap/live 1.82, under its 2.0 limit, and 836 MB of indexes. Its other delivered fixes and proof remain delivered. An unfinished overlapping audit is not grounds to undo them.

## 4. Failed attempts and what not to repeat

- Production/preview source verification originally failed for SKU prerequisite/order and exact body fingerprints. The resolved #5608 source remains applied and immutable. Its historical renewed-but-unused versions are not available for reuse.
- #5609's hosted 33.08% WAL result and later full-family interim deficits remain failures. Changing traffic composition prevents unsupported per-asset causal conclusions. The last diagnosis did not establish another redundant writer with enough evidence to justify speculative changes.
- Two previous asset windows failed restart/deallocation continuity. The current old window also fails its deallocation guard. Do not subtract counters across resets or claim a historical interval passed because it is old.
- A metadata mismatch was a proof bug. The deployed producer clears lease token/owner/expiry but can retain a known lowercase 64-hex input hash. The corrected probe accepts that exact supported state while rejecting partial leases, malformed/unknown fields and changed input/render/core data. Do not erase valid producer state to force a test pass.
- Whole-batch cache repair partially failed before the protected, bounded app route completed 1,214 confirmed repairs. Preserve partial/unknown outcomes and concurrent legitimate edits. Re-running the whole repair risks clobbering newer application data.
- Zero index scans over a short/reset interval, a column-name hit on another relation, or absence from a failed/truncated source search never proved safe removal. Historical positive KEEP survives counter reset.
- Earlier queue instructions using admin/squash were refused. Normal merge queue is the current route. AI review is advisory. Keep required safety/production guards.
- The unreconciled #5747 Step 3 taught an obsolete November 18 date and duplicate asset work. PR 6604 corrected it. Do not restore that date or recreate a second asset audit.

## 5. Root causes and evidence boundaries

Relevant no-op changes formerly triggered wide derived-search and thumbnail work. Trigger guards and app sparse updates address distinct costs, and both remain useful in the current strategy. A row update can still legitimately cost WAL because it changes indexed fields; diagnose the actual writer, query, values and workload before editing.

The unused-index observation is per exact index identity and actual supported counter history. A rebuilt KEEP index is not a global restart. Size and observed use can change scope at the decision. The shared asset pair has one execution record, while the broader #5747 inventory remains a separate residual scope.

Sources and checks dated above are snapshots. Current database heads, progress, job state, issue status, index identities and code paths must be re-proved. Native source maximum at wrap-up was migration version 20261204000900, a filename/reservation horizon, not the client calendar date. Use the current native version-reservation route; do not hand-stamp a backdated version.

## 6. Exact next steps and verification gates

1. Establish the requested task lead. Read this file, current AGENTS/router, both current issues and all three plans. Refresh upstream main, consumers, native claims/stages and parked/held promotions. Scope your isolated worktrees from current main, not an old draft. Success means exact current source and ownership are recorded on the same issues.
2. Spawn exactly the two primary workstreams requested by Albert. Give one subagent #5609 and another #5610. Follow available model-tier guidance for helper-ok mechanical work. Lead-only technical decisions stay with the lead. Verify fresh actual agent status before reporting activity. Success means each agent returns finished work or a concrete blocker with verbatim evidence, and the lead acts on actionable blockers rather than ending a phase.
3. #5609 worker first audits deployed producers, trigger/metadata contracts and performance methodology against current app code and actual traffic. Reuse delivered fixes. Preserve original thresholds and failed receipts. If a prior assumption/test is demonstrably incorrect or superseded, correct the source transparently with evidence instead of maintaining an accidental blocker. A threshold cannot be changed merely to obtain a pass. Success means a supported diagnosis and any necessary normal app/schema delivery have actually removed the remaining reported defect while original functionality still works.
4. Establish or validate the #5609 measurement under the current plan after actual repair. Use complete authentic observations, explicit source/target binding, genuine traffic, current metadata/thumbnail/access checks, unchanged relevant counter identities, and the full required day and call count. Success means every current acceptance condition passes and an official production live-proof artifact from the [supported workflow](https://github.com/popcre/shared-db/blob/main/.github/workflows/shared-db-live-proof.yml) binds the exact source and issue. A green functional fragment alone cannot close #5609.
5. #5610 worker may do current consumer and positive-reader work now. At each candidate's valid full observation, recheck exact definitions/OIDs, sizes, scans, reset/postmaster identity, dependencies and planned use. Refresh the current consumer sync matrix. Keep observed readers and protected indexes. Shared asset work is done once and consumed by #5747. Success means each in-scope decision is justified by complete evidence, including any no-safe-drops conclusion.
6. If removals are genuinely justified, claim exact objects on #5610, reserve a fresh native version, preserve recreate definitions and author a new minimum migration/tests. Follow the current [automatic promotion workflow](https://github.com/popcre/shared-db/blob/main/.github/workflows/shared-supabase-migrations.yml) with qualified preview and exact production result. No manual production SQL. Success means actual target catalog/ledger and freed storage are verified, with required consumer functionality preserved and at least 24 hours of actual no-regression evidence. Reuse this single shared delivery record on #5747.
7. Independently verify every final artifact and every checklist against original business outcomes. Update current plans and the same issues. Close each only when its complete scope and live proof are satisfied. Continue after one worker finishes. Keep checking genuine time gates in the active task where supported, and retain exact owner/blocker/next action if an external dependency truly prevents further progress. Do not label an interim state 100% or end merely on “monitoring.”

## 7. Constraints and gotchas

Structural work uses shared-db first, own worktrees, exact object ownership, current native coordination, protected target identity before each operation, preview rehearsal and the existing automatic production lane. Ordinary app row data remains app-owned. Curated outside Master Data stays governed. Read-only inspection is allowed. Never lower capability, remove safety/proof checks to hide a failure, reset statistics to make a window convenient, generate favorable traffic, reapply historical SQL, raise timeouts, or touch foreign ownership.

Use GitHub for truth. Never use Entire. Never ask Albert for technical approval, commands, keys or merging. Paid AI reviews are optional advice, not a progress dependency. Use the installed bounded event-aware PR waiter and repair/reroute a genuinely stuck helper or queue. Do not inherit retired route/claim commands from an old note. Check present implementation before an action. Preserve unsupported conclusions as unresolved.

## 8. Access, source and custody

The repository origin is [popcre/shared-db](https://github.com/popcre/shared-db), and the successor starts from freshly fetched main. GitHub CLI and the Supabase read-only connector were usable on edge-dev3. The connected project can be production; call the identity tool and compare against the protected configuration before each database operation. Secrets stay in vault vibe_coding, resolved through supported protected injection. Existing app runtime credential item 3hhxwrljnaq2tykxi7hplq5ryi is a lookup reference, never a value. Do not print credentials or place them in arguments, transcripts or commits.

All licensed/raw observations remain in the existing private evidence custody on edge-dev3. Portable sanitized summaries, hashes and producer references are on the existing issues and the linked receipts. Re-acquire aggregate read-only facts through native tools if moving machines; never publish the licensed rows or run fixtures against hosted production.

Local custody decision: retain historical source/recovery worktrees and branches rather than delete uncertain evidence. Several old temporary worktrees now show tracked review-file or historical-migration deletions not authored in this closeout; treat them as protected foreign/unknown changes. No bulk staging, resetting or cleanup is authorized. The original Codex app checkout remains clean. The reconciliation source worktree and local branch codex/5610-5747-one-index-audit were retired after actual merged-PR, exact-blob, clean/ignored-file and finished-agent proofs. Its remote branch was already absent. Historical source and dirty/uncertain worktrees remain preserved.

Six old local draft entries on codex/5608-5610-continuity-docs remain explicitly UNPUBLISHED and deliberately retained for recovery. Their November 5-era AGENTS and plan edits are stale and must never overwrite current main. The intended, currently unpublished draft locations are [AGENTS](https://github.com/popcre/shared-db/blob/codex/5608-5610-continuity-docs/AGENTS.md), [asset plan](https://github.com/popcre/shared-db/blob/codex/5608-5610-continuity-docs/plan_assets-update-trigger-scoping.md), [efficiency plan](https://github.com/popcre/shared-db/blob/codex/5608-5610-continuity-docs/plan_database_efficiency_and_api_security.md), [SKU plan](https://github.com/popcre/shared-db/blob/codex/5608-5610-continuity-docs/plan_sku-style-guide-link-job.md), [index plan](https://github.com/popcre/shared-db/blob/codex/5608-5610-continuity-docs/plan_unused-index-cleanup.md), and [old continuity draft](https://github.com/popcre/shared-db/blob/codex/5608-5610-continuity-docs/HANDOFF.d/2026-11-05T1305Z-edge-dev3-codex-three-issue-continuity.md). These links identify preservation intent, not remotely delivered files. The current handoff carries the surviving execution knowledge instead.

November 17 final native closeout passed for root session 01a1a9c5-d9e1-7160-ac26-ed9dac540870, with 11 open claims and 3 exclusive stages freshly checked, zero owned blocking claims/stages, and ok=true. The reconciliation child 01a1eb1e-11d5-7cc2-9253-cc3881b29808 independently passed with 11 claims and 3 stages checked and zero owned blockers. JSON receipts remain protected private evidence. No ownership was manually removed and no foreign stage was released. Both promotion-parked and promotion-held queries returned zero PRs. This closeout has no undelivered migration source. A future successor must independently refresh these facts. No actual successor has yet accepted a transfer. No open implementation PR is intentionally handed over by this closeout. Applied source and all historical reservations remain immutable. All local retention decisions are deliberate.


### Housekeeping and preservation result

The installed report-only inventory at wrap-up found 13 merged-worktree review candidates, 50 unknown worktrees and 100 live/protected classifications across the shared clone. These are classification candidates, not deletion authorization. It found 10 successor-review handoffs and 2 unattributed handoffs, 90 merged-branch candidates and zero unowned odd refs. Counts are a dated snapshot taken before the safe retirement of the reconciliation worktree. No foreign branch, dirty file or handoff was cleaned. The older local drafts listed above remain deliberately retained because they contain historical continuity and have not been safely published as current instructions.

Closed-issue handoffs flagged for their owning sessions' successor review are below. A closed issue alone never authorizes deletion. No unrelated candidate was opened, edited, retired or treated as a new wrap-up implementation task.

- [2026-11-11T2210Z-edge-dev3-claude-mg06-site-path-and-merchgroup-fix.md](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-11T2210Z-edge-dev3-claude-mg06-site-path-and-merchgroup-fix.md) — issue 6150, owner mimo/6084-doc-health.
- [2026-11-12T1730Z-mg06-note-for-mickey-minnie-properties-session.md](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-12T1730Z-mg06-note-for-mickey-minnie-properties-session.md) — issue 6150, owner edge-dev3-claude/mg06-coordination.
- [2026-11-12T2052Z-edge-dev3-claude-coldlion-property-feed-and-stale-tables.md](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-12T2052Z-edge-dev3-claude-coldlion-property-feed-and-stale-tables.md) — issue 6194, owner claude/edge-dev3 session bd88e001 (ColdLion feed gap + stale tables).
- [2026-11-12T2100Z-edge-dev3-claude-mg06-site-path-step6.md](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-12T2100Z-edge-dev3-claude-mg06-site-path-step6.md) — issue 6150, owner edge-dev3-claude/mg06-site-path-step6.
- [2026-11-13T1455Z-edge-dev-mimo-opa-fix-forward-repair.md](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-13T1455Z-edge-dev-mimo-opa-fix-forward-repair.md) — issue 6209, owner mimo/opa-fix-forward-repair.
- [2026-11-13T1840Z-edge-dev3-claude-property-name-fields.md](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-13T1840Z-edge-dev3-claude-property-name-fields.md) — issue 6269, owner unassigned (next shared-db session).
- [2026-11-16T1525Z-edge-dev3-claude-6356-sandbox-catchup.md](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-16T1525Z-edge-dev3-claude-6356-sandbox-catchup.md) — issue 6356, owner claude/83b531ac (session 83b531ac-363f-4fa4-abb7-8f2ffdbd3ad6).
- [2026-11-16T1530Z-edge-dev3-claude-sandbox-catchup-10.md](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-16T1530Z-edge-dev3-claude-sandbox-catchup-10.md) — issue 6356, owner claude session f66ef41b (sandbox catch-up batch 10).
- [2026-11-16T2210Z-edge-dev-mimo-deadline-watch-and-delivery-tail.md](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-16T2210Z-edge-dev-mimo-deadline-watch-and-delivery-tail.md) — issue 5937, owner mimo/watch-handoff-5937.
- [20261108T1305Z-edge-dev3-claude-close-nested-5758-anti-bloat.md](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/20261108T1305Z-edge-dev3-claude-close-nested-5758-anti-bloat.md) — issue 5758, owner claude/5758-close-nested-handoff.

## 9. Open questions and risks

The contract anchor is #5610, but #5609 remains an equal unfinished obligation. If #5610 closes first, carry every remaining #5609 fact, failure and next action into its active continuation record before retiring this file. Closure of the anchor alone does not prove this two-issue outcome complete.

Both issues are OPEN with live proof unchecked. #5609's invalid old interval and unproved savings are material. #5610's earliest conditional unchanged-candidate date is November 20, and current absence/planned-use proof remains necessary. Residual #5747 inventory cannot be marked done from a result covering only #5610's shared pair. A different current source or reset can change these conclusions, so refresh before acting.

This wrap-up starts no additional implementation. New discoveries go into this handoff or the same issues. No owner business decision was found in the section-by-section sweep. There is no newly exposed or generated credential; the safe reference/injection transport remained in use. The docs-only handoff will be published through a normal PR and verified on actual main before the predecessor ends.

## Part B. Subagent custody

### SKU worker, original task

Asked to finish #5608. Delivered persisted keys, batched v4 resolver and final snapshot design, preview/runtime/parity evidence, and supporting publication through [5898](https://github.com/popcre/shared-db/pull/5898) and [5916](https://github.com/popcre/shared-db/pull/5916). A later session completed actual production proof and closed #5608 through [6112](https://github.com/popcre/shared-db/pull/6112). Historical source/disposable worktrees are retained as evidence, not active writers. Failed 120-second production catchup and renewed-but-unused source identities remain recorded. No new SKU implementation is needed.

### Asset-trigger worker, original task

Asked to reduce redundant saves and prove acceptance. Delivered trigger scoping, exact contracts/tests, cache/metadata investigation, app repair evidence and faithful observation checkpoints. Found unmet hosted/interim WAL target and invalidated windows. The apparent retained-lease metadata mismatch was fixed in proof logic through [5896](https://github.com/popcre/shared-db/pull/5896), not by erasing valid producer data. Source and protected raw packets are retained. It did not establish full acceptance or authorize another speculative data repair. The successor owns #5609 to actual live proof.

### Index-cleanup worker, original task

Asked to decide and deliver only safe removals. Established positive KEEP/vector protections, exact observation identities and current consumer inspection limits. It delivered [5895](https://github.com/popcre/shared-db/pull/5895) observation history and the shared opening record. The original worker kept all eleven indexes. The November 17 lead check identified the separate AI-tag KEEP rebuild. It made no drop migration and did not prove exhaustive no-reader coverage. Historical worktrees remain evidence. The successor must re-prove current candidate eligibility and complete #5610.

### Plan-reconciliation subagent, November 17

Actual session 01a1eb1e-11d5-7cc2-9253-cc3881b29808. Explicitly asked to reconcile #5610/#5747 after Albert rejected the obsolete coordinator assignment. Delivered four Markdown files in [6604](https://github.com/popcre/shared-db/pull/6604), actual merge daa8ac5908465852f1bea8e769c562af9b4a055f, clean source branch codex/5610-5747-one-index-audit. Parent independently compared all four merged blobs and updated/read back both issue bodies. It preserved historical inventory, narrower #5610 scope, broader #5747 residual, KEEP/vector/current consumer criteria and newer weekly proof. It performed no database operation. Its native final ownership receipt is included in the final receipt update above.

## Self-audit

1. **Can a new developer continue without chat context? Yes.** Sections 1–3 define the product, reconciled boundaries, exact delivery and authoritative links. Section 6 assigns the two workers and supplies ordered next actions and observable acceptance gates. Section 8 covers access, protected evidence and custody. The gap found in the first pass was incomplete disclosure of hosted preview writes. It was repaired in Section 3 before publication.
2. **Can that developer continue as effectively as this session? Yes.** Sections 3–5 retain actual failures, invalidated windows, metadata-protocol correction, workload caveats, counter identities, separate KEEP-index rebuild and failed search-coverage assumptions. Part B distinguishes each subagent's completed work from unresolved outcomes. The draft's unverified ownership statement was replaced with actual native root/child receipts.
3. **Are relevant state, decisions, risks, exact next actions and verification included? Yes.** Sections 2, 6 and 7 require actual delivery and live proof, preserve dependencies and prohibit false completion. Sections 3 and 8 distinguish applied source, committed preview/app data, source-only proposals, unpublished stale drafts and protected evidence. No pending implementation PR is concealed. Current source must still be refreshed as expressly required.
4. **Does Section 0 expose every business decision and exclude technical approvals? Yes.** The line-by-line sweep of Sections 1–9 and Part B found no unresolved owner business judgment. References to owner authority, scope, credentials, schema, merge and production concern settled instructions or AI-executed technical work. Section 0 records the latest coordinator/subagent authorization verbatim, reconciles the earlier role correction, and says none are currently needed. No decision was left only in Part B.

All ten numbered sections, four subagent blocks, preserved failures, actual receipt evidence, portable GitHub file/commit references, publication intent and next-session prompt were re-read. Public-boundary/local-link and handoff-contract gates still must pass on the exact committed head before merge. The document's source remains a snapshot, not permission to replay old operations.

## Copy-paste continuation prompt

```text
Act as coordinator in https://github.com/popcre/shared-db. Refresh main and read https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-17T2059Z-edge-dev3-codex-two-issue-live-completion.md. #5608 is complete and #6604 published the reconciled plans. Spawn one subagent for #5609 and another for #5610. Use those plans, perform the shared asset audit once, and independently verify delivery and production live proof. Keep working until both issues are 100% complete. Resolve actionable blockers, follow genuine safety and observation requirements, and do not stop at implementation, merge, or monitoring.
```
