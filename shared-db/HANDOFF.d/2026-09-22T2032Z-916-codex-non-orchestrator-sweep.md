---
issue: 2829
status: OPEN
owner: codex/non-orchestrator-wrapup
---

# Non-orchestrator GitHub issue sweep — continuation handoff

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert in one message before any step that needs it. Do not ask piecemeal.

### Blocking

1. **Issue #2701 (non-orchestrator): production Property Matches proof.** The repository gate refused the browser proof because this chat did not name the exact production resource and action: `production is forbidden for ui-live-workflow; needs Albert naming exact resource and action`. Recommend Albert explicitly authorize read-only browser validation in the DB Data Admin-owned production UI at `https://data.designflow.app` for the Property Matches page, using dedicated Licensing and Administrator test identities. This blocks the final acceptance proof; it does not block repository fixes.
2. **Issue #2290 (non-orchestrator): ColdLion production deployment remains on owner HOLD.** Recommend keeping the hold until Ilona or Laura confirms that the current production licensor/property data is correct, then have Albert explicitly lift it. This blocks deployment actions only.

### External, not an Albert decision

- **Issue #3351 (non-orchestrator)** waits for the ColdLion vendor to state what uniquely identifies a `/proddetails` row. Do not guess or close it from repository evidence.

### Already settled — do not re-ask

- 2026-09-20: this sweep excludes issues touched by the Claude session named **Open GitHub Issues to production**.
- 2026-09-20: twenty database-shape or curated-data issues were not closed or rewritten; only their incorrect `non-orchestrator` label was removed so the orchestrator can see their true classification.
- 2026-09-20: this Codex session was not the shared-db orchestrator and did not close marker issue #3297 (orchestrator coordination). At the final 2026-09-22 21:29 UTC check, #3297 had closed and `check-orchestrator-marker --resolve` reported zero active markers. Do not route structural work until a successor claims a new marker.

## 1. What this application is

`popcre/shared-db` is the public source-of-truth repository for the shared Supabase database used by POP Creations applications. It holds migrations and the governance automation that keeps concurrent database authors, reviewers, preview rehearsals, guarded merges, and production promotion from colliding. GitHub is at `https://github.com/popcre/shared-db`; DesignFlow production UI evidence is collected in the DB Data Admin-owned application at `https://data.designflow.app`.

This handoff concerns **repository-maintenance and proof work that does not change database structure**. Structural work belongs to the single live orchestrator. The handoff contract uses issue #2829 (non-orchestrator) as the first restart point; when that issue is finished, the successor may delete this file only after carrying every remaining obligation below into its own handoff or proving it is already durable in its linked issue.

## 2. What we set out to do this session, and why

Albert asked Codex to identify which non-orchestrator GitHub issues the named Claude session was touching, then resolve every other non-orchestrator issue with maximum safe parallelism. The session classified 67 open issues, excluded Claude-owned work, corrected twenty false classifications, dispatched independent agents, landed completed work, and stopped taking new implementation when Albert invoked `wrap-up`.

The objective was not to alter Supabase. It was to close repository-maintenance defects, tests, plans, and live proofs while preserving each issue's owner and avoiding collisions with Claude or the shared-db orchestrator.

## 3. Current state — what is true right now

### Verified repository state at 2026-09-22 20:32 UTC

- At the original 2026-09-22 20:32 UTC snapshot, `origin/main` was `d2c79ca17b5cb5edc653fb9aa54645c6333694b4`. The handoff first landed through PR #3404 at `b055a4141bf91450adacd3a1383decdef9693402`, and its zero-marker correction landed through PR #3406; refresh `origin/main` before implementation instead of treating any recorded SHA as permanently current.
- Highest migration filename on main is `supabase/migrations/20260918180012_prepack_role_read_only_proof_grant.sql`.
- This session made no database, preview, production, or infrastructure change. Preview state was intentionally not inspected or mutated.
- The canonical checkout `D:\repos\shared-db` was clean when closeout began.
- There is no active orchestrator marker. `node scripts/check-orchestrator-marker.mjs --resolve` reported: `NO ACTIVE ORCHESTRATOR: zero open markers.` Queue structural work until a successor opens a marker; zero markers is not permission to dispatch.
- Git committer identity is `Albert Hazan <u2giants@users.noreply.github.com>`.

