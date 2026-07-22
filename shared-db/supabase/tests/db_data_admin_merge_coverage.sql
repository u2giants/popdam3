-- Preview/disposable verification for canonical Customer/Vendor merge coverage.
-- All fixture changes roll back.
begin;

do $$
declare
  v_missing text;
  v_stale text;
  v_unmentioned text;
  v_customer_merge text := pg_get_functiondef('core.merge_customer(uuid,uuid,boolean)'::regprocedure);
  v_factory_merge text := pg_get_functiondef('core.merge_factory(uuid,uuid,boolean)'::regprocedure);
begin
  if has_function_privilege('authenticated', 'core.merge_customer(uuid,uuid,boolean)', 'execute')
     or has_function_privilege('authenticated', 'core.merge_factory(uuid,uuid,boolean)', 'execute') then
    raise exception 'authenticated can execute a canonical merge engine directly';
  end if;
  if not has_function_privilege('service_role', 'core.merge_customer(uuid,uuid,boolean)', 'execute')
     or not has_function_privilege('service_role', 'core.merge_factory(uuid,uuid,boolean)', 'execute') then
    raise exception 'service_role lost canonical merge-engine execution';
  end if;
  if has_function_privilege(
    'authenticated',
    'core.reconcile_merge_extension_row(regclass,text,uuid,uuid)',
    'execute'
  ) then
    raise exception 'authenticated can execute the private extension reconciliation helper';
  end if;

  with expected(target, dependent) as (
    values
      ('core.customer', 'core.company_source_ref(company_id)'),
      ('core.customer', 'core.contact_company(company_id)'),
      ('core.customer', 'core.customer_alias(customer_id)'),
      ('core.customer', 'core.customer_channel(customer_id)'),
      ('core.customer', 'core.factory(company_id)'),
      ('core.customer', 'crm.customer_ext(customer_id)'),
      ('core.customer', 'crm.department(company_id)'),
      ('core.customer', 'crm.email_message(company_id)'),
      ('core.customer', 'crm.licensor_approval_thread(company_id)'),
      ('core.customer', 'crm.meeting_note(company_id)'),
      ('core.customer', 'crm.note(company_id)'),
      ('core.customer', 'crm.opportunity(company_id)'),
      ('core.customer', 'crm.task(company_id)'),
      ('core.customer', 'dam.asset(company_id)'),
      ('core.customer', 'dam.customer_ext(customer_id)'),
      ('core.customer', 'dam.style_group(company_id)'),
      ('core.customer', 'dam.style_guide_file(company_id)'),
      ('core.customer', 'pim.customer_ext(customer_id)'),
      ('core.customer', 'pim.customer_order(company_id)'),
      ('core.customer', 'pim.design_collection(company_id)'),
      ('core.customer', 'pim.product(company_id)'),
      ('core.customer', 'pim.project(company_id)'),
      ('core.customer', 'plm.customer_import(company_id)'),
      ('core.customer', 'plm.erp_customer(customer_id)'),
      ('core.customer', 'plm.item(company_id)'),
      ('core.customer', 'plm.production_order(company_id)'),
      ('core.customer', 'plm.rfq_group(company_id)'),
      ('core.customer', 'plm.style_tracker_item_bridge(company_id)'),
      ('core.customer', 'public.style_tracker_rows(customer_id)'),
      ('core.factory', 'core.factory_alias(factory_id)'),
      ('core.factory', 'core.factory_source_ref(factory_id)'),
      ('core.factory', 'core.vendor_contact(factory_id)'),
      ('core.factory', 'crm.factory_ext(factory_id)'),
      ('core.factory', 'crm.opportunity(factory_id)'),
      ('core.factory', 'dam.factory_ext(factory_id)'),
      ('core.factory', 'pim.factory_ext(factory_id)'),
      ('core.factory', 'pim.product(factory_id)'),
      ('core.factory', 'pim.product_sample(factory_id)'),
      ('core.factory', 'plm.erp_vendor(factory_id)'),
      ('core.factory', 'plm.production_order(factory_id)'),
      ('core.factory', 'plm.rfq_vendor(factory_id)'),
      ('core.factory', 'plm.style_tracker_item_bridge(factory_id)')
  ), actual as (
    select
      rn.nspname || '.' || rc.relname as target,
      tn.nspname || '.' || tc.relname || '(' ||
        string_agg(a.attname, ',' order by key_column.ord) || ')' as dependent
    from pg_constraint con
    join pg_class tc on tc.oid = con.conrelid
    join pg_namespace tn on tn.oid = tc.relnamespace
    join pg_class rc on rc.oid = con.confrelid
    join pg_namespace rn on rn.oid = rc.relnamespace
    cross join lateral unnest(con.conkey) with ordinality key_column(attnum, ord)
    join pg_attribute a on a.attrelid = tc.oid and a.attnum = key_column.attnum
    where con.contype = 'f'
      and rn.nspname = 'core'
      and rc.relname in ('customer', 'factory')
    group by rn.nspname, rc.relname, tn.nspname, tc.relname, con.oid
  ), missing as (
    select * from actual except select * from expected
  ), stale as (
    select * from expected except select * from actual
  )
  select
    (select string_agg(target || ' <- ' || dependent, ', ' order by target, dependent) from missing),
    (select string_agg(target || ' <- ' || dependent, ', ' order by target, dependent) from stale)
  into v_missing, v_stale;

  if v_missing is not null then
    raise exception 'unhandled Customer/Vendor FK(s): %', v_missing;
  end if;
  if v_stale is not null then
    raise exception 'stale Customer/Vendor FK coverage entry/entries: %', v_stale;
  end if;

  with expected(target, dependent) as (
    values
      ('core.customer', 'core.company_source_ref'), ('core.customer', 'core.contact_company'),
      ('core.customer', 'core.customer_alias'), ('core.customer', 'core.customer_channel'),
      ('core.customer', 'core.factory'), ('core.customer', 'crm.customer_ext'),
      ('core.customer', 'crm.department'), ('core.customer', 'crm.email_message'),
      ('core.customer', 'crm.licensor_approval_thread'), ('core.customer', 'crm.meeting_note'),
      ('core.customer', 'crm.note'), ('core.customer', 'crm.opportunity'),
      ('core.customer', 'crm.task'), ('core.customer', 'dam.asset'),
      ('core.customer', 'dam.customer_ext'), ('core.customer', 'dam.style_group'),
      ('core.customer', 'dam.style_guide_file'), ('core.customer', 'pim.customer_ext'),
      ('core.customer', 'pim.customer_order'), ('core.customer', 'pim.design_collection'),
      ('core.customer', 'pim.product'), ('core.customer', 'pim.project'),
      ('core.customer', 'plm.customer_import'), ('core.customer', 'plm.erp_customer'),
      ('core.customer', 'plm.item'), ('core.customer', 'plm.production_order'),
      ('core.customer', 'plm.rfq_group'), ('core.customer', 'plm.style_tracker_item_bridge'),
      ('core.customer', 'public.style_tracker_rows'),
      ('core.factory', 'core.factory_alias'), ('core.factory', 'core.factory_source_ref'),
      ('core.factory', 'core.vendor_contact'), ('core.factory', 'crm.factory_ext'),
      ('core.factory', 'crm.opportunity'), ('core.factory', 'dam.factory_ext'),
      ('core.factory', 'pim.factory_ext'), ('core.factory', 'pim.product'),
      ('core.factory', 'pim.product_sample'), ('core.factory', 'plm.erp_vendor'),
      ('core.factory', 'plm.production_order'), ('core.factory', 'plm.rfq_vendor'),
      ('core.factory', 'plm.style_tracker_item_bridge')
  ), unmentioned as (
    select target, dependent
    from expected
    where position(dependent in case target
      when 'core.customer' then v_customer_merge
      else v_factory_merge
    end) = 0
  )
  select string_agg(target || ' missing ' || dependent, ', ' order by target, dependent)
  into v_unmentioned from unmentioned;

  if v_unmentioned is not null then
    raise exception 'merge function does not mention covered relation(s): %', v_unmentioned;
  end if;
