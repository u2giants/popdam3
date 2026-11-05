# public.assets baseline before repack (popcre/shared-db#5747 Step 0)

Captured read-only on production `qsllyeztdwjgirsysgai`, 6:31-6:35 PM EST 2026-11-05, via Supabase `execute_sql` (SELECT only).

## Sizes and counts
Query: `pg_relation_size`, `pg_indexes_size`, `pg_total_relation_size`, `pg_relation_size(reltoastrelid)`, `relpages`, `reltuples`, `sum(pg_column_size(a.*))`, counts from `pg_index` / `pg_constraint` / `pg_trigger (not tgisinternal)`, `relacl` for `public.assets`.

| Measure | Value |
|---|---|
| Heap | 2,122,317,824 B (2,024 MB), 259,072 pages |
| Indexes | 1,410,039,808 B (1,345 MB) |
| TOAST | 131,129,344 B (125 MB) |
| Total | 3,666,231,296 B (3,496 MB) |
| Live row bytes (`sum(pg_column_size)`) | 192,839,464 B (184 MB) |
| reltuples | 151,540 |
| Index count | 46 |
| Constraint count | 8 |
| User trigger count | 25 |
| ACL | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` |
| Database size | 32,832,771,763 B (30.6 GB) |

`pgstattuple`, `pg_visibility` and `pg_repack` are available but **not installed** on production, so `pgstattuple_approx` and the visibility map summary were not recorded; live bytes come from `sum(pg_column_size)` as the plan allows. `pg_repack` absent means the install migration `20261105201736_install_pg_repack.sql` (on `main`) has not yet promoted.

## Write churn (`pg_stat_user_tables`)
n_live_tup 151,540; n_dead_tup 20,260; n_tup_upd 101,714; n_tup_hot_upd 57,528 (HOT 56.6%); last_autovacuum 5:11 PM EST 2026-11-05; database `stats_reset` null; `pg_stat_statements_info.stats_reset` 1:40 PM EST 2026-11-05.

`pg_stat_statements` filter `update%public.assets%` / `update "public"."assets"%` returned **no rows** (writers use other statement text, e.g. PostgREST CTE form); Step 2 owns finding them.

## Per-index size (MB) and idx_scan
idx_assets_relative_path_trgm 281/0; idx_assets_ai_tag_all_candidates 209/364; idx_assets_facet_counts 164/28; idx_assets_tags 80/0; idx_assets_filename_trgm 71/0; idx_assets_full_text_search 64/0; assets_relative_path_unique 63/18855; idx_assets_ai_tag_untagged_candidates 61/0; idx_assets_embed_stale_cover 48/408516; idx_assets_tag_visible_facets 30/0; idx_assets_program_trgm 24/0; idx_assets_quick_hash 19/85; idx_assets_primary_sort_tier 17/0; idx_assets_pdf_not_deleted 12/0; idx_assets_file_created_at 12/0; assets_style_group_changed_at_idx 11/0; assets_pkey 11/274931; idx_assets_customer_trgm 10/0; idx_assets_ai_tagged_at 10/0; idx_assets_modified_at 9/0; assets_style_group_id_active_idx 9/90752; idx_assets_stage 8/0; idx_assets_licensor_id 8/54; idx_assets_file_type 8/0; idx_assets_tag_rls_visible_ids 8/37787; idx_assets_is_deleted 8/0; idx_assets_clear_style_cursor 7/81; idx_assets_property_id 7/580; idx_assets_program 6/0; idx_assets_style_group_id 6/8138; idx_assets_workflow_status 6/0; idx_assets_status 6/0; idx_assets_customer 6/0; idx_assets_is_licensed 5/0; idx_assets_product_subtype_id 5/3; idx_assets_compat_audit 4/0; idx_assets_product_material_gin 2/0; idx_assets_sku_division_active 2/2527; assets_ungrouped_style_cursor_idx 2/56; idx_assets_ai_tag_tagged_groups 2/0; idx_assets_licensing_pdf_backfill_candidates 1/0; assets_customer_id_idx 0/28; idx_assets_pdf_rescan_candidates 0/0; idx_assets_tag_pending_facets 0/0; idx_assets_has_product_material 0/24; idx_assets_thumbnail_error_pattern 0/2032.

## Search baseline
The broad-search `EXPLAIN (ANALYZE, BUFFERS)` from u2giants/popdam3#804 (2:30 PM EST: 41 s, 26.5 s in `exact_docs`) is the baseline; its exact query text is not recorded on #804, so it was not re-run. Search test set baseline: https://github.com/u2giants/popdam3/actions/runs/42089911882 (2:01-2:16 PM EST; typical 4.1 s, slowest 7.9 s).
