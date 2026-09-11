---
issue: 2293
status: OPEN
owner: codex/orchestrator-2288-handoff
---

# Orchestrator #2288 closeout — oldest-first continuation

## 0. Decisions only the owner can make

Put this whole list to Albert together; do not interrupt him one item at a time.

### Waiting on Albert

1. **ColdLion health-lane deployment actions — issue #2290.** After the structural guard in #552 lands, a later session still needs fresh authority to acknowledge only the incident's alerts, reset the breaker, and activate the verified production baseline last. Recommendation: authorize only after a read-only current-state report proves the exact preview/production targets and the narrow rows/actions. This blocks the operational closeout, not the migration.
2. **Credential rotation — issue #2284, deliberately last.** Two existing MCP bearer credentials appeared in private task output. Albert explicitly directed this session to leave rotation until the end. Recommendation: rotate both through the approved 1Password-backed ai-devops route after the database queue work, verify new credentials work, and verify old credentials fail. Never paste values into chat or GitHub.
3. **Previously open owner tickets remain open and labelled `needs-albert`:** #2110 (frozen-schema disposal), #2045 (HTS RAG follow-ups), #1848 (held production promotion), #1671 (DesignFlow non-production deployment), #1431 (cutover view repoint), and #1275 (licensor scrape row lifecycle). This session did not re-decide or act on them.

### Already settled — do not re-ask

- **2026-09-04:** Albert approved splitting #552. Structural guard/grant work stays in #552; deployment/data acts are #2290.
- **2026-09-04:** Keep every active author lane running. Fill naturally opened lanes with the oldest open structural issue or its blocker; do not pause or displace work merely to reorder it.
- **2026-09-04:** Muse Spark 1.2 Contributor is functional. It successfully reviewed #2151; do not exclude it on the predecessor handoff's stale premise.
- **2026-09-04:** Credential rotation remains last.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the shared Supabase database used by POP Creations applications. One live orchestrator owns structural scheduling; up to eight isolated author worktrees may prepare unrelated migrations. Every migration needs an exact object claim, branch and pull request, current-head checks, an independent governed review, guarded merge, and post-merge preview rehearsal. Production is a separate evidence and authority gate.

This orchestrator ran on `EDGE-DEV`. The current routing marker is GitHub issue #2288 and declares route `01a06c21-1974-7713-8506-b6688f6a83b9`. The successor must create its own marker with its own route after #2288 closes; never copy this route.

## 2. What we set out to do this session, and why

The predecessor asked this session to continue the structural queue while reviewer and author lanes were congested. Albert then set the ordering policy: leave credential rotation until the end, treat Muse as functional, start with the oldest open orchestrator issues, never pause mid-stream work, and use each naturally opened lane for the oldest issue or its blocker.

The session therefore:

1. took over safely from marker #2269;
2. refreshed three active structural PRs against moving `main`;
3. cleared the false #2138/#2151 dependency cycle;
4. completed #2151 through Muse review, guarded merge, and preview rehearsal;
5. split oldest issue #552 per Albert's ruling;
6. used #2151's naturally freed lane for #552;
7. left every other active lane intact.

## 3. Current state — verified live

### Moving facts

Checked 2026-09-04 13:02–13:04 UTC:

- `origin/main`: `420dc88ebb2bfc5e45b9b6214d5395a155a13a64`.
- Main's newest migration: `20260904121037_popdam_tag_facet_count_index_leading_arm.sql`.
- Preview project: `mvpkijzfmfcxhnzqogzs`; 599 ledger versions. Its latest twelve ended at `20260904121037`, and that exact version was confirmed present.
- No production write or production workflow was run by this session.
- No preview or production exclusive lock was present after run #33873185380 completed.
- Queue: 8/8 author lanes occupied, eight protected claims, five expired-but-still-protective claims. Expiry is never release.
- Queue audit has no malformed or unlabelled issue after #2290 was repaired. It still reports `fullyAudited:false`; the successor must re-run it and classify remaining open intake rather than treating silence as a clean queue.

### Completed in this session

#### #2151 / PR #2230 — tag facet count path

