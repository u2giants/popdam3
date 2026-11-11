---
summary: Issue 5610 opening snapshot of the unused-index observation window (2026-11-04); earliest close review 2026-11-18, two candidates kept.
kind: proof
status: open
read-when: closing the unused-index observation window on or after 2026-11-18
---

# Issue #5610 — opening index observation

Observed: November 4, 2026, 10:35 PM EST (America/New_York).
Production target verified immediately before read: the project matching protected configuration key `supabase_shared_prod_ref` (project URL checked through the connected read-only tool).
Read-only catalog queries; no database changes or statistics resets.

Postmaster started: November 4, 2026, 12:52:59 PM EST.
`pg_stat_database.stats_reset`: NULL.
Earliest close-snapshot review: November 18, 2026, 8:55 PM EST, subject to unchanged postmaster/statistics continuity. This opening evidence does not satisfy the observation period.

Two original drop candidates already have reads: `public.idx_style_guide_file_tags_tag_status` (72) and `public.idx_assets_ai_tag_untagged_candidates` (2). Keep both under the plan's any-scans rule. The old `public.dam_search_embedding_claim_idx` also has 18 reads and stays. The remaining four original candidates total 345,194,496 bytes (about 329 MiB); zero scans today does not authorize dropping them.

## Exact read-only queries

The first call combined these statements; the tool returned the final index result set. The timestamp statement was then repeated separately to preserve its result.

```sql
select now() observed_at, pg_postmaster_start_time() postmaster_started_at,
       (select stats_reset from pg_stat_database
        where datname=current_database()) stats_reset;

select s.schemaname, s.relname, s.indexrelname, s.idx_scan,
       s.last_idx_scan, pg_relation_size(s.indexrelid) bytes,
       pg_get_indexdef(s.indexrelid) definition
from pg_stat_user_indexes s
join pg_index i using(indexrelid)
where not i.indisunique and not i.indisprimary
  and (pg_relation_size(s.indexrelid)>50*1024*1024
       or s.indexrelname='dam_search_embedding_claim_idx')
order by bytes desc;
```

Repeated timestamp result (EST, America/New_York):

```json
[{"observed_at":"2026-11-04 22:35:55.669001-05","postmaster_started_at":"2026-11-04 12:52:59.286785-05","stats_reset":null}]
```

## Complete large-index snapshot and old claim index

