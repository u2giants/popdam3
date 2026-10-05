---
issue: 2176
status: OPEN
owner: mimo/claim-first-queue-2026-10-04
---

# Shared-db claim-first queue handoff

All times America/New_York (EST). Facts checked 7:42 PM EST, 2026-10-04.

## 0. DECISIONS ONLY THE OWNER CAN MAKE

None blocking technical work. Standing holds:

- Never ask Albert to approve technical risk; the assigned AI reviewer's exact-head APPROVE is the gate (owner ruling 2026-09-28).
- Albert is not a technical reviewer (owner ruling 2026-09-30).
- DeepSeek account out of credit — top up at https://platform.deepseek.com/top_up then `ai-review-preflight clear deepseek`. Not an Albert decision unless he wants another reviewer family instead.
- #1941 Laura/Ilona licensed-property sign-off — on hold until 2026-10-05. Do not re-ask before that date.

Already settled — do NOT re-ask:

- **There is no orchestrator** (§0.0-D, Albert 2026-10-02: "there is no longer an orchestrator"). Structural work is claim-first: a session needing a SHAPE change claims the exact objects on the existing issue and starts. Do not open a marker, wait for dispatch, or label tickets orchestrator / non-orchestrator. Marker and dispatch automation is historical machine metadata only.
- One-time deliberate `origin/main` merge into a ready PR is the supported §2758 path (Muse process opinion 2026-10-01).
- Qwen is broken on edge-dev until ai-devops#1035; replace with `provider_unavailable` each time it is drawn.

## 1. What this application is

`popcre/shared-db` is the shared Supabase schema repo for POP Creations apps. Structure (DDL) is governed here via branch+PR+Guarded Merge. Production project ref `qsllyeztdwjgirsysgai`; preview `mvpkijzfmfcxhnzqogzs`.

## 2. What we set out to do this session

Work Albert's ordered queue: (1) #3825 risk-gate whitelist fix review+merge, (2) #2176/#3839 ColdLion unit 6 2-slot APPROVE+merge, (3) protected-file queue #3657 → #3808 → #3396 → #3787 → #3647 → DesignFlow.

## 3. Current state — what is true right now

**Main tip `9ef6da0f5fb82af645d81b72ada9a432b7dcab51` at 7:42 PM EST 2026-10-04.** Max migration on main: **`20261002224520`**.

### Done this session (6 PRs merged)

| PR | What | Merged |
|---|---|---|
| #3825 | Risk-gate: ALTER FUNCTION volatility + DO assertion blocks | 2026-10-01T21:08:16Z |
| #3657 | StepFun Step 5 in reviewer rotation (7 reviewers) | 2026-10-02T00:14:25Z |
| #3808 | Verdict auto-archive workflow (threshold 800) | 2026-10-02T12:23:02Z |
| #3396 | Dependency-hygiene CLI (read-only) | 2026-10-02T13:04:07Z |
| #3787 | Portable ZIP proof reader (zip-entries.mjs) | 2026-10-02T15:40:58Z |
| #3920 | Exclude returns lease-less outstanding assignments (#3866) | 2026-10-02T20:36:17Z |

Also closed: #3647 (superseded by #3787), #3860 (stale handoff PR), #3862 (fixed by #3787).

### Half-done / not done

| Item | Exact state |
|---|---|
| **#3839 ColdLion unit 6** | PR OPEN at `103642e7da4f383b259602f018411c941aea5fe6`. Slot 2 **Gemini APPROVE** durable (`refs/db-review-verdict-replacements/2176-3839-4b36ee6d…-slot2-4643`). Slot 1 blocked: lease listing unreadable (`active reviewer leases are unreadable; review start refused`). Last draw was Muse seq 5023 at head `103642e7d` but preflight failed on Muse Code version pin (1.4.2 vs expected). |
| **Protected-file queue** | #3657/#3808/#3396/#3787 merged. #3647 closed superseded. **DesignFlow not started.** |
| **Claim transfers** | #2110 (#3378), #3175 (#3307), #2662 (#3294) — not started. |

### Preview / production

