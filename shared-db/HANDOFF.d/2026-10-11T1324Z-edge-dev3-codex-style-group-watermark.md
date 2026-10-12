---
issue: 2421
status: BLOCKED
owner: codex/issues-2478-2421-2420
---

## 0. Business decisions only the owner can make

None. The user authorized clearing these issues. Technical decisions remain with the root Codex session and allocator-assigned independent reviewers. Never ask Albert to review code or run a manual step.

## 1. What this application is

PopDAM manages artwork assets, SKU folder style groups, taxonomy and tags. Its persistent Railway worker rebuilds group membership against the shared production Supabase database. Schema source is [shared-db](https://github.com/popcre/shared-db); application source is [PopDAM](https://github.com/u2giants/popdam3). Read-only production target confirmed October 11, 2026, 9:15 AM EDT: qsllyeztdwjgirsysgai.supabase.co. No production mutation occurred in this lane.

## 2. Session objective

Clear #2478 shared SKU derivation, #2420 retirement of destructive nightly clearing, and #2421 differential scheduling. #2478 and #2420 were already delivered; current production evidence established their acceptance. #2421 must reduce actual asset work, reliably detect changes without overwriting file dates, advance only completed run bounds, preserve recovery and keep weekly full convergence.

## 3. Current state

[Issue #2478](https://github.com/popcre/shared-db/issues/2478) is CLOSED, supported completion live_verified. [Immutable acceptance](https://github.com/popcre/shared-db/issues/2478#issuecomment-6109219467) binds read-only run38140772615, artifact11702562355, digest82c32808a58049dc952761cf23df77d447b35e87104193163077329b3047b121 and application SHA01b08a8544d56f1760b9b7fa2bd0d7ec3b7f0bdd. Historical production evidence was validated independently before truthful administrative reconstruction; no new apply was implied.

[Issue #2420](https://github.com/popcre/shared-db/issues/2420) is CLOSED with [exact acceptance](https://github.com/popcre/shared-db/issues/2420#issuecomment-6109247597): eight pre-removal September24–October1 daily observations and eight post-removal October3–10 all zero assignment/tag drift; deployed PopDAM headf9e6e87b45d6f51960f29067e173a3c4cfc06d02 includes retirement67685c55095c959a4dbe6cdf6dbbe37d89e76ba4. October11 production scheduled run completed with cleared0. Explicit recovery is preserved.

[Issue #2421](https://github.com/popcre/shared-db/issues/2421) remains OPEN; [PR4161](https://github.com/popcre/shared-db/pull/4161) remains OPEN. Implementation after owned CI repairs is [5f08ddbd](https://github.com/popcre/shared-db/commit/5f08ddbd). This handoff/evidence tail changes only prose and canonical evidence; obtain its final exact PR head before every review. [Claim4158](https://github.com/popcre/shared-db/issues/4158) is active, leased to Codex chat01a12b02-63e2-7d62-b0b4-52e7c6b0f804 and records exact branch/worktree. Permanent migration20261011125719. Claim now includes tablepublic.style_group_tags through supported PR-scoped expansion after fresh collision clearance.

Latest immutable contract is refs/db-contracts/2421/8, SHA256b71092298c4ab39050d4708325abaf1f6b3cf64ab8b9eabfec2ea53a48892887. It binds generation7 hash0b27bd41e564740aefc118845b76ee602362349c88903eb8ba0a5bf70ef770b6. Commit only the latest keyed contract/completion pair; immutable predecessor refs remain published. [Current evidence](https://github.com/popcre/shared-db/tree/codex/issues-2478-2421-2420/.agent/work/2421/8).

The [migration](https://github.com/popcre/shared-db/blob/codex/issues-2478-2421-2420/supabase/migrations/20261011125719_style_group_change_watermark.sql), [rollback contracts](https://github.com/popcre/shared-db/blob/codex/issues-2478-2421-2420/supabase/tests/style_group_change_watermark_contracts.sql), [synthetic harness](https://github.com/popcre/shared-db/blob/codex/issues-2478-2421-2420/scripts/test_style_group_watermark.py), and [installed-state-only probe](https://github.com/popcre/shared-db/blob/codex/issues-2478-2421-2420/.github/live-proofs/2421.sql) are committed/pushed. Seven local PostgreSQL17 contracts passed; actual asset leaf rows examined3 versus old population10001. Static SQL passed; derivation/live-probe suites72 tests passed. Live ledger latest20261009073649 predates reservation. Full-schema ephemeral CI was still running at last check; re-read result before calling ready. No independent reviewer was drawn or approval obtained.

PopDAM companion is LOCAL ONLY on branchcodex/issue-2421-watermark-worker, commitb6005183. Intended source URLs (not yet remotely available): [handler](https://github.com/u2giants/popdam3/blob/codex/issue-2421-watermark-worker/apps/worker/src/handlers/style-groups.ts), [tests](https://github.com/u2giants/popdam3/blob/codex/issue-2421-watermark-worker/apps/worker/src/handlers/style-groups.test.ts). Locate branch with Git worktree inventory on edge-dev3; no application push/deployment performed. TypeScript build passed,274 worker tests passed. It validates scheduled protocol/run bounds, retains them across resume, rejects changed/missing resume identity, selects three-argument RPC only for protocol1 and preserves legacy two-argument clear recovery. Selected-row progress uses returned rows_examined, including zero final batches. Aggregated selected/written counters remain NOT implemented because [PopDAM PR152](https://github.com/u2giants/popdam3/pull/152) owns both operation-loop source and tests.

## 4. Failed approaches

Allocator refuses this structural PR without an automatic closing linkage: `REFUSED: pull request must close exactly one work issue; found 0`. Existing nonclosing binding is maintenance-only. Do not add fake Closes/reopen after merge, misclassify this as maintenance, or modify issue2421 structural domain. No capacity spent. Root owns supported binding-repair recovery under existing3999/3536 custody.

Initial logical UNION candidate limits still allowed two physical full asset scans. EXPLAIN revealed assets-first changed-group access and a final hash join over all assets. Current SQL uses materialized changed groups, per-group bounded lateral membership and forced single-ID final lookup; physical3/10001 verified.

CI found missing derived-from declaration, uppercase AS passed shape mismatch, and parser-inferred tablepublic.style_group_tags absent from claim. These are corrected in one bounded source batch; original derivations20260925061508 and20260909005945 declared faithfully. Expansion-from-issue treated own PR4161 as a collision; supported expansion-from-PR excludes that exact source after validating exact head/version/lease and succeeded.

One invalid gate action deployment was refused before a read-only #2478 observation, but the shell wrongly continued. It was reported immediately; root independently ruled pure read-only inspection open and verified rollback scope. Invalid gate never supplied authority. Always fail-stop gate refusals.

## 5. Root causes and findings

File modified_at is source metadata, not a reliable app processing clock. New database stamps cover path, filename/type, taxonomy, grouping/manual changes and group/tag inputs. Count-only writes are excluded; original file times unchanged. style_group_id stamping induces at most a finite follow-up pass; unchanged rebuild assignments are guarded.

Writers acquire shared transaction advisory lock before stamping, retaining it through commit. Queue acquires exclusive SESSION lock before BULK_OPERATIONS transaction lock and cutoff capture, then releases before counts-only work. Explicit query_canceled/assert_failure/others cleanup and reentrant balance are tested. Successful bounds require matching completed run_id, protocol and pending cutoff; failed/partial/manual runs cannot advance. Weekly full remains mandatory.

[Nonclosing binder](https://github.com/popcre/shared-db/blob/main/scripts/manage-migration-author-lanes.mjs) currently requires maintenance route, no DB reads/writes. [Admission](https://github.com/popcre/shared-db/blob/main/scripts/lib/lanes/admission.mjs) rejects structural Refs binding. Supporting fix would require manager, admission and manager tests; no repair authored here. Open PR3999,3626,3636,3627 overlap manager/tests;4109 manager;3666 tests. No admission-file overlap. [PR3999](https://github.com/popcre/shared-db/pull/3999) last verified activity October9 3:32 PM EDT: `PR is UNOWNED from here`; blocker `REFUSED: review circuit breaker: two paid attempts already started for unchanged reviewed content in slot 1; third draw refused pending substantive repair or supported cause-bound reinstatement proof`. Root is recovery owner; protected source remains preserved.

## 6. Exact next steps

1. Root resolves supported structural nonclosing binding under existing source custody; re-read actual blockers and current heads. Gate: ordinary allocator accepts truthful Refs2421 while issue stays OPEN, exact leased objects/contracts still checked, no bypass.
2. Refresh current main safely, revalidate contract lineage/claim/version and all changed-source tests; obtain both allocator-assigned exact-head reviews in parallel with CI. Gate: both durable APPROVE include production risk assessment of index locks/size, trigger ordering/stamps, session cutoff lock, queue watermark, old-worker compatibility and recovery.
3. Root decides guarded merge, merged-main preview and automatic production promotion only. Gate: exact preview artifacts, target proof and production ledger/catalog proof installed. No manual production DDL.
4. Serialize PopDAM PR152 ownership before operation-loop counters. Add selected/written totals and resume/failed-run aggregation tests without changing other operation behavior; independent exact-head application review and build/fullworker suite. Gate: original recovery retained, unknown legacy compatible, resumed totals accurate. Application patch remains local until schema installed and root permits delivery.
5. Generate required application types from governed deployed schema, ship companion through current PopDAM policy, verify actual production deployed head and successful protocol1 runtime bounds/selected counters. Gate: fresh current target and immutable runtime proof.
6. Observe a complete post-rollout weekly cycle on existing issue2421, not another proof ticket. Gate: every observation zero assignment/missing/unexpected/orphan/tag drift, weeklyfull actually runs, lower bounds advance only completed matching runs. A week not elapsed is a real external time blocker.
7. Supported complete-outcome only with complete immutable application acceptance. Gate: issue CLOSED and authoritative accepted binding; safely release/retire exact claim/worktrees afterward with preserved local companion bytes.

## 7. Constraints

Parent retains schema, merge, production and security decisions. No manual production mutation; credentials through serialized1Password only. Preserve two-argument RPC, explicit clear recovery, source file dates, existing group-only data and operator capability. Do not move protected source checks elsewhere to bypass custody. Model-tier template excludes shared-database/cross-repo design handoff to lower tiers. Every GitHub post signed. All human times EDT/EST.

## 8. Access and environment

Authenticated GitHub gh, Supabase MCP read-only, Docker local. Synthetic harness accepts no remote URL/credentials, runs postgres17 networknone with no host mounts/ports and checks ownership label. Docker image-owned disposable volume permitted; automatic cleanup removes container. Vaultvibe_coding; no secret accessed in this implementation. Installed ai-task-gates shared-db declaration in structural worktree; code declaration in companion. Git committer verified Albert Hazan noreply. GitHub workflows deploy main-only, but Railway external branch policy not freshly proven; do not push merely to produce a PR.

## 9. Questions and risks

October11 9:24 AM EDT: Technical gate binding and protected source custody prevent reviews/landing. Root owns recovery; no human business choice pending. Companion aggregator custody and independent review are separate delivery obligations. Weekly acceptance cannot begin before complete schema+worker rollout. Additive indexes may hold table locks during automatic apply; reviewers must assess exact production scale. Minimal synthetic tests are strong behavior/race proof but do not substitute full-schema ephemeral CI, preview catalog or production runtime acceptance. Read-only installed probe proves only catalog installation; never substitute it for app and weekly proof.
