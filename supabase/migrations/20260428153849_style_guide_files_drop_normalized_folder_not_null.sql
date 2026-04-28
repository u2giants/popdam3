-- normalized_style_guide_folder was inherited as NOT NULL from the original
-- normalized_parent_folder column.  The rename migration dropped NOT NULL on
-- style_guide_folder but forgot this companion column.  Files shallower than
-- 3 directories deep produce a null value here, causing the crawl upsert to
-- fail with a constraint violation.
ALTER TABLE public.style_guide_files
  ALTER COLUMN normalized_style_guide_folder DROP NOT NULL;
