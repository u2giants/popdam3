---
issue: 3853
status: OPEN
owner: mimo/coldlion-intake-successor (this session; Albert holds the workstream card #3853)
---

# ColdLion order intake — cron live; D1 two-green-run proof remains

## 0. Settled (never re-ask)

- Owner ruling 2026-10-05 (Albert): the production DB password is NOT rotated. Transcript redacted; vault + GitHub secrets keep the unchanged password. Do not re-open rotation.
- Owner ruling 2026-09-28: never ask a human to approve. AI reviewers gate technical actions.
- Owner ruling (live-proof): leave deferred proof as a checklist on the SAME issue (#3853). Never open a leftover-proof ticket.
- F1 sample-week proof PASSED (PR #4017, `docs/verification/coldlion-order-intake-20260914/README.md`).
- PR #4019 MERGED (merge `08db1624`, 2026-10-07 9:54 PM EST): hourly cron enabled after F1. Trigger surface is `schedule` + `workflow_dispatch` only. Both leftover #3853 handoffs (2140Z, 2035Z) retired in that PR.
- PR #4093 MERGED (2026-10-08): typed SQL NULLs (`null::numeric` / `null::boolean` / `null::date` / `null::timestamptz`) so a VALUES column that is entirely null cannot be inferred as text. Fixes the first scheduled run's failure. Cron moved from `0 * * * *` to `7 * * * *` (off the crowded top of the hour). Workflow test pins the cron string.
- Generation evidence pairs on the PR history were gens 44–50; published refs stay immutable.

## 1. Immediate next actions (in order)

1. **Watch for two consecutive green `event=schedule` runs** of workflow `coldlion-order-intake.yml` (cron `7 * * * *`).
   - List: `gh api "repos/popcre/shared-db/actions/workflows/coldlion-order-intake.yml/runs?per_page=10"`
   - Gate is plan D1 / definition of done: two consecutive scheduled runs green AFTER the cron was enabled and after the type fix. Manual `workflow_dispatch` runs do NOT count.
   - Known history: run `37748611709` (2026-10-08 08:15Z) FAILED on the line_price type bug (now fixed). Run `37783505826` (13:19Z) was a successful dispatch on the fixed code. No green **scheduled** run yet as of 2026-10-08 1:39 PM EST.
2. **When two green scheduled runs land:**
   a. Tick plan `plan_coldlion_order_intake.md` STATUS row D (currently `⬜ open`) with the two run IDs and timestamps. Row is near line 46.
   b. Docs-only PR titled `docs(#3853): tick plan STATUS D after two green scheduled runs`. Merge promptly (AGENTS.md §5 docs-only rule). Use the fast-close route in `shared-db-handover` (prose-only PR, `gh pr checks --required --watch`, then squash merge). Never `--admin`, never `guarded-migration-merge` for prose.
   c. Close #3853 with a comment listing the two run IDs as live proof, the merge PR, and signature `Posted by MiMo chat <id> on <machine>`.
3. **If no scheduled run appears within a few hours:** the schedule was at `7 * * * *` on main as of 2026-10-08. Check `gh api .../actions/workflows/372508500` state=active and that the file on main still has `schedule:`. Other schedules on the repo do fire (author-lane uses `17 * * * *`). First-fire lag after enabling a schedule can be several hours. If the schedule is present and active and still silent after ~12h, comment the diagnosis on #3853 and stop — do not close the issue without the two green runs.

## 2. What was tried that did NOT work (MANDATORY)

- **Waiting on minute `0 * * * *` for the first schedule fire:** no `event=schedule` run appeared for ~6 hours after PR #4019 merged. Cause was GitHub first-registration lag plus top-of-hour crowding. The one run that did fire (08:15Z, 15 min late) failed on the type bug. Cron is now `7 * * * *`.
- **DeepSeek diff-review REVISE loop (gens 44–47):** DeepSeek repeatedly REVISE'd on pre-merge-unmeasurable residuals (hourly scan duration, LIKE-prefix EXPLAIN). Those are owned by the D1 follow-up by definition — they cannot be measured before the cron runs. Do not keep rebuilding heads to chase DeepSeek on this. Muse + Grok both APPROVED at `8ad1dbb5` and unlocked Guarded Merge for PR #4019.
- **`ai-review` / `run-governed-review` provider failures this session:** Gemini "no response text"; Qwen "binary not found"; StepFun killed by the tool layer (ChildProcess.kill); Codex sandbox orphans jammed ordinary reviews. Working path that produced durable verdicts: `node scripts/run-governed-review.mjs` with `AI_MUSE_CALLER=codex` / `AI_GROK_CALLER=codex` / `AI_DEEPSEEK_CALLER=codex`, `--reviewer-allowlist "muse-spark-1.3-contributor,grok-4.6"` on `--assign-reviewer` to force those two.
- **`--assign-reviewer` without `SHARED_DB_AUTHOR_ENGINE`:** refused. Declare `SHARED_DB_AUTHOR_ENGINE=zcode` (known engines: claude, codex, glm, zcode) and `SHARED_DB_SESSION_ID`.
- **PR body "Part of #3853" instead of "Closes #3853":** reviewer assignment refused ("pull request must close exactly one work issue"). The close-with-checklist pattern is required so assignment can draw.
- **Evidence `head_sha` confusion:** `completion.head_sha` is the IMPLEMENTATION commit; the PR's GitHub head is the evidence commit that follows it. `scripts/agent-work-contract-git-evidence.mjs` enforces this. DeepSeek treated it as a mismatch; it is the convention.
- **sqlText → `null::text`:** broke `coldlion-landing-history.test.mjs` ("sqlText still emits a bare NULL"). Reverted. Text keeps bare `null`; numeric/bool/date/ts carry typed nulls.
- **GitHub API rate limits** stalled `--assign-reviewer` repeatedly. Wait for reset (`gh api rate_limit`); do not hammer.

## 3. What we own / worktree state

| Worktree | Branch | State |
|---|---|---|
| `.ai/worktrees/coldlion-cron-3853` | `coldlion-intake-null-cast-3853` (was `coldlion-cron-3853`) | PR #4093 MERGED — safe to clean after confirming no uncommitted files |
| `.ai/worktrees/coldlion-lineprice-3853` | (type-fix scratch) | created during the line_price fix — reap if clean |
| `.ai/worktrees/coldlion-review-4019` | (review scratch) | reap if clean |
| `coldlion-intake-e`, `coldlion-intake-rot`, `coldlion-guard-fix`, `coldlion-f1-cron-3853`, `coldlion-f1b-3853` | historical | safe to clean once their PRs are confirmed merged (use `scripts/reap-merged-worktrees.mjs --apply`; do not treat age as proof) |

Do NOT touch other sessions' worktrees.

## 4. Main SHA and migration version

- main tip: `64f1edb5c737c91e7dc75f9195f235b39358b0ef` (checked 2026-10-08 12:38 PM EST / 16:38Z)
- Max migration on main: `20261008160444` (`dflow_users_email_ci_unique_reissue.sql`)
- These go stale within the hour — re-derive before acting.

## 5. Preview state

Not touched by this session. Production was queried read-only. The intake workflow writes to production (by design, after F1). The 2026-10-08 13:19Z dispatch (run 37783505826) was a successful claim-only run on main against production.

## 6. Secrets sweep

Swept: no new credential appeared in chat, commits, or untracked files this session. Database password and COLDLION_API_KEY were referenced only as GitHub secret names / 1Password item IDs. Scratch files (`run-37748611709.log` in the worktree) contain run logs only — delete or ignore, do not commit. **Swept, nothing new.**

## 7. Docs pass

Nothing outside the handover is stale. `plan_coldlion_order_intake.md` STATUS row D is intentionally still `⬜ open` (the tick is the next action). The workflow header already documents alerting and the kill switch. `AGENTS.md` does not mis-state the intake path.

## 8. Next-session prompt

```
You are the ColdLion intake successor for popcre/shared-db, issue #3853 (non-orchestrator, repo-maintenance).
Read HANDOFF.d/2026-10-08T1741Z-edge-dev-mimo-coldlion-3853-d1-live-proof.md FIRST.

Goal: finish the D1 live-proof gate and close #3853.

Already done (do not redo):
- PR #4019 merged: hourly cron on (now cron '7 * * * *'), trigger surface schedule+dispatch only, handoffs retired.
- PR #4093 merged: typed SQL NULLs fix for the line_price text-vs-numeric failure.
- F1 PASSED (PR #4017). Manual dispatch on main is green (run 37783505826).

Exact next action:
1. gh api "repos/popcre/shared-db/actions/workflows/coldlion-order-intake.yml/runs?per_page=10"
   Wait for TWO consecutive event=schedule runs with conclusion=success. Manual workflow_dispatch does not count.
2. When those land: tick plan_coldlion_order_intake.md STATUS row D with the two run IDs; open a docs-only PR; merge promptly (prose-only fast-close; never --admin, never guarded-migration-merge for prose); close #3853 with the run IDs as evidence.
3. If schedule runs stay silent ~12h despite on: schedule on main and workflow state=active, comment the diagnosis on #3853 and stop. Do not close without the two green runs.

Do not: rotate the password, touch the database, re-open DeepSeek review loops, start new issues.
Signature: Posted by MiMo chat ses_ffe5eec58ec33ffein1XsJ0A3W on edge-dev
```

## 9. Sub-agents this session (separated)

### Agent: general-1 (Finish ColdLion 3853 close-out)
- **Asked to do:** watch scheduled runs, tick STATUS D, close #3853; also land the line_price type fix and cron offset.
- **Actually did:** diagnosed the first scheduled-run failure (line_price text vs numeric on an all-null VALUES column); fixed `tools/coldlion-landing/lib/values.mjs` to emit typed SQL NULLs; added `tools/coldlion-order-intake-values.test.mjs`; changed cron to `7 * * * *` and pinned it in the workflow test; landed all of that as PR #4093 (MERGED, head 92f55f1e, gen-50 evidence pair); posted live-proof comments on #3853; ran a successful dispatch on main (37783505826).
- **Found:** the type bug was the only job-level defect; the schedule-not-firing for ~6h was GitHub lag + minute-0 crowding, not a broken trigger.
- **PR / branch:** PR #4093 MERGED. Branch `coldlion-intake-null-cast-3853`.
- **Worktree:** `coldlion-cron-3853` (reused; still present) — finished (safe to clean after confirming clean tree).
- **Deliberately did NOT do:** did not close #3853 — the two green scheduled runs had not landed. Did not tick STATUS D.
- **Status at wrap-up:** actor settled as failed after a process restart (155 turns); its landed work is on main. Do not re-run its implementation.

### Agent: explore-1 (Diagnose missing schedule runs)
- **Asked to do:** diagnose why the new cron produced no `event=schedule` runs.
- **Actually did:** confirmed YAML valid and schedule active on main; compared to a firing workflow (author-lane `17 * * * *`); identified GitHub first-registration lag + top-of-hour crowding; found the one schedule run (37748611709) and its type-bug failure; recommended offsetting the cron minute.
- **PR / branch:** none (read-only).
- **Worktree:** n/a.
- **Deliberately did NOT do:** made no changes (report-only by design).