- Final reviewed head: `6455f7c5c1e1303bf85a284e3e63464f43bd561b`.
- Reserved/applied version: `20260904121037`; the earlier backdated reservation `20260903193135` remains permanently burned and must never be reused.
- Muse Spark 1.2 Contributor issued a durable exact-head approval at `refs/db-review-verdicts/2151-2230-6455f7c5c1e1303bf85a284e3e63464f43bd561b`.
- Guarded merge run #33872755738 succeeded; merge commit is `420dc88ebb2bfc5e45b9b6214d5395a155a13a64`.
- Post-merge preview run #33873185380 applied only `20260904121037` and saved immutable evidence. The preview ledger now contains it.
- Author claim #2227 is closed. Its clean worktree `C:\repos\shared-db\.claude\worktrees\issue-2151-facets` was safely removed only after GitHub proved PR #2230 merged and the merge commit was in `main`.
- Issue #2151 remains the durable work record; no production promotion occurred.

### Active migration work — do not pause

| Claim | Work issue / PR | Version | State and exact next gate |
|---|---|---|---|
| #2291 | #552 / PR #2292 | `20260904123511` | Active until 2026-09-05 00:34 UTC. PR head `df034334281034f09caa505396d9ba12e5c73513`; all CI including the ephemeral DB suite passed. It needs a fresh current-main check, governed reviewer assignment, guarded merge, then post-merge preview. |
| #2257 | #2202 / PR #2259 | `20260904013240` | Active until 2026-09-04 13:32 UTC when checked. Refreshed head `c6a9161880d6daa7520c1749e198260a4c3cbf4c`; exact-head CI passed at refresh. Re-check because `main` moved. |
| #2198 | #2196 / PR #2201 | `20260904053056` | Active until 2026-09-04 17:30 UTC. Refreshed head `668af71ae55d12425477a8a04e51815b24b5853d`; its earlier Grok review was for a stale head and is non-authorizing. |
| #2181 | #2173 / PR #2186 | `20260904001555` | Lease expired 2026-09-04 12:41 UTC but claim remains protective. Refreshed head `5104f3a04599d7693e69743a814629c0a2ba2761`. Inspect before explicitly renewing/resuming; do not release while PR is open. |
| #2226 | #2159 / PR #2228 | `20260904020544` | Lease expired, PR open. Queue reports a dependency on closed #2147 without the required completion record. Preserve the claim and resolve the evidence defect; #718 is queued behind this compatible lane. |
| #2195 | #2172 / PR #2200 | `20260903115949` | Lease expired, PR open. Inspect and renew/resume or finish; never infer abandonment. |
| #2184 | #2175 / PR #2185 | `20260903030716` | Lease expired, PR open. Inspect and renew/resume or finish; never infer abandonment. |
| #2182 | #2177 / PR #2183 | `20260904001147` | Lease expired, PR open. Inspect and renew/resume or finish; never infer abandonment. |

### Queue ordering

- #552 is the oldest ready structural issue and already owns claim #2291.
- #718 is the next oldest ready structural issue. Do not displace another lane; take it when a compatible lane naturally opens, or resolve its blocking claim/evidence path first.
- Continue by transitive blocker count, then issue `createdAt`, then issue number. Re-run `node scripts/manage-migration-author-lanes.mjs --queue-audit` before every new allocation.
- #2138's `filter_effective_assets` half is merged and production-verified in PR #2150. Its erroneous circular dependency on #2151 was removed from #2151. Do not recreate it.

### Non-orchestrator work visible in this repository

Open repository-maintenance/application PRs—including #2281, #2278, #2266, #2264, #2260, #2245, #2237, #2205 and #2134—are not structural orchestrator assignments. The queue audit lists their owner issues for visibility. Do not dispatch or merge them from the structural orchestrator merely because they are in this repository.

### Preview is not globally clean

This session's known preview delta is exactly migration `20260904121037` from run #33873185380. Preview is a shared mutable clone with 599 ledger versions and may contain other sessions' rehearsals or data. Re-read the ledger immediately before every rehearsal; never infer a clean environment from this handoff.

## 4. Everything tried that did not work