### Completed and merged by this sweep

- Issue #2401 (non-orchestrator): PR #3358 merged as `20641bc6bbcd4e6e8fe1e2211126837456c045ab`; removed seven stale handoffs; 28/28 focused tests passed.
- Issue #2710 (non-orchestrator): completion PR #2695 is on main at `ef06ca5a`; completion comment `5752075270` was posted.
- Issue #2699 (non-orchestrator): completion PR #2826 is on main at `bfdb19c9`; completion comment `5752075861` was posted.
- Issue #2692 (non-orchestrator): completion PR #2840 is on main at `54e1e3c6`; completion comment `5752076368` was posted.
- Issues #3355, #3331, #3305, and #3068 (all non-orchestrator) were verified completed through merged PRs #3356 (`b15be1ea`), #3333 (`f1fef457`), #3308 (`faed5557`), and #3064 (`a160ca54`).

### Classification repair completed

Only the incorrect `non-orchestrator` label was removed from the following still-open issues; bodies, comments, and open state were preserved: #1431, #1275, #770, #2603, #2601, #2599, #2598, #2427, #2421, #2874, #2875, #2604, #2605, #2358, #2336, #2179, #2176, #1966, #1941, and #2420 (all orchestrator work). They remain for the live structural queue.

### Open pull requests with durable work

1. **PR #3186 → issues #2368, #2369, #2370 (all non-orchestrator).** Open and mergeable at `ddbb2964db825c87dbeaf5cab80e7eb39dbe6c5d`; every reported check succeeds or is legitimately skipped. Changes are `.agent/work/2368/3/{contract,completion}.json`, `scripts/test_production_apply_review_evidence.py`, and `scripts/test_production_migration_guard.py`. Focused verification previously passed 305 tests. It has not been merged.
2. **PR #3375 → issue #2839 (non-orchestrator).** Open at `ec9dcb1e8649b13c4a97c759243ee68fad3055b6`; behavior checks pass, but `Agent work contract` fails because the current enforced contract requires both keyed contract and keyed completion changes in this PR. Changes are `scripts/check-exact-head-approval.mjs` and its test. Earlier implementation commit was `f157616c`; 68 tests passed. It has not been merged.
3. **PR #3188 → issue #2371 (non-orchestrator).** Open and mergeable at `89581bf10626abe79ce7676b6fa06c60d9b30875`; `Agent work contract` fails. It changes `scripts/test_production_owner_decision_evidence.py`. Recover only after PR #3186 because they share the evidence-test lane.
4. **PR #3214 → issue #2372 (non-orchestrator).** Open but conflicting at `a8948ccae28e9dd8c8b04a00f642e9f55e260f71`; agent contract succeeds. It changes legacy `.agent/{contract,completion}.json` and `scripts/test_production_owner_decision_evidence.py`. Recover after PR #3188.
5. **PR #2607 → issue #2596 (non-orchestrator).** Open and conflicting at `1adbde0d0894e90c5fbf779cd2fa787e12a4519f`; checks pass. It overlaps active Claude PR #3320, which remains open and mergeable at `cfbadb6c3f960ba2030f9eb9a783fa3e51ab581e`. The coordination comment is `https://github.com/popcre/shared-db/pull/3320#issuecomment-5752507414`. Do not rebase #2607 until #3320 resolves.
6. **PR #3345 → issue #3342 (non-orchestrator).** Open and mergeable at `a471af1b621bad623ff63291ce259dc4f10480fc`; all reported checks succeed or are legitimately skipped. It is owned by another Codex workstream; do not merge or close its issue without re-establishing ownership.

### Tested branches without a pull request

