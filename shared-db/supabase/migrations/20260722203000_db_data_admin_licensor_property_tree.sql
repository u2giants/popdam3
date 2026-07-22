-- DB Data Admin Delivery Step 10: fully read-only Licensor -> Property tree.
--
-- Additive only. No existing application contract is altered or replaced:
-- the Step 6 api.db_data_admin_licensor_property_list (migration 20260722005000)
-- keeps its current definition and grants. This migration adds a separate,
-- purpose-built tree contract for the Step 10 screen: a dated snapshot, an
-- internal reconciliation summary, the licensable hierarchy with division/
-- type-qualified source context, and a separate loud orphan collection.
--
-- Authority (see docs/merch-group-taxonomy-architecture.md):
--   * The Licensor -> Property EDGE is DesignFlow-owned and mirrored into
--     core.property.licensor_id. This function reads that canonical FK and
--     NEVER infers a relationship from mgTypeCode, mg_code, or any globally
--     unique code. Coldlion has no hierarchy and no active flag.
--   * mg_code is unique only within (division, mgTypeCode). The plm_context
--     payload qualifies each source row by division_code + mg_code + mg_type
--     label + mg_category so a code is never read out of its (division, type)
--     context. It is display/identity metadata, never relationship authority.
--
-- Honesty about the feeder: the upstream DesignFlow master-data sync
-- (getLicensorsWithProperties -> plm.import_master_data) is currently
-- unavailable (502; last success 2026-07-08). This function therefore reports
-- observed mirror state and an explicit feeder_available flag derived from
-- ingest.sync_run, and it never claims live upstream reconciliation. Internal
-- canonical invariants (every property under exactly one licensor or surfaced
-- as an orphan; orphan count expected to be zero) remain independently true.
--
-- Security: the function is SECURITY DEFINER with a pinned search_path and
-- fully qualified objects, EXECUTE revoked from public, granted only to
-- authenticated, and gated by app.require_db_data_admin_access() (active
-- administrator role AND an explicit, non-revoked admin app_access row).
-- Browser roles receive no direct cross-schema privilege; only approved
-- business fields are returned, never raw source payloads.

