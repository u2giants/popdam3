CREATE OR REPLACE FUNCTION get_ai_sentinel_stats()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'total_ai',
      (SELECT COUNT(*) FROM assets WHERE file_type = 'ai' AND is_deleted = false),
    'sampled',
      (SELECT COUNT(*) FROM pdf_text_samples pts
       JOIN assets a ON a.id = pts.asset_id
       WHERE a.file_type = 'ai' AND a.is_deleted = false),
    'sentinel_pending',
      (SELECT COUNT(*) FROM pdf_text_samples pts
       JOIN assets a ON a.id = pts.asset_id
       WHERE a.file_type = 'ai'
         AND a.is_deleted = false
         AND a.thumbnail_url IS NULL
         AND pts.extracted_text LIKE '%saved without PDF Content%'
         AND NOT EXISTS (
           SELECT 1 FROM ai_sentinel_cleanup_log l WHERE l.ai_asset_id = a.id
         )),
    'cleaned_up',
      (SELECT COUNT(*) FROM ai_sentinel_cleanup_log),
    'no_replacement_found',
      (SELECT COUNT(*) FROM ai_sentinel_cleanup_log WHERE replacement_asset_id IS NULL)
  );
$$;

GRANT EXECUTE ON FUNCTION get_ai_sentinel_stats() TO service_role;
