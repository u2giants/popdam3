-- Licensing-manager gate for DB Data Admin.
--
-- Owner ruling, Albert Hazan, 2026-08-13: the person who operates the ColdLion ->
-- canonical property mapping screen is a licensing manager, not a company-wide
-- administrator. Granting `administrator` to reach that screen also opens Customers,
-- Vendors, merges, product depth, and every other surface gated on
-- app.has_role('administrator') across the shared database. That is too much.
--
-- The `licensing` role already exists in app.role (slug 'licensing') and in the
-- app_role enum. It is simply wired to nothing. This migration wires it, narrowly.
--
-- Scope note: this changes AUTHORIZATION for the licensor/property read path only.
-- Customers, Vendors, all merge RPCs and all product-depth RPCs keep the existing
-- administrator gate and are untouched here.

-- ---------------------------------------------------------------------------
-- 1. The narrower gate.
--
-- Satisfied by administrator (unchanged reach) OR licensing. Application access is
-- accepted from the existing 'admin' surface so an administrator keeps working with
-- no regrant, or from 'plm', which licensing managers already hold for the PLM
-- surface. Deliberately NOT adding a new app_name enum value: adding one cannot be
-- used in the same transaction that adds it, and 'plm' already means exactly
-- "the licensing/PLM surface" here.
--
-- Same SECURITY DEFINER shape, same search_path pinning and same
-- insufficient_privilege errcode as app.require_db_data_admin_access(), so callers
-- and the front end handle failure identically.
-- ---------------------------------------------------------------------------
create or replace function app.require_licensing_manager_access()
returns void
language plpgsql
stable
set search_path to 'app', 'public'
as $function$
begin
  if not (
    (app.has_role('administrator') and app.has_explicit_app_access('admin'))
    or
    (app.has_role('licensing') and (
        app.has_explicit_app_access('plm') or app.has_explicit_app_access('admin')
    ))
  ) then
    raise exception 'db_data_admin: not authorized'
      using errcode = 'insufficient_privilege';
  end if;
end;
$function$;

comment on function app.require_licensing_manager_access() is
  'Gate for the DB Data Admin licensor/property and mapping surface. Administrator '
  'keeps full reach; a licensing manager reaches ONLY this surface. Never use this '
  'for customer, vendor, merge or product-depth RPCs - those stay on '
  'app.require_db_data_admin_access().';

revoke all on function app.require_licensing_manager_access() from public;
grant execute on function app.require_licensing_manager_access() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Re-gate the licensor/property tree onto the narrower function.
--
-- The body is reproduced verbatim from the deployed definition of
-- api.db_data_admin_licensor_property_tree, with exactly one line changed:
--   perform app.require_db_data_admin_access();
-- becomes
--   perform app.require_licensing_manager_access();
-- No query, column, guard, cursor, count or returned key is altered. Both the
-- Licensors tab and the Properties tab read this one function.
-- ---------------------------------------------------------------------------
create or replace function api.db_data_admin_licensor_property_tree(
  p_search text default null::text,
  p_include_inactive boolean default false,
  p_cursor text default null::text,
  p_page_size integer default null::integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app', 'public'
as $function$
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
  perform app.require_licensing_manager_access();

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
      'plm_context', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'plm_id', pi.plm_property_id,
            'division_code', pi.division_code,
            'division_name', (
              select d.division_name from plm."divisionCode" d
              where d."divCode_id"::text = pi.division_code
            ),
            'division_external_code', (
              select d.external_divisoncode from plm."divisionCode" d
              where d."divCode_id"::text = pi.division_code
            ),
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
            'division_name', (
              select d.division_name from plm."divisionCode" d
              where d."divCode_id"::text = li.division_code
            ),
            'division_external_code', (
              select d.external_divisoncode from plm."divisionCode" d
              where d."divCode_id"::text = li.division_code
            ),
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
                  'division_name', (
                    select d.division_name from plm."divisionCode" d
                    where d."divCode_id"::text = pi.division_code
                  ),
                  'division_external_code', (
                    select d.external_divisoncode from plm."divisionCode" d
                    where d."divCode_id"::text = pi.division_code
                  ),
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
    (max(n.id::text) filter (where n.rn = v_page_size))::uuid
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
$function$;
