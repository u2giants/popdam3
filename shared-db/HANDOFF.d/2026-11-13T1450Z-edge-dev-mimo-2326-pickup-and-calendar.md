---
issue: 2326
status: OPEN
owner: mimo/wrapup-2326-pickup-2026-11-13
---

# Wrap-up handoff — #2326 pickup, #5747 calendar, session closeout

Written 2026-11-13 9:50 AM EST by MiMo chat ses_ffe5e43506d64ffeEzis1lhwfS on edge-dev (wrap-up of the handoff-review closeout session). Contract issue is #2326 — the remaining open workstream. When #2326 is finished (or its remaining steps are re-owned elsewhere), retire this file per the successor rule.

## 0. Business decisions only the owner can make

None. The only owner decision in this arc — whether the licensor/property review is resolved — was made by Albert on 2026-11-13 ("#1941 has been resolved. close it"), and #1941 is closed on his instruction. The #2326 taxonomy gate that waited on #1941 is therefore CLEARED.

Already settled — do NOT re-ask: review is advisory and never a merge gate (2026-10-29); never ask a human to approve (2026-09-28); never duplicate or re-apply an applied migration version; never close an outcome-lifecycle issue by hand.

## 1. What this application is

`popcre/shared-db` is the shared Supabase database-shape source of truth for POP Creations' apps (CRM, DAM, PM/PIM, DesignFlow). No app runtime lives here; shipping means branch + PR + merge through the merge queue, then the migration lane for any schema change. Production project ref `qsllyeztdwjgirsysgai`; sanctioned production reads are the Supabase Management API `database/query` endpoint with `read_only: true` (token via `op read 'op://vibe_coding/Supabase CLI Personal Access Token/SUPABASE_ACCESS_TOKEN'` — pattern in https://github.com/popcre/shared-db/blob/main/scripts/catalog-truth.mjs). `psql` is NOT installed on this Windows machine.

## 2. What we set out to do this session, and why

Pick up the handoff-review closeout (https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-08T1914Z-edge-dev-mimo-handoff-review-closeout.md, since retired): #2421 closeout and #5608 delivery verification, then the calendar items. Over the following days this session ran those to completion; on 2026-11-13 Albert closed out the session with `/wrap-up` and asked for a next-session prompt to pick up #2326.

## 3. Current state — what is true right now

**Verified at write time:** `origin/main` = `6e0d526f7` (checked 2026-11-13 9:47 AM EST); max migration `20261113043850_popsg_prewarm_every_10_minutes.sql`; preview state NOT inspected this session — I applied nothing to preview or production.

**Done in this arc (all landed on `main`):**
- PRs https://github.com/popcre/shared-db/pull/5973 (merge `d684295e`), https://github.com/popcre/shared-db/pull/5981 (merge `b6c8876c`), https://github.com/popcre/shared-db/pull/6135 — handoff-note retirements and the corrected resume prompts in https://github.com/popcre/shared-db/blob/main/docs/handoff-review-2026-11-08.md.
- **#5608 CLOSED** 2026-11-11 11:10 PM EST: migration `20261106171924` auto-delivered to production 2026-11-07 4:09 PM EST (run 42414494992, never re-apply); four tagged nightly runs (26.1/20.3/27.5/23.0 s); probe `.github/live-proofs/5608.sql` passed; evidence PR https://github.com/popcre/shared-db/pull/6112.
- **#2421 CLOSED** 2026-11-13 9:21 AM EST with authoritative outcome `live_verified` (completion record + ledger walked to production-applied by delegated session [2421 PopDAM proof completion](mimo-session://desktop/ses_ffe5e2af965c9ffeQ4D0BtZMlL); live-proof artifact from PopDAM, generated-types artifact from the database-types run). Never re-apply `20261012012727`.
- **#1941 CLOSED** 2026-11-13 on the owner's instruction (resolved). This clears the #2326 taxonomy gate.
- **#5747**: Step 7 7-day reading done 2026-11-12 9:51 PM EST (heap 390 MB / live 212 MB = **1.84**, limit 2.0, climbing ~24 MB/day; indexes 335→825 MB; PopDAM search 119/119, p95 2.2 s). Two MiMo scheduled tasks are armed so nothing is lost: `auto-2` "5747 weekly assets health check" fires **Mon 2026-11-16 6:00 AM EST**; `auto-3` "5747 index re-check and close-out" fires **Wed 2026-11-18 9:07 AM EST**. They run as new sessions with the shared-db project.
- **#5758 CLOSED** 2026-11-12 8:05 PM EST (anti-bloat close-out pass).

