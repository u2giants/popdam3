---
issue: 804
status: OPEN
owner: claude/close-nested-search-speed
---

# Handoff — search is accurate and under 3 s; five wasted-database-work items carry forward

Written 2026-11-11 10:43 AM EST by Claude (hetz), closing a coordinator session
and its six nested sessions. Search accuracy and search speed work is
**finished and live**. This file carries only five follow-up items: background
database work that wastes time on the shared database. Retire this file when
the five tasks in section 6 are each fixed live or posted on
[issue 804](https://github.com/u2giants/popdam3/issues/804) with an evidenced
reason not to fix them. Issue 804 is the coordination record.

It replaces (successor rule) the predecessor
`HANDOFF.d/2026-11-10T2231Z-hetz-claude-close-nested-search-review-findings.md`,
deleted in the same PR: all three of its tasks are closed and verified, and its
settled decisions are copied into section 0 below.

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream needs the owner. Task 5 (the HTS job-list
poll) belongs to the HTS customs-classification app, not PopDAM. It is a
technical routing fact, not an owner question: the session that takes it
finds the owning repository itself (see task 5).

Already settled — do NOT re-ask:

- **2026-11-10, Albert: "Keep all five."** A character search in PopSG lists
  the guide named for that character first; guides that merely contain the
  character stay listed after it. The PopSG guides test checks order only
  ([docs/SEARCH_EVAL.md](https://github.com/u2giants/popdam3/blob/main/docs/SEARCH_EVAL.md)).
- **2026-11-10, Albert:** speed fixes must be **free** — no compute or disk
  upgrades, no paid add-ons.
- **2026-11-10, Albert:** don't wait for scheduled readings; measure at quiet
  hours and time each step directly. Done (section 3).
- **2026-11-10:** the empty-result retry is PopSG-only by design; PopDAM
  already had spelling and meaning matching.
- **2026-11-01:** DC and Harry Potter are properties of Warner, never licensors.
- **2026-10-29 / 2026-10-30:** reviews are advice only and never block a merge;
  only checks that stop production-data damage or secret leaks may block.

## 1. What this application is

PopDAM (`u2giants/popdam3`, live at https://dam.designflow.app) is POP
Creations' digital asset manager: designers search product artwork ("style
groups"). PopSG (https://sg.designflow.app, same repository) is the licensor
style-guide library. Both sit on one **shared** Supabase database (project
`qsllyeztdwjgirsysgai`, Virginia) that other POP apps also use (PLM/ColdLion
items, HTS customs classification). Database structure lives in
[`popcre/shared-db`](https://github.com/popcre/shared-db) and reaches production
only through that repository's automatic preview → production promotion.

Search runs as Supabase Edge Functions (not on the hetz server):
[`dam-search-ai`](https://github.com/u2giants/popdam3/blob/main/supabase/functions/dam-search-ai/index.ts)
calls the database function `search_dam_documents`; the PopSG page calls
`search_style_guide_library_v2` plus embedding, expansion and spelling calls.

## 2. What we set out to do, and why

1. Close three advisory review findings carried by the predecessor handoff
   (issues 883, 888, 897). Done.
2. Albert then asked about issue 804 (search slowness) and pushed to fix it
   now, at no extra cost: time every step of a search, ask Supabase's own
   assistant for free database optimizations, act on the verified advice,
   and remove wasted background work that competes with search.

## 3. Current state — what is true right now

### Landed and verified (each checked on GitHub by the coordinator)

| Work | PRs | Proof |
|---|---|---|
| Issue 888: PopSG guides scorer keeps must-find check, scoped to documented kinds | popdam3 [#921](https://github.com/u2giants/popdam3/pull/921) | issue closed; run 42918485260 on main 65/65 |
| Issue 883: empty-result retry regression test; finding 3 not a defect | popdam3 [#923](https://github.com/u2giants/popdam3/pull/923) | issue closed with dispositions |
| Issue 897: licensor aliases scope picture matches; test isolation | popdam3 [#924](https://github.com/u2giants/popdam3/pull/924), [#933](https://github.com/u2giants/popdam3/pull/933) | issue closed; 119/119 |
| shared-db 6024: picture-score anchor scoped to named licensor | shared-db [#6030](https://github.com/popcre/shared-db/pull/6030), [#6032](https://github.com/popcre/shared-db/pull/6032); popdam3 [#934](https://github.com/u2giants/popdam3/pull/934) | 60 licensor queries: 0 lose pictures (was 3); issue closed |
| Per-step search timing (`Server-Timing` header + `scripts/search-eval/step-timing.mjs`) | popdam3 [#929](https://github.com/u2giants/popdam3/pull/929) | tables on 804 (6:45 PM and 12:06 AM EST) |
| One-minute visibility sweep no longer scans 462 MB table | shared-db [#6029](https://github.com/popcre/shared-db/pull/6029) | 1.5–10 s → 26 ms per run |
| Covering index for DAM flag lookup | shared-db [#6034](https://github.com/popcre/shared-db/pull/6034) | cold flag step 4.7 s → 0.6 s |
| PopSG skips facets when the page doesn't need them | shared-db [#6038](https://github.com/popcre/shared-db/pull/6038), [#6040](https://github.com/popcre/shared-db/pull/6040); popdam3 [#941](https://github.com/u2giants/popdam3/pull/941), [#942](https://github.com/u2giants/popdam3/pull/942) | results identical on 12 samples |
| DAM query expansion word-array prefilter; PopSG `live_files` not materialized | shared-db [#6042](https://github.com/popcre/shared-db/pull/6042), [#6044](https://github.com/popcre/shared-db/pull/6044) | expansion output identical on all 119 queries |
| PopSG crawl no longer rewrites unchanged files | shared-db [#6046](https://github.com/popcre/shared-db/pull/6046); popdam3 [#944](https://github.com/u2giants/popdam3/pull/944) | crawl be6301fe: 0 rewrites (was 221,615), upsert 92 s (was ~730 s), snapshot rebuild skipped |

**Search numbers (accepted "Search test set" runs on main):**

| Run | PopDAM | p95 | PopSG guides | p95 | PopSG files | p95 |
|---|---|---|---|---|---|---|
| 42983579685 quiet night 3:00 AM EST Nov 11 (before fixes) | 119/119 | 3292 ms | 65/65 | 5496 ms | 65/65 | 4601 ms |
| [43024791481](https://github.com/u2giants/popdam3/actions/runs/43024791481) after fixes, Nov 11 morning | 119/119 | 2106 ms | 65/65 | 2901 ms | 65/65 | 2742 ms |

All three are under the 3 s target. Evidence comments on 804: 6785554856,
6787277737, 6794846984, 6796571339, 6795140608, 6799687206.

### Tree closed

| Session | Final state | Branch |
|---|---|---|
| Issue 883 (local_206d4d69…) | wrapped up | merged, deleted |
| Issue 888 (local_fff1c478…) | wrapped up | merged, deleted |
| Issue 897 (local_c5085142…) | wrapped up | merged, deleted |
| Search step timing (local_34829a2e…) | wrapped up 12:13 AM EST | PR 929 merged |
| Supabase advice / speed (local_00027500…) | wrapped up, CLOSE-NESTED REPORT received | merged, deleted; claims closed |
| shared-db 6024 (local_974437a4…) | wrapped up, report received | merged; claim released |
| Crawl rewrite / waste hunt (local_227fb78a…, started by Albert) | finished crawl fix; handed five items here | merged |

No claims or locks held. No child wrote its own HANDOFF.d file.

### Not started

The five tasks in section 6.

## 4. Everything we tried that did NOT work

- **"It's busy-hour load on the shared database."** The first theory, from
  run-to-run variance (2.9–5.5 s p95) and PopDAM/PopSG moving together.
  Quiet-night runs at 3:00 and 3:45 AM EST were **not** faster (3.3 s / 5.5 s),
  so it was wrong. The real cause was cold reads inside the search functions.
- **Fixing the sweep made search slower at first.** The old per-minute full
  scan of `dam_search_documents` had kept that table in the OS cache by
  accident; removing it exposed cold reads in the flag lookup (8,196 primary
  key lookups into wide rows carrying embeddings). The covering index (#6034)
  fixed the real problem. Don't "restore" the scan as a cache warmer.
- **Prewarming vector indexes / raising `work_mem`** (Supabase assistant
  advice): skipped. The indexes don't fit in 1 GB of cache, and nothing showed
  sorts spilling to disk.
- **"PopSG never sends a meaning vector"** (Supabase assistant): not a bug.
  `POPSG_SEARCH_MODE` uses the vector only for name expansion.
- **The 9:08 PM EST test run (p95 4.9 s)** overlapped a production index build.
  Never score speed during a shared-db rollout, crawl or snapshot rebuild.
- **Shared-db merge queue** rejects backdated migration version stamps; one PR
  had to be re-stamped after ejection.

## 5. Root causes and key findings

- Most search time was in the database functions, not the edge code or
  network (per-step tables on 804; network ~130 ms p95).
- Cold-cache reads of wide rows in `default_flag_state` were the main PopDAM
  cost; cold `expand_dam_search_queries` added ~3 s.
- PopSG broad queries (e.g. a large licensor matching 95k files) spread cost
  across children, entity aggregation, facets and page tags; skipping facets
  when unused was the free win. Remaining warm cost is ~1.7–2.4 s for the
  broadest queries (not started; under the 3 s bar).
- The PopSG crawl upsert rewrote every row on every crawl because
  `crawl_run_id` and `last_seen_at` always change, which then forced 65–128 s
  snapshot rebuilds. Fixed.
- `pg_stat_statements` stats were last reset 2026-11-06 11:20 AM EST; per-day
  costs in section 6 are computed from that baseline.

## 6. Open tasks — exact next steps

Five independent tasks; no dependency order; no shared database objects.
Common rules for all: free fixes only; structural DB changes go through
`popcre/shared-db` with the `shared-db-change` skill — claim on an issue,
migration version = current UTC at file creation (re-stamp if the merge queue
ejects it), a `-- derived-from: <version>` header when replacing a function an
earlier migration defined, automatic preview → production promotion (a
`review-finding` issue holds promotion: resolve or close it with evidence,
then dispatch `automatic-production-trigger.yml`). App code goes through its
own repository's PR. Measure per-day cost from `pg_stat_statements` before and
after; post evidence on [issue 804](https://github.com/u2giants/popdam3/issues/804)
(read comment 6795140608 first). Finish with a "Search test set" run on main
(label input required): accuracy must stay PopDAM 119/119, PopSG 65/65 guides
and 65/65 files.

### Task 1 — Realtime change polling (~7,760 s/day)

- **State:** `realtime.list_changes` runs 953k times at 39 ms each.
- **Next action:** audit the `supabase_realtime` publication's tables and which
  apps actually subscribe (search app code across POP repos for
  `.channel(` / `postgres_changes`). Drop tables nobody listens to. Never
  remove a live subscription feature.
- **Done when:** publication trimmed via shared-db PR, per-day cost measured
  lower, every remaining live feature still receives updates (check in the app).
- **Resume from:** fresh from `main` of `popcre/shared-db`.

### Task 2 — PLM item list view (~2,420 s/day)

- **State:** `api.plm_item_list` lookups; `plm.item` shows 716k sequential
  scans and 12.4 B rows read. The view's `row_number() over (partition by
  item_number)` across all ColdLion items blocks index use.
- **Next action:** rewrite the view so filters push down, with identical output
  (diff a sample of results before/after).
- **Done when:** merged and promoted; per-day cost and seq scans drop; output
  identical on the diffed sample.
- **Resume from:** fresh from `main` of `popcre/shared-db`.

### Task 3 — Assets paging by property / licensor (~2,610 s/day)

- **State:** `public.assets` id paging by `property_id` / `licensor_id` with
  LIMIT/OFFSET; the licensor variant takes ~987 ms per call.
- **Next action:** find the caller (likely popdam3 code or a worker), switch it
  to keyset paging, add indexes if missing.
- **Done when:** caller and any index merged and live; per-call time and
  per-day cost drop; the feature that pages still returns every row.
- **Resume from:** fresh from `main`.

### Task 4 — PopSG prewarm cron and snapshot staleness (~1,040 s/day + ~260 s/day)

- **State:** `prewarm-style-guide-search` runs every 5 minutes on purpose to
  keep PopSG warm. Separately, `refresh_style_guide_library_default_snapshot`
  still rebuilds every 6 hours with no change (~65 s × 4/day).
- **Next action:** keep the warming capability; test a longer interval now that
  crawl churn is gone, measuring PopSG p95 before and after (only when no
  crawl or rebuild is running). Make the snapshot rebuild rely on the change
  signature alone instead of the 6-hour staleness rule.
- **Done when:** both changes live, database time drops, PopSG guides p95
  stays under 3 s on an accepted run.
- **Resume from:** fresh from `main` of `popcre/shared-db`.

### Task 5 — HTS classification job-list poll (~5,000 s/day) — owner: the HTS app, not PopDAM

- **State:** a poll query (`WITH stamp …` over
  `hts_rag.hts_rag_classification_jobs`) window-ranks the whole jobs table on
  every poll, 4.2–4.6 s per call.
- **Next action:** find the app that polls it (search POP repositories for
  `hts_rag_classification_jobs`; the HTS customs-classification app). Make it
  read only the latest turn per determination (index or a maintained latest
  flag) and/or poll less often. Database part via shared-db; app part in the
  HTS app's repository.
- **Done when:** per-call time well under 1 s, per-day cost measured lower,
  HTS job list in that app still shows the same jobs.
- **Resume from:** fresh from `main` of the owning repositories.

## 7. Constraints and gotchas in force

- Never push to `main`; branch, PR, merge it yourself. Reviews are advice only.
- Licensed names, product codes and file IDs never go in public issues or
  reports — case IDs and counts only.
- Database structure changes only through `popcre/shared-db` and its automatic
  promotion; no manual production command.
- Never score speed while a shared-db rollout, PopSG crawl or snapshot rebuild
  is running — readings are contaminated.
- Do not disturb scheduled readings on shared-db issue 5747 (Nov 12, 9:47 PM
  EST, and Nov 18).
- Wait on PRs with `bin/ai-pr-wait`, never hand-written loops (a hook blocks
  them).
- Sign everything posted to GitHub with `$AI_GH_SIGNATURE`.

## 8. Access and environment

- Machine `hetz`; `gh` authenticated as `u2giants`.
- Live database: Supabase project `qsllyeztdwjgirsysgai` (read-only by default).
- Secrets: 1Password vault `vibe_coding` — search tester login, publishable
  key, database password; values never in chat or files.
- Workflow "Search test set":
  [search-eval.yml](https://github.com/u2giants/popdam3/blob/main/.github/workflows/search-eval.yml);
  per-step timing script:
  [step-timing.mjs](https://github.com/u2giants/popdam3/blob/main/scripts/search-eval/step-timing.mjs).
- Governing plan:
  [plan_vector_consolidation.md](https://github.com/u2giants/popdam3/blob/main/plan_vector_consolidation.md).

## 9. Open questions and risks

- PopSG guides p95 is 2,901 ms, just under the 3 s bar; one noisy run could
  exceed it. Next free candidate if needed: precompute entity aggregation and
  page tags for broad queries (~1.7–2.4 s warm). Not started.
- `dam_search_keys` word indexes add write cost; not measured.
- Search-eval workflow still carries a one-shot schedule for Nov 12; remove it
  after that reading runs (per the comment in the file).

## Self-audit (handoff-writer)

1. Newcomer can continue: yes — §1 app, §3 state with PRs and runs, §6 cold tasks.
2. As effective as me: yes — §4 dead ends, §5 findings, §7 traps.
3. Every detail: yes — goals §2, failures §4, decisions §0/§9, gates in §6.
4. Owner decisions: swept §1–§9; none need Albert; HTS ownership is technical
   routing (§0 note).
