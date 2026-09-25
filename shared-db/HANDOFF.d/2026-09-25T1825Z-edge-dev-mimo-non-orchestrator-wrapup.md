---
issue: 3532
status: OPEN
owner: mimo/non-orchestrator-wrapup-20260925
---

# Non-orchestrator sweep — wrap-up handoff (2026-09-25 ~2:20 PM EST)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Blocking (work cannot proceed without Albert)

1. **PR #3352 AGENTS.md conflict.** Muse APPROVE is durable at head `7f31507b`, but the merge is blocked: `origin/main` moved and `AGENTS.md` now conflicts (Disney routing / #3481 router). The mid-merge guard forbids the session from resolving another author's conflict markers. **Authorize AGENTS.md conflict resolution on the PR branch, or name the main-side owner.** Then re-review the refreshed head and re-dispatch merge; close #3002.
2. **#2290 — authorize ColdLion health-lane deployment** (or say no and close). Blocks ColdLion sync closeout.
3. **#2541 — confirm the authorized ColdLion property-code set is the 33 unique codes** in `docs/coldlion-unmatched-properties-by-licensor-20260731.md` (not the stale "66"), and whether Laura/Ilona **#1941 is a hard gate**. Recommendation: confirm 33; treat #1941 as NOT a hard gate.

### Scheduling (recoverable, but wasteful to guess)

4. **#2701 — production deploy of popdam3 `444f960`** + live Property Matches proof for Ilona Kereki and Laura Arevalo. Recommendation: schedule the `workflow_dispatch` deploy (`launch-data-designflow-app`).

### Hand-offs (nobody is on them)

5. **#3218** — DesignFlow production missing `hts_rag` schema. Hand to the DesignFlow production session.
6. **#3351** — ColdLion technical must answer `/proddetails` row identity. Albert chases ColdLion tech.
7. **#2600** — Licensing Master Data 3.5 preview/performance proof. Curated Master Data route; blocked on #2336.
8. **Required-check mirror drift** (12 vs 4 contexts). Open a small refresh ticket.

### Already settled — do NOT re-ask