```json
[
  {
    "schemaname": "public",
    "relname": "style_guide_search_documents",
    "indexrelname": "idx_sg_search_documents_embedding_hnsw",
    "idx_scan": 401,
    "last_idx_scan": "2026-11-04 20:52:30.963557-05",
    "bytes": 693673984,
    "definition": "CREATE INDEX idx_sg_search_documents_embedding_hnsw ON public.style_guide_search_documents USING hnsw (embedding extensions.vector_cosine_ops) WHERE (embedding IS NOT NULL)"
  },
  {
    "schemaname": "public",
    "relname": "dam_search_documents",
    "indexrelname": "idx_dam_search_documents_embedding_hnsw",
    "idx_scan": 0,
    "last_idx_scan": null,
    "bytes": 565927936,
    "definition": "CREATE INDEX idx_dam_search_documents_embedding_hnsw ON public.dam_search_documents USING hnsw (embedding extensions.vector_cosine_ops) WHERE (embedding IS NOT NULL)"
  },
  {
    "schemaname": "hts_rag",
    "relname": "hts_rag_rulings",
    "indexrelname": "hts_rag_rulings_search_trgm_idx",
    "idx_scan": 0,
    "last_idx_scan": null,
    "bytes": 357892096,
    "definition": "CREATE INDEX hts_rag_rulings_search_trgm_idx ON hts_rag.hts_rag_rulings USING gin (hts_rag_fold_text(((COALESCE(subject, ''::text) || ' '::text) || full_text)) extensions.gin_trgm_ops)"
  },
  {
    "schemaname": "public",
    "relname": "assets",
    "indexrelname": "idx_assets_relative_path_trgm",
    "idx_scan": 33,
    "last_idx_scan": "2026-11-04 18:33:10.515669-05",
    "bytes": 292749312,
    "definition": "CREATE INDEX idx_assets_relative_path_trgm ON public.assets USING gin (relative_path extensions.gin_trgm_ops)"
  },
  {
    "schemaname": "dam",
    "relname": "dam_asset_image_vectors",
    "indexrelname": "dam_asset_image_vectors_vec_siglip_hnsw",
    "idx_scan": 0,
    "last_idx_scan": null,
    "bytes": 245022720,
    "definition": "CREATE INDEX dam_asset_image_vectors_vec_siglip_hnsw ON dam.dam_asset_image_vectors USING hnsw (vec_siglip extensions.halfvec_cosine_ops) WITH (m='16', ef_construction='64') WHERE (vec_siglip IS NOT NULL)"
  },
  {
    "schemaname": "dam",
    "relname": "dam_asset_image_vectors",
    "indexrelname": "dam_asset_image_vectors_vec_dino_hnsw",
    "idx_scan": 0,
    "last_idx_scan": null,
    "bytes": 244793344,
    "definition": "CREATE INDEX dam_asset_image_vectors_vec_dino_hnsw ON dam.dam_asset_image_vectors USING hnsw (vec_dino extensions.halfvec_cosine_ops) WITH (m='16', ef_construction='64') WHERE (vec_dino IS NOT NULL)"
  },
  {
    "schemaname": "public",
    "relname": "asset_tags",
    "indexrelname": "asset_tags_forward_asset_id_idx",
    "idx_scan": 20,
    "last_idx_scan": "2026-11-04 16:59:59.393114-05",
    "bytes": 216219648,
    "definition": "CREATE INDEX asset_tags_forward_asset_id_idx ON public.asset_tags USING btree (asset_id, id)"
  },
  {
    "schemaname": "public",
    "relname": "asset_effective_tags",
    "indexrelname": "asset_effective_tags_tag_asset_idx",
    "idx_scan": 22860,
    "last_idx_scan": "2026-11-04 19:01:16.780258-05",
    "bytes": 173514752,
    "definition": "CREATE INDEX asset_effective_tags_tag_asset_idx ON public.asset_effective_tags USING btree (tag, asset_id)"
  },
  {
    "schemaname": "public",
    "relname": "assets",
    "indexrelname": "idx_assets_facet_counts",
    "idx_scan": 54,
    "last_idx_scan": "2026-11-04 18:55:30.678957-05",
    "bytes": 172572672,
    "definition": "CREATE INDEX idx_assets_facet_counts ON public.assets USING btree (is_deleted) INCLUDE (file_type, status, workflow_status, stage, is_licensed, modified_at, file_created_at, thumbnail_url, style_group_id) WHERE (is_deleted = false)"
  },
  {
    "schemaname": "public",
    "relname": "assets",
    "indexrelname": "idx_assets_ai_tag_all_candidates",
    "idx_scan": 200,
    "last_idx_scan": "2026-11-04 21:16:49.510104-05",
    "bytes": 169197568,
    "definition": "CREATE INDEX idx_assets_ai_tag_all_candidates ON public.assets USING btree (primary_sort_tier, id) INCLUDE (thumbnail_url, filename, relative_path, style_group_id) WHERE ((is_deleted = false) AND (thumbnail_url IS NOT NULL) AND (primary_sort_tier <> ALL (ARRAY[4, 8])))"
  },
  {
    "schemaname": "public",
    "relname": "asset_tags",
    "indexrelname": "asset_tags_active_asset_idx",
    "idx_scan": 110404,
    "last_idx_scan": "2026-11-04 22:35:45.273084-05",
    "bytes": 143679488,
    "definition": "CREATE INDEX asset_tags_active_asset_idx ON public.asset_tags USING btree (asset_id, tag) WHERE (status = 'active'::text)"
  },
  {
    "schemaname": "public",
    "relname": "style_guide_files",
    "indexrelname": "idx_sgf_relative_path_trgm",
    "idx_scan": 20,
    "last_idx_scan": "2026-11-04 16:48:08.605926-05",
    "bytes": 139386880,
    "definition": "CREATE INDEX idx_sgf_relative_path_trgm ON public.style_guide_files USING gin (relative_path extensions.gin_trgm_ops)"
  },
  {
    "schemaname": "public",
    "relname": "style_guide_file_tags",
    "indexrelname": "idx_style_guide_file_tags_tag_status",
    "idx_scan": 72,
    "last_idx_scan": "2026-11-04 21:05:12.207728-05",
    "bytes": 126795776,
    "definition": "CREATE INDEX idx_style_guide_file_tags_tag_status ON public.style_guide_file_tags USING btree (tag_id, status, style_guide_file_id)"
  },
  {
    "schemaname": "public",
    "relname": "style_guide_files",
    "indexrelname": "idx_sgf_directory_path_trgm",
    "idx_scan": 0,
    "last_idx_scan": null,
    "bytes": 117121024,
    "definition": "CREATE INDEX idx_sgf_directory_path_trgm ON public.style_guide_files USING gin (directory_path extensions.gin_trgm_ops)"
  },
  {
    "schemaname": "hts_rag",
    "relname": "hts_rag_ruling_sentences",
    "indexrelname": "hts_rag_ruling_sentences_hash_idx",
    "idx_scan": 0,
    "last_idx_scan": null,
    "bytes": 116277248,
    "definition": "CREATE INDEX hts_rag_ruling_sentences_hash_idx ON hts_rag.hts_rag_ruling_sentences USING btree (text_hash)"
  },
  {
    "schemaname": "hts_rag",
    "relname": "hts_rag_rulings",
    "indexrelname": "hts_rag_rulings_search_tsv_active_idx",
    "idx_scan": 639,
    "last_idx_scan": "2026-11-04 22:34:24.28681-05",
    "bytes": 97329152,
    "definition": "CREATE INDEX hts_rag_rulings_search_tsv_active_idx ON hts_rag.hts_rag_rulings USING gin (search_tsv) WHERE (effective_status = 'active'::text)"
  },
  {
    "schemaname": "public",
    "relname": "assets",
    "indexrelname": "idx_assets_tags",
    "idx_scan": 0,
    "last_idx_scan": null,
    "bytes": 84500480,
    "definition": "CREATE INDEX idx_assets_tags ON public.assets USING gin (tags)"
  },
  {
    "schemaname": "public",
    "relname": "style_guide_search_documents",
    "indexrelname": "idx_sg_search_documents_search_vector",
    "idx_scan": 948,
    "last_idx_scan": "2026-11-04 22:35:34.558205-05",
    "bytes": 78036992,
    "definition": "CREATE INDEX idx_sg_search_documents_search_vector ON public.style_guide_search_documents USING gin (search_vector) WHERE is_active"
  },
  {
    "schemaname": "public",
    "relname": "style_guide_files",
    "indexrelname": "idx_style_guide_files_tag_search_trgm",
    "idx_scan": 0,
    "last_idx_scan": null,
    "bytes": 78012416,
    "definition": "CREATE INDEX idx_style_guide_files_tag_search_trgm ON public.style_guide_files USING gin (tag_search_text extensions.gin_trgm_ops)"
  },
  {
    "schemaname": "public",
    "relname": "assets",
    "indexrelname": "idx_assets_filename_trgm",
    "idx_scan": 899,
    "last_idx_scan": "2026-11-04 22:31:30.010033-05",
    "bytes": 75390976,
    "definition": "CREATE INDEX idx_assets_filename_trgm ON public.assets USING gin (filename extensions.gin_trgm_ops)"
  },
  {
    "schemaname": "public",
    "relname": "dam_search_keys",
    "indexrelname": "dam_search_keys_tsv_idx",
    "idx_scan": 690,
    "last_idx_scan": "2026-11-04 22:34:52.335854-05",
    "bytes": 70410240,
    "definition": "CREATE INDEX dam_search_keys_tsv_idx ON public.dam_search_keys USING gin (search_tsv)"
  },
  {
    "schemaname": "public",
    "relname": "assets",
    "indexrelname": "idx_assets_full_text_search",
    "idx_scan": 0,
    "last_idx_scan": null,
    "bytes": 65560576,
    "definition": "CREATE INDEX idx_assets_full_text_search ON public.assets USING gin (to_tsvector('simple'::regconfig, ((((((((((((((((((COALESCE(filename, ''::text) || ' '::text) || COALESCE(relative_path, ''::text)) || ' '::text) || COALESCE(cover_description, ''::text)) || ' '::text) || COALESCE(ai_description, ''::text)) || ' '::text) || COALESCE(scene_description, ''::text)) || ' '::text) || COALESCE(customer, ''::text)) || ' '::text) || COALESCE(program, ''::text)) || ' '::text) || COALESCE(licensor_name, ''::text)) || ' '::text) || COALESCE(property_name, ''::text)) || ' '::text) || COALESCE(product_category, ''::text)))) WHERE (is_deleted = false)"
  },
  {
    "schemaname": "public",
    "relname": "assets",
    "indexrelname": "idx_assets_ai_tag_untagged_candidates",
    "idx_scan": 2,
    "last_idx_scan": "2026-11-04 21:16:49.510104-05",
    "bytes": 64626688,
    "definition": "CREATE INDEX idx_assets_ai_tag_untagged_candidates ON public.assets USING btree (primary_sort_tier, id) INCLUDE (thumbnail_url, filename, relative_path, style_group_id) WHERE ((is_deleted = false) AND (thumbnail_url IS NOT NULL) AND (primary_sort_tier <> ALL (ARRAY[4, 8])) AND (status <> 'tagged'::asset_status))"
  },
  {
    "schemaname": "public",
    "relname": "dam_search_keys",
    "indexrelname": "dam_search_keys_path_trgm_idx",
    "idx_scan": 3499,
    "last_idx_scan": "2026-11-04 22:35:25.126059-05",
    "bytes": 63864832,
    "definition": "CREATE INDEX dam_search_keys_path_trgm_idx ON public.dam_search_keys USING gin (path extensions.gin_trgm_ops)"
  },
  {
    "schemaname": "public",
    "relname": "style_guide_search_documents",
    "indexrelname": "idx_sg_search_documents_claim_pending",
    "idx_scan": 4,
    "last_idx_scan": "2026-11-04 16:45:56.012678-05",
    "bytes": 60334080,
    "definition": "CREATE INDEX idx_sg_search_documents_claim_pending ON public.style_guide_search_documents USING btree (document_updated_at, style_guide_file_id) INCLUDE (thumbnail_url, embedding_next_retry_at, embedding_lease_expires_at) WHERE (is_active AND (content_sha256 IS NOT NULL) AND (embedding IS NULL) AND (embedding_attempts < embedding_max_attempts) AND (embedding_error_category IS DISTINCT FROM 'permanent'::text))"
  },
  {
    "schemaname": "public",
    "relname": "dam_search_documents",
    "indexrelname": "dam_search_embedding_claim_idx",
    "idx_scan": 18,
    "last_idx_scan": "2026-11-04 22:33:08.14004-05",
    "bytes": 11780096,
    "definition": "CREATE INDEX dam_search_embedding_claim_idx ON public.dam_search_documents USING btree (indexed_at, document_type, entity_id) WHERE (embedding IS NULL)"
  }
]
```

## Resume contract

Owner: Codex coordinator for #5608–#5610; durable card is existing issue #5610.
At the review time, repeat the plan's opening queries. A changed postmaster start time or a statistics reset invalidates the interval; establish a new full 14-day observation before considering any removal. Move every index with reads to KEEP. Re-run code-path proof against then-current source. No drop migration has been authored.

`ai-blocker-watch --help` verified November 4, 2026: new wait registration is inert; supported instruction is "leave the existing issue or pull request as the card and return later — GitHub notifications are the reminder." It does not provide a new date-based session wake. No scheduler was installed and no background continuation is claimed.

Posted by Codex chat 01a1a9c6-63f8-7601-ab1a-a446e46e0694 on edge-dev3

