---
summary: "Step 4 closure audit of popdam3 #293/#294/#295: implementing PRs/commits with SHAs, deployed proof, and post-deploy call/latency deltas captured 2026-11-13"
kind: proof
status: done
read-when: auditing Step 4 write-amplification closures or citing popdam3 #293/#294/#295 evidence
---

# Step 4 closure audit — popdam3 #293 / #294 / #295 — 2026-11-13

**Plan / issue:** `plan_database_efficiency_and_api_security.md` Step 4 / #2326
**Recorded:** 2026-11-13T18:05Z capture (1:05 PM EST); audit completed 1:20 PM EST
**Session:** MiMo chat unknown on edge-dev
**Scope:** closure audit of the three owning-app issues in `u2giants/popdam3`, plus one
read-only production capture through the Supabase Management API `database/query`
endpoint with `read_only: true` (project `qsllyeztdwjgirsysgai`; pattern:
`scripts/catalog-truth.mjs`). No DDL, no DML, no `pg_stat_reset`, no settings change,
no row contents, no credentials in this file. Raw capture: `q-step4-measurements.json`
beside this file. Nothing in `u2giants/popdam3` was written; its local checkouts were
read only.

## Verdicts (one per issue)

### #293 "Coalesce style-guide matview refresh cadence after bounded refresh landed" — CLOSED 2026-10-21T21:31:27Z — evidence-complete

**What landed:** no app PR was needed. Closing comment (Claude, 2026-10-11): *"Schedule-only,
via shared-db: popcre/shared-db#4190, claim #4191, PR popcre/shared-db#4192 — matviews
`*/15` -> hourly at :07; library snapshot `*/5` -> `*/15`. No function/matview definition
change, no app code change needed."*

- Implementing PR: popcre/shared-db **#4192** "Coalesce style-guide matview cron cadence (#4190)",
  merged 2026-10-11T19:59:07Z as **`5f2f7f74ec3490b9f2e6b0dc99a3ed0c17975d22`**; migration
  **20261011175808** (original database owner records it applied).
- Deployed proof (read-only, live `cron.job`): job 9 `refresh-style-guide-matviews`
  `7 * * * *` active; job 12 `refresh-style-guide-library-default-snapshot`
  `*/15 * * * *` active — re-verified 2026-11-13 (see capture).
- Before/after (weekly refresh DB time):
  - Pre-change (2026-10-11 measurement): job 9 **672 runs/7d, avg 14.6 s (~2.7 h/week)**;
    job 12 **2,016 runs/7d, avg 45.1 s (~25 h/week)**; total ~28 h/week.
  - First week after change (2026-10-21 closing comment): *"Job 9: 168/168 succeeded,
    avg 12.4 s, 0.58 h/week ... Job 12: 667 succeeded, 5 timed out at 120 s, avg 59.7 s,
    11.2 h/week ... Total refresh DB time is down from ~28 h/week to ~11.8 h/week."*
  - Current window (2026-11-13 capture, `cron.job_run_details` last 7 days):
    job 9 **168/168 ok, avg 3.75 s, max 29.25 s (~0.18 h/week)**; job 12 **672/672 ok,
    avg 5.96 s, max 132.54 s (~1.11 h/week)**; total **~1.3 h/week**. Search-sync
    backlog still 0 rows.

**Gap recorded, not hidden:** promotion run
`38170524286` **remains FAILED** at `Post-apply catalog verification` (production apply
review succeeded; schedules are directly confirmed live). Tracked DB-side on
popcre/shared-db #4190. The issue was closed on app-side evidence per its own comment:
*"The app-side need is met. The failed post-apply catalog check ... is a database-side
item tracked on popcre/shared-db#4190 by its owner."*

### #294 "Serialize or coalesce overlapping refresh_style_group_counts_batch callers" — CLOSED 2026-10-11T23:35:41Z — evidence-complete

**What landed:** two app PRs plus the DB half.

- popdam3 **#325** "fix(edge): single-flight and coalesce style-group counts refresh (#294)",
  merged 2026-10-11T16:54:08Z as **`bf58742b834110d53b261da739f8f8bb2d66e31b`**
  (per-isolate single-flight + coalescing, sorted ids, retry, failures surfaced; tests
  for duplicate delivery, overlapping batches, retry, partial failure, different-key work).
