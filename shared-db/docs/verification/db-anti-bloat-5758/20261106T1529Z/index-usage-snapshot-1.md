---
summary: "Issue 5758 Step 5 index audit snapshot 1 (2026-11-06): idx_scan and size per index; snapshot 2 due on or after 2026-11-20 to find drop candidates."
kind: proof
status: open
read-when: taking 5758 index-usage snapshot 2 or choosing index drop candidates
---

# Step 5 index audit — usage snapshot 1 (#5758)

Taken 2026-11-06 10:28 AM EST (15:28 UTC) on production, read-only `SELECT` via Supabase MCP.
`pg_stat_database.stats_reset` = NULL (counters accumulate since the stats were last initialised; no reset recorded).
Scope: plan §3 tables; `public.assets` excluded (#5747). Step 6 flags will be added at snapshot 2.

**Snapshot 2 is due on or after 2026-11-20** (≥ 14 days). Drop candidates = indexes whose `idx_scan` is unchanged between the
two snapshots, have no constraint role, and no reference in any function/view/policy (git grep across shared-db, popdam3,
designflow-backend). If `stats_reset` changes between snapshots, restart the window.

Query: `pg_stat_user_indexes` joined to `pg_index`, constraint from `pg_constraint.conindid`.

| table | index | idx_scan | bytes | constraint |
|---|---|---:|---:|---|
| coldlion.change_log | change_log_pkey | 338 | 39886848 | p |
| coldlion.change_log | coldlion_change_log_natural_key_idx | 0 | 15712256 | |
| coldlion.change_log | coldlion_change_log_run_idx | 4 | 8036352 | |
| coldlion.change_log | coldlion_change_log_table_changed_idx | 377 | 7856128 | |
| hts_rag.hts_rag_ruling_ingest_jobs | hts_rag_ruling_ingest_jobs_claim_idx | 92681 | 729088 | |
| hts_rag.hts_rag_ruling_ingest_jobs | hts_rag_ruling_ingest_jobs_open_uq | 85960 | 573440 | unique index |
| hts_rag.hts_rag_ruling_ingest_jobs | hts_rag_ruling_ingest_jobs_pkey | 57024 | 2924544 | p |
| hts_rag.hts_rag_ruling_ingest_jobs | hts_rag_ruling_ingest_jobs_source_determination_idx | 0 | 966656 | |
| hts_rag.hts_rag_rulings | hts_rag_rulings_category_status_idx | 0 | 12255232 | |
| hts_rag.hts_rag_rulings | hts_rag_rulings_operationally_revoked_idx | 0 | 2121728 | |
| hts_rag.hts_rag_rulings | hts_rag_rulings_pkey | 17111 | 8798208 | p |
| hts_rag.hts_rag_rulings | hts_rag_rulings_ruling_date_idx | 0 | 3219456 | |
| hts_rag.hts_rag_rulings | hts_rag_rulings_ruling_number_key | 8855 | 8175616 | u |
| hts_rag.hts_rag_rulings | hts_rag_rulings_scope_cover_idx | 940004 | 54419456 | |
| hts_rag.hts_rag_rulings | hts_rag_rulings_search_trgm_idx | 0 | 539803648 | |
| hts_rag.hts_rag_rulings | hts_rag_rulings_search_tsv_active_idx | 1243 | 149209088 | |
| hts_rag.hts_rag_rulings | hts_rag_rulings_subheadings_idx | 0 | 1769472 | |
| hts_rag.hts_rag_rulings | hts_rag_rulings_subject_trgm_active_idx | 667 | 51560448 | |
| ingest.raw_record | raw_record_pkey | 0 | 7233536 | p |
| ingest.raw_record | raw_record_source_system_source_table_source_id_key | 59852 | 18702336 | u |
| plm.item | item_pkey | 666757 | 1236992 | p |
| plm.item | item_product_depth_id_idx | 0 | 8192 | |
| plm.item | item_product_size_id_idx | 0 | 8192 | |
| plm.item | item_source_system_source_id_key | 119701 | 2252800 | u |
| plm.item | item_upper_trim_item_number_idx | 660825 | 1163264 | |
| plm.item | plm_item_style_idx | 0 | 532480 | |
| plm.item_import | item_import_item_id_idx | 79892 | 1712128 | |
| plm.item_import | item_import_outcome_idx | 3 | 1122304 | |
| plm.item_import | item_import_pkey | 259076 | 1736704 | p |
| plm.item_import_unresolved | item_import_unresolved_outcome_idx | 1 | 786432 | |
| plm.item_import_unresolved | item_import_unresolved_pkey | 0 | 2408448 | p |
| plm.style_tracker_item_bridge | idx_style_tracker_item_bridge_company | 0 | 638976 | |
| plm.style_tracker_item_bridge | idx_style_tracker_item_bridge_creative_designer | 0 | 393216 | |
| plm.style_tracker_item_bridge | idx_style_tracker_item_bridge_erp_item | 0 | 1220608 | |
| plm.style_tracker_item_bridge | idx_style_tracker_item_bridge_match_status | 2 | 1138688 | |
| plm.style_tracker_item_bridge | idx_style_tracker_item_bridge_row | 260 | 1384448 | |
| plm.style_tracker_item_bridge | idx_style_tracker_item_bridge_sku | 0 | 1507328 | |
| plm.style_tracker_item_bridge | idx_style_tracker_item_bridge_style_group | 0 | 1646592 | |
| plm.style_tracker_item_bridge | style_tracker_item_bridge_pkey | 0 | 1318912 | p |
| plm.style_tracker_item_bridge | style_tracker_item_bridge_plm_item_cover_idx | 255 | 8388608 | |
| plm.style_tracker_item_bridge | style_tracker_item_bridge_row_unique | 743903 | 1335296 | u |
| public.style_guide_search_documents | idx_sg_search_documents_claim_pending | 0 | 60334080 | |
| public.style_guide_search_documents | idx_sg_search_documents_embedding_hnsw | 441 | 831963136 | |
| public.style_guide_search_documents | idx_sg_search_documents_embedding_pending | 0 | 16105472 | |
| public.style_guide_search_documents | idx_sg_search_documents_filters | 4 | 15917056 | |
| public.style_guide_search_documents | idx_sg_search_documents_meter_embedded | 1 | 9142272 | |
| public.style_guide_search_documents | idx_sg_search_documents_meter_errored | 0 | 16384 | |
| public.style_guide_search_documents | idx_sg_search_documents_meter_exhausted | 0 | 8192 | |
| public.style_guide_search_documents | idx_sg_search_documents_meter_lease | 0 | 4530176 | |
| public.style_guide_search_documents | idx_sg_search_documents_meter_pending | 49522 | 13262848 | |
| public.style_guide_search_documents | idx_sg_search_documents_meter_unidentified | 0 | 8192 | |
| public.style_guide_search_documents | idx_sg_search_documents_meter_updated_at | 0 | 6471680 | |
| public.style_guide_search_documents | idx_sg_search_documents_search_vector | 2732 | 78667776 | |
| public.style_guide_search_documents | idx_sg_search_documents_stable_page | 0 | 18866176 | |
| public.style_guide_search_documents | style_guide_search_documents_pkey | 313431 | 14401536 | p |

Notable zero-scan non-constraint candidates so far (not decisions): `hts_rag_rulings_search_trgm_idx` (515 MB),
`idx_sg_search_documents_claim_pending` (58 MB), `idx_sg_search_documents_stable_page`, `idx_sg_search_documents_embedding_pending`,
`hts_rag_rulings_category_status_idx`, `coldlion_change_log_natural_key_idx` (likely needed by Step 2 rotation — check its plan).
Step 4 may rework `style_guide_search_documents` lease indexes before snapshot 2; re-list that table then.
