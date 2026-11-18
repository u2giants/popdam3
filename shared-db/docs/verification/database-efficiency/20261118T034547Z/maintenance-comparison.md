---
summary: "Step 7 maintenance comparison 2026-11-18: planner estimates vs bounded counts, autovacuum/analyze windows; zero per-table tuning changes recommended (first run)"
kind: proof
status: done
read-when: checking what Step 7 of plan_database_efficiency_and_api_security.md measured for maintenance (estimates vs counts, autovacuum/analyze windows), or whether any per-table tuning was justified
---

# Step 7 maintenance comparison — planner estimates, maintenance windows, tuning verdicts

**Plan / issue:** `plan_database_efficiency_and_api_security.md` Step 7 ("maintenance comparison") / program issue #2326 (Phase E)
**Captured:** 2026-11-18 03:45–04:05 UTC (2026-11-17 10:45 PM–11:05 PM EST) on edge-dev
**Session:** MiMo chat ses_ffe5e136 on edge-dev
**Access:** production `qsllyeztdwjgirsysgai` via Supabase Management API `POST /database/query` with `read_only: true`, executing as `supabase_read_only_user`. No production writes, no migrations, no manual production SQL. Scratch runners `D:\tmp\2326-maint-q1-catalog.mjs`, `D:\tmp\2326-maint-q2-stats.mjs`, `D:\tmp\2326-maint-q3-counts.mjs`, `D:\tmp\2326-maint-q4-exist.mjs` (session-side only; SQL reproduced in the appendix).

