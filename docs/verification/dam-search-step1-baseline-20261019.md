# DAM semantic search — step 1 baseline

**Date:** October 19, 2026 (measurements ~7:50–8:10 AM EDT)  
**Source:** worktree `mimo/issue97-dam-semantic-20261019` at `8654e2c6` (current origin/main)  
**Target:** production `qsllyeztdwjgirsysgai` via management API `read_only: true`  
**Identity proof:** `supabase_read_only_user`, `transaction_read_only=on`, PostgreSQL 17.6, pgvector 0.8.0  
**Owner:** this MiMo session (edge-dev). Acceptance stays on #97. DAM-only; PopSG not measured here.

No schema/data/config/indexing/tagging write occurred. Aggregates and catalogs only.

## Coverage and model identity

| document_type | docs | with_vec | null_vec | errored | leased |
|---|---:|---:|---:|---:|---:|
| asset | 139,515 | 4,489 | 135,026 | 0 | 0 |
| style_group | 11,161 | 0 | 11,161 | 0 | 0 |
| **total** | **150,676** | **4,489** | **146,187** | **0** | **0** |

All 4,489 non-null vectors: `embedding_model='gte-small'`, `vector_dims=384`, `content_sha256 = sha256(search_text)` (hash_ok=4489). Zero stale-hash embeddings. Zero error/exhaustion residue.

This is physical + label + hash consistency only — not immutable provider-build attestation.

## Configuration

| key | state |
|---|---|
| `SEARCH_MODE` | absent → keyword default |
| `SEARCH_AUTO_EMBED_ENABLED` | absent → automatic embedding off |
| `SEARCH_MIN_SEMANTIC_SCORE` | absent → no semantic floor |
| `AI_TASK_MODELS` | present (pdf_extraction / vision_tagging) — unchanged |

## Function / index inventory (effective)

`public.search_dam_documents` — 8 args including `p_min_semantic_score real default null` (floor contract live). `STABLE SECURITY DEFINER`, `statement_timeout='8s'`, calls `public.require_dam_access()` in params CTE.

Embedding helpers present: `claim_dam_search_embedding_documents`, `upsert_dam_search_embedding`, `mark_dam_search_embedding_error`, `reset_dam_search_embedding_errors`, `refresh_dam_search_*`, `rebuild_dam_search_documents`, `get_dam_search_embedding_status` (read-only user denied EXECUTE on status fn).

Indexes on `dam_search_documents` (all valid): pkey, asset_id, style_group_id, gin tsv, gin trgm (title/path/customer/program), **hnsw embedding** (`idx_dam_search_documents_embedding_hnsw`), btree claim idx.

## Live search-function shape (confirmed from catalog)

1. Semantic candidates: `order by embedding <=> query limit 20000` **before** active filters.
2. No `embedding_model` / dimension predicate on the semantic leg.
3. Summary (total_count / has_more / facets) only emitted beside page rows — out-of-range offset loses summary.
4. Group hits expand to member assets (`candidate_asset_ids`); ranked_documents is distinct over (document_type, entity_id) — group and asset rows can both appear; keyword/hybrid rollup parity unproven.
5. Function allows page_limit up to 20000; edge still clamps requests to 200 while Library permits 500.

These are governed database-shape findings → narrow shared-db claim before adapter edits. No app DDL.

## Worker / operation state (read-only)

| op | status | cursor | notes |
|---|---|---:|---|
| `embed-dam-search` | interrupted | 4,298 | run `0e63843f-…`; error 546; progress claimed=embedded=12,900 of 145,251 (stale cumulative; **live coverage is 4,489**) |
| `ai-tag-parallel` (#96 multi-model) | **failed** | 1,992/4,939 | run `1d24e828-…`; tagged 1,967; 20× `file_sources (57014)` save timeouts; auto-stopped Oct 18 7:27 PM EDT |
| `ai-tag-all` | interrupted | 3,562 | preserved Muse ambiguity — not ours |
| `ai-tag-untagged` | interrupted | 64 | original Muse ambiguity — not ours |
| `rebuild-style-groups` | completed | — | Oct 19 2:15 AM EDT |

#96 prerequisite remains open (its owner). We do not resume, replay, or rotate anything.

## Frozen measurement constants

**Nightly Style Group replacement count = 9,026** group documents refreshed in the 2026-10-19 02:00–03:00 EDT rebuild hour (corpus 11,161). Daytime ordinary group-doc refreshes ≈ 2,155/day outside that hour.

**Ordinary-change burst N = 50** documents. Basis: max hourly `asset_path_history` moves in 7 days = 53 (2026-10-19 00:00 EDT hour); typical designer check-in / bulk path-move wave. Freshness gates test against N=50 → 95% searchable ≤10 min, all ≤30 min, without whole rebuilds.

Asset `indexed_at` touches (2.5–8k/hour) are **not** ordinary content change: `assets.modified_at`/`created_at` show 0 in the last hour while documents refresh — refresh jobs retouch rows without search_text change (all 4,489 embedded hashes still match). Freshness acceptance must use content_sha256 deltas, not indexed_at age.

## Role readability (prerequisite already landed)

Per-role DAM `search-modes` capability (admin/designer/viewer) shipped in #426 and was live-proven 2026-10-18. Re-verify after next deploy; do not rebuild the capability.

## Next (this session)

1. Step 2: freeze private relevance judgments + public aggregate scorecard.
2. Route exact DAM query-shape objects through shared-db claim-first (semantic cap after filters, model predicate, summary envelope, group rollup parity).
3. Keep indexing resume gated on #96 dated full saved-row + retained-group release artifact.
