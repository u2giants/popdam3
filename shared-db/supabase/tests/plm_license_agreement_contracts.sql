-- #4705 contracts: plm.license_agreement. Synthetic rows only; CI wraps in begin/rollback.
do $$
declare
  v_licensor uuid;
begin
  if to_regclass('plm.license_agreement') is null then
    raise exception 'plm.license_agreement missing';
  end if;
  if (select data_type from information_schema.columns where table_schema='plm'
      and table_name='license_agreement' and column_name='royalty_rate') <> 'numeric'
     or (select data_type from information_schema.columns where table_schema='plm'
      and table_name='license_agreement' and column_name='fob_royalty_rate') <> 'numeric' then
    raise exception 'rate columns must be numeric';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'plm.license_agreement'::regclass) then
    raise exception 'RLS must be enabled';
  end if;
  if has_table_privilege('anon','plm.license_agreement','select')
     or has_table_privilege('authenticated','plm.license_agreement','select') then
    raise exception 'browser roles must not read plm.license_agreement';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='plm.license_agreement'::regclass
                 and contype='f' and confrelid='core.licensor'::regclass) then
    raise exception 'FK to core.licensor missing';
  end if;

  select id into v_licensor from core.licensor limit 1;
  if v_licensor is null then
    insert into core.licensor (code, name) values ('ZQ9', 'zztest licensor') returning id into v_licensor;
  end if;
  insert into plm.license_agreement (licensor_id, royalty_rate, fob_royalty_rate, source_id)
  values (v_licensor, 13, 15.5, 'zztest-1');
  begin
    insert into plm.license_agreement (licensor_id, source_id) values (v_licensor, 'zztest-1');
    raise exception 'duplicate source accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into plm.license_agreement (licensor_id, royalty_rate, source_id) values (v_licensor, -1, 'zztest-2');
    raise exception 'negative rate accepted';
  exception when check_violation then null;
  end;
  begin
    insert into plm.license_agreement (licensor_id, source_id) values (gen_random_uuid(), 'zztest-3');
    raise exception 'orphan licensor accepted';
  exception when foreign_key_violation then null;
  end;
end
$$;
