---
issue: 2572
status: BLOCKED
owner: claude/shared-db-orchestrator-issues-27a129
---

# Four of the original eight non-orchestrator issues cannot be closed, and why

Written 2026-09-08T1650Z by a Claude session on `edge-dev`, working from
`C:/repos/shared-db-worktrees/issue-1984-reconcile` and from the session worktree
`C:/repos/shared-db/.claude/worktrees/top-5-blocking-issues-6be510`.

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put ALL of these to Albert in ONE message, before starting work. Do not trip over
them one at a time.

**Blocking — nothing can finish without an answer**

1. **#1322 — inactive Properties.** The remaining acceptance criterion is a human
   review of the licensed Property list (issue #1941, "Laura and Ilona: review all
   licensed Properties and reconcile ColdLion", still OPEN). No AI session can
   supply it. *Recommendation:* Albert asks Laura and Ilona for a date, or rules
   that #1322 may close on the code alone with the review tracked separately under
   #1941. Blocks closing #1322 entirely.
2. **#1090 — licensing Master Data architecture tracker.** It is an umbrella that
   is only finished when its successors are. *Recommendation:* Albert rules
   whether an umbrella tracker may be closed once every named successor is open
   and owned, or must stay open until the last successor closes. Today the repo
   has no rule, so every session re-litigates it. Blocks closing #1090.

**A wrong guess is recoverable, but the rework is wasteful**

3. **#1403 — retire the `objects:` alias.** Retirement is gated on no live legacy
   claim still using the alias. Two are still open: #2443 (bulk operation run
   history) and #2418 (empty `hts_rag_split` schema). A third, #2521, has since
   closed. *Recommendation:* leave #1403 open and let the claim owners finish;
   forcing the retirement now would break two other sessions' in-flight work.
