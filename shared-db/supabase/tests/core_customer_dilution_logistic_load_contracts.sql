-- Contract test for 20261112201512 / 20261113143309 (#6177, #6183): core.customer has
-- nullable numeric(9,4) dilution and logistic_load, documented for DesignFlow RFQ pricing.
begin;
do $$
declare v_n int;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema = 'core' and table_name = 'customer'
     and column_name in ('dilution', 'logistic_load')
     and data_type = 'numeric' and numeric_precision = 9 and numeric_scale = 4
     and is_nullable = 'YES';
  if v_n <> 2 then raise exception 'expected 2 numeric(9,4) nullable columns, found %', v_n; end if;
  if col_description('core.customer'::regclass,
       (select attnum from pg_attribute where attrelid = 'core.customer'::regclass and attname = 'dilution'))
     not ilike '%RFQ pricing%' then
    raise exception 'core.customer.dilution comment missing';
  end if;
end $$;
rollback;
