-- PopSG library search: make ILIKE substring search on style_guide_files fast.
--
-- The PopSG "Files" tab searches franchise/path text. PostgREST emits
-- relative_path=ilike.%term%. Raw-column trigram indexes support that predicate.
-- Production already has these indexes from an approved concurrent apply; this
-- idempotent migration records them for preview and future rebuilds.

create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_sgf_relative_path_trgm
  on public.style_guide_files using gin (relative_path extensions.gin_trgm_ops);

create index if not exists idx_sgf_directory_path_trgm
  on public.style_guide_files using gin (directory_path extensions.gin_trgm_ops);
