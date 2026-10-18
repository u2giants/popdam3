---
issue: 4395
status: OPEN
owner: mimo/4241-handoff-hygiene
---

# Handoff — land PR #4396 (handoff-hygiene F1–F3) and remaining hygiene

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

- `enforce_admins` is **false** on `popcre/shared-db` `main` (verified live 2026-10-16). Two PRs (#4294, #4206) were admin-merged without full review under that bypass. Restoring it is an owner decision (Albert). Until then an unreviewed PR can merge.
- No other business decision is owed for this workstream.

## 1. What this application is

`popcre/shared-db` is the shared Supabase shape-of-database repository (migrations, contracts, HANDOFF.d hygiene). This session did **repo-maintenance / documentation** only: no database writes, no migration claims, no structural objects.

## 2. What we set out to do this session, and why

Finish stale-item / HANDOFF.d hygiene left mid-audit (session prompt 2026-10-16):

1. Delete orphan worktree + branch `mimo/allowlist-widen-slot2` (post-merge leftovers of #4294).
2. Merge PR #4310 (handoff for open #2336).
3. Issue #4241: GLM follow-ups F1–F3 (dead predecessor links, `enforce_admins` re-derive, `report-stale-handoffs` publish).
4. Issue #4322: retire five uncited closed-issue HANDOFF.d files (already landed via #4323).

## 3. Current state — what is true right now

Checked **2026-10-18T14:52Z** on machine `edge-dev`.

| Item | State |
|---|---|
| `origin/main` tip | `12ed7189f4605757e0cc5e1a7ae98a1ef635b7e7` |
| Max migration | `20261016214635_coldlion_intake_header_tracks.sql` |
| Orphan `mimo/allowlist-widen-slot2` | **Deleted** (remote branch; worktree/local branch were already gone). Untracked `.ai` scratch dropped; `tmp-cleanup-preserve-20261015/` kept. |
| PR #4310 | **MERGED** 2026-10-16T15:55:55Z (`50be2a9f`). Worktree `2336-handoff-4310` removed after merge. |
| Issue #4322 | **CLOSED** (five handoffs gone from main via merged #4323). |
| Issue #4241 | **OPEN** (auto-tracker). F1–F3 comment posted 2026-10-16. |
| Issue #4395 | **OPEN** — work issue for PR #4396. |
| **PR #4396** | **OPEN / BLOCKED** — head `d5d28e3a7bdc1b985c146578bcfee8a62b36879b` on branch `mimo/4241-handoff-hygiene`. Docs-only: repair two dead predecessor links in `HANDOFF.d/2026-10-13T1804Z-edge-dev3-codex-eight-issues-owner-transfer.md` (predecessor `…preview-recovery.md` was retired by #4323). Evidence pair `.agent/work/4395/3/`. Needs **one independent APPROVE** then guarded merge. |
| Worktree `D:/repos/shared-db-worktrees/4241-hygiene` | **LIVE** — holds unmerged PR #4396. Do not delete. |
| Preview / production applies | **None** this session. |
| Migration claims held | **None** by this session (repo-maintenance; `--audit` shows 21 foreign claims). |

Evidence-pair shape on #4396 (must be preserved):
- Implementation head `5b2c9149d6c80f7e8c3c1b328e1729c0859c59b4` (handoff-only net vs merge-base `b31e17c02194c6006a1bd256d6154a324a5114d7`).
- Tail commit `d5d28e3a7…` adds exactly `.agent/work/4395/3/contract.json` + `completion.json`.
- Published contract `refs/db-contracts/4395/3` sha256 `f258ee1e6be5098f8216e0c9e83127cffae20f7ce60cdec3bc3df41a1bca3f41`.
- PR body must keep exactly one `Refs #4395` and `Posted by … chat … on …` (no underscores in the chat id token).

## 4. Everything we tried that did NOT work

**Do not repeat these.**

1. **Reviewer draw hangs / times out on Windows.** `--assign-reviewer` prints `pre-draw readiness` then blocks. Causes stacked:
   - `GIT_TERMINAL_PROMPT` / credential helper hang on `git fetch <sha>` — fixed with `GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=echo GCM_INTERACTIVE=never`.
   - `refs/db-coordination/author-acquisition` mutex left held by killed draws. Recovery is `gh workflow run recover-author-mutex.yml -f expected_sha=<sha> -f "confirmation=RECOVER <sha>"` (needs mutex **≥2 minutes old**). Something else re-acquires the mutex the instant recovery finishes — race; retry.
   - On `MUTEX_REF is occupied`, `assignWithMutexRetry` sleeps **5 minutes** then retries once. Short tool timeouts look like a hang; they are that sleep.
2. **Review-budget provenance `surviving author source edit unavailable`.** Circuit breaker compares the previous start head (`ad214f05f…`) to the new head. It fails when **`origin/main` has moved** since the pair was written (the merge projection no longer yields a surviving authored edit). **Mitigation:** merge current `origin/main` into the branch, rebuild the pair against the new merge-base, publish a new contract generation, and draw **immediately** before main moves again. Confirmed `githubIo.reviewContentComparison(ad214f05f…, <new head>, 4396, {})` returns `kind: substantive` right after such a refresh.
3. **Lifecycle-pool reviews (new main tooling).** `ai-glm` / `ai-deepseek-agent` are forced through `ai-review <provider> final-check`. The DeepSeek report at `.ai/reviews/deepseek-final-check-20261016T160752-2472922-1307.md` **was** a well-formed `VERDICT: APPROVE` and **does** bind when `lifecyclePoolReportBody` is invoked standalone — but the live runner refused it (`report does not bind…`) until the worktree was clean and main was stable. GLM's wrapper on Windows failed with `governed source root is not a repository top level`.
4. **Force-pushing to clean the evidence tail** broke first-parent ancestry and the budget (`complete first-parent ancestry unavailable`). Keep the previous reviewed head as an ancestor; put new work **on top**, never rewrite it away.
5. **`ai-task-gates start --class documentation|repo-maintenance`** — those class names do not exist. Valid: `prose`, `code`, `shared-db`, …
6. **`ai-shared-db-closeout-check --session-id ses_ffe5ebe06c403ffeCpIJESDDks`** refuses: tool requires a Codex/Claude **UUID**. This MiMo session id is not a UUID. Manually confirmed zero owned claims/stages (see §3).
7. **Exhausted rotation on one head.** After several `wrapper_terminal_failure` releases on unchanged content, all four pool reviewers become ineligible (`two verified service failures for unchanged content` / preflight unusable). A **substantive** new head resets that.

## 5. Root causes and key findings

- Dead predecessor links: `HANDOFF.d/2026-10-13T1804Z-…-owner-transfer.md` pointed at `…2026-10-13T1649Z-…-preview-recovery.md`, which #4323 retired. Fix: name the retirement and point at git history (`commits/main/…`).
- `enforce_admins` on `main` is **false** (GitHub API, 2026-10-16).
- `report-stale-handoffs.mjs --publish` reconciled #4241; 15 closed-issue files remain "cited" because #4241's own body lists them (checker reads bodies only). Retiring those needs the same pattern as #4322: list-to-retire in the issue, delete in one PR, close the issue.
- DeepSeek final-check (2026-10-16) on an earlier head of this PR: **APPROVE** with only Low findings (whitespace CRLF, incomplete probe object list). Those Low items were applied.

## 6. Exact next steps

**PROMOTION MERGE FREEZE (checked 2026-10-18T14:55Z):** merges are paused until **2026-10-18T17:51:09.878Z**. Holder: `Claude subagent of chat b6410b17-053b-4ff2-adc8-f25b053cb611 on edge-dev3` for PR #4386 (issue #4373). This blocked docs-only authorization on PR #4424 (`REFUSED: merges are paused for a production run`). Do not retry merge before the freeze expires or that holder releases it.

0. After the freeze: merge docs-only PR **#4424** (this handoff) first — `gh pr merge 4424 --repo popcre/shared-db --auto --merge`.

1. Recover the draw lock if held: `gh workflow run recover-author-mutex.yml --repo popcre/shared-db -f expected_sha=<current sha> -f "confirmation=RECOVER <sha>"`.
2. If the budget fails, merge `origin/main` into `mimo/4241-handoff-hygiene`, rebind `.agent/work/4395/` to the new merge-base (new generation, publish `refs/db-contracts/4395/<n>`), keep implementation = handoff-only net diff, tail = the two pair files.
3. Draw: `SHARED_DB_AUTHOR_ENGINE=mimo GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=echo node scripts/manage-migration-author-lanes.mjs --assign-reviewer --issue 4395 --pr 4396 --head-sha <live head>` (run from `D:/repos/shared-db-worktrees/4241-hygiene`).
4. Governed review via `scripts/run-governed-review.mjs` with `AI_IMPLEMENTER_ENGINE=mimo` (pool path) or the historical `ai-deepseek-agent send --prompt-file … --review` if pool binding misbehaves. Need one durable `VERDICT: APPROVE` at the exact head.
5. Dispatch `guarded-migration-merge.yml` with `pull_request=4396` and the exact approved head. Merge queue may stall `AWAITING_CHECKS` / `Merge Queue Gate` on the exclusive merge lane — wait or requeue (`dequeuePullRequest` GraphQL, then `gh pr merge --auto --merge`).
6. After merge: close #4395, comment on #4241, remove worktree `4241-hygiene` only after `gh pr view 4396` shows `MERGED`.
7. Optional hygiene (not started): retire the 14 closed-issue HANDOFF.d files listed on #4241 using the #4322 pattern once their body citations are cleared.

## 7. Constraints and gotchas in force

- **Landing-only** for `C:\repos\shared-db`. Edits go in a worktree (`D:/repos/shared-db-worktrees/…`).
- Do **not** delete worktree `4241-hygiene` or branch `mimo/4241-handoff-hygiene` until PR #4396 is MERGED.
- Do **not** invent PRs; do **not** `--admin` merge.
- Never force-push away a head that carries a review start (budget ancestry).
- Always set `GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=echo` for git/network in these tools on Windows.
- Sign GitHub posts: `Posted by MiMo chat <id> on edge-dev` (chat id token must match `[A-Za-z0-9-]+` — no underscores).
- One `Refs #<issue>` only on nonclosing maintenance PRs; never `Closes`/`Fixes`/`Resolves` for a still-open parent.

## 8. Access and environment

- Machine: `edge-dev` (Windows). Session: MiMo `ses_ffe5ebe06c403ffeCpIJESDDks` (not a UUID — closeout-check cannot use it).
- GitHub: `gh` as `u2giants`. Repo `popcre/shared-db`.
- Worktrees: `C:/repos/shared-db` (landing), `D:/repos/shared-db-worktrees/4241-hygiene` (this PR), plus unrelated live ones (`2530-*`, `orch-strike`, `bootstrap-no-reviewer`) — not ours.
- Tools: `node scripts/manage-migration-author-lanes.mjs`, `scripts/run-governed-review.mjs`, `gh workflow run guarded-migration-merge.yml`, `gh workflow run recover-author-mutex.yml`.
- Secrets vault `vibe_coding` (1Password). No credential values in this file.

## 9. Open questions and risks

- Who restores `enforce_admins` on `main`, and when? (Albert.)
- Reviewer-draw reliability on this Windows host is poor (mutex races, 5-minute retry sleeps, lifecycle-pool report binding). A Linux/edge-dev3 successor may find the draw much easier.
- #4241's tracker body cites the 14 retire-candidates, so `report-stale-handoffs` will keep them in the "do not retire" bucket until that body is rewritten and the deletions land together.

