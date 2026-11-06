# #5610 second restart: new measured observation, acceptance pending

The owning coordinator retains [#5610](https://github.com/popcre/shared-db/issues/5610). A fresh target-proved, bounded read-only catalog collection observed another production restart. This record contains catalog metadata only; no business rows or licensed values were read/exported. No index/statistics/configuration/database write was performed.

The November 4 initial window and November 6 **8:59:18 AM EST** successor window are both invalid. The actual new postmaster identity is November 6, 2026, **11:20:19.434455 AM EST**; statement statistics reset is **11:20:19.263334 AM EST**, global dealloc 0, database stats_reset NULL. Restart time is not substituted for measured opening.

The coordinator explicitly declares the conservative measured new opening at the actual collection time: November 6, 2026, **11:25:52.885243 AM EST**. Earliest eligibility is November 20, 2026, **11:25:52.885243 AM EST**, conditional on an uninterrupted fourteen days with unchanged reset/postmaster/index identity, monotonic counters, complete then-current nine-consumer reader/planned-use proof and every existing preview/promotion/post-removal acceptance requirement. Any further reset/restart invalidates this interval again. The date alone does not authorize removal.

All eleven original indexes remain present with unchanged OIDs and complete definitions, valid and ready. All current counters are zero after this restart; that never erases historical positive KEEP evidence for `idx_style_guide_file_tags_tag_status`, `idx_assets_ai_tag_untagged_candidates`, and `dam_search_embedding_claim_idx`. All four vector indexes remain protected. There is no removal quota.

The four candidates remain directory-path trigram, assets tags, style-guide tag-search trigram and assets full-text. The historical ~329 MiB figure stays historical. Exact current bytes below total 266895360 (approximately 254.53 MiB), a storage observation only, not authorization or a promised saving. Positive reader discovery continues independently; no no-reader/coverage/drop claim is made here.

## Exact catalog output

```json
[
  {
    "observed_at": "2026-11-06 11:25:52.885243-05",
    "postmaster_started_at": "2026-11-06 11:20:19.434455-05",
    "stats_reset": null,
    "index_identity_baseline": [
      {
        "bytes": 255746048,
        "index": "dam_asset_image_vectors_vec_dino_hnsw",
        "ready": true,
        "scans": 0,
        "table": "dam_asset_image_vectors",
        "valid": true,
        "schema": "dam",
        "unique": false,
        "primary": false,
        "index_oid": "21299600",
        "last_scan": null,
        "table_oid": "21299583",
        "definition": "CREATE INDEX dam_asset_image_vectors_vec_dino_hnsw ON dam.dam_asset_image_vectors USING hnsw (vec_dino extensions.halfvec_cosine_ops) WITH (m='16', ef_construction='64') WHERE (vec_dino IS NOT NULL)"
      },
      {
        "bytes": 256040960,
        "index": "dam_asset_image_vectors_vec_siglip_hnsw",
        "ready": true,
        "scans": 0,
        "table": "dam_asset_image_vectors",
        "valid": true,
        "schema": "dam",
        "unique": false,
        "primary": false,
        "index_oid": "21299601",
        "last_scan": null,
        "table_oid": "21299583",
        "definition": "CREATE INDEX dam_asset_image_vectors_vec_siglip_hnsw ON dam.dam_asset_image_vectors USING hnsw (vec_siglip extensions.halfvec_cosine_ops) WITH (m='16', ef_construction='64') WHERE (vec_siglip IS NOT NULL)"
      },
      {
        "bytes": 11780096,
        "index": "dam_search_embedding_claim_idx",
        "ready": true,
        "scans": 0,
        "table": "dam_search_documents",
        "valid": true,
        "schema": "public",
        "unique": false,
        "primary": false,
        "index_oid": "20491117",
        "last_scan": null,
        "table_oid": "713489",
        "definition": "CREATE INDEX dam_search_embedding_claim_idx ON public.dam_search_documents USING btree (indexed_at, document_type, entity_id) WHERE (embedding IS NULL)"
      },
      {
        "bytes": 14589952,
        "index": "idx_assets_ai_tag_untagged_candidates",
        "ready": true,
        "scans": 0,
        "table": "assets",
        "valid": true,
        "schema": "public",
        "unique": false,
        "primary": false,
        "index_oid": "978880",
        "last_scan": null,
        "table_oid": "17809",
        "definition": "CREATE INDEX idx_assets_ai_tag_untagged_candidates ON public.assets USING btree (primary_sort_tier, id) INCLUDE (thumbnail_url, filename, relative_path, style_group_id) WHERE ((is_deleted = false) AND (thumbnail_url IS NOT NULL) AND (primary_sort_tier <> ALL (ARRAY[4, 8])) AND (status <> 'tagged'::asset_status))"
      },
      {
        "bytes": 52879360,
        "index": "idx_assets_full_text_search",
        "ready": true,
        "scans": 0,
        "table": "assets",
        "valid": true,
        "schema": "public",
        "unique": false,
        "primary": false,
        "index_oid": "464884",
        "last_scan": null,
        "table_oid": "17809",
        "definition": "CREATE INDEX idx_assets_full_text_search ON public.assets USING gin (to_tsvector('simple'::regconfig, ((((((((((((((((((COALESCE(filename, ''::text) || ' '::text) || COALESCE(relative_path, ''::text)) || ' '::text) || COALESCE(cover_description, ''::text)) || ' '::text) || COALESCE(ai_description, ''::text)) || ' '::text) || COALESCE(scene_description, ''::text)) || ' '::text) || COALESCE(customer, ''::text)) || ' '::text) || COALESCE(program, ''::text)) || ' '::text) || COALESCE(licensor_name, ''::text)) || ' '::text) || COALESCE(property_name, ''::text)) || ' '::text) || COALESCE(product_category, ''::text)))) WHERE (is_deleted = false)"
      },
      {
        "bytes": 17489920,
        "index": "idx_assets_tags",
        "ready": true,
        "scans": 0,
        "table": "assets",
        "valid": true,
        "schema": "public",
        "unique": false,
        "primary": false,
        "index_oid": "17966",
        "last_scan": null,
        "table_oid": "17809",
        "definition": "CREATE INDEX idx_assets_tags ON public.assets USING gin (tags)"
      },
      {
        "bytes": 587333632,
        "index": "idx_dam_search_documents_embedding_hnsw",
        "ready": true,
        "scans": 0,
        "table": "dam_search_documents",
        "valid": true,
        "schema": "public",
        "unique": false,
        "primary": false,
        "index_oid": "20616524",
        "last_scan": null,
        "table_oid": "713489",
        "definition": "CREATE INDEX idx_dam_search_documents_embedding_hnsw ON public.dam_search_documents USING hnsw (embedding extensions.vector_cosine_ops) WHERE (embedding IS NOT NULL)"
      },
      {
        "bytes": 831963136,
        "index": "idx_sg_search_documents_embedding_hnsw",
        "ready": true,
        "scans": 0,
        "table": "style_guide_search_documents",
        "valid": true,
        "schema": "public",
        "unique": false,
        "primary": false,
        "index_oid": "25586291",
        "last_scan": null,
        "table_oid": "10834314",
        "definition": "CREATE INDEX idx_sg_search_documents_embedding_hnsw ON public.style_guide_search_documents USING hnsw (embedding extensions.vector_cosine_ops) WHERE (embedding IS NOT NULL)"
      },
      {
        "bytes": 118513664,
        "index": "idx_sgf_directory_path_trgm",
        "ready": true,
        "scans": 0,
        "table": "style_guide_files",
        "valid": true,
        "schema": "public",
        "unique": false,
        "primary": false,
        "index_oid": "2957816",
        "last_scan": null,
        "table_oid": "18497",
        "definition": "CREATE INDEX idx_sgf_directory_path_trgm ON public.style_guide_files USING gin (directory_path extensions.gin_trgm_ops)"
      },
      {
        "bytes": 126795776,
        "index": "idx_style_guide_file_tags_tag_status",
        "ready": true,
        "scans": 0,
        "table": "style_guide_file_tags",
        "valid": true,
        "schema": "public",
        "unique": false,
        "primary": false,
        "index_oid": "3822940",
        "last_scan": null,
        "table_oid": "3822865",
        "definition": "CREATE INDEX idx_style_guide_file_tags_tag_status ON public.style_guide_file_tags USING btree (tag_id, status, style_guide_file_id)"
      },
      {
        "bytes": 78012416,
        "index": "idx_style_guide_files_tag_search_trgm",
        "ready": true,
        "scans": 0,
        "table": "style_guide_files",
        "valid": true,
        "schema": "public",
        "unique": false,
        "primary": false,
        "index_oid": "3822946",
        "last_scan": null,
        "table_oid": "18497",
        "definition": "CREATE INDEX idx_style_guide_files_tag_search_trgm ON public.style_guide_files USING gin (tag_search_text extensions.gin_trgm_ops)"
      }
    ],
    "statement_stats_reset": "2026-11-06 11:20:19.263334-05",
    "statement_dealloc": 0
  }
]
```

## Exact bounded read-only query

```sql
select statement_timestamp() observed_at,pg_postmaster_start_time() postmaster_started_at,
(select stats_reset from pg_stat_database where datname=current_database()) stats_reset,
(select stats_reset from extensions.pg_stat_statements_info) statement_stats_reset,
(select dealloc from extensions.pg_stat_statements_info) statement_dealloc,
jsonb_agg(jsonb_build_object('schema',n.nspname,'index',c.relname,'table',t.relname,'index_oid',c.oid::text,'table_oid',t.oid::text,'definition',pg_get_indexdef(c.oid),'bytes',pg_relation_size(c.oid),'scans',s.idx_scan,'last_scan',s.last_idx_scan,'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'primary',i.indisprimary) order by n.nspname,c.relname) index_identity_baseline
from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_index i on i.indexrelid=c.oid join pg_class t on t.oid=i.indrelid left join pg_stat_user_indexes s on s.indexrelid=c.oid
where c.oid=any(array[to_regclass('dam.dam_asset_image_vectors_vec_dino_hnsw'),to_regclass('dam.dam_asset_image_vectors_vec_siglip_hnsw'),to_regclass('public.dam_search_embedding_claim_idx'),to_regclass('public.idx_assets_ai_tag_untagged_candidates'),to_regclass('public.idx_assets_full_text_search'),to_regclass('public.idx_assets_tags'),to_regclass('public.idx_dam_search_documents_embedding_hnsw'),to_regclass('public.idx_sg_search_documents_embedding_hnsw'),to_regclass('public.idx_sgf_directory_path_trgm'),to_regclass('public.idx_style_guide_file_tags_tag_status'),to_regclass('public.idx_style_guide_files_tag_search_trgm')]);

```

Target identity was freshly proved against the configured production project immediately before this SELECT. No project reference or credential value is copied into this receipt.
