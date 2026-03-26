ALTER TABLE public.style_guide_crawl_runs
  ADD COLUMN IF NOT EXISTS inaccessible_roots text[] DEFAULT NULL;