- Issues #2374, #2375, and #2376 (all non-orchestrator): remote branch `codex/2374-2376-keyed-evidence` exists at `394bf36985aff42cf07b2bfde280a7e57646078c`; source branch `codex/catalog-verification-mutation-2374-2376` exists at `50f303e4dbb3d4324a14ed60ce3cd7b6681f8e57`. The work added 34 mutation tests; the full target file passed 227 tests and representative failing-first proof was recorded. No PR exists.
- Issue #2829 (non-orchestrator): intended files are `tools/reviewer_events.py` and `tests/reviewer_maintenance_cases.py`. No remote branch or PR survived the interrupted worker. Implementation is not started durably.
- Issues #2831, #2787, #3324, and #3348 (all non-orchestrator): a combined implementation was assigned because all overlap `scripts/manage-migration-author-lanes.mjs`, its tests, `scripts/run-governed-review.mjs`, its tests, and related docs. No durable branch or PR survived. Implementation is not started durably.

### Other open obligations

- Issue #2701 (non-orchestrator) is code-complete through merged PR #2702 (`5532d2bd`) but lacks the owner-authorized production browser proof described in §0.
- Issue #3351 (non-orchestrator) waits on the ColdLion vendor.
- Issue #1403 (non-orchestrator) is blocked by live legacy claims #2834, #3294, and #3300 (all non-orchestrator coordination claims).
- Issue #2600 (non-orchestrator) is blocked by structural issue #2336 (orchestrator work).
- Issue #2508 (non-orchestrator) remains the live migration-ledger drift tracker and depends on structural promotions.
- Issue #2290 (non-orchestrator) remains on owner HOLD.
- Issue #2326 (non-orchestrator) was owned by another Codex thread; re-check that thread before touching it.
- Issue #3024 (non-orchestrator) overlapped the named Claude work through #3290 / PR #3332 and remains excluded until that ownership ends.
- Issue #3084 (non-orchestrator alarm) says to keep it open; it is a permanent alarm, not a completion target.
- Coordination claims #3307, #3300, #3294, #2834, and #2745 (all non-orchestrator coordination) are not ordinary bugs and must not be closed by this sweep.
- Issue #3180 (non-orchestrator) says its originating session owns closure; do not close it here.
- Issue #3218 (non-orchestrator) has no shared-db defect to fix; acceptance belongs in DesignFlow.
- Issue #3337 (non-orchestrator) is now closed through merged PR #3318 (`8cf89c5e`).
- Issues #3353 and #3343 (both non-orchestrator) are still open even though consolidation PR #3354 merged as `905ec8e29d1175ce8e312d9fb1c90dbff02e17ca`; the PR owner must post completion evidence and decide closure.

## 4. Everything we tried that did NOT work

1. **Live production proof for #2701 (non-orchestrator).** The `ui-live-workflow` gate stopped before browser access because Albert had not named the exact production resource and action. Only a development Data Admin credential was discoverable; there was no dedicated production Licensing/Admin test identity. No browser or production system was touched.
2. **Direct recovery of PRs #3186 and #3375.** Recovery agents immediately hit the account usage limit on 2026-09-20 and produced no edits. The failures did not invalidate the branches; live status was refreshed on 2026-09-22.
3. **Issue #2829 (non-orchestrator) implementation dispatch.** The worker was interrupted before publishing a branch or PR. Searching the remote on 2026-09-22 found no `codex/2829-grok-evidence-publication` branch. Do not assume its uncommitted work exists.
4. **Combined lane bundle dispatch.** The worker assigned #2831/#2787/#3324/#3348 (all non-orchestrator) did not publish a durable branch. Do not look for or trust an untracked worktree from that run.
5. **Treating labels as truth.** Twenty issues labeled `non-orchestrator` actually changed database shape or curated Master Data. Closing or implementing them in this session would have violated the structural queue. Classification must come from scope, not the label alone.
6. **Broad worktree cleanup.** The cleanup procedure showed an active orchestrator marker and multiple owned branches. The session deliberately removed no other session's worktree or branch.

## 5. Root causes and key findings

