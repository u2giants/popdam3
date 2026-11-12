-- #6178 contracts: nullable nickname text on core.property.
do $$
begin
  if not exists (select 1 from information_schema.columns
       where table_schema = 'core' and table_name = 'property'
         and column_name = 'nickname' and data_type = 'text' and is_nullable = 'YES') then
    raise exception 'nickname text (nullable) missing on core.property';
  end if;
end
$$;
