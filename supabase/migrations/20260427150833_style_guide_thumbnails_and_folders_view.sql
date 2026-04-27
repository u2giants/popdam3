-- Add thumbnail columns to style_guide_files
ALTER TABLE public.style_guide_files
  ADD COLUMN thumbnail_url text,
  ADD COLUMN thumbnail_error text;

-- View returning distinct licensor/property folder pairs for the sidebar tree.
-- security_invoker means the caller's RLS context applies (authenticated read).
CREATE VIEW public.style_guide_folders
  WITH (security_invoker = true)
AS
SELECT DISTINCT licensor_name, property_folder
FROM public.style_guide_files
WHERE is_active = true AND licensor_name IS NOT NULL;

GRANT SELECT ON public.style_guide_folders TO authenticated;