- The backlog mixed repository maintenance, live proofs, owner holds, coordination claims, already-landed completion tickets, and genuine schema work under one label. Range-based parallel triage was safe; parallel implementation was safe only after mapping file overlap.
- The evidence mutation PRs are a dependency chain because several touch the same production-evidence test files: land #2368–#2370 through PR #3186 first, then recover #2371 / PR #3188, then #2372 / PR #3214.
- PR #3375's product behavior is not the failing part. Its sole reported failure is current agent-contract bookkeeping, so the next session should repair the keyed `.agent/work/2839/<attempt>/` contract/completion evidence instead of rewriting `scripts/check-exact-head-approval.mjs`.
- PR #2607 cannot be safely reconciled while Claude PR #3320 remains open because both touch `AGENTS.md` and the work-contract/closeout behavior. The signed coordination comment already establishes the dependency.
- `HANDOFF.d/` has no automatically reportable stale file. It has 27 files whose contract issue is closed but which open issues still cite; the repository report explicitly says **do not retire them**. This session may not delete another session's file. The protected list is in §9.
- A GitHub issue remaining open after its PR merges is not automatically ours to close. Issues #3353 and #3343 (both non-orchestrator) are current examples: the consolidation PR is merged, but the author still owns completion evidence.

## 6. Exact next steps

1. **Resume issue #2829 (non-orchestrator) in a new isolated worktree from current `origin/main`.** Re-read the issue, inspect `tools/reviewer_events.py` and `tests/reviewer_maintenance_cases.py`, implement the evidence-head fix, prove failing-first and passing tests, open a signed PR, wait on repository checks, merge it, and close only #2829. You will know it worked when the governed Grok evidence publication accepts foreign untracked files without claiming a different invocation head and all focused tests pass.
2. **Land PR #3186 for #2368/#2369/#2370 (all non-orchestrator).** Re-read PR body and review threads, run `ai-task-gates check --before ship`, refresh checks, and merge because it is currently green and mergeable. Close only the issues whose acceptance is fully proved. You will know it worked when GitHub reports the PR merged and each closed issue has signed completion evidence.
3. **Repair PR #3375 for #2839 (non-orchestrator).** Create current keyed agent contract and completion evidence for issue 2839 without changing the already-passing behavior unless review requires it. You will know it worked when `Agent work contract` and all other required checks pass, then the PR merges and the issue closes with evidence.
4. **Open the PR for #2374/#2375/#2376 (all non-orchestrator).** Recover branch `codex/2374-2376-keyed-evidence`, compare it to current main and issue contracts, rebase or merge current main without losing mutation tests, add current keyed work evidence, and open one signed PR. You will know it worked when the PR shows the 34 intended mutation cases and all 227 target tests pass on current main.
5. **Recover PR #3188, then PR #3214.** Do this sequentially after #3186 to resolve shared test-file conflicts. You will know each worked when current keyed evidence passes, the focused mutation suite passes, and its linked issue closes only after merge.
6. **Wait for Claude PR #3320, then recover PR #2607 for #2596 (non-orchestrator).** Re-read both diffs and preserve Claude's landed contract changes while rebasing the bounded-closeout plan and tooling. You will know it worked when #3320 is no longer open, #2607 is conflict-free, checks pass, and #2596 closes with the merged proof.
7. **Implement #2831/#2787/#3324/#3348 (all non-orchestrator) as one serialized file-overlap bundle.** Use one worktree and one worker because the issues share lane and governed-review files. You will know it worked when all four issue contracts map to tested changes, no duplicate implementation exists, and the single PR passes the offline tools suite.
8. **Re-check other owners before acting on #2326, #3342, #3353, or #3343 (all non-orchestrator).** Read current threads and signed GitHub activity. You will know ownership is safe when the prior owner has completed, explicitly handed off, or is unreachable with a durable recovery contract.
9. **Ask Albert once for the two §0 decisions when their prerequisites are ready.** You will know the #2701 authorization is sufficient when it names the DB Data Admin-owned `https://data.designflow.app`, read-only Property Matches validation, and the two roles; you will know #2290 is released only when Albert explicitly lifts the hold after business confirmation.
10. **At the next natural stop, write a successor handoff and retire this one only under the successor rule.** You will know it is safe when #2829 is done, every still-open item above is carried into the successor file or closed with proof, and no unique decision/dead end would be lost.

## 7. Constraints and gotchas in force

