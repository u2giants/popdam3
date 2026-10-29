-- DesignFlow per-retailer selling signal contracts (#4991, successor of #4964).
-- Disposable database transaction only; harness owns BEGIN/ROLLBACK.
-- Break-the-suite check: renaming a column, dropping the unique key or the
-- signal check, or changing the runtime grants must fail a phase here.

do $phase1$
begin
  if to_regclass('plm.item_retailer_selling') is not null then
    raise exception 'phase 1: plm.item_retailer_selling must be dropped';
  end if;
  if (select string_agg(attname || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull, ',' order by attnum)
      from pg_attribute where attrelid = 'dflow_prod.item_customer_selling'::regclass and attnum > 0 and not attisdropped)
     is distinct from 'id:bigint:true,item_id:integer:true,customer_id:integer:true,selling_signal:text:true,updated_by_user_id:integer:false,created_at:timestamp with time zone:true,updated_at:timestamp with time zone:true' then
    raise exception 'phase 1: column signature differs';
  end if;
end $phase1$;

do $phase2$
begin
  insert into dflow_prod.item_customer_selling (item_id, customer_id, selling_signal) values (-1, -1, 'green');
  update dflow_prod.item_customer_selling set selling_signal = 'red' where item_id = -1 and customer_id = -1;
  begin
    insert into dflow_prod.item_customer_selling (item_id, customer_id, selling_signal) values (-1, -1, 'yellow');
    raise exception 'phase 2: duplicate (item_id, customer_id) accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into dflow_prod.item_customer_selling (item_id, customer_id, selling_signal) values (-2, -1, 'blue');
    raise exception 'phase 2: selling_signal blue accepted';
  exception when check_violation then null;
  end;
end $phase2$;

do $phase3$
begin
  if exists (select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
             where has_table_privilege('designflow_prod_backend_runtime', 'dflow_prod.item_customer_selling', p) is distinct from (p <> 'TRUNCATE')
                or has_table_privilege('designflow_prod_item_master_runtime', 'dflow_prod.item_customer_selling', p) is distinct from (p <> 'TRUNCATE')) then
    raise exception 'phase 3: DesignFlow runtime grants differ';
  end if;
  if has_table_privilege('anon', 'dflow_prod.item_customer_selling', 'SELECT')
     or has_table_privilege('authenticated', 'dflow_prod.item_customer_selling', 'SELECT') then
    raise exception 'phase 3: API roles must have no access';
  end if;
end $phase3$;
