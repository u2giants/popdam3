-- #6150 contracts: core.property_site_path + api.mg06_site_path. Synthetic rows; CI wraps in begin/rollback.
select public.ci_authorize_licensing_contract_test();
do $$
declare
  v_prop uuid;
  v_lic uuid;
  v_n int;
begin
  if not (select relrowsecurity from pg_class where oid = 'core.property_site_path'::regclass) then
    raise exception 'RLS must be enabled';
  end if;
  -- (c) anon cannot read
  if has_table_privilege('anon', 'core.property_site_path', 'select')
     or has_function_privilege('anon', 'api.mg06_site_path(uuid,text)', 'execute') then
    raise exception 'anon must not read property_site_path';
  end if;
  -- (d) authenticated cannot write
  if has_table_privilege('authenticated', 'core.property_site_path', 'insert')
     or has_table_privilege('authenticated', 'core.property_site_path', 'update')
     or has_table_privilege('authenticated', 'core.property_site_path', 'delete') then
    raise exception 'authenticated must not write property_site_path';
  end if;
  if not has_table_privilege('authenticated', 'core.property_site_path', 'select') then
    raise exception 'authenticated must read property_site_path';
  end if;

  select id into v_lic from core.licensor limit 1;
  if v_lic is null then
    insert into core.licensor (code, name) values ('ZQ8', 'zztest licensor') returning id into v_lic;
  end if;
  insert into core.property (licensor_id, code, name) values (v_lic, 'ZQPSP', 'zztest property')
    returning id into v_prop;

  -- (a) insert + read back; (f) only current rows returned
  insert into core.property_site_path
    (property_id, licensor_site, site_property_name, site_property_id, site_character_name, site_character_id, source_evidence)
  values (v_prop, 'disney_opa', 'Mickey Mouse Family', 'p1', 'Mickey Mouse', 'c1', 'zztest');
  insert into core.property_site_path
    (property_id, licensor_site, site_property_name, source_evidence, is_current)
  values (v_prop, 'disney_opa', 'Old Path', 'zztest', false);
  select count(*) into v_n from api.mg06_site_path(v_prop, 'disney_opa');
  if v_n <> 1 then raise exception 'expected 1 current row, got %', v_n; end if;
  if (select site_character_name from api.mg06_site_path(v_prop, 'disney_opa')) <> 'Mickey Mouse' then
    raise exception 'read-back mismatch';
  end if;

  -- (b) duplicate path rejected (also with null character)
  begin
    insert into core.property_site_path (property_id, licensor_site, site_property_name, site_character_name, source_evidence)
    values (v_prop, 'disney_opa', 'Mickey Mouse Family', 'Mickey Mouse', 'zztest');
    raise exception 'duplicate path accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into core.property_site_path (property_id, licensor_site, site_property_name, source_evidence)
    values (v_prop, 'disney_opa', 'Old Path', 'zztest');
    raise exception 'duplicate null-character path accepted';
  exception when unique_violation then null;
  end;
  -- (e) unknown licensor_site rejected
  begin
    insert into core.property_site_path (property_id, licensor_site, site_property_name, source_evidence)
    values (v_prop, 'nowhere', 'X', 'zztest');
    raise exception 'unknown licensor_site accepted';
  exception when check_violation then null;
  end;
  -- (g) non-existent property rejected
  begin
    insert into core.property_site_path (property_id, licensor_site, site_property_name, source_evidence)
    values (gen_random_uuid(), 'disney_opa', 'X', 'zztest');
    raise exception 'orphan property accepted';
  exception when foreign_key_violation then null;
  end;
end
$$;
