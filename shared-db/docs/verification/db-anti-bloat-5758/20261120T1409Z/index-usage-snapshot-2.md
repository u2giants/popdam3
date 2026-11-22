---
summary: "Issue 5758 Step 5 index audit snapshot 2 (2026-11-20): every zero-scan index is referenced, constraint-backing, or owned by #5610/#5747; no drops."
kind: proof
status: done
read-when: deciding index drops on the 5758 busy tables or re-running the Step 5 audit
---

# Step 5 index audit — usage snapshot 2 and decision (#5758)

Taken 2026-11-20 9:01 AM EST (14:01 UTC) on production, read-only `SELECT` via Supabase MCP.
Snapshot 1: [index-usage-snapshot-1.md](../20261106T1529Z/index-usage-snapshot-1.md), 2026-11-06 10:28 AM EST.

## Counter window

- `pg_stat_database.stats_reset` = NULL at both snapshots (field unchanged).
- **But the server restarted 52 minutes after snapshot 1**: `pg_postmaster_start_time()` = 2026-11-06 11:20:19 AM EST
  (the same restart recorded on #5610); `pg_stat_wal`/`pg_stat_io` `stats_reset` = 11:20:19 AM EST. The index
  counters were cleared at that restart even though the database-level field stayed NULL — several indexes went
  *down* between snapshots (`coldlion_change_log_run_idx` 4 → 0, `idx_sg_search_documents_meter_pending`
  49,522 → 0, `idx_sg_search_documents_embedding_hnsw` 441 → 0, `idx_sg_search_documents_filters` 4 → 0).
- So snapshot-1 numbers are not a valid baseline. The usable window is **restart → snapshot 2: 13 days 21 h 41 m**
  of counters starting from zero. `idx_scan` = 0 at snapshot 2 therefore means "no scan since 2026-11-06 11:20 AM EST".
- Why the decision does not wait for a fresh 14-day window: a longer window can only add scans, so it can only
  remove candidates. Every zero-scan index below already fails a non-usage criterion (reference, constraint, or
  another issue's ownership), so no wait could turn any of them into a safe drop.

Scope: plan §3 tables plus the Step 6 weekly-check flags (#5886, reading 2026-11-16) and the Step 4 side table:
`coldlion.item_merch_group`, `hts_rag.hts_rag_ruling_products`, `public.dam_search_documents`,
`public.dam_search_keys`, `public.style_guide_files`, `plm.marvel_asgard_node_asset_observation`,
`public.style_guide_search_embedding_jobs`. Excluded: `public.assets` (#5747) and the indexes whose single decision
belongs to #5610 (`hts_rag_rulings_search_trgm_idx`, `idx_sgf_directory_path_trgm`,
`idx_style_guide_files_tag_search_trgm`).

Method: `pg_stat_user_indexes` joined to `pg_index`; constraint role from `pg_constraint.conindid`; size from
`pg_relation_size`. References: catalog scan of every non-system function body, view, materialized view and RLS policy
for the index name, and for its leading column together with its table name; foreign keys whose referencing column is
the index's leading column; `git grep` on `popcre/shared-db` `origin/main` (acc5d3dd5), `u2giants/popdam3`
`origin/main`, and `popcre/designflow-backend` `origin/develop` (9953faee8).

## Zero scans since the restart (all non-constraint candidates)

| table | index | bytes | reason it is not a safe drop |
|---|---|---:|---|
| coldlion.change_log | coldlion_change_log_natural_key_idx | 16,171,008 | leading column `natural_key` referenced by `coldlion.rotate_change_log` (Step 2 weekly job). Note: it is GIN `jsonb_path_ops`, which serves only `@>`; the rotation's window ordering and `tools/coldlion-landing/lib/prod-details.mjs`' `natural_key = …` lookup cannot use it. Re-evaluate in a later audit with that in mind |
| coldlion.change_log | coldlion_change_log_run_idx | 8,167,424 | backs FK `change_log_run_id_fkey` → `coldlion.sync_run` |
| hts_rag.hts_rag_ruling_ingest_jobs | hts_rag_ruling_ingest_jobs_source_determination_idx | 1,368,064 | backs FK `source_determination_fkey … ON DELETE SET NULL` |
| hts_rag.hts_rag_ruling_products | hts_rag_ruling_products_fts_idx | 33,603,584 | read by `hts_rag.hts_rag_search_rulings_pass` (full-text leg) via designflow-backend `helpers/hts-rag/ruling-product-search.js`; table bulk-loaded this month (Step 6 flag) |
| hts_rag.hts_rag_ruling_products | hts_rag_ruling_products_phrase_trgm_idx | 33,300,480 | same function, trigram leg |
| hts_rag.hts_rag_rulings | hts_rag_rulings_subheadings_idx | 2,269,184 | expression `hts_rag_tariff_subheadings(tariffs) @> …` in designflow-backend `helpers/hts-rag-precheck.js:107` |
| plm.item | item_product_depth_id_idx / item_product_size_id_idx | 8,192 each | column read by `api.plm_item_list`; FK-backing; nothing to reclaim |
| plm.style_tracker_item_bridge | idx_style_tracker_item_bridge_creative_designer | 393,216 | `plm.apply_style_tracker_designer_resolutions`, `public.style_tracker_rows_with_bridge` |
| plm.style_tracker_item_bridge | idx_style_tracker_item_bridge_erp_item | 1,220,608 | `plm.refresh_style_tracker_item_bridge`, `public.style_tracker_rows_with_bridge` |
| plm.style_tracker_item_bridge | idx_style_tracker_item_bridge_sku | 1,507,328 | 10 readers incl. `public.link_dam_order_line`, `api.dam_order_list` |
| public.style_guide_files | idx_sgf_licensor_name | 13,639,680 | 13 readers incl. `search_style_guide_library_v2`, library snapshots |
| public.style_guide_files | idx_sgf_normalized_name | 17,768,448 | `public.upsert_style_guide_crawl_files` |
| public.style_guide_files | idx_sgf_property_folder | 20,070,400 | 13 readers incl. `search_style_guide_library_v2` |
| public.style_guide_files | idx_sgf_render_errored | 589,824 | `retry_sg_render_errors`, `get_sg_preview_stats` |
| public.style_guide_files | idx_sgf_style_guide_folder | 13,385,728 | 8 readers incl. `search_style_guide_library_v2` |
| public.style_guide_files | idx_style_guide_files_active_modified | 22,462,464 | 9 readers incl. `claim_style_guide_pdf_text` |
| public.style_guide_files | idx_style_guide_files_tag_names | 13,361,152 | 8 readers incl. `refresh_style_guide_file_tag_cache` |
| public.style_guide_search_documents | idx_sg_search_documents_claim_pending | 60,334,080 | `claim_sg_search_embedding_documents` + 6 more; Step 4 froze the legacy queue columns and drops them in a later release — the index goes with them |
| public.style_guide_search_documents | idx_sg_search_documents_filters | 16,072,704 | `search_style_guide_library(_v2)`, library matviews |
| public.style_guide_search_documents | idx_sg_search_documents_meter_errored / _meter_exhausted / _meter_pending | 16,384 / 8,192 / 13,262,848 | `get_search_embedding_health`; Step 4 legacy-column release |
| public.style_guide_search_documents | idx_sg_search_documents_stable_page | 19,021,824 | `search_style_guide_library(_v2)` paging |
| public.style_guide_search_documents | idx_sg_search_documents_embedding_hnsw | 839,524,352 | vector index — never dropped (#5610 protection) |

Constraint-backing zero-scan indexes (`ingest.raw_record` `raw_record_pkey`, `plm.marvel_asgard_node_asset_observation`
pkey) are out of scope by rule. Every other scoped index had scans in the window.

## Result

**No safe drops.** No migration authored; no production change made. Step 5 gate (plan): "audit doc records 'no safe
drops'" — met by this file.

## Observations for other owners (not drop decisions)

- `idx_sg_search_documents_embedding_hnsw` (839 MB) had 441 scans before the restart and **0 in the 14 days since**,
  while PopSG semantic search is live. Either nobody ran a semantic style-guide search, or the search plan stopped
  using the vector index (a performance bug). Same question #5610's plan raises for DAM HNSW; worth one `EXPLAIN`.
- `coldlion_change_log_natural_key_idx` cannot serve any current reader (see row 1); a future audit could drop it once
  the rotation function's reference is confirmed to need no `@>` lookup.
