---
issue: 2401
status: OPEN
owner: claude/cleanup-worktree-f356f1
---

# Worktree and branch reap on edge-dev (issue #2401), 2026-09-06

## 0. DECISIONS ONLY THE OWNER CAN MAKE

Put ALL of these to Albert in ONE message before starting work.

**Not part of this work and nobody is on it**

1. **4,224 branches exist on GitHub in `u2giants/shared-db`.** Deleting a remote
   branch is a one-way action on shared infrastructure, so no session may do it
   without Albert naming the action. Albert was told the number on 2026-09-06 and
   deferred it; he has not said yes or no.
   *Recommendation:* say yes to a REPORT first — a table of how many of the 4,224
   are already merged and how old they are — then decide on deletion with that in
   hand. Blocks nothing; pure housekeeping.

2. **Six `HANDOFF.d/` files are stale** (their contract `issue:` is CLOSED) and
   belong to sessions that are gone. The handoff standard reserves deletion of
   another session's file to the owning or successor session, so this session left
   them. They are listed with owners in issue #2401 and again in section 3 below.
   *Recommendation:* authorise the next shared-db session to delete those six by
   name in one docs-only PR. Blocks nothing; it is the remaining half of #2401.

**Already settled — do NOT re-ask**

- 2026-09-06: Albert authorised deleting finished LOCAL branch labels ("clean the
  branches"). Done — 337 deleted. Do not ask again for local labels.
- 2026-08-13 owner ruling: the `HANDOFF.d/` file COUNT is never a problem and must
  never be capped. Only STALE files count. Do not propose a cap.

## 1. What this application is

`u2giants/shared-db` is the governed home of POP Creations' shared Supabase
database STRUCTURE — migrations, schema guards, and the workflow scripts that let
many AI sessions change that structure safely. It is a PUBLIC GitHub repository.
Nobody "uses" it as an app; sessions land migrations and governance code through
branch-and-PR. Primary local checkout on this machine (`edge-dev`, Windows 11):
`C:\repos\shared-db`.

This particular workstream touches no database and no application code. It is
machine housekeeping: the working folders ("git worktrees") and branch labels that
accumulate because every AI session creates its own isolated copy of the repo.

## 2. What we set out to do this session, and why

Albert ran `/cleanup-worktree`. The trigger was issue #2401, opened
2026-09-06T00:28Z, reporting roughly 100 stale worktrees spread over seven
locations on this machine, plus six stale handoff files. That reap had been
blocked for a previous whole session because `scripts/reap-merged-worktrees.mjs`
refuses to run while any `orchestrator-marker` issue is open (a clean worktree on
a merged branch is indistinguishable from one a live sub-agent just pushed from).

Business goal: stop the machine silently filling with abandoned copies of the
repo, without losing a single line of anyone's unshipped work.

Mid-session Albert asked whether the skill also cleans branches, then said "clean
the branches", which added the local branch-label sweep to scope.

## 3. Current state — what is true right now

**Verified by re-running `git worktree list` and `git branch --list` after the work.**

- **Worktrees: 96 to 36.** 63 removed (61 by `git worktree remove --force`, plus
  `wt2029` and `mirror-bootstrap` after proving supersession — see section 5).
- **Local branch labels: 566 to 229.** 337 deleted with `git branch -d` (the safe
  form, which refuses anything unmerged).
- **No open `orchestrator-marker` issue existed during this session** (checked via
  `gh issue list --state open --label orchestrator-marker`, which returned empty),
  so the reap was sanctioned per #2401.
- **Nothing was committed or pushed except this handoff file.** No code, schema,
  migration, workflow, or doc changed. No database was touched.
- **Issue #2401 stays OPEN**: its worktree half is done, its six-stale-handoff half
  is not (see section 0 item 2).

**Two empty folders could not be deleted** — a process still holds them open (a
working-directory lock). Git's registration for both is already gone, so they are
inert:

- `C:\repos\shared-db\.claude\worktrees\issue-2342-orchestrator-90def3`
- `C:\repos\shared-db\.claude\worktrees\shared-db-orchestrator-14be64`

They will delete once the holding process exits. `Remove-Item -Recurse -Force` was
tried and returned Permission denied; do not escalate, just retry later.

**Deliberately left alone (36 worktrees).** The primary checkout; this session's
own worktree; 12 worktrees whose head is not in `origin/main` (all of them proven
pushed to `origin`, so nothing is at risk); and everything whose `.git` file was
modified on 2026-09-06, because a live session may own it.

**One worktree is flagged, NOT dirt:** `C:\tmp\wt-step1-2326`, branch
`claude/step1-baseline-2326`, holds 46 STAGED changes including deletions of
workflow files (`.github/workflows/preview-maintenance-lock.yml`) and scripts
(`scripts/gh-read.mjs`, `scripts/lib/github-transport.mjs`, and others). Its HEAD
is an ancestor of `origin/main`. This reads as a deliberately constructed "before"
baseline for issue #2326, not abandoned mess. It was left completely untouched. Do
not delete it without asking whoever owns #2326.

**Six stale `HANDOFF.d/` files remain** (issue closed, owner session gone) — from
issue #2401's own table:

| File | Its issue | Owner branch |
|---|---|---|
| `2026-09-03T1750Z-edge-dev-claude-orchestrator-2193-closeout.md` | 2218 | `claude/shared-db-orchestrator-4d089e` |
| `2026-09-04T0030Z-edge-dev-claude-orchestrator-2224-closeout.md` | 2247 | `claude/orchestrator-2224-closeout` |
| `2026-09-04T0310Z-edge-dev-codex-priority-orchestrator-cutover.md` | 2267 | `codex/orchestrator-2249-handoff` |
| `2026-09-04T1103Z-edge-dev-codex-priority-orchestrator-2269-closeout.md` | 2283 | `successor-orchestrator` |
| `2026-09-04T1108Z-edge-dev-codex-post-cutover-closeout.md` | 2267 | `codex/01a069d8-...` |
| `2026-09-04T1625Z-edge-dev-2-claude-orch-2297-closeout.md` | 2297 | `claude/handover-orch-2297-closeout` |

**Two pre-existing uncommitted items sit in the primary checkout `C:\repos\shared-db`
and were NOT created by this session, so they were not touched:** `.mcp.json`
(modified) and two untracked handoff files
(`HANDOFF.d/2026-08-30T1915Z-edge-dev-codex-non-orchestrator-sweep-continuation.md`
and `HANDOFF.d/2026-08-31T1051Z-edge-dev-codex-maintenance-sweep-fa05.md`). They
belong to earlier Codex sessions. Leave them; clobbering another session's
uncommitted work is the hazard that rule exists to prevent.

## 4. Everything we tried that did NOT work

1. **The first removal list came back with only 20 entries instead of about 60.**
   The exclusion filter was a grep regex `C:/repos/shared-db|cleanup-worktree-...`,
   and `C:/repos/shared-db` is a PREFIX of nearly every worktree path on this
   machine, so the filter protected almost everything. Fixed by switching to an
   exact-path `case` match. Lesson: never filter worktree paths with a substring
   match — the primary checkout's path is a prefix of its own linked worktrees.
2. **`git worktree remove --force` failed on two folders** with "Permission
   denied", and the PowerShell `Remove-Item -Recurse -Force` retry failed the same
   way. The cause is a working-directory lock, not permissions. Not worth another
   attempt; see section 3.
3. **`git branch -d` refused `pr2386`** as "not fully merged" even though
   `git branch --merged origin/main` had listed it. `-d` grades against the CURRENT
   HEAD, not against `origin/main`. It was left in place rather than forced with
   `-D`. `heads/pr2281` errored as "not found" — a malformed label name that no
   longer resolves. Both are harmless leftovers.
4. **Age was never used as evidence.** An early instinct was to delete anything
   older than a few days. That is exactly what the cleanup skill forbids, and it
   would have destroyed the two superseded-but-unpushed commits in section 5
   before they were proven safe.

## 5. Root causes and key findings

- **Only TWO of the 96 worktrees held commits that existed nowhere on GitHub.**
  Everything else was already on `origin`. The apparent risk of a big reap is
  almost entirely illusory once you check `git branch -r --contains <sha>` for
  every head — that single command is what turns a scary sweep into a safe one.
- Those two, both proven superseded before deletion:
  - `%LOCALAPPDATA%\Temp\claude\wt2029`, commit `dcf9f216` "fix(#2029): let a batch
    supersede its own intermediate catalog contract". Its PR #2265 was CLOSED
    unmerged; the replacement PR #2279 merged 2026-09-04T06:06Z and issue #2029
    closed one minute later. `origin/main`'s
    `scripts/production_catalog_verification.py` now contains 45 matches for
    "supersede".
  - `C:\Users\ahazan\Documents\Codex\2026-09-04\shared-db-pr2276-maintenance\work\mirror-bootstrap`,
    commit `f124fad2`, seeding `docs/verification/main-required-status-checks.json`.
    That file is already on `origin/main` with a LATER capture timestamp
    (04:41:38Z versus 04:40:49Z) and an extra `_provenance` field. Main's copy is
    strictly better.

  Both were saved as git patches before deletion (see section 8) purely for
  reversibility.
- **`git cherry` alone was not sufficient** and `git branch --merged` is blind to
  squash merges (#2401 measured 74 of 130 branches looking unmerged while their PR
  was merged). The combination that actually worked: `git merge-base --is-ancestor`
  for the easy cases, then `git branch -r --contains` to prove the head is on
  GitHub at all, then `gh pr list --search` for anything still unaccounted for.
- **The `.git` file's modification time is a usable liveness signal** for a linked
  worktree — it does not change when you merely run `git status` against that
  worktree, so "modified today" genuinely means a session wrote there today.

## 6. Exact next steps

1. Put section 0 to Albert in one message. *Done when he has answered both items.*
2. If he authorises the report: count how many of the 4,224 remote branches are
   already merged into `main` and how old each is, and show him the summary BEFORE
   proposing any deletion. *Done when he has the table and has ruled.*
3. If he authorises retiring the six stale handoff files: delete exactly those six
   in one docs-only PR, confirming first with `gh issue view <n> --json state` that
   each named issue is still CLOSED. *Done when `HANDOFF.d/` no longer contains a
   file whose contract issue is closed.*
4. Once steps 2 and 3 are settled, close issue #2401 with a comment recording that
   the worktree half was completed 2026-09-06 (96 to 36). *Done when #2401 shows
   state CLOSED.*
5. Retry deleting the two locked empty folders named in section 3. *Done when both
   paths no longer exist; if still locked, leave them — they are inert.*

## 7. Constraints and gotchas in force

- **Never treat age as proof that deletion is safe.** The `cleanup-worktree` skill
  is explicit about this; two of the oldest folders here held the only unique work.
- **Never `git clean`, never `git checkout --` over unreviewed work, never
  `git branch -D`** during a reap. `-d` only.
- **Never touch another session's uncommitted files or another session's
  `HANDOFF.d/` file.** Concurrent sessions share this checkout.
- **Never use a bare `git stash` in a worktree** — the stash stack is shared with
  every other worktree on this machine.
- **Remote branch deletion on GitHub requires Albert naming the action** in the
  current chat.
- `scripts/reap-merged-worktrees.mjs` refuses while any `orchestrator-marker` issue
  is open. Check that before any future reap; it was empty this session.
- The repo is PUBLIC. Nothing licensor-specific or secret may enter a handoff.

## 8. Access and environment

- Machine `edge-dev`, Windows 11 Pro, PowerShell 7 plus Git Bash.
- `gh` CLI authenticated as `u2giants`; git committer identity
  `Albert Hazan <u2giants@users.noreply.github.com>`.
- Primary checkout `C:\repos\shared-db`; this session worked from the worktree
  `C:\repos\shared-db\.claude\worktrees\cleanup-worktree-f356f1` on branch
  `claude/cleanup-worktree-f356f1`.
- **Recovery archive from this session** (session-scoped scratch, NOT permanent —
  it disappears with the temp folder, so treat it as a courtesy copy only):
  `%LOCALAPPDATA%\Temp\claude\C--repos-shared-db--claude-worktrees-cleanup-worktree-f356f1\2df59e86-e473-4b1b-926c-e9d87f1dfb98\scratchpad\`
  containing `remove.txt` (the 63 removed paths), `deleted-branches.txt` (the 349
  candidate labels WITH their commit SHAs, which is what makes a deleted label
  recoverable), and `preserved/` (the two superseded patches plus 15 stray AI
  review notes copied out of dirty worktrees).
- No secrets appeared in this session and none were stored. 1Password vault
  `vibe_coding` is the location if one ever does.

## 9. Open questions and risks

- **Risk: a live session's worktree was removed.** Mitigated by protecting every
  path whose `.git` file was modified on 2026-09-06 and by proving every removed
  head was on `origin/main`. The worst realistic case is that a session finds its
  folder gone and re-creates it; no committed work can be lost.
- **Open question: who owns `C:\tmp\wt-step1-2326`?** Its 46 staged deletions are
  either a deliberate baseline for #2326 or a corrupted checkout. Not resolved.
- **Decision, 2026-09-06:** stale handoff files were NOT deleted despite being named
  in #2401, because the handoff standard reserves that to the owning or successor
  session. A later session must not read this as "nobody noticed".
- **Decision, 2026-09-06:** the two superseded commits were deleted rather than
  pushed, because pushing them would have re-opened settled work (#2029) or
  regressed a file (`docs/verification/main-required-status-checks.json`).

## Self-audit

1. **Comprehensive for a street newcomer?** Yes. Section 1 defines the repo with no
   assumed knowledge, section 3 gives exact paths and counts, section 6 gives
   numbered steps with verification gates.
2. **As effective as this session right now?** Yes. Section 4 records the
   prefix-match filter bug and the two lock failures; section 5 records the exact
   command combination that proves a head is safe, which was the session's real
   learning.
3. **Every relevant detail?** Yes — background sections 1 and 2, state section 3,
   failures section 4, findings section 5, steps section 6, constraints section 7,
   environment and archive section 8, risks section 9.
4. **Would section 0 alone show Albert every decision he owes?** Checked line by
   line: the remote-branch decision (sections 3, 6.2, 7) and the stale-handoff
   authorisation (sections 3, 6.3, 9) are the only two matters in this document
   needing his judgement, and both appear in section 0 with a recommendation.