- popdam3 **#331** "fix(edge): use serialized style-group counts RPC (#294)", merged
  2026-10-11T20:48:56Z as **`5c4e95d0aeefce2864c4ecb046a1df13fb86dfb0`** — closing
  comment: *"DB half done: `refresh_style_group_counts_serialized(uuid[])`
  (popcre/shared-db#4174) is live in production ... #331 merged and deployed
  (deploy-supabase success): the edge refresher now calls it."*
- DB half: popcre/shared-db **#4178** "shared-db#4174: serialized style-group counts
  refresh RPC", merged 2026-10-11T20:33:28Z as
  **`657427dd5fb20d00c6179ac5f755b685d12fcb12`** — `refresh_style_group_counts_serialized(uuid[])`
  takes the same `BULK_OPERATIONS` advisory key the nightly reconcile holds, 5 s `lock_timeout`.
- Deployed + live proof (2026-10-11 7:35 PM EDT closing comment): admin-api
  `ingest-sibling-images` → 200; *"pg_stat_statements ... then showed
  `refresh_style_group_counts_serialized` called once via PostgREST (3.5 ms) followed by
  `refresh_style_group_primaries`."*
- Post-deploy delta (2026-11-13 capture, `extensions.pg_stat_statements`, window since
  stats reset 2026-11-06 11:20:19 EST):
  `refresh_style_group_counts_serialized` (**1 call, 2.4 ms mean, 0 WAL**);
  `refresh_style_group_counts_batch` (**0 entries** — the unserialized batch is no longer
  called by any measured path).

**Gaps recorded, not hidden:** (1) the first DB promotion run
`38172947937` failed at the production-risk-assessment gate ("no durable APPROVE ... carries
a matching reviewer risk assessment"); the function is nevertheless live and was verified
in production both on 2026-10-11 and 2026-11-13. (2) Known limit from the DeepSeek review,
quoted in the issue: *"during the nightly reconcile window an admin-triggered refresh
exhausts its 3 retries and is logged, not fatal; the nightly reconcile itself recomputes
every group."*

### #295 "Measure clear_style_group_batch changed-row count and skip unchanged writes" — CLOSED 2026-10-21T22:28:47Z — evidence-complete (pre-existing commit; no app PR)

**What landed:** no new PR. The fix pre-dated the issue.

- Implementing commit: popdam3 **`67685c55095c959a4dbe6cdf6dbbe37d89e76ba4`**
  (2026-10-02T16:40:32Z) *"fix(worker): nightly style-group rebuild no longer deletes
  every group ... a run now goes rebuild_assets -> finalize_stats -> prune only groups
  with asset_count 0 confirmed empty."* Issue comment: *"Already fixed app-side by
  67685c55 (2026-10-02 12:40 PM EDT): a fresh run starts at `rebuild_assets`;
  `clear_assets` is reachable only from a legacy persisted state ... No shared-db change
  needed; no new PR."*
- Measurement (2026-10-11 EDT, read-only): `clear_style_group_batch` selects only
  `is_deleted=false AND style_group_id IS NOT NULL`, so **selected = changed by
  construction (0% no-op inside the function)**; the waste was stage-level —
  **99,919 of 138,655** live assets (100%) already held the SKU-derived group that
  `rebuild_style_groups_batch` re-stamps, so clear-then-rebuild was ~200k no-op writes
  per run. The rebuild carries `IS DISTINCT FROM` guards (#2408).
- Before/after:
  - Baseline (2026-09-03 plan §5): `clear_style_group_batch` **287 calls, mean 34,617.3 ms**.
  - Live proof (2026-10-21 closing comment): *"tonight's nightly rebuild ran 2:00–2:19 AM
    EDT with 521 `rebuild_style_groups_batch` calls and **0** `clear_style_group_batch`
    calls. The clear stage is no longer used."*
  - Follow-up (2026-10-22): rebuild on unchanged data would re-assign **0** of 139,597
    live assets (both overloads guarded).
  - Current window (2026-11-13 capture): `clear_style_group_batch` **0 entries** in
    `extensions.pg_stat_statements`; `rebuild_style_groups_batch` 4,438 calls,
    1,184.1 ms mean, 6,021.29 MB WAL.

**Gap recorded, not hidden:** the per-call `cleared_count` distribution stays
**NOT MEASURED** — the function is dormant (0 calls in every window since the fix), so no
calls exist to instrument; closing it as "skip unchanged writes" was resolved by retiring
the clear stage, not by a skip predicate. Side finding left on the issue for its own
ticket: `style_groups` rows re-stamped by per-row PostgREST updates (~56k calls since
reset) may themselves be no-op writes.

## Current post-deploy snapshot (2026-11-13T18:05:12Z, read-only)

`extensions.pg_stat_statements` window since stats reset **2026-11-06 11:20:19 EST**
(raw rows in `q-step4-measurements.json`):

| Operation | Calls | Mean ms | WAL MB | Note |
|---|---|---|---|---|
| `rebuild_style_groups_batch` (PostgREST) | 4,438 | 1,184.1 | 6,021.29 | nightly rebuild path |
| `select public.refresh_style_guide_matviews_job()` | 169 | 3,820.2 | 99.82 | hourly job 9 (`7 * * * *`) |
| steppable matview refresh (`p_run_id`,`p_search_batch_size`,`p_step`) | 6 | 12.4 | 0.00 | on-demand crawl path |
| `refresh_style_group_counts_serialized` (`p_group_ids`) | 1 | 2.4 | 0.00 | #294 serialized RPC |
| `refresh_style_group_counts_batch` | 0 entries | — | — | unserialized path retired |
| `clear_style_group_batch` | 0 entries | — | — | #295 clear stage retired |

`cron.job` (same capture): job 9 = `7 * * * *` active; job 12 = `*/15 * * * *` active.
`style_guide_search_sync_queue`: 0 rows.

## Classification summary

| Issue | Closed | Verdict | Implementing artifact | Deployed + before/after |
|---|---|---|---|---|
| #293 | 2026-10-21T21:31:27Z | evidence-complete | shared-db PR #4192 (`5f2f7f74`), migration 20261011175808; no app PR needed | live cron schedules; ~28 h/wk → ~11.8 h/wk (wk 1) → ~1.3 h/wk (2026-11-13) |
| #294 | 2026-10-11T23:35:41Z | evidence-complete | popdam3 #325 (`bf58742b`), #331 (`5c4e95d0`), shared-db #4178 (`657427dd`) | deploy-supabase success; serialized RPC observed live; batch 0 entries |
| #295 | 2026-10-21T22:28:47Z | evidence-complete (pre-existing commit, no PR) | popdam3 `67685c55095c` (2026-10-02) | 287 calls @ 34.6 s → 0 calls (2026-10-21 and 2026-11-13) |

All three issues were left closed; nothing was reopened. Named caveats above
(#293 promotion-run catalog check on shared-db #4190; #294 nightly-window retry limit and
the failed first promotion run; #295 no-PR provenance and the unmeasured `cleared_count`
distribution) are recorded as gaps, not as satisfied evidence.
