-- #5610 independent API request evidence from the Supabase unified logs stream.
-- Use an explicit time window of at most 24 hours and re-prove the target.
-- The route names are fixed. Return only aggregate values, never request samples.
select log_attributes['request.path'] as route,
       count(*) as requests,
       countIf(isNotNull(toUInt16OrNull(log_attributes['response.status_code']))) as with_status,
       countIf(toUInt16OrNull(log_attributes['response.status_code']) between 200 and 299) as successes,
       countIf(toUInt16OrNull(log_attributes['response.status_code']) between 500 and 599) as server_errors,
       countIf(isNotNull(toFloat64OrNull(log_attributes['response.origin_time']))) as with_origin_time,
       avg(toFloat64OrNull(log_attributes['response.origin_time'])) as mean_origin_time,
       max(toFloat64OrNull(log_attributes['response.origin_time'])) as max_origin_time
from logs
where source = 'edge_logs'
  and log_attributes['request.path'] in (
    '/rest/v1/rpc/search_assets_full_text',
    '/rest/v1/rpc/search_dam_documents',
    '/rest/v1/rpc/search_dam_image_similarity',
    '/rest/v1/style_guide_files',
    '/rest/v1/style_guide_file_groups',
    '/rest/v1/rpc/search_style_guide_library',
    '/rest/v1/rpc/search_style_guide_library_v2',
    '/rest/v1/rpc/search_style_groups_full_text',
    '/rest/v1/rpc/get_ai_tag_candidates',
    '/rest/v1/hts_rag_rulings'
  )
group by route
order by route;
