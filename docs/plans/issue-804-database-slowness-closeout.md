---
summary: Issue #804 plan: close out the shared-database slowness behind PopSG and PopDAM — confirm search speed, settle the four never-measured leads, rank every cause, retire stale handoffs. Read its STATUS first.
kind: plan
status: open
read-when: implementing, resuming or closing issue #804 (shared database slowness, PopDAM/PopSG search speed, wasted database work)
---

# Plan: close out the database slowness behind PopSG and PopDAM (u2giants/popdam3#804)

Issue: https://github.com/u2giants/popdam3/issues/804
Handoff (registers this plan): [HANDOFF.d/2026-11-25T2056Z-al8960ofc-claude-804-plan.md](../../HANDOFF.d/2026-11-25T2056Z-al8960ofc-claude-804-plan.md)
Written 2026-11-25, 3:56 PM EST, by Claude (plan only; no fix implemented in this session).
Predecessor handoffs this plan absorbs (retired by Step 8):
[HANDOFF.d/2026-11-08T1346Z-hetz-zcode-706-804-search-closeout.md](../../HANDOFF.d/2026-11-08T1346Z-hetz-zcode-706-804-search-closeout.md),
[HANDOFF.d/2026-11-11T2134Z-hetz-claude-close-nested-db-waste.md](../../HANDOFF.d/2026-11-11T2134Z-hetz-claude-close-nested-db-waste.md).

## STATUS (read first — 2026-11-25 3:56 PM EST)

Start at **Step 1**. Every step below is still open; the "already done" table in §5 lists the work from Nov 5–22 that must NOT be redone.

