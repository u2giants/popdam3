-- Aggregated PopSG style-guide folders for grouped browsing.
-- security_invoker keeps the same RLS behavior as querying style_guide_files directly.
CREATE OR REPLACE VIEW public.style_guide_file_groups
  WITH (security_invoker = true)
AS
SELECT
  md5(coalesce(root_label, '') || '/' || coalesce(directory_path, '')) AS group_key,
  root_label,
  directory_path,
  licensor_name,
  property_folder,
  style_guide_folder,
  coalesce(nullif(style_guide_folder, ''), nullif(property_folder, ''), licensor_name, 'Unfiled') AS style_guide_name,
  count(*)::integer AS file_count,
  max(modified_at) AS latest_modified_at,
  sum(coalesce(size_bytes, 0))::bigint AS total_size_bytes,
  (array_remove(array_agg(thumbnail_url ORDER BY modified_at DESC NULLS LAST), NULL::text))[1] AS sample_thumbnail_url
FROM public.style_guide_files
WHERE is_active = true
GROUP BY
  root_label,
  directory_path,
  licensor_name,
  property_folder,
  style_guide_folder;

GRANT SELECT ON public.style_guide_file_groups TO authenticated;