- Five contested property attributions ruled live (#539, 2026-08-18).
- No `HANDOFF.d/` file-count cap (2026-08-13).
- Technical production approvals go to an independent reviewer (2026-09-16).
- #3505 is owned by session `shared-db.orch` — do not touch.

---

## 1. What this application is

`popcre/shared-db` — shared Supabase database repo for POP Creations. Every app reads/writes the same tables. This repo holds migrations, guarded merge/review tooling (`scripts/manage-migration-author-lanes.mjs` and friends), CI workflows, and the cross-app rulebook (`AGENTS.md` → `docs/agents/`).

Non-orchestrator = repo-maintenance, reviewer-tooling, docs, CI, source-data loaders — **not** database structure. Machine `edge-dev`, Windows. Shared checkout `C:\repos\shared-db` is landing-only — use worktrees.

## 2. What we set out to do

Finish remaining open non-orchestrator issues from the 2026-09-25 sweep (handoff PR #3534). Land the five green PRs (#3445, #3394, #3373, #3369, #3371) via one independent review + `guarded-migration-merge` each. Verify `gh issue list --label non-orchestrator --state open` shrinks to claims/programs/external only.

## 3. Current state — what is true right now

**Checked 2026-09-25 ~2:20 PM EST.**

### Landed this session (4 PRs, all APPROVE + guarded merge)

| PR | Issue | Reviewer | Merge commit | Time |
|---|---|---|---|---|
| #3394 | #3392 | gemini-3.8-flash-high | `9047570d8` | 10:33 AM EST |
| #3371 | #3367 | gemini-3.8-flash-high | `bed91d376` | 10:44 AM EST |
| #3373 | #3372 | deepseek-v4.1-flash | `12eb4f74b` | 1:32 PM EST |
| #3523 | #3383 | muse-spark-1.3-contributor | `92c7897c3` | 2:13 PM EST |

Also: **#2678 closed** (fix verified on main). **Duplicate PR families consolidated**: kept #3525 (closed #3529, #3531), kept #3528 (closed #3530). Status comments posted on 11 issues.

### In-flight at wrap-up (1 sub-agent)

- **general-27** — restructuring #3248 commit topology (issue #3262). Turn 85, still running. PR head moved to `9a802624dbe4bda45d4f0ed452951bc96cb66ffb`. Muse APPROVE exists at old head `610c0733` but "Agent work contract" is red from interleaved evidence-pair/implementation commits. The agent is rebuilding: clean implementation head, evidence pair alone on top.

### Needs a fix round (REVISE findings on record)

**#3445 / issue #3380** — gemini REVISE at `fed83b09` (durable `refs/db-review-verdicts/3380-3445-fed83b09…`). Five findings:
1. Contract scope: `scripts/lib/agent-evidence-paths.mjs` + `.test.mjs` edited but not in `allowed_paths` — needs successor generation 7, or revert those edits.
2. Gate failure: `completion.json` `head_sha` stale vs PR head.
3. `files_changed` omits the two evidence-paths files and includes evidence files that belong in the tail commit.
4. `planSuccessor` regex uses `\d+` instead of binding to the specific issue.
5. `gitIo.readPublishedContract` throws unhandled on missing predecessor ref.

**#3369 / issue #3361** — deepseek REVISE at `aa103096` (durable `refs/db-review-verdicts/3361-3369-aa103096…`). One medium gap + minors:
- **Medium**: the workflow token's ability to read GraphQL `branchProtectionRule` and REST `/rules/branches` is asserted in comments, never proven. Failure mode is "every merge refuses" on the only merge path. Need a run link from the guarded lane or a preflight-time permission probe.
- Minors: revision digest is serialized-payload comparison (jitter refuses); shape-only revision check; hardcoded app id `15368`; dead `protectionUnreadable` branch; quota multiplier unmeasured; stale comments in `check-merge-queue-workflows.test.mjs` / `merge-self-context.mjs`; disposition catalogue site numbers stale.
- Note: PR #3369 also has a red "Agent work contract" check (separate from the review).

### Claims (leave alone — live author leases)

3502 (→#3510), 3486 (→#3490), 3483 (→#3487), 3482 (→#3489), 3378 (→#3391), 3307 (→#3309), 3294 (→#3304), 2834 (→#2835), 2745 (→#3385). Also new: 3546 (→#3539).

### Programs / markers / parked

1403 (Switch 2 gated), 2326 (handover), 2530 (merge queue), 3084 (alarm), 3306 (workflow-refactor parent), 3401 (handover), 3505 (**other session**), 3508 (parked), 3535 (orchestrator marker — **closed**), 3536/3538 (CI audit).

### External

2290 (Albert), 2600 (curated MD), 2986 (sandbox), 3218 (DesignFlow prod), 3351 (ColdLion tech).

## 4. Everything we tried that did NOT work

1. **REVISE loops are real.** #3369 took 4 review rounds (M1-M3 → M2/M3/P1-P3 → 2 tiny gaps → medium token-permission gap). #3445 took 3 rounds. #3373 took 3 rounds (M1-M5 → 2 residuals → evidence-pair rebind after main moved). Budget for multiple fix/review cycles on CI-authority PRs.
2. **`gh pr update-branch` voids the exact-head APPROVE** and leaves the evidence pair pinned to the old merge base. Always rebind `base_sha`/`head_sha` in `completion.json` after a main refresh, then re-review at the new head.
3. **"no held reviewer lease matches this review"** usually means a durable verdict already exists at that head/slot, not that assignment failed. Check `git ls-remote origin 'refs/db-review-verdict*<issue>-<pr>-<head>*'` first. `isReviewAssignmentLive` returns false when a verdict exists, so `--assign-reviewer` won't recreate a lease.
4. **Evidence-pair topology is strict**: implementation commit (no evidence files) then exactly `contract.json` + `completion.json` alone on top. Interleaving breaks `verifyGitEvidence` permanently at that head.
5. **`--assign-reviewer` can block 5+ minutes** on `Atomics.wait` when the author-acquisition mutex is occupied (`MUTEX_RETRY_WAIT_MS = 300000`). Background it with output redirection on Windows.
6. **Orphaned `refs/db-coordination/author-acquisition`** blocks assign-reviewer. Local `--recover-author-mutex` is refused outside Actions — use `recover-author-mutex.yml` with `RECOVER <sha>`.
7. **Wrapper args after `--`** are only `new <session> --prompt-file <file>` (or `send "<msg>" --review --file <file>` for ai-deepseek-agent). Do NOT repeat the wrapper name.
8. **Set ALL caller env vars** in the same process as `run-governed-review.mjs`: `AI_MUSE_CALLER`, `AI_QWEN_CALLER`, `AI_DEEPSEEK_CALLER`, `AI_GEMINI_CALLER`, `AI_GROK_CALLER` = `mimo`.
9. **`--replacement-sequence` is required** after a `--replace-failed-reviewer` draw — use the `replacementSequence` value from the assign JSON.
10. **`VERDICT: REVISE <sha>` is accepted** by the runner's parser (the SHA suffix is in the regex). The "bare token only" instruction in briefs is not enforced.

## 5. Root causes and key findings

- **CI-authority PRs (required-checks, merge gates) attract deep review.** Reviewers correctly worry that a broken gate freezes every merge. Address the load-bearing assumption (token permissions) with live evidence, not comments.
- **The evidence-pair contract (#2845) is the main merge blocker** after any main refresh. `scripts/refresh-code-pr-branch.mjs` rebuilds topology but cannot restamp custom check results — do it by hand.
- **Muse/grok/deepseek/gemini all append the head SHA to the verdict line** despite briefs forbidding it. The runner accepts it. Don't fight it.
- **Documents-only merge authorization posts in ~30s.** Docs-only PRs merge with `gh pr merge --squash --admin` after that check turns green.

## 6. Exact next steps

1. **Check general-27's outcome on #3248** (`gh pr view 3248 --json state,headRefOid,mergeStateStatus`). If landed, close #3262. If REVISEd, read findings before touching code.
2. **Authorize the #3352 AGENTS.md conflict** (§0 item 1), then re-review the refreshed head and re-dispatch merge; close #3002.
3. **Fix #3445** five findings (§3), push, re-review, merge, close #3380.
4. **Fix #3369** medium gap — add a live token-permission proof (workflow step or preflight probe) — then re-review, merge, close #3361.
5. **Verify**: `gh issue list --label non-orchestrator --state open` shrinks to claims/programs/external only.

## 7. Constraints and gotchas in force

- **Worktree-only.** Never edit `C:\repos\shared-db` shared checkout.
- **Non-orchestrator only.** No migrations, no schema, no RLS, no production applies. Structural work goes to the orchestrator.
- **One independent review** for scripts/docs/CI. Never invent verdicts. Silence is never approval.
- **REVISE/REJECT stops the merge** — fix findings, push a new head, re-review.
- **Do not touch** #3505 (other session), any `db-claim` issue's claim state, or structural PRs (#3510, #3490, #3489, #3487, #3391, #3385, #3309, #3304, #2835) unless you are their author.
- **Sign every GitHub body**: `Posted by MiMo chat unknown on edge-dev`
- **Never weaken a guard or delete a check to go green.**

## 8. Access and environment

- `gh` authenticated as `u2giants`. Git remote `https://github.com/popcre/shared-db.git`.
- Machine `edge-dev`, Windows. Git bash at `C:\Program Files\Git\bin\bash.exe`.
- Task gates: `ai-task-gates start --class code|prose` from `C:\repos\ai-devops\bin\ai-task-gates`. Valid classes: `prose, code, installation, reviewer-safety, ui-live-workflow, shared-db, deployment, infrastructure, production, private-evidence, private-tooling`.
- Reviewer wrappers in `C:\repos\ai-devops\bin\` (`ai-muse`, `ai-qwen`, `ai-deepseek-agent`, `ai-gemini`, `ai-grok-review`).
- Merge dispatch: `gh workflow run guarded-migration-merge.yml -f pull_request=<n> -f head_sha=<exact head>`
- Secrets: 1Password vault `vibe_coding` (none appeared in this session; no new entries created).

## 9. Open questions and risks

- **2026-09-25:** Parallel sessions race on issue close and review draws. Always re-check issue/PR state before acting.
- **2026-09-25:** `scripts/manage-migration-author-lanes.mjs` is a hot collision file — serialize PRs that touch it.
- **2026-09-25:** Sub-agents from this session may still be running (`general-27` and earlier). Check `actor status` / recent PR activity before assuming a lane is free.
- **Risk:** #3369 and #3445 are both multi-round REVISE loops on CI-authority code. A reviewer's "load-bearing assumption unproven" finding is usually correct — prove it with a live run, not a comment.

---

Posted by MiMo chat unknown on edge-dev
