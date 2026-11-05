# #5610 — ongoing observation, not window-close acceptance

Owner: original Codex coordinator for #5608–#5610. Existing issue: [#5610](https://github.com/popcre/shared-db/issues/5610).

This receipt supplements the [opening snapshot](../20261105T0335Z/unused-index-window-open.md); it does not complete plan step 1 or step 2. The governing plan was re-read from shared-db main `221c117f9098d2ebd8328e5618b263f3a257ebad`. No migration, removal, statistics reset, or application-data write was performed.

## Narrow live observation

The connected project URL was verified against the configured shared production identity immediately before read-only catalog inspection. Aggregate metadata was observed November 5, 2026, **6:54:58 AM EST** (America/New_York):

- Postmaster start remained November 4, 2026, **12:52:59.286785 PM EST**, exactly matching the opening snapshot; database `stats_reset` remained NULL.
- All four original remaining candidates still showed zero scans: `public.idx_sgf_directory_path_trgm`, `public.idx_assets_tags`, `public.idx_style_guide_files_tag_search_trgm`, and `public.idx_assets_full_text_search`.
- The three existing KEEP indexes showed monotonic counts: `public.idx_style_guide_file_tags_tag_status` **72**, `public.idx_assets_ai_tag_untagged_candidates` **4**, and `public.dam_search_embedding_claim_idx` **20** (opening counts 72/2/18).
- All four protected vector indexes remained present: `public.idx_sg_search_documents_embedding_hnsw`, `public.idx_dam_search_documents_embedding_hnsw`, `dam.dam_asset_image_vectors_vec_siglip_hnsw`, and `dam.dam_asset_image_vectors_vec_dino_hnsw`. The protected DAM semantic-search index `public.idx_dam_search_documents_embedding_hnsw` now showed **20** scans (opening count **0**), further supporting its existing KEEP decision. This is separate from `public.dam_search_embedding_claim_idx`, which independently showed **20** scans in the preceding bullet.

These are historical observations at the stated time, not proof of a completed interval or of present absence of readers. No global restart/reset invalidation was observed; this limited check cannot rule out every possible individual statistics reset. Later acceptance must establish full continuity and monotonic counters.

## Positive-reader inspection and false-positive cautions

Discovery targeted the current nine-consumer sync matrix. Bounded code-search results, including mirrored shared-db history, are not complete reader coverage. The following concrete source paths were inspected at freshly fetched `u2giants/popdam3` main **`891431e37d35465418956be581b1e36903b35d9d`**, then compared with current production routine/view/index definitions. References below identify code locations without copying private source or business data.

- **Disabled raw-tag fallback:** `src/hooks/useAssets.ts:306` contains an `assets.tags` containment fallback compatible with GIN(tags), but the current flag at line 172 and routing at lines 209–211 and 412–420 send tag filters through the effective-assets contract and skip that fallback. The current production contract uses `asset_effective_tags` equality. The mere fallback text is not evidence that the candidate `idx_assets_tags` serves the current application route.
- **Wrong relation for directory substring search:** `src/pages/popsg/PopSGLibraryPage.tsx:801–819` applies directory-path substring filtering to the materialized `style_guide_file_groups` relation. Filtering those stored materialized rows does not establish use of the candidate index on the separate base table `style_guide_files`.
- **Genuine directory membership reader, different index evidence:** `src/pages/popsg/PopSGLibraryPage.tsx:462–476` reads `style_guide_files` using directory-path membership, root and active-status filters. Production has a separate btree `idx_sgf_directory_path`. A bounded planning-only EXPLAIN, without ANALYZE or query execution, selected `idx_sgf_root_label` and filtered directory membership for the inspected parameter shape; it did not prove use of the candidate trigram index. Parameter-specific planning is not proof about every real execution.
- **Column selection is not trigram lookup:** `scripts/popsg-readiness-baseline.mjs:57,96` reads `tag_search_text` and checks the returned value in the application. That selection does not establish an index-compatible substring predicate.
- **Current full-text wrapper differs from the historical body:** `src/hooks/useAssets.ts:122` invokes `search_assets_full_text`. Its current production definition delegates to `search_dam_documents`; the old concatenated-assets expression in the candidate index's original migration is not the present wrapper body. The historical function definition is not current positive-reader proof for `idx_assets_full_text_search`.

No new active candidate-index reader was established by this scoped positive-only inspection. That is **not** a no-reader, all-consumer coverage, planned-use, safe-removal, or completion claim. No query was executed to inflate index-use counters; only catalog reads and EXPLAIN without ANALYZE were used.

## Unchanged next eligibility

The predeclared **November 18, 2026, 8:55 PM EST** cutoff is unchanged. Plan steps 1–6 remain unstarted until that condition is met, with later eligibility still requiring continuous reset/postmaster identity, monotonic counters, current exact definitions, and the complete then-current consumer/code-path proof. A restart/reset invalidates the interval. Existing used-index KEEP decisions and protected vectors remain in force. No drop was authored, rehearsed, applied, or accepted; the coordinator retains all remaining delivery and post-removal verification.
