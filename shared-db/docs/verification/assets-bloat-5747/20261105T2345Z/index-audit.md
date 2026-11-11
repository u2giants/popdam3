---
summary: "public.assets index audit for #5747 Step 3: 46 indexes, 1,345 MB; no drops now, earliest drop decision 2026-11-18 after stats reset."
kind: proof
status: open
read-when: deciding whether to drop unused public.assets indexes after 2026-11-18
---

# public.assets index audit (plan Step 3, popcre/shared-db#5747)

Read 2026-11-05 ~6:45 PM EST, production (`qsllyeztdwjgirsysgai`), read-only
`pg_stat_user_indexes` / `pg_relation_size` / `pg_constraint`.

Query: `select indexrelname, pg_relation_size(indexrelid), idx_scan, last_idx_scan, contype, pg_get_indexdef(indexrelid) from pg_stat_user_indexes i left join pg_constraint c on c.conindid=i.indexrelid where relid='public.assets'::regclass`

**Verdict now: no drops.** Index counters were reset 2026-11-04, so fewer than
14 days are observable. Earliest drop decision: **2026-11-18 EST**, re-run the
same query then (plan Step 3 gate is unchanged; no substitute gate).

Totals: 46 indexes, 1,345 MB. Constraint-backed (never drop): `assets_pkey`
(primary key, referenced by 17 foreign keys), `assets_relative_path_unique` (unique).

## Zero scans since reset (28 indexes, ~880 MB) — candidates for the 2026-11-18 re-check

| index | MB | definition |
|---|---|---|
| idx_assets_relative_path_trgm | 281 | gin (relative_path gin_trgm_ops) |
| idx_assets_tags | 80 | gin (tags) |
| idx_assets_filename_trgm | 71 | gin (filename gin_trgm_ops) |
| idx_assets_full_text_search | 64 | gin to_tsvector(simple, filename…product_category) where not is_deleted |
| idx_assets_ai_tag_untagged_candidates | 61 | btree (primary_sort_tier,id) include(…) partial, status<>'tagged' |
| idx_assets_tag_visible_facets | 30 | btree (id) include(facets) where visible |
| idx_assets_program_trgm | 24 | gin (program gin_trgm_ops) |
| idx_assets_primary_sort_tier | 17 | btree (style_group_id, primary_sort_tier, created_at) |
| idx_assets_pdf_not_deleted | 12 | btree (file_type,id) |
| idx_assets_file_created_at | 12 | btree (file_created_at) |
| assets_style_group_changed_at_idx | 11 | btree (style_group_changed_at,id) |
| idx_assets_customer_trgm | 10 | gin (customer gin_trgm_ops) |
| idx_assets_ai_tagged_at | 10 | btree (ai_tagged_at) partial |
| idx_assets_modified_at | 9 | btree (modified_at) |
| idx_assets_stage / is_deleted / file_type | 8 each | btree single column |
| idx_assets_program / status / workflow_status / customer | 6 each | btree single column |
| idx_assets_is_licensed | 5 | btree (is_licensed) |
| idx_assets_compat_audit | 4 | btree (id) partial ai files |
| idx_assets_product_material_gin | 2 | gin (product_material) |
| idx_assets_ai_tag_tagged_groups | 2 | btree (style_group_id) partial |
| idx_assets_licensing_pdf_backfill_candidates | 1 | btree (id) partial |
| idx_assets_pdf_rescan_candidates | 0 | btree (id) partial |
| idx_assets_tag_pending_facets | 0 | btree (id) include(…) partial |

Caution for the re-check: several zero-scan indexes back periodic jobs
(PDF rescan/backfill, compat audit, untagged-candidate queue) that may run less
than daily; 14 days of zero scans plus a code-reference search across shared-db
functions and popdam3 is still required per index before any drop.

## Used since reset (16 indexes + pkey)

idx_assets_embed_stale_cover 411,022; assets_pkey 274,931;
assets_style_group_id_active_idx 90,832; idx_assets_tag_rls_visible_ids 37,787;
assets_relative_path_unique 18,931; idx_assets_style_group_id 8,170;
idx_assets_sku_division_active 2,550; idx_assets_thumbnail_error_pattern 2,032;
idx_assets_property_id 580; idx_assets_ai_tag_all_candidates 367 (210 MB);
idx_assets_quick_hash 85; idx_assets_clear_style_cursor 81;
assets_ungrouped_style_cursor_idx 56; idx_assets_licensor_id 54;
idx_assets_facet_counts 28 (164 MB); assets_customer_id_idx 28;
idx_assets_has_product_material 24; idx_assets_product_subtype_id 4.