**Open work this handoff hands over:**
- **#2326** (database efficiency + API security program) — unblocked and unowned. Read https://github.com/popcre/shared-db/blob/main/plan_database_efficiency_and_api_security.md STATUS first. State at 2026-11-13: Steps 0–2 done; **Step 3 partial** (5 of 7 gate requirements; open: `clear_style_group_batch` changed-row count, write-side query plans, `cleared_count` volume, WAL/duration, per-step matview timings); Step 4 app issues opened in popdam3 (#293/#294/#295, evidence still required); Steps 5–8 open. Three older handoff notes remain for it in `HANDOFF.d/` (`2026-09-10T0450Z-edge-dev-claude-five-oldest-issues.md`, `2026-10-11T1705Z-edge-dev-mimo-nine-issues-clearance.md`, `2026-10-11T1749Z-edge-dev-mimo-batch-remaining-clearance.md`) — read newest-first; they describe completed batch clearances.
- **#5747** residual: only the two scheduled checkpoints above (Step 3 index re-check + close-out is `auto-3`).

## 4. Everything we tried that did NOT work

- **`ai-shared-db-closeout-check`** stalls on GitHub API admission waits (~4 minutes per ai-gh call; the tool's own deadline is 3600 s). It was still mid-run at wrap-up time (call 1 succeeded in 248 s, call 2 waiting). This session holds ZERO claims/locks (docs-only work), so the receipt is expected clean — but if the report below says the receipt was not obtained, treat that as the honest state and re-run the check before trusting any claim.
- **`gh pr merge --squash --admin`** is REFUSED by repo rules even for prose-only PRs ("Changes must be made through the merge queue"). The ai-pr-wait doc-only advice ("merges immediately with --squash --admin") is stale against this repo's rules: always `gh pr merge --auto` and wait for the queue.
- **`ai-pr-wait` refuses to run for prose-class changes** (ai-task-gates: "pr-wait is not a gate for a prose change"). Watch checks with `gh pr checks <n> --watch`, then enqueue with `gh pr merge --auto`, then watch the merge-queue run with `gh run watch <run-id>`.
- **`ai-pr-wait` is not on PATH**; use `& "C:\repos\ai-devops\bin\ai-pr-wait.cmd" <pr> --repo popcre/shared-db --fit-tool-call` and always pass `--repo`.
- **PowerShell `Start-Process` backgrounding of toolkit .cmd files** fails with `Unknown: ChildProcess.kill` from the shell wrapper. Invoke toolkits inline.
- **`ai-task-gates check --before merge`** is not a valid action; the shipping gate is `--before ship`. `ai-task-gates` prints long historical warnings — ignore them; read only the last line.
- `TZ=America/New_York date` is bash syntax and fails in pwsh; use `[System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Eastern Standard Time')`.

## 5. Root causes and key findings

- **Outcome-lifecycle issues must never be closed by hand.** `verifyOutcomeAcceptance` refuses completion when an issue is closed before `live_verified` ("closed before live verification") — a manual close destroys the supported `--complete-outcome` path. #2421 was completed correctly by walking `--advance-outcome` states with dated evidence and letting `--complete-outcome` close it.
- **pg_cron runs on UTC.** The `30 4 * * *` nightly job fires 04:30 UTC = 11:30 PM EST the previous calendar day; probe "nights" are UTC dates of `start_time`.
- **Production ledger reads are easy and safe**: POST `https://api.supabase.com/v1/projects/<ref>/database/query` with `{query, read_only: true}` and a bearer token from `op read` (the `scripts/catalog-truth.mjs` pattern). No psql needed.
- **Merge queue is mandatory in this repo for every PR class**, including docs-only; required checks must pass first, then `gh pr merge --auto` enqueues.

## 6. Exact next steps

1. **New session: pick up #2326** (the fenced prompt in the closing report is the entry point). In short: own worktree from `origin/main`, read https://github.com/popcre/shared-db/blob/main/plan_database_efficiency_and_api_security.md STATUS and the three #2326 notes newest-first, resume from the first unfinished step (Step 3's unmet gate items are the nearest). The taxonomy-activation gate is CLEARED (#1941 closed 2026-11-13 on the owner's word). You'll know it worked when the plan STATUS advances with dated evidence per step.
2. **#5747 checkpoints run themselves**: `auto-2` Mon 2026-11-16 6:00 AM EST (weekly health check; if heap/live ≥ 2.0 propose the governed repack route — never repack by hand) and `auto-3` Wed 2026-11-18 9:07 AM EST (Step 3 index re-check, then close #5747 with live proof if §13 passes). No action needed before they fire; their prompts are self-contained.
3. **Nothing else is pending from this arc.** #5608, #2421, #5758, #1941 are closed.

## 7. Constraints and gotchas in force

- Never re-apply or duplicate migrations `20261106171924` and `20261012012727` (both in production). Never reuse spent versions `20261026174936`, `20261026193803`, `20261027022851` (list also in https://github.com/popcre/shared-db/blob/main/docs/handoff-review-2026-11-08.md).
- shared-db PRs: branch + PR + `gh pr merge --auto` (merge queue). Never `--squash`, never `--admin`. The AI merges; Albert never merges.
- Every GitHub post signed `Posted by MiMo chat <id> on <machine>`.
- `plan_rls_request_constant_checks.md` contains U+2019 — use Python for text replacement in that file.
- `docs/verification/orchestrator-retirement-reconciliation-4348.json` is immutable evidence — do not modify.
- Worktree-only (§2.1-W); retire worktrees after merge; `git branch --merged` cannot see squash merges — ask GitHub whether the PR merged.

## 8. Access and environment

Machine edge-dev (Windows). GitHub CLI authenticated for `popcre`. 1Password vault `vibe_coding` (Supabase PAT + DB password by `op://` reference only — values never printed). Production read path: Management API `database/query` `read_only: true`. Toolkits: `ai-task-gates` and `ai-shared-db-closeout-check` on PATH; `ai-pr-wait` only via `C:\repos\ai-devops\bin\ai-pr-wait.cmd` (path is machine-local; on other machines find `ai-pr-wait` in the installed ai-devops checkout). MiMo scheduled tasks `auto-2`/`auto-3` carry the #5747 prompts.

## 9. Open questions and risks

- The `ai-shared-db-closeout-check` receipt for this session (`ses_ffe5e43506d64ffeEzis1lhwfS`) was still mid-run at wrap-up (GitHub admission waits). This session held no claims; if the closing report says the receipt was not obtained, re-run `ai-shared-db-closeout-check --session-id ses_ffe5e43506d64ffeEzis1lhwfS` and keep the JSON receipt. Do not interpret missing data as zero.
- The #2421 and #5608 resume prompts in https://github.com/popcre/shared-db/blob/main/docs/handoff-review-2026-11-08.md are consumed (both issues closed); a dated supersession line is added in this handoff's PR. The #2326 and #5747 entries there remain useful.
- The old `HANDOFF.d` file `20261108T1305Z-edge-dev3-claude-close-nested-5758-anti-bloat.md` points at #5758 (closed 2026-11-12) — a SUCCESSOR REVIEW candidate for its owner `edge-dev3-claude`; do not delete another session's file.

---

*Posted by MiMo chat ses_ffe5e43506d64ffeEzis1lhwfS on edge-dev*
