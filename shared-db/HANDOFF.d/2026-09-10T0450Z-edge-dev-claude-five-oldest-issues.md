---
issue: 2326
status: OPEN
owner: claude/five-oldest-open-issues-ad33ca
---

# Five oldest non-orchestrator issues — closeout

- **UTC:** 2026-09-10T04:50Z
- **Machine:** EDGE-DEV
- **Agent:** claude (Opus 5), session `7f5b5093-7cda-464a-862e-761eb6d68432`
- **Not the orchestrator.** The live marker is #2669 (`shared-db.orch EDGE-DEV succ-2629`), owned by another session. This session ran the independent repo-session lane (`route: repo-maintenance`) only.

## 1. What I was doing and why

Albert: *"pick up the 5 oldest non-orchestrator open issues that have no blockers and complete them through to production."* The working set was #2301, #2307, #2308, #2323, #2326 — all `route: repo-maintenance`, which is the lane permitted while another session holds the orchestrator marker.

## 2. What I actually did

- **#2307** — closed. ai-devops reviewer-wrapper work: PR merged as `e4c98ab2b06f9db70ef6f26516efea6334f9d21e` (shared-db PR #2659).
- **#2308**, **#2323** — closed earlier in the session with evidence recorded on the issues.
- **#2301** — left open, nothing owed by this session. Its Phase A is another session's PR #2640.
- **#2326** — Step 2 of `plan_database_efficiency_and_api_security.md` delivered and merged. shared-db PR #2661, **merge commit `59f7d2a7558a1359ef9e7a13c256ff23edf37c50`**, final reviewed head `54b709280e905b3ac9fbc7bf9478406c31ae0299`. Deliverable: `docs/verification/database-efficiency/20260910T002917Z/api-access-matrix.md`. Progress comment posted: issue #2326 comment 5613389307. Remote branch `claude/issue-2326-api-access-matrix` deleted.
- **popcre/ai-devops #358** — confirmed merged (`ai-glm` doctor fix, merged 2026-09-10T02:32Z).
- **popcre/ai-devops #362 / PR #363** — diagnosed and fixed a real defect in `bin/ai-gemini`; merged as **`3db8620e916b02ae092a4d58f9110a01cafe5248`**, pulled into the canonical `C:/repos/ai-devops` checkout so the installed shim carries it.
- **shared-db #2662** — the owner-decision issue holding the unremediated cross-application read path named in the Step 2 artifact (`status: owner-decision`). Filed earlier in the session; still open by design.

## 3. Applied to preview / production

**Nothing.** No migration, no DDL, no data write, to preview or production. Every database interaction in this session was read-only: catalog reads (`pg_class`, `pg_proc`, `pg_policy`, `pg_views`, `pg_matviews`, `information_schema.role_table_grants`) and HTTP probes shaped `select=*&limit=0` with `Prefer: count=exact`, so every response body was the literal `[]` and only the `Content-Range` total was read.

## 4. Half-finished or abandoned

Nothing half-finished. #2326 Steps 3–8 remain open, but they were never started here — the plan requires a fresh session per phase.

## 5. What I own

Nothing still held. Both of my worktrees (`C:/repos/shared-db-worktrees/issue-2326-step2`, `C:/repos/ai-devops-worktrees/gemini-qual-persist`) were clean with merged branches and are removed at wrap-up. No open PR, no reviewer lease, no author lane, no claim.

## 6. What I was about to do next

Nothing in the five-issue scope — it is finished to the extent one session can finish it.

**The workstream this file is filed against is still open.** `plan_database_efficiency_and_api_security.md` Steps 3-8 remain, tracked on #2326. Step 3 is the next one, and it is a declared blocker for structural issues #2213, #2214 and #2215. Read the plan's STATUS table first: Step 1 and Step 2 rows are now authoritative, and Step 2's row records exactly what was and was not proven, so do not re-derive it. Start Step 3 in a fresh session with a fresh worktree from current upstream; the plan requires one session per phase.