end $$;

do $$
declare
  v_actor uuid;
  v_customer_loser uuid;
  v_customer_survivor uuid;
  v_customer_conflict_loser uuid;
  v_customer_conflict_survivor uuid;
  v_factory_loser uuid;
  v_factory_survivor uuid;
  v_factory_conflict_loser uuid;
  v_factory_conflict_survivor uuid;
  v_channel_shared uuid;
  v_channel_loser_only uuid;
  v_style_row uuid;
  v_customer_source text := 'merge-fixture-customer-' || gen_random_uuid()::text;
  v_factory_source text := 'merge-fixture-factory-' || gen_random_uuid()::text;
begin
  select id into v_actor from app.profile where status = 'active' order by created_at limit 1;
  if v_actor is null then
    raise exception 'merge fixture requires an active profile';
  end if;

  insert into core.customer (name, display_name)
  values ('Fixture Customer Survivor ' || gen_random_uuid(), 'Fixture Customer Survivor')
  returning id into v_customer_survivor;
  insert into core.customer (name, display_name)
  values ('Fixture Customer Loser ' || gen_random_uuid(), 'Fixture Customer Loser')
  returning id into v_customer_loser;

  insert into crm.customer_ext (
    customer_id, status, status_reason, status_changed_at, status_changed_by
  ) values (v_customer_loser, 'inactive', 'Fixture inactive', now(), v_actor);
  insert into pim.customer_ext (customer_id) values (v_customer_loser), (v_customer_survivor);
  insert into dam.customer_ext (customer_id, metadata)
  values (v_customer_loser, '{"fixture":true}'::jsonb);

  insert into core.channel (code, name)
  values ('FIX-' || substr(gen_random_uuid()::text, 1, 8), 'Fixture Shared ' || gen_random_uuid())
  returning id into v_channel_shared;
  insert into core.channel (code, name)
  values ('FIX-' || substr(gen_random_uuid()::text, 1, 8), 'Fixture Loser ' || gen_random_uuid())
  returning id into v_channel_loser_only;
  insert into core.customer_channel (customer_id, channel_id, assigned_by)
  values
    (v_customer_survivor, v_channel_shared, v_actor),
    (v_customer_loser, v_channel_shared, v_actor),
    (v_customer_loser, v_channel_loser_only, v_actor);

  insert into core.company_source_ref (
    company_id, source_system, source_table, source_id, source_code
  ) values (v_customer_loser, 'merge_fixture', 'customers', v_customer_source, 'OLD-CUSTOMER');

  insert into public.style_tracker_rows (
    source_sheet, source_row_number, tracker_type, customer_id
  ) values ('Merge Fixture ' || gen_random_uuid(), 1, 'other', v_customer_loser)
  returning id into v_style_row;

  perform core.merge_customer(
    p_loser => v_customer_loser,
    p_survivor => v_customer_survivor,
    p_alias_loser_name => true
  );

  if exists (select 1 from core.customer where id = v_customer_loser) then
    raise exception 'Customer loser still exists';
  end if;
  if (select customer_id from public.style_tracker_rows where id = v_style_row)
     is distinct from v_customer_survivor then
    raise exception 'style_tracker_rows.customer_id was not preserved';
  end if;
  if (select company_id from core.company_source_ref where source_id = v_customer_source)
     is distinct from v_customer_survivor then
    raise exception 'Customer source reference was not preserved';
  end if;
  if not exists (
    select 1 from core.customer_alias
    where customer_id = v_customer_survivor and source_system = 'merge'
  ) then
    raise exception 'Customer loser name did not remain resolvable as an alias';
  end if;
  if (select count(*) from core.customer_channel where customer_id = v_customer_survivor) <> 2 then
    raise exception 'Customer Channel assignments were not unioned';
  end if;
  if not exists (
    select 1 from crm.customer_ext
    where customer_id = v_customer_survivor and status = 'inactive'
  ) or (select count(*) from pim.customer_ext where customer_id = v_customer_survivor) <> 1
     or not exists (select 1 from dam.customer_ext where customer_id = v_customer_survivor) then
    raise exception 'Customer extension rows were not reconciled';
  end if;

  insert into core.customer (name) values ('Fixture Conflict Survivor ' || gen_random_uuid())
  returning id into v_customer_conflict_survivor;
  insert into core.customer (name) values ('Fixture Conflict Loser ' || gen_random_uuid())
  returning id into v_customer_conflict_loser;
  insert into crm.customer_ext (customer_id) values (v_customer_conflict_survivor);
  insert into crm.customer_ext (
    customer_id, status, status_reason, status_changed_at, status_changed_by
  ) values (v_customer_conflict_loser, 'inactive', 'Must be resolved', now(), v_actor);

  begin
    perform core.merge_customer(
      p_loser => v_customer_conflict_loser,
      p_survivor => v_customer_conflict_survivor
    );
    raise exception 'conflicting Customer extensions merged without resolution';
  exception
    when integrity_constraint_violation then null;
  end;
  if not exists (select 1 from core.customer where id = v_customer_conflict_loser) then
    raise exception 'conflict failure did not preserve the Customer loser';
  end if;

  insert into core.factory (name, display_name, code)
  values (
    'Fixture Vendor Survivor ' || gen_random_uuid(),
    'Fixture Vendor Survivor',
    'FIX-' || substr(gen_random_uuid()::text, 1, 12)
  )
  returning id into v_factory_survivor;
  insert into core.factory (name, display_name, code)
  values (
    'Fixture Vendor Loser ' || gen_random_uuid(),
    'Fixture Vendor Loser',
    'FIX-' || substr(gen_random_uuid()::text, 1, 12)
  )
  returning id into v_factory_loser;
  insert into crm.factory_ext (factory_id) values (v_factory_loser);
  insert into pim.factory_ext (factory_id) values (v_factory_loser), (v_factory_survivor);
  insert into dam.factory_ext (factory_id) values (v_factory_loser);
  insert into core.factory_source_ref (
    factory_id, source_system, source_table, source_id, source_code
  ) values (v_factory_loser, 'merge_fixture', 'vendors', v_factory_source, 'OLD-VENDOR');

  perform core.merge_factory(
    p_loser => v_factory_loser,
    p_survivor => v_factory_survivor,
    p_alias_loser_name => true
  );

  if exists (select 1 from core.factory where id = v_factory_loser) then
    raise exception 'Vendor loser still exists';
  end if;
  if (select factory_id from core.factory_source_ref where source_id = v_factory_source)
     is distinct from v_factory_survivor then
    raise exception 'Vendor source reference was not preserved';
  end if;
  if not exists (
    select 1 from core.factory_alias
    where factory_id = v_factory_survivor and source_system = 'merge'
  ) then
    raise exception 'Vendor loser name did not remain resolvable as an alias';
  end if;
  if not exists (select 1 from crm.factory_ext where factory_id = v_factory_survivor)
     or (select count(*) from pim.factory_ext where factory_id = v_factory_survivor) <> 1
     or not exists (select 1 from dam.factory_ext where factory_id = v_factory_survivor) then
    raise exception 'Vendor extension rows were not reconciled';
  end if;

  insert into core.factory (name, code)
  values (
    'Fixture Vendor Conflict Survivor ' || gen_random_uuid(),
    'FIX-' || substr(gen_random_uuid()::text, 1, 12)
  ) returning id into v_factory_conflict_survivor;
  insert into core.factory (name, code)
  values (
    'Fixture Vendor Conflict Loser ' || gen_random_uuid(),
    'FIX-' || substr(gen_random_uuid()::text, 1, 12)
  ) returning id into v_factory_conflict_loser;
  insert into crm.factory_ext (factory_id) values (v_factory_conflict_survivor);
  insert into crm.factory_ext (
    factory_id, status, status_reason, status_changed_at, status_changed_by
  ) values (v_factory_conflict_loser, 'inactive', 'Must be resolved', now(), v_actor);

  begin
    perform core.merge_factory(
      p_loser => v_factory_conflict_loser,
      p_survivor => v_factory_conflict_survivor
    );
    raise exception 'conflicting Vendor extensions merged without resolution';
  exception
    when integrity_constraint_violation then null;
  end;
  if not exists (select 1 from core.factory where id = v_factory_conflict_loser) then
    raise exception 'conflict failure did not preserve the Vendor loser';
  end if;
end $$;

rollback;