| Step | What | State | Evidence |
|---|---|---|---|
| 1 | Two clean "Search test set" readings; confirm PopDAM + PopSG p95 ≤ 3 s; name the PopSG 64/65 misses | ⬜ open | last reading: run 45024815680 (Nov 22) — see §5 |
| 2 | Conditional: PopSG guides licensor-search speed fix (only if Step 1 misses 3 s) | ⬜ open | — |
| 3 | Re-measure cause 4: autovacuum of `public.dam_search_documents` | ⬜ open | never measured after Nov 5 |
| 4 | Re-measure cause 3 leftovers: `assets.division_code` updates, `style_guide_files` inserts, `hts_rag.hts_rag_rulings` updates, `count(*)` monitors | ⬜ open | never measured after Nov 5 |
| 5 | Fresh whole-database cost ranking (all apps); 24 h figures for realtime poll and prewarm job 13 | ⬜ open | last ranking Nov 11 (issue comment "Wasted-work hunt") |
| 6 | Tagging run (#680) database effect | ⬜ open | never measured |
| 7 | Live proof: photo indexing + uploaded-image search still work | ⬜ open | last proof Nov 5–10 |
| 8 | Final ranked before/after account on #804 and #706; retire the two predecessor handoffs; close #804 | ⬜ open | — |

---

## Part 1 — Why

### 1. The ultimate goal

POP Creations staff search two libraries every day: PopDAM (product artwork) and PopSG (licensor style guides). In early November 2026 both became slow — a typical PopDAM search took about 19 seconds instead of about 3, and picture indexing nearly stopped — because the one shared database behind them (and behind PopCRM, PopPIM/PLM, DesignFlow and the customs/HTS tool) was overloaded.

Albert, the owner, asked: *"fix everything causing the slowness if no one else is working on them."* Most of that is now done and measured. **What is left is to prove it stays fixed, close the four leads nobody ever re-checked, and hand Albert one honest ranked account of what caused the slowness and what each fix bought — then close the issue.**

When this plan is done:
- 95% of signed-in searches in both PopDAM and PopSG finish in under 3 seconds, in two clean readings, with accuracy at the judged level.
- Every original lead (causes 1–7, scope additions 8–11) is either fixed with before/after numbers, owned elsewhere with verified activity, or closed with an evidenced reason (for example "costs under 5 minutes of database time per day").
- Photo indexing and uploaded-picture search are proven to still work.
- Issue #804 carries a final ranked account and is closed; no stale #804 handoff remains.

**If a step conflicts with this goal, the goal wins — stop and flag it on #804.** In particular: no fix may remove or degrade a capability (search modes, indexes, live updates, indexing) to gain speed, and no fix may cost money (owner ruling 2026-11-10, §8).

### 2. What this application is

- **PopDAM** — repository `u2giants/popdam3`, live at https://dam.designflow.app. React web app (`src/`, deployed by Coolify), Supabase edge functions (`supabase/functions/`, deployed by GitHub Actions on merge to `main`), cloud worker (`apps/worker/`, Railway), GPU picture/text indexing worker (`apps/image-embed-worker/`, Windows machine `edge-dev`, scheduled task `PopDAM-ImageEmbedWorker`), text-embedding service (`apps/text-embed/`, `text-embed.designflow.app`).
- **PopSG** — the style-guide library, same repository, live at https://sg.designflow.app.
- **Search paths:** PopDAM search goes through edge function `dam-search-ai` ([supabase/functions/dam-search-ai/index.ts](../../supabase/functions/dam-search-ai/index.ts)) into database function `public.search_dam_documents`. PopSG goes through `popsg-query-embedding` ([supabase/functions/_shared/popsg-query-embedding.ts](../../supabase/functions/_shared/popsg-query-embedding.ts)) and database function `public.search_style_guide_library_v2`.
- **Shared database:** Supabase project `qsllyeztdwjgirsysgai` (Virginia, compute size Medium since Nov 5). Its structure lives in `popcre/shared-db` (the old name `u2giants/shared-db` redirects for URLs but not for `gh search`). Changes reach production only through that repository's automatic preview → production promotion, one migration version per train. This repository holds a read-only vendored copy at `shared-db/` — never edit it.
- **Search test set:** GitHub workflow "Search test set" ([.github/workflows/search-eval.yml](../../.github/workflows/search-eval.yml), manual dispatch, requires a `label` input) runs [scripts/search-eval/run.mjs](../../scripts/search-eval/run.mjs) against production as a signed-in viewer and uploads artifact `search-eval-report` (`report.json`). Current judged set: `set_version 2026-11-19-1037-artwork` — 137 PopDAM cases, 65 PopSG guide cases, 65 PopSG file cases. Method and pass rules: [docs/SEARCH_EVAL.md](../SEARCH_EVAL.md). Per-step timing: [scripts/search-eval/step-timing.mjs](../../scripts/search-eval/step-timing.mjs) (PopDAM steps come from the `Server-Timing` response header).

### 3. What triggered this work

Issue #804 was opened Nov 5, 2026 by Claude chat 6f863884 as a coordinator prompt listing seven suspected causes (1 memory/disk, 2 oversized PopSG picture index, 3 heavy recurring jobs, 4 long autovacuum of `dam_search_documents`, 5 one-at-a-time picture saves, 6 search speed itself, 7 release queue) plus a "Done when" list. Albert added scope items 8–11 (find unlisted causes across all apps; measure the whole-library tagging run #680; re-measure PopDAM search; rule in/out edge function, worker and connection-pool delays) and required "a ranked before-and-after account showing what share of the slowdown each fixed cause explained, and anything left unexplained."

Symptom on Nov 4–5: PopDAM typical search ~19 s (p50 18.6 s, p95 45 s, 53 errors); picture saves ~2.5 s each; indexing ~0.3/s overnight. Reproduce today by dispatching the Search test set (Step 1).

### 4. Scope

**In this plan:** Steps 1–8 above — readings, the four never-re-measured leads, one conditional PopSG speed fix, the tagging-run measurement, live proof of indexing and picture search, the final account, handoff retirement, and closing #804.

**NOT in this plan (owned elsewhere — link, never redo):**
- Indexing watchdog alarm and durable indexing runner → [plan_vector_consolidation.md](../../plan_vector_consolidation.md) Steps 1–2.
- `public.assets` bloat, repack, index audit → `popcre/shared-db` `plan_assets-bloat-permanent-fix.md` (#5747, closed) and the weekly bloat check `plan_db-anti-bloat-safeguards.md` (#5758, workflow `db-bloat-weekly.yml`, standing issue shared-db#5886).
- Unused-index removal → shared-db `plan_unused-index-cleanup.md` (#5610, done).
- Data API exposure and general efficiency → shared-db `plan_database_efficiency_and_api_security.md` (#2209).
- HTS customs-ruling search speed → shared-db `plan_hts-ruling-search-speed.md` (#5483).
- Running or finishing the tagging run itself → [docs/plans/issue-680-full-ai-tagging-run.md](issue-680-full-ai-tagging-run.md). Step 6 only *measures* its database effect.
- PopSG search **relevance** work (what results should appear) → issue #107 and [docs/plans/issue-107-popsg-trustworthy-library-open-gates.md](issue-107-popsg-trustworthy-library-open-gates.md). Step 1 only names any accuracy miss and routes it.
- Paid compute or disk upgrades — forbidden (§8, locked).
- Reducing realtime poll cost further by dropping DesignFlow schema copies — a separate cross-app change; Step 5 may record it as a lead only.

---

## Part 2 — What we already know

### 5. Current state (what is already done — do NOT redo)

All of the following is landed and verified live; evidence is the cited run, PR, migration, or #804 comment (comment text quoted in the issue thread under the stated heading/time).

| Item | Outcome | Evidence |
|---|---|---|
| Cause 1 memory/disk | Diagnosed as disk-operation cap at Small size (≈1,000 IOPS) plus 2 GB memory for 30 GB data. Albert upgraded to Medium ~12:19 PM EST Nov 5. Largest single gain: PopDAM p50 18.6 → 4.1 s. | #804 comments "Cause 1 settled…" and "Search test set after the Medium upgrade", run 42089911882 |
| Cause 2 picture index | `sg-hnsw-rebuild-706b` rebuilt the PopSG HNSW index 662 → 416 MB in production; selector starvation fixed by shared-db#5697; permanent no-starvation fix shared-db PR #6971 | #804 comment "Rebuild proof 1:29 PM EST"; shared-db `plan_index-maintenance-no-starvation.md` (status done) |
| Cause 3 (partly) | Three timeout loops repaired (shared-db#5726, live 5:15 PM EST Nov 5). Snapshot rebuild/crawl rewrite fixed (shared-db#6046 + popdam3 #944: 0 row updates per crawl, upsert 730 → 92 s). Prewarm every 15 → then 10 min (shared-db#6053, migration 20261113043850). 6-hour no-change rebuild removed. | #804 comments "Status 6:24 PM EST", "Crawl rewrite fix is live", "Task 4 — PopSG prewarm…", "post-step-4 reading" |
| Cause 5 batch save | Rejected with measurement (saves are index+disk bound; batch call projected +3%). Batch sizing PR 811 shipped. | #804 comment "Worker outage repaired 12:03 PM EST" |
| Cause 6 search speed | `public.assets` compacted (heap 2,024 → 196 MB, shared-db run 42151590867); exact-total shortcut (migration 20261106161604); batched query embedding (#867, #870); torch.compile (#875); flag-cover index (shared-db#6034); facet skip (shared-db#6038/#6040, popdam3 #941/#942); expand-query GIN prefilter (shared-db#6042); `live_files` not materialized (shared-db#6044); keyword leg indexable type (shared-db#6937, released Nov 21); full item-number path (#1061). **PopDAM 137/137, p50 1,054 ms, p95 2,348 ms** on Nov 22. | run 45024815680 artifact `search-eval-report`; shared-db#6871 closing comments |
| Cause 7 release queue | Holds 5732, 5690, 5722 fixed; per-change failure counting shared-db#5760 | #804 comment "Status 6:24 PM EST" |
| Scope 8 unlisted causes (first pass) | Nov 11 ranking found and fixed: realtime publication trim (shared-db#6052, −43%), PLM `item_number` index (shared-db#6049, 16.3 → 0.24 ms), library filter counts (popdam3 #954, ~2,610 s/day → ~3 min/day), HTS job-list poll (shared-db#6055 + designflow-backend#393, ~5,009 → ~42 s/day), realtime add-subscribed tables (shared-db#6095) | #804 comment "Wasted-work hunt" and the five task comments; HANDOFF.d/2026-11-11T2134Z… §3 |
| Scope 10 PopDAM search | Owned and finished on shared-db#6871 (closed Nov 22) | as cause 6 |
| Scope 11 app/network layers | Ruled out: auth ~200 ms, embed ~160 ms, network ~150 ms p95; database call dominates the tail | #804 comments "Per-step search timing" (6:45 PM Nov 10, midnight Nov 11), PR #929 (`Server-Timing`) |
| Indexing rate (Done-when) | Two non-overlapping 30-min readings 12,117 and 11,159 (~6.5/s); backlog drained Nov 10 after a 3.5-day silent worker stop; worker now self-restarting | #804 comments "Search test set after the Medium upgrade", "Indexing worker now restarts itself", "Scored set re-run after the indexing backlog emptied" |
| Handoff tasks 2–5 of 2026-11-11 | Done (shared-db PR 6095, PR 6108 + recovery run 43148104072, filter-count index declined with evidence, duplicate digest PRs closed) | #804 comments Nov 11 9:19 PM–10:41 PM EST and Nov 19 10:01 AM EST |

**Half-done (this plan finishes it):**
- PopSG guides speed: Nov 13 clean reading p95 **5,880 ms** (run 43386845973) after the 10-minute prewarm — over target. Nov 22 run 45024815680 read guides p95 **2,762 ms** (licensor kind p95 4,787 ms) and files 1,916 ms — under target, but it is one run and both PopSG legs passed **64/65**, not the 65/65 of Nov 11–13. → Step 1.
- 24-hour cost figures for the realtime poll and prewarm job 13 were promised on Nov 13 and never posted. → Step 5.

**Untouched since Nov 5:** cause 4 (autovacuum), the four cause-3 sub-items listed in Step 4, scope 9 (tagging run effect), Done-when proof of photo indexing and uploaded-image search.

No code for this plan exists on any branch. Nothing is deployed for it.

### 6. Key findings and root causes (established — reuse, do not rediscover)

- **Root condition:** the database was disk-operation-capped at Small size; memory misses consumed the operation budget. Medium upgrade explains most of the measured gain (Nov 5 account).
- **Dominant search cost after the upgrade:** `public.assets` heap was 10× its live data, so every visibility probe was a random disk read and evicted search indexes from the 1 GB buffer pool. Fixed by repack; the weekly bloat check now opens a governed repack PR if heap/live > 2.0.
- **Busy-hour load is NOT the cause** of the slow tail: night runs (3:00/3:45 AM EST Nov 11) were no faster. The tail lives inside the database search functions (cold reads).
- **Wasted background work** found by `pg_stat_statements` (stats reset 2026-11-06 11:20 AM EST at the time — check `extensions.pg_stat_statements_info.stats_reset` before every reading; it may have been reset since). Per-day = total ÷ days since reset.
- **Remaining biggest background cost known:** realtime `realtime.list_changes` poll ~4,400 s/day after the trim; the rest is the poll itself (WAL decode plus a catalog scan scaling with relation count), not removable by publication changes.
- **Handoff guesses were wrong twice** (PLM was a missing index, not the view's window; "assets paging" was per-entity counts). Always measure the real cause before designing a fix.
- **Readings are contaminated by:** a shared-db production apply or promotion, a PopSG crawl, a snapshot rebuild (`cron.job_run_details` jobid 12, `refresh-style-guide-library-default-snapshot`), another Search test set run, or an edge release within 5 minutes. Prewarm is job id **13** (`prewarm-style-guide-search`); do not confuse with job 12 (a mistake made on Nov 12).
- Run-to-run variance of end-to-end p95 on this system is large (2.9–5.5 s on one day). One run cannot prove or disprove a small change; two clean runs are the acceptance rule.

### 7. Approaches considered and REJECTED (do not retry)

- **Paid compute/disk upgrade beyond Medium** — forbidden by owner ruling 2026-11-10 (free fixes only).
- **Removing, quantizing or replacing the PopSG picture index** — forbidden by the #5616 plan and shared-db#1966.
- **Removing the picture index during backfill** — rejected under #5616/#1966.
- **Batch-save call for picture writes** — measured projection +3%; not built.
- **VACUUM FULL / CLUSTER on `public.assets`** — VACUUM FULL cannot run through the migration pipeline; CLUSTER holds ACCESS EXCLUSIVE for minutes. pg_repack was used instead.
- **Prewarming vector indexes / raising `work_mem`** — indexes don't fit the cache; no evidence of sort spills.
- **Restoring the old per-minute full-table sweep as a cache warmer** — it cost 1.5–10 s per minute; the covering index fixed the side effect instead.
- **Partial index on `public.assets (licensor_id, property_id)`** — declined Nov 19 with evidence (saving < 3 min/day).
- **Picture vectors for text search, semantic floor sweep, names+pictures combined** — dropped (slower, worse precision; see HANDOFF.d/2026-11-08… §4).
- **Accepting a speed reading that overlapped a production apply as a clean baseline** — only as "conservative proof"; Step 1 needs clean runs.
- **Declaring a change "in production" from a green run's commit** — wrong; promotion applies one version per train. Verify by the production migration ledger or the run title naming the PR.
- **Shipping a `DO`-block-only migration without a verification sidecar** — its post-apply verification failed and the lane retried it (shared-db#6056).

### 8. Design decisions

**Locked (do not relitigate):**
- 2026-11-10, Albert: speed fixes must be **free** — no compute/disk upgrades, no paid add-ons.
- 2026-11-10, Albert: don't wait for scheduled readings; measure at quiet hours and time steps directly.
- 2026-11-10, Albert: "Keep all five" — a PopSG character search lists the guide named for it first; guides that merely contain it stay listed after (docs/SEARCH_EVAL.md).
- 2026-11-06, Albert: "keep the ~half-second slower search" — `admin_config.POPSG_SEARCH_MODE` stays as it is; do not change it to gain speed.
- Target: p95 ≤ 3,000 ms per engine (PopDAM, PopSG guides, PopSG files) with all judged cases at their accepted pass level and 0 errors.
- Acceptance: two clean Search test set runs (clean = rule in §6).
- "Not worth fixing" threshold: a lead costing under ~5 minutes (300 s) of database time per day may be closed with evidence instead of fixed (used throughout Nov 11–19).
- Database structure changes only via `popcre/shared-db`, claim-first, automatic promotion; no manual production command.
- Reviews are advisory and never block a merge (owner rulings 2026-10-29/30).

**Open (implementer's judgment, criteria given in the step):**
- Which lever to use in Step 2 if PopSG guides still misses 3 s.
- Whether a Step 3/4/5 finding over the 300 s/day threshold is fixed here or routed to an owner with recent activity (rule: if an issue/PR on it had activity in the last 30 minutes it is owned; otherwise take it here on #804 if free and small, or open one issue in the owning repo).

---

## Part 3 — How to build it

Order: Steps 1, 3, 4, 5, 6, 7 are read-only and may run in any order, **except** no database reading may overlap a Search test set run, and no Search test set run may overlap a shared-db apply/promotion, crawl, or snapshot rebuild. Step 2 depends on Step 1. Step 8 depends on all others. Natural context cut point: after Step 7 (fresh session for Step 8 if the session is long; re-read Steps 8 and §13 first).

All database work below is **read-only on production** unless a step explicitly sends a change through shared-db. Before any production query, confirm the project ref is `qsllyeztdwjgirsysgai`.

### Step 1 — Two clean Search test set readings (`lead-only`: live-proof judgment and cleanliness check)

1. Check the window is clean: in `popcre/shared-db`, `gh run list -R popcre/shared-db -L 15` shows no running "DB production apply"/preview/promotion run; `cron.job_run_details` shows no jobid 12 run longer than 1 s in the last 15 minutes and none running; no PopSG crawl running (the newest row of `public.style_guide_crawl_runs` must not be in a running/reconciling lifecycle state — read its columns first with `\d public.style_guide_crawl_runs`; crawls are completed by `agent-api` action `complete-style-guide-crawl` in `supabase/functions/agent-api/`); no edge deploy run on `u2giants/popdam3` in the last 5 minutes (`gh run list -L 10`).
2. Dispatch: `gh workflow run search-eval.yml -f label=804-closeout-clean-1` on `main`. Wait with `ai-pr-wait`-style background waiting (`gh run watch <id>` in a background command), never a sleep loop.
3. After it finishes, re-check that nothing in item 1 started during its window. If something did, the run is diagnostic only; repeat.
4. Download: `gh run download <id> -n search-eval-report`, read `engines.<dam|sg_guides|sg_files>.overall` (`passed`, `total`, `p50`, `p95`, `errors`) and `by_kind`.
5. Repeat for `804-closeout-clean-2` at least 30 minutes later (different load).
6. For every failing case in the PopSG legs (Nov 22 showed 64/65 on both), find its id in `report.json` (per-case entries carry the case id and pass flag; inspect the structure with `node -e` — do not paste licensed query text into GitHub). Compare with run 42888083280 (Nov 10, 65/65). If the miss is a relevance change from later search work (e.g. #1037, set `2026-11-19-1037-artwork`), record the case id and route it with one signed comment on #107; it does not block #804 unless it is an error or timeout.

You'll know it worked when: two clean runs each show PopDAM 137/137, 0 errors, p95 ≤ 3,000 ms, and PopSG guides and files p95 ≤ 3,000 ms with 0 errors; their run ids and figures are posted on #804. If PopSG guides p95 > 3,000 ms in either clean run → Step 2. If PopDAM p95 > 3,000 ms → localize with `step-timing.mjs` (same sample) and post the stage split; the fix then belongs to a new shared-db issue (PopDAM ranking was last owned on shared-db#6871, now closed).

### Step 2 — Conditional PopSG guides speed fix (`lead-only`: changes a production search function)

Only if Step 1 misses for PopSG guides. The known slow kind is **licensor-wide** searches (Nov 22 licensor p95 4,787 ms; Nov 11 profile: "disney" guides 2.6 s warm after the facet skip, spending most time in entity aggregation and tag paging over ~95k matching files).

1. Profile read-only: `EXPLAIN (ANALYZE, BUFFERS)` of `public.search_style_guide_library_v2` for the three slowest licensor cases from Step 1, with `p_include_facets => false` (what the page sends). Read the function body from the latest migration that defines it in the vendored `shared-db/supabase/migrations/` (grep `search_style_guide_library_v2`).
2. Pick the cheapest lever that keeps output identical. Criteria: (a) identical ordered results and totals on all 65 guide cases + 65 file cases (diff before/after), (b) no new standing cost over 300 s/day (e.g. a precomputed per-guide entity aggregate refreshed by the existing snapshot job is acceptable if its refresh stays inside the change-signature rule), (c) free. Candidate named in the Nov 13 handoff: precompute entity aggregation and page tags for broad queries.
3. Load the `shared-db-change` skill; claim the exact objects on a `db-claim` issue in `popcre/shared-db`; one migration with a current-UTC version, a contract test, and (if statements sit in a `DO` block) a verification sidecar + catalog contract in the same PR; PR body names closing issue `u2giants/popdam3#804`. Merge; let the automatic promotion apply it; verify in the production ledger.
4. Repeat Step 1 (two clean runs).

You'll know it worked when: production ledger has the version; the identity diff shows 0 differences; two clean runs have guides p95 ≤ 3,000 ms.

### Step 3 — Cause 4: autovacuum of `public.dam_search_documents` (`helper-ok` for readings; lead judges)

Stop-and-ask trigger: any vacuum currently running > 30 minutes, any `n_dead_tup` > 20% of live rows, or any query result that would require a setting change — bring back to the lead, do not change anything.

1. Read: `select relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze, autovacuum_count, pg_size_pretty(pg_total_relation_size(relid)) from pg_stat_user_tables where relname in ('dam_search_documents','assets','style_guide_search_documents');`
2. Read `select * from pg_stat_progress_vacuum;` (anything running now, its phase and `index_vacuum_count`).
3. Duration history: Supabase logs (Logs Explorer, Postgres logs, filter `automatic vacuum of table "postgres.public.dam_search_documents"` — `log_autovacuum_min_duration` lines give elapsed time) for the last 7 days. If logs don't carry it, take two `last_autovacuum` readings 24 h apart plus `pg_stat_progress_vacuum` samples and state the bound.
4. Judge: closed with evidence if the last 7 days show no autovacuum on that table longer than 10 minutes and no lock-timeout failures attributed to it (search shared-db issues for "lock timeout dam_search_documents" since Nov 6). Otherwise find the cause (index count/size, `maintenance_work_mem`, dead-row backlog) and fix only through shared-db per Step 2.3, without cancelling a running vacuum (#5622 rule).

You'll know it worked when: one signed #804 comment states the 7-day max autovacuum duration for the table with its source, and the verdict.

### Step 4 — Cause 3 leftovers (`helper-ok` for readings; lead judges)

Stop-and-ask trigger: a statement over 300 s/day whose owner is unclear, or any result suggesting a write would help.

For each lead, find its statements in `extensions.pg_stat_statements` (`query ilike` patterns below), note `calls`, `total_exec_time`, `shared_blks_read`, and compute per-day since `stats_reset`:
- `update ... assets ... division_code` (`query ilike '%assets%division_code%'`).
- `insert into ... style_guide_files` (crawl path; expected small after shared-db#6046).
- `update ... hts_rag.hts_rag_rulings` (owner: HTS tool, `popcre/designflow-backend`; see shared-db `plan_hts-ruling-search-speed.md`).
- `select count(*) from ... style_guide_search_documents` (session monitors; #5622 health reporting was the intended replacement; `public.image_embed_status()` exists).

Judge each: ≤ 300 s/day → close with evidence. Over → if owned (activity in last 30 min on an issue/PR) post the figure there; if unowned and free, fix via shared-db (Step 2.3 process) or the owning app repo, measure before/after.

You'll know it worked when: one signed #804 comment lists the four leads with calls, per-day seconds, verdict, and (if fixed) before/after.

### Step 5 — Fresh whole-database ranking (`helper-ok` for the query; lead judges)

Stop-and-ask trigger: any new statement over 1,000 s/day, or any statement the helper cannot attribute to an app.

1. Record `stats_reset` and `now()`.
2. Top 25 by `total_exec_time` with per-day seconds, `calls`, mean ms, `shared_blks_read`, and role (`pg_roles.rolname` via `userid`).
3. Attribute each to its app (PopDAM, PopSG, PopCRM, PopPIM/PLM, DesignFlow sync, HTS, Supabase internals). Compare with the Nov 11 "Wasted-work hunt" list.
4. Specifically report 24 h figures for `realtime.list_changes` (expected ~4,400 s/day after trim) and the prewarm job **13** (from `cron.job_run_details where jobid = 13` over 24 h; expected ~3.5–5 s × 144 runs ≈ 500–720 s/day at the 10-minute schedule).
5. Every new item > 300 s/day: owned → note; unowned → fix free here (as Step 4) or open one issue in the owning repo with the evidence and name it on #804.

You'll know it worked when: one signed #804 comment carries the ranked top list (counts and statement shapes only — no licensed names, no row data), the two 24 h figures, and a disposition for every item > 300 s/day.

### Step 6 — Tagging run (#680) database effect (`lead-only`: needs judgment about whether the run is live)

1. Read #680's latest comments and `admin_config` keys it names (the plan [issue-680-full-ai-tagging-run.md](issue-680-full-ai-tagging-run.md) lists them) to learn whether the parallel tagging run (`ai-tag-parallel`) is running now.
2. If running: over a 30-minute window take before/after snapshots of `pg_stat_user_tables.n_tup_upd` for `public.assets` and `public.dam_search_documents`, and the `pg_stat_statements` rows for the worker role's asset tag updates; report writes/min, database seconds per hour, and the share of total database time. Note whether a Search test set run would overlap (it must not).
3. If not running: record its last state, and use the Nov 5 figure (660 asset updates in 10 minutes) as the only measurement, stating it is old.
4. Worker capacity: from Railway logs (`railway` MCP `get-logs` on the worker service) state whether tagging jobs delayed other job types in the window.

You'll know it worked when: one signed comment on #804 (cross-linked on #680) gives writes/min, database share, and a verdict "material / not material" against the 300 s/day threshold.

### Step 7 — Live proof: photo indexing and uploaded-image search (`lead-only`: live-proof judgment)

1. `select public.image_embed_status();` — `workers_fresh` true, pending near zero, errors 0. Two readings 30 minutes apart showing completed counts rising or backlog at 0.
2. As the production viewer tester (1Password `vibe_coding`, see §12), on https://dam.designflow.app run one uploaded-picture search (upload any non-licensed test image, e.g. a plain photo) and confirm results return with HTTP 200 within the page; record the response time from the browser network panel. Do not save screenshots of licensed art to GitHub.
3. On https://sg.designflow.app run one normal search to confirm PopSG works.

You'll know it worked when: one signed #804 comment states both readings, the uploaded-image search outcome and time, and the EST times.

### Step 8 — Final account, handoff retirement, closure (`lead-only`: writes the record of truth)

1. Write the final ranked account as a signed #804 comment: rows = each fixed cause (Medium upgrade; assets compaction; exact-total shortcut; batched embedding + torch.compile; the Nov 10–11 free fixes; keyword-leg indexable type; any Step 2 fix), each with the before/after reading that isolates it (cite run ids from §5) and the share of the 18.6 s → current p50 drop it explains where separable; say plainly which effects could not be separated (e.g. rebuild vs PR 811). Then "unexplained": anything Steps 1–7 left. Then the background-work table from Step 5.
2. Post a one-paragraph pointer on #706 (closed; comment is still allowed) with the final picture-save and search figures, as #804's Done-when requires.
3. In one PR on `u2giants/popdam3`: delete the two predecessor handoffs (paths at the top of this file) and this plan's own handoff `HANDOFF.d/2026-11-25T2056Z-al8960ofc-claude-804-plan.md`; set this plan's header `status: done` and fill the STATUS table with evidence; regenerate `docs/INDEX.md` (`ai-doc-health --repo . --fix-index` where available; otherwise edit the plan's row by hand to keep the index consistent).
4. Close #804 as completed with a final signed comment linking the account.

You'll know it worked when: #804 is closed with the account linked; `git ls-tree origin/main HANDOFF.d/` no longer lists the three files; INDEX shows the plan as done.

### 10. Tests required

No application code is planned. Tests apply only if Step 2 or a Step 3–5 fix lands:
- Shared-db migration: a SQL contract test in `popcre/shared-db` `supabase/tests/` asserting the changed function returns identical ordered results for a fixed probe set (pattern: existing `*_contract.sql` files there), plus that repository's required CI.
- Identity diff: before/after outputs for all 65 PopSG guide and 65 file cases (and all 137 PopDAM cases if a DAM function changes) — 0 differences.
- Existing suites that must stay green on any popdam3 PR: `node --test scripts/search-eval/*.test.mjs` and the repository's required checks on the PR.

### 11. Constraints, standing rules and gotchas

- Never push to protected `main`; branch, PR, merge it yourself once required checks pass (reviews advisory). Rebase if `main` moved.
- Database structure only through `popcre/shared-db` with the `shared-db-change` skill: claim first, current-UTC migration version, sidecar for `DO`-block migrations, automatic promotion only, no manual production SQL, no new files in this repo's `supabase/migrations/`, never edit vendored `shared-db/`.
- Production is read-only for readings; `admin_config` writes are application data but none are planned.
- Free fixes only; never remove a capability, index, search mode or live-update table for speed.
- Never score speed during a shared-db apply/promotion, a PopSG crawl, a snapshot rebuild (job 12), another scored run, or within 5 minutes of an edge release.
- Do not run two Search test set runs at once.
- Public GitHub posts: counts and IDs only — no licensed names, product codes, query text from the judged set, or row data.
- Sign every GitHub post `Posted by <tool> chat <session id> on <machine>`.
- All human-facing times in EST/EDT computed from the system clock (on Windows `TZ=` is ignored by `date`; use `node -e "console.log(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}))"`).
- Wait on runs and PRs with `ai-pr-wait <pr>` / background `gh run watch`, never a sleep loop (a hook blocks them).
- `pg_stat_statements` may have been reset since Nov 6: compute per-day only from the current `stats_reset`.
- A 30-minute stall on any wait is broken: re-route, don't report "still waiting" twice.

### 12. Access and environment

- `gh` authenticated as `u2giants` (covers `u2giants/popdam3` and `popcre/shared-db`).
- Production database `qsllyeztdwjgirsysgai`: Supabase MCP (read-only) or psql via pooler `aws-1-us-east-1.pooler.supabase.com:6543`, user `postgres.qsllyeztdwjgirsysgai`; password in 1Password vault `vibe_coding`, item "Supabase DB Password - shared POP database" — pass it through a chmod-600 file or `op_run`, never on a command line or in output.
- Viewer test login for live search: 1Password `vibe_coding`, the production viewer tester item described in [docs/1password.md](../1password.md); administrator tester: "DAM AI tester login - PopDAM (administrator, dam.designflow.app, production)".
- Railway worker logs: `railway` MCP (`get-logs`).
- `edge-dev` GPU worker: read-only evidence per [apps/image-embed-worker/README.md](../../apps/image-embed-worker/README.md).
- Nothing to serve locally.

---

## Part 4 — Landing it

### 13. Definition of done, risks, open questions

Done when every box is true:
- [ ] Step 1: two clean runs posted; all three engines p95 ≤ 3,000 ms, 0 errors, PopDAM 137/137; PopSG misses named and routed.
- [ ] Step 2: done, or recorded as not needed with the Step 1 run ids.
- [ ] Steps 3–6: each has its signed #804 comment with a verdict; every item over 300 s/day fixed (before/after) or routed to an owner with verified activity.
- [ ] Step 7: live proof posted.
- [ ] Step 8: ranked account on #804; pointer on #706; handoffs deleted and plan marked done in a merged PR with CI green; #804 closed.
- [ ] Any shared-db change: merged, in the production ledger, post-apply verification green.

Risks and rollback:
- A Step 2 function change could alter results → the identity diff gates the merge; rollback is a forward migration restoring the previous body (copy from the prior migration file).
- Readings can be contaminated without notice → the cleanliness check before and after each run; discard and repeat.
- Speed may regress later from new data volume → the weekly bloat check (shared-db#5886) and scheduled readings cover it; out of scope here.

Open questions (with deciding criteria):
- Are the PopSG 64/65 misses a relevance regression? Decide by comparing case results with run 42888083280; route to #107 if relevance, keep here only if error/timeout.
- Does the realtime poll (~4,400 s/day) warrant cross-app work? Only if Step 5 shows it is the top unexplained cost and a free change exists; otherwise record as the known residual.

## Lead launch prompt

```text
You are the lead session for u2giants/popdam3 issue #804 (shared-database slowness behind PopDAM and PopSG).
Read first, in order: AGENTS.md; docs/plans/issue-804-database-slowness-closeout.md (STATUS table first, then §1 goal, §5 done list, §7 rejected approaches, §8 locked decisions, §11 rules); the latest comments on issue #804.
Do NOT redo anything in §5. Free fixes only. Production is read-only except changes sent through popcre/shared-db with the shared-db-change skill.
You do Steps 1, 2, 6, 7 and 8 yourself (lead-only). Steps 3, 4 and 5 are helper-ok for the readings only: hand each to your helper with the exact queries from the plan, then judge the results yourself.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Delegation rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: return finished readings or an evidenced blocker; make no design decisions; no merges, no GitHub posts, no database writes; bring the result back when the step's stop-and-ask trigger fires; you take the step back if it is stuck 30 minutes.
Checks you run yourself: the cleanliness check before and after every Search test set run; every per-day figure recomputed from stats_reset; every verdict against the 300 s/day threshold; the final account's numbers against the cited run artifacts.
Order: Step 1 first (Step 2 only if it misses), Steps 3-7 in any order without overlapping a scored run, Step 8 last. Post signed evidence on #804 after each step and update the plan's STATUS table in your closing PR.
```

## Self-audit (implementation-plan-writer)

1. **Could a brand-new session execute this without asking anything?** Yes. §2 defines every system, repo, function, workflow and judged set; §5 gives the exact done/half-done state with run ids; §9 gives queries, commands, criteria and gates per step; §12 gives access by 1Password location. Gap found while drafting: the prewarm/snapshot job-id confusion and Windows `TZ` behaviour — both added (§6, §11).
2. **Does it carry all background, including what was ruled out?** Yes. §6 root causes and measurement traps; §7 lists every rejected approach from Nov 5–22 with reasons; §8 quotes the owner rulings with dates. Gap found: the "300 s/day" closure rule was implicit in comments — now locked in §8.
3. **Is the goal clear enough to steer by if a step is wrong?** Yes. §1 states the business outcome, the "goal wins" rule, and the two hard limits (no capability loss, no spending); §4 bounds scope so an implementer can tell a relevance problem (route to #107) from a speed problem (fix here).

Checklist: 13 sections present; goal first in plain English; rejected approaches present; every step has files/commands and a gate; every step marked lead-only/helper-ok with reason and helper stop-and-ask triggers; no trust-boundary input (no parser, money or outside files — adversarial table N/A); locked vs open labelled; out-of-scope list; tests named; secrets by location only; done includes PR/CI/production ledger; handoff link both ways.
