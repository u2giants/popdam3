---
issue: 3532
status: OPEN
owner: mimo/non-orchestrator-continuation-20260925
---

# Non-orchestrator sweep — continuation handoff (2026-09-25 ~2:00 PM EST)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Still unanswered from the prior handoff §0 (PR #3534):

1. **#2290** — authorize ColdLion health-lane deployment (or close).
2. **#2541** — confirm 33 codes (not 66) and that #1941 is not a hard gate.
3. **#2701** — schedule popdam3 `444f960` prod deploy + live Property Matches proof (Ilona Kereki, Laura Arevalo).

New this session:

4. **PR #3352 AGENTS.md conflict** — Muse APPROVE is durable at head `7f31507b`, but the merge is blocked because `origin/main` moved and `AGENTS.md` now conflicts (Disney routing / #3481 router). The mid-merge guard forbids the session from resolving another author's conflict markers. **Authorize AGENTS.md conflict resolution on the PR branch, or name the main-side owner.**

---

## 1. What this application is

`popcre/shared-db` — shared Supabase database repo for POP Creations. Migrations, guarded merge tooling, CI, cross-app rulebook. Non-orchestrator work = docs/scripts/CI, not database structure. Machine `edge-dev`, Windows. Shared checkout `C:\repos\shared-db` is landing-only — use worktrees.

## 2. Goal

Finish remaining open non-orchestrator issues. Verify with:
`gh issue list --label non-orchestrator --state open` shrinks to claims / programs / external only.

## 3. What landed THIS session (with proof)

| PR | Issue | Reviewer | Verdict | Merge commit |
|---|---|---|---|---|
| #3394 | #3392 | gemini-3.8-flash-high | APPROVE | `9047570d8` |
| #3371 | #3367 | gemini-3.8-flash-high | APPROVE (pre-existing) | `bed91d376` |
| #3373 | #3372 | deepseek-v4.1-flash | APPROVE | `12eb4f74b` |

Also: #2678 closed (fix verified on main). Duplicate PR families consolidated (#3525 kept / #3529+#3531 closed; #3528 kept / #3530 closed). Status comments on 11 issues.

## 4. In-flight sub-agents at handoff time (4 still running)

These were spawned as background sub-agents. If this session is ending, they may still complete — check `gh pr view` before redoing work.

| Agent | Task | Last known state |
|---|---|---|
| general-27 | Restructure #3248 commit topology + land (issue #3262) | turn 64, running |
| general-30 | Re-review + merge #3523 (issue #3383) at head `a847b511` | turn 41, running |
| general-31 | Re-review + merge #3352 (issue #3002) at head `7f31507b` | **DONE — APPROVE durable, merge blocked on AGENTS.md conflict (see §0 item 4)** |
| general-34 | Re-review + merge #3369 (issue #3361) at head `aa103096` | turn 19, running |

## 5. Needs a fix round (REVISE findings on record)

### #3445 / issue #3380 — gemini REVISE at `fed83b09` (5 findings)

Durable verdict `refs/db-review-verdicts/3380-3445-fed83b09…`.

1. Contract scope: `scripts/lib/agent-evidence-paths.mjs` + `.test.mjs` edited but not in `allowed_paths` — needs successor generation 7, or revert those edits.
2. Gate failure: `completion.json` `head_sha` is stale vs PR head.
3. `files_changed` omits the two evidence-paths files and includes evidence files that belong in the tail commit.
4. `planSuccessor` regex uses `\d+` instead of binding to the specific issue.
5. `gitIo.readPublishedContract` throws unhandled on missing predecessor ref.

### #3369 / issue #3361 — waiting on general-34 re-review at `aa103096`

All prior findings fixed (M1-M3, P1-P3, ruleset `integration_id ?? null`, `update-required-checks.test.mjs` in CI). Tests 52 pass. If general-34 returns REVISE again, read its findings before touching code.

### #3248 / issue #3262 — waiting on general-27 commit restructure

