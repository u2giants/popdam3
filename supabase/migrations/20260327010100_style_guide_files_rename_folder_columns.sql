-- Replace bottom-up parent/grandparent columns with top-down property/style_guide columns.
-- property_folder    = segments[1] from root (licensor's property name)
-- style_guide_folder = segments[2] from root (the style guide name folder — most important)

ALTER TABLE public.style_guide_files
  RENAME COLUMN parent_folder TO style_guide_folder;

ALTER TABLE public.style_guide_files
  RENAME COLUMN grandparent_folder TO property_folder;

ALTER TABLE public.style_guide_files
  RENAME COLUMN normalized_parent_folder TO normalized_style_guide_folder;

-- style_guide_folder was NOT NULL; now nullable (file could sit shallower than depth 3)
ALTER TABLE public.style_guide_files
  ALTER COLUMN style_guide_folder DROP NOT NULL;

DROP INDEX IF EXISTS idx_sgf_normalized_parent_folder;
CREATE INDEX IF NOT EXISTS idx_sgf_style_guide_folder ON public.style_guide_files(style_guide_folder);
CREATE INDEX IF NOT EXISTS idx_sgf_property_folder ON public.style_guide_files(property_folder);