4. **#1868 — the worktree reap.** By design it must not run while an orchestrator
   marker is open. The marker that blocked it originally (#2559) has closed, but a
   new one, **#2577**, is open now. *Recommendation:* the next session that sees
   NO open orchestrator marker runs the reap and closes #1868 — do not force it
   past an open marker.

**Not part of this work, and nobody is on it**

5. **Marker #2350** says an orchestrator marker resolves exit 0 to a session id
   that does not exist. It is open, unowned, and it makes "is a marker live?"
   unanswerable — which is exactly the question #1868 depends on.
   *Recommendation:* Albert assigns it, or rules it low priority in writing so
   sessions stop re-discovering it.
6. **#2448** records that a claim-close comment asserts an expiry sweep that never
   runs, and that a second issue number in a claim title kills the claim. Both are
   silent correctness bugs in the queue every session depends on.
   *Recommendation:* Albert schedules it; no session will pick it up on its own
   because it is nobody's blocker.

**Already settled — do NOT re-ask**

- 2026-09-08: #1984 closes on merge + CI + two governed approvals. Live production
  acceptance is explicitly NOT required, because the pull request ships tooling
  only and writes no production row.
- 2026-09-08: no existing worktree may be deleted and no capability may be
  reduced to make a blocked issue closable.
- Standing: shared-db STRUCTURE changes go through branch-and-PR; AI sessions are
  read-only against production.

## 1. What this application is

`u2giants/shared-db` (PUBLIC on GitHub) is the governance repository for the
shared database structure behind POP Creations' systems — DesignFlow, PopDAM,
PopSG and the ColdLion integration. It holds SQL migrations, the guards that
police them, the agent work-contract tooling, and the reviewer/claim queue that
serialises many concurrent AI sessions against one database. It is not the
application and it does not hold application row data. Production is Supabase;
DesignFlow production is Cloud SQL.

## 2. What we set out to do this session, and why

Continue the eight oldest non-orchestrator issues (#1090, #1322, #1403, #1868,
#1984, #2037, #2285, #2296) oldest-first, through verified production acceptance,
without deleting a worktree or reducing a capability. Trigger: tracker issue
**#2572**, "HANDOVER: complete the oldest eight non-orchestrator issues through
production".

## 3. Current state — what is true right now

**Closed, with evidence**

- **#2037** — merged as `b28d16a6f8807d15c63a8f8c1d92f3d8267ce71f` via guarded
  merge run 34241299944, PR #2563, two governed APPROVE verdicts at the merged
  head. The applied-migration guard now refuses an added file whose version was
  already applied.
- **#1984** — merged as `a51e14db5f69b35be8b8d9ba1c61d109602c3aa5` via guarded
  merge run 34246116561, PR #2205, head `5245af1ad15da932ee938919c8e31cef997538f4`,
  two governed APPROVE verdicts at that head. 45 offline tests pass; the semantic
  truth audit is green at 265 call sites.
- **#2285** and **#2296** were already closed before this session; re-verified.

**Open and blocked — the subject of this handoff**

- **#1090** — umbrella tracker, open successors. Not dispatchable.
- **#1322** — code side done; the Property admission review (#1941) is human work.
- **#1403** — blocked by open legacy claims #2443 and #2418.
- **#1868** — blocked by open orchestrator marker **#2577**.

All work is committed and pushed. Nothing is half-edited on disk.

## 4. Everything we tried that did NOT work

- **`gh pr merge` on a shared-db PR.** Refused: "the base branch policy prohibits
  the merge." The required context `Migration guarded merge authorization` comes
  from a `workflow_dispatch`-only workflow, so the only path to `main` is
  `gh workflow run guarded-migration-merge.yml -f pull_request=<n> -f head_sha=<sha>`.
- **Dispatching the guarded merge for #2205 while `main` had moved.** Refused:
  "origin/main has moved past the dispatched commit with changes that are not
  documentation … Re-dispatch against the current tip." Our own #2037 merge had
  moved it. Fix: update from main, re-review, re-dispatch back to back.
- **Assuming a merged branch's inherited `.agent` files count as evidence.** The
  Agent work contract check refuses: "Enforced mode requires this pull request to
  change both `.agent/contract.json` and `.agent/completion.json`."
- **Re-pinning only `completion.json` after a fix.** The git-evidence rule refuses:
  "only the two `.agent` evidence files may follow report.head_sha; found
  [.agent/completion.json]". BOTH files must change in that follow-up commit, so a
  contract generation bump is required alongside it.
- **Running a review wrapper with no wrapper arguments.** Exit 2, "the wrapper
  supplied no recognized diagnostic". Wrapper arguments go after a bare `--`.
- **Omitting `--review-slot`.** Both verdicts overwrite the same durable ref,
  because the runner silently defaults to slot 1.
- **Excluding a reviewer to force independence.** Deliberately NOT done:
  exclusions never clear and can permanently strand a PR and everything queued
  behind it.

## 5. Root causes and key findings

- **A blocked issue here is blocked by another session's live state, not by
  missing effort.** #1403 and #1868 both wait on records other sessions own. The
  only safe action is to leave them open.
- **Two independent reviewers returned REVISE on PR #2205 and were right.** Four
  real defects, since fixed: the executor core never bound the manifest to the
  live database (a missing identity field was read as "unconstrained", so a
  preview-built plan could be applied to production through `runBatch`); a missing
  or unrunnable `git` binary made the licensed-data guard allow a write into this
  public checkout; re-running the same manifest planned zero changes and silently
  overwrote the real before-state backup with an empty one; and a source export
  with unexpected column headers produced a healthy-looking zero-candidate
  manifest instead of a refusal.
- **The verdict line is strict.** `VERDICT: <APPROVE|REVISE|REJECT> <40-hex sha>`
  must be the last non-blank line, and any other decision word anywhere in the
  body voids the whole review.

## 6. Exact next steps

1. Put section 0 to Albert in one message. *You will know it worked when:* he has
   answered items 1 and 2.
2. If he rules #1090 may close on successors being open and owned, list its
   successors, confirm each is open with an owner, then close #1090 quoting them.
   *You will know it worked when:* `gh issue view 1090 --json state` reports
   CLOSED.
3. For #1322, wait for #1941 or for Albert's ruling. Do not close it on code alone
   without that ruling. *You will know it worked when:* #1941 closes, or Albert
   says in writing that #1322 may close separately.
4. For #1403, re-check #2443 and #2418 each session. When both are closed and no
   other open claim uses the `objects:` alias, run the retirement and close #1403.
   *You will know it worked when:* `gh issue list --search "CLAIM: in:title"
   --state open` shows no claim depending on the alias.
5. For #1868, re-check for any open orchestrator marker (today: **#2577**). When
   none is open, run the worktree reap and close #1868. *You will know it worked
   when:* the reap completes and no worktree another session is using was removed.

## 7. Constraints and gotchas in force

- The ONLY path to `main` is the guarded merge workflow dispatch. Re-dispatch
  against the current tip if `main` moves; a moved tip also invalidates the
  verdicts and forces a fresh review round.
- Draw BOTH reviewer slots before running either review; a head-wide verdict check
  blocks drawing afterwards.
- Never hand-delete a `refs/db-review-active/*` ref, never post a synthetic
  verdict, and never use `--exclude-reviewer` to force independence.
- Never use bare `git stash` / `git stash pop` — the stash stack is shared across
  worktrees.
- shared-db is PUBLIC. Licensed row data must never be written into this tree.
- Preserve every existing worktree; create a detached one if the branch is already
  checked out elsewhere.

## 8. Access and environment

- `gh` CLI is authenticated as `u2giants`. GitHub is the source of truth.
- Reviewer wrappers require their caller env var set to `claude`:
  `AI_GROK_CALLER`, `AI_GLM_CALLER`, `AI_MUSE_CALLER`, `AI_KIMI_CALLER`,
  `AI_GEMINI_CALLER`.
- The reviewer pool is five; individual reviewers commonly fail on quota and
  recover later. Retry once with a FRESH session name before replacing one.
- Secrets live in 1Password vault `vibe_coding`. Values never appear in chat,
  arguments, logs or commits.
- Machine `edge-dev`, Windows 11, PowerShell primary with Git Bash available.

## 9. Open questions and risks

- **2026-09-08:** #1090's closing rule is genuinely undefined in this repo. Until
  Albert rules, any session that closes it is guessing.
- **2026-09-08:** #1868's blocker is a moving target — the marker that blocked it
  closed and a new one opened the same week. A session that checks once and waits
  will wait forever; re-check at the moment of running.
- **2026-09-08:** #2350 (a marker resolving to a session id that does not exist)
  makes "is a marker live?" unreliable, which weakens the #1868 gate itself.
- **Risk:** the reviewer queue's expiry sweep does not actually run (#2448), so a
  stale claim can hold #1403 open indefinitely with nobody noticing.