## 7. Blocked on

Nothing technical. One item sits with Albert: **#2662** — the Step 2 artifact names a live, unremediated cross-application read path, and `u2giants/shared-db` is a PUBLIC repository. Albert authorized publishing anyway on 2026-09-09 and asked that the remediation be recorded for later. It is recorded; the remediation itself has not been scheduled.

## 8. What I tried that did NOT work — READ THIS FIRST

- **The gemini reviewer's "provider fault" was our own wrapper bug.** `ai-gemini doctor` exited 3 `QUARANTINED` forever after any `agy` upgrade, and the governed review runner reported it as a *local dependency fault*. Cause: `qualify_live()` ran the full live safety qualification and then never wrote `$QUALIFICATION_FILE`, which `runtime_qualified()` only ever reads. Fixed in popcre/ai-devops PR #363. **Do not use `--confirm-local-dependency-unfixable` to route around a reviewer preflight failure** — I did it once to keep a different PR moving, and it hides exactly this class of bug. Read the wrapper.
- **`--replace-failed-reviewer` is not idempotent.** I ran it twice while inspecting its output (`head` vs `tail` of the same JSON) and drew two replacements. Capture the output once and read it from a variable.
- **`git rev-parse HEAD~2` is not the branch base.** My first scripted rebase used it and produced a `DU` conflict on the deliverable itself. Use `git merge-base HEAD origin/main`.
- **A rebase onto main conflicts on `.agent/*` every time**, because other lanes touch those files on main. Resolve with `git checkout --theirs .agent/completion.json .agent/contract.json` (during a rebase, `--theirs` is *your* commit), then retarget `completion.json`'s `head_sha` to the new implementation commit and amend the evidence commit.
- **The guarded merge lost two races against a busy main.** See §9.
- **kimi-k3 hit its usage limit three times** across the session. It is not dead; it is out of quota. Replace with `--failure-code insufficient_quota --confirm-no-verdict --confirm-no-artifact`.

## 9. The merge race — the one structural fact worth carrying forward

`guarded-migration-merge.yml` refuses any dispatch whose base is behind `origin/main` when main's newer commits are not documentation. Rebasing to satisfy that changes the PR head, which **voids both durable reviewer verdicts** and forces a fresh draw plus two fresh reviews. On 2026-09-10 another lane was landing on main every 15–40 minutes and PR #2661 lost twice before winning on the third attempt.

The cycle that finally worked, run back to back with nothing in between:

1. `git merge-base HEAD origin/main` → rebase `--onto origin/main` that base; resolve `.agent/*` with `--theirs`.
2. Retarget `completion.json`'s `head_sha` to the new `HEAD~1`; amend the evidence commit; validate with `scripts/agent-work-contract.mjs --validate-completion`.
3. Force-push with `--force-with-lease`.
4. Draw **both** slots with `--assign-reviewer` before running either review.
5. Run **both** reviews **concurrently**.
6. Re-read `origin/main`, confirm it has not moved, and dispatch the merge in the same breath.

A helper script for steps 1–4 is at `<session scratchpad>/recycle-2661.sh`; it is session-scratch, not committed, and is worth re-creating rather than hunting for.

## 10. Facts that may already be stale

Everything below was true at 2026-09-10T04:45Z and moves fast:

- `origin/main` was `7b82064e3264f2921cade463cbb046fb292d0da5` before the #2661 merge; it has certainly moved since.
- The live orchestrator marker was #2669. Re-check with `node scripts/check-orchestrator-marker.mjs`.
- Reviewer quota state: kimi-k3 out of quota; muse and gemini healthy after the #363 fix. Quota resets.
- The census figures in the Step 2 artifact (517 relations / 217 exposed / 51 with `anon SELECT`) are a point-in-time catalog read from 2026-09-10 and are not a standing fact.
