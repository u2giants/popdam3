-- Issue #3737: dflow_prod carries the canonical Tracking shipment-notice outbox
-- (20260909084253) and factory-time template surface (20260911214438), with no
-- reference to dflow or plm, no client access, and canonical behaviour.
-- Every write below is rolled back.
begin;

do $t$
declare
  v_user integer;
  v_ship bigint;
  v_notice bigint;
  v_ft integer;
  v_rows integer;
  v_def text;
  v_role text;
  r record;
begin
  if to_regclass('dflow_prod.sample_shipment_notice') is null
     or to_regclass('dflow_prod.sample_shipment_notice_recipient') is null
     or to_regclass('dflow_prod.product_type_factory_time') is null
     or to_regclass('dflow_prod.factory_time_name_ci_key') is null
     or to_regclass('dflow_prod.product_type_factory_time_factory_time_id_idx') is null
     or to_regprocedure('dflow_prod.claim_sample_shipment_notice(bigint)') is null
  then raise exception '#3737: expected dflow_prod object is missing'; end if;

  if (select count(*) from pg_trigger where not tgisinternal and tgname in
      ('sample_shipment_notice_snapshot_immutable','sample_shipment_notice_recipient_snapshot_immutable')
      and tgrelid in ('dflow_prod.sample_shipment_notice'::regclass,'dflow_prod.sample_shipment_notice_recipient'::regclass)) <> 2
  then raise exception '#3737: immutability triggers missing'; end if;

  if (select count(*) from information_schema.columns where table_schema='dflow_prod' and table_name='FactoryTime'
      and column_name in ('name','description','tags','updated_by')) <> 4
  then raise exception '#3737: FactoryTime template columns missing'; end if;
  if (select is_nullable from information_schema.columns where table_schema='dflow_prod' and table_name='FactoryTime' and column_name='name') <> 'NO'
     or (select is_nullable from information_schema.columns where table_schema='dflow_prod' and table_name='FactoryTime' and column_name='product_subtype') <> 'YES'
     or (select column_default from information_schema.columns where table_schema='dflow_prod' and table_name='FactoryTime' and column_name='resampling_days') is not null
  then raise exception '#3737: FactoryTime column nullability/default differs from canonical'; end if;

  if (select relrowsecurity from pg_class where oid='dflow_prod.product_type_factory_time'::regclass)
  then raise exception '#3737: dflow_prod uses grants, not RLS; an RLS table without policies would deny the Tracking runtime role'; end if;

  select pg_get_functiondef('dflow_prod.claim_sample_shipment_notice(bigint)'::regprocedure) into v_def;
  if v_def !~* 'security definer' or v_def !~ 'search_path TO ''dflow_prod'', ''pg_catalog''' then
    raise exception '#3737: claim_sample_shipment_notice must be SECURITY DEFINER with search_path dflow_prod, pg_catalog';
  end if;
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='dflow_prod' and p.proname in ('claim_sample_shipment_notice',
             'prevent_sample_shipment_notice_snapshot_mutation','prevent_sample_shipment_notice_recipient_snapshot_mutation')
  loop
    if pg_get_functiondef(r.oid) ~ '\m(dflow|plm)\.' then raise exception '#3737: function % references dflow or plm', r.oid::regprocedure; end if;
  end loop;
  if exists (select 1 from pg_constraint c where c.conrelid in ('dflow_prod.sample_shipment_notice'::regclass,
               'dflow_prod.sample_shipment_notice_recipient'::regclass,'dflow_prod.product_type_factory_time'::regclass)
             and c.contype='f' and c.confrelid::regclass::text !~ '^dflow_prod\.')
  then raise exception '#3737: a foreign key leaves dflow_prod'; end if;

  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role,'dflow_prod.sample_shipment_notice','SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege(v_role,'dflow_prod.sample_shipment_notice_recipient','SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege(v_role,'dflow_prod.product_type_factory_time','SELECT,INSERT,UPDATE,DELETE')
       or has_function_privilege(v_role,'dflow_prod.claim_sample_shipment_notice(bigint)','EXECUTE')
    then raise exception '#3737: client role % holds access', v_role; end if;
  end loop;

  -- Factory-time template behaviour.
  insert into dflow_prod."FactoryTime"(id, name, created_at, updated_at) values (900001, 'Template A', now(), now()) returning id into v_ft;
  begin
    insert into dflow_prod."FactoryTime"(id, name, created_at, updated_at) values (900002, '  template a ', now(), now());
    raise exception '#3737: case-insensitive duplicate template name was accepted';
  exception when unique_violation then null; end;
  begin
    insert into dflow_prod."FactoryTime"(id, name, created_at, updated_at) values (900003, '   ', now(), now());
    raise exception '#3737: blank template name was accepted';
  exception when check_violation then null; end;
  insert into dflow_prod.product_type_factory_time(mg_category, mg01_code, mg02_code, factory_time_id, assigned_by)
  values ('CAT','01','02', v_ft, 'tester');
  begin
    insert into dflow_prod.product_type_factory_time(mg_category, mg01_code, mg02_code, factory_time_id, assigned_by)
    values ('CAT','01','02', v_ft, 'tester');
    raise exception '#3737: duplicate product-type assignment was accepted';
  exception when unique_violation then null; end;
  begin
    delete from dflow_prod."FactoryTime" where id=v_ft;
    raise exception '#3737: deleting an in-use template was accepted';
  exception when foreign_key_violation then null; end;

  -- Notice behaviour on rolled-back fixture rows (users.id is the only
  -- required users column in the dflow_prod baseline; sample_shipment values
  -- satisfy the #2875 canonical checks).
  select coalesce(max(id), 0) + 900001 into v_user from dflow_prod.users;
  insert into dflow_prod.users(id) overriding system value values (v_user);
  insert into dflow_prod.sample_shipment(origin_location_type, origin_location_id, destination_location_type,
    destination_location_id, actor_user, actor_role, idempotency_key, request_hash)
  values ('office','HK','customer','C-3737','tester','admin','t3737-'||v_user,'h3737')
  returning sample_shipment_id into v_ship;

  insert into dflow_prod.sample_shipment_notice(sample_shipment_id_fk, subject, body_html, created_by_user_id, created_by_user)
  values (v_ship, 'Shipment', '<p>x</p>', v_user, 'tester') returning sample_shipment_notice_id into v_notice;
  insert into dflow_prod.sample_shipment_notice_recipient(sample_shipment_notice_id_fk, user_id_fk, recipient_function, recipient_name_snapshot, recipient_email_snapshot)
  values (v_notice, v_user, 'sales', 'T', 't@example.invalid');

  begin
    update dflow_prod.sample_shipment_notice set subject='changed' where sample_shipment_notice_id=v_notice;
    raise exception '#3737: notice snapshot mutation was not refused';
  exception when raise_exception then
    if sqlerrm not like 'Sample shipment notice snapshots are immutable%' then raise; end if;
  end;
  begin
    update dflow_prod.sample_shipment_notice_recipient set recipient_email_snapshot='y@example.invalid' where sample_shipment_notice_id_fk=v_notice;
    raise exception '#3737: recipient snapshot mutation was not refused';
  exception when raise_exception then
    if sqlerrm not like 'Sample shipment notice recipient snapshots are immutable%' then raise; end if;
  end;

  select count(*) into v_rows from dflow_prod.claim_sample_shipment_notice(v_notice) c
    where c.notice_id=v_notice and c.recipient_emails = array['t@example.invalid'];
  if v_rows <> 1 then raise exception '#3737: first claim should return the notice with its recipients'; end if;
  if (select state from dflow_prod.sample_shipment_notice where sample_shipment_notice_id=v_notice) <> 'sending'
  then raise exception '#3737: claim did not move the notice to sending'; end if;
  select count(*) into v_rows from dflow_prod.claim_sample_shipment_notice(v_notice);
  if v_rows <> 0 then raise exception '#3737: a fresh sending notice must not be re-claimed'; end if;
end $t$;

rollback;
