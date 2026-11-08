# Plan: permanently shrink `public.assets` and keep it small (popcre/shared-db#5747)

Owning issue: [popcre/shared-db#5747](https://github.com/popcre/shared-db/issues/5747). Parent need: [u2giants/popdam3#804](https://github.com/u2giants/popdam3/issues/804) cause 6 (search latency).
Handoff for this plan: [HANDOFF.d/20261105T1950Z-edge-dev3-claude-assets-bloat-plan.md](HANDOFF.d/20261105T1950Z-edge-dev3-claude-assets-bloat-plan.md).
Related plans (read their STATUS, do not redo): [plan_assets-update-trigger-scoping.md](plan_assets-update-trigger-scoping.md) (#5609, trigger fan-out on `assets` updates — delivered, 24 h live proof pending), [plan_database_efficiency_and_api_security.md](plan_database_efficiency_and_api_security.md) (#2196 fillfactor work owns `dam_search_documents` only).

## STATUS (updated 2026-11-07 9:20 PM EST — Steps 0, 1, 4 done; Step 5 done: broad search under 3 s; Step 7 24 h reading OVERDUE, 7-day reading due)

| Step | State | Evidence |
|---|---|---|
| 0 Baseline measurement (pgstattuple, visibility map, index sizes, writer churn) | ✅ done 6:35 PM EST Nov 5 | `docs/verification/assets-bloat-5747/20261105T2331Z/baseline.md` (PR #5800); pgstattuple/pg_visibility not installed, live bytes via `sum(pg_column_size)` |
| 1 Land repack capability (PR #5744) | ✅ done 9:05 PM EST Nov 5 | #5744 + review fixes #5775 merged; pg_repack 1.5.2 live on production (preview run 42147162525, production run 42147611207 — applied; its red 'log verification' is a catalog-lexer gap for `create extension`) |
| 2 Find and stop no-op writers in PopDAM | ✅ done 2026-11-06 5:39 AM EST | App: u2giants/popdam3#825 (deployed 7:08 PM EST Nov 5; closes #753): ingest no-op rewrites −97%; `division_code` was the same PATCH. DB: migration 20261106072548 (PR #5855, production 4:39 AM EST Nov 6; supersedes preview-only 040512/062730), statement-level `asset_tags` sync + IS DISTINCT FROM. `assets` updates 23,442/h → 3,377/h (−86%). HOT ratio fell to 0% because the remaining writes change GIN-indexed `tags`; the HOT criterion is not meaningful once no-ops are gone (recorded on #5747). `last_seen_at` advances only on real change (flagged). |
| 3 Index audit on `assets` | 🟡 audit recorded, no drops yet | [index-audit.md](docs/verification/assets-bloat-5747/20261105T2345Z/index-audit.md): 46 indexes, 28 with zero scans since the 2026-11-04 reset; re-check on or after 2026-11-18 EST |
| 4 Activate repack: preview, then production | ✅ done 9:47 PM EST Nov 5 | activation #5757; preview run 42150067190, production run 42151590867; heap 2,024 → 196 MB, indexes 1,345 → 335 MB, index/constraint/trigger/ACL counts unchanged; Search test set pass counts held (PopDAM 108 → 112) |
| 5 Make the exact total count cheap (exact stays exact) | ✅ done 2026-11-07 7:30 PM EST: broad search typical 2.5–2.7 s, 118/119, totals exact | `20261106095531` (PR #5866; preview run 42203340598, production run 42203856132); contract tests `supabase/tests/dam_search_exact_total_contracts.sql` + two-session race on preview; 500/500 preview equivalence; count stage 2–4x faster (disney 7.3 s → 1.9 s in-database); Search test set run u2giants/popdam3 42208393374: 113/119, typical 2.86 s, character p95 7.8 s. **Superseded 2026-11-07:** the stage profile named the visibility-probe chain (~1.0 s of the 2.4 s body) as the biggest remaining cost; migration `20261106161604` (PR #5891, claim #5883) skips that probe when the unfiltered flag count already proves truncation (fast path = forced probe on 5/5 broad queries; pages/totals identical). Search test set after: u2giants/popdam3 42428453523 / 42429205132 → 118/119, character p50 2.5–3.0 s, licensor 2.7 s. Judged-set `expected_total` values for seven misspelling cases re-baselined (stale pre-semantic-floor snapshots; relevance untouched — table on #5747). Predecessors 060723/064511/092127 retired (#5850, #5863). Results comments on #5747 (6:30 AM EST Nov 6; stage profile and final results Nov 7) |
| 6 Re-bloat monitor | 🟡 built; done when the dispatch dry run posts on #5747 | job `assets-bloat` in `.github/workflows/migration-ledger-drift.yml`, `scripts/assets-bloat-monitor.mjs` (2026-11-05 reading: heap 2,024 MB vs 188 MB live, ratio 10.8) |
| 7 After-measurement and live proof | 🟡 immediate reading done 9:56 PM EST Nov 5; **24 h reading OVERDUE since 9:47 PM EST Nov 6** | `docs/verification/assets-bloat-5747/20261105T2331Z/after.md`; 24 h reading was due 9:47 PM EST Nov 6 (not yet run as of 9:20 PM EST Nov 7), 7-day reading due 9:47 PM EST Nov 12 (note on #5747). Correction 2026-11-07: "PopDAM latency not yet improved on the first cold-cache run" is superseded — latency is now under 3 s (Step 5 row) |

**Fresh session starts at:** Step 7 24-hour reading (OVERDUE — repeat `after.md` queries into `after-24h.md`, rerun the Search test set). Steps 2, 3, 6 belong to sibling sessions; Step 5 finished 2026-11-07.

## 1. Ultimate goal

PopDAM search must answer in under 3 seconds, and the shared database must stop wasting memory on empty space. Today the PopDAM file catalogue table (`public.assets`) occupies about 2 GB on disk for about 0.2 GB of real data. Every broad search reads thousands of mostly-empty pages from disk, and that table crowds the search indexes of every app out of the database's 1 GB of cache. Done means: the table is compact, it **stays** compact (the writers that keep spreading it out are fixed), and broad searches are no longer disk-bound — **with every search result and every exact total unchanged**. Albert ruled on 2026-10-29 that search totals must be exact ("I don't want estimates, i want precise numbers only"; see `supabase/migrations/20261030224046_dam_search_exact_totals.sql:2-3`). **If a step conflicts with this goal, the goal wins — stop and flag it on popcre/shared-db#5747.**

## 2. The application

- `popcre/shared-db` owns the shared Supabase Postgres used by DesignFlow, PopDAM, PIM and CRM. Production project ref `qsllyeztdwjgirsysgai` (Medium compute: 4 GB RAM, 1 GB shared buffers). Schema changes are SQL migrations under `supabase/migrations/` and reach production **only** through the automatic promotion workflow `.github/workflows/shared-supabase-migrations.yml` (preview rehearsal, tests, no open `review-finding` issue; owner ruling 2026-10-29 in `docs/owner-rulings.md`). Non-transactional maintenance (index rebuilds, and after PR #5744 table repacks) runs through the same workflow's maintenance route, driven by `config/nontransactional-index-maintenance.json` and `scripts/nontransactional_index_maintenance.py`. No manual production command, ever.
- `public.assets` (~152k live rows, 46 indexes (production, 2026-11-05), primary key `assets_pkey (id)`) is PopDAM's file catalogue. PopDAM lives in `u2giants/popdam3` (local clone `/home/ahazan/repos/popdam3`). Writers include the `agent-api` edge function (`supabase/functions/agent-api/index.ts`, NAS scan ingest), the worker (`apps/worker/src/handlers/ai-tagging*.ts`, AI tag results), and SKU/division assignment code.
- DAM search is the SQL function `public.search_dam_documents` (latest body: newest migration that redefines it; exact-total logic introduced in `20261030224046_dam_search_exact_totals.sql`, CTE `exact_docs`).

## 3. What triggered this work

u2giants/popdam3#804 cause 6. Read-only production `EXPLAIN (ANALYZE, BUFFERS)` at ~2:30 PM EST 2026-11-05 on a broad one-word search (~32k candidate documents): 41 s total, of which **26.5 s** was the `exact_docs` visibility probe — one `assets` heap fetch per candidate, 0.46 ms/row, 21.8k disk reads per 30k probes. Search test set run https://github.com/u2giants/popdam3/actions/runs/42089911882: PopDAM typical 4.1 s, slowest 7.9 s; character 12.1 s, product 11.3 s. Target 3 s.

Size evidence (issue #5747): heap 2,024 MB, live row bytes 184 MB, indexes 1,328 MB, TOAST 127 MB, dead rows only 4,772 after a same-day autovacuum. Live rows sit on 81,814 of 259,072 pages. The same 2,024 MB was recorded on 2026-08-30 (`docs/verification/workflow-refactor-source-inventory-20260928.md:96`), so the bloat is chronic.

## 4. Scope

In:
- Baseline/after measurement (read-only).
- Activating the PR #5744 repack route for `public.assets` (activation PR only; capability is PR #5744).
- Writer-side "send only changed fields / skip unchanged rows" fixes in `u2giants/popdam3` (filed and tracked there; implemented there).
- Evidence-based drop of provably unused `assets` indexes (one migration).
- A shared-db migration that makes the exact total count in `search_dam_documents` stop touching the `assets` heap per candidate, while staying exact.
- A re-bloat monitor (scheduled read-only check that opens/updates an issue on threshold breach).

NOT in this plan:
- Building the repack capability itself (PR #5744 owns it).
- Trigger scoping on `assets` (#5609 / `plan_assets-update-trigger-scoping.md`, delivered).
- FTS query deduplication (#5731), HNSW semantic-leg caching (separate cause in #804), compute upgrade.
- Any estimated, capped or "10,000+" totals (owner ruling; see §7).
- `fillfactor` on `assets` (rejected; see §7). `dam_search_documents` fillfactor stays with #2196.
- Autovacuum reloption tuning (mitigation only; separate decision if Step 6 shows it is needed).

## 5. Current state

- Nothing from this plan is executed.
- PR popcre/shared-db#5744 (OPEN, 2026-11-05): migration `20261105192654_install_pg_repack.sql` (installs extension 1.5.2, revokes `repack` schema from public/anon/authenticated), new `table-repack/v1` maintenance kind in `scripts/table_repack_maintenance.py` (allowlist `public.assets` only, sha256-pinned PGDG 1.5.2 client, `--no-kill-backend`, refuses on leftover repack objects, wrong version, or changed index/trigger/constraint/ACL counts; preview first; production needs the preview completion receipt). Its body says activation is a **separate PR** after the extension is live. Claim issue #5742, work issue #5745.
- #5609 trigger scoping is merged and promoted (migration `20261105033827`); its 24 h live proof is pending. It removed no-op trigger fan-out but **not** the no-op row writes themselves.
- u2giants/popdam3#753 "agent-api ingest: send only changed asset fields" is OPEN (not implemented).
- `search_dam_documents` computes `total_count` from `exact_docs`: for each candidate document, `EXISTS (... assets ... visible ... LIMIT 1)`.

## 6. Key findings

- F1 Bloat is free space, not dead tuples (4,772 dead vs ~259k pages). Autovacuum cannot shrink the file; only a rewrite (VACUUM FULL / CLUSTER / pg_repack) can.
- F2 The bloat engine is non-HOT updates: ~43-53% HOT (`plan_assets-update-trigger-scoping.md:37-39`; #1966 inventory). Non-HOT updates write a new row version on a new page and an entry in every one of the 46 indexes. `division_code` is indexed (`20261008041231_assets_sku_division_index`), so updates that touch it are never HOT.
- F3 Many updates are no-ops: scan PATCHes rewrite ~30 columns even when only `last_seen_at`/`updated_at` changed (`plan_assets-update-trigger-scoping.md` §3). `division_code` updates: 43,047 calls on 2026-11-05 (per #5747); the writer is not yet identified.
- F4 Expected gain from repack alone: ~6x fewer pages, but at ~0.8 ms per disk read the 26.5 s count probably lands near 4-5 s, not under 3 s. Hence Step 5.
- F5 After compaction the heap (~260 MB) fits in the 1 GB cache, which also stops it evicting search indexes for other apps.

## 7. Approaches rejected, and why

- **VACUUM FULL**: cannot run through the migration pipeline (non-transactional; issue-611 Q4) and takes ACCESS EXCLUSIVE for minutes.
- **CLUSTER**: runs, but ACCESS EXCLUSIVE on a 46-index table for minutes blocks search and the ongoing AI tagging run (7.7-day run).
- **Capped ("10,000+") or estimated totals**: owner ruling 2026-10-29, `20261030224046_dam_search_exact_totals.sql:2-3`. Rejected outright; do not reopen.
- **`suppress_redundant_updates_trigger`**: zero effect — every scan changes `last_seen_at`/`updated_at` (`plan_assets-update-trigger-scoping.md:83,97`).
- **`fillfactor` 80-90 on `assets`**: HOT is blocked by indexed-column changes, not page fullness; already rejected in `plan_database_efficiency_and_api_security.md:118,150`.
- **Repack by hand from a laptop**: forbidden (no manual production commands); use the governed route.

## 8. Decisions

Locked (2026-11-05): repack via PR #5744 route only; exact totals stay exact; no fillfactor on `assets`; writer fixes land in `u2giants/popdam3`, not as database triggers that hide writes.
Open (implementer's judgment, criteria given in the step): which indexes to drop (Step 3); how exactly to make the exact count cheap (Step 5 options); monitor thresholds (Step 6).

## 9. Steps

Phase A — measure and prepare (one session).

**Step 0 — Baseline (read-only, production and preview).** Read-only inspection is open to every session (AGENTS.md §0.0-A). Use the Supabase MCP `execute_sql` tool against production (SELECT/EXPLAIN only; `EXPLAIN ANALYZE` only on the read-only search function). If `pgstattuple` / `pg_visibility` are not installed, use `pgstattuple_approx` only if present, else record `live bytes = sum(pg_column_size(a.*))` and `relpages` and say so. Record in `docs/verification/assets-bloat-5747/<UTC>/baseline.md`:
- `pgstattuple_approx('public.assets')` (or `pgstattuple` if allowed): table_len, tuple_percent, free_percent.
- `pg_relation_size`, `pg_indexes_size`, `pg_total_relation_size`, TOAST size; per-index size, `idx_scan`, `pg_stat_user_indexes` reset time.
- `pg_visibility_map_summary('public.assets')` (all_visible pages).
- `pg_stat_user_tables` n_tup_upd, n_tup_hot_upd, n_dead_tup, last_autovacuum.
- `pg_stat_statements` top UPDATE statements on `assets`: `select queryid, calls, rows, wal_bytes, left(query,300) from extensions.pg_stat_statements where query ilike 'update%public.assets%' or query ilike 'update "public"."assets"%' order by wal_bytes desc limit 20;` plus `stats_reset` from `pg_stat_statements_info`.
- `pg_stat_user_indexes.idx_scan` per `assets` index and the stats reset time (`pg_stat_database.stats_reset`).
- The broad-search `EXPLAIN (ANALYZE, BUFFERS)` from #804 (same query text), and a Search test set run in popdam3.
Done when: the file exists with every value and its query text, all times in EST.

**Step 1 — Repack capability (watch, do not build).** PR #5744 must merge and its install migration promote. Its files (`scripts/table_repack_maintenance.py`, `supabase/migrations/20261105192654_install_pg_repack.sql`, `docs/app-migration-notes/popdam-assets-repack.md`, the `table-repack/v1` kind) exist **only on that PR's branch** until it merges; on `main` the config has only `sg-hnsw-rebuild-706b`. If the PR is closed unmerged, stop Steps 1 and 4 and post a `Blocked —` note on #5747 naming why; do not rebuild the capability inside this plan. If PR #5744 has had no progress for 30 minutes and its owner is unresponsive, take it over on that PR per standing rules. Done when: `select extversion from pg_extension where extname='pg_repack'` returns `1.5.2` on production.

**Step 2 — Stop no-op writes (cross-repo).** Using Step 0's statement list, identify each writer that updates `assets` with unchanged values: at least (a) the `agent-api` ingest PATCH (popdam3#753), (b) the `division_code` updater (find via queryid text and `git grep -n "division_code"` across `apps/` and `supabase/functions/`), (c) AI tag result writes in `apps/worker/src/handlers/ai-tagging*.ts`. Required behavior: send only fields whose value differs; skip the update entirely when nothing but bookkeeping timestamps would change; bulk SQL updaters add `WHERE col IS DISTINCT FROM new_value`. If `last_seen_at` must still advance on every scan, record that as a business need and move it off `assets` only via a separate shared-db claim (out of scope here; flag it). Implement in `u2giants/popdam3` on its own issues (reuse #753; open one per other writer). Done when: each writer's PR is merged and deployed there, and over a ≥ 1-hour window (two Step-0 statement snapshots, diff `calls`/`rows`/`wal_bytes` per queryid) `n_tup_hot_upd / n_tup_upd` on `assets` rises and the no-op statements' row counts drop by ≥ 80% versus baseline.

**Step 3 — Index audit.** For each `assets` index: size, `idx_scan` since the last stats reset (counters were reset 2026-11-04, so the 14-day window opens 2026-11-18 EST at the earliest; record the actual reset time; if fewer than 14 days are available, drop nothing and re-check later — do not substitute another gate), and whether any function/view/RLS policy/app query needs it (`git grep` index columns across shared-db functions and popdam3). Drop only indexes with zero scans over ≥ 14 days AND no constraint role AND no code reference; write them in one migration with a `-- evidence:` comment per index. Done when: the migration promotes, or the audit doc records "no safe drops".
*Cut point.*

Phase B — compact and speed up (new session; re-read this STATUS).

**Step 4 — Activate repack.** Separate activation PR adding the `public.assets` entry to `config/nontransactional-index-maintenance.json` per PR #5744's doc `docs/app-migration-notes/popdam-assets-repack.md`. Preconditions: Step 1 done; free disk check right before (Supabase dashboard disk usage or `select pg_database_size(current_database())` against the plan's disk size; require free ≥ heap + indexes + 1 GB ≈ 4.5 GB); no other maintenance run active. Step 2 is **not** a precondition (decoupled 2026-11-05 after Muse review: blocking on a cross-repo deploy could stall compaction indefinitely). Instead, if Step 2 has not landed, record the re-bloat rate from Step 6 and plan one more repack after Step 2 lands. Preview first; production after the preview receipt. Done when: production heap ≤ 400 MB, index/trigger/constraint/ACL counts unchanged, and the Search test set pass count is unchanged.

**Step 5 — Exact count without per-candidate heap visits.** First re-measure the count stage after Step 4; if it is already < 1 s with total < 3 s, mark this step N/A with that evidence. Otherwise the `exact_docs` CTE (in `20261030224046_dam_search_exact_totals.sql:341-374`, check for any later redefinition) calls `dam_asset_matches_filters` with ~27 `assets`/`style_groups` columns plus the request's filters `v.f`, so a single precomputed flag cannot cover filtered queries. Default design: an **unfiltered fast path** — when `v.f` has no filters, count documents using a maintained boolean `dam_search_documents.has_default_visible_member` (true when ≥ 1 non-deleted member asset passes `dam_asset_matches_filters` with empty filters), kept current inside the existing asset→document refresh function (`public.refresh_dam_search_asset_document(uuid)` and the style-group equivalent), with a one-time backfill in the same migration; filtered queries keep the existing probe (they are narrower and benefit from the compacted heap). Claim first on #5747: `search_dam_documents`, `dam_search_documents` (new column), the refresh functions. Land after #5731 (same function) or rebase onto it. Write amplification check: the flag must only be written when its value changes. **Staleness trap (Muse, 2026-11-05):** "empty filters" still applies a visibility rule — `not is_deleted and (modified_at >= min_date or file_created_at >= min_date or thumbnail_url is not null)`, where `min_date` comes from `public.assets_thumbnail_min_date()` reading `admin_config.THUMBNAIL_MIN_DATE` (`20261030224046_dam_search_exact_totals.sql:101-102`, `20260830110517:203-214`). So store alongside the flag the `min_date` it was computed with (`has_default_visible_member_min_date`); the fast path is used only when that equals the current `assets_thumbnail_min_date()`, otherwise fall back to the probe; and an AFTER trigger on `admin_config` changes to that key enqueues a recompute of all flags. Flag must also be recomputed on member move/delete (style_group_id, is_deleted, modified_at, file_created_at, thumbnail_url changes) **synchronously, in the same transaction as the asset write** (row-level AFTER trigger scoped with `UPDATE OF` those columns, both old and new style group) — never via a queue or worker, or the fast path could return a wrong exact total during the lag. The `admin_config` recompute may be asynchronous only because the `min_date` equality guard already forces the probe for every unrecomputed flag the instant the setting changes. Add a contract test: delete the only visible member and run the unfiltered count in the same transaction → total drops by one. Must stay exact for every visibility rule the current `EXISTS` predicate applies (deleted, permissions, filters via `dam_asset_matches_filters`). Coordinate with #5731 (same function) — land after it or rebase onto it. Judgment criterion: choose the design whose count equals the current count on every Search test set query and on a randomized 500-query equivalence check in preview. Done when: broad-search count stage < 1 s in EXPLAIN on production and total broad search < 3 s.

**Step 6 — Re-bloat monitor.** Prefer extending an existing scheduled read-only workflow (candidates: `.github/workflows/migration-ledger-drift.yml`); if none fits, add `.github/workflows/assets-bloat-monitor.yml` with owner = shared-db maintainers, retirement = delete after 60 days of in-threshold readings with a note on #5747. It that reads heap size vs live tuple bytes for `assets` daily and comments on #5747 (or a successor issue named in this plan) when the ratio exceeds 2.0 or HOT ratio < 70% over 7 days. Done when: a dry run posts a correct reading.

**Step 7 — After-measurement and live proof.** Repeat Step 0 into `.../after.md` 24 h after Step 4 and again 7 days later. Done when all §13 checks pass.

## 10. Tests

- Step 3: existing contract suites under `supabase/tests/` stay green; add `supabase/tests/assets_index_drop_contracts.sql` asserting the dropped indexes are absent and constraint-backing indexes remain.
- Step 5: new `supabase/tests/dam_search_exact_total_contracts.sql`: THUMBNAIL_MIN_DATE changed → totals still equal the probe; thumbnail-null old asset not counted; member moved between style groups → both groups' flags correct; deleted asset not counted; permission-hidden asset not counted; document with one visible + one hidden member counted once; filter predicates respected; total equals old-function total on fixture set. Plus the preview equivalence run.
- Step 2: unit tests in popdam3 per writer: unchanged input → no update call; one changed field → payload contains only that field.
- Step 4: PR #5744's `scripts/test_table_repack_maintenance.py` stays green.

## 11. Constraints and gotchas

- No manual production writes; everything through promotion/maintenance workflows. Claim objects first on the existing issue (`shared-db-change` skill).
- Repack needs ~2x table+indexes free disk at peak; the provider resized disk during a 1:35-1:45 PM EST outage on 2026-11-05 — check free space right before.
- Concurrent tagging writes lengthen repack's log-replay phase; `--no-kill-backend` means it may give up — that is acceptable, retry later.
- Do not hand-edit `types/database.types.ts`.
- Exact totals are an owner ruling — never trade them for speed.

## 12. Access

`gh` authenticated (u2giants for popdam3, popcre org for shared-db). Production/preview DB access only through the repo's workflows and read-only helpers named in AGENTS.md; credentials in 1Password vault `vibe_coding` (never values in chat or files).

## 13. Definition of done, risks, open questions

Done: heap ≤ 400 MB and stays ≤ 2x live bytes for 7 days; HOT ratio ≥ 70%; broad-search total < 3 s and Search test set typical < 3 s with unchanged pass count; all PRs merged, migrations promoted, popdam3 writers deployed; this STATUS table updated with artifacts; #5747 closed with live proof; handoff updated.
Risks: repack aborts (retry; no data change); Step 5 count mismatch (blocked by equivalence test; rollback = previous function body via forward migration).
Open: whether `last_seen_at` must update every scan (business owner: Albert — ask only if Step 2 needs it).

## Self-audit (2026-11-05)

1. Fresh session executes without asking? Yes — §2/§5/§12 give repos, routes, and current PR state; each step has targets and done-when. Gap fixed: owner exact-count ruling added after finding it in the migration header.
2. Background and rejected options carried? Yes — §6/§7 cover VACUUM FULL, CLUSTER, capped counts, suppress trigger, fillfactor.
3. Goal steers judgment? Yes — §1 states speed, compactness, and unchanged exact results, with the goal-wins rule.
