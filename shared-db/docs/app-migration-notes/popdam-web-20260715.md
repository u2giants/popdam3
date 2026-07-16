# PopDAM Two-Level Metadata + Rich PDF Extraction — 2026-07-15

## Status

Done and promoted to production (`qsllyeztdwjgirsysgai`). Backfill Pass 1 complete; Pass 2 (on-prem text extraction of the remaining ~19k PDFs) is app-side operational work, not a schema change.

## What Changed

### Two-level asset metadata (PR #67, merged)
- `20260714203000_dam_sku_human_description.sql` — `dam.sku_human_description` (latest human-authored Master Data description per SKU) + `public.refresh_sku_human_description()`.
- `20260714203100_dam_style_group_item_description.sql` — `public.style_groups.item_description` / `item_description_source` (product-level, backfilled from `dam.sku_human_description`; ~10.4k groups).
- `20260714203200_dam_asset_content_type.sql` — `public.assets.content_type` (14-value CHECK: `source_art`, `style_guide_art`, `tech_pack`, `licensing_sheet`, …), assigned by image tagging.
- `20260714203300_dam_two_level_metadata_search.sql` — extends `refresh_dam_search_asset_document` / `refresh_dam_search_style_group_document` / `rebuild_dam_search_documents` to fold the new product/file-level fields into the DAM search corpus.

### Rich tech-pack / licensing-sheet PDF extraction (PRs #74, #77, #78, merged)
- `20260715183000_dam_rich_pdf_extraction.sql` — `dam.pdf_rich_extraction` (raw per-PDF structured `data` jsonb + provenance/`source_text_sha256`); `public.style_groups.rich_metadata` / `_source` / `_updated_at`; `public.assets.product_material text[]` / `product_dimensions text`; `public.refresh_style_group_rich_metadata(uuid)` (field-level newest-wins merge + facet projection onto member assets); `dam.jsonb_leaf_text(jsonb)`; search rollups extended to fold rich metadata + facets. Applied to prod with `--include-all` (timestamp was out of order behind concurrent CRM/ERP migrations).
- `20260715210000_dam_rich_pdf_rpc_access.sql` — `public.get_pdf_rich_extraction_hashes(uuid[])` + `public.upsert_pdf_rich_extraction(...)` (`SECURITY DEFINER`, granted `service_role`). **Required because `dam` is not in `pgrst.db_schemas`** — the Railway worker cannot reach `dam.*` over PostgREST (`Invalid schema: dam`), so all worker dam access goes through these public wrappers.
- `20260715214500_dam_material_facets.sql` — `public.get_dam_material_facets()` (distinct `product_material` + counts, for the library Material filter) + GIN index `idx_assets_product_material_gin` + partial index `idx_assets_has_product_material`.

## Why

- **Two-level metadata:** separate product-level identity (one description per SKU group, from Master Data) from file-level classification (`content_type`) so search and the UI can reason about "what this SKU is" vs "what this file is."
- **Rich PDF extraction:** capture the structured data buried in tech-pack/licensing-sheet PDFs (materials, dimensions, compliance, source files, copyright, colors) and attach it at the style-group level, searchable across member assets. Worker uses **direct DeepSeek** (not OpenRouter) for its automatic prefix caching on the ~19k-PDF fixed-prompt batch.
- **RPC access layer:** `dam` is intentionally unexposed to the API; server-side access must go through `public` `SECURITY DEFINER` functions rather than broadening `pgrst.db_schemas`.

## Affected Apps

- **PopDAM** only. Frontend consumes `style_groups.item_description` / `rich_metadata`, `assets.content_type` / `product_material`, and calls `get_dam_material_facets()`; worker writes `assets.content_type`, `dam.pdf_rich_extraction`, and the rollups. App commits on `main`: two-level `581c9c9`+`b12a293`; rich-PDF schema `c98e9e8`; worker RPC fix `f9e825b`; material facet `f383d1e`; material normalization `f38c90a`.
- CRM / PM / PLM unaffected (all changes additive; no shared tables altered destructively).

## Verified

- `scripts/check-sql.sh` passed for every migration.
- Preview branch (`xjcyeuvzkhtzsheknaiu`): each migration applied and all function bodies exercised against the real schema; two-level + rich-PDF ran full synthetic E2E (rollup → `rich_metadata` + asset-facet projection → search-doc inclusion), rolled back; validation objects removed and prior functions restored.
- Production: migrations recorded in `supabase_migrations.schema_migrations`; two-level backfill = 10,421/10,535 groups with `item_description`, 15,115 `sku_human_description` rows; rich-PDF Pass 1 = 246 `dam.pdf_rich_extraction` rows (0 parse errors), 62 groups with `rich_metadata`, 629 assets with `product_material`; `get_dam_material_facets()` returns 109 distinct (post-normalization).

## Risks / Watchouts

- **`dam` is not exposed to PostgREST.** Never `client.schema("dam").from(...)` from worker/edge; use the public RPC wrappers. Adding `dam` to `pgrst.db_schemas` would broaden the shared API surface for all apps and require RLS on every `dam` table.
- **Rich-PDF Pass 2** is unfinished: ~19k eligible PDFs have no `pdf_text_samples.extracted_text` yet; they need on-prem text extraction first, then re-run the app-side `rich-pdf-extract` op (idempotent via `source_text_sha256`).
- The two-level tagging path's `dam.sku_human_description` read hits the same unexposed-schema wall but degrades silently to `style_groups.item_description`; route it through an RPC if you start relying on it.
- Concurrent CRM/ERP sessions land migrations on the same backend; expect out-of-order timestamps and use `supabase db push --dry-run` + `--include-all` (see the DAM `20260715183000` case).
