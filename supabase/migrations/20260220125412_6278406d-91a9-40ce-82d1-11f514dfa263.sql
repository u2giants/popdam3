
-- Drop indexes first, then move extension
DROP INDEX IF EXISTS public.idx_assets_filename_trgm;
DROP INDEX IF EXISTS public.idx_assets_relative_path_trgm;
DROP EXTENSION IF EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
CREATE INDEX idx_assets_filename_trgm ON public.assets USING GIN (filename extensions.gin_trgm_ops);
CREATE INDEX idx_assets_relative_path_trgm ON public.assets USING GIN (relative_path extensions.gin_trgm_ops);
