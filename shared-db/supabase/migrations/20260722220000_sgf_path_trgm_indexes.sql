-- PopSG library search: make ILIKE substring search on style_guide_files fast.
--
-- The PopSG "Files" tab searches franchise/path text (e.g. "spiderman" must
-- reach files under "Marvel Style Guide/Spider-Man/…"). PostgREST emits
-- `relative_path=ilike.%spiderman%`. Without a trigram index this seq-scans
-- 200k+ rows and blows the 8s statement timeout (500).
--
-- IMPORTANT: the index must be on the RAW column (`gin (col gin_trgm_ops)`),
-- not `gin (lower(col) gin_trgm_ops)`. The planner will NOT use a
-- lower()-expression index for `col ILIKE ...` (it only matches
-- `lower(col) LIKE ...`, which PostgREST cannot emit). Verified on prod:
-- raw-column index → count ~45ms; lower() index → seq scan ~5.7s.
--
-- Applied to production 2026-07-22 via CREATE INDEX CONCURRENTLY over psql
-- (CONCURRENTLY cannot run inside `supabase db push`'s transaction). This file
-- records them idempotently (IF NOT EXISTS) for the preview branch and any
-- future rebuild; on prod it is a no-op because the indexes already exist.

create extension if not exists pg_trgm;

create index if not exists idx_sgf_relative_path_trgm
  on public.style_guide_files using gin (relative_path gin_trgm_ops);

create index if not exists idx_sgf_directory_path_trgm
  on public.style_guide_files using gin (directory_path gin_trgm_ops);
