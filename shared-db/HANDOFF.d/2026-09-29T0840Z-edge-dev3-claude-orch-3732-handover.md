---
issue: 3464
status: OPEN
owner: claude/orch-3732-handoff
---

# Shared-db orchestrator #3732 handover (Claude chat 626c9036, edge-dev3)

All times America/New_York (EDT), read from the clock. Facts checked 4:35 AM EDT, 2026-09-29.

## 0. Owner rulings given in this chat (quote them; in force)

- 2:55 PM EDT 2026-09-28: "force through the stuck hourly limit. everything is just stopped waiting." → acted on by adding repo secrets `POP_AI_WATCHERS_APP_ID` / `POP_AI_WATCHERS_PRIVATE_KEY` (piped from 1Password item "GitHub App - pop-ai-watchers", vault vibe_coding) and PR #3759 (read-only app token for guard steps, merged 2165881c).
- ~3:05 PM EDT: "put #1941 on ice for 1 week" → recorded on #1941 (hold until 2026-10-05; dependents #2601, #2541 also parked).
- ~5:45 PM EDT: "restore the merge line" → the merge-queue ruleset was re-created by an unknown session at 5:12 PM EDT (ruleset 24142420, active). Not yet verified against docs/merge-queue-operation.md by this session — see §6.
- ~10:50 PM EDT: "add stepfun to the rotation" → PR #3657 (StepFun into rotation, Linux-only gating already built) rebased, in the protected-file queue (draft, awaiting its turn). Not merged.
- Relayed only (NOT from this chat; treat as that session's authority, not mine): another session ("Blocked Claude sessions investigation", local_c3b058d6) relayed Albert's "kill the rule that says no required check may be dropped without my say. cut the gates" → its PR #3788 (gate cutback) is theirs.

## 1. State (checked 4:35 AM EDT)

- `origin/main` = `102a43f6` (merge of #3731). Max migration on main: `20260929071000` (WildBrain).
- Merge-queue ruleset 24142420 active (recreated 5:12 PM EDT by unknown actor; 24127133 was deleted ~4:50 PM EDT by unknown actor; see #2530 comments). Classic branch protection also enforces 16 required checks.
- Guarded Merge accepts a PR behind main unless the freshness classifier finds overlap (`scripts/manage-migration-author-lanes.mjs` ~L9024, `classifyBranchFreshness`). Approval carries forward when the PR diff is byte-identical ignoring `.agent/` (#2758) — proven on #3695 at 2:57 AM.
- **Every merged migration backdates all other open migration PRs** → they must re-reserve via the claim-version supersession tool and get fresh approvals. Merge approved migration PRs immediately.
- **Preview lane is blocked** by leftover preview-ledger entry `20260928145444` (old #3672 version). #3814 (allowlist entry) merged ~3:30 AM; helper for the cleanup (reconciliation workflow) was to run on #3814 merge — NOT confirmed done. Until done, preview for #3464, #3725, #3400, #2179, #3683 (NBCU), #3685 (WildBrain) all refuse ("Remote migration versions not found in local migrations directory ... 20260928145444").
- Production recovered live tonight (owner-authorized "recover the five"): #2357, #3457, #3498 applied and CLOSED with completion records; #3418 completion recorded + PopDAM retry proof (comment 5881603138) and CLOSED. **#3464 NOT applied** — blocked by the preview leftover above.
- Merges since 2:00 PM 2026-09-28 (by this session's conductor or others): 3513, 3516, 3519, 3528, 3567, 3606, 3632, 3658, 3672, 3673, 3691, 3692, 3693, 3695, 3698, 3699, 3701, 3702, 3703, 3713, 3717, 3722, 3723, 3731, 3734, 3741, 3742, 3744, 3747, 3748, 3750, 3759, 3760, 3765, 3768, 3783, 3785, 3789, 3792, 3800, 3811, 3814, 3816.
- Issues closed tonight: #2357, #3457, #3498, #3418, #3682, #3743, #3756, #3807, #3746(measured), #1030/#1039 (ai-devops watches).

## 2. Ordered next actions (successor)

1. Confirm the preview-ledger reconciliation for `20260928145444` (→ `20260929040458`) ran after #3814 merged; if not, run it via the supported reconciliation workflow (allowlist entry from #3814). Verify the preview ledger. Post on #3672, #3464, #3725, #3400.
2. #3464 (structural): owner-authorized recovery — preview, dry run, business-risk gate, review record, apply only 20260924183947, verify live, completion record, close. Pause merges while it applies.
3. Automatic promotion + live proof, then close: #3725 (merged #3741), #3400 (merged #3734; risk-gate fix #3789 merged), #3683 NBCU (merged #3695), #3685 WildBrain (merged #3731; loaders in u2giants/licensor-source-data already merged).
4. Merge #3711 (#2179, structural): approved twice at its current head (Grok + DeepSeek); last failure was only a network timeout on Cross-PR collision (rerun done 4:22 AM). Then #2179 preview/prod/live proof, then build #2176 (scope block names objects; extend plm.erp_* path; `plm.import_coldlion_vendors(jsonb)` does not exist live).
5. #3818 (allocator fix for #3730 slot 2): approved; refused "not based on current main tip" — merge main in, refresh evidence (evidence-only commit), re-approve if needed, merge. Then #3730 Peanuts: renumber (WildBrain 20260929071000 is newer than Peanuts' 20260929045359), slot-1 + slot-2 fresh approvals, merge, promotion, live proof, close #3684.
6. #3620 → then claim transfers #2110 (#3378), #3175 (#3307), #2662 (#3294) via the command #3620 adds. #3620 is second in the protected-file queue after #3757; owned by the "Blocked Claude sessions investigation" session's fixer.
7. Protected-file queue (only ONE ready PR at a time for scripts/manage-migration-author-lanes.mjs, else reviewer draws refuse): #3757 (only ready PR; DeepSeek APPROVE at 54c16961, but "Tools offline tests" fails: "scripts/migration-retirement-tombstones.test.mjs: allowlisted 2 but found 3" — fix the allowlist deliberately, push, re-review) → #3620 → #3657 (StepFun) → #3808 (verdict-archive schedule) → #3396 → #3787 → #3647 (then DesignFlow chain) → #3627 → #3622/#3625/#3626/#3666 → #3636 → #3593 → #3727 (last).
8. DesignFlow chain (structural): after #3647 → record #2870 complete → preview #3707 (#2874) and #3708 (#2875) (both approved) → open/review #3737 and #2873 (written, pushed on branches) → then DesignFlow practice load (DesignFlow session's job) → Albert picks switch-over window.
9. Other ready/near-ready: #3796 (python3 fix, needs review), #3736 (#3735 rate-limit wait), #3753, #3769 (#3400 single-column split — possibly redundant now that #3789 merged; decide or close), #3788 (other session's gate cutback).

## 3. What did NOT work (do not repeat)

- **Auto-updating approved PRs from main before merging** (my conductor loop, ~1:10–2:40 AM): voided approvals and evidence on #3814, #3711, #3811, #3695, #3792 because evidence records point at the old base. Disabled (`ALLOW_UPDATE` flag file absent). Guarded Merge does not need the branch at main tip unless files overlap.
- Parallel helpers each rerunning checks / dispatching Guarded Merge burned the Actions installation budget and cancelled each other (one pending run slot). A single conductor + push freeze fixed it.
- Disabling/deleting the merge-queue ruleset silently dropped queued PRs.
- I cancelled Reviewer Start Watch run 36487949025 believing it held the author lock — wrong; it was healthy. Real holder was Shared Supabase Migrations run 36506351098 that died on rate limit without releasing (fixed by #3792). Re-dispatched the watch as run 36510540879.
- Shared instruction files under /tmp/claude-1000 were overwritten by another session and later the scratchpad was wiped; keep briefs under ~/.cache or inside worktrees.
- Qwen: every draw on edge-dev3 fails ("Cannot find module" / "spawn E2BIG"); fix is ai-devops PR #1035 (other session). Excluded only for #3730 (per-PR exclusion only). Gemini's blank verdicts were caused by a 4:51 PM change telling reviewers to run commands (fixed ai-devops#1027) and later by logs written into the reviewed checkout (#3816 merged).
- Helpers repeatedly hand-renamed migration versions → claim mismatches; always use the claim-version supersession tool.

## 4. Sub-agents at handover (all belong to chat 626c9036; they stop when this session ends)

- Conductor loop script (/home/ahazan/.cache/conductor-626c9036/loop.sh, drive.sh, gm.sh, queue): STOPPED (STOP file created 4:35 AM). Successor should run its own conductor; the scripts are reusable (edit SIG).
- #3464/#3418/#3457/#3498 recovery helper: 3 done+closed; #3464 waiting on preview cleanup.
- Preview-cleanup / claim-transfer helper (#3672/#3814/#3620): cleanup after #3814 unconfirmed; claim moves wait on #3620.
- ColdLion helper: #3711 approved/ready; #2179, #2176 not started.
- Licensor helpers: NBCU and WildBrain merged (promotion/proof pending); Peanuts #3730 needs #3818 then renumber+reviews.
- #3400 helper: waits on preview; #3789 merged.
- #3725 helper: waits on preview.
- DesignFlow helper: waits on #3647.
- Protected-file queue manager: #3620 at head.
- Qwen helper: waits on ai-devops #1035; incidents 20260929T033632Z-edge-dev3-qwen-2010410 and 20260929T051048Z-edge-dev3-qwen-3700126 open.
- Gemini: incidents resolved; 20260929T052626Z-edge-dev3-gemini-3802603 closes when #3816 merged (it did — resolve it).
- StepFun helper: #3657 in queue.
- Worktrees: many under .claude/worktrees (231 total incl. other sessions). Mine are live/unmerged work; do not clean without cleanup-worktree audit.

## 5. Blocked on Albert

- Nothing technical. #1941 (Laura/Ilona licensed-property sign-off) on hold until 2026-10-05 per Albert.

## 6. Stale-risk facts

- main SHA/max migration above (4:35 AM). Merge-queue ruleset 24142420 not verified vs docs/merge-queue-operation.md. Actions installation quota now shared with app token for read steps (#3759) — impact not measured. #3748 cut runs/push to median 9 (posted #3746).

## 7. Secrets / docs

- Secrets sweep: no credential printed or created; GitHub App key piped from 1Password into repo secrets (IDs only: item "GitHub App - pop-ai-watchers", vault vibe_coding). Nothing new to store.
- Docs pass: nothing outside this handover is stale; rulings recorded on their issues.

Posted by Claude chat 626c9036-7381-4131-aeee-6e29883153c6 on edge-dev3
