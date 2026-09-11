---
issue: 2247
status: OPEN
owner: claude/orchestrator-2224-closeout
---

# Orchestrator closeout — marker #2224 (shared-db.orch EDGE-DEV 2026-09-03d)

All SHAs, versions and PR states below were re-derived from `gh`/`git` at
**2026-09-04T00:20Z**. Anything older than that is marked stale in section 9.

- `main` tip at write time: `3999c48b96de1b82b4ca662f3b0c1ef3093ce656`
- Highest migration version on `origin/main`: `20260903200951`
- Author lanes: **7/8 occupied**, 7 protected claims, 5 expired-but-locked leases

## 1. What this session was doing, and why

Running the single governed shared-db orchestrator: hold marker #2224, audit the
queue, drive in-flight structural PRs through review then guarded merge, and clear
the preview-ledger orphan that was blocking the #2171 ColdLion landing chain.

## 2. What was actually done

| Outcome | Evidence |
| --- | --- |
| PR #2199 merged (`coldlion.division` reference table, version `20260903200951`) | merge commit `477ef03cd516c79188d81b6c21260575a43a9239` |
| PR #2232 merged | merge commit `3999c48b96de1b82b4ca662f3b0c1ef3093ce656` |
| Issue #2171 completed and closed; claim #2194 released and closed | completion record published by `--complete-work`; `--release-claim 2194 --owner claude/agent-2171` |
| **Preview-ledger orphan `20260903115927` reconciled as `20260903200951`** | workflow run `33821298999`, conclusion **success** |
| PR #2183 migration re-reserved `20260903025816` to `20260904001147` | governed `--supersede-active-claim-version` |
| PR #2186 migration re-reserved `20260903025751` to `20260904001555` | supersession `eea60857a00e47b37f03561b5001187241fe09a6`, new head `528d3e9c45e43f7b9c975fd53ac15a460972b814`, `scripts/check-sql.sh` now passes |
| PR #2237 round-1 review returned a genuine High finding; repair implemented (append-only exclusion **generations**, bound 4, fails closed), 436 tests pass | branch head `7319fffdd24a3efa9a137bb53e192ad827d8c138` |

## 3. Preview and production

- **Production: nothing applied.** No production workflow was dispatched.
- **Preview:** one governed change — the orphan reconciliation above, which
  renamed a single ledger row inside a transaction and wrote an immutable
  before/after evidence artifact. **No data rows were written to preview.**

## 4. Half-finished / in flight

- **PR #2237 round-2 governed review was still running when the session ended.**
  Reviewer `grok-4.6`, review slot 1, replacement sequence **1221**, head
  `7319fffdd24a3efa9a137bb53e192ad827d8c138`, grok session `rev2237-7319fffd`.
  No verdict artifact existed at close. A successor must re-check
  `--reviewer-capacity` before drawing anything, because that lease may still be
  held.
- **PR #2186** is green on checks but has had **no governed review** since the
  version supersession. Head `528d3e9c45e43f7b9c975fd53ac15a460972b814`.
- **PR #2183** (version `20260904001147`) and **PR #2185** (head `32939dad`)
  are updated from main and awaiting review.

## 5. What this session owned

- Marker issue **#2224** (closed as the final act of this session).
- No worktree of its own beyond scratchpad clones (`tool`, `rev`, `rev2`) that
  live outside the repository and need no cleanup.
