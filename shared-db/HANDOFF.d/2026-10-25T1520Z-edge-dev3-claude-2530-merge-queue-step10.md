---
issue: 2530
status: OPEN
owner: claude/a68bf478-9a52-413f-8710-4695c0109ffa
---

# Handoff — popcre/shared-db #2530 merge-queue Step 10/11 (edge-dev3)

**Session:** Claude chat `a68bf478-9a52-413f-8710-4695c0109ffa` on `edge-dev3`
**When:** 2026-10-25, 11:17 AM EDT
**Plan issue:** https://github.com/popcre/shared-db/issues/2530
**Predecessor handoff:** https://github.com/popcre/shared-db/blob/main/HANDOFF.d/20261021T1410Z-edge-dev-mimo-2530-merge-queue-steps9-10.md

## 1. What I was doing and why
I was finishing #2530 Step 10: one genuine reviewed migration has to land through GitHub's native merge queue to prove ordering. Albert also set a new rule mid-session (verbatim): "no session is allowed to freeze merges for more than 1hr. that's the new rule".

## 2. What I actually did
- Paused the queue proof on Oct 21 after Albert said: "Yes, it was turned off on purpose. Leave it off for now." Then, on his instruction "merge without it", I merged PR 4543 (dam-search) through Guarded Merge at 12:40 PM EDT Oct 21 (merge 1b7edfedb).
- PR 4547 (issue 4548) caps `PROMOTION_FREEZE_MAX_TTL_MINUTES` at 60. It merged Oct 21 at 11:04 PM EDT.
- Prepared the queue for re-activation (dry run plus 89/89 queue tests). Activated ruleset 25753925 on Oct 23 at 4:33 PM EDT, on Albert's "ok now". Someone later replaced it with ruleset **25808522** (created Oct 24 at 11:24 PM EDT), and that one is active.
- Oct 25: dispatched Guarded Merge for PR 4700 (refused: "exactly one live author claim") and PR 4702 (refused: head changed). The PopSG session then drafted PRs 4620 and 4700, which unblocked oldest-migration order, and re-queued PR 4702.

## 3. Preview / production
Nothing applied by this session to preview or production.