create or replace function api.db_data_admin_licensor_property_tree(
  p_search text default null,
  p_include_inactive boolean default false,
  p_cursor text default null,
  p_page_size integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  v_page_size integer;
  v_cursor_value text;
  v_cursor_id uuid;
  v_snapshot_at timestamptz := clock_timestamp();
  v_feeder_last_sync_at timestamptz;
  v_feeder_last_run_status text;
  v_feeder_days_stale integer;
  v_feeder_available boolean := false;
  v_total_licensors integer;
  v_active_licensors integer;
  v_total_properties integer;
  v_active_properties integer;
  v_properties_with_licensor integer;
  v_orphan_count integer;
  v_orphans jsonb;
  v_licensors jsonb;
  v_fetched integer;
  v_last_sort text;
  v_last_id uuid;
  v_next_cursor text;
begin
  perform app.require_db_data_admin_access();

  v_page_size := least(greatest(coalesce(p_page_size, 50), 1), 200);

  if p_cursor is not null then
    begin
      v_cursor_value := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'v';
      v_cursor_id := (convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'id')::uuid;
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_value is null or v_cursor_id is null then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- ------------------------------------------------------------------
  -- Feeder / snapshot context. Observed recency of the designflow_plm
  -- feeder only; this never reaches the upstream endpoint. A nightly sync
  -- that has not succeeded within ~2 days is treated as unavailable, so
  -- feeder_available tracks observed mirror recency. That recency is NOT
  -- proof of live reconciliation: this function reads only the canonical
  -- mirror + ingest.sync_run and never compares against live DesignFlow,
  -- so live_upstream_reconciliation is reported as false unconditionally.
  -- ------------------------------------------------------------------
  select max(s.started_at)
  into v_feeder_last_sync_at
  from ingest.sync_run s
  where s.source_system = 'designflow_plm';

  select s.status::text into v_feeder_last_run_status
  from ingest.sync_run s
  where s.source_system = 'designflow_plm'
  order by s.started_at desc nulls last, s.id desc
  limit 1;

  if v_feeder_last_sync_at is not null then
    v_feeder_days_stale := (v_snapshot_at at time zone 'UTC')::date
                         - (v_feeder_last_sync_at at time zone 'UTC')::date;
    v_feeder_available := (v_feeder_last_run_status = 'succeeded'
                           and coalesce(v_feeder_days_stale, 99) <= 2);
  else
    v_feeder_days_stale := null;
    v_feeder_available := false;
  end if;

  -- ------------------------------------------------------------------
  -- Reconciliation summary computed directly from the canonical tables.
  -- These are the structural invariants; they are independent of the
  -- paginated licensable payload below.
  -- ------------------------------------------------------------------
  select count(*),
         count(*) filter (where l.status in ('active'::app.entity_status, 'potential'::app.entity_status))
  into v_total_licensors, v_active_licensors
  from core.licensor l;

  select count(*),
         count(*) filter (where p.status in ('active'::app.entity_status, 'potential'::app.entity_status)),
         count(*) filter (where p.licensor_id is not null),
         count(*) filter (where p.licensor_id is null)
  into v_total_properties, v_active_properties, v_properties_with_licensor, v_orphan_count
  from core.property p;

  -- ------------------------------------------------------------------
  -- Orphan properties: always the complete anomaly list, never filtered by
  -- status or search. A non-empty list is a loud error state in the UI.
  -- ------------------------------------------------------------------
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', op.id,
      'name', op.name,
      'code', op.code,
      'status', op.status::text,
      'licensor_id', null,
      'character_count', (
        select count(*)::integer
        from core.character ch
        where ch.property_id = op.id
      ),
      'source_refs', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'source_system', r.source_system,
            'source_table', r.source_table,
            'source_id', r.source_id,
            'source_code', r.source_code,
            'source_name', r.source_name
          )
          order by r.source_system, r.source_table, r.source_id
        )
        from core.taxonomy_source_ref r
        where r.entity_schema = 'core'
          and r.entity_table = 'property'
          and r.entity_id = op.id
      ), '[]'::jsonb),
      -- Division/type-qualified PLM mirror context. mg_type is a fixed
      -- label here (property rows are MG06); it never drives the edge.
      'plm_context', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'plm_id', pi.plm_property_id,
            'division_code', pi.division_code,
            'mg_code', pi.mg_code,
            'mg_type', 'property',
            'mg_category', pi.mg_category
          )
          order by pi.division_code nulls last, pi.mg_code nulls last, pi.plm_property_id
        )
        from plm.property_import pi
        where pi.property_id = op.id
      ), '[]'::jsonb),
      'updated_at', op.updated_at
    )
    order by lower(op.name) collate "C", op.id
  ), '[]'::jsonb)
  into v_orphans
  from core.property op
  where op.licensor_id is null;

  -- ------------------------------------------------------------------
  -- Licensable hierarchy. Pages over licensors by name; the cursor is an
  -- opaque base64 keyset over (lower(name), id). A licensor matches the
  -- search if its own name matches or any of its properties match, so a
  -- property search still reveals its parent licensor.
  -- ------------------------------------------------------------------
  with licensor_match as (
    select
      l.id,
      l.name,
      l.code,
      l.status,
      l.updated_at,
      lower(l.name) collate "C" as sort_value,
      (p_search is null or l.name ilike '%' || p_search || '%') as name_matches
    from core.licensor l
    where (
      p_include_inactive
      or l.status in ('active'::app.entity_status, 'potential'::app.entity_status)
    )
  ),
  licensor_rows as (
    select
      lm.id,
      lm.name,
      lm.code,
      lm.status,
      lm.updated_at,
      lm.sort_value,
      lm.name_matches,
      (
        select count(*)::integer
        from core.property p
        where p.licensor_id = lm.id
          and (
            p_include_inactive
            or p.status in ('active'::app.entity_status, 'potential'::app.entity_status)
          )
      ) as property_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'source_system', r.source_system,
            'source_table', r.source_table,
            'source_id', r.source_id,
            'source_code', r.source_code,
            'source_name', r.source_name
          )
          order by r.source_system, r.source_table, r.source_id
        )
        from core.taxonomy_source_ref r
        where r.entity_schema = 'core'
          and r.entity_table = 'licensor'
          and r.entity_id = lm.id
      ), '[]'::jsonb) as source_refs,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'plm_id', li.plm_licensor_id,
            'division_code', li.division_code,
            'mg_code', li.mg_code,
            'mg_type', 'licensor',
            'mg_category', li.mg_category
          )
          order by li.division_code nulls last, li.mg_code nulls last, li.plm_licensor_id
        )
        from plm.licensor_import li
        where li.licensor_id = lm.id
      ), '[]'::jsonb) as plm_context,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'code', p.code,
            'status', p.status::text,
            'licensor_id', p.licensor_id,
            'character_count', (
              select count(*)::integer
              from core.character ch
              where ch.property_id = p.id
            ),
            'source_refs', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'source_system', r.source_system,
                  'source_table', r.source_table,
                  'source_id', r.source_id,
                  'source_code', r.source_code,
                  'source_name', r.source_name
                )
                order by r.source_system, r.source_table, r.source_id
              )
              from core.taxonomy_source_ref r
              where r.entity_schema = 'core'
                and r.entity_table = 'property'
                and r.entity_id = p.id
            ), '[]'::jsonb),
            'plm_context', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'plm_id', pi.plm_property_id,
                  'division_code', pi.division_code,
                  'mg_code', pi.mg_code,
                  'mg_type', 'property',
                  'mg_category', pi.mg_category
                )
                order by pi.division_code nulls last, pi.mg_code nulls last, pi.plm_property_id
              )
              from plm.property_import pi
              where pi.property_id = p.id
            ), '[]'::jsonb)
          )
          order by lower(p.name) collate "C", p.id
        )
        from core.property p
        where p.licensor_id = lm.id
          and (
            p_include_inactive
            or p.status in ('active'::app.entity_status, 'potential'::app.entity_status)
          )
          and (lm.name_matches or p.name ilike '%' || p_search || '%')
      ), '[]'::jsonb) as properties
    from licensor_match lm
  ),
  qualified as (
    select lr.*
    from licensor_rows lr
    -- Keep a licensor whose own name matched, or whose visible property set
    -- is non-empty after the property-name search.
    where lr.name_matches
       or jsonb_array_length(coalesce(lr.properties, '[]'::jsonb)) > 0
  ),
  cursor_filtered as (
    select q.*
    from qualified q
    where p_cursor is null
      or (q.sort_value collate "C", q.id::text) > (v_cursor_value, v_cursor_id::text)
  ),
  ordered as (
    select cf.*
    from cursor_filtered cf
    order by cf.sort_value asc, cf.id::text asc
    limit v_page_size + 1
  ),
  numbered as (
    select
      o.*,
      row_number() over (order by o.sort_value asc, o.id::text asc) as rn
    from ordered o
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'name', n.name,
          'code', n.code,
          'status', n.status::text,
          'property_count', n.property_count,
          'source_refs', n.source_refs,
          'plm_context', n.plm_context,
          'properties', n.properties,
          'updated_at', n.updated_at
        )
        order by n.rn
      ) filter (where n.rn <= v_page_size),
      '[]'::jsonb
    ),
    count(*),
    max(n.sort_value) filter (where n.rn = v_page_size),
    max(n.id) filter (where n.rn = v_page_size)
  into v_licensors, v_fetched, v_last_sort, v_last_id
  from numbered n;

  if v_fetched > v_page_size and v_last_id is not null then
    v_next_cursor := encode(
      convert_to(jsonb_build_object('v', v_last_sort, 'id', v_last_id)::text, 'UTF8'),
      'base64'
    );
  end if;

  return jsonb_build_object(
    'snapshot', jsonb_build_object(
      'snapshot_at', v_snapshot_at,
      'store', 'core.licensor / core.property (Supabase canonical mirror)',
      'source_system', 'designflow_plm',
      'feeder_last_sync_at', v_feeder_last_sync_at,
      'feeder_last_run_status', v_feeder_last_run_status,
      'feeder_days_stale', v_feeder_days_stale,
      'feeder_available', v_feeder_available,
      'live_upstream_reconciliation', false,
      'note', 'Snapshot of the canonical Supabase mirror only. The Licensor->Property edge is DesignFlow-owned and mirrored via core.property.licensor_id; it is not inferred from mgTypeCode or mg_code. feeder_available reflects observed recency of the designflow_plm feeder (from ingest.sync_run) and does NOT prove live reconciliation. This function never queries or compares against the live DesignFlow upstream, so live_upstream_reconciliation is always false.'
    ),
    'reconciliation', jsonb_build_object(
      'licensor_count', v_total_licensors,
      'active_licensor_count', v_active_licensors,
      'property_count', v_total_properties,
      'active_property_count', v_active_properties,
      'properties_with_licensor', v_properties_with_licensor,
      'orphan_property_count', v_orphan_count,
      'expected_orphan_count_is_zero', (v_orphan_count = 0),
      'partition_reconciles',
        (v_properties_with_licensor + v_orphan_count) = v_total_properties
    ),
    'licensors', v_licensors,
    'orphan_properties', v_orphans,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$$;

comment on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) is
  'DB Data Admin only. Fully read-only Licensor -> Property tree (Step 10): dated snapshot with observed feeder status, internal reconciliation summary, the licensable hierarchy with division/type-qualified source context and counts, and a separate always-complete loud orphan collection. The edge comes only from core.property.licensor_id; it is never inferred from mgTypeCode or globally unique codes. Pages over licensors by name; orphan_properties is always the complete anomaly list. Returns {snapshot, reconciliation, licensors, orphan_properties, next_cursor, page_size}.';

revoke all on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) from public;
grant execute on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) to authenticated;

notify pgrst, 'reload schema';
