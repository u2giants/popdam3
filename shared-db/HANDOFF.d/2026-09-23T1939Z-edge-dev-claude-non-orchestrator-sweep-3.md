---
issue: 2839
status: BLOCKED
owner: claude/handoff-sweep-successor-3449
---

# Non-orchestrator sweep — successor 3 (after 2026-09-22T2300Z-edge-dev-claude-non-orchestrator-sweep-successor)

The predecessor file stays in place because #2839 is still open. Retire both files in the PR that closes #2839.

## 0. Owner decisions (put all of these to Albert in ONE message before starting work)
- **Blocking, outside this workstream:** ai-devops#683 (Muse provider returns 404 model_not_found). It is assigned to Albert and is still open. Recommendation: let an ai-devops session repair the wrapper or model id. Albert needs to say who owns it.
- **Step 9, decision needed:** #2701 and #2290 are waiting on owner rulings. The earlier handoffs have the text. Ask once and recommend an answer for each.
- Already settled, do NOT re-ask:
  - Reviewers are Muse and Grok only (Albert, 2026-09-23 chat).
  - There is no reviewer concurrency cap (owner ruling, 2026-09-16).
  - Albert does not merge; the session merges.

## 1. What this is
`popcre/shared-db` is the single source of schema for the shared Supabase database used by CRM, DAM, PIM and DesignFlow. This sweep closes non-orchestrator tickets: tooling, evidence and CI work that never changes the database structure.

## 2. Goal
Albert's request (2026-09-23): close #2368/#2369/#2370 properly after PR #3186 merged (merge `00593061`), then do steps 3–10 of the predecessor handoff. Reviewers: Muse and Grok only. Work in fresh worktrees from origin/main.

## 3. Current state (2026-09-23 19:39Z)
- **PR #3435** closes #2369 and #2370. It kills the two guard mutants that survived PR #3186.
  - Branch `claude/2369-2370-surviving-guards`, head `ac75a4a9b2f7e8e581eb4add01f0b63f886ba313`, worktree `.claude/worktrees/non-orchestrator-sweep-cont-22b565`.
  - Grok APPROVED this exact head.
  - The guarded merge was refused twice: run 35904556674 (a collision-check fetch flake; a rerun passed) and run 35905345033 (a required check failed).
  - That failed check is "supabase/tests against an ephemeral database" in run 35901557341. It is failing repo-wide on docker `toomanyrequests` and a psql apt stall.
  - The fix is **PR #3452**, owned by another Claude session (branch `claude/ghcr-authenticated-pull-aa4791`). It was still OPEN at 19:39Z.
- **#2368:** not re-checked yet. Confirm whether PR #3186 covered it fully. If it did, close it with signed proof.
- **PR #3438** covers #2374–#2376.
  - Worktree `ship-2374-evidence`, head `5b9a18a0129109356d10a42dcb6d6468b4ce4b53`.
  - The Muse assignment, sequence 3630, failed with a provider 404.
- **PR #3375** covers #2839.
  - Worktree `ship-2839-evidence`, head `96b37034ecdf5c2eb3899f5efc8b0ba63b01739b`.
  - Now marked ready. Muse was drawn, lease `refs/db-review-active-v2/muse-spark-1.3-contributor/2839-3375-96b37…`, and no verdict has come back.
  - The #2839 issue scope block now has `service_class: maintenance` and `change_type: repo-maintenance`.
- **#3449** (non-orchestrator, reviewer-tooling) is owned by this workstream and not started. It covers the stale legacy ref `refs/db-review-active/grok-4.6`, which is for #2506 / PR #2726, merged 2026-09-14. The reaper does not list it, so every Grok replacement draw is refused with "grok-4.6 holds other live leases".
- Steps 5–10 are not started.

## 4. Dead ends
- `--release-failed-reviewer` with the `review_target_superseded` code on the stale Grok ref is refused: "an existing verdict for the exact head forbids reviewer release".
- `--failing-check` works only with `local_dependency_unavailable`.
- Rerunning the ephemeral-database job three times failed the same way. Do not keep rerunning it until #3452 lands.
- Never hand-delete the lease ref (AGENTS.md).

## 5. Key facts
- The replacement loop in `scripts/manage-migration-author-lanes.mjs` (around line 6734) skips any reviewer in preflightBusy when `concurrentLeases` is false. The legacy v1 ref makes Grok count as busy.
- The guarded merge refuses before taking the merge lane if any required check on the head is failing.
- Draw a reviewer: `--assign-reviewer --issue I --pr P --head-sha H --reviewer-allowlist grok-4.6,muse-spark-1.3-contributor`. It refuses draft PRs. Loop while it reports "occupied".
- Run the review: `node scripts/run-governed-review.mjs … -- new <session> --prompt-file F --review-kind diff --decision "…"`. Keep the worktree clean and do not pass `--base` or `--assert-head`.

## 6. Next steps
1. Wait until #3452 merges. Poll at least every 5 minutes and never use `gh run watch`. Then rerun the failed job: `gh run rerun 35901557341 --failed -R popcre/shared-db`.
   - Done when: the ephemeral-database check is green on `ac75a4a9`.
2. Dispatch the guarded merge: `gh workflow run guarded-migration-merge.yml -R popcre/shared-db -f pull_request=3435 -f head_sha=ac75a4a9b2f7e8e581eb4add01f0b63f886ba313`. Close #2369 and #2370 with signed proof comments, then check #2368.
   - Done when: #3435 is MERGED and all three issues are closed.
3. Fix #3449: make the reaper retire a legacy v1 lease whose PR is merged and whose verdict exists. Work in a new worktree, with one independent reviewer.
   - Done when: `--replace-failed-reviewer` can draw Grok.
4. Replace the failed Muse on #3438 (slot 1, failed sequence 3630, `provider_unavailable`, `--confirm-no-verdict --confirm-no-artifact`). Do the same for #3375 if Muse gives no verdict. Review, guarded-merge, and close #2374–#2376 and #2839. Retire this file and the predecessor file in that PR.
5. Predecessor steps 5–10: PR #3188, then #3214. PR #2607 after PR #3320. Bundle #2831, #2787, #3324 and #3348. Re-check the owners of #2326, #3342, #3353 and #3343. Do §0. Write the next handoff.
6. **At the end: re-read every remaining step above to the plan-end and report any drift your work caused.**

## 7. Constraints
- Sign every GitHub post: `Posted by Claude chat <id> on <machine>`.
- Stage only your own files. Never bare `git stash`. No production database commands. Don't shop for reviewers.
- Keep polling while waiting; do not end the turn to report "still waiting".

## 8. Environment
- Machine edge-dev, working in Git Bash.
- `export AI_GROK_STATE_DIR=/c/Users/ahazan/.grok-review-state`
- `export AI_MUSE_CALLER=claude`
- `gh` is authenticated. Secrets are in the 1Password vault `vibe_coding`; none are needed here.

## 9. Risks
- If #3452 stalls, every PR stays blocked. Look at its checks rather than rerunning ours.
- Muse outages come and go. A later draw may succeed.

Posted by Claude chat 92a42be3-3e86-48d4-976d-a33d0bdc6679 on edge-dev