1. **Using predecessor guidance that Muse was unavailable.** Albert corrected this. The live `ai-muse doctor` passed and Muse completed a governed #2151 review with a durable approval. Do not exclude Muse on the stale handoff statement.
2. **Trying to release claim #2227 merely to prioritize #718.** Albert clarified that mid-stream lanes must not be paused. The release was immediately and safely reversed with the guarded resume command before further work; #2151 then completed normally. Do not repeat priority by displacement.
3. **Treating #2151 as blocked until #2138 closed.** The dependency was circular: #2138's actual prerequisite PR #2150 was already merged and production-verified, while #2151 was the separately scoped remainder. The dependency was removed with a durable issue comment; no completion record was fabricated for old work that lacked a published contract.
4. **Preparing #2151 preview before guarded merge.** The tool correctly refused because the repository's current workflow is merge-first and the required merge authorization did not yet exist. The successful order was governed review → guarded merge → preview-ready record → post-merge rehearsal.
5. **Preparing preview without `SUPABASE_ACCESS_TOKEN`.** The ledger check refused rather than claiming no drift. The token was then fetched serially from 1Password and passed only through the process environment.
6. **Duplicate preview dispatch.** The first command returned late with no visible output and had actually dispatched run #33873185380. A retry created queued duplicate #33873290169. The duplicate was cancelled before it could act; only #33873185380 applied.
7. **First #2288 marker and #2293 issue bodies lost Markdown backticks in PowerShell.** Interpolated here-strings consumed the fences. Each existing GitHub item was repaired in place using a literal body file; no duplicate marker or handoff issue was created.
8. **Direct governed Grok adapter on an older #2196 head.** Grok produced an approving analysis, but the Windows terminal adapter failed to create the durable verdict artifact. That review is non-authorizing and now stale after the PR head changed. Draw a new reviewer for the current exact head.
9. **Main movement during refreshes.** PRs #2186, #2201 and #2259 had to be refreshed more than once. Exact-head evidence is stale whenever either the PR head or relevant base changes; re-check before every expensive gate.

## 5. Root causes and key findings

1. **Oldest issue #552 mixed two routes.** Migration work (live-hash guard and grant reassertion) is structural. Observation, alert acknowledgement, breaker reset and baseline activation are deployment/data acts. Albert approved the split: #552 is structural; #2290 is owner-only.
2. **#552's old mechanism no longer exists.** Baselines moved from hard-coded constants into `plm.taxonomy_baseline_pin` and `plm.taxonomy_baseline_activation` in migration `20260804120000`. PR #2292 therefore guards computed live hash against the reviewed transition values while preserving table-driven baseline selection; it does not re-pin a constant.
3. **#2151 was independent after PR #2150 reached production.** The count helper is a different function from `filter_effective_assets`; keeping `depends_on: 2138` created a false deadlock.
4. **Muse is healthy.** The wrapper doctor passed all installed/config/auth checks, and governed sequence 1283 produced a complete coverage statement plus durable approval.
5. **Reviewer capacity at 2026-09-04 13:03 UTC:** GLM held one live review for #2207; Grok's old #2196 reservation and Muse's merged #2151 reservation were stale-reclaimable; Codex overflow was free. Use the allocator—never delete reviewer refs manually.
6. **Queue truth:** five expired author leases still protect open PRs. Expired means audit required, not free capacity.

## 6. Exact next steps

1. **Take over with a fresh marker.** After #2288 is closed, open one marker with a new route ID and run `node scripts/check-orchestrator-marker.mjs --resolve`. Success means exactly one marker resolves to the successor's own route. Do not dispatch before this passes.
2. **Re-resolve moving state.** Fetch `origin/main`; run `--audit`, `--queue-audit`, reviewer capacity, and list open PRs. Success means current SHAs/leases replace every snapshot above.
3. **Finish #552 first.** Verify PR #2292 still has head `df034334281034f09caa505396d9ba12e5c73513` based on current `main`; if main moved, refresh through its clean worktree and rerun checks. Assign the manager-selected reviewer (Muse is eligible), independently verify findings, then use guarded merge. Success means an exact-head durable approval and guarded merge commit on current `main`.
4. **Rehearse #552 after merge.** Resolve the marker, run `--prepare-preview-dispatch 552` with a fresh preview ledger, re-run the selector, and dispatch only its stored post-merge manifest. Success means the allowlisted `20260904123511` ledger delta and immutable preview evidence. Do not execute #2290's operational acts.
5. **Release #552's author claim only after PR merge and clean-worktree proof.** Confirm GitHub says the PR merged, the merge commit is in `main`, and the worktree is clean. Success means claim #2291 closes and a natural lane opens.
6. **Fill that natural opening oldest-first.** Re-run the queue audit. #718 was next at handoff, but use live `createdAt` and blocker truth. Success means the chosen issue is the oldest compatible ready work or directly clears its blocker; no running claim is displaced.
7. **Audit expired protective claims.** For #2181, #2226, #2195, #2184 and #2182, inspect live PR/worktree/owner state. Renew/resume only when the same work is continuing; otherwise close out through the guarded procedure. Success means no claim is guessed free and every action has owner proof.
8. **Leave credential rotation to the end.** When Albert authorizes #2284, route it through the owning ai-devops/security session and the 1Password procedure. Success means both new credentials authenticate and both old credentials fail without service loss.