Muse APPROVE exists at `610c0733` but "Agent work contract" is red (interleaved evidence-pair / implementation commits). general-27 is rebuilding the topology (clean implementation head, evidence pair alone on top).

### #3523 / issue #3383 — waiting on general-30 re-review at `a847b511`

H1/M1/M2/L1/L3 fixed, evidence pair rebound. If general-30 returns REVISE, read findings first.

## 6. Exact next steps

1. **Check the four in-flight agents** (`gh pr view 3248|3523|3352|3369 --json state,headRefOid,mergeStateStatus`) — any that landed need issue close; any that REVISEd need a fix round.
2. **Authorize the #3352 AGENTS.md conflict resolution** (§0 item 4), then re-review the refreshed head and re-dispatch merge.
3. **Fix #3445** five findings (§5), push, re-review, merge, close #3380.
4. **Verify**: `gh issue list --label non-orchestrator --state open` shrinks to claims / programs / external only.

## 7. Constraints and gotchas in force

- **Worktree-only.** Never edit `C:\repos\shared-db` shared checkout.
- **Non-orchestrator only.** No migrations, no schema, no RLS, no production applies.
- **One independent review** for scripts/docs/CI. Never invent verdicts. Silence is never approval.
- **REVISE/REJECT stops the merge** — fix findings, push a new head, re-review.
- **`--replacement-sequence` is required** after a `--replace-failed-reviewer` draw (use the `replacementSequence` value from the assign JSON).
- **Wrapper args after `--`** are only `new <session> --prompt-file <file>` — do NOT repeat the wrapper name.
- **Set ALL caller env**: `AI_MUSE_CALLER`, `AI_QWEN_CALLER`, `AI_DEEPSEEK_CALLER`, `AI_GEMINI_CALLER`, `AI_GROK_CALLER` = `mimo`.
- **Evidence pair topology**: implementation commit (no evidence files) then exactly `contract.json` + `completion.json` alone on top. `head_sha` in completion.json = implementation commit.
- **Do not touch** #3505 (other session), #3496 (orchestrator marker), any `db-claim` issue's claim state.
- **Sign every GitHub body**: `Posted by MiMo chat unknown on edge-dev`

## 8. Access and environment

- `gh` authenticated as `u2giants`. Machine `edge-dev`, Windows.
- Task gates: `ai-task-gates start --class code|prose` from `C:\repos\ai-devops\bin\ai-task-gates`.
- Reviewer wrappers in `C:\repos\ai-devops\bin\` (`ai-muse`, `ai-qwen`, `ai-deepseek-agent`, `ai-gemini`, `ai-grok-review`).
- Merge dispatch: `gh workflow run guarded-migration-merge.yml -f pull_request=<n> -f head_sha=<exact head>`
- Secrets: 1Password vault `vibe_coding` (none used this session).

## 9. Findings worth promoting

- `run-governed-review.mjs` accepts `VERDICT: REVISE <sha>` (the SHA suffix is in the parser regex) — the "bare token only" warning in briefs is not enforced.
- `contractHash` uses canonical JSON (sorted keys, no whitespace) — reformatting `contract.json` is hash-preserving and can satisfy the "tail must contain both evidence files" rule.
- After `gh pr update-branch`, the evidence pair must be rebound by hand (`base_sha` = new merge base, `head_sha` = implementation commit); the raw merge leaves it stale.
- `--assign-reviewer` is idempotent and will not recreate a lease once a durable verdict exists at that head/slot (`isReviewAssignmentLive` returns false). "no held reviewer lease" usually means "verdict already on record", not "assignment failed".
- Orphaned `refs/db-coordination/author-acquisition` blocks assign-reviewer; local `--recover-author-mutex` is refused outside Actions — use `recover-author-mutex.yml`.
- A green "Documents-only merge authorization" check does NOT mean the PR is docs-only; `.agent/work/**/completion.json` + `contract.json` are non-lightweight.

---

Posted by MiMo chat unknown on edge-dev
