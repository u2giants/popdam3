-- #6074 contracts: nullable nickname text on core.licensor and core.customer.
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'core' and table_name in ('licensor','customer')
         and column_name = 'nickname' and data_type = 'text' and is_nullable = 'YES') <> 2 then
    raise exception 'nickname text (nullable) missing on core.licensor or core.customer';
  end if;
end
$$;
