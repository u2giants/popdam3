-- Preview/disposable verification for DB Data Admin extension and Channel
-- storage. All fixture changes roll back.
begin;

do $$
declare
  v_customer_id uuid;
  v_factory_id uuid;
  v_actor_id uuid;
  v_channel_id uuid;
  v_table regclass;
begin
  foreach v_table in array array[
    'crm.customer_ext'::regclass,
    'crm.factory_ext'::regclass,
    'pim.customer_ext'::regclass,
    'pim.factory_ext'::regclass,
    'dam.factory_ext'::regclass
  ] loop
    if not (select relrowsecurity from pg_class where oid = v_table) then
      raise exception 'RLS is disabled on %', v_table;
    end if;
    if not has_table_privilege('authenticated', v_table, 'select') then
      raise exception 'authenticated cannot read % through its app policy', v_table;
    end if;
    if has_table_privilege('authenticated', v_table, 'insert')
       or has_table_privilege('authenticated', v_table, 'update')
       or has_table_privilege('authenticated', v_table, 'delete') then
      raise exception 'authenticated received direct DML on %', v_table;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'core.channel', 'select')
     or has_table_privilege('authenticated', 'core.customer_channel', 'select') then
    raise exception 'Channel storage was exposed before protected API contracts';
  end if;

  select id into v_customer_id from core.customer order by created_at limit 1;
  select id into v_factory_id from core.factory order by created_at limit 1;
  select id into v_actor_id from app.profile where status = 'active' order by created_at limit 1;

  if v_customer_id is null or v_factory_id is null or v_actor_id is null then
    raise exception 'fixture requires a Customer, Vendor, and active profile';
  end if;

  insert into crm.customer_ext (customer_id) values (v_customer_id)
    on conflict (customer_id) do update set status = excluded.status;
  insert into crm.factory_ext (factory_id) values (v_factory_id)
    on conflict (factory_id) do update set status = excluded.status;
  insert into pim.customer_ext (customer_id) values (v_customer_id)
    on conflict (customer_id) do update set status = excluded.status;
  insert into pim.factory_ext (factory_id) values (v_factory_id)
    on conflict (factory_id) do update set status = excluded.status;
  insert into dam.factory_ext (factory_id) values (v_factory_id)
    on conflict (factory_id) do update set status = excluded.status;

  begin
    update crm.customer_ext
    set status = 'inactive', status_reason = null,
        status_changed_at = now(), status_changed_by = v_actor_id
    where customer_id = v_customer_id;
    raise exception 'inactive status without a reason unexpectedly succeeded';
  exception
    when check_violation then null;
  end;

  update crm.customer_ext
  set status = 'inactive', status_reason = 'Fixture reason',
      status_changed_at = now(), status_changed_by = v_actor_id
  where customer_id = v_customer_id;

  insert into core.channel (code, name, description, sort_order)
  values (
    'FIXTURE-' || substr(gen_random_uuid()::text, 1, 8),
    'Fixture Channel ' || gen_random_uuid()::text,
    'Rollback-only DB Data Admin fixture',
    9999
  ) returning id into v_channel_id;

  insert into core.customer_channel (customer_id, channel_id, assigned_by)
  values (v_customer_id, v_channel_id, v_actor_id);

  begin
    insert into core.customer_channel (customer_id, channel_id, assigned_by)
    values (v_customer_id, v_channel_id, v_actor_id);
    raise exception 'duplicate Customer-to-Channel assignment unexpectedly succeeded';
  exception
    when unique_violation then null;
  end;
end $$;

rollback;

