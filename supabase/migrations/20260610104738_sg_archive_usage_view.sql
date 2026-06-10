-- Running tally for style-guide archival decisions: per style guide (licensor + property folder),
-- the most recent PopDAM design that referenced any file in it, and whether that was within 3 years.
-- "design made" date = style_groups.latest_file_date (newest art-file mtime in the design group),
-- the truest proxy for when the design was actually made (created_at/ingested_at = DAM index time).
-- Only RESOLVED sku_files_used links count, so accuracy improves as the nightly resolver links the
-- remaining pending rows. archive_candidate = no known design used it in the last 3 years.
CREATE OR REPLACE VIEW public.sg_archive_usage AS
WITH usage AS (
  SELECT f.licensor_name,
         f.property_folder,
         max(sg.latest_file_date)              AS most_recent_design_date,
         count(DISTINCT u.id)                   AS design_ref_count,
         count(DISTINCT u.sku)                  AS designs_using
  FROM sku_files_used u
  JOIN style_groups sg     ON sg.sku = u.sku
  JOIN style_guide_files f ON f.id = u.style_guide_file_id
  GROUP BY f.licensor_name, f.property_folder
),
guides AS (
  SELECT licensor_name,
         property_folder,
         count(*)                          AS total_files,
         count(*) FILTER (WHERE is_active)  AS active_files,
         max(modified_at)                   AS newest_sg_file_date
  FROM style_guide_files
  GROUP BY licensor_name, property_folder
)
SELECT
  g.licensor_name,
  g.property_folder,
  g.total_files,
  g.active_files,
  g.newest_sg_file_date,
  u.most_recent_design_date,
  COALESCE(u.designs_using, 0)    AS designs_using,
  COALESCE(u.design_ref_count, 0) AS design_ref_count,
  (u.most_recent_design_date IS NULL
     OR u.most_recent_design_date < now() - interval '3 years') AS archive_candidate
FROM guides g
LEFT JOIN usage u
  ON u.licensor_name = g.licensor_name
 AND u.property_folder IS NOT DISTINCT FROM g.property_folder;

COMMENT ON VIEW public.sg_archive_usage IS
  'Per style guide (licensor/property): most recent PopDAM design that referenced it and whether '
  'used within 3 years. archive_candidate=true means no KNOWN recent design used it -- reliability '
  'scales with sku_files_used resolution coverage. Design date = style_groups.latest_file_date.';