## 4. Half-finished
**PR 4702** (#4210 PopSG search timeout, version 20261025121119) was **IN THE MERGE QUEUE at 11:17 AM EDT Oct 25** and has not merged yet. Its landing is the Step 10 proof. Its author session is `local_6c3fbc22…` ("PopSG: debounce and cancel Guides search requests").

## 5. What I own
Nothing. The closeout check returned ok: zero claims and zero stages. I have no open PRs except this handoff PR.

## 6. Next action
Watch PR 4702's merge_group run. When it merges, record on #2530: the merge_group run ID, the merge time, the merged SHA's `Post-merge preview rehearsal` status, and proof that a following group was held (Step 11). Then tick `- [ ] live proof`. If the group is ejected, read the Merge Queue Gate log and fix the root cause. Never use `--admin`.

## 7. Blocked on
Nothing except PR 4702's queue run. Drafted PRs 4700 (zcode image-similarity, approved, lapsed author claim) and 4620 (#4585, failing, idle since Oct 22) need their owners. Restore them by marking them ready and renewing the claim. Albert has an open business question: should we buy a larger database if Guides search stays slow?

## 8. What did NOT work
- `enqueuePullRequest` directly: refused because "Migration guarded merge authorization is pending". **Use Guarded Merge dispatch instead.** It routes into the queue automatically when the queue is active (`guarded-migration-merge.yml`, the "Queue admission" step).
- `gh pr merge --auto` without --merge/--squash: refused when not interactive.
- Stale-place nudge on PR 4518: a `cross-referenced` timeline event reset its 24h clock, so the draw was still refused.
- PR 4547's evidence pair: the contract was committed inside the implementation commit, so it failed the files_changed and "only evidence follows head_sha" rules. Fixed by retiring generation 1 and sealing generation 2.
- `ai-pr-wait` / node tests failed with ENOENT on `/var/tmp/ai-sessions-1000/claude-<id>/`. The fix is `mkdir -p` on that folder.
- The merge queue gate's `assertOldestMigration` has no stale-place escape. Only drafting an older migration PR frees the order.

## 9. Possibly stale
main fe3de0f86 and max migration 20261024234538 (both checked 11:17 AM EDT Oct 25). Ruleset id 25808522. PR 4702 queue state.

## Next-session prompts
Two separate prompts follow: one for the queue coordinator, and one for the unrelated verification outcomes.
## Prompt 1 — Coordinator: finish the merge-queue proof and the Guides search close-out (popcre/shared-db)

```
You are the coordinator for the remaining popcre/shared-db merge-queue and Guides-search work. Read AGENTS.md, load shared-db-change, and declare `ai-task-gates start --class shared-db`. Work in your own worktree from origin/main. Do not do the work yourself: start one subagent per workstream below, and track them yourself. Never merge with --admin. Never cut a merge freeze short. Owner rule (Albert, verbatim): "no session is allowed to freeze merges for more than 1hr. that's the new rule". The code already enforces a 60-minute cap (PR 4547). The merge queue is ON (ruleset 25808522). Albert said to turn it on: "ok now". Do not turn it off.

STATE AT HANDOFF (11:14 AM EDT Oct 25):
- Queue: active. Non-migration PRs have already passed through it (merge_group runs for PRs 4632, 4730, 4745, 4747). No migration has merged through it yet. That migration landing is the #2530 Step 10 proof that is still owed.
- PR 4702 (PopSG search 30 s function timeout, #4210, version 20261025121119, head b9883935): it has an exact-head APPROVE. Its author session (local_6c3fbc22…, "PopSG: debounce and cancel Guides search requests") is idle, with a background job that was meant to re-queue it once PR 4744 landed. PR 4744 MERGED at about 11:08 AM EDT. Its earlier queue group was ejected at 9:22 AM EDT for "migration queue order refused … behind open PR #4700".
- PR 4700 (image-similarity, zcode/486-image-embed-vectors, #4692) and PR 4620 (#4585 dflow tracking_grid_archive) are both DRAFTED. They hold no place in the oldest-migration order, so the queue can move. 4700 is approved, but its ZCode owner's author claim had lapsed: a guarded merge at 8:17 AM EDT refused "exactly one live author claim". 4620 has failing checks and has been idle since Oct 22.
- Plan issue #2530 carries a `- [ ] live proof (Step 10 migration through merge queue)` box.

WORKSTREAM A — Step 10 proof via PR 4702 (subagent):
1. Check whether 4702 is queued or merged. If it is not, confirm it still has an exact-head APPROVE at its live head. If the head moved, get a new draw with SHARED_DB_AUTHOR_ENGINE set, then run-governed-review.
2. Admit it with `gh workflow run guarded-migration-merge.yml -f pull_request=4702 -f head_sha=<head>`. With the queue on, this enqueues it automatically.
3. Wait with ai-pr-wait in the background. If the group is ejected, read the Merge Queue Gate log and fix the root cause. Never bypass.
4. Done when: you have the merge_group run ID, the merge time in EDT, the merged SHA's Post-merge preview rehearsal status, and proof that a following group was held. Post them on #2530 and tick the live-proof box. Step 11 ("merged-SHA preview and following-group hold proof") is part of this.

WORKSTREAM B — #4210 Guides search close-out (subagent, after A merges 4702):
Promote 4702 to production through the automatic promotion path. Time a live "disney" Guides search in PopSG. The last measurement was a timeout at about 8 s, then 5.9 s on retry. Post the proof on #4210 and close it if the search no longer times out. If it is still slow, do not buy a larger database: Albert has not decided on that. Report the timing and stop.

WORKSTREAM C — drafted PRs 4700 and 4620 (subagent, after A):
For each one, check whether its owner session is live. If it is, tell the owner it was drafted only to unblock queue order, and how to restore it (mark ready, renew the author claim). If the owner is gone, follow AGENTS.md ownership transfer: re-claim, refresh to main, get a new exact-head APPROVE, and land it through the queue. Never close or force-push another session's PR. Done when each one is merged, or carries a verbatim blocker line on its PR.

Sign every GitHub post with $AI_GH_SIGNATURE. Report to Albert in plain words: 120 words at most, ending with a "Still open" block. Every time you quote is in EDT.
```

---

## Prompt 2 — Verification outcomes watch (popcre/shared-db) — separate, not related to the queue work

```
Resume the popcre/shared-db verification outcomes under your own identity, from current main. #2336 and #2358 are complete. Five outcomes are still open, and each card holds its current status. Background: https://github.com/popcre/shared-db/blob/main/docs/verification/eight-outcomes-wrapup-20261018.md

- #2541: ColdLion item mapping. Waiting on licensing staff, last seen Oct 16. Recheck the issue for a staff answer. If one is there, apply it and prove it live.
- #2598 and #2599: NBCU and Paramount vendor access. None exists yet. Recheck whether access has been granted. If it has, finish the outcome and prove it live.
- #2421: needs one clean week of observation. Observe and close only after the window has fully elapsed.
- #2427: needs month-end after Oct 31, then quarter-end. Observe each one only after it has passed.

Do not contact staff or vendors on Albert's behalf. Do not touch #2530: another coordinator owns the merge-queue proof. Leave "- [ ] live proof" on each issue until it is proven. Sign GitHub posts with $AI_GH_SIGNATURE. Report to Albert in plain words: 120 words at most, ending with a "Still open" block. Every time you quote is in EDT.
```
