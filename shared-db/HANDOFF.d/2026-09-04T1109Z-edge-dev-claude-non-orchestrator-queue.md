---
issue: 2258
status: OPEN
owner: claude/1223-guard-mutation-sweep
---

# HANDOFF — shared-db non-orchestrator (repository-maintenance) queue

Written 2026-09-04T1109Z on `edge-dev` by Claude (Opus 5), worktree
`C:/repos/shared-db/.claude/worktrees/shared-db-non-orchestrator-queue-01bc29`,
branch `claude/1223-guard-mutation-sweep`.

## 0. DECISIONS ONLY THE OWNER CAN MAKE

Put ALL of these to Albert in ONE message, before starting work.

### Blocking — work is stopped until answered

1. **Two owner rulings contradict each other, and a finished feature is stuck between
   them.** On 2026-08-20 (issue #1322) the ruling was that the data admin screen should
   let a user mark a licensed Property inactive on our side. On 2026-08-27 (issue #1686)
   the ruling was that the licensor/property tree presentation must be removed from that
   screen, and licensing source data shown only through "Scraped Properties". PR #2278
   implements the first ruling by adding a Properties tab — precisely the screen the
   second ruling removed — so an automated test written for the newer ruling now fails
   on purpose. Two independent AI reviewers approved the PR; neither knew about #1686.
   **Recommendation:** keep the newer ruling and re-home the "mark inactive" control
   inside Scraped Properties, because #1686 is the later decision, the tab is only a
   presentation choice, and "mark inactive" is the actual capability that was asked for.
   **Blocks:** PR #2278 entirely. Nothing else in the queue depends on it.
   **A session must NOT resolve this by deleting the failing test** — that silently
   overturns the newer ruling with no record anywhere.

### A wrong guess is recoverable, but the rework is wasteful

2. **Issue #1031 (ColdLion history endpoints).** A reply to the ColdLion vendor is
   drafted and ready to send (see the two `HANDOFF.d/` files owned by
   `claude/coldlion-api-validation-proofread-1d2edd`). It needs a send-or-edit decision,
   and separately a decision on how many years of sales history the chunked puller
   should load on its first run. **Recommendation:** send the drafted reply as written;
   load three years initially. **Blocks:** the whole of #1031.
3. **Issue #771 (timed Cloud SQL to Supabase rehearsal).** Running it means reading real
   table data out of the production Cloud SQL database. The standing rule is that AI
   sessions are read-only on production and need the owner to name the resource and the
   action in chat. **Recommendation:** authorize a read-only, timed rehearsal against a
   named database, with no writes of any kind. **Blocks:** #771, and #770 behind it.
4. **Issue #1941 (Laura and Ilona review every licensed Property and reconcile
   ColdLion).** This is people-work, not code, and it is a fork out of this queue —
   route `curated-master-data-governance`. It needs their sign-off before anything here
   can consume the result. **Recommendation:** ask Laura and Ilona for a date.
   **Blocks:** #1941 only.

### Not part of this work, and nobody is on it

5. **The governed review runner throws away a reviewer's whole report when it refuses
   it.** `scripts/run-governed-review.mjs:91-92` discards the raw output on refusal, so a
   review that cost real money and produced real findings vanishes with no diagnostic.
   It happened twice in this session; both reviews were recovered by hand from the
   sandbox files. Issue #2244 covers a neighbouring problem, but it is routed to the
   orchestrator, not here. **Recommendation:** let a session file a small
   repo-maintenance issue for the discard itself. **Blocks:** nothing, but it burns a
   reviewer slot every time it fires, and the usable pool is effectively three.

### Already settled — do NOT re-ask

- 2026-08-21 (#1366): repo-maintenance issues are owned by a repository session, never
  by the orchestrator.
- 2026-08-13 (#658): there is no cap on how many files `HANDOFF.d/` may hold; count
  stale files instead, and the target for those is zero. There are currently none.
- 2026-09-03: licensor rows already in the public git history are left in place; the
  redaction on `main` was enough. No history rewrite.
- Making `shared-db` private is cancelled — it silently removed all branch protection.

## 1. What this application is

`u2giants/shared-db` (GitHub, PUBLIC) is the governed source of truth for the
**structure** of the shared Supabase database used across POP Creations' systems, plus
the small React app "DB Data Admin" (`apps/db-data-admin`) that people use to curate
Master Data. Nobody edits the shared database's structure by hand: every structural
change is authored here as a numbered migration file, goes through a pull request, and
is applied by workflow.

Two independent workstreams share the repository:

- the **orchestrator**, which does structure and schema work and is tracked by a marker
  issue (currently #2269). **This session must never touch it.**
- the **non-orchestrator / repository-maintenance queue**, which is this handoff:
  everything with `route: repo-maintenance` in the issue's machine block — the merge
  gates, the review tooling, the promotion evidence chain, the data admin app, and the
  ColdLion vendor integration.

The single most important mechanic: **`.github/workflows/guarded-migration-merge.yml`
is the ONLY way anything reaches `main`.** It posts a status called
`Migration guarded merge authorization`, which is a required check, so
`gh pr merge --admin` can never stand in for it. You merge by dispatching that workflow:

```
gh workflow run guarded-migration-merge.yml -f pull_request=<n> -f head_sha=<40-char sha>
```

## 2. What we set out to do this session, and why

Continue the non-orchestrator queue from the live handover, issue **#2258**, and work it
toward its terminal condition: **zero open non-orchestrator issues**, taken in
blocker-count order, then priority, then oldest first. The user then asked that some of
the issues be delegated to GLM 5.3 for implementation.

## 3. Current state — what is true right now

### Landed this session (both through the guarded lane, neither by admin merge)

- **Issue #2282 / PR #2275 — merge commit `beab1ddbd87f4656c503f6bbff395f02f4b99941`,
  run 33850160156.** The required-checks pre-flight, which is the gate on the only merge
  path into `main`, read only the FIRST page of GitHub's check-run and commit-status
  lists. A head with more than 100 reports could therefore be declared complete while
  reports were never seen. It now paginates both reads and refuses any page it cannot
  fully account for. Three fail-open holes were closed, and each guard was proved able to
  fail: dropping `--paginate` fails 4 tests, deleting the whole-page checks fails 2,
  forcing a missing total fails 5, letting an absent list be skipped fails 1 — against a
  42/0 green baseline. Issue closed with the merge commit named.
- **Issue #2116 / PR #2261 — merge commit `591b8951485c601dc2652b11e51aa1b2b366d854`,
  run 33852330265.** A production promotion "freezes" merges by marking the merge
  authorization as failed on the head of EVERY open pull request. Nothing ever put those
  back, and the message did not say why, so unrelated lanes stayed red forever and looked
  like genuine failures. The freeze now names the run that took each authorization and
  restores every one it took — on **any** outcome including cancellation — clearing to
  `pending` and never to `success`, so it cannot become a back door. Issue closed.

### In flight, on this branch, NOT committed at the time of writing

- **Issue #1223 — the guard mutation sweep.** New file `scripts/mutation_sweep_guards.py`
  (untracked). It switches off one refusal guard at a time across the production
  promotion evidence chain and re-runs the offline Python suite against each, to find the
  guards no test notices. A run over **266 guards in 7 files** was still executing when
  this handoff was written; its output goes to
  `docs/verification/guard-mutation-sweep-20260904.json`, and while it runs, one script
  under `scripts/` shows as modified — that is the tool holding a mutation, not a real
  edit. **Nothing about #1223 is committed or pushed yet.** The branch
  `claude/1223-guard-mutation-sweep` exists locally only.

### Blocked

- **Issue #1322 / PR #2278**, head `5031c6aea7467b636a3a5d1d94b0f48542447a59`. Complete,
  twice-approved by governed review, all checks green except one Playwright assertion
  that fails **on purpose**: `apps/db-data-admin/tests/browser/grid.spec.ts:287-290`
  asserts there is no "Properties" tab, per owner ruling #1686. See section 0 item 1. The
  conflict is already posted as a comment on PR #2278 and on issue #1322.

### Owned by OTHER live sessions — do not touch

Checked with `git worktree list` at 2026-09-04T1050Z. These have open pull requests held
by other sessions' worktrees, and taking them would collide:

- #2037 → PR #2264, worktree `shared-db-open-issues-c01c25`
- #2106 → PR #2266, a Codex worktree under `C:/Users/ahazan/.codex/worktrees/80fb/`
- #2157 → PR #2245, branch `codex/issue-2157-verdict-unknown`, already carrying two
  reviewer exclusions
- #2207 → PR #2260, temp worktrees `wt2260`, `wt2260rev2`, `wt2260up`

### Remaining in this queue, unclaimed

#1223 (in flight), #1403 (blocked), #1090, #1031, #810, #771, #770, #1868 (blocked while
the orchestrator marker #2269 is open), #1984. #2244 and #2243 look like this queue but
their machine blocks say `route: shared-db-orchestrator` — they are NOT ours. #1941 is a
fork to `curated-master-data-governance`.

## 4. Everything we tried that did NOT work

- **Delegating #1223 to GLM 5.3 (`ai-glm implement`, job `guard-mutation-tests-1223`).**
  It hit the wrapper's deadline and recorded `failed`. The task is a long mechanical
  sweep, not a reasoning task; a model wrapper with a turn budget is the wrong tool.
  Writing the sweep as a plain script and running it directly worked immediately.
  **Do not re-delegate #1223 to a model wrapper.**
- **Delegating #2157 and #2244.** Both look like queue work and are not available: #2157
  is another session's open PR, #2244 is orchestrator-routed. Always check
  `git worktree list` and the issue's `route:` before starting anything.
- **Two governed reviews were refused with `did not produce a recordable terminal verdict
  (exit 0)`, and both were my own fault.** The runner requires the reviewer's output to
  end with exactly one line `VERDICT: APPROVE|REVISE|REJECT <40-char sha>`, and a decision
  word opening any other line voids the whole review. My review brief did not say so. Two
  full reviews were lost — the runner discards the raw output on refusal (section 0 item
  5) — and were recovered by hand from
  `<worktree>/.ai/reviews/<wrapper>-<session>-<timestamp>.md`.
  **Every brief must end with the verdict-format block.** There is a working example at
  the bottom of every `brief-*.md` in this session's scratchpad.
- **Editing repository files with a naive Python string replace matched zero
  occurrences.** The files are CRLF, and `cat -A` under Git Bash hides that. Convert `\n`
  to `\r\n` on BOTH the search and the replacement, and read/write with `newline=''`.
- **Writing a JavaScript regular expression through a Python heredoc corrupted it three
  times.** `\n` and `\r` in an ordinary Python string become real control characters and
  land inside the regex literal, producing `SyntaxError: Invalid regular expression`.
  Splice the bytes with a raw `br"""..."""` replacement instead.
- **Grepping Node's test summary with `^. (pass|fail)` silently matched nothing.** Node
  prints `pass 42` behind an info glyph. Use
  `grep -aE "(^|[^a-z])(pass|fail) [0-9]+"`.
- **Piping a long background command through `| tail -300` gave zero progress output**
  for the whole run, because the pipe buffers. Redirect to a file instead if you want to
  watch a long sweep.
- **A large multi-line handoff written through a quoted shell heredoc failed to parse.**
  Write handoff files with the file-writing tool, not a heredoc.

## 5. Root causes and key findings

- **The reviewer reviews your working directory, not the pull request.** Reviews must run
  from a fresh clone in the scratchpad, force-set so its own `refs/heads/main` equals
  `origin/main`, detached at the exact PR head, `reset --hard` and `clean -fd`. The review
  sandbox prefers `refs/heads/main` over `refs/remotes/origin/main`, and the shared
  checkout `C:/repos/shared-db` has a stale, diverged `main` that must never be
  fast-forwarded.
- **A branch behind `main` must be updated BEFORE the review, not after.** The guarded
  merge refuses a branch behind a non-documentation `main`; updating changes the head,
  which invalidates a head-pinned verdict. So update-from-main, re-run CI, re-review, and
  merge must run back to back with nothing in between.
- **Review one pull request at a time.** The reviewer pool is five and two are
  historically dead. Two concurrent PRs exhaust it and one lane strands.
- **A review's findings are not automatically right.** Round one on PR #2261 raised two
  findings; one was real (a cancelled freeze skipped the restore) and one was false (it
  claimed deleting the restore step kept the suite green — an existing test asserts the
  step's presence). Both were answered on the PR with evidence, and the disputed one was
  put to the round-two reviewer explicitly, which confirmed it was wrong.
- **The truth audit binds COMMENTS, not just code.** Any new line under `scripts/` or
  `.github/workflows/` containing "missing", "never created", "not applied" and a few
  other phrases turns `Tools offline tests` red until it is given a human-reviewed
  disposition in `docs/verification/throughput-guard-truth-audit-20260828.json`. A code
  comment tripped it this session. The regeneration must preserve every existing entry
  verbatim and bump both the count and the digest.
- `npm audit` returned HTTP 503 from the public registry three times in a row and made
  `verify` red. That is an external outage, not a code fault — retry, never weaken it.

## 6. Exact next steps

1. **Finish the #1223 sweep.** Check whether
   `docs/verification/guard-mutation-sweep-20260904.json` exists in this worktree. If the
   sweep died, restore any modified script with `git checkout -- scripts/` and re-run:
   `python scripts/mutation_sweep_guards.py --file scripts/production_business_risk_gate.py --file scripts/production_apply_review_evidence.py --file scripts/production_migration_guard.py --file scripts/production_owner_decision_evidence.py --file scripts/preview_instance_binding.py --file scripts/historical_preview_recovery.py --file scripts/production_catalog_verification.py --command "python -m unittest scripts/test_atomic_migration_apply.py scripts/test_check_pass2_routine_supersession.py scripts/test_production_business_risk_gate.py scripts/test_production_apply_review_evidence.py scripts/test_production_migration_guard.py scripts/test_production_owner_decision_evidence.py scripts/test_preview_instance_binding.py scripts/test_historical_preview_recovery.py scripts/test_production_catalog_verification.py scripts/test_post_batch_app_verification.py" --out docs/verification/guard-mutation-sweep-20260904.json`
   *You will know it worked when* the JSON exists, `git status` shows no modified script
   (the tool restores every file and refuses to report if it cannot), and
   `python -m unittest scripts/test_*.py` still says `OK`.
2. **Read the survivor list and split it.** Commit the tool and the JSON, open a pull
   request for those two files alone, and file one follow-up issue per group of
   survivors. Do NOT try to fix 266 guards in one pull request — the issue itself warns
   that folding a coverage sweep into another change is what makes it unreviewable.
   *You will know it worked when* #1223 has child issues and the sweep is reproducible by
   anyone from a single command.
3. **Review and merge that pull request** using the sequence in section 7. It touches
   code, so the normal checks apply.
4. **Take the owner's answer on section 0 item 1 and finish or retire PR #2278.**
5. **Work the rest of the queue** in the order in section 3, checking `git worktree list`
   and the issue `route:` before each one.

## 7. Constraints and gotchas in force

- **The merge sequence, in this exact order, with nothing between the last three:** merge
  `origin/main` into the branch, push, wait for every check to be COMPLETED, then
  `node scripts/manage-migration-author-lanes.mjs --assign-reviewer --issue N --pr N
  --head-sha <sha>`, then `node scripts/run-governed-review.mjs --issue N --pr N
  --head-sha <sha> --reviewer <name> --wrapper <wrapper> --worktree <fresh clone> --
  new <session> --prompt-file <brief>`, then dispatch `guarded-migration-merge.yml`.
- Review wrappers are NOT on PATH in the Bash tool but ARE in PowerShell. They need
  caller variables: `AI_MUSE_CALLER`, `AI_GROK_CALLER`, `AI_GLM_CALLER` (set to `claude`).
- The reviewer wrapper takes a subcommand before its arguments: `new <session>
  --prompt-file <file>`.
- Never `git stash` in a worktree — the stack is shared with every other worktree. Use a
  temporary commit, or `git stash push -u -m "<unique-tag>"` and `apply <sha>`.
- Documentation-only pull requests merge immediately with `gh pr merge --squash --admin`
  and do not wait for checks. Anything containing code, tests, scripts, workflows or
  configuration does not qualify.
- Claude merges its own pull requests. Never end a session asking Albert to merge or
  review one.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## 8. Access and environment

- `gh` is authenticated as `u2giants` and can dispatch workflows and read/write issues.
- Node 24 and Python 3.13 are on PATH in this worktree. The offline Python suite is
  `python -m unittest scripts/test_*.py` — 897 tests, about 41 seconds, currently green.
  The Node suite for the lane tooling is 425 pass / 0 fail.
- Review wrappers `ai-muse`, `ai-grok-review`, `ai-glm` run from PowerShell.
- Secrets live in 1Password vault `vibe_coding`. **No credential was handled, read, or
  written in this session.**
- Scratchpad for this session (briefs, the review clone `rev2278`):
  `C:/Users/ahazan/AppData/Local/Temp/claude/C--repos-shared-db--claude-worktrees-shared-db-non-orchestrator-queue-01bc29/83983406-a32a-4462-abce-e01b6810d7f7/scratchpad`.

## 9. Open questions and risks

- **The #1223 sweep result is unknown at handoff time.** If it reports a large number of
  survivors in the production promotion chain, that is a real coverage finding about the
  last gate before a production write, and it deserves its own conversation before any
  further promotion is scheduled.
- **The sweep's own honesty depends on its baseline assertion.** An earlier hand-run
  sweep (recorded in #1223) timed out, left a file mutated, and poisoned the next two
  runs. The tool asserts a green baseline, restores from an in-memory copy in a `finally`,
  re-checks the digest, and refuses to write results if either fails. Believe a result
  only from a run that printed `baseline green` and wrote the JSON.
- **The reviewer pool is effectively three of five.** Every wasted allocation matters, and
  a refused review costs one. See section 0 item 5.
- **Decision, 2026-09-04:** PR #2278's failing test was NOT deleted, deliberately, because
  deleting it would silently overturn owner ruling #1686 with no record anywhere. A later
  session must not "fix the red check" that way.
- **Decision, 2026-09-04:** the restore step added for #2116 clears revoked authorizations
  to `pending`, never to `success`, because only the guarded merge workflow may assert
  that a merge lock was held and the head revalidated.
- **Decision, 2026-09-04:** three queue issues with live worktrees elsewhere were left
  alone rather than taken, on the evidence of `git worktree list` and `gh pr list`.

## Self-audit (handoff-writer gate)

1. *Could a newcomer continue with no questions?* Yes — section 1 explains the repository
   and the only merge path, section 3 gives exact PR numbers, heads and merge commits,
   section 6 gives a runnable command, section 8 gives the environment.
2. *As effectively as this session could?* Yes — section 4 carries every dead end,
   including the two lost reviews and their exact cause, and section 5 carries the
   non-obvious mechanics (review base resolution, ordering of update/review/merge,
   comment-binding truth audit) that each cost real time here.
3. *Every relevant detail?* Yes — background (1), goal (2), state and evidence (3),
   failures (4), findings (5), numbered next steps with verification gates (6),
   constraints (7), access (8), risks and dated decisions (9).
4. *Would the owner reading ONLY section 0 see every decision needed?* Yes. Sweeping
   sections 1-9 line by line surfaces five owner items: the #1322/#1686 ruling conflict
   (section 3, section 9), the ColdLion reply and history depth (section 3 queue list),
   the production read authorization for #771 (section 3), the Laura/Ilona sign-off for
   #1941 (section 3), and the review-runner discard found in passing (section 4) — which
   is outside this workstream and is exactly the category that normally goes unraised.
   All five appear in section 0, grouped by consequence, each with a recommendation.
