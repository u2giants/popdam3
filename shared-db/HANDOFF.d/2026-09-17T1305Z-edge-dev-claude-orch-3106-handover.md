---
issue: 3106
status: OPEN
owner: claude/orch-3106-handover (orchestrator marker #3106, closed at handover)
---

# Orchestrator handover — marker #3106 (2026-09-17 13:05Z)

## 1. Goal
Albert asked the orchestrator to finish #3091, #3036, #3009, #3023 (orchestrator ones), then #3104 and #2773 urgently. Standing owner words (from his chat): "remove all limits on work concurrency (subagents, lanes, etc.). remove all limits on using one reviewer simultaneously" and "remove the safety limits too, run everything in parallel". These never waived reviewer APPROVE or production gates.

## 2. Coordination state (checked 2026-09-17T13:04Z)
- main tip 4fec003d; max migration 20260917102139.
- LIVE on production (done): #3036, #3023, #3091, #3104, #3009, #3154, #2870, #2866, #2611 (claim #2819 released). Proof still pending: #3023 nightly crawl (02:00 UTC), #3009 PopSG timing (sidebar session), #2611 live proof (sidebar session "Finish #2611 prepack live proof", role lacks EXECUTE on prepack_role).
- #2773 (non-orchestrator): PR #3172 MERGED; owned by the "Remove shared-db concurrency and reviewer caps" session. Verify its closure there.
- Preview: carries 20260917102139 (#2794) which is NOT yet on production; plus normal merged-main rehearsals. Not clean.

## 3. Sub-agents still running at handover (they report to the closed session; check their PRs/issues, not chat)
### Agent: style-group #2745 rebind (worktree agent-a652a18e…)
- Asked: add guarded `--rebind-claim-worktree` lane mode (new non-orchestrator issue), then move claim #2745 to a fresh worktree, supersede version, review, merge, preview, production, proof, release.
- State at handover: no report. PR #2846 OPEN head f7dd4adc. Claim #2745 lease was until 21:01Z. Old worktree holds another session's 2611 files — never touch; backup branch backup/claim-2745-worktree-20260917.
### Agent: #2794 production deadlock fix (worktree agent-a1916a8f…)
- Asked: fix rehearsal deadlock (evidence was produced with an older scripts/lib/github-transport.mjs; re-rehearsal refuses "BLOCKED: already applied on production: 20260917102139" though it reads preview). Then finish #2794 to production, release claim #2816, proof on #2794 and #3116.
- State: no report. PR #2821 MERGED; production still has the old function.
### Agent: object-kind check fix + #3174 (worktree agent-aa524643…)
- Asked: fix check refusing "migration writes undeclared objects: view plm.sesame_submission_property_option" (grant on a newly created TABLE read as view; regression from #3183), then finish #3174 via PR #3190 (OPEN dff65de9), claim #3189.
- Found earlier: Muse REVISE findings (self-check quotes, Peanuts null source id) are fixed in dff65de9; needs fresh evidence + review.

## 4. Blocked / unassigned
- #2834/#2357 (orchestrator): Grok REVISE on 74c5e2f3 — authenticated cannot read api.licensing_entity_candidates (view touches OPA capture tables). Decided fix: narrow SECURITY DEFINER count helper (search_path='', EXECUTE only to reading roles), real SET ROLE read test. Scope on #2357 and claim #2834 already widened to include the function. Migration edit NOT written: the claim worktree C:/repos/shared-db/.claude/worktrees/issue-2357-licensing-apis is write-blocked for other sessions. Next: once `--rebind-claim-worktree` lands (agent above), rebind and finish; or run a session opened in that worktree. Lease expired/expires 20:09Z — renew only after expiry (resume refuses live leases).
- #2336 (orchestrator): blocked on #2333, #2334, #2335, #2357. #2598/#2599/#2600 wait on it.
- #1941/#2601: Laura and Ilona review (2,880 blank decisions). #2541: evidence shows 33 unmatched codes not 66, and AM1/EP/MGM/WND under two licensors — search docs/rulings before asking Albert.
- #3175 (orchestrator, opened by #2794 agent): taxonomy readiness check that can no longer pass; start after #2794 is on production.
- Audits #3114–#3117 open (recovery agent acfcf50e… finished). #3115 closable (claim #2819 released) by its opener; #3116 after #2794; #3117 after #2745.
- Object reader misses grant on api.licensing_resolution_queue (bundled into the #2611 sidebar session's task).

## 5. What did NOT work
- Resuming a live lease (`--resume-author-lease`) refuses until expiry.
- Editing a claim's recorded worktree from another session is blocked by the harness; don't route around it.
- `--supersede-active-claim-version` requires the recorded worktree clean at PR head — impossible when another session reuses that folder.
- Governed recovery for #2794 failed when tooling-only merges changed scripts between rehearsal and dispatch; tightly chain steps.
- First #3174 reviewer (GLM) could not run on this machine; lane tool substituted Muse.

## 6. Stale-prone facts
All PR heads, lease times and "no report" states above are as of 13:04Z.

## 7. Next actions (in order)
1. Open your own marker and resolve.
2. Read PRs #2846, #3190 and the #2794 issue/new tooling issues to learn what the three agents above finished.
3. Finish #2834 after rebind tooling exists.
4. Close audits via their openers; dispatch #3175 after #2794 is live.
