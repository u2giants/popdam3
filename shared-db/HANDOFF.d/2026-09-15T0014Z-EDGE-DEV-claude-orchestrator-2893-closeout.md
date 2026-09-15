---
issue: 2883
status: OPEN
owner: marker-2893
---

# Orchestrator closeout — marker #2893 (EDGE-DEV, claude)

Session: route_id `local_d16c82f5-fb42-453c-9ee5-765977d79195`, machine EDGE-DEV, engine claude,
marker issue #2893 (closed by the main session, not by this file's PR). Written 2026-09-15T00:14Z
(UTC; the working day was 2026-09-14 local). Every fact below was re-checked with `gh`/`git`
at write time unless marked otherwise.

## 0. DECISIONS ONLY THE OWNER CAN MAKE

1. **#2506 proof routing.** The live proof refused because #2506's scope does not return to
   shared-db. Recommendation: leave it with the PopDAM session (it owns the app-side work and
   the proof). The alternative, adding `application_return_to: u2giants/shared-db` to #2506's
   scope block, would make shared-db the prover; this session deliberately did not make that
   edit, because doing it only to pass the gate routes around the gate. Needs Albert only if he
   wants shared-db to own the close.

No other owner decisions are pending.

## 1. What this application is

`u2giants/shared-db` governs the STRUCTURE of the one Supabase Postgres database shared by POP
Creations' applications (PopDAM, DB Data Admin, PopSG and others). Migrations, reviewer evidence,
preview rehearsal, guarded merge, automatic production promotion and live proof all run through
GitHub Actions in this repo. The orchestrator routes structural work through issues carrying a
`db-work-scope` block. Read `AGENTS.md` first; it is authoritative.

## 2. What we set out to do, and why

Albert handed the orchestrator 13 issues to drive to closure and asked that tooling blockers found
along the way be fixed rather than bypassed.

## 3. Current state (verified 2026-09-15T00:14Z)

