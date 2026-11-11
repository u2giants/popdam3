---
summary: "Issue 5610 restart invalidation: new unused-index observation window opened 2026-11-06 8:59 AM EST, eligibility 2026-11-20; later also invalidated."
kind: proof
status: stale
read-when: checking 5610 unused-index window history after the first restart
---

# Restart invalidation and measured successor observation

Source: [signed existing-issue checkpoint](https://github.com/popcre/shared-db/issues/5610#issuecomment-6686596358). Source/catalog metadata only; no new database read.

Observation reset and new measured window — November 6, 2026, 9:00 AM EST.

The fresh production read at November 6, 2026, **8:59:18 AM EST** found a changed postmaster start: **November 5, 2026, 1:46:38.291291 PM EST**, replacing the prior November 4 identity. Database stats_reset is NULL. The original observation interval is invalidated; the original November 18 cutoff is no longer sufficient.

Coordinator decision: open a conservative new observed interval at **November 6, 2026, 8:59:18 AM EST**. New earliest eligibility is **November 20, 2026, 8:59:18 AM EST**, fourteen days from this measured reopening, subject to unchanged postmaster/reset/index identity and monotonic counters, full then-current consumer/code-path proof, and every existing delivery/live-proof requirement. A further restart/reset invalidates this new interval. This is not permission to drop anything on that date.

The four original candidates still have zero scans under this new short interval. Existing positive historical KEEP decisions remain KEEP even where counters reset to zero: idx_style_guide_file_tags_tag_status, idx_assets_ai_tag_untagged_candidates, and dam_search_embedding_claim_idx (the last now has 2,072 scans). All four protected vector indexes remain present. No index removal, migration, statistics reset, or database write was performed.

At **November 6, 2026, 9:00:14 AM EST**, a second read captured exact index/table OIDs, full definitions, byte sizes, counts, validity/readiness and reset/postmaster identities for later continuity comparison. All eleven recorded indexes are valid and ready. This is source/catalog metadata only, with no business rows or licensed content.

<details><summary>Exact new-window index identity baseline</summary>

```json
[
  {
    "observed_at": "2026-11-06 09:00:14.175322-05",
    "postmaster_started_at": "2026-11-05 13:46:38.291291-05",
    "stats_reset": null,
    "index_identity_baseline": [
      {
        "bytes": 253575168,
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
        "bytes": 253861888,
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
        "scans": 2072,
        "table": "dam_search_documents",
        "valid": true,
        "schema": "public",
        "unique": false,
        "primary": false,
        "index_oid": "20491117",
        "last_scan": "2026-11-05T18:35:32.729827-05:00",
        "table_oid": "713489",
        "definition": "CREATE INDEX dam_search_embedding_claim_idx ON public.dam_search_documents USING btree (indexed_at, document_type, entity_id) WHERE (embedding IS NULL)"
      },
      {
        "bytes": 14360576,
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
        "bytes": 52551680,
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
        "bytes": 17367040,
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
        "scans": 7,
        "table": "dam_search_documents",
        "valid": true,
        "schema": "public",
        "unique": false,
        "primary": false,
        "index_oid": "20616524",
        "last_scan": "2026-11-05T15:59:05.289228-05:00",
        "table_oid": "713489",
        "definition": "CREATE INDEX idx_dam_search_documents_embedding_hnsw ON public.dam_search_documents USING hnsw (embedding extensions.vector_cosine_ops) WHERE (embedding IS NOT NULL)"
      },
      {
        "bytes": 831963136,
        "index": "idx_sg_search_documents_embedding_hnsw",
        "ready": true,
        "scans": 441,
        "table": "style_guide_search_documents",
        "valid": true,
        "schema": "public",
        "unique": false,
        "primary": false,
        "index_oid": "25586291",
        "last_scan": "2026-11-05T20:48:52.287296-05:00",
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
    ]
  }
]
```

</details>

Owner: original Codex coordinator chat 01a1a9c5-d9e1-7160-ac26-ed9dac540870, retaining this same OPEN issue. Implementation and live proof remain unchecked. The positive-only reader cautions and all-consumer requirements still apply; no absence or completion claim is made. Prior immutable observation evidence is preserved as history. No timed wake-up or background continuation is claimed.

Posted by Codex chat 01a1a9c6-63f8-7601-ab1a-a446e46e0694 on edge-dev3

