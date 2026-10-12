---
issue: 4210
status: BLOCKED
owner: codex:01a12c68-44b8-7bb3-b1d4-98cb375b6859
---

# PopSG search closeout — October 11, 2026, 8:10 PM EDT

## 0. Business decisions

None. Albert asked “is PopSG working and finished?” then “fix it” and invoked wrap-up. The shared-db handover stage freezes further structural writes; the existing work PR is preserved, not merged to tidy the session. The root remains accountable. The next executing chat resumes with its own author identity and exact scope; no human technical approval is requested.

## 1. Application and scope

PopSG is the style-guide library at sg.designflow.app, sharing the PopDAM codebase. Common matching search in Files and Guides times out at the existing eight-second ceiling even though default signed-in browsing works. [Existing work issue #4210](https://github.com/popcre/shared-db/issues/4210) and [work PR #4213](https://github.com/popcre/shared-db/pull/4213) own the one fifteen-argument public.search_style_guide_library_v2 repair. Application outcomes remain on [PopDAM #335](https://github.com/u2giants/popdam3/issues/335) and [full acceptance #107](https://github.com/u2giants/popdam3/issues/107).

Read [AGENTS](https://github.com/popcre/shared-db/blob/main/AGENTS.md), [claim-first rules](https://github.com/popcre/shared-db/blob/main/docs/agents/section-4-anti-collision-rules.md), [worktree/handoff rules](https://github.com/popcre/shared-db/blob/main/docs/agents/worktrees-and-handoffs.md), and [application handover](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-11T2258Z-hetz-codex-popsg-live-recovery.md). The latter carries credential/PDF and reviewer-runtime incident detail; it is not independent database authority.

## 2. Done and exact current source

PR #4213 is OPEN at d0ff1c235bac832196d55763075a156a10da5d30 on codex/popsg-common-search; seven owned files, all committed/pushed, source worktree clean. At write time protected main is ef71035e1ba884553eefcc64999e2687c1057b18 and latest migration is 20261011224904; both were fetched at 8:09 PM EDT. No rebase/force-push, uncommitted migration, or half-applied DDL exists.

The candidate materializes parsed tsquery once in both modes; Guides use constant bound EXECUTE with fifteen USING arguments, separate page metadata and tag expansion. Owner postgres, STABLE SECURITY DEFINER, authorization, search_path/work_mem/grants and output contract are preserved. No timeout, index, cron, role, provider or model change. Baseline prosrc MD5 3547b0f7d28d044ff6d6e031dcbeebbb; proposed body 9d5dd045810fa3fce5cc3d508e1210ff. [Executed diagnostic/equivalence note](https://github.com/popcre/shared-db/blob/codex/popsg-common-search/docs/verification/popsg-search-4210.md) records Files 4.113 seconds, Guides 4.621 seconds, nine existing contracts and 224 complete old/new JSON comparisons. These are diagnostics, not deployed acceptance. Dedicated guide metadata/identity contracts and sidecar guard also passed locally.

Supporting [tooling PR #4219](https://github.com/popcre/shared-db/pull/4219) is MERGED as ef71035e through [guarded run 38186233007](https://github.com/popcre/shared-db/actions/runs/38186233007). It has 127 passing tests and DeepSeek/GLM durable APPROVE at d0fb192672b9de6eb84a6576cbc84ef8332fd795. It recognizes one strict append-only sidecar registry merge while retaining all budget limits, and closes canonical registry/import rewrite witness holes. Issue #4218 is that finished maintenance change, not the search claim.

## 3. Reviews and precise blockers

At search head d0ff1c235bac832196d55763075a156a10da5d30:

- Gemini sequence 6310, slot 1: APPROVE, durable refs/db-review-verdicts/4210-4213-d0ff1c235bac832196d55763075a156a10da5d30, commit 5eeb355bbec62cd38785cb1f40e7696a1a39bd7d.
- DeepSeek sequence 6311, slot 2: REVISE, durable same tuple with -slot2, commit d4c246a6b8d3a01fff899fa2543e9fab3efa75a9. All paid reviews finished; no subagents were spawned and no background execution is promised. This refusal cannot be erased or mislabeled a provider failure.
- [SQL guard run 38186448667](https://github.com/popcre/shared-db/actions/runs/38186448667) fails because candidate migration 20261011220717 precedes protected-main 20261011224904. No workaround or backdated apply is authorized.

DeepSeek requests six items. Assert exact default matview column identities/types, including default_summary result_mode/total/facets and default_guides result/modified_at/sort_name/entity_key. Compare extension arrays as sets rather than asserting undocumented array_agg(DISTINCT) order. Supply executable/reproducible equivalence and test evidence plus an explicit tested rollback/recovery path. Clarify that source-file tag GIN does not serve search-document tag predicates; do not invent a new index or assert every optional predicate is indexed. Document/test pre-existing null-versus-empty guide_key sort ties without casually changing output semantics. Some findings are existing behavior rather than introduced bugs; assess them honestly, preserve semantics, and give the reviewer concrete evidence rather than routing away from the judgment.

## 4. Claims and ownership

[Claim #4212](https://github.com/popcre/shared-db/issues/4212) is now capacity_state relinquished, source worktree clean, blocker artifact https://github.com/popcre/shared-db/actions/runs/38186448667, recovery artifact d0ff1c235bac832196d55763075a156a10da5d30. Owner remains Codex chat 01a12c68-44b8-7bb3-b1d4-98cb375b6859 on hetz; branch codex/popsg-common-search, worktree identity shared-db-popsg-common-search. Lease expires October 12 around 6:06 AM EDT. Resume/recover/transfer through supported manager before editing, then prove exact object claim. Permanent version reservations are retained; do not delete them.

The first relinquishment failed because this session's claim title lacked its work issue number; rollback was verified. The title was corrected to CLAIM: #4210 PopSG queried-search parse-once repair; the second supported transition succeeded and emitted the capacity events. No claim was falsely marked finished.

Immutable update worktree shared-db-popsg-refresh owns merged PR #4201, finished structural #3458 and released claim #4200. Tooling candidate/control worktrees are clean, source reviewed and merged. Preserve them while reviewing private evidence; no uncertain or concurrent worktree is deleted. Application and Qwen worktree ownership is in the linked application handover. Canonical PopDAM has private untracked .ai review material retained; it is not product source and is never committed. No other session's files were changed.

## 5. Preview and production disclosure

Read-only ledger snapshot at 8:09 PM EDT: shared preview mvpkijzfmfcxhnzqogzs has 761 entries, latest 20261011224904; Virginia production qsllyeztdwjgirsysgai has 733 entries, latest 20261011212008. Both include 20261011203652 update repair; neither includes 20261011220717 search repair. Preview is populated shared rehearsal state, not clean. Later unrelated versions belong to concurrent sessions; this chat does not own their recovery or promotion. Search applied to preview: NONE. Search applied to production: NONE. No hand-created rows or source data were written to shared preview for search; invented fixtures were local disposable PostgreSQL only.

Update [PR #4201](https://github.com/popcre/shared-db/pull/4201) source f7842c9a7f58848955dd46a245fa044b6ff3b6cf passed guarded merge, merged-main preview and automatic production [38179538914](https://github.com/popcre/shared-db/actions/runs/38179538914). Virginia live proof returned true. App [PR #347](https://github.com/u2giants/popdam3/pull/347) deployed as 46dd78567bc99516d294867923f5b242be2fbd3e; bridge 1.16.17 and Windows 0.16.7.173 adopted normally. Controlled crawl 0c34cc2e-2d23-4e60-8f6e-eb1cbf8bbc70 completed after actual scheduler refresh at 7:07:30 PM EDT; 7:12 PM EDT proof showed guard ok, zero stale/search queue, 220,218 active = 217,998 previews + 2,220 explicit exceptions. Do not repeat that proof or count it toward the two qualifying ordinary changed-night windows on #107.

## 6. Exact next sequence and acceptance

Resume claim → address all durable REVISE findings in an isolated current-upstream worktree → supported manager --supersede-active-claim-version with exact issue/claim/owner/branch/worktree/PR/head/old-version → verify migration/sidecar/registry/test references and digest → push → fresh exact-head independent approvals → green required checks → guarded merge. Do not use manual timestamp guesses. The manager has a strict pure version rewrite path; after substantive corrections, verify resulting content and every reference, not merely filenames.

After merge, fetch actual current main; independently assess exact main/ordered allowlist/source PR using literal production-risk-assessment fence. Prepare supported immutable merged-main preview, re-prove live ledgers and artifacts, dry-run/apply rehearsal, and launch only the guarded automatic production lane after task gates pass. No manual DDL or manual production dispatch. Concurrent main/risk changes require fresh authority; a stale review is not a production approval.

After automatic production, execute exact read-only Virginia [live proof](https://github.com/popcre/shared-db/blob/codex/popsg-common-search/.github/live-proofs/4210.sql) and signed-in common matching/unmatched queries, filters, page transitions and visible previews in both Files and Guides. Frontend request arg is p_result_mode, not p_mode. Correlate actual query response; synthetic underscore searches expand aliases, so match the full unique token contained in expanded p_query. Default or stale responses are not query acceptance. No copied browser JWT/authstate/raw traffic in artifacts.

## 7. Failed approaches and incident constraints

Parser materialization alone fixed Files but not Guides; parser variable/custom planning/split tags alone were insufficient. Do not raise timeout or trim complete facets/matches. Original old-head DeepSeek BLOCKED is retained; supporting registry-tool defect was repaired and merged rather than bypassed. An initial direct reviewer-engine report lacked front-door authority and was advisory; use supported exact reviewer and governance runner. Root once changed source during a GLM review, invalidating source digest; findings were retained, not called provider failure. Keep candidate immutable while reviewing.

This chat exposed a Meta API key in raw process args at 6:11 PM EDT. 1Password item czggiabkpo7dt7ojep4btdvq5i remains Compromised; only the ID, never value, is recorded. Provider account login is unavailable. An independently APPROVED exact all-consumer rotation is required before replacement/revocation/new edge consumer and PDF recovery. No PDF reset/backfill or compromised key installation was performed. Never dump args/envs, export browser auth, or reduce a capability as a repair.

Qwen runtime source fix is merged under ai-devops #1580/#1581 but full original large-input Docker acceptance is quota-blocked, reset November 1 at 11:00 AM EST. Required private-memory seed installation remains health-blocked; no memory edits/merges/deletions are authorized without explicit owner request. Keep incident and source records; do not switch model or skip installation stage.

## 8. Moving facts and sweep

Every quoted main, ledger, claim, version and count is dated above and may drift. Fetch source/PR and read live ledger/claim before resuming. No preview cleanliness, provider access, ordinary-night success or full PDF coverage is inferred. Secrets sweep: all session-used credentials already have protected vault entries; no new unstored secret was found in source diffs. Exposed Meta status was rechecked as Compromised; rotation is not complete. Public documents contain IDs/aggregates only. No general private-memory update occurred.

## 9. Handover self-audit

A stranger can resume without chat context: sections 1–5 identify the application, source/authority, real blockers, claim state and exact preview/production disclosure. They can continue as effectively as this session: sections 3 and 6 specify all corrective findings, guarded sequence and acceptance gates; section 7 preserves failed approaches and incidents. All relevant limits are present: existing issue ownership, retained verdicts, no force/manual production/no timeout/model reductions, credential access and ordinary-night gaps, preserved worktree/private artifacts. No unfinished work is marked delivered. Outstanding checklist is posted on existing #4210; application acceptance remains on #107/#335, and Qwen obligations remain on existing #1580. No new leftover-proof issue or background task exists.