- **origin/main:** `27e5573a` (PR #2922 merge). Highest migration on main: `20260914172031`
  (`db_data_admin_inventory_canonical_licensor_group`).
- **Closed and done:** #2724, #2711, #2579, #2497, #2712, #2802, #2797, #2437.
- **Completed via PRs (all MERGED):** #2814 (for #2802), #2815 (for #2848), #2750 (for #2694),
  #2799 (for #2800).
- **Scraped Properties (#2905):** #2905, claim #2909 and probe issue #2919 all CLOSED. Migration
  20260914172031 applied to production (run 34892518005, per agent a2e3bda773d42a7ae's report).
- **#2921** (probe for #2506) CLOSED.
- **#2898** (lease renewal refused a column scope under a held table claim) CLOSED; it was a
  tooling blocker.
- **#2506 OPEN.** Migration 20260911213429 applied to production (Shared Supabase Migrations run
  34898171486, success). Probe PR #2922 merged as `27e5573a` (Guarded Merge run 34903226894,
  success). Live proof run 34903365304 FAILED, verbatim:
  `REFUSED: application_return_to is not u2giants/shared-db; the owning application must prove it`.
  The PopDAM session owns the proof and the close.
- **#2883 OPEN** (this file's issue): the fix for automatic production evidence-package import is
  merged, but automatic production promotion has not yet been seen to succeed on an ordinary
  migration.
- **#2923 OPEN** (opened by this closeout): reviewer throughput, see §6.
- **Tool fixes merged this session:** #2900 `d3037913`, #2914 `8d96cbf7`, #2901 `6934a535`,
  #2916 `9b55cd89`, #2907 `703c3338`, #2895 `57461be6`, #2910 `66acdc8f`, #2920 `6433c8e6`,
  #2922 `27e5573a`.
- **Preview state:** NOT read from the ledger in this closeout. Verifiable only: the #2905
  follow-up preview run 34892299261 succeeded (agent report). No claim is made about any other
  preview slot; read the ledger before assuming it is free.

### Per-sub-agent blocks

**Agent a954d253444789b4a — FINISHED.** Tool fix for the merged-PR issue link (#2901 `6934a535`,
#2916 `9b55cd89`), then the #2506 probe, PR #2922 (branch `claude/live-proof-probe-2506`). Three
review rounds: Grok REVISE twice for loose index/function/STABLE checks, each fixed; Muse + GLM
approved `b25fa501`; refreshed from main to `7aff2607` with APPROVE carry-forward; guarded merge
`27e5573a`. It then ran live proof, which refused (above), and stopped without editing #2506. No
worktree remains for that branch.

**Agent a2e3bda773d42a7ae — FINISHED.** #2914 recovery-run preview proof. PR #2914 merged
`8d96cbf7` (maintenance suite 993/993). #2905 named its original preview run only as plain text,
so the repaired check could not find it; the agent commented the run link on #2905. Preview run
34892299261 and review-evidence run 34892332049 then succeeded, production run 34892518005
succeeded, and production's migration history showed `20260914172031`. Its live proof run
34892925257 refused for a missing `.github/live-proofs/2905.sql`, which PR #2920 later added.
Its review worktree was removed.

**Worktrees tied to this session, all with merged PRs (reaper candidates once the marker
closes):** `agent-a64ff240f541312e8` (#2908 MERGED, locked), `agent-a999da57a0ad813c8` (#2920
MERGED, locked), `issue-2802-talent-likeness` (#2814 MERGED), `issue2883-digest` (#2907 MERGED),
`cranky-mestorf-ee0f23` (#2856 MERGED). `agent-aabf32af3247b8b3a` and `pr2799` have no PR under
their branch names; their work landed via #2910 and #2799. Check for unpushed commits before
removing them.

## 4. What did NOT work

- Reviewer briefs without a bare `VERDICT: APPROVE <sha>` terminal line recorded nothing (the
  earlier Grok/GLM "no verdict" results). The reviewer was fine; the brief was not.
- A manual production apply without a review-evidence artifact was refused.
- Author-recorded evidence run 34881750981 was void (an author cannot supply its own evidence).
- Evidence commits listing only one of the two `.agent` files failed validation (#2901, #2914,
  #2895, #2916). The pair must land together in one commit.
- A piped `git push` hid an evidence failure on #2922 (the pipe's exit code masked it).
- The first background waiter watched files that never get an exit line, so it never fired.
- Merge attempts were refused for stale main and for still-running SQL migration guards;
  retrying after main was current and checks had finished worked.
- Live proof refused for #2506 routing (above).

## 5. Root causes and key findings

- The live-proof workflow proves only work whose scope names shared-db as
  `application_return_to`; #2905 passed because its scope did.
- Each probe review round surfaced exactly one more gap, so throughput is limited by brief
  completeness, not reviewer health (#2923).
- A preview run cited only as plain text in an issue is invisible to the repaired check; link it.

## 6. Exact next steps

1. **#2506 (PopDAM session):** prove from the owning application and close. Done when #2506 is
   CLOSED with a passing proof.
2. **#2883:** on the next ordinary migration, watch automatic production promotion run with no
   manual dispatch. Done when the production run succeeds and the ledger shows the version
   applied; then close #2883 and delete this file in that same PR.
3. **#2923:** investigate reviewer brief templates (front-load the probe checklist, enforce the
   terminal verdict line). Done when a probe passes in one round or the issue records why not.

## 7. Constraints and gotchas

Never edit the canonical checkout; never force a merge; docs-only PRs still use the guarded merge
path; merged is not applied on production; exit 0 is not success for lane commands. Do not touch
#2705, #2709, #2290, #2678, claims #2778/#2774, FORK issues #2601/#2600/#2599/#2598/#2541/#1941,
or PR #2846.

## 8. Access and environment

`gh` authenticated as u2giants on EDGE-DEV. Secrets live in 1Password vault `vibe_coding`
(never values here).

## 9. Open questions and risks

- (2026-09-14) Automatic production promotion is unproven end to end (#2883).
- (2026-09-14) #2506 may stall if the PopDAM session does not pick up the proof.

Self-audit (handoff-writer four questions): newcomer can continue (§1, §3, §6); session knowledge
captured (§3 agent blocks, §4, §5); details for execution present (§3 run IDs and SHAs, §6
gates, §7); §0 swept line by line, one owner decision (#2506 routing) and it appears there.