- No migrations applied to preview or production this session. All six merged PRs were tooling/docs/rotation (no DDL).

## 4. Everything we tried that did NOT work

1. **`parseReviewRelease` on replacement-format failure refs** — threw "reviewer release evidence is unreadable". Already fixed on main via `parseTerminalFailureEvidence` (#3730). Remaining gap was exclude not returning lease-less assignments; fixed in #3920.
2. **`--exclude-reviewer` with assignment SHA as evidence** — needs the assignment *commit* SHA, not the head SHA.
3. **`--assign-reviewer` without `db-work-scope` in the issue body** — refused "not deterministic ready repository-maintenance work". Scope block must be in the issue **body** (a comment is not enough); PowerShell eats backticks, so write the body via a file.
4. **Evidence pair after a merge** — `base_sha` goes stale. Rebind both pair files in a pair-only tail commit after the merge implementation head (`agent-work-contract-git-evidence` enforces exactly the two evidence files after `report.head_sha`).
5. **Taking `--ours` on `manage-migration-author-lanes.mjs` during a merge** — keeps the PR's old roster (6 reviewers) and breaks tests expecting GLM+StepFun (7). Take main's file and re-apply only the PR's zip-reader hunks.
6. **`run-governed-review` without `--replacement-sequence`** — recording fails with "reviewer qwen-3.8-max holds no active lease" because it resolves the *original* assignment. Always pass `--replacement-sequence <failed-seq>` when the reviewer is a replacement.
7. **Muse `new` at the same head after a REVISE** — REVISE is a durable verdict that forbids replacement at that head. Push a rebind commit to get a new head.
8. **`ai-muse` via PowerShell `bash -lc`** — ChildProcess.kill on long runs. Use `Start-Process` background + poll output files.
9. **Guarded Merge "Protected-main checkout is stale"** — transient; re-dispatch the workflow.
10. **Lease listing "active reviewer leases are unreadable"** — reap with `--reap-abandoned-review-leases --apply-recovery` (reaped 55+), then retry. Can recur.

## 5. Root causes and key findings

- Review evidence binds to exact head; any fix voids APPROVEs. Batch findings into one head.
- Evidence pair shape: implementation commit(s) then a pair-only tail commit with exactly `contract.json` + `completion.json`. `report.head_sha` points at the implementation.
- `ACTIVE_REVIEWERS` is 7 after GLM restore + StepFun: grok-4.6, glm-5.3, qwen-3.8-max, muse-spark-1.3-contributor, gemini-3.8-flash-high, deepseek-v4.1-flash, stepfun-step-5-preview.
- Qwen keeps drawing despite being broken; replace with `provider_unavailable` every time.
- Grok `turn_limit_cancelled` on large reviews; exclude `terminal-unavailable`.
- Throughput disposition: after merging main into a PR that touches `manage-migration-author-lanes.mjs`, regenerate the disposition catalogue and retire stale historical identities (preserve `line_sha256`/`disposition`/`reason`).
- Historical identities must appear in some catalogue OR a retirement file (`throughput-retired-identity-sites*.json`); the context test hardcodes the file list.

## 6. Exact next steps

1. **#3839 slot 1** (claim-first: claim the exact objects on issue #2176 / claim #3838, then draw the reviewer): reap leases (`node scripts/manage-migration-author-lanes.mjs --reap-abandoned-review-leases --apply-recovery`), then `--assign-reviewer --issue 2176 --pr 3839 --head-sha 103642e7da4f383b259602f018411c941aea5fe6 --review-slot 1 --admit-issue 2176`. If Muse doctor fails on the version pin, use `--skip-doctor true` on `run-governed-review` or replace the reviewer. Verify: 2-slot APPROVE + `gh pr view 3839` MERGED.
2. **Protected-file queue remainder**: DesignFlow items (if any) one PR at a time on `manage-migration-author-lanes.mjs`.
3. **Claim transfers** #2110/#3175/#2662 via the #3620 tool.

**Verification gates:** each step ends with `gh pr view <n>` MERGED or `gh issue view <n>` CLOSED.

## 7. Constraints and gotchas in force

- **Claim-first, no orchestrator** (§0.0-D). A session needing a SHAPE change claims the exact objects on the existing issue and starts: own worktree and branch, migration version via the lane tool, pull request, the assigned AI reviewer's APPROVE of the exact apply, and proof of the target before every write. Never open a marker, never wait for dispatch, never label tickets orchestrator / non-orchestrator.
- Branch + PR + Guarded Merge; AI merges; never push to protected `main`.
- Preview / production / merge are one-at-a-time lanes.
- Never ask Albert to approve technical risk.
- Qwen fails on edge-dev until ai-devops#1035; do not draw it.
- DeepSeek out of credit until topped up.
- One-time deliberate main-merge into ready PRs is allowed; unattended auto-update is not.
- Times in EST (America/New_York).
- Sign GitHub comments `Posted by MiMo chat ses_ffe5f07deb797fferq5MiQQA2y on edge-dev`.
- Keep GitHub API calls bounded; reap leases when listing fails.

## 8. Access and environment

- Machine: **edge-dev** (Windows).
- `gh` authenticated as u2giants. Repo `popcre/shared-db`.
- 1Password vault `vibe_coding`. Supabase CLI PAT item id `3t2xoqk5luyz7ffgdhj24gvtpq`. Use `op run --env-file` with `op://` refs only.
- Reviewer wrappers under `C:\repos\ai-devops-reviewer-install\bin\`.
- Git Bash: `"C:\Program Files\Git\bin\bash.exe"`.
- Shared checkout `C:\repos\shared-db` is dirty and behind — work in isolated worktrees only.
- Session worktrees (safe to clean after #3839 lands, except risk-gate which is merged): `pr3657-stepfun`, `pr3808-archive`, `pr3396-hygiene`, `pr3787-zip`, `pr3647-proofzip`, `fix-3866`, `risk-gate-3821-mimo`.

## 9. Open questions and risks

- **#3839 slot 1 lease listing** keeps failing ("active reviewer leases are unreadable"). Reap helps temporarily. May need `ai-review-preflight` or a transport fix if it recurs.
- **Muse Code version pin** drifted (doctor expects 1.3.0, installed 1.4.2). Causes preflight failures. `--skip-doctor true` is a workaround, not a fix.
- **DeepSeek OOC** reduces the review pool.
- **Protected-file serialization**: only one open PR may touch `manage-migration-author-lanes.mjs`.
- Max migration / main SHA go stale within the hour — re-verify at start.

---

# Part (b) — sub-agent / session work blocks

### Agent: general-19 / fix-risk-gate-alter-function-do-3821
- **Asked to do:** Fix Muse REVISE H1/M1 (shadowable bare-name whitelist) on #3825.
- **Actually did:** Commit `6b0feca67`; head `8490a6e1e` after evidence rebind. Muse APPROVE recorded. Guarded Merge run `36926322143` succeeded (first attempt failed on stale trusted-policy checkout).
- **PR / branch:** PR **#3825** MERGED.
- **Worktree:** `risk-gate-3821-mimo` — finished (safe to clean).
- **Deliberately did NOT do:** fix the three Muse Lows (function_bodies non-dollar skip; _IMMUTABLE_SAFE_CALLS pg_proc confirm; known migration_statements regex) — non-blocking.

### Agent: mimo/claim-first-queue (this session, direct work)
- **Asked to do:** Work Albert's ordered queue; push hard to clear it.
- **Actually did:** Merged 6 PRs (#3825, #3657, #3808, #3396, #3787, #3920). Closed #3647 superseded, #3860 stale. Fixed #3866 exclude-returns-empty. Regenerated throughput dispositions on three PRs after main merges. Reaped 55+ abandoned review leases.
- **PR / branch:** PR **#3920** MERGED (`fix/3866-reviewer-release-evidence`).
- **Worktree:** `fix-3866` — live (has the exclude fix; can clean after #3839).
- **Deliberately did NOT do:** DesignFlow queue (after #3839); claim transfers #2110/#3175/#2662; Muse Lows on #3825.
