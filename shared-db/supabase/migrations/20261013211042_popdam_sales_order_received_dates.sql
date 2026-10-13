-- #4268 / PopDAM #277: bounded line-level ColdLion SO received dates.
-- OrderList already grants all authenticated staff read access to canonical lines.
-- Do not expose ColdLion landing tables or infer another order's identity.
begin;

do $dependencies$
declare dependency record;
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid = to_regclass('api.dam_order_list') and c.relkind = 'v'
      and c.reloptions @> array['security_invoker=true']
  ) then
    raise exception '#4268 requires the security-invoker OrderList view';
  end if;
  for dependency in select * from (values
    ('api.dam_order_list', 'order_line_id', 'uuid'),
    ('api.dam_order_list', 'coldlion_source_id', 'text'),
    ('coldlion.order_history_line', 'company_code', 'text'),
    ('coldlion.order_history_line', 'sales_order_no', 'bigint'),
    ('coldlion.order_history_line', 'created_time', 'timestamp with time zone')
  ) expected(object_name, column_name, type_name)
  loop
    if not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = to_regclass(dependency.object_name)
        and a.attname = dependency.column_name and not a.attisdropped
        and a.atttypid = to_regtype(dependency.type_name)
    ) then
      raise exception '#4268 dependency missing or changed: %.% (%)',
        dependency.object_name, dependency.column_name, dependency.type_name;
    end if;
  end loop;
  -- The current view (20261009073649) selects only primary ColdLion refs.
  if position('coldlion_ref.is_primary' in lower(pg_get_viewdef('api.dam_order_list'::regclass))) = 0 then
    raise exception '#4268 requires primary-only ColdLion references in OrderList';
  end if;
end;
$dependencies$;

create or replace function public.get_dam_order_sales_order_dates(p_line_ids uuid[])
returns table(order_line_id uuid, sales_order_date date)
language plpgsql stable security definer
set search_path = pg_catalog
as $$
begin
  -- Matches today's authenticated-wide OrderList read policies. If those
  -- policies narrow, this definer reader's authorization must change with them.
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_line_ids is null or cardinality(p_line_ids) > 1500
     or array_position(p_line_ids, null::uuid) is not null then
    raise exception 'Provide at most 1500 non-null OrderList line IDs' using errcode = '22023';
  end if;

  return query
  with visible_lines as materialized (
    select distinct o.order_line_id, o.coldlion_source_id
    from api.dam_order_list o
    where o.order_line_id = any(p_line_ids)
  ), linked as materialized (
    select v.order_line_id,
      case when v.coldlion_source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,10}:component:[1-9][0-9]{0,9}$'
        then split_part(v.coldlion_source_id, ':', 3)::bigint end as so_number
    from visible_lines v
  ), source_dates as materialized (
    select h.sales_order_no,
      case when count(*) = count(h.created_time)
        and count(distinct h.created_time) = 1
        and min(h.created_time) > timestamptz '2000-01-01 00:00:00+00'
      then (min(h.created_time) at time zone 'America/New_York')::date end as so_date
    from coldlion.order_history_line h
    where h.company_code = 'EDGEHOME'
      and h.sales_order_no in (select distinct l.so_number from linked l where l.so_number is not null)
    group by h.sales_order_no
  )
  select l.order_line_id, d.so_date
  from linked l left join source_dates d on d.sales_order_no = l.so_number;
end;
$$;

revoke all on function public.get_dam_order_sales_order_dates(uuid[]) from public, anon;
grant execute on function public.get_dam_order_sales_order_dates(uuid[]) to authenticated;
comment on function public.get_dam_order_sales_order_dates(uuid[]) is
  'Bounded authenticated OrderList SO Date reader. Exact existing ColdLion source references only, company EDGEHOME; /orderHistory.createdTime is the received/entry time. America/New_York date; missing or conflicting stamps return NULL. No header-level earliest-date inference or raw landing access. #4268, PopDAM #277.';

commit;
