-- u2giants/popdam3#1272 (claim: popcre/shared-db#6986)
-- PopDAM shows the PLM production orders for a design. It used to copy the
-- PLM tracking feed into public.prod_order_headers_*; the orders already live
-- here in plm.production_order / plm.production_order_line, so PopDAM reads
-- them through this function instead (plm is not exposed to the API).
-- ColdLion sales-order placeholders share the table and are excluded.
-- Read-only; runs as the caller, so the
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
  with physical_lines as (
    select
      l.order_id,
      l.customer_name,
      max(nullif(l.line_status, '')) as line_status,
      case when count(distinct coalesce(l.quantity_ordered, l.assortment_parent_quantity)) = 1
        then max(coalesce(l.quantity_ordered, l.assortment_parent_quantity))
      end as quantity
    from api.dam_order_list l
    where l.sku_normalized = lower(btrim(p_sku))
      and l.line_voided_at is null
      and l.order_voided_at is null
    -- Count each physical assortment once when component quantities were not supplied.
    group by l.order_id, l.customer_name,
      case when l.quantity_ordered is null then l.assortment_parent_key end,
      case when l.quantity_ordered is not null or l.assortment_parent_key is null then l.order_line_id end
  )
  select
    o.id,
    o.production_order_number,
    -- The header status wins. With a blank header, use the maximum nonempty
    -- status text across matching lines as a deterministic display fallback.
    coalesce(nullif(o.status, ''), max(l.line_status)) as status,
    l.customer_name,
    sum(l.quantity) as quantity,
    o.order_date::date,
    o.requested_ship_date::date as due_date,
    o.updated_at
  from physical_lines l
  join plm.production_order o on o.id = l.order_id
  -- Match OrderList's legacy exclusion and also exclude newer intake placeholders.
  where not (coalesce(o.source_system = 'coldlion', false)
             and o.production_order_number like 'coldlion/%')
    and not (coalesce(o.metadata ->> 'production_order_number_origin' = 'coldlion_intake_placeholder', false)
             and o.production_order_number ~ '^COLDLION-SO-[0-9]+$')
  group by o.id, l.customer_name
  order by o.production_order_number;
$$;

comment on function api.dam_production_orders_for_sku(text) is
  'PopDAM: PLM production orders (not ColdLion sales orders) containing a design SKU, one row per order. popdam3#1272.';

revoke all on function api.dam_production_orders_for_sku(text) from public, anon;
grant execute on function api.dam_production_orders_for_sku(text) to authenticated, service_role;
