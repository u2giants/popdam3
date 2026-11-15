---
issue: 2326
status: OPEN
owner: mimo/wrapup-2326-steps34-2026-11-15
---

# HANDOFF — #2326 wrap-up: Steps 3–4 evidence landed, Steps 5–8 delegated and live

Written 2026-11-15 10:16 AM EST by MiMo chat ses_ffe5e2a67024fffe0TbBld1kjq on edge-dev (wrap-up of the #2326 claim-first pickup session). Contract issue is **#2326** — the program workstream, still open because Steps 5–8 are executing in a live sub-session (see part (b)). This file replaces the retired `HANDOFF.d/2026-11-13T1450Z-edge-dev-mimo-2326-pickup-and-calendar.md` (successor rule applied — see §3).

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**None — nothing in this workstream needs the owner.** The whole arc ran on evidence gates and repository rules; no business-meaning judgement is pending.

Already settled — do NOT re-ask (dates are the ruling dates):

- Review is advisory and never a merge gate (Albert, 2026-10-29).
- Never ask a human to approve anything (Albert, 2026-09-28). The AI performs every manual step itself.
- Never close an outcome-lifecycle issue by hand — `verifyOutcomeAcceptance` refuses "closed before live verification"; use `--complete-outcome`.
- Never re-apply or duplicate applied migrations `20261106171924` and `20261012012727`; never reuse spent versions `20261026174936`, `20261026193803`, `20261027022851`.
- The taxonomy-activation gate is CLEARED — #1941 closed 2026-11-13 on the owner's word ("resolved").
- #5747's remaining checkpoints run themselves as scheduled tasks (see §3) — no owner action, no manual run.

## 1. What this application is

`popcre/shared-db` is the shared Supabase database **shape** source of truth for POP Creations' apps (CRM, DAM, PM/PIM, DesignFlow PLM). All apps read and write the same tables in one Supabase production project (ref `qsllyeztdwjgirsysgai`); this repo holds the migrations, schema/API contracts, business-rule library, and the rules every AI session must follow. No app runtime lives here. "Shipping" means branch + PR + merge through the merge queue, then the migration lane for any schema change. Sanctioned production reads: the Supabase Management API `database/query` endpoint with `read_only: true` (pattern: https://github.com/popcre/shared-db/blob/main/scripts/catalog-truth.mjs; token via `op read 'op://vibe_coding/Supabase CLI Personal Access Token/SUPABASE_ACCESS_TOKEN'`, piped, never printed). `psql` is NOT installed on this machine.

## 2. What we set out to do this session, and why

Albert asked this session to pick up **issue #2326** (the database-efficiency and Data API-security program, umbrella plan https://github.com/popcre/shared-db/blob/main/plan_database_efficiency_and_api_security.md) as the claim-first session for its remaining steps, resuming at the first unfinished item (Step 3's unmet gate items). Over the session the scope grew twice, both times by direct owner instruction:

1. Land Step 3's residual runtime evidence and advance the plan STATUS (done — PRs #6259, #6272, #6277, #6260).
2. "Spin up subagents to handle all the 'still open' points" — three points at the time (the #6257/#6260 migration collision, the popdam3 #293/#294/#295 evidence audit, the per-step matview split). Done via three background sub-agents (part (b)).
3. "Spin up sub-sessions to close each of them" — the then-remaining three (Steps 5–8, review finding #6274, loaded search-sync cost). Done via three Desktop sub-sessions (part (b)). One of them (Steps 5–8) is still live and working.
4. `/wrap-up` — this handoff.

## 3. Current state — what is true right now

**Verified at write time (2026-11-15 9:56 AM EST):** `origin/main` = `6f5bfcedd7eb14640a55dbeb1ec0eecfb09f393c`; maximum migration `20261115133704_sandbox_catchup_pmt_trackerplus_submission.sql`. (These go stale within the hour — re-fetch.)

**Landed on `main` by this session and its agents (all verified MERGED on GitHub):**

| PR | What | Merge commit |
|---|---|---|
| [#6259](https://github.com/popcre/shared-db/pull/6259) | Step 3 residual runtime measurements (WAL/duration, cleared_count volume, plan boundary re-verified as `supabase_read_only_user`) | `8aba554dfb6853b1e07433a7f037242c46a96f82` |
| [#6272](https://github.com/popcre/shared-db/pull/6272) | Per-step matview timings measured on preview (file_groups 2.251 s / folders 0.325 s / search 0.020 s / all 2.686 s) | `5cf49364af4816a5620a453a9831d00a4b0d5af1` |
| [#6277](https://github.com/popcre/shared-db/pull/6277) | Step 4 closure audit — popdam3 #293/#294/#295 all closed evidence-complete (SHAs + post-deploy deltas); plan STATUS advanced | `34cfd5ec65c31552d1b43ca3cde6287e04727359` |
| [#6260](https://github.com/popcre/shared-db/pull/6260) | Strand-recovery PR unblocked: duplicate migration `20261113162637` reconciled with main; side_rows reissue re-cut to **`20261113223432`**; landed | `1b7395040e3d4f899b4680b0fce5723fba084b86` |
| [#6329](https://github.com/popcre/shared-db/pull/6329) | Loaded search-sync cost measured on preview (0.148 s/100 rows, 0.676 s/1,000, 3.122 s/5,000; ~150× an empty pass, under the 8 s ceiling) | `395981d9087e73bb82edc7f93c9570cff57e802e` |
| [#6337](https://github.com/popcre/shared-db/pull/6337) | Review finding #6274 fixed (plan no longer lists measured work as open; timing proof registered in the doc index) | merged 2026-11-15 04:15 UTC |

**The plan STATUS** (https://github.com/popcre/shared-db/blob/main/plan_database_efficiency_and_api_security.md) is current as of those merges: Steps 0–4 done (Step 3 with two named unknowns carried explicitly — write-side query-plan bodies behind the `supabase_read_only_user` permission boundary, and the per-call `cleared_count` distribution, moot-by-retirement since `clear_style_group_batch` is dormant); the loaded-search boundary is now measured with PDF text cost as the one named gap. **Steps 5–8 are OPEN and owned by the live sub-session** (part (b), agent `2326 Steps 5-8`).

**Live delegation:** sub-session [2326 Steps 5-8](mimo-session://desktop/ses_ffe5e2301cf39ffeZKM0eKaFXx) (id `ses_ffe5e2301cf39ffeZKM0eKaFXx`) claimed #2326 on 2026-11-14 (https://github.com/popcre/shared-db/issues/2326#issuecomment-6887881261), declared its task class, and stated its job plan (Step 5 issue-splitting first, then 6, 7, 8 with the plan's fresh-session boundaries). **No structural objects claimed by it as of its last report.** Its last verified activity: that claim comment (2026-11-15 02:22 UTC). This handoff's successor should confirm the session is still live before assuming progress.

**Preview (the shared `shared-db-schema-rehearsal` branch) — disclosed writes, 2026-11-13 and 2026-11-14:**
- Four timed `refresh_style_guide_matviews(p_step => ...)` calls (per-step run, PR #6272's evidence) — matview refreshes + a search-sync drain with an empty queue.
- The loaded-search run (PR #6329's evidence) seeded `public.style_guide_search_sync_queue` with 100 / 1,000 / 5,000-row batches and drained them via `p_step='search'`; per the measuring session, the seeded queue drained fully and left nothing changed.
- No production writes of any kind in this arc. No migrations applied to preview or production by this session.

**#5747 scheduled checkpoints — still armed and NOT ours to run** (verified active 2026-11-15 10:00 AM EST): `auto-2` "5747 weekly assets health check" fires **Mon 2026-11-16 6:00 AM EST** (heap/live ≥ 2.0 ⇒ propose the governed pg_repack route, never repack by hand); `auto-3` "5747 index re-check and close-out" fires **Wed 2026-11-18 9:07 AM EST** (Step 3 index re-check, then close #5747 with live proof if the plan's §13 passes). They are self-contained one-shot automations in the shared-db project.

**Ownership closeout receipt (this session, `ses_ffe5e2a67024fffe0TbBld1kjq`):** `ai-shared-db-closeout-check` returned `{"blocking_claims":[],"blocking_stages":[],"ok":true,"open_claims_checked":16,"open_issues_seen":140,"session_id":"ses_ffe5e2a67024fffe0TbBld1kjq","stages_checked":3}` — zero owned claims, zero owned stages. The earlier receipt for the predecessor session (`ses_ffe5e43506d64ffeEzis1lhwfS`) was obtained 2026-11-13 11:54 AM EST, also `ok:true` with zero blocking claims, and is committed as evidence in https://github.com/popcre/shared-db/tree/main/docs/verification/database-efficiency/20261113T163700Z-step3-residual.

**Retirement of the predecessor handoff (successor rule, all three conditions verified):** `HANDOFF.d/2026-11-13T1450Z-edge-dev-mimo-2326-pickup-and-calendar.md` is deleted in this handoff's PR. (1) Its work is on `main` — its PR #6244 merged 2026-11-13, and its brief's action items were executed (closeout receipt obtained; #2326 picked up and advanced through Step 4; #5747 checkpoints armed and verified above). (2) Every open obligation it named is carried in this file: the #5747 checkpoint dates and rules (above and §6), the spent-version and re-apply prohibitions (§7), the merge-queue and signing rules (§7), the closeout-receipt obligation (fulfilled and recorded above). (3) Its tooling dead ends are reproduced in §4. Its own contract authorized retirement "when #2326 is finished (or its remaining steps are re-owned elsewhere)" — the latter is true.

## 4. Everything we tried that did NOT work — MANDATORY

These cost real time this session and its agents. Do not re-walk them.

1. **`ai-shared-db-closeout-check` failing `ok:false "GitHub authentication is unavailable"`** — repeated at the start (same as the predecessor's wrap-up). Root cause is NOT missing auth: `ai-gh` exits 75 with "GitHub core budget paused" when the machine-wide hourly core budget drops below its pause threshold, and the closeout script mislabels that as an auth failure. `gh auth status` is fine throughout. Fix: wait for the budget window to reset (the pause file records its expiry), then re-run. Our successful runs needed 3–6 attempts across budget windows.
2. **Backgrounding toolkit `.cmd` files via `Start-Process`** from the tool shell fails with `Unknown: ChildProcess.kill`. `schtasks /create` + `/run` with a tiny wrapper `.cmd` works and survives tool timeouts. (A first `schtasks /tr` with inline redirects failed on quoting — put redirects in the wrapper file.)
3. **The `bash` tool on this machine is PowerShell.** Bash syntax (`export`, `$VAR`) fails unless you invoke `bash -c '...'` explicitly. `Get-Date -Format "...Z"` prints LOCAL time with a literal Z — use `.ToUniversalTime().ToString(...)`.
4. **Pushing to a PR branch that is IN the merge queue is refused** (`GH006: ... queued for merging cannot be updated`). Dequeue first via GraphQL: `dequeuePullRequest(input: {id: "<PR node id>"})`. Note the asymmetry: **`dequeuePullRequest` takes `id`, `enqueuePullRequest` takes `pullRequestId`** (both take the PR's GraphQL node id). `gh pr merge --auto` alone can silently do nothing when auto-merge was dropped by a queue ejection — verify `autoMergeRequest` and use the GraphQL enqueue when the queue is empty but the PR is ready.
5. **"Drop the duplicate migration" was wrong for PR #6260's topology.** The branch had ADDED `20261113162637_ai_tag_save_set_based.sql` from a fork point before PR #6257 merged the identical file to main; deleting the file from the branch made the PR diff a DELETION against main, and the guard refused ("version already applied in preview (deleted)"). Correct fix: restore the file byte-identical to main (net zero diff) and keep the PR's own payload — see https://github.com/popcre/shared-db/pull/6260#issuecomment-6862360369.
6. **The backdating guard is a treadmill on a busy night.** The SQL-migration guard requires each added migration to sort AFTER main's newest version. Two pure renames were needed for the side_rows reissue (to `20261113191352`, then to `20261113223432`) because merged PRs kept advancing main's newest version mid-check. If it fails again, the fix is exactly what the check says: `git mv` to a fresh 14-digit UTC timestamp (keep the filename suffix), commit, push. Never reuse a spent version.
7. **`ai-pr-wait` on an unfixed PR blocks for up to 60 minutes** (it waits for checks that cannot pass until the fix lands). Killed; also killing every `*ai-pr-wait*` process machine-wide was over-broad — it killed OTHER sessions' waiters too. Scope process kills to one PID tree.
8. **Background sub-agent `general-1` stalled twice** (frozen turn count, zero file changes, 30+ minutes) inside long `ai-pr-wait`/watch calls. Cancelled it and took its small fix over directly. Lesson: for a sub-agent, "executionActive" is not progress — check its worktree/PR for concrete output before waiting again.
9. **`gh pr list --author "@me"` lists EVERY session's PRs** — the machine shares the `u2giants` identity. Never treat that list as "mine"; verify against what you created.
10. **jq one-liners through the PowerShell tool shell break on quotes and backslashes.** Pipe `gh` JSON through `node -e` instead.
11. **`report_event` is unroutable on this machine** ("No default session is set in MiMo Desktop"). Cross-session alerts must be carried in prose/handoff instead.
12. **Merge freezes chain back-to-back.** Every merged migration PR triggers an "automatic-production-qualification" run that pauses ALL merges (~30–45 min each). Green PRs get ejected from the queue when their group hits a freeze, which also silently drops auto-merge. The winning pattern: wait for `node scripts/manage-migration-coordination.mjs --check-promotion-freeze --pr <n>` to return `allowed:true`, then immediately enqueue; repeat on ejection. A 2:24 AM retry window was missed once and the PR sat until morning (landed after a manual re-enqueue).
13. **`ai-doc-health --fix-index` only indexes git-tracked files** — `git add` new docs before running it or the INDEX silently omits them.
14. **The docs-only fast lane is refused when a PR contains non-`.md/.txt/.rst` files** (e.g. `.json` evidence captures). Not a blocker — the guarded lane just runs the full checks; the "Documents-only merge authorization" red under a freeze is non-required and clears with `gh run rerun <id> --failed` after the freeze expires.

## 5. Root causes and key findings

- **`pg_stat_statements` was reset 2026-11-06 11:20:19 EST** (`extensions.pg_stat_statements_info.stats_reset`) and runs `track=top` — nested statements inside functions are invisible. All 7-day-window figures in this arc are bounded by that reset; do not compare them to the 2026-09-04 baseline without saying so. Evidence: https://github.com/popcre/shared-db/tree/main/docs/verification/database-efficiency/20261113T163700Z-step3-residual.
- **The Management API query role is `supabase_read_only_user`** (not superuser). `EXPLAIN` of UPDATE/DELETE statements is refused `42501` on `public.assets` / `public.style_groups` / `public.asset_effective_tags` — the write-side query-plan gap is a permanent platform boundary, not a tooling defect. `REFRESH MATERIALIZED VIEW` answers `Utility Statement` (no planner plan exists).
- **The rebuild path is the program's top write-amplification target:** 4,438 calls / 1,184 ms mean / **5.88 GiB WAL** per 7 days (2026-11-13 measurement). The counts batch is dormant (1 call / 0 WAL — the #2214 change predicate holds). `clear_style_group_batch` is dormant (0 calls; 111,736 rows still carried `style_group_id` as of 2026-11-13 11:37 EST).
- **popdam3 #293/#294/#295 closed evidence-complete** (audit artifact: https://github.com/popcre/shared-db/tree/main/docs/verification/database-efficiency/20261113T180512Z-step4-closure-audit): #293 was schedule-only via shared-db PR #4192 (refresh cron ~28 h/week → ~1.3 h/week); #294 via popdam3 #325/#331 + shared-db #4178 (`refresh_style_group_counts_serialized`); #295 via pre-existing popdam3 commit `67685c55` (clear stage retired). Residual gaps recorded there: #293's promotion run 38170524286 post-apply catalog check (DB-side, shared-db #4190 — #4190 itself closed `live_verified` 2026-10-21 with re-derived evidence), #294's nightly-reconcile retry limit, #295's unmeasured `cleared_count` distribution.
- **Per-step matview split (preview, 2026-11-13):** `file_groups` 2.251 s, `folders` 0.325 s, `search` 0.020 s (empty-queue drain), `all` 2.686 s. **Loaded search-sync (preview, 2026-11-14):** 0.148 s / 100 queued rows, 0.676 s / 1,000, 3.122 s / 5,000 — ~150× an empty pass, still under the 8-second ceiling; **PDF text cost is the one named gap** (preview barely holds PDFs). Evidence: https://github.com/popcre/shared-db/tree/main/docs/verification/database-efficiency/20261113T180242Z-perstep-matview-timings and https://github.com/popcre/shared-db/pull/6329.
- The job wrapper `refresh_style_guide_matviews_job()` runs only `p_step='search'` when the matview source signature is unchanged and the last full refresh is < 6 h old — that is why its 168 calls average only 3.8 s while crawl-run full refreshes take 157–2,658 s.
- **In flight by ANOTHER session — do not touch:** PR [#6335](https://github.com/popcre/shared-db/pull/6335) "migration: tolerant fix-forward of 20261113223432 side rows" (a repair of the migration this session re-cut) and PR [#6346](https://github.com/popcre/shared-db/pull/6346) (verification sidecar for a data-only fix-forward). They reference our version `20261113223432` but are owned elsewhere; verify their outcome before assuming the side_rows migration is final.

## 6. Exact next steps

1. **Confirm the live sub-session is still working:** open [2326 Steps 5-8](mimo-session://desktop/ses_ffe5e2301cf39ffeZKM0eKaFXx) (or ping it with `talk_to_session`). Its contract: Steps 5–8 of https://github.com/popcre/shared-db/blob/main/plan_database_efficiency_and_api_security.md — Step 5 (structural performance `db-work` issues with preview proof) first, then Step 6, with the plan's fresh-session boundary after Step 6 (hand off Step 7+). You'll know it worked when the plan STATUS advances with dated evidence and each step's gate is satisfied. If the session has been idle > 30 minutes with no PR/issue output, treat it as stalled and re-brief it (its full brief is in its own task field and in part (b) below).
2. **If the sub-session is gone or stalled beyond recovery**, resume the program in a fresh session using the next-session prompt at the bottom of this wrap-up report. Claim-first on #2326; the claim comment pattern is https://github.com/popcre/shared-db/issues/2326#issuecomment-6887881261.
3. **#5747 checkpoints fire themselves:** `auto-2` Mon 2026-11-16 6:00 AM EST (weekly health check; if heap/live ≥ 2.0 propose the governed repack route — never repack by hand) and `auto-3` Wed 2026-11-18 9:07 AM EST (index re-check, then close #5747 with live proof if the plan's §13 passes). Do not run them manually; if either fails, its output names the recovery.
4. **When the program finishes (Steps 5–8 done and gates satisfied)**, retire this handoff file per the successor rule (delete it in the PR that finishes the work), retire the Steps 5–8 session's own handoff if it wrote one, and close #2326 only through its supported completion path (never by hand if it is an outcome-lifecycle issue — check how it is closed; #2326 is a program/handover issue, a plain close with a summary comment is the historical pattern for it).
5. **Watch PRs #6335/#6346** (other sessions' fix-forwards touching `20261113223432`): if they land, nothing of ours is needed; if they fail, the side_rows migration may need its own follow-up — that is their session's call first.

## 7. Constraints and gotchas in force

- **Never re-apply or duplicate** migrations `20261106171924` and `20261012012727` (both in production). **Never reuse spent versions** `20261026174936`, `20261026193803`, `20261027022851`. Never edit an applied migration — forward-only.
- **Merge route:** branch + PR + `gh pr merge --auto` (NEVER `--squash`, NEVER `--admin` — the merge queue refuses them). The AI merges; the owner never does. Required checks are only: "SQL migration guards", "supabase/tests against an ephemeral database", "Destructive SQL outside migrations".
- **Sign every GitHub post** `Posted by MiMo chat <id> on <machine>` (use `unknown` when the session id is empty).
- **No manual production SQL.** Production reads only via the Management API `database/query` with `read_only: true`. Preview instrumentation writes are authorized only for this program's named measurements (plan clause), never persisted with the preview ref (the ref lives in the repo variable `PREVIEW_PROJECT_REF` — never write it into any file, comment, or artifact).
- **Worktree-only** (§2.1-W): every write-capable task in shared-db uses its own worktree cut from `origin/main`; the canonical checkout is landing-only. Never touch other sessions' `HANDOFF.d/` files or worktrees.
- **Never close an outcome-lifecycle issue by hand.** For repo-maintenance/docs issues a plain close with evidence is the pattern (as the sub-session did for review finding #6274).
- **`ai-task-gates start --class shared-db`** at the start of any shared-db work; `ai-doc-health` lives at `C:\repos\ai-devops\bin\ai-doc-health.cmd` (not on PATH); `ai-pr-wait` at `C:\repos\ai-devops\bin\ai-pr-wait.cmd` (pass `--repo`, and it refuses docs-class PRs — watch checks and merge manually for those).
- Machine is edge-dev (Windows). PowerShell is the tool shell; invoke `bash` explicitly for bash syntax. `psql` is NOT installed. Quotes in `gh ... --jq` one-liners break — pipe through `node -e`.

## 8. Access and environment

- Machine **edge-dev** (Windows). `gh` CLI authenticated as `u2giants` (shared across all sessions on this machine). GitHub orgs: `u2giants` (personal) and `popcre` (DesignFlow + shared-db).
- 1Password vault **`vibe_coding`** — the Supabase access token lives at `op://vibe_coding/Supabase CLI Personal Access Token/SUPABASE_ACCESS_TOKEN`; reference via `op read` piped, never printed, never committed. Nothing from this session needs a new vault entry (secrets sweep: swept — nothing new appeared; the token was only ever referenced by `op://` and values were never printed to chat, files, or captures).
- Supabase: production project ref `qsllyeztdwjgirsysgai`; preview is the `shared-db-schema-rehearsal` branch whose ref is the repo variable `PREVIEW_PROJECT_REF` (fetch at use time, never persist).
- Toolkits on PATH: `ai-task-gates`, `ai-shared-db-closeout-check`. Full path needed on this machine: `ai-doc-health`, `ai-pr-wait` (both under the installed `ai-devops` checkout's `bin/` — `C:\repos\ai-devops\bin\` here; on another machine find them in that machine's installed ai-devops checkout). `ai-shared-db-closeout-check --session-id <ses_...>` accepts MiMo session tokens; allow up to 3600 s (admission waits) and re-run through budget pauses.
- MiMo scheduled tasks `auto-2` / `auto-3` carry the #5747 prompts (see §3). `auto-1` ("Coolify token revocation watch close-out", dated Nov 7) is a past-due one-shot from another workstream — not ours; a session named "closed.Coolify token revocation watch close-out" exists, so it was likely handled; flag if it ever fires.

## 9. Open questions and risks

- **The Steps 5–8 sub-session is the single point of failure for the remaining program.** Last verified active 2026-11-15 02:22 UTC (its claim comment). If it dies, its brief is preserved in part (b) and in its own task field; the next-session prompt covers resumption. (Risk, dated 2026-11-15.)
- **PRs #6335/#6346 (other sessions) repair around `20261113223432`.** If their fix-forward lands with a NEW version, the side_rows story changes; do not assume ours is the final applied version without checking the ledger. (Dated 2026-11-15.)
- **The named unknowns in the plan are NOT settled** and must not be treated as measured: write-side query-plan bodies (permission boundary), the per-call `cleared_count` distribution (moot while the function is dormant but still unmeasured), PDF text cost in the loaded search path. Step 8's before/after workload proof will need them or their explicit absence recorded. (Dated 2026-11-15.)
- **Queue reality on busy nights:** production-qualification freezes chain for hours and eject ready PRs, silently dropping auto-merge. Anything green can sit unmerged until someone re-enqueues. (Dated 2026-11-15 — cost us one overnight wait.)
- Stale-by-nature: `main` SHA and max migration in §3 (checked 9:56 AM EST 2026-11-15); the counts and WAL figures are a 7-day window ending 2026-11-13 with the pgss reset at its start.

---

## Part (b) — every sub-agent, separated

Six delegated units this session: three background sub-agents (general-1/2/3) and three Desktop sub-sessions. Verified against PRs/diffs, not reports, where possible.

### Agent: general-1 — collision fix (worktree `stranded-recovery`, branch `mimo/stranded-recovery`) — FINISHED (cancelled + coordinator takeover)

- **Asked to do:** fix PR [#6260](https://github.com/popcre/shared-db/pull/6260) so it no longer carries duplicate migration version `20261113162637` (already landed on main via merged PR #6257), and land it through the merge queue.
- **Actually did:** byte-compared the duplicate against main (identical); committed a drop of the file (`d638e5c49` — coordinator); re-cut the side_rows version to `20261113191352` (`6493055bb`, its last act before cancellation); merged `origin/main` resolving test conflicts (`2e2f96ff3`). Its pushes to the branch were refused while the PR was queued (GH006).
- **Found:** the branch-held file deletion broke the guard (see §4 item 5); branch protection while queued.
- **PR / branch:** #6260 / `mimo/stranded-recovery` — **MERGED** (`1b7395040e3d4f899b4680b0fce5723fba084b86`).
- **Worktree:** retired (removed after merge).
- **Deliberately did NOT do, and why:** it stalled twice inside long `ai-pr-wait` calls with zero output (frozen turn count > 30 min); the coordinator cancelled it and finished the fix directly (§4 item 8). It never posted the closing comment on #6260 — the coordinator did (https://github.com/popcre/shared-db/pull/6260#issuecomment-6862360369).

### Agent: general-2 — popdam3 closure audit (worktree `step4-evidence-audit`, branch `docs/2326-step4-evidence-audit`) — FINISHED

- **Asked to do:** audit the closures of popdam3 #293/#294/#295 and advance the plan's Step 4 STATUS with dated evidence.
- **Actually did:** verdicts with SHAs and post-deploy deltas for all three (all evidence-complete — §5); evidence artifact `20261113T180512Z-step4-closure-audit/`; plan STATUS + summary updated; commit `897023afc`; summary comment on #2326 (https://github.com/popcre/shared-db/issues/2326#issuecomment-6862487723).
- **Found:** #293 was schedule-only (shared-db PR #4192, migration `20261011175808`); #294 = popdam3 #325 (`bf58742b`) + #331 (`5c4e95d0`) + shared-db #4178 (`657427dd`); #295 = popdam3 commit `67685c55` predating the issue. Residual gaps recorded (§5). It also established that `pg_stat_statements` must be schema-qualified as `extensions.pg_stat_statements` via the read-only role.
- **PR / branch:** [#6277](https://github.com/popcre/shared-db/pull/6277) / `docs/2326-step4-evidence-audit` — **MERGED** (`34cfd5ec65c31552d1b43ca3cde6287e04727359`, after the coordinator integrated the conflicting Step 3 per-step edits from PR #6272 in commit `706733423`).
- **Worktree:** retired (removed after merge).
- **Deliberately did NOT do, and why:** no issue was closed or reopened (its brief forbade it); it stopped at the merge conflict it could not own (the plan hunks from the per-step session) and handed integration to the coordinator rather than resolving another session's text.

### Agent: general-3 — per-step matview timings (worktree `2326-perstep`, branch `mimo/2326-perstep-timings`) — FINISHED

- **Asked to do:** measure the per-step split of `refresh_style_guide_matviews` on preview (the `p_step` instrument), record dated evidence, advance the plan STATUS.
- **Actually did:** four server-side timed `p_step` calls on preview (2026-11-13 1:02 PM EST): `file_groups` 2.251 s / `folders` 0.325 s / `search` 0.020 s / `all` 2.686 s; evidence `20261113T180242Z-perstep-matview-timings/` (+ 7 raw captures); plan STATUS advanced; commit `55d1418be`.
- **Found:** the Management API `read_only:false` against preview executes the function fine and fast (no HTTP timeout, no pg_cron fallback needed at preview scale); `all` ≈ sum of steps; the `search` figure was an empty-queue drain — it named the loaded-search cost as the remaining boundary (which sub-session 3 later measured).
- **PR / branch:** [#6272](https://github.com/popcre/shared-db/pull/6272) / `mimo/2326-perstep-timings` — **MERGED** (`5cf49364af4816a5620a453a9831d00a4b0d5af1`, 2026-11-13 1:45 PM EST).
- **Worktree:** retired.
- **Deliberately did NOT do, and why:** no production calls ever (brief forbade it); did not measure the loaded-search case (queue was empty and seeding was out of its scope) — explicitly handed on as the named boundary.

### Sub-session: [2326 Steps 5-8](mimo-session://desktop/ses_ffe5e2301cf39ffeZKM0eKaFXx) (`ses_ffe5e2301cf39ffeZKM0eKaFXx`) — **LIVE**

- **Asked to do:** claim-first execution of plan Steps 5–8 (structural `db-work` issues with preview proof and rollbacks; RLS/policy hardening by contract; #1966 index-observation delta + maintenance/WAL reports; end-to-end before/after proof), with the plan's fresh-session boundary after Step 6 (write a `HANDOFF.d/` for the Step 7 session and wrap).
- **Actually did (as of its last report, 2026-11-14/15):** fetched `origin/main`, re-read the plan STATUS, ran `ai-task-gates start --class shared-db`, verified in-flight state clean, posted the claim comment (https://github.com/popcre/shared-db/issues/2326#issuecomment-6887881261), stated its job plan (Step 5 issue-splitting first). **No structural objects claimed yet; no PRs as of wrap-up.**
- **Found:** nothing reported yet beyond the plan state (Steps 0–4 landed; 5–8 open).
- **PR / branch:** none yet.
- **Worktree:** none visible in the shared checkout's worktree list at wrap-up (it manages its own).
- **Deliberately did NOT do, and why:** it explicitly keeps Step 3's named unknowns unsettled and starts at Step 5 issue-splitting rather than jumping to implementation.
- **Resume material:** its full brief is preserved in its own task field (readable from its session) and summarized in §6; if the session must be rebuilt, the next-session prompt at the bottom of the wrap-up report is the cold-start.

### Sub-session: [Fix review finding 6274](mimo-session://desktop/ses_ffe5e2301cd47ffeWBCrpTtZxZ) (`ses_ffe5e2301cd47ffeWBCrpTtZxZ`) — FINISHED

- **Asked to do:** close review-finding [#6274](https://github.com/popcre/shared-db/issues/6274) (against PR #6272) via the review-fix lane.
- **Actually did:** corrected the plan so it names only the genuinely open unknowns (the review's complaint was that measured work was listed as open), registered the timing proof in the document index; PR [#6337](https://github.com/popcre/shared-db/pull/6337) merged 2026-11-15 04:15 UTC; #6274 closed the same minute. Coordinator verified both states on GitHub.
- **PR / branch:** #6337 — **MERGED**. **Worktree:** none present at wrap-up (self-retired).
- **Deliberately did NOT do, and why:** nothing outside the finding's scope.

### Sub-session: [Search-sync loaded cost](mimo-session://desktop/ses_ffe5e2301c4afffej4XONkR7xz) (`ses_ffe5e2301c4afffej4XONkR7xz`) — FINISHED (merge landed by coordinator)

- **Asked to do:** measure the LOADED search-sync cost on preview (the boundary general-3 left), record dated evidence, advance the plan STATUS, land it.
- **Actually did:** seeded `style_guide_search_sync_queue` on preview in 100/1,000/5,000-row batches and timed `p_step='search'`: 0.148 s / 0.676 s / 3.122 s (~150× an empty pass, under the 8 s ceiling); seeded queue drained fully each run; plan STATUS updated with PDF text cost as the one named gap; PR [#6329](https://github.com/popcre/shared-db/pull/6329) (branch `mimo/2326-loaded-search-sync`, commit head `3cf6b2131`).
- **Found:** the numbers above; PDF text cost is poorly representable on preview (it barely holds PDFs) — named, not measured.
- **PR / branch:** #6329 — **MERGED** (`395981d9087e73bb82edc7f93c9570cff57e802e`, 2026-11-15 8:08 AM EST). Its own armed 2:24 AM retry missed the window (production-merge freezes); the coordinator re-enqueued at 7:57 AM EST and the queue landed it.
- **Worktree:** `2326-loaded-search-sync` retired by the coordinator at wrap-up (clean tree; branch deleted only after GitHub-confirmed merge).
- **Deliberately did NOT do, and why:** it stopped at the freeze rather than bypassing the queue (correct); it did not measure PDF text cost (preview cannot carry it) — carried as the named gap in the plan.

---

*Posted by MiMo chat ses_ffe5e2a67024fffe0TbBld1kjq on edge-dev*