- Claim worktrees touched but **not** owned: `coldlion-2173-hist` (now at PR
  #2186's head, clean) and `coldlion-cust-sp-2177`.

## 6. What was about to happen next

Merge #2237 on APPROVE via
`gh workflow run guarded-migration-merge.yml -f pull_request=2237 -f head_sha=<head>`,
then review and merge #2183, #2185, #2186, then #2230 and #2228.

## 7. Blocked on

Reviewer-pool contention only. The pool is five and two are structurally dead
(`codex-gpt-5.6-sol` — issue #2244; `deepseek-chat` fabricates reviews).
**Review one PR at a time.** Nothing is waiting on Albert.

## 8. What did NOT work — MANDATORY

- **`ai-grok-review` invoked without a subcommand** exits 2. It must be called as
  `-- new <fresh-session-name> --prompt-file <f> --max-turns 60`, and a session
  name can never be reused.
- **`run-governed-review.mjs` without `--replacement-sequence`** is refused with
  "reviewer does not hold the exact active lease" — this is *not* the slot bug.
  Worse, the replacement ref is keyed by the **FAILED** sequence, not the new
  one; passing the new one is refused as "the exact durable reviewer assignment
  does not exist". Each mistake burned one paid reviewer turn.
- **A 10-minute foreground shell timeout killed a running review** (exit 143),
  leaving a stopped session and no verdict. Always run reviews backgrounded.
- **The orphan-reconciliation workflow refused twice before succeeding.** First
  for a missing required `main_sha` input; then with "work issue is not the exact
  supported-case issue", because the manifest case for #2171 pins
  `issue_state: closed` / `claim_state: closed` while both were still open. The
  fix was to publish the completion record, release the claim and close both —
  not to touch the guard.
- **The shared checkout at `C:\repos\shared-db` was stale**, so
  `config/preview-ledger-orphan-reconciliations.json` there did not contain the
  #2171 case at all and made the refusal look like a missing manifest entry.
  Read verification facts from `origin/main`.
- **A guarded merge of #2237 failed earlier** on `check-main-tip-freshness`
  because main moved underneath a pinned verdict. Update from main, re-draw,
  re-review and re-merge **back to back**; a re-merge of main invalidates the
  pinned verdict. Filed as issue #2243.

## 9. Facts that may already be stale

Every PR head SHA, the `main` tip, the max migration version, the 7/8 lane
count, and the reviewer-capacity state are snapshots from 2026-09-04T00:20Z.
Re-derive all of them with `git fetch` / `gh pr view` before acting. In
particular the #2237 review was **in flight** and its outcome is unknown here.

## Per-sub-agent blocks

### Agent: PR #2237 exclusion-generations repair
- **Asked to do:** fix the round-1 High finding — a successful lift permanently
  occupied the only exclusion slot, so a later `already-reviewed` or
  `independence-conflict` exclusion could never be recorded.
- **Actually did:** implemented append-only exclusion generations; generation 1
  keeps the historical ref name byte-for-byte; bound 4; exhaustion refuses.
  436 tests pass and every guard was mutation-proved.
- **PR / branch:** #2237, head `7319fffdd24a3efa9a137bb53e192ad827d8c138`.
- **Worktree:** live — round-2 review outstanding.
- **Deliberately did NOT do:** did not raise or remove the generation bound.

### Agent: PR #2186 conflict resolution
- **Asked to do:** resolve the merge conflict and get checks green.
- **Actually did:** resolved `PREVIEW_PRODUCER_PATHS` **additively** (two sidecar
  paths appended to the same list), head `f80c9ab7`; then this session
  re-reserved the version, producing head `528d3e9c` with `check-sql.sh` green.
- **Worktree:** `C:/repos/shared-db/.claude/worktrees/coldlion-2173-hist`, live,
  clean, at the PR head.
- **Deliberately did NOT do:** did not re-timestamp the migration by hand — that
  went through the governed supersession path instead.

## Session hygiene

- **Secrets sweep: swept, nothing new.** No credential, token or connection
  string appeared in this session; nothing was added to `vibe_coding`.
- **Docs pass:** nothing outside this handover is stale. The dead-reviewer and
  freshness-check facts already have their own issues (#2244, #2243, #2207).

## Deliberately left in place

- Five expired-but-locked author leases and 7/8 occupied lanes: expiry is an
  audit warning, not a release, and each claim still has an open PR.
- The worktree reap was **not** run — `scripts/reap-merged-worktrees.mjs`
  refuses while an `orchestrator-marker` issue is open, and the marker was open
  for the whole session. Tracked by issue #1868.
