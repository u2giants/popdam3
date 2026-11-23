-- u2giants/popdam3#1272 (claim: popcre/shared-db#6986)
-- PopDAM shows the PLM production orders for a design. It used to copy the
-- PLM tracking feed into public.prod_order_headers_*; the orders already live
-- here in plm.production_order / plm.production_order_line, so PopDAM reads
-- them through this function instead (plm is not exposed to the API).
-- Production orders only: ColdLion sales orders (source_system 'coldlion')
-- share the table and are excluded. Read-only; runs as the caller, so the
-- existing production_order*_popdam_read RLS policies apply.
create or replace function api.dam_production_orders_for_sku(p_sku text)
returns table (
  production_order_id uuid,
  production_order_number text,
  status text,
  customer_name text,
  quantity numeric,
  order_date date,
  due_date date,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = api, plm, core, public
as $$
  select
    o.id,
    o.production_order_number,
    coalesce(nullif(o.status, ''), max(nullif(l.status, ''))) as status,
    coalesce(c.display_name, c.name) as customer_name,
    sum(l.quantity_ordered)::numeric as quantity,
    o.order_date::date,
    coalesce(min(l.cancel_date), o.requested_ship_date)::date as due_date,
    o.updated_at
  from plm.production_order_line l
  join plm.production_order o on o.id = l.production_order_id
  left join core.customer c on c.id = o.company_id
  where l.sku_normalized = lower(btrim(p_sku))
    and o.source_system is distinct from 'coldlion'
    and l.voided_at is null
    and o.voided_at is null
  group by o.id, o.production_order_number, o.status, c.display_name, c.name,
           o.order_date, o.requested_ship_date, o.updated_at
  order by o.production_order_number;
$$;

comment on function api.dam_production_orders_for_sku(text) is
  'PopDAM: PLM production orders (not ColdLion sales orders) containing a design SKU, one row per order. popdam3#1272.';

revoke all on function api.dam_production_orders_for_sku(text) from public, anon;
grant execute on function api.dam_production_orders_for_sku(text) to authenticated, service_role;
