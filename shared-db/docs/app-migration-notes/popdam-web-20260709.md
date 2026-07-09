# PopDAM — indexed library full-text search (2026-07-09)

## What changed

- Added indexed full-text search for PopDAM library searches.
- New GIN indexes:
  - `idx_assets_full_text_search`
  - `idx_style_groups_full_text_search`
  - `idx_pdf_text_samples_extracted_text_search`
- New/updated RPCs:
  - `public.search_assets_full_text(p_query text, p_limit int)`
  - `public.search_style_groups_full_text(p_query text, p_limit int)`
- Migration files:
  - `supabase/migrations/20260709150000_dam_full_text_search.sql`
  - `supabase/migrations/20260709151000_dam_full_text_search_preserve_substring.sql`

## Why

PopDAM library search previously matched style-group metadata such as SKU, folder path, licensor/property, product category, customer, and program. It did not directly search extracted tech-pack/licensor-sheet text in `pdf_text_samples.extracted_text`, even though that text is often a more reliable source for product descriptions than folder paths.

The new RPCs let the frontend search extracted PDF text through a GIN full-text index, then intersect the returned IDs with the existing visibility, filter, sort, and pagination queries.

## Affected apps

- DAM / PopDAM web only.
- PopSG does not use `assets`/`style_groups` library search.
- Other shared Supabase apps should treat these RPCs as DAM-owned app-facing contracts.

## Implementation notes

- `search_assets_full_text` searches indexed asset metadata and `pdf_text_samples.extracted_text`.
- `search_style_groups_full_text` searches indexed style-group metadata and rolls up matching member assets/PDF text.
- The second migration intentionally preserves existing substring search behavior for queries such as `3fz` matching `3FZ93DYEC01`; pure PostgreSQL full-text search does not match inside that token.
- The PopDAM frontend caps RPC result handoff at 500 IDs. If a query is too broad or the RPC is temporarily unavailable during deploy ordering, the frontend falls back to the older metadata substring predicate.

## Verified

- `scripts/check-sql.sh` passed.
- Supabase preview dry-run was clean.
- Migrations were applied to preview project `xjcyeuvzkhtzsheknaiu`.
- Supabase production dry-run showed only the two intended migrations.
- Migrations were applied to production project `qsllyeztdwjgirsysgai`.
- Production smoke test:
  - `search_assets_full_text('lenticular', 1000)` returned matches.
  - `search_style_groups_full_text('lenticular', 1000)` returned `373` groups.
  - All three GIN indexes existed in `pg_indexes`.
- PopDAM app checks passed: `npm test` and `npm run build`.

## Risks / watchouts

- Broad terms can still match many rows. Keep the frontend ID handoff cap unless the app moves fully to an RPC that applies filters, sorting, and pagination server-side.
- If search semantics change, test SKU-prefix queries such as `3fz`; do not accidentally regress substring matching while adding full-text behavior.
- The extracted PDF text search depends on `pdf_text_samples` coverage. Missing or failed PDF extraction means the raw text will not be searchable for that asset.
