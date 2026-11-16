-- #6412: FK covering index for style_groups (primary_asset_id). Part of the
-- #2326 program (plan Step 5, candidate family 2 'Foreign keys' — the one
-- finding of the advisor's 426 with a measured hot join behind it).
--
-- WHY
-- ---
-- PostgREST's FK embed `assets LEFT JOIN LATERAL style_groups ...` runs
-- 954,427 calls/week at ~1 ms mean (7-day pg_stat_statements window
-- 2026-11-06 -> 2026-11-13), plus the reverse embed. Every lateral probe
-- currently scans style_groups (10,631 rows / ~43 MB on preview, 11,430 on
-- production, 2026-11-15) because no index on the table leads with
-- primary_asset_id (live catalog 2026-11-15: 17 indexes, none on that
-- column). Preview EXPLAIN before this change: Seq Scan on style_groups with
-- Filter: (primary_asset_id = a.id).
--
-- SCOPE
-- -----
-- CREATE INDEX idx_style_groups_primary_asset_id ON public.style_groups
-- USING btree (primary_asset_id). Nothing else changes. Naming follows the
-- table's idx_style_groups_* family. The FK constraint
-- style_groups_primary_asset_id_fkey is untouched.
--
-- ROLLBACK (named)
-- ----------------
-- Forward migration:
--   DROP INDEX IF EXISTS public.idx_style_groups_primary_asset_id;
-- New index, so rollback is a later governed drop after proving no dependency
-- beyond the FK check it serves and the lateral embed. Exact restore DDL:
--   CREATE INDEX idx_style_groups_primary_asset_id
--     ON public.style_groups USING btree (primary_asset_id);
--
-- Non-concurrent CREATE INDEX: the migration runner is transactional and
-- CONCURRENTLY is not available there (repository rule). The table is small
-- (10-11k rows) and lock_timeout makes the migration fail fast instead of
-- queueing behind long writers (repository pattern
-- 20261022191243_retire_dam_search_documents_text_indexes.sql).

begin;

set local lock_timeout = '5s';

create index if not exists idx_style_groups_primary_asset_id
  on public.style_groups using btree (primary_asset_id);

commit;
