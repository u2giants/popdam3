-- Issue #1400: keep the existing Data Admin response contract, but source it
-- entirely from Universe B and enforce authorization in the same server-side
-- operation as the reads.  No browser can bypass this gate with direct table
-- reads once the application returns to this RPC.

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
  v_cursor_id integer;
  v_snapshot_at timestamptz := clock_timestamp();
  v_total_licensors integer;
  v_active_licensors integer;
  v_total_properties integer;
  v_properties_with_licensor integer;
  v_orphan_count integer;
  v_orphans jsonb;
  v_licensors jsonb;
  v_fetched integer;
  v_last_sort text;
  v_last_id integer;
  v_next_cursor text;
begin
  -- This call is deliberately inside the SECURITY DEFINER operation and runs
  -- before any Universe B table is read.
  perform app.require_licensing_manager_access();

  v_page_size := least(greatest(coalesce(p_page_size, 50), 1), 200);

  if p_cursor is not null then
    begin
      v_cursor_value := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'v';
      v_cursor_id := (convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'id')::integer;
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_value is null or v_cursor_id is null then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where lower(btrim(coalesce(l."licenseList_status", 'active'))) <> 'inactive'
    )::integer
  into v_total_licensors, v_active_licensors
  from core."licenseList" l;

  select
    count(*)::integer,
    count(*) filter (where l."licenseList_id" is not null)::integer,
    count(*) filter (where l."licenseList_id" is null)::integer
  into v_total_properties, v_properties_with_licensor, v_orphan_count
  from core.properties_and_characters p
  left join core."licenseList" l
    on l."licenseList_id" = p.licensor_id
  where p.type = 'PROPERTY';

  -- This list is intentionally complete on every page.  A missing integer
  -- parent is surfaced; it is never guessed from a title or code.
  with association_counts as (
    select a.property_id, count(*)::integer as character_count
    from core.property_character_associations a
    group by a.property_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id::text,
      'name', p.name,
      'code', p.source_licensed_property_id,
      'status', 'active',
      'licensor_id', p.licensor_id::text,
      'character_count', coalesce(ac.character_count, 0),
      'source_refs', case when p.source_licensed_property_id is null then '[]'::jsonb else
        jsonb_build_array(jsonb_build_object(
          'source_system', 'licensor_portal',
          'source_table', 'core.properties_and_characters',
          'source_id', p.source_licensed_property_id,
          'source_code', p.source_licensed_property_id,
          'source_name', p.name
        )) end,
      'plm_context', '[]'::jsonb,
      'updated_at', p.updated_at
    )
    order by lower(btrim(p.name)) collate "C", p.id
  ), '[]'::jsonb)
  into v_orphans
  from core.properties_and_characters p
  left join core."licenseList" l
    on l."licenseList_id" = p.licensor_id
  left join association_counts ac on ac.property_id = p.id
  where p.type = 'PROPERTY'
    and l."licenseList_id" is null;

  with association_counts as (
    select a.property_id, count(*)::integer as character_count
    from core.property_character_associations a
    group by a.property_id
  ), licensor_rows as (
    select
      l."licenseList_id" as id,
      coalesce(nullif(btrim(l."licenseList_title"), ''), '(Licensor ' || l."licenseList_id" || ')') as name,
      l."licenseList_code" as code,
      coalesce(nullif(lower(btrim(l."licenseList_status")), ''), 'active') as status,
      lower(coalesce(nullif(btrim(l."licenseList_title"), ''), '(Licensor ' || l."licenseList_id" || ')')) collate "C" as sort_value,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', p.id::text,
          'name', p.name,
          'code', p.source_licensed_property_id,
          'status', 'active',
          'licensor_id', p.licensor_id::text,
          'character_count', coalesce(ac.character_count, 0),
          'source_refs', case when p.source_licensed_property_id is null then '[]'::jsonb else
            jsonb_build_array(jsonb_build_object(
              'source_system', 'licensor_portal',
              'source_table', 'core.properties_and_characters',
              'source_id', p.source_licensed_property_id,
              'source_code', p.source_licensed_property_id,
              'source_name', p.name
            )) end,
          'plm_context', '[]'::jsonb,
          'updated_at', p.updated_at
        )
        order by lower(btrim(p.name)) collate "C", p.id
      ) filter (where p.id is not null), '[]'::jsonb) as properties
    from core."licenseList" l
    left join core.properties_and_characters p
      on p.licensor_id = l."licenseList_id"
     and p.type = 'PROPERTY'
     and (
       p_search is null
       or l."licenseList_title" ilike '%' || p_search || '%'
       or p.name ilike '%' || p_search || '%'
     )
    left join association_counts ac on ac.property_id = p.id
    where (p_include_inactive or lower(btrim(coalesce(l."licenseList_status", 'active'))) <> 'inactive')
      and (
        p_search is null
        or l."licenseList_title" ilike '%' || p_search || '%'
        or exists (
          select 1
          from core.properties_and_characters sp
          where sp.type = 'PROPERTY'
            and sp.licensor_id = l."licenseList_id"
            and sp.name ilike '%' || p_search || '%'
        )
      )
    group by l."licenseList_id", l."licenseList_title", l."licenseList_code", l."licenseList_status"
  ), cursor_filtered as (
    select lr.*
    from licensor_rows lr
    where p_cursor is null
       or (lr.sort_value, lr.id) > (v_cursor_value collate "C", v_cursor_id)
  ), ordered as (
    select cf.*
    from cursor_filtered cf
    order by cf.sort_value, cf.id
    limit v_page_size + 1
  ), numbered as (
    select o.*, row_number() over (order by o.sort_value, o.id) as rn
    from ordered o
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', n.id::text,
        'name', n.name,
        'code', n.code,
        'status', n.status,
        'property_count', jsonb_array_length(n.properties),
        'source_refs', '[]'::jsonb,
        'plm_context', '[]'::jsonb,
        'properties', n.properties,
        'updated_at', null
      ) order by n.rn
    ) filter (where n.rn <= v_page_size), '[]'::jsonb),
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
      'store', 'core.licenseList / core.properties_and_characters (Universe B)',
      'source_system', 'licensor_portal',
      'feeder_last_sync_at', null,
      'feeder_last_run_status', null,
      'feeder_days_stale', null,
      'feeder_available', false,
      'live_upstream_reconciliation', false,
      'note', 'Universe B licensor-portal mirror. PROPERTY rows only; character totals are aggregated from core.property_character_associations. Parentage uses only the integer licensor_id relationship.'
    ),
    'reconciliation', jsonb_build_object(
      'licensor_count', v_total_licensors,
      'active_licensor_count', v_active_licensors,
      'property_count', v_total_properties,
      'active_property_count', v_total_properties,
      'properties_with_licensor', v_properties_with_licensor,
      'orphan_property_count', v_orphan_count,
      'expected_orphan_count_is_zero', (v_orphan_count = 0),
      'partition_reconciles', (v_properties_with_licensor + v_orphan_count) = v_total_properties
    ),
    'licensors', v_licensors,
    'orphan_properties', v_orphans,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$function$;

comment on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) is
  'Licensing Manager read-only Universe B licensor/property hierarchy. Authorization and all reads occur server-side. Parentage uses only integer licensor_id; character totals are aggregated from property_character_associations. Stable keyset pages over normalized licensor title and integer id; orphan_properties is always complete.';

revoke all on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) from public;
grant execute on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) to authenticated;
