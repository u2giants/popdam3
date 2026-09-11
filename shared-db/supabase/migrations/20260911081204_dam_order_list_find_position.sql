-- Issue #2664 (duplicate #2665), object claim #2747.
-- Inputs are PopDAM buildOrderListFilters/buildOrderListSort normalized arrays.
-- Find ranks the filtered grid BEFORE selecting a search match; it never filters
-- the position space. No app rows, existing view, policies or timeout are changed.
create or replace function public.find_dam_order_list_row(
  p_search text,
  p_filters jsonb default '[]'::jsonb,
  p_sort jsonb default '[]'::jsonb
) returns table(order_line_id uuid, row_index bigint)
language plpgsql stable security invoker
set search_path = pg_catalog, auth
as $function$
declare
  allowed_columns constant text[] := array[
    'order_line_id','order_status','production_order_number','vendor_name',
    'order_date','sent_po_date','customer_name','customer_po_number','sku',
    'master_data_match_status','master_data_description','master_data_license_status',
    'master_data_licensor','source_style_type','quantity_ordered','case_pack',
    'start_ship_date','cancel_date','requested_ship_date','actual_ship_date','etd',
    'eta','warehouse_date','container_booking_group','mbl','close_tracking',
    'line_number','order_person','order_type','customer_suffix','ordering_company',
    'assortment_id','assortment_component_ordinal','quantity_shipped','unit_cost',
    'order_depth_inches','cases_reported','ship_to','cargo_forecast_date',
    'start_ship_raw','cancel_raw','cargo_forecast_raw','seal_container_date',
    'vendor_delivery_date','booking_state','test_report','professional_photos',
    'contractual_sample_reorder','line_status','master_data_default_vendor',
    'master_data_customer','item_number','item_style_number','snapshot_description',
    'snapshot_license_status','snapshot_sku','snapshot_source_row','google_source_id',
    'coldlion_source_id','order_void_reason','line_void_reason'
  ];
  spec jsonb;
  col text;
  op text;
  sql_op text;
  predicates text := 'true';
  ordering text := '';
  pattern text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise insufficient_privilege using message = 'Authenticated access required';
  end if;
  p_filters := coalesce(p_filters, '[]'::jsonb);
  p_sort := coalesce(p_sort, '[]'::jsonb);
  if jsonb_typeof(p_filters) <> 'array' or jsonb_typeof(p_sort) <> 'array' then
    raise invalid_parameter_value using message = 'Filters and sort must be normalized arrays';
  end if;
  for spec in select value from jsonb_array_elements(p_filters) loop
    if jsonb_typeof(spec) <> 'object' then
      raise invalid_parameter_value using message = 'Invalid normalized filter';
    end if;
    col := spec->>'column'; op := spec->>'operator';
    if col is null or not (col = any(allowed_columns))
       or op is null or op not in ('eq','neq','gt','gte','lt','lte','ilike','not.ilike','is','not.is')
       or not (spec ? 'value')
       or exists(select 1 from jsonb_object_keys(spec) k where k not in ('column','operator','value')) then
      raise invalid_parameter_value using message = 'Unsupported normalized filter';
    end if;
    if op in ('is','not.is') then
      if spec->'value' <> 'null'::jsonb then
        raise invalid_parameter_value using message = 'Null filter requires a null value';
      end if;
      predicates := predicates || format(' and d.%I is %snull', col, case when op='not.is' then 'not ' else '' end);
    else
      if jsonb_typeof(spec->'value') not in ('string','number','boolean') then
        raise invalid_parameter_value using message = 'Comparison filter requires a scalar value';
      end if;
      sql_op := case op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>'
        when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<='
        when 'ilike' then 'ilike' when 'not.ilike' then 'not ilike' end;
      -- %I quotes an allowlisted identifier; %L quotes a value. The unknown SQL
      -- literal is coerced to the view column's native type, as PostgREST does.
      -- Normalized ilike values already contain PopDAM's literal escaping.
      predicates := predicates || format(' and d.%I %s %L', col, sql_op, spec->>'value');
    end if;
  end loop;
  for spec in select value from jsonb_array_elements(p_sort) loop
    if jsonb_typeof(spec) <> 'object' then
      raise invalid_parameter_value using message = 'Invalid normalized sort';
    end if;
    col := spec->>'column';
    if col is null or not (col = any(allowed_columns))
       or jsonb_typeof(spec->'ascending') is distinct from 'boolean'
       or exists(select 1 from jsonb_object_keys(spec) k where k not in ('column','ascending')) then
      raise invalid_parameter_value using message = 'Unsupported normalized sort';
    end if;
    ordering := ordering || format('d.%I %s nulls last, ', col,
      case when (spec->>'ascending')::boolean then 'asc' else 'desc' end);
  end loop;
  if ordering = '' then ordering := 'd.order_date desc nulls last, '; end if;
  ordering := ordering || 'd.order_line_id asc nulls last';
  -- ECMAScript String.trim whitespace, matching PopDAM rather than just ASCII space.
  p_search := btrim(p_search, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if p_search is null or p_search = '' then return; end if;
  pattern := '%' || replace(replace(replace(p_search, chr(92), chr(92)||chr(92)),
    '%', chr(92)||'%'), '_', chr(92)||'_') || '%';
  return query execute format($query$
    with ranked as materialized (
      select d.order_line_id, row_number() over(order by %s) - 1 as row_index,
        (d.production_order_number ilike $1 or d.order_status ilike $1
         or d.customer_po_number ilike $1 or d.sku ilike $1
         or d.vendor_name ilike $1 or d.customer_name ilike $1
         or d.container_booking_group ilike $1 or d.mbl ilike $1
         or d.snapshot_description ilike $1) as matches
      from api.dam_order_list d where %s
    )
    select r.order_line_id, r.row_index from ranked r
    where r.matches order by r.row_index limit 1
  $query$, ordering, predicates) using pattern;
end;
$function$;
revoke all on function public.find_dam_order_list_row(text,jsonb,jsonb) from public, anon, service_role;
grant execute on function public.find_dam_order_list_row(text,jsonb,jsonb) to authenticated;
comment on function public.find_dam_order_list_row(text,jsonb,jsonb) is
  'Authenticated invoker-only OrderList Find: normalized PopDAM filters/sorts; first literal search match and zero-based position within the full filtered grid.';
