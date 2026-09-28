---
issue: 3458
status: OPEN
owner: claude/orch-3653-handoff
---

# Shared database orchestrator #3653 handover (Claude chat 1b699f56)

All times America/New_York (EDT), read from the clock. Facts checked 12:46 PM EDT, 2026-09-28.

## 0. Owner rulings given in this chat (quote them; they are in force)

- "no, devopswithkube is not a reviewer" — then "i don't need an independent production reviewer. remove that requirement" → delivered: PR #3667 (merge 66c7b715), ai-devops PR #980 (26460e30). AI allocator exact-head APPROVE still required.
- "none of the reviewers should be read-only" → in progress (see §4, reviewer-writable agent).
- "yes, recover the five. never ask a human to approve. ... ai has to do everything for me without asking me to do manual things. institute that." → recovery in progress (§3); rule being written into instruction sources via ai-devops/shared-db PR #3673 (open).
- "no don't cancel the two leaked sign-in tokens. we can re-evaluate when all the issues are closed" (incident u2giants/ai-devops-private-config#3).
- #2179: Albert answered "keep" — ingest all 14 ColdLion /itemImages fields (recorded on #2179).
- "yes download" — PostgreSQL 17.9 binaries downloaded to ~/opt/pg17 on edge-dev3 (checksums verified). Test DB for #770 was built and then deleted after the rehearsal.
- DeepSeek credit topped up by Albert at ~12:45 PM EDT; DeepSeek is usable again.
- Only genuine business questions go to Albert. Open one: #1941 needs Laura and Ilona to sign off which licensed properties POP will use (blocks #2601, #2541).

## 1. State

- `origin/main` = `c0708496`; highest migration version on main `20260928003740` (superseded; replacement is PR #3672).
- GitHub API quota for the shared u2giants token ran OUT from ~12:40 PM to ~1:43 PM EDT because ~15 helpers ran at once. It showed 5000 remaining at 12:46 PM. **Keep helpers to bounded calls; never poll faster than a few minutes.**
- Merge queue on `main` was turned on at 12:02 PM EDT by the #2530 session; Guarded Merge refuses it ("not the exact approved one-PR queue") until PR #3567 (queue read-back) merges.
- Reviewer/lane allocator jammed: `REFUSED: refs/db-coordination/author-acquisition is occupied` since ~12:16 PM EDT; a recovery helper was dispatched (§4).
- Protected claims #3378 (#2110), #3307 (#3175), #3294 (#2662) still belong to the previous route; transfer waits on PR #3620 (approved at head 7e2d7e86, its guarded merge failed; reason unread due to rate limit).
- Production: #2995 (20260920202755) and #3418 (20260923040630) recovered live and CLOSED today. #2357 (20260925193145), #3457 (20260925222432), #3498 (20260925222635) NOT applied yet; failed preview 36451808463 may have left the preview lock held. #3464 follows #3418.
- #3458: merged 4b451fb0, on preview, blocked from production by evidence-workflow mismatch; orchestrator chose a replacement migration → PR #3672 (reissue as 20260928145444, retire original) got REVISE; being revised.
- #3539 CLOSED (authenticated page proof passed). #3655 closed as duplicate of #2357.

## 2. Open PRs this session drove (merge order where it matters)

Protected-file queue (`scripts/manage-migration-author-lanes.mjs`, Cross-PR collision check): #3528 (released to ai-devops #952 session local_b9db13f7…) → #3620 → #3622/#3625/#3626/#3666 (serial) → #3636 → #3647 → #3657 (released to #952 session) → #3593 → #3516.
Others: #3567 (merge queue read-back, in guarded merge), #3635 + #3698 (Linux test fixes, 26 failures on main), #3672 (#3458 reissue), #3673 (no-human-approval rule), #3519/#3513/#3627/#3396, #3658/#3606, #3668 (other MiMo session owns).

## 3. What did NOT work (do not repeat)

- Reusing preview evidence applied from a PR head after a workflow file changed on main (#3458) — automatic production refuses; do a replacement migration instead.
- Relayed owner approvals: sub-agents correctly refuse "Albert said X" from another agent for downloads; the orchestrator must do such steps itself.
- 90-second polling by helpers exhausted the shared GitHub quota.
- Claude built-in browser cannot do Microsoft sign-in; use Claude in Chrome (Albert's session) for authenticated page proofs; screenshot/get_page_text only.
- Estimating clock times: wrong by 10+ minutes; always read `TZ=America/New_York date`.
- A helper wrote files into the orchestrator's coordination worktree (#2179 work); it was told to move them to its own worktree — verify that worktree is clean.

## 4. Sub-agents still running at handover (each reports on its GitHub issue/PR)

Each: asked / state / deliberately not done.
- **Recovery of five** — #2357, #3457, #3498 then #3464; resumes after quota reset; did not skip dry-run/business-risk gate.
- **#3458 replacement** — PR #3672, revising after REVISE.
- **#2110/#3175/#2662** — branches refreshed locally; waiting on #3620 merge then governed claim transfer; #3391 needs a new version (back-dated).
- **Tool PR batches A and B** — the PRs listed in §2; serialize same-file PRs.
- **#2870 chain** — land #3647, prove and close #2870. Wake set 2:57 PM EDT.
- **#2478 proof** — land #3636, #3632, then prove #2478.
- **#2874, #2875** — each its own helper, parallel; #2873 follows both; then DesignFlow cutover practice load (DesignFlow session), then Albert picks a switch window (recommend weekend evening with no Uma release).
- **#2179 then #2176** — Albert said keep; placement decision for #2176 recorded on #2176.
- **Structural roster triage** — #1275 split into #3347, #3682–#3685 (builders active); #770 rehearsal passed (105 tables); #1431 waits on #770 real load; #2427 re-check wake Sep 29 9:00 AM EDT (parked #3681 area); #2603/#2604/#2605 wait on licensor-source-data#86 and #2336; #3234 waits on ColdLion #3351; #3298 on #3524; #1966 on popdam3#169; #3543/#3595 on #3464/#3498.
- **Allocator lock recovery** — refs/db-coordination/author-acquisition.
- **Reviewer-writable** — Gemini, StepFun, DeepSeek, Grok, Muse, Qwen wrappers changed (uncommitted pieces in `/home/ahazan/repos/ai-devops-reviewers-writable`); Muse backup engine still read-only; Gemini must re-qualify live after merge; in-flight Grok sessions need fresh sessions after install.
- **#3689** closed; **#3669** closed; **#3662** closed; **#3659/#3660** merged.

Blocked-on-others: #3668 (MiMo), #3528/#3657 (ai-devops #952 session), #3635 (Codex owner, last 12:12 PM).

## 5. Secrets / docs / worktrees

- Secrets sweep: no new credential created or printed by the orchestrator. The #3689 helper stored the test-DB passwords in 1Password vibe_coding; that DB has been deleted. Swept, nothing else new.
- Docs pass: owner rulings were written by their PRs (#3667 §6.22, ai-devops #980; #3673 pending). Nothing else outside this handover is stale.
- Worktrees: orchestrator coordination worktree `.claude/worktrees/popcre-shared-db-3522-b78d05` — must be clean after the #2179 helper moves its files; verify before reuse. Helper worktrees are live; do not clean.

## 6. Resume checklist

1. Verify marker #3653 CLOSED; open your own marker with your own route_id; `node scripts/check-orchestrator-marker.mjs --resolve`.
2. `gh api rate_limit` — keep helper count and polling within quota.
3. Re-read each item in §4 on GitHub (issues/PRs carry signed status); re-dispatch anything whose helper died with this session. Priority: allocator lock → #3567 → #3620 → recoveries → #3672 → #2874/#2875 → roster.
4. Close each structural issue only on its own live proof. No manual production beyond the authorized five recoveries.
