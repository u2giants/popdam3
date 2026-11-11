---
issue: 804
status: OPEN
owner: claude/popdam3-coordinator-af3b72
---

# Handoff — five wasted-database-work fixes are live; follow-up readings and four small items carry forward

Written 2026-11-11 4:40 PM EST by Claude (hetz), closing a coordinator session
and its five nested sessions. All five tasks of the predecessor handoff are
**fixed live and measured**. This file carries only what is left: timed
follow-up readings and four small items found along the way. Retire this file
when the tasks in section 6 are each done live or posted on
[issue 804](https://github.com/u2giants/popdam3/issues/804) with an evidenced
reason not to do them. Issue 804 is the coordination record.

It replaces (successor rule) the predecessor
`HANDOFF.d/2026-11-11T1543Z-hetz-claude-close-nested-search-speed.md`, deleted
in the same PR: its five tasks are landed and verified on GitHub, its settled
decisions are copied into section 0, its dead ends into section 4, and its open
risks into section 9.

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream needs the owner. (Sweep run over sections
1–9: the only "decide" is task 2's per-table choice, which is technical — the
apps were already written to listen to those tables, so switching them on is
the intended behaviour, not a business choice.)

Already settled — do NOT re-ask:

- **2026-11-10, Albert: "Keep all five."** A character search in PopSG lists
  the guide named for that character first; guides that merely contain it stay
  listed after it ([docs/SEARCH_EVAL.md](https://github.com/u2giants/popdam3/blob/main/docs/SEARCH_EVAL.md)).
- **2026-11-10, Albert:** speed fixes must be **free** — no compute or disk
  upgrades, no paid add-ons.
- **2026-11-10, Albert:** don't wait for scheduled readings; measure at quiet
  hours and time each step directly.
- **2026-11-10:** the empty-result retry is PopSG-only by design.
- **2026-11-01:** DC and Harry Potter are properties of Warner, never licensors.
- **2026-10-29 / 2026-10-30:** reviews are advice only and never block a merge;
  only checks that stop production-data damage or secret leaks may block.
- **2026-11-11 (coordinator, within existing authority):** one shared "Search
  test set" run served all five tasks; because no quiet window opened, the run
  that overlapped a production apply stands as conservative proof (interference
  only slows search). The clean baseline is the scheduled Nov 12 reading (task 1).

## 1. What this application is

PopDAM (`u2giants/popdam3`, live at https://dam.designflow.app) is POP
Creations' digital asset manager: designers search product artwork. PopSG
(https://sg.designflow.app, same repository) is the licensor style-guide
library. Both sit on one **shared** Supabase database (project
`qsllyeztdwjgirsysgai`, Virginia) that other POP apps also use: PLM/ColdLion
items, PopCRM, and the HTS customs-classification feature inside DesignFlow
(`popcre/designflow-backend`). Database structure lives in
[`popcre/shared-db`](https://github.com/popcre/shared-db) and reaches
production only through that repository's automatic preview → production
promotion, **one migration per train, serially**.

## 2. What we set out to do, and why

Albert asked (issue 804) to make search fast at no extra cost. Search itself
was finished by the previous tree; that tree found five pieces of background
database work wasting time on the shared database and competing with search.
This session's job: coordinate five nested sessions, one per waste item, to
fix each for free, prove it live, and keep search accuracy intact.

## 3. Current state — what is true right now

### Landed and verified (each checked on GitHub by the coordinator)

| Task | PRs | Result (evidence comment on 804) |
|---|---|---|
| 1 Realtime change polling | shared-db [#6052](https://github.com/popcre/shared-db/pull/6052) (migration `20261111170334`, in production 2:06 PM EST), [#6065](https://github.com/popcre/shared-db/pull/6065) (tools-only verification sidecar) | 13 unlistened tables removed from the `supabase_realtime` publication, 9 kept; poll 38.8 → 22.6 ms; ~7,760 → ~4,400 s/day (−43%); 9/9 kept tables still subscribe, events seen on the 2 busy ones. Comments [6805464676](https://github.com/u2giants/popdam3/issues/804#issuecomment-6805464676), [6805584073](https://github.com/u2giants/popdam3/issues/804#issuecomment-6805584073) |
| 2 PLM item list lookups | shared-db [#6049](https://github.com/popcre/shared-db/pull/6049) (index on `plm.item(item_number)`, in production 12:22 PM EST) | 16.3 → 0.24 ms per lookup; ~2,370 → ~35–47 s/day; sequential scans 0; output identical (200-sample diff, 19,980-row fingerprint). The view was **not** rewritten — a missing index was the cause. Comment [6802910364](https://github.com/u2giants/popdam3/issues/804#issuecomment-6802910364) |
| 3 Assets "paging" by property / licensor | popdam3 [#954](https://github.com/u2giants/popdam3/pull/954) (merged 11:51 AM EST, edge deploy run 43062453530) | Not paging: the library filter list (`admin-api` action `get-filter-options`) ran one exact count per licensor (27) and property (290). Now one grouped call. Old statements: 0 new calls in 4 h; counts identical across all 27 / 290. New call ~1.4–2.4 s, ~14 s/hour daytime. Comment [6801887763](https://github.com/u2giants/popdam3/issues/804#issuecomment-6801887763) |
| 4 PopSG prewarm + snapshot staleness | shared-db [#6053](https://github.com/popcre/shared-db/pull/6053) (migration `20261111162335`, in production ~12:40 PM EST), [#6061](https://github.com/popcre/shared-db/pull/6061) (test-only) | Prewarm every 15 min instead of 5, same per-run cost: ~914 → ~305 s/day; 13 runs, 0 failed by 3:57 PM EST. Snapshot rebuild now relies on the change signature only (6-hour rule removed, ~250 s/day). Comment [6803375223](https://github.com/u2giants/popdam3/issues/804#issuecomment-6803375223) |
| 5 HTS classification job-list poll | shared-db [#6055](https://github.com/popcre/shared-db/pull/6055) (migration `20261111162441`, 3 generated columns, in production 12:59 PM EST), [#6080](https://github.com/popcre/shared-db/pull/6080) (contract digest); designflow-backend [#393](https://github.com/popcre/designflow-backend/pull/393) (merged to `develop` 1:55 PM EST by `devopswithkube`) | 4,219 → 20 ms per call; ~5,009 → ~24 s/day projected; same 183 jobs, 236/236 rows identical. 99.9% of the cost came from the sandbox environment, live there since 1:05 PM EST. Comment [6803532684](https://github.com/u2giants/popdam3/issues/804#issuecomment-6803532684) |

**Search gate:** "Search test set" run
[43085788458](https://github.com/u2giants/popdam3/actions/runs/43085788458) on
main: PopDAM 119/119 p95 2551 ms; PopSG guides 65/65 p95 2885 ms; PopSG files
65/65 p95 2536 ms. A production apply overlapped it 2:19:44–2:22:01 PM EST, so
it is conservative, not a clean baseline. Reasoning: comment
[6806853131](https://github.com/u2giants/popdam3/issues/804#issuecomment-6806853131).

### Tree closed

| Session | Final state | Branch / worktree |
|---|---|---|
| Task 1 realtime (local_051c6372…) | wrapped up, CLOSE-NESTED REPORT received | merged; shared-db worktree and branches removed; claim shared-db 6050 closed |
| Task 2 PLM (local_9224c825…) | wrapped up, report received | merged; worktree removed; claim 6048 closed |
| Task 3 assets (local_9b881a75…) | wrapped up, report received | merged; remote branch deleted; popdam3 worktree `silly-mcclintock-58c84c` clean, safe to remove |
| Task 4 PopSG (local_ff362d3e…) | wrapped up, report + addendum received | merged; worktree removed; claim 6051 closed |
| Task 5 HTS (local_f037d510…) | wrapped up, report + addendum received | merged; both worktrees removed; claim 6054 closed |

No claims or locks held (each shared-db child ran `ai-shared-db-closeout-check`
or closed its claim issue). No child wrote its own HANDOFF.d file. The
coordinator itself touched no database and held no claim.

### Not done

The tasks in section 6.

## 4. Everything we tried that did NOT work

From this session:

- **Letting five sessions merge to shared-db main freely.** Every merge to
  main during another change's rehearsal makes the serial promotion refuse and
  restart (~12 quiet minutes needed). It refused twice before the coordinator
  imposed a hold-and-release order. Sequence shared-db merges from the start.
- **Coordinator declared three changes "in production" from one green run.**
  Wrong: the run's commit contained all three, but promotion applies **one
  migration version per train**. Verify by the run title naming the PR
  (`DB production apply … PR<n>`) or by the production ledger, never by commit.
- **Releasing the next merge on that wrong reading.** Caught before it merged;
  the release was withdrawn. No harm, but it cost a round-trip.
- **A migration whose only statements sit inside a `DO` block, shipped without
  a verification sidecar (task 1).** It applied, then the post-apply catalog
  verification failed and the lane kept retrying it. An advisory review finding
  (shared-db 6056) had flagged exactly this and was closed as "no defect" — it
  was right. Such a migration needs a sidecar + named catalog contract +
  registry entry and baseline hash in the SAME PR.
- **The read-only verification-recovery workflow** (run 43088854821) refused
  to bind because the original apply run had a second failed step
  (`refund-eligible-fault`). See task 3.
- **"Nothing touches the database" judged from PR checks alone.** The lane's
  retries of the failed verification ran a production apply step mid search
  test and contaminated its speed reading.
- **Waiting for a clean window for the rerun.** An unrelated session's
  shared-db PR 6064 held the lane from 2:45 PM past 4:00 PM EST (its production
  apply sat queued from 3:28 PM). The coordinator bounded the wait and accepted
  the first run.
- **Handoff guesses that were wrong:** task 2 was not the view's window
  function (missing index); task 3 was not LIMIT/OFFSET paging (per-entity
  counts). Measure the cause before designing the fix.

Carried from the predecessor (still true):

- "It's busy-hour load" was wrong; the cause of slow search was cold reads
  inside the search functions. Do not "restore" the old per-minute table scan
  as a cache warmer.
- Prewarming vector indexes / raising `work_mem`: skipped; indexes don't fit
  in 1 GB of cache and nothing showed sorts spilling.
- "PopSG never sends a meaning vector": not a bug.
- The shared-db merge queue rejects backdated migration version stamps;
  re-stamp to current UTC if ejected.

## 5. Root causes and key findings

- Realtime: remaining ~4,400 s/day is the poll itself (WAL decode plus a scan
  of ~7,760 catalog entries per poll). Publication changes cannot reduce it
  further; fewer relations in the database (three DesignFlow schema copies)
  might — unmeasured.
- Four tables that apps subscribe to with `postgres_changes` were never in the
  publication, so those live refreshes have never fired (task 2).
- `pg_stat_statements` stats were last reset 2026-11-06 11:20 AM EST; per-day
  costs are computed from that baseline. Check
  `extensions.pg_stat_statements_info.stats_reset` before any reading.
- DesignFlow repositories: PRs go from `sandbox-albert` to `develop`, are
  never self-merged, and `u2giants` is the established PR author there.

## 6. Open tasks — exact next steps

Common rules: free fixes only; structural DB changes go through
`popcre/shared-db` with the `shared-db-change` skill (claim on an issue,
migration version = current UTC, sidecar + catalog contract in the same PR
when statements sit in a `DO` block, automatic preview → production promotion,
no manual production command). If more than one task merges to shared-db main,
the coordinator sequences them: one in the lane at a time, release the next
only after the previous version is in the production ledger. Post signed
evidence on [issue 804](https://github.com/u2giants/popdam3/issues/804) —
counts and IDs only, no licensed names.

### Task 1 — Follow-up readings and schedule removal (start after Nov 12, 10:00 PM EST)

- **State:** all five fixes live; only first-hours numbers exist. All
  read-only on production.
- **Next action, in order:**
  1. Skipped-rebuild check (any time after Nov 11 6:15 PM EST):
     `select to_char(start_time at time zone 'America/New_York','HH24:MI') t, round(extract(epoch from end_time-start_time)::numeric,2) secs, status from cron.job_run_details where jobid=12 and start_time > '2026-11-11 12:15-05' order by start_time;`
     and `select value->'library-default-snapshot'->>'refreshed_at' from public.admin_config where key='STYLE_GUIDE_REFRESH_STATE';`
     PASS = the 6:00 PM and 6:15 PM runs take well under 1 s. A real file
     change or the nightly crawl (~9:15 PM EST) legitimately rebuilds and moves
     `refreshed_at`; that is not a failure.
  2. Full-day cost readings (earliest Nov 12 noon EST): task 3 statement ids —
     `select queryid, calls, round(total_exec_time::numeric/1000,1) total_s, round(mean_exec_time::numeric,1) mean_ms from extensions.pg_stat_statements where queryid in (5921498560982909829,-4471648368696359837,9147071704481131456);`
     PASS = the two old ids still at 73,934 and 6,639 calls and the new id's
     per-day total far below 2,610 s. Also take a 24-hour per-day figure for
     the realtime poll (`realtime.list_changes`), the HTS job-list poll, the
     PLM lookups and the PopSG prewarm, by the methods in each task's evidence
     comment (section 3).
  3. Read the scheduled "Search test set" run of Nov 12 9:47 PM EST as the
     clean speed baseline. Then remove the one-shot schedule from
     [search-eval.yml](https://github.com/u2giants/popdam3/blob/main/.github/workflows/search-eval.yml)
     (per the comment in that file) by PR.
  4. If PopSG guides p95 is over 3 s on that clean run: fix forward with a new
     shared-db migration setting the prewarm to every 10 minutes
     (`cron.alter_job` on job `prewarm-style-guide-search`).
- **Done when:** all readings posted on 804; clean run shows 119/119, 65/65,
  65/65 with all p95 under 3 s (or step 4 landed and a later run does); the
  one-shot schedule is removed on main.
- **Resume from:** fresh from `main` of `u2giants/popdam3`.

### Task 2 — Switch on live updates for tables apps already listen to

- **State:** apps subscribe to four tables that are not in the
  `supabase_realtime` publication, so those refreshes never fire: PopDAM
  `public.render_queue`
  ([OverviewCards.tsx](https://github.com/u2giants/popdam3/blob/main/src/components/settings/diagnostics/OverviewCards.tsx));
  PopCRM `crm.ingested_domain`, `core.contact`, `core.contact_company`
  ([realtime.ts](https://github.com/popcre/popcrm-web/blob/main/src/features/crm/realtime.ts)).
  Separately, a from-scratch database build does not publish
  `public.admin_config` or `public.agent_registrations` (production has them
  from outside migration history).
- **Next action:** one additive, idempotent shared-db migration: `alter
  publication supabase_realtime add table …` for the four, plus add-if-missing
  for the two, WITH a verification sidecar and catalog contract in the same PR.
  Each added table costs ~0.2–0.5 ms per poll; record before/after poll cost.
- **Done when:** merged and in the production ledger with a green post-apply
  verification; an event is seen arriving in PopDAM (render queue card) and in
  PopCRM for each table; poll cost posted on 804.
- **Resume from:** fresh from `main` of `popcre/shared-db`.

### Task 3 — Verification certificate for migration 20261111170334

- **State:** the migration is applied and correct (direct production read: 9
  tables published, 13 absent), but no workflow-issued post-apply verification
  certificate exists: apply run 43083315321 failed at verification, and
  recovery run 43088854821 refused because that run also has a failed
  `refund-eligible-fault` step. Record: 804 comment 6805584073 and closed
  claim shared-db 6050.
- **Next action:** in `popcre/shared-db` tooling, make the recovery validator
  accept an original run whose only other failure is the
  `refund-eligible-fault` step (tools-only PR with tests), then rerun the
  read-only recovery for this version. If the tooling's rules forbid that,
  post the evidenced reason on 804 and close this task.
- **Done when:** a green recovery run exists for `20261111170334`, or the
  evidenced reason not to is on 804.
- **Resume from:** fresh from `main` of `popcre/shared-db`. Do not run in
  parallel with task 2's merge (same lane).

### Task 4 — Optional: faster library filter counts (start after Nov 18)

- **State:** the one remaining grouped count takes ~1.4–2.4 s per call
  (~14 s/hour daytime). Not started on purpose: `public.assets` is under the
  scheduled readings on shared-db issues 5745/5747 (Nov 12 9:47 PM EST and
  Nov 18).
- **Next action:** after the Nov 18 reading, add a partial index on
  `public.assets (licensor_id, property_id) where not is_deleted` via
  shared-db; measure before/after.
- **Done when:** in production, per-call time in tens of ms, filter list
  counts unchanged (compare all licensors and properties), evidence on 804 —
  or an evidenced reason not to (saving is under ~5 min/day).
- **Resume from:** fresh from `main` of `popcre/shared-db`.

### Task 5 — Close the duplicate digest PR

- **State:** another session (edge-dev3) opened shared-db
  [PR 6073](https://github.com/popcre/shared-db/pull/6073) for issue 6069 with
  the same one-line contract-digest change that
  [PR 6080](https://github.com/popcre/shared-db/pull/6080) already landed. It
  was OPEN at 4:34 PM EST.
- **Next action:** if still open, post a signed comment on 6073 and 6069
  saying 6080 landed the identical digest (`11b0af32…317a`) and that the PR is
  now a no-op; close them only if their owning session has not within a day.
- **Done when:** 6073 and 6069 are closed, or their owner has answered.
- **Resume from:** no branch needed.

## 7. Constraints and gotchas in force

- Never push to `main`; branch, PR, merge it yourself. Reviews are advice only.
  DesignFlow repositories are the exception: PR to `develop`, never self-merged.
- Licensed names, product codes and file IDs never go in public issues —
  counts and IDs only.
- Database structure changes only through `popcre/shared-db`; no manual
  production command. One migration per promotion train; a merge to main
  mid-rehearsal restarts the train.
- An open `review-finding` issue on a merged shared-db PR holds its promotion:
  resolve or close it with evidence, then dispatch
  `automatic-production-trigger.yml`. Read the finding properly first (see
  section 4).
- Never score speed while a shared-db apply, PopSG crawl or snapshot rebuild
  is running.
- Do not disturb the scheduled readings on shared-db issue 5747 (Nov 12
  9:47 PM EST, and Nov 18).
- Wait on PRs with `bin/ai-pr-wait`, never hand-written loops (a hook blocks
  them, including a `for` loop over `gh pr view`).
- Sign everything posted to GitHub with `$AI_GH_SIGNATURE`.

## 8. Access and environment

- Machine `hetz`; `gh` authenticated as `u2giants`.
- Live database: Supabase project `qsllyeztdwjgirsysgai` (read-only by default).
- Secrets: 1Password vault `vibe_coding` — search tester login, publishable
  key, database password; values never in chat or files.
- Workflow "Search test set" (label input required):
  [search-eval.yml](https://github.com/u2giants/popdam3/blob/main/.github/workflows/search-eval.yml);
  per-step timing:
  [step-timing.mjs](https://github.com/u2giants/popdam3/blob/main/scripts/search-eval/step-timing.mjs).
- Governing plan:
  [plan_vector_consolidation.md](https://github.com/u2giants/popdam3/blob/main/plan_vector_consolidation.md).

## 9. Open questions and risks

- PopSG guides p95 was 2,885 ms on the accepted run, just under the 3 s bar,
  now with a 15-minute prewarm. Task 1 step 3–4 settles it. Further free
  candidate if needed: precompute entity aggregation and page tags for broad
  queries (~1.7–2.4 s warm). Not started.
- The designflow-backend change is on `develop`; DesignFlow's own release
  carries it to the production app (12 jobs there today, immaterial cost).
- Realtime: 7 of the 9 kept tables had no row changes during the checks, so
  subscription is proven but delivery was not observed for them.
- shared-db PR 6064 (another session's) appeared stuck in the production lane
  at 3:55 PM EST. Not ours; check the lane is moving before task 2 or 3 merges.
- `dam_search_keys` word indexes add write cost; not measured.
- designflow-backend "Task Gates / verify" was already failing on
  `sandbox-albert` before this work; not ours.

## Self-audit (handoff-writer)

1. Newcomer can continue: yes — §1 app, §3 state with PRs, runs and evidence
   comments, §6 cold tasks with exact queries.
2. As effective as me: yes — §4 dead ends including the coordinator's own
   mistakes, §5 findings, §7 traps.
3. Every detail: yes — goals §2, failures §4, decisions §0, gates and
   done-when in §6, risks §9.
4. Owner decisions: swept §1–§9 line by line; none need Albert. Task 2's
   per-table choice is technical (noted in §0).
