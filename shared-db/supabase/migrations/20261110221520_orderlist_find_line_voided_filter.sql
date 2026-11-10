-- OrderList hides retired lines (PO 62012008 / SO 7128129, 2026-11-10).
-- Work issue #6022.
-- derived-from: 20261102180759
-- The ColdLion writer voids a component that ColdLion replaced on the same
-- sales-order line (AAH6208 -> BRG6205 on 2026-11-02), but the OrderList still
-- listed the voided lines, faded, among live ones, and a buyer read them as
-- wrongly linked. PopDAM now filters `line_voided_at is null` by default. Find
-- must apply the same filter so "N of M" positions match the grid, so the
-- allowlist gains line_voided_at and order_voided_at. Nothing else changes.
begin;

do $dependencies$
begin
  if to_regprocedure('public.find_dam_order_list_row(text,jsonb,jsonb,integer)') is null then
    raise exception 'requires public.find_dam_order_list_row(text,jsonb,jsonb,integer)';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute a
      where a.attrelid=to_regclass('api.dam_order_list') and a.attname='line_voided_at' and not a.attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute a
      where a.attrelid=to_regclass('api.dam_order_list') and a.attname='order_voided_at' and not a.attisdropped) then
    raise exception 'requires api.dam_order_list.line_voided_at and order_voided_at';
  end if;
end;
$dependencies$;

create or replace function public.find_dam_order_list_row(
  p_search text,
  p_filters jsonb default '[]'::jsonb,
  p_sort jsonb default '[]'::jsonb,
  p_occurrence integer default 1
) returns table(order_line_id uuid, row_index bigint, match_count bigint)
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
    'coldlion_source_id','order_void_reason','line_void_reason',
    'order_voided_at','line_voided_at'
  ];
  sort_only_columns constant text[] := array['sales_order_received_date'];
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
  if p_occurrence is null or p_occurrence < 1 then
    raise invalid_parameter_value using message = 'Occurrence must be a positive integer';
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
      raise invalid_parameter_value using message = 'Unsupported normalized sort';
    end if;
    col := spec->>'column';
    if col is null or not (col = any(allowed_columns) or col = any(sort_only_columns))
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
    ),
    matched as (
      select r.order_line_id, r.row_index,
        row_number() over (order by r.row_index) as match_ordinal,
        count(*) over () as match_count
      from ranked r
      where r.matches
    )
    select m.order_line_id, m.row_index, m.match_count
    from matched m
    where m.match_ordinal = $2
  $query$, ordering, predicates) using pattern, p_occurrence;
end;
$function$;
revoke all on function public.find_dam_order_list_row(text,jsonb,jsonb,integer) from public, anon, service_role;
grant execute on function public.find_dam_order_list_row(text,jsonb,jsonb,integer) to authenticated;
comment on function public.find_dam_order_list_row(text,jsonb,jsonb,integer) is
  'Authenticated invoker-only OrderList Find: normalized PopDAM filters/sorts; SO received date is sort-only; the requested 1-based occurrence of the literal search match, its zero-based position within the full filtered grid, and the total number of matches.';

commit;
