-- Refs popcre/shared-db#5610. Exact identities observed 14 days with zero scans.
-- Final live receipt: https://github.com/popcre/shared-db/issues/5610#issuecomment-7047117200
-- Final consumer audit: https://github.com/popcre/shared-db/issues/5610#issuecomment-7047183724
-- Recreate statements captured from production before removal:
-- CREATE INDEX idx_assets_full_text_search ON public.assets USING gin (to_tsvector('simple'::regconfig, ((((((((((((((((((COALESCE(filename, ''::text) || ' '::text) || COALESCE(relative_path, ''::text)) || ' '::text) || COALESCE(cover_description, ''::text)) || ' '::text) || COALESCE(ai_description, ''::text)) || ' '::text) || COALESCE(scene_description, ''::text)) || ' '::text) || COALESCE(customer, ''::text)) || ' '::text) || COALESCE(program, ''::text)) || ' '::text) || COALESCE(licensor_name, ''::text)) || ' '::text) || COALESCE(property_name, ''::text)) || ' '::text) || COALESCE(product_category, ''::text)))) WHERE (is_deleted = false);
-- CREATE INDEX idx_sgf_directory_path_trgm ON public.style_guide_files USING gin (directory_path extensions.gin_trgm_ops);
-- CREATE INDEX idx_style_guide_files_tag_search_trgm ON public.style_guide_files USING gin (tag_search_text extensions.gin_trgm_ops);

begin;
set local lock_timeout = '5s';
-- This observed index must exist before removal. In ephemeral CI its
-- creating migration needs the adopted baseline and runs in pass two.
drop index public.idx_assets_full_text_search;
drop index if exists public.idx_sgf_directory_path_trgm;
drop index if exists public.idx_style_guide_files_tag_search_trgm;
commit;
