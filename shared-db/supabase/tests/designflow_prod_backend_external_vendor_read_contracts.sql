-- #4707: Backend reads only email and vendorCode from externalVendor, never writes.
-- Asserted on the NOLOGIN grant role (CI replay cannot rebuild every runtime membership).
do $test$
declare
  g constant name := 'designflow_prod_backend_grants';
  t constant text := 'dflow_prod."externalVendor"';
  a record;
begin
  if not has_column_privilege(g, t, 'email', 'SELECT')
     or not has_column_privilege(g, t, 'vendorCode', 'SELECT') then
    raise exception 'Backend cannot read externalVendor email/vendorCode';
  end if;
  for a in select attname from pg_attribute where attrelid = t::regclass and attnum > 0 and not attisdropped
      and attname not in ('email', 'vendorCode') loop
    if has_column_privilege(g, t, a.attname, 'SELECT') then
      raise exception 'Backend reads extra externalVendor column %', a.attname;
    end if;
  end loop;
  if has_any_column_privilege(g, t, 'INSERT, UPDATE, REFERENCES')
     or has_table_privilege(g, t, 'DELETE, TRUNCATE, TRIGGER') then
    raise exception 'Backend gained a write on externalVendor';
  end if;
end
$test$;