- Start every repository task with `ai-task-gates start --class <class>` and re-check before review, waiting, shipping, production, or infrastructure work.
- Use an isolated worktree from current upstream for every write. Verify the branch before each commit; stage only owned files.
- Never push directly to `main`. Open a PR, satisfy checks, and merge your own non-DesignFlow PR unless a current owner conflict prevents it.
- Sign every GitHub issue, PR, comment, and review with `Posted by Codex chat <CODEX_THREAD_ID> on 916-alien` (use `unknown` only if the variable is empty).
- Only the session that opened an issue closes it unless the issue explicitly and durably hands ownership over.
- Do not route proofs, monitoring, tooling, tests, docs, or repository maintenance to the shared-db structure orchestrator.
- Re-resolve `node scripts/check-orchestrator-marker.mjs --resolve` immediately before any structural handover. Never close another session's marker.
- No colliding parallel agents: map files first; serialize overlapping work. Every dispatch must require a unique worktree and branch verification before commit.
- Production is read-only by default. The current owner exception does not authorize browser proof or manual production action without the exact named authority in §0.
- Do not edit or delete another session's `HANDOFF.d/` file. Presence means open even if its issue is stale; the successor/owner must retire it.
- Do not infer an issue's orchestrator classification from labels. Apply the database-shape / curated-Master-Data test from `AGENTS.md`.

## 8. Access and environment

- Machine: `916-alien`, Windows 11, PowerShell 7.
- Repository checkout for reads/landing: `D:\repos\shared-db`; this closeout used its own Codex-managed worktree.
- GitHub CLI was authenticated for `popcre/shared-db` and could read/write issues, PRs, labels, and branches during the session.
- Git remote `origin` is the authoritative repository. Current main SHA is recorded in §3.
- Production UI: the DB Data Admin-owned application at `https://data.designflow.app`. No production browser session was opened.
- Development Data Admin credentials exist in 1Password vault `vibe_coding`; no secret values were copied into chat, GitHub, logs, or this file. A dedicated production Licensing/Admin test identity was not found.
- No Supabase access token was loaded or used by this session; no live catalog or migration-ledger command was run.

## 9. Open questions and risks

