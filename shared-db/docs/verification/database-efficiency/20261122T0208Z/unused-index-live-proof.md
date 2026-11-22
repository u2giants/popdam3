---
summary: "Issue #5610 Step 6 live proof (2026-11-21): 3 dropped indexes absent, KEEP intact, 277 MB freed, 30.5h Logs API 978/978 2xx, EXPLAIN verified."
kind: proof
status: current
read-when: "Verifying #5610 live proof, storage reduction, no-regression timing, or representative access after PR #6907."
---

# Issue #5610 — Live Proof (Step 6)

- **Owning issue:** `popcre/shared-db#5610` (also supplies the shared `public.assets` decision for `#5747`)
- **Delivered migration:** `supabase/migrations/20261225050100_drop_verified_unused_indexes_5610.sql` via [PR #6907](https://github.com/popcre/shared-db/pull/6907) (merged as `4f81c0510884364bee4fb92da83489b2863ddffa`)
- **Preview rehearsal:** [run 44802202957](https://github.com/popcre/shared-db/actions/runs/44802202957)
- **Production automatic promotion:** [run 44802910645](https://github.com/popcre/shared-db/actions/runs/44802910645) (opened post-delivery observation at November 20, 2026, 2:37:57 PM EST)
- **Live verification timestamp:** November 21, 2026, 9:08:04 PM EST (~30.5 hours post-delivery)
- **Target:** The shared production Supabase project (read-only queries wrapped in `BEGIN TRANSACTION READ ONLY; ... ROLLBACK;`; no production writes or statistics resets).

## Verdict

No-regression and representative-access criteria for Step 6 are **satisfied**:
1. All three dropped indexes remain absent; all protected, vector, active, and HTS KEEP indexes remain present.
2. Combined relation storage decreased by **277,151,744 bytes (~264.3 MiB / 277 MB)** at migration apply.
3. Across **30.5 continuous post-delivery hours** (November 20, 2:37:58 PM EST through November 21, 9:08:00 PM EST), all **978** measured search and style-guide API requests succeeded (**100% 2xx, 0 4xx, 0 5xx**), with cumulative post-delivery mean origin times **faster** than the pre-release 24-hour baseline across every active route (`search_dam_documents` -25.8%, `search_style_guide_library_v2` -7.8%, `style_guide_files` GET -44.8%, PATCH -11.0%).
4. Live function-body inspection and read-only `EXPLAIN (ANALYZE, BUFFERS)` prove none of the live search or browse RPCs can use any of the three dropped index expressions, and all active paths use their retained indexes cleanly with intact role grants.

---

## 1. Production Catalog Continuity & Storage

Observed at **November 21, 2026, 9:08:04 PM EST**:

- `pg_postmaster_start_time()`: `November 6, 2026, 11:20:19.434455 AM EST` (unchanged)
- `pg_stat_database.stats_reset`: `NULL` (unchanged)
- `extensions.pg_stat_statements_info.stats_reset`: `November 6, 2026, 11:20:19.263334 AM EST` (unchanged)
- `extensions.pg_stat_statements_info.dealloc`: `113` (up from `112` at 2:37 PM EST; `pg_stat_statements.max = 5000`). Statement-delta comparison remains invalidated by ongoing evictions (tracked separately on `#5609`); independent Logs API aggregates, live `EXPLAIN (ANALYZE, BUFFERS)`, and live function-body proof establish no-regression instead.

### Index Presence Check (`to_regclass`)

| Index | Expected | Live Result (Nov 21, 9:08 PM EST) |
|---|---|---|
| `public.idx_assets_full_text_search` | Absent (dropped) | `NULL` (absent) |
| `public.idx_sgf_directory_path_trgm` | Absent (dropped) | `NULL` (absent) |
| `public.idx_style_guide_files_tag_search_trgm` | Absent (dropped) | `NULL` (absent) |
| `public.idx_assets_tags` | Present (KEEP, <50 MiB) | Present (27 MB) |
| `public.idx_style_guide_file_tags_tag_status` | Present (KEEP) | Present |
| `public.idx_assets_ai_tag_untagged_candidates` | Present (KEEP) | Present (26 MB) |
| `public.dam_search_embedding_claim_idx` | Present (KEEP) | Present |
| `public.idx_sg_search_documents_embedding_hnsw` | Present (KEEP, vector) | Present |
| `public.idx_dam_search_documents_embedding_hnsw` | Present (KEEP, vector) | Present |
| `public.idx_assets_relative_path_trgm` | Present (KEEP, active) | Present (129 MB) |
| `public.idx_assets_ai_tag_all_candidates` | Present (KEEP, active) | Present (123 MB) |
| `dam.dam_asset_image_vectors_vec_siglip_hnsw` | Present (KEEP, vector) | Present |
| `dam.dam_asset_image_vectors_vec_dino_hnsw` | Present (KEEP, vector) | Present |
| `hts_rag.hts_rag_rulings_search_trgm_idx` | Present (KEEP, HTS) | Present |
| `hts_rag.hts_rag_ruling_sentences_hash_idx` | Present (KEEP, HTS) | Present |

### Relation Sizes (Nov 21, 9:08 PM EST)

- `public.assets`: total `1,216,372,736` bytes (`1160 MB`), table `410,001,408` bytes, indexes `806,371,328` bytes (`769 MB`)
- `public.style_guide_files`: total `823,623,680` bytes (`785 MB`), table `294,125,568` bytes, indexes `529,498,112` bytes (`505 MB`)
- Verified storage reduction at apply: **277,151,744 bytes** freed (per independent pre/post-apply catalog read recorded on `#5610`).

---

## 2. Independent Supabase Logs API Evidence (30.5h Post-Release)

Aggregate edge-log metrics from the Supabase Logs API (`source = 'edge_logs'`, same tracked route set as `docs/verification/issue-5610-index-observation/search-request-capture.sql`, broken down by HTTP method and percentiles; no request samples returned):

- **Pre-24h baseline:** November 19, 1:54 PM EST – November 20, 1:54 PM EST
- **Post 0–24h:** November 20, 2:37:58 PM EST – November 21, 2:37:58 PM EST
- **Post 24–30.5h:** November 21, 2:37:58 PM EST – November 21, 9:08:00 PM EST (zero gap, zero overlap with Post 0–24h)
- **Latest rolling 24h:** November 20, 9:08:00 PM EST – November 21, 9:08:00 PM EST

| Route & Method | Pre-24h Baseline | Post 0–24h | Post 24–30.5h | Combined Post 0–30.5h | Latest Rolling 24h |
|---|---|---|---|---|---|
| `/rest/v1/rpc/search_dam_documents` [POST] | n=1,159; mean **2244.9 ms**, p50 1503.0, p95 6365.9, >5s: 11.0% | n=215; mean 2607.6 ms, p50 1960.0, p95 7107.5, >5s: 10.7% | n=340; mean **1071.8 ms**, p50 852.5, p95 2690.7, >5s: 0.9% | n=555 (100% 2xx, 0 err); mean **1666.8 ms (-25.8%)** | n=346; mean **1175.6 ms (-47.6%)**, p50 870.0, p95 3057.8 |
| `/rest/v1/rpc/search_style_guide_library_v2` [POST] | n=986; mean **1065.8 ms**, p50 348.0, p95 4674.5, >5s: 4.6% | n=132; mean 1438.3 ms, p50 516.0, p95 5074.5, >5s: 5.3% | n=263; mean **753.7 ms**, p50 474.0, p95 1984.2, >5s: 1.1% | n=395 (100% 2xx, 0 err); mean **982.5 ms (-7.8%)** | n=263; mean **753.7 ms (-29.3%)**, p50 474.0, p95 1984.2 |
| `/rest/v1/style_guide_files` [GET] | n=60; mean **153.0 ms**, p50 125.0, p95 349.3 | n=15; mean 86.5 ms, p50 82.0 | n=2; mean 69.0 ms | n=17 (100% 2xx, 0 err); mean **84.4 ms (-44.8%)** | n=4; mean **87.5 ms** |
| `/rest/v1/style_guide_files` [PATCH] | n=16; mean **125.3 ms**, p50 97.5 | n=11; mean 111.5 ms, p50 83.0 | n=0 | n=11 (100% 2xx, 0 err); mean **111.5 ms (-11.0%)** | n=0 |
| `/rest/v1/style_guide_files` [HEAD] | n=76; mean 1737.2 ms, p50 551.5, p95 6300.5 | n=0 | n=0 | n=0 | n=0 |

### Resolution of the First-24h Variance
1. The initial 24-hour check (`#5610` comment `7068201605`) had small weekend samples (`n=215` DAM, `n=132` style-guide) where mean origin times appeared +15.5% and +33.5% higher than the weekday pre-release baseline. Adding the next 6.5 hours (603 additional requests) brought both the cumulative 30.5-hour means and the latest rolling 24-hour window **below** the pre-release baseline (-25.8% / -47.6% DAM; -7.8% / -29.3% style-guide) and cut the >5s tail rate to ~1%.
2. Splitting `/rest/v1/style_guide_files` by HTTP method explains the earlier -89.9% unsplit drop: the pre-release window included 76 slow `HEAD` count requests (mean 1737.2 ms) while post-release had 0 `HEAD` requests. Method-matched `GET` and `PATCH` requests are both faster post-release.

---

## 3. Live Function-Body Proof, `EXPLAIN (ANALYZE, BUFFERS)`, & App Access

All database checks executed inside `BEGIN TRANSACTION READ ONLY; ... ROLLBACK;` on production on November 21, 2026 (~9:10 PM EST).

### Structural Impossibility of Regression from the Three Dropped Indexes
Live `pg_get_functiondef` inspection of all active search and candidate RPCs confirms:
- `public.search_dam_documents`: searches `public.dam_search_documents` / `public.dam_search_keys.search_tsv` using `'english'` (never `'simple'`), joining `public.assets` only by `id` or `style_group_id`. It cannot match `idx_assets_full_text_search`.
- `public.search_style_guide_library_v2`: searches `public.style_guide_search_documents.search_vector`, joining `public.style_guide_files` only by `id` (`style_guide_files_pkey`). `directory_path` is only projected in output JSON (never filtered via `ILIKE`/`%` on `public.style_guide_files`), and `tag_search_text` is never referenced.
- `public.get_ai_tag_candidates`: reads `public.assets` exclusively through the retained `idx_assets_ai_tag_all_candidates` and `idx_assets_ai_tag_untagged_candidates` indexes.

### Representative Live `EXPLAIN (ANALYZE, BUFFERS)` Results

| Workload | Plan / Index Used | Execution Time |
|---|---|---|
| `public.search_dam_documents('mickey', '{}', 20, 0)` | RPC returned 20 rows (cold buffers: 13,496 disk reads) | 3864.5 ms |
| `public.search_assets_full_text('mickey', 20)` | RPC returned 20 rows (warm buffers) | 652.2 ms |
| `public.search_style_guide_library_v2` (keyword `'mickey'`, `service_role`) | RPC succeeded; unauthorized call rejected `42501: PopSG access required` | 1631.1 ms |
| `public.search_style_guide_library_v2` (tag filter `['mickey']`, `service_role`) | RPC succeeded | 3300.9 ms |
| `public.get_ai_tag_candidates('all', 20)` + inner query | **Index Only Scan** on `idx_assets_ai_tag_all_candidates` | 23.0 ms RPC / 9.6 ms inner |
| `public.get_ai_tag_candidates('untagged', 20)` + inner query | **Index Only Scan** on `idx_assets_ai_tag_untagged_candidates` | 62.2 ms RPC / 8.0 ms inner |
| `public.style_guide_files` equality browse (`directory_path = ... AND is_active`) | **Index Scan** on `idx_sgf_directory_path` | 4.3 ms |
| `public.style_guide_files` path search (`relative_path ILIKE '%mickey%'`) | **Index Scan** on `idx_sgf_active_preview_category` | 7.5 ms |
| `public.assets` path search (`relative_path ILIKE '%mickey%'`) | **Bitmap Index Scan** on `idx_assets_relative_path_trgm` | 60.6 ms |
| `public.style_guide_search_documents` (`search_vector`) & `public.dam_search_keys` (`search_tsv`) | Direct full-text inner checks | 4.1 ms / 3.2 ms |

### Representative App Access (`has_function_privilege`)
- `authenticated = t`, `service_role = t`, `anon = f`: `search_assets_full_text`, `search_dam_documents`, `search_dam_image_similarity`, `search_style_guide_library`, `search_style_guide_library_v2`, `search_style_groups_full_text`.
- `authenticated = f`, `service_role = t`, `anon = f`: `get_ai_tag_candidates`.
- `search_style_guide_library_v2` verified to enforce `42501: PopSG access required` when invoked without `service_role` or an authorized `styleguides` user JWT.
