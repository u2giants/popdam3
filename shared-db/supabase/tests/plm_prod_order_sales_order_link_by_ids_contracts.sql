-- designflow-tracking#138: plm.prod_order_sales_order_link(ids) must return exactly
-- the rows of plm.v_prod_order_sales_order_link for those ids. Reuses the
-- synthetic orders of the view contract by running it first in this
-- transaction. Synthetic rows only; the CI runner wraps this file in begin/rollback.

\ir plm_prod_order_sales_order_link_contracts.sql
-- The CI replay can reach this migration before the view exists (it then
-- skips by design), so apply it again here, after the view contract.
\ir ../migrations/20261225140000_prod_order_sales_order_link_by_ids.sql

do $$
declare
  ids integer[];
  one integer[];
  diff bigint;
begin
  if to_regprocedure('plm.prod_order_sales_order_link(integer[])') is null then
    raise exception 'plm.prod_order_sales_order_link(integer[]) is missing';
  end if;
  if has_function_privilege('anon', 'plm.prod_order_sales_order_link(integer[])', 'execute')
     or has_function_privilege('authenticated', 'plm.prod_order_sales_order_link(integer[])', 'execute')
     or has_function_privilege('service_role', 'plm.prod_order_sales_order_link(integer[])', 'execute') then
    raise exception 'anon, authenticated and service_role must not execute the by-ids link';
  end if;

  select array_agg(id) into ids from plm."ProdOrderHeader";

  -- Every id set: all orders, each order alone, and an empty and null set.
  select count(*) into diff from (
      (select * from plm.prod_order_sales_order_link(ids)
       except all
       select * from plm.v_prod_order_sales_order_link where prod_order_header_id = any(ids))
      union all
      (select * from plm.v_prod_order_sales_order_link where prod_order_header_id = any(ids)
       except all
       select * from plm.prod_order_sales_order_link(ids))) d;
  if diff <> 0 then raise exception 'by-ids differs from the view for all orders (% rows)', diff; end if;
  if (select count(*) from plm.prod_order_sales_order_link(ids)) = 0 then
    raise exception 'the synthetic orders must produce link rows to compare';
  end if;

  for one in select array[i] from unnest(ids) i loop
    select count(*) into diff from (
      (select * from plm.prod_order_sales_order_link(one)
       except all
       select * from plm.v_prod_order_sales_order_link where prod_order_header_id = any(one))
      union all
      (select * from plm.v_prod_order_sales_order_link where prod_order_header_id = any(one)
       except all
       select * from plm.prod_order_sales_order_link(one))) d;
    if diff <> 0 then raise exception 'by-ids differs from the view for order % (% rows)', one[1], diff; end if;
  end loop;

  if exists (select 1 from plm.prod_order_sales_order_link(array[]::integer[]))
     or exists (select 1 from plm.prod_order_sales_order_link(null)) then
    raise exception 'empty or null ids must return no rows';
  end if;
end $$;