- **Owner authorization risk:** #2701 and #2290 (both non-orchestrator) cannot be completed by guessing; see §0.
- **External-data risk:** #3351 (non-orchestrator) needs the vendor's identity rule. A guessed composite key could corrupt deduplication.
- **Concurrency risk:** PR #3320 is still open; recovering #2607 before it lands would recreate conflicts and could overwrite Claude's contract changes.
- **Contract drift risk:** PRs #3375 and #3188 currently fail the agent contract even though behavior tests pass. Repair the current keyed contract rather than weakening the gate.
- **Ownership risk:** #2326, #3342, #3353, and #3343 (all non-orchestrator) had other owners. Re-check live state before taking them.
- **Referenced closed-issue handoffs — not stale:** `node scripts/report-stale-handoffs.mjs` reported zero retireable stale files and the following 27 files whose contract issue is closed but whose context is still cited by open issues (principally #3399). The report explicitly says **do not retire these** until those citations close or their context moves. Their named owners—not this session—must make that later decision:
  - `2026-08-14T2236Z-al8960ofc-claude-coldlion-history-endpoints.md`
  - `2026-08-17T0016Z-al8960ofc-codex-licensing-plan-review-fixes.md`
  - `2026-08-31T1457Z-edge-dev-codex-historical-mg-apply-plan.md`
  - `2026-08-31T2340Z-edge-dev-claude-coldlion-reply-ready-to-send.md`
  - `2026-09-04T0129Z-edge-dev-claude-coldlion-reply-20260903-ready-to-send.md`
  - `2026-09-04T1109Z-edge-dev-claude-non-orchestrator-queue.md`
  - `2026-09-04T1109Z-edge-dev-codex-expired-claim-recovery.md`
  - `2026-09-04T1303Z-edge-dev-codex-orchestrator-2288-closeout.md`
  - `2026-09-04T2010Z-edge-dev-codex-unauthorized-orchestrator-handover.md`
  - `2026-09-04T2053Z-edge-dev-codex-priority-12-orchestrator.md`
  - `2026-09-06T0030Z-edge-dev-claude-orchestrator-2330-closeout.md`
  - `2026-09-06T1330Z-edge-dev-2-claude-orch-2404-closeout.md`
  - `2026-09-07T0620Z-edge-dev-claude-orchestrator-blocker-issues.md`
  - `2026-09-07T1634Z-edge-dev-codex-five-issue-closeout.md`
  - `2026-09-07T2224Z-edge-dev-codex-orchestrator-transfer.md`
  - `2026-09-08T1650Z-edge-dev-claude-four-blocked-issues.md`
  - `2026-09-08T1735Z-edge-dev-codex-orchestrator-queue-handoff.md`
  - `2026-09-09T0620Z-EDGE-DEV-2-claude-orchestrator-2597-closeout.md`
  - `2026-09-09T1141Z-edge-dev-codex-orchestrator-2625-closeout.md`
  - `2026-09-10T0614Z-EDGE-DEV-codex-orchestrator-2629-closeout.md`
  - `2026-09-10T1930Z-EDGE-DEV-claude-orchestrator-2669-closeout.md`
  - `2026-09-11T0350Z-EDGE-DEV-claude-orchestrator-2689-closeout.md`
  - `2026-09-12T0820Z-edge-dev-claude-production-queue-blocked-on-repairs.md`
  - `2026-09-14T1245Z-edge-dev-codex-production-and-sandbox-closeout.md`
  - `2026-09-15T0014Z-EDGE-DEV-claude-orchestrator-2893-closeout.md`
  - `2026-09-19T0000Z-edge-dev-claude-orchestrator-3275.md`
  - `20260906T205200Z-edge-dev-shared-db-orch-5e0e7c81-orchestrator-closeout.md`

## Part B — sub-agent accounting

### `/root/triage_2300`

- Asked: classify the assigned 2300-series open issues, identify Claude overlap, blockers, and immediately closable work without edits.
- Actually did: returned disposition evidence used to separate mutation-test PR chains, other owners, claims, and structural dependencies.
- Found: #2368–#2372 and #2374–#2376 (all non-orchestrator) have durable partial work; #2326 has another owner; #2336 is structural.
- PR/branch/worktree: no edits, branch, PR, or surviving worktree.
- Deliberately did not do: close issues or modify shared files because triage was read-only and ownership was mixed.

### `/root/triage_2400`

- Asked: classify the assigned 2400-series issues and identify work already landed versus structural queue work.
- Actually did: supplied the evidence behind the #2401 completion and the list of false non-orchestrator labels.
- Found: #2401 (non-orchestrator) could be completed by retiring seven stale handoffs; multiple 2400-series tickets were database-shape work.
- PR/branch/worktree: #2401 ultimately landed through PR #3358, merge `20641bc6`; the triage agent itself made no persistent edit.
- Deliberately did not do: take structural issues out of the orchestrator queue.

### `/root/triage_2600`

- Asked: classify 2600-series issues, locate merged-but-open completions, and map PR/file overlap.
- Actually did: identified completion evidence for #2692, #2699, #2710 (all non-orchestrator), the #2596/#2607 overlap, and #2600's structural dependency.
- Found: PR #2607 must wait for Claude PR #3320; #2600 is blocked by structural #2336.
- PR/branch/worktree: completion PRs are listed in §3; no triage worktree remains.
- Deliberately did not do: rebase #2607 across a live Claude branch.

### `/root/triage_new`, `/root/triage_2700`, `/root/triage_3100`, `/root/triage_3300`, `/root/triage_old`

- Asked: independently partition the remaining issue ranges and return conclusions, current owners, Claude overlap, and safe actions.
- Actually did: their combined findings produced the 67-issue classification map, the completed-ticket list, the live-proof blockers, the active-owner exclusions, and the twenty-label correction list in §3.
- Found: #2701 needs production proof; #3084 is a permanent alarm; #3180 owns its own closure; #3218 belongs to DesignFlow proof; #3337 is complete; #3353/#3343 remain author-owned after PR #3354.
- PR/branch/worktree: read-only; no persistent edits or surviving worktrees.
- Deliberately did not do: take named Claude work, close coordination claims, or mutate structural issues.

### `/root/fix_2829`

- Asked: implement #2829 (non-orchestrator) in a unique worktree, verify its branch before commits, test, open and merge its own PR, and close only its issue.
- Actually did: began investigation but was interrupted before any durable publication.
- Found: the intended change surface is `tools/reviewer_events.py` and `tests/reviewer_maintenance_cases.py`.
- PR/branch/worktree: no remote branch or PR exists as of 2026-09-22; no live agent/worktree remains.
- Deliberately did not do: claim completion without a pushed branch and passing evidence.

### `/root/fix_lane_bundle`

- Asked: resolve #2831, #2787, #3324, and #3348 (all non-orchestrator) together because they overlap lane-management and governed-review files.
- Actually did: received the combined scope but did not publish a durable implementation before interruption.
- Found: the shared surface is `scripts/manage-migration-author-lanes.mjs`, its tests, `scripts/run-governed-review.mjs`, its tests, and related docs.
- PR/branch/worktree: no durable branch, PR, or live worktree.
- Deliberately did not do: split overlapping edits across parallel agents.

### `/root/recover_2374`

- Asked: recover the existing #2374/#2375/#2376 (all non-orchestrator) work, reconcile it with current main, open a PR, and close only owned issues after proof.
- Actually did: verified the durable remote branches but did not open a PR before the run stopped.
- Found: branches and test counts are recorded in §3.
- PR/branch/worktree: `codex/2374-2376-keyed-evidence` at `394bf369`; source branch at `50f303e4`; no PR; no live worktree.
- Deliberately did not do: discard the 34 mutation tests or pretend a branch was shipped.

### `/root/recover_3186`

- Asked: refresh PR #3186, address any remaining review/check problem, merge, and close only #2368/#2369/#2370 (all non-orchestrator) when proved.
- Actually did: the agent immediately hit the account usage limit and made no change.
- Found: no new technical finding. The parent refreshed live state on 2026-09-22 and found the PR green and mergeable.
- PR/branch/worktree: PR #3186 remains open at `ddbb2964`; no surviving recovery worktree.
- Deliberately did not do: claim a merge after the usage-limit failure.

### `/root/recover_3375`

- Asked: repair the failing contract on PR #3375, merge it, and close only #2839 (non-orchestrator) after proof.
- Actually did: the agent immediately hit the account usage limit and made no change.
- Found: no new technical finding. The parent refreshed live state on 2026-09-22 and confirmed the agent-contract failure persists.
- PR/branch/worktree: PR #3375 remains open at `ec9dcb1`; no surviving recovery worktree.
- Deliberately did not do: weaken the agent contract or claim behavior work was defective without evidence.

### Earlier completion workers whose ephemeral names were compacted from this session

- Asked: finish independently owned, non-overlapping issues and ship their own work through PRs.
- Actually did: delivered the completed items and merge proofs listed in §3, including #2401, #2710, #2699, and #2692 (all non-orchestrator).
- Found: several issues were already functionally complete but lacked durable completion comments or stale-handoff retirement.
- PR/branch/worktree: all durable PRs and merge SHAs are in §3; no live agent or worktree remains.
- Deliberately did not do: close issues opened by another owner without explicit completion ownership.

## Completeness self-audit

1. **Yes, a brand-new developer can continue without this chat.** §§1–3 define the repository, objective, exact live state, SHAs, PRs, branches, tests, and ownership; §6 gives ordered restart actions with success gates.
2. **Yes, the file preserves the session's working knowledge.** §§4–5 record failed attempts, classification traps, dependency ordering, and why apparently ready work is still open; Part B accounts for every dispatched agent and deliberate non-action.
3. **Yes, all execution dimensions are present.** §§0–9 cover decisions, background, goals, state, failures, findings, actions, constraints, access, risks, and verification evidence. No secret value appears.
4. **Yes, the owner-decision sweep passes.** A line-by-line review of §§1–9 and Part B found only two Albert decisions: exact authority for #2701 and lifting the #2290 hold; both are consolidated with recommendations in §0. The vendor answer for #3351 is explicitly external, and settled classifications/marker ownership are listed under “do not re-ask.”
