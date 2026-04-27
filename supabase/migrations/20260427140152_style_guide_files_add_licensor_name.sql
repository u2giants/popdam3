-- Add licensor_name as a generated column (first path segment of relative_path).
-- This corresponds to the top-level licensor folder under the scan root,
-- which the PopSG library uses to group files in the folder tree sidebar.
ALTER TABLE public.style_guide_files
  ADD COLUMN licensor_name text GENERATED ALWAYS AS (split_part(relative_path, '/', 1)) STORED;

CREATE INDEX idx_sgf_licensor_name ON public.style_guide_files(licensor_name);