## 7. Constraints and gotchas in force

- One orchestrator marker only. Resolve it before every delegation.
- Structure only: migrations/schema/functions/grants belong here. Ordinary application rows do not. Curated Master Data remains the narrow exception.
- Never pause an active lane merely to reorder work. Allocate only naturally free capacity.
- Every issue—including tooling complaints—must carry `db-work` and a valid `db-work-scope` block.
- Preserve every expired claim until guarded inspection proves it can be renewed, resumed or closed.
- Author permission is not preview, merge or production permission.
- Merge-first is current policy: exact-head reviewer approval and guarded merge precede preview rehearsal.
- Never edit an applied migration. The old #2151 reservation remains burned.
- Preview is shared and contains a production clone. Prove target and ledger immediately before writes.
- No production action is authorized by this handoff.
- Muse is functional. Use `ai-muse` with `AI_MUSE_CALLER=codex` and the governed runner when assigned.
- Reviewer reservations are manager-owned. Never hand-delete refs or synthesize verdicts.
- Credential values stay in 1Password vault `vibe_coding`; never print or paste them.
- Preserve all unrelated worktrees and PRs. Cleanup must be evidence-based, not age-based.

## 8. Access and environment

- Host: `EDGE-DEV`, PowerShell, authenticated `gh`, Git and 1Password CLI.
- Canonical repository: `C:\repos\shared-db`; this closing worktree is `C:\Users\ahazan\.codex\worktrees\c337\shared-db` on branch `codex/orchestrator-2288-handoff`.
- Active #552 worktree: `C:\repos\shared-db\.codex\worktrees\issue-552-health-guard`, branch `codex/issue-552-health-live-hash-guard`, clean at handoff.
- Other active lane worktrees remain registered under `C:\repos\shared-db\.claude\worktrees\` and `C:\repos\shared-db-worktrees\`; inspect Git's worktree list rather than guessing paths.
- Supabase credentials are in 1Password vault `vibe_coding`. Fetch serially and place values only in process environment. No value belongs in a command transcript, file, issue, commit or handoff.
- Production project ref is never inferred from preview. The preview ledger reader reported `mvpkijzfmfcxhnzqogzs` at handoff.

## 9. Open questions and risks

1. **#552 reviewer outcome is unknown.** CI is green, but no governed review has run at `df034334...`. Do not infer correctness from tests.
2. **#552 transition guard semantics deserve reviewer scrutiny.** It accepts only the reviewed retired/current licensor status hashes and refuses null/unknown values before normal writes. Confirm that this is the intended durable live guard and that all four ACLs remain service-role-only.
3. **Five expired leases protect open PRs.** Their workers may be gone or merely late; neither state can be inferred from expiry.
4. **Queue audit is not fully classified.** No malformed/unlabelled item remained after repair, but open intake and outside-orchestrator work still need live classification.
5. **Preview may carry unrelated rehearsals/data.** Only this session's `20260904121037` delta is claimed here.
6. **Production remains untouched.** Preview success for #2151 is not production acceptance.

# Part B — sub-agent state, separated by agent

### Agent: `/root/issue_2173_refresh`

- **Asked to do:** Refresh existing #2173 / PR #2186 to current main without widening scope; later, after #2151 freed a lane, implement oldest issue #552 in its newly claimed worktree.
- **Actually did:** Refreshed PR #2186 to head `5104f3a04599d7693e69743a814629c0a2ba2761`. For #552, loaded published contract `refs/db-contracts/552/1`, authored migration `20260904123511`, updated only the two allowed contract test files, and opened PR #2292 at final head `df034334281034f09caa505396d9ba12e5c73513`. Local SQL, derivation, sidecar and 425/425 lane tests passed; every exact-head CI check including the ephemeral DB suite passed.
- **Found:** #552's baseline is table-driven; the viable structural guard belongs after the live snapshot in both `plm` functions, before their normal writes, with public wrappers recreated unchanged and all four ACLs reasserted.
- **PR / branch:** #2186 / `claude/2173-coldlion-sales-history`; #2292 / `codex/issue-552-health-live-hash-guard`.
- **Worktree:** #552 worktree is live, clean and resumable at `C:\repos\shared-db\.codex\worktrees\issue-552-health-guard`. The #2173 worktree remains live because its PR and protective claim remain open.
- **Deliberately did NOT do:** No review, preview, merge, production, observation, baseline activation, breaker reset, alert acknowledgement or queue mutation.

### Agent: `/root/issue_2196_refresh`

- **Asked to do:** Refresh #2196 / PR #2201 onto then-current main and preserve its single-object fillfactor scope.
- **Actually did:** Pushed head `668af71ae55d12425477a8a04e51815b24b5853d`; SQL and collision guards passed and the diff remained one migration on `public.dam_search_documents`.
- **Found:** The prior Grok approval was tied to an older head and has no durable verdict artifact, so it cannot authorize the current PR.
- **PR / branch:** #2201 / `claude/2196-dam-search-fillfactor`.
- **Worktree:** live and clean at `C:\repos\shared-db\.claude\worktrees\issue-2196`; claim #2198 remains active.
- **Deliberately did NOT do:** No reviewer replacement, preview, merge, production or queue mutation.

### Agent: `/root/issue_2202_refresh`

- **Asked to do:** Refresh #2202 / PR #2259; later take over #2151's existing active lane after its false dependency was removed.
- **Actually did:** Refreshed PR #2259 to `c6a9161880d6daa7520c1749e198260a4c3cbf4c`. For #2151, preserved the existing branch, used guarded supersession to replace the backdated migration reservation with `20260904121037`, reached exact head `6455f7c...`, and passed all local and CI checks. The orchestrator then obtained Muse approval, merged PR #2230 and rehearsed it on preview.
- **Found:** The #2151 migration was narrowly scoped to one function and required the version supersession; old `20260903193135` must remain burned.
- **PR / branch:** #2259 / `codex/issue-2202-canonical-workflow`; #2230 / `claude/issue-2151-tag-facet-counts` (merged).
- **Worktree:** #2202 worktree remains live and clean. The finished #2151 worktree was safely removed after merge proof.
- **Deliberately did NOT do:** The agent itself performed no reviewer, preview, merge or production action; those guarded steps were done by the orchestrator.

# Closeout audit

1. **Street-newcomer continuity:** YES. Sections 1–3 define the repository, goal, exact live state, claims, PRs, preview and production state.
2. **Full session knowledge:** YES. Sections 4–5 record every consequential failed path, correction and non-obvious finding; Part B separates all three agents.
3. **Flawless execution coverage:** YES. Sections 6–9 give ordered commands/gates, constraints, access, risks and exact evidence identifiers.
4. **Owner decision sweep:** YES. Every owner-dependent statement in Sections 1–9 and Part B appears in Section 0 with a recommendation. Settled decisions are separately listed so they are not re-asked.
5. **Secrets sweep:** Completed. No new credential value was found in repository diffs or untracked files. The previously known private-output exposure remains tracked only by identifier in #2284; rotation was deliberately left last per Albert.
6. **Documentation pass:** Nothing outside this handoff is newly stale. The durable route split lives in issues #552/#2290; no rulebook or plan requires rewriting.
7. **Worktree sweep:** Finished #2151 was proven merged, clean and removed. #552 and all other open-PR worktrees were deliberately preserved as live. Unrelated and unclear worktrees were not touched.
8. **Queue seed:** Every unfinished item named here has an open `db-work` issue. Transfer is #2293; owner actions are #2290 and #2284; structural and maintenance work retain their existing issue numbers.
