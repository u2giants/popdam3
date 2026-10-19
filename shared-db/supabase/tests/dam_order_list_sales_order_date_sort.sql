-- Read-only catalog contracts for #4336 OrderList SO Date sort.
-- The live view columns and helper grants must survive; Find accepts the SO date as sort-only.
do $$
declare src text;
begin
  if not exists (select 1 from pg_attribute where attrelid='api.dam_order_list'::regclass
      and attname='sales_order_received_date' and not attisdropped)
    or not exists (select 1 from pg_attribute where attrelid='api.dam_order_list'::regclass
      and attname='order_window_date' and not attisdropped) then
    raise exception 'OrderList view lost sales_order_received_date or order_window_date';
  end if;
  if not has_function_privilege('service_role','dam.orderlist_sales_order_received_date(text)','execute')
    or not has_function_privilege('authenticated','dam.orderlist_sales_order_received_date(text)','execute') then
    raise exception 'SO-date helper lost authenticated/service_role execute';
  end if;
  select prosrc into strict src from pg_proc
    where oid='public.find_dam_order_list_row(text,jsonb,jsonb)'::regprocedure;
  if position('sort_only_columns constant text[] := array[''sales_order_received_date'']' in src)=0 then
    raise exception 'Find must accept sales_order_received_date as a sort-only key';
  end if;
end $$;