**Measurement boundaries (cite with every number here):**
- `pg_stat_statements` was reset 2026-11-06 11:20:19 EST and runs `track=top`. This report does not use pg_stat_statements rows; the boundary is recorded because sibling Step 3/5 evidence in this tree shares the window language.
- `pg_stat_database.stats_reset` is **NULL** (never reset or not recorded). The `pg_stat_user_tables` / `pg_stat_all_tables` counter window therefore has an unknown start; where a stat entry's counters reproduce `n_live_tup = n_tup_ins − n_tup_del` exactly while exact counts show the relation already held rows, the entry is classified **counters unreliable (post-reset entry)** and is never used alone as evidence of a missed maintenance objective.
- Server-side `statement_timeout` is 120,000 ms (from `pg_settings`); every count below completed inside it.
- `public.assets` heap was 390 MB at the 2026-11-16 weekly check (issue #5747 auto-2 / the #5747 Step-7 7-day table: heap 390 MB, live 212 MB, heap/live 1.84 at 2026-11-12). That table was read before any size claim below. Current catalog reading for `public.assets` heap: 408,748,032 bytes (389.8 MiB) — consistent. The #5886 weekly health check owns the repack trigger (heap/live > 2.0 opens a governed repack PR); **no pg_repack is recommended here**, and the established route is `plan_assets-bloat-permanent-fix.md` / issues #5747 / #5886.
- Realtime/CDC/replication are out of scope for this report and are never a tuning action.

---

## 1. Planner estimates vs bounded exact counts

Method: `pg_class.reltuples`/`relpages` (last ANALYZE's planner estimates) compared to exact `count(*)` where the relation was bounded (≤ ~60k heap pages; slowest exact count 72 s), and to scaled `TABLESAMPLE SYSTEM` estimates for the six giant relations. **No unbounded count was run on a giant table.** No target was declined outright; the six giants used the sampled approach instead. TABLESAMPLE percentages are page-based, so scaled values carry a few-percent sampling noise — fine for drift detection.

Sampled set covers the named families (style-guide matviews and their snapshot objects, the search-documents family, `plm.style_tracker_item_bridge`) plus the catalog top-10 by total size. Object-name reality check (existence query, appendix Q4): there is **no `dam.search_documents` relation in production** — the family is `public.dam_search_documents`, `public.dam_search_keys`, `dam.search_text_vectors`, `dam.dam_asset_image_vectors`, `public.style_guide_search_documents` (+ queue/matviews). There is **no separate snapshot table** (`style_guide_library_default_snapshot` is a function name only): the library snapshot is the two matviews `public.style_guide_library_default_summary` and `public.style_guide_library_default_guides`, refreshed CONCURRENTLY by `public.refresh_style_guide_library_default_snapshot()` (migration `20260917024050`). All four style-guide matviews and the bridge table are in the exact-count set below.

### 1a. Exact counts (bounded — every target ≤ 59,119 heap pages)

| schema.table (kind) | reltuples | relpages | exact count | Δ vs estimate | pg_stat n_live_tup |
|---|---|---|---|---|---|
| public.style_guide_file_groups (m) | 20,830 | 1,320 | 20,867 | +37 (+0.2%) | 20,845 |
| public.style_guide_folders (m) | 391 | 4 | 391 | 0 | 391 |
| public.style_guide_library_default_guides (m) | 1,757 | 335 | 1,788 | +31 (+1.8%) | 4 ⚠ |
| public.style_guide_library_default_summary (m) | 2 | 1 | 2 | 0 | 2 |
| plm.style_tracker_item_bridge (r) | 16,323 | 13,136 | 16,323 | **0** | 16,323 |
| public.style_groups (r) | 11,477 | 2,298 | 11,484 | +7 (+0.1%) | 11,484 |
| public.style_guide_crawl_runs (r) | 197 | 9 | 205 | +8 | — |
| public.style_guide_search_sync_queue (r) | 79 | 3 | **0** | −79 (queue drained) | 81 |
| public.style_guide_file_crawl_seen (r) | 223,446 | 2,759 | 223,446 | **0** | 223,446 |
| public.style_guide_tagging_state (r) | 303,892 | 7,066 | 305,723 | +1,831 (+0.6%) | 305,723 |
| public.style_guide_pdf_text (r) | 4,394 | 251 | 4,394 | **0** | 0 ⚠ |
| public.dam_search_keys (r) | 185,913 | 13,716 | 182,726 | −3,187 (−1.7%) | 186,098 |
| hts_rag.hts_rag_rulings (r) ★top10 | 222,063 | 23,596 | 222,283 | +220 (+0.1%) | 222,063 |
| hts_rag.hts_rag_ruling_products (r) ★top10 | 321,091 | 38,983 | 321,189 | +98 (+0.03%) | 321,091 |
| public.assets (r) | 190,632 | 49,896 | 187,811 | −2,821 (−1.5%) | 191,049 |
| public.style_guide_files (r) | 315,999 | 35,878 | 305,723 | −10,276 (−3.3%) | 317,830 |
| public.style_guide_search_documents (r) ★top10 | 246,095 | 58,824 | 236,784 | −9,311 (−3.8%) | 246,357 |
| public.dam_search_documents (r) ★top10 | 182,165 | 59,119 | 182,726 | +561 (+0.3%) | 182,350 |
| public.style_guide_file_tags (r) | 1,195,503 | 53,236 | 1,198,234 | +2,731 (+0.2%) | 6,223 ⚠ |
| public.asset_effective_tags (r) | 2,176,334 | 21,346 | 2,171,490 | −4,844 (−0.2%) | 2,171,490 |
| dam.dam_asset_image_vectors (r) ★top10 | 161,195 | 40,300 | **177,117** | **+15,922 (+9.9%)** | 177,112 |

⚠ = `pg_stat` disagrees with the exact count → that stat entry is counters-unreliable (see §2). All queries completed in 0.2–72.3 s (`dam.dam_asset_image_vectors` the slowest at 72,275 ms; `style_guide_file_tags` 20,801 ms).

### 1b. Sampled counts (giant relations — TABLESAMPLE, scaled)

| schema.table ★top10 unless noted | reltuples | sample | rows in sample | scaled estimate | vs reltuples |
|---|---|---|---|---|---|
| coldlion.change_log | 988,449 | 10% | 101,897 | ≈1,018,970 | +3.1% |
| hts_rag.hts_rag_ruling_sentences ★ | 9,109,920 | 2% | 192,525 | ≈9,626,250 | +5.7% |
| plm.nbcu_asset_metadata_value ★ | 2,421,445 | 5% | 121,358 | ≈2,427,160 | +0.2% |
| plm.nbcu_asset ★ | 233,592 | 10% | 23,348 | ≈233,480 | −0.05% |
| public.asset_tags ★ | 2,348,520 | 5% | 117,803 | ≈2,356,060 | +0.3% |
| plm.dcp_metadata_asset | 375,308 | 10% | 37,718 | ≈377,180 | +0.5% |

★ = catalog top-10 by `pg_total_relation_size` (the tenth member, `hts_rag.hts_rag_rulings`, is in the exact table). Top-10 total sizes captured: hts_rag.hts_rag_rulings 3,534,061,568 B; hts_rag.hts_rag_ruling_sentences 3,015,147,520 B; style_guide_search_documents 2,497,011,712 B; dam_search_documents 2,484,830,208 B; nbcu_asset_metadata_value 2,129,403,904 B; coldlion.change_log 1,433,198,592 B; hts_rag_ruling_products 1,374,928,896 B; nbcu_asset 1,346,551,808 B; dam_asset_image_vectors 1,343,791,104 B; asset_tags 1,337,352,192 B (appendix Q1).

### 1c. What the comparison shows

- **Planner estimates are fresh within ±3.8% on 19 of 21 exactly-counted relations** and within +5.7% on all six sampled giants. ANALYZE is doing its job on the measured set.
- **Largest real drift: `dam.dam_asset_image_vectors`, reltuples under-count by +9.9%** (161,195 → 177,117). `last_autoanalyze` 2026-11-10, `n_mod_since_analyze` 15,917 against the default analyze trigger (50 + 0.1×live ≈ 17,765) — analyze is due under default policy but not yet fired. One observation only (see §3).
- **`public.style_guide_search_documents` (−3.8%) and `public.style_guide_files` (−3.3%)** are the next-largest drifts; both are update-heavy and slightly over-estimated.
- **`coldlion.change_log` is the counter-reliability exhibit:** `pg_stat` claims 8,846 live rows while the 10% sample scales to ≈1,018,970 and `reltuples` says 988,449. Its stat entry reproduces `n_tup_ins − n_tup_del = 8,861 − 5,080 = 8,846` exactly, i.e. the entry started from zero after a stats reset while the relation already held ~1M rows. The same pattern hits `public.style_guide_file_tags` (pg_stat 6,223 vs exact 1,198,234) and the all-zero `plm.nbcu_asset` / `plm.nbcu_asset_metadata_value` / `plm.dcp_metadata_asset` / `public.style_guide_pdf_text` entries. Classified **counters unreliable** — never used alone as a tuning trigger.
- **`public.style_guide_search_sync_queue` estimate (79) vs exact (0):** the work queue drained after its last ANALYZE. Harmless stale estimate on a cheap relation; included because it is a named family member.
- The two library snapshot matviews and `style_guide_folders` match exactly or within 1.8%; `style_guide_file_groups` within +37 rows. The matviews' `pg_stat` rows lag after CONCURRENTLY refreshes (e.g. `library_default_guides` shows live=4) and are likewise not treated as reliable liveness there — `reltuples` and exact counts agree.

## 2. Autovacuum / analyze windows

Source: `pg_stat_user_tables` / `pg_stat_all_tables` + `pg_settings` + `pg_class.reloptions` + `age(relfrozenxid)` (appendix Q2), same capture window. Timestamps below are EST (America/New_York).

**Global settings:** autovacuum **on**; `autovacuum_vacuum_threshold=50`, `autovacuum_vacuum_scale_factor=0.2`; `autovacuum_analyze_threshold=50`, `autovacuum_analyze_scale_factor=0.1`; `autovacuum_naptime=60s`; `autovacuum_max_workers=3`; `autovacuum_vacuum_cost_delay=2ms` (`autovacuum_vacuum_cost_limit=-1` → inherits `vacuum_cost_limit=200`); `track_counts=on`; `default_statistics_target=100`; `statement_timeout=120000ms`; `autovacuum_freeze_max_age=200,000,000`.

**Pre-existing per-table settings (recorded, not created here):** `public.dam_search_documents` `fillfactor=75`; `public.style_guide_search_documents` `autovacuum_vacuum_scale_factor=0, autovacuum_vacuum_threshold=2000, autovacuum_analyze_scale_factor=0.02`; `public.style_guide_search_embedding_jobs` `fillfactor=70`; `public.dam_search_keys` `toast_tuple_target=128`; `plm.production_order_line_source_ref` `autovacuum_analyze_scale_factor=0.02, autovacuum_analyze_threshold=50`. No other user relation carries storage/autovacuum reloptions (the other 103 reloptions rows are `security_invoker`/`security_barrier` on views).

**Is analyze keeping up?** Yes on this reading. Every table with reliable counters sits **below** its `autovacuum_analyze_threshold + scale×live` trigger in `n_mod_since_analyze`. Closest to firing: `public.asset_tags` 229,677 mods vs ≈233,654 trigger; `dam.dam_asset_image_vectors` 15,917 vs ≈17,766; `hts_rag.hts_rag_ruling_sentences` 654,600 vs ≈949,304. No table is far past its analyze trigger.

**Recent maintenance (windows observed):** churned tables show autovacuum/autoanalyze inside the last week — `public.style_guide_search_sync_queue` av 2026-11-17 10:27 PM; `public.style_guide_file_crawl_seen` av 10:49 PM (36 avac / 65 aanalyze — most-maintained table in the window); `dam.search_text_vectors` av 10:17 PM; `plm.style_tracker_item_bridge` av 4:42 PM; `hts_rag.hts_rag_product_embeddings` av 2:14 PM; `hts_rag.hts_rag_rulings` av 2026-11-16 11:22 PM; `public.assets` av 2026-11-16 11:00 AM (16 avac / 30 aanalyze); `public.dam_search_documents` av 2026-11-17 1:14 AM (29 avac / 67 aanalyze); `public.style_groups` av 2026-11-17 1:19 AM (148 avac / 277 aanalyze — highest counts, small fast table). All of these also show recent `last_autoanalyze`. Manual `vacuum`/`analyze` counts are 0 across the set — everything observed is automatic.

**Heavy dead tuples (all below the 0.2 scale-factor vacuum trigger — no missed objective):**

| table | live (pg_stat) | dead | dead % | vacuum trigger (50+0.2×live) | last autovacuum |
|---|---|---|---|---|---|
| public.asset_tags | 2,336,039 | 397,281 | 14.5% | ≈467,258 | 2026-11-12 12:15 AM |
| public.asset_effective_tags | 2,171,490 | 365,386 | 14.4% | ≈434,348 | 2026-11-12 3:24 AM |
| hts_rag.hts_rag_ruling_codes | 1,461,503 | 220,697 | 13.1% | ≈292,351 | 2026-11-16 1:48 PM |
| public.style_guide_file_crawl_seen | 223,446 | 40,405 | 15.3% | ≈44,739 | 2026-11-17 10:49 PM |
| public.style_guide_tagging_state | 305,723 | 33,375 | 9.8% | ≈61,195 | never in window (avc=0) |
| public.style_guide_files | 317,830 | 12,332 | 3.7% | ≈63,616 | 2026-11-10 9:41 PM |

`style_guide_tagging_state` is update-heavy (1,334,079 updates since the stat entry, 99.5% HOT) and has never autovacuumed **in the recorded window** — but 33,375 dead is below its 61,195 trigger and autoanalyze has run 35 times (last 2026-11-10 9:39 PM). Not a missed objective. `coldlion.sync_run` (5,424 dead, 11.8%) likewise sits below its ≈8,156 trigger.

**Never vacuumed/analyzed in the recorded window (avc=0, aac=0):** `coldlion.change_log`, `public.style_guide_file_tags`, `public.style_guide_pdf_text`, and the `plm.nbcu_*`/`plm.dcp_metadata_asset` rows that are entirely zero. Per §1c these are counters-unreliable post-reset entries, **not** evidence of skipped autovacuum. On the exact counts their `reltuples` are accurate (≤ +0.5% except change_log's sample noise), so no freshness problem is demonstrated.

**Freeze age (appendix Q2):** highest `age(relfrozenxid)` is `archive.erp_items_raw` 46,036,318 and `public.style_guide_files` 46,036,304 — **23% of `autovacuum_freeze_max_age` (200,000,000)**. Then `ingest.raw_record` 38,422,253; `pim.product` 37,854,916; `app.AuditLog` 33,040,572. No anti-wraparound pressure at this reading; nothing near the freeze limit.

**Heap-size cross-check (§boundaries):** `public.assets` heap 408,748,032 B (389.8 MiB) matches the #5747 weekly reading of 390 MB; exact live rows 187,811. Whole-database user-relation footprint: 16,303,251,456 B heap / 39,732,256,768 B total across 985 relations (appendix Q1c). No size action taken here; bloat compaction stays with the governed #5747/#5886 route.

## 3. Per-table tuning verdicts

**Rule applied (plan Step 7 + its verification gate):** recommend a per-table setting change **only on a repeated missed objective** — a defined freshness/dead-tuple target missed and documented across runs. **Never** on one NULL or zero counter. This document is the **first** dated maintenance-comparison run of Step 7, so no cross-run repetition exists yet; a "no change recommended" verdict is the correct outcome where the single run shows either no miss or an unreliable counter.

| # | Object | Single-run observation | Verdict | Why |
|---|---|---|---|---|
| 1 | dam.dam_asset_image_vectors | +9.9% reltuples drift; autoanalyze 2026-11-10; mod 15,917 vs ≈17,766 trigger | **No change** | One observation; default analyze policy will fire shortly. Re-check next run — escalate only if drift persists with analyze still stale. |
| 2 | coldlion.change_log | avc=0 aac=0, pg_stat dead 36.5% | **No change** | Counters unreliable (pg_stat live 8,846 vs sampled ≈1.02M). Single NULL/zero-counter reading cannot justify tuning. Re-check with reliable counters. |
| 3 | public.style_guide_file_tags | avc=0 aac=0, pg_stat live 6,223 vs exact 1,198,234 | **No change** | Same counter-reliability class as #2. |
| 4 | plm.nbcu_asset, plm.nbcu_asset_metadata_value, plm.dcp_metadata_asset, public.style_guide_pdf_text | all-zero stat rows | **No change** | Counters unreliable; exact/sampled counts show full relations whose `reltuples` are accurate within 0.5%. |
| 5 | public.asset_tags, public.asset_effective_tags | 14–15% dead, ~5-day-old analyze | **No change** | Both below the 0.2 vacuum trigger and within analyze policy. Changing scale factors on one reading is not a repeated missed objective. |
| 6 | public.style_guide_tagging_state | avc=0, 33,375 dead (9.8%) | **No change** | Below the 61,195 trigger; analyze keeping up (aac=35). Working as configured. |
| 7 | public.style_guide_search_sync_queue | reltuples 79 vs exact 0 | **No change** | Drained work queue; stale estimate on a cheap relation, no objective missed. |
| 8 | Existing tunings (fillfactor 75/70, style_guide_search_documents autovacuum overrides, dam_search_keys toast_tuple_target, production_order_line_source_ref analyze overrides) | — | **No change (leave as-is)** | No measured objective in this run is attributable to these settings; they are recorded above as baseline for future runs. |
| 9 | Freeze-age leaders (archive.erp_items_raw, public.style_guide_files) | xid_age ≈46M vs 200M limit | **No change** | 23% of the wraparound limit on one reading; no repeated miss. Re-check next run. |

**Result: zero per-table setting changes recommended.** No conclusion above rests on a lifetime zero/NULL counter alone; the two apparent "never vacuumed" exhibits are explained by counter resets and exact counts. No `pg_repack` action is proposed (governed route: #5747 / #5886 / `plan_assets-bloat-permanent-fix.md`). Realtime/CDC/replication untouched.

**Re-check:** next maintenance-comparison run (Step 7 cadence / on or after the #1966 index delta). Carry forward specifically: #1 (dam_asset_image_vectors analyze freshness), #2–#4 (counter reliability once a longer-lived stat window exists), #9 (freeze age trend). A per-table setting change becomes eligible only if the **same** objective is missed in a second dated run.

---

## Appendix — SQL actually executed (all `read_only: true`, `supabase_read_only_user`)

### Q1 — catalog sizes (top-25 by total size; named families; heap total)

```sql
-- Q1a
SELECT n.nspname AS schema, c.relname, c.relkind,
       c.reltuples::bigint AS reltuples, c.relpages,
       pg_total_relation_size(c.oid) AS total_bytes,
       pg_relation_size(c.oid) AS heap_bytes,
       pg_indexes_size(c.oid) AS index_bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
  AND c.relkind IN ('r','m','p','f')
  AND pg_total_relation_size(c.oid) > 0
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 25;

-- Q1b
SELECT n.nspname AS schema, c.relname, c.relkind,
       c.reltuples::bigint AS reltuples, c.relpages,
       pg_total_relation_size(c.oid) AS total_bytes,
       pg_relation_size(c.oid) AS heap_bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','m','p','v','f')
  AND (c.relname ILIKE 'style_guide%' OR c.relname ILIKE 'search_documents%'
       OR c.relname ILIKE '%style_tracker_item%' OR c.relname ILIKE 'library%snapshot%'
       OR c.relname ILIKE '%file_groups%' OR c.relname ILIKE '%style_group%')
ORDER BY pg_total_relation_size(c.oid) DESC;

-- Q1c
SELECT sum(pg_relation_size(c.oid)) AS heap_bytes_all,
       sum(pg_total_relation_size(c.oid)) AS total_bytes_all, count(*) AS rel_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
  AND c.relkind IN ('r','m','p','f');
```

### Q2 — maintenance stats and settings

```sql
-- Q2a (and Q2b=pg_stat_all_tables variant, same column list)
SELECT schemaname, relname,
       last_autovacuum, last_autoanalyze, last_vacuum, last_analyze,
       vacuum_count, autovacuum_count, analyze_count, autoanalyze_count,
       n_live_tup, n_dead_tup, n_mod_since_analyze,
       n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd
FROM pg_stat_user_tables
WHERE (schemaname, relname) IN (
  ('public','style_guide_search_documents'),('public','dam_search_documents'),
  ('public','style_guide_files'),('public','style_guide_file_tags'),
  ('plm','style_tracker_item_bridge'),('public','style_groups'),
  ('public','style_guide_file_groups'),('public','style_guide_folders'),
  ('public','style_guide_library_default_guides'),('public','style_guide_library_default_summary'),
  ('public','style_guide_tagging_state'),('public','style_guide_file_crawl_seen'),
  ('public','style_guide_pdf_text'),('public','style_guide_search_sync_queue'),
  ('public','dam_search_keys'),('dam','search_text_vectors'),('dam','dam_asset_image_vectors'),
  ('hts_rag','hts_rag_rulings'),('hts_rag','hts_rag_ruling_sentences'),
  ('plm','nbcu_asset_metadata_value'),('coldlion','change_log'),
  ('hts_rag','hts_rag_ruling_products'),('plm','nbcu_asset'),
  ('public','asset_tags'),('plm','dcp_metadata_asset'),('public','assets'),
  ('hts_rag','hts_rag_product_embeddings'),('public','asset_effective_tags'))
ORDER BY n_dead_tup DESC NULLS LAST;

-- Q2b freeze age + reloptions (>100 MB relations)
SELECT n.nspname AS schema, c.relname, age(c.relfrozenxid) AS xid_age,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total, c.reloptions,
       c.reltuples::bigint AS reltuples
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
  AND c.relkind = 'r' AND pg_total_relation_size(c.oid) > 100*1024*1024
ORDER BY age(c.relfrozenxid) DESC NULLS LAST LIMIT 30;

-- Q2c settings
SELECT name, setting, unit, short_desc FROM pg_settings
WHERE name LIKE 'autovacuum%' OR name IN ('vacuum_cost_limit','vacuum_cost_delay',
  'track_counts','track_activities','default_statistics_target',
  'idle_in_transaction_session_timeout','statement_timeout') ORDER BY name;

-- Q2d per-table reloptions (all), then filtered to relkind r/m/p
SELECT n.nspname AS schema, c.relname, c.relkind, c.reloptions
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.reloptions IS NOT NULL AND array_length(c.reloptions,1) > 0
  AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
ORDER BY 1,2;

-- Q2e top-25 by n_dead_tup; Q2f top-25 by n_mod_since_analyze (>0)
SELECT schemaname, relname, n_live_tup, n_dead_tup,
       CASE WHEN n_live_tup > 0 THEN round(100.0*n_dead_tup/(n_live_tup+n_dead_tup),1) END AS dead_pct,
       n_mod_since_analyze, last_autovacuum, last_autoanalyze,
       autovacuum_count, autoanalyze_count
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC NULLS LAST LIMIT 25;

SELECT schemaname, relname, n_live_tup, n_mod_since_analyze,
       last_analyze, last_autoanalyze, autoanalyze_count, analyze_count
FROM pg_stat_user_tables WHERE n_mod_since_analyze > 0
ORDER BY n_mod_since_analyze DESC LIMIT 25;

-- Q2g stats window probe
SELECT datname, stats_reset FROM pg_stat_database WHERE datname = current_database();
```

### Q3 — counts (21 exact + 6 sampled; one query each, individually timed)

```sql
SELECT count(*)::bigint AS n FROM public.style_guide_file_groups;
SELECT count(*)::bigint AS n FROM public.style_guide_folders;
SELECT count(*)::bigint AS n FROM public.style_guide_library_default_guides;
SELECT count(*)::bigint AS n FROM public.style_guide_library_default_summary;
SELECT count(*)::bigint AS n FROM plm.style_tracker_item_bridge;
SELECT count(*)::bigint AS n FROM public.style_groups;
SELECT count(*)::bigint AS n FROM public.style_guide_crawl_runs;
SELECT count(*)::bigint AS n FROM public.style_guide_search_sync_queue;
SELECT count(*)::bigint AS n FROM public.style_guide_file_crawl_seen;
SELECT count(*)::bigint AS n FROM public.style_guide_tagging_state;
SELECT count(*)::bigint AS n FROM public.style_guide_pdf_text;
SELECT count(*)::bigint AS n FROM public.dam_search_keys;
SELECT count(*)::bigint AS n FROM hts_rag.hts_rag_rulings;
SELECT count(*)::bigint AS n FROM hts_rag.hts_rag_ruling_products;
SELECT count(*)::bigint AS n FROM public.assets;
SELECT count(*)::bigint AS n FROM public.style_guide_files;
SELECT count(*)::bigint AS n FROM public.style_guide_search_documents;
SELECT count(*)::bigint AS n FROM public.dam_search_documents;
SELECT count(*)::bigint AS n FROM public.style_guide_file_tags;
SELECT count(*)::bigint AS n FROM public.asset_effective_tags;
SELECT count(*)::bigint AS n FROM dam.dam_asset_image_vectors;
SELECT count(*)::bigint AS sample_n FROM coldlion.change_log TABLESAMPLE SYSTEM (10);
SELECT count(*)::bigint AS sample_n FROM hts_rag.hts_rag_ruling_sentences TABLESAMPLE SYSTEM (2);
SELECT count(*)::bigint AS sample_n FROM plm.nbcu_asset_metadata_value TABLESAMPLE SYSTEM (5);
SELECT count(*)::bigint AS sample_n FROM plm.nbcu_asset TABLESAMPLE SYSTEM (10);
SELECT count(*)::bigint AS sample_n FROM public.asset_tags TABLESAMPLE SYSTEM (5);
SELECT count(*)::bigint AS sample_n FROM plm.dcp_metadata_asset TABLESAMPLE SYSTEM (10);
```

### Q4 — existence checks

```sql
SELECT n.nspname, c.relname, c.relkind
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relname IN ('search_documents','style_guide_library_default_snapshot',
                    'style_guide_library_v2','style_guide_library')
  AND n.nspname NOT IN ('pg_catalog','information_schema');  -- returned 0 rows

SELECT pg_get_functiondef('public.refresh_style_guide_library_default_snapshot()'::regprocedure);
```

Raw result captures live session-side under `D:\tmp\2326-q1-*.json`, `D:\tmp\2326-q2-*.json`, `D:\tmp\2326-q3-counts.json` (not committed — per policy scratch stays out of the repo; every figure used above is transcribed here with its query).
