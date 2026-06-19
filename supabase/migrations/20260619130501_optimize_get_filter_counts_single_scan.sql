-- Optimize get_filter_counts: the previous version ran FIVE separate full-table
-- scans of `assets` (one per facet), ~14s on 114k rows, blowing the 8s
-- `authenticated` statement_timeout and returning 500 to the Library on load.
--
-- Rewrite: scan the visible+common-filtered set ONCE into a materialized CTE,
-- then derive all five facet aggregations from that in-memory set. Each facet
-- still excludes its own filter (so selecting one value keeps the others'
-- counts visible) by applying the OTHER toggle predicates over the CTE.
--
-- Also force a seq scan for the base set: the query reads ~91% of the table, so
-- the planner's marginal preference for an index scan causes slow random heap
-- I/O when cold (~9.6s). A sequential scan of the 271MB heap is ~1-3s and
-- predictable, keeping the function safely under the 8s limit without adding a
-- write-amplifying covering index to the hot ingest table.
-- Result: ~14s -> 0.6s warm / ~6.5s cold worst-case.
CREATE OR REPLACE FUNCTION public.get_filter_counts(p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_min_date timestamptz;
  v_search text;
  v_file_types text[];
  v_statuses text[];
  v_workflow_statuses text[];
  v_is_licensed boolean;
  v_licensor_id uuid;
  v_property_id uuid;
  v_asset_types text[];
  v_art_sources text[];
  v_tag_filter text;
  v_stages text[];
  v_customer text;
  v_program text;
  v_result jsonb := '{}'::jsonb;
BEGIN
  -- Reading ~91% of the table; a seq scan beats random-heap index access here.
  -- Local to the PostgREST request transaction; auto-resets at commit.
  PERFORM set_config('enable_indexscan', 'off', true);
  PERFORM set_config('enable_bitmapscan', 'off', true);

  SELECT (value #>> '{}')::timestamptz INTO v_min_date
  FROM admin_config WHERE key = 'THUMBNAIL_MIN_DATE';
  IF v_min_date IS NULL THEN
    v_min_date := '2020-01-01'::timestamptz;
  END IF;

  v_search := p_filters ->> 'search';
  v_is_licensed := (p_filters ->> 'isLicensed')::boolean;
  v_licensor_id := (p_filters ->> 'licensorId')::uuid;
  v_property_id := (p_filters ->> 'propertyId')::uuid;
  v_tag_filter := p_filters ->> 'tagFilter';
  v_customer := p_filters ->> 'customer';
  v_program := p_filters ->> 'program';

  IF p_filters ? 'fileType' AND jsonb_array_length(p_filters -> 'fileType') > 0 THEN
    SELECT array_agg(x::text) INTO v_file_types FROM jsonb_array_elements_text(p_filters -> 'fileType') x;
  END IF;
  IF p_filters ? 'status' AND jsonb_array_length(p_filters -> 'status') > 0 THEN
    SELECT array_agg(x::text) INTO v_statuses FROM jsonb_array_elements_text(p_filters -> 'status') x;
  END IF;
  IF p_filters ? 'workflowStatus' AND jsonb_array_length(p_filters -> 'workflowStatus') > 0 THEN
    SELECT array_agg(x::text) INTO v_workflow_statuses FROM jsonb_array_elements_text(p_filters -> 'workflowStatus') x;
  END IF;
  IF p_filters ? 'assetType' AND jsonb_array_length(p_filters -> 'assetType') > 0 THEN
    SELECT array_agg(x::text) INTO v_asset_types FROM jsonb_array_elements_text(p_filters -> 'assetType') x;
  END IF;
  IF p_filters ? 'artSource' AND jsonb_array_length(p_filters -> 'artSource') > 0 THEN
    SELECT array_agg(x::text) INTO v_art_sources FROM jsonb_array_elements_text(p_filters -> 'artSource') x;
  END IF;
  IF p_filters ? 'stage' AND jsonb_array_length(p_filters -> 'stage') > 0 THEN
    SELECT array_agg(x::text) INTO v_stages FROM jsonb_array_elements_text(p_filters -> 'stage') x;
  END IF;

  -- Single scan: visibility + all filters that NO facet excludes (search,
  -- licensor, property, assetType, artSource, tag, customer, program).
  WITH base AS MATERIALIZED (
    SELECT file_type, status, workflow_status, stage, is_licensed
    FROM assets
    WHERE is_deleted = false
      AND (modified_at >= v_min_date OR file_created_at >= v_min_date OR thumbnail_url IS NOT NULL)
      AND (v_search IS NULL OR filename ILIKE '%' || v_search || '%')
      AND (v_licensor_id IS NULL OR licensor_id = v_licensor_id)
      AND (v_property_id IS NULL OR property_id = v_property_id)
      AND (v_asset_types IS NULL OR asset_type::text = ANY(v_asset_types))
      AND (v_art_sources IS NULL OR art_source::text = ANY(v_art_sources))
      AND (v_tag_filter IS NULL OR v_tag_filter = ANY(tags))
      AND (v_customer IS NULL OR customer = v_customer)
      AND (v_program IS NULL OR program = v_program)
  )
  SELECT jsonb_build_object(
    -- fileType: applies status, workflow, stage, licensed (excludes fileType)
    'fileType', COALESCE((
      SELECT jsonb_object_agg(file_type::text, cnt) FROM (
        SELECT file_type, count(*) AS cnt FROM base
        WHERE (v_statuses IS NULL OR status::text = ANY(v_statuses))
          AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
          AND (v_stages IS NULL OR stage = ANY(v_stages))
          AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        GROUP BY file_type
      ) s
    ), '{}'::jsonb),
    -- status: applies fileType, workflow, stage, licensed (excludes status)
    'status', COALESCE((
      SELECT jsonb_object_agg(status::text, cnt) FROM (
        SELECT status, count(*) AS cnt FROM base
        WHERE (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
          AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
          AND (v_stages IS NULL OR stage = ANY(v_stages))
          AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        GROUP BY status
      ) s
    ), '{}'::jsonb),
    -- workflowStatus: applies fileType, status, stage, licensed (excludes workflow)
    'workflowStatus', COALESCE((
      SELECT jsonb_object_agg(workflow_status, cnt) FROM (
        SELECT workflow_status, count(*) AS cnt FROM base
        WHERE workflow_status IS NOT NULL
          AND (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
          AND (v_statuses IS NULL OR status::text = ANY(v_statuses))
          AND (v_stages IS NULL OR stage = ANY(v_stages))
          AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        GROUP BY workflow_status
      ) s
    ), '{}'::jsonb),
    -- stage: applies fileType, status, workflow, licensed (excludes stage)
    'stage', COALESCE((
      SELECT jsonb_object_agg(stage, cnt) FROM (
        SELECT stage, count(*) AS cnt FROM base
        WHERE stage IS NOT NULL
          AND (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
          AND (v_statuses IS NULL OR status::text = ANY(v_statuses))
          AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
          AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        GROUP BY stage
      ) s
    ), '{}'::jsonb),
    -- isLicensed: applies fileType, status, workflow, stage (excludes licensed)
    'isLicensed', (
      SELECT jsonb_build_object(
        'true', COALESCE(sum(CASE WHEN is_licensed = true THEN 1 ELSE 0 END), 0),
        'false', COALESCE(sum(CASE WHEN is_licensed = false OR is_licensed IS NULL THEN 1 ELSE 0 END), 0)
      ) FROM base
      WHERE (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
        AND (v_statuses IS NULL OR status::text = ANY(v_statuses))
        AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
        AND (v_stages IS NULL OR stage = ANY(v_stages))
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
