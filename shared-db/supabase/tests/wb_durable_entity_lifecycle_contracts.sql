-- #1881: synthetic, rollback-only Warner lifecycle contracts.

begin;

-- Exercise the real table, trigger, foreign key, RLS/grants, and the installed
-- capture target body.  Fixed synthetic identities are rolled back below.
do $catalog$
declare
  v_table text;
begin
  foreach v_table in array array['wb_asset_normalized','wb_character_normalized','wb_property','wb_style_guide_normalized','wb_franchise'] loop
    if not (select relrowsecurity from pg_class where oid=format('plm.%I',v_table)::regclass) then
      raise exception 'RLS is disabled for plm.%',v_table;
    end if;
    if not has_table_privilege('authenticated',format('plm.%I',v_table),'select')
       or has_table_privilege('anon',format('plm.%I',v_table),'select') then
      raise exception 'Warner lifecycle table grants are incorrect for plm.%',v_table;
    end if;
    if not exists(select 1 from pg_constraint where conrelid=format('plm.%I',v_table)::regclass and contype='f' and confrelid='plm.wb_capture'::regclass) then
      raise exception 'Warner lifecycle table lost its capture foreign key: plm.%',v_table;
    end if;
    if not exists(select 1 from pg_trigger where tgrelid=format('plm.%I',v_table)::regclass and tgname='trg_'||v_table||'_lifecycle' and not tgisinternal) then
      raise exception 'Warner lifecycle trigger is missing for plm.%',v_table;
    end if;
  end loop;
end
$catalog$;

insert into plm.wb_capture(capture_id,chunk_number,target,status,captured_at,private_source_commit,snapshot_sha256,expected_row_count,captured_by,source_url,started_at)
values
 ('18810000-0000-4000-8000-000000000101',0,'wb_franchise','validating','2026-08-28','synthetic',repeat('1',64),2,'contract','https://example.invalid',now());

set local role service_role;
select * from plm.sync_wb_normalized_target(
 '18810000-0000-4000-8000-000000000101','wb_franchise',
 '{"captured_at":"2026-08-28","rows":[{"source_namespace":"synthetic","source_id":"franchise-a","label":"A","identity_method":"source_id","source_url":"https://example.invalid"},{"source_namespace":"synthetic","source_id":"franchise-b","label":"B","identity_method":"source_id","source_url":"https://example.invalid"}]}'::jsonb,
 'mirror_only',1);
reset role;
update plm.wb_capture set status='complete',completed_at=now(),loader_report='{}'::jsonb
where capture_id='18810000-0000-4000-8000-000000000101' and chunk_number=0;
insert into plm.wb_capture(capture_id,chunk_number,target,status,captured_at,private_source_commit,snapshot_sha256,expected_row_count,captured_by,source_url,started_at)
values ('18810000-0000-4000-8000-000000000102',0,'wb_franchise','validating','2026-08-29','synthetic',repeat('2',64),1,'contract','https://example.invalid',now());
set local role service_role;
select * from plm.sync_wb_normalized_target(
 '18810000-0000-4000-8000-000000000102','wb_franchise',
 '{"captured_at":"2026-08-29","rows":[{"source_namespace":"synthetic","source_id":"franchise-a","label":"A","identity_method":"source_id","source_url":"https://example.invalid"}]}'::jsonb,
 'mirror_only',1);
reset role;
update plm.wb_capture set status='complete',completed_at=now(),loader_report='{}'::jsonb
where capture_id='18810000-0000-4000-8000-000000000102' and chunk_number=0;

do $withdrawn$
declare v_first_seen timestamptz; v_first_withdrawn timestamptz;
begin
 select first_seen_at,first_withdrawn_at into v_first_seen,v_first_withdrawn from plm.wb_franchise where source_namespace='synthetic' and source_id='franchise-b';
 if v_first_withdrawn is null or not exists(select 1 from plm.wb_franchise where source_namespace='synthetic' and source_id='franchise-b' and status='withdrawn' and withdrawn_at is not null) then
   raise exception 'real-table capture did not withdraw a missing identity';
 end if;
 perform set_config('test.wb_first_seen',v_first_seen::text,true);
 perform set_config('test.wb_first_withdrawn',v_first_withdrawn::text,true);
end
$withdrawn$;

insert into plm.wb_capture(capture_id,chunk_number,target,status,captured_at,private_source_commit,snapshot_sha256,expected_row_count,captured_by,source_url,started_at)
values ('18810000-0000-4000-8000-000000000103',0,'wb_franchise','validating','2026-08-30','synthetic',repeat('3',64),2,'contract','https://example.invalid',now());

set local role service_role;
select * from plm.sync_wb_normalized_target(
 '18810000-0000-4000-8000-000000000103','wb_franchise',
 '{"captured_at":"2026-08-30","rows":[{"source_namespace":"synthetic","source_id":"franchise-a","label":"A","identity_method":"source_id","source_url":"https://example.invalid"},{"source_namespace":"synthetic","source_id":"franchise-b","label":"B","identity_method":"source_id","source_url":"https://example.invalid"}]}'::jsonb,
 'mirror_only',1);
reset role;
update plm.wb_capture set status='complete',completed_at=now(),loader_report='{}'::jsonb
where capture_id='18810000-0000-4000-8000-000000000103' and chunk_number=0;

do $unchanged_reactivation$
begin
 if not exists(select 1 from plm.wb_franchise where source_namespace='synthetic' and source_id='franchise-b' and status='active' and withdrawn_at is null and first_seen_at=current_setting('test.wb_first_seen')::timestamptz and first_withdrawn_at=current_setting('test.wb_first_withdrawn')::timestamptz) then
   raise exception 'unchanged-hash reappearance did not preserve durable lifecycle history';
 end if;
end
$unchanged_reactivation$;

insert into plm.wb_capture(capture_id,chunk_number,target,status,captured_at,private_source_commit,snapshot_sha256,expected_row_count,captured_by,source_url,started_at)
values ('18810000-0000-4000-8000-000000000104',0,'wb_franchise','validating','2026-08-30','synthetic',repeat('4',64),1,'contract','https://example.invalid',now());

set local role service_role;
select * from plm.sync_wb_normalized_target(
 '18810000-0000-4000-8000-000000000104','wb_franchise',
 '{"captured_at":"2026-08-30","rows":[{"source_namespace":"synthetic","source_id":"franchise-a","label":"A","identity_method":"source_id","source_url":"https://example.invalid"}]}'::jsonb,
 'mirror_only',1);

do $reactivated$
begin
 if not exists(select 1 from plm.wb_franchise where source_namespace='synthetic' and source_id='franchise-b' and status='withdrawn' and withdrawn_at is not null and first_seen_at=current_setting('test.wb_first_seen')::timestamptz and first_withdrawn_at=current_setting('test.wb_first_withdrawn')::timestamptz) then
   raise exception 'repeated withdrawal did not preserve durable lifecycle history';
 end if;
end
$reactivated$;
reset role;

do $immutable$
begin
 begin
   update plm.wb_franchise set first_withdrawn_at='2026-12-31 00:00:00+00' where source_namespace='synthetic' and source_id='franchise-b';
   raise exception 'immutable first_withdrawn_at update was accepted';
 exception when raise_exception then
   if sqlerrm='immutable first_withdrawn_at update was accepted' then raise; end if;
 end;
end
$immutable$;

do $write_grants$
declare v_table text;
begin
 foreach v_table in array array['wb_asset_normalized','wb_character_normalized','wb_property','wb_style_guide_normalized','wb_franchise'] loop
  if has_table_privilege('service_role',format('plm.%I',v_table),'insert')
     or has_table_privilege('service_role',format('plm.%I',v_table),'update')
     or has_table_privilege('service_role',format('plm.%I',v_table),'delete') then
    raise exception 'service_role unexpectedly has direct lifecycle-table DML on plm.%',v_table;
  end if;
 end loop;
end
$write_grants$;

create temp table test_wb_asset_lifecycle
  (like plm.wb_asset_normalized including defaults including generated including constraints);
create temp table test_wb_character_lifecycle
  (like plm.wb_character_normalized including defaults including generated including constraints);
create temp table test_wb_property_lifecycle
  (like plm.wb_property including defaults including generated including constraints);
create temp table test_wb_style_guide_lifecycle
  (like plm.wb_style_guide_normalized including defaults including generated including constraints);

do $contract$
declare
  v_id uuid := '18810000-0000-4000-8000-000000000001';
  v_first_seen timestamptz := '2026-01-01 00:00:00+00';
  v_invalid_rejected boolean := false;
  v_mismatch_rejected boolean := false;
  v_signal text;
begin
  insert into test_wb_asset_lifecycle (
    id, source_namespace, source_id, file_name, source_path, capture_id,
    source_url, raw, source_hash, first_seen_at
  ) values (
    v_id, 'synthetic', 'asset-1', 'fixture.bin', '/fixture.bin',
    '18810000-0000-4000-8000-000000000099', 'https://example.invalid',
    '{}'::jsonb, repeat('a', 64), v_first_seen
  );

  select change_signal into v_signal from test_wb_asset_lifecycle where id = v_id;
  if v_signal <> repeat('a', 64) then
    raise exception 'change_signal did not reproduce the retained source hash';
  end if;

  update test_wb_asset_lifecycle
  set status = 'withdrawn', withdrawn_at = '2026-02-01 00:00:00+00'
  where id = v_id;
  update test_wb_asset_lifecycle
  set status = 'active', withdrawn_at = null, source_hash = repeat('b', 64)
  where id = v_id;

  if not exists (
    select 1 from test_wb_asset_lifecycle
    where id = v_id
      and status = 'active'
      and withdrawn_at is null
      and first_seen_at = v_first_seen
      and change_signal = repeat('b', 64)
  ) then
    raise exception 'reappearance did not preserve first-seen history and refresh the signal';
  end if;

  begin
    update test_wb_asset_lifecycle set status = 'missing' where id = v_id;
  exception when check_violation then
    v_invalid_rejected := true;
  end;
  if not v_invalid_rejected then
    raise exception 'invalid lifecycle status was accepted';
  end if;

  begin
    update test_wb_asset_lifecycle
    set status = 'withdrawn', withdrawn_at = null
    where id = v_id;
  exception when check_violation then
    v_mismatch_rejected := true;
  end;
  if not v_mismatch_rejected then
    raise exception 'withdrawn status without withdrawn_at was accepted';
  end if;

  insert into test_wb_character_lifecycle (
    source_namespace, source_id, label, identity_method, capture_id,
    source_url, raw, source_hash
  ) values (
    'synthetic', 'character-1', 'Synthetic Character', 'source_id',
    '18810000-0000-4000-8000-000000000099', 'https://example.invalid',
    '{}'::jsonb, repeat('c', 64)
  );
  insert into test_wb_property_lifecycle (
    source_namespace, source_id, label, identity_method, capture_id,
    source_url, raw, source_hash
  ) values (
    'warner_product_catalogue', 'property-1', 'Synthetic Property', 'source_id',
    '18810000-0000-4000-8000-000000000099', 'https://example.invalid',
    '{}'::jsonb, repeat('d', 64)
  );
  insert into test_wb_style_guide_lifecycle (
    source_namespace, source_id, label, identity_method, capture_id,
    source_url, raw, source_hash
  ) values (
    'synthetic', 'guide-1', 'Synthetic Guide', 'source_id',
    '18810000-0000-4000-8000-000000000099', 'https://example.invalid',
    '{}'::jsonb, repeat('e', 64)
  );

  if exists (
    select 1 from test_wb_character_lifecycle where status <> 'active' or change_signal <> source_hash
    union all
    select 1 from test_wb_property_lifecycle where status <> 'active' or change_signal <> source_hash
    union all
    select 1 from test_wb_style_guide_lifecycle where status <> 'active' or change_signal <> source_hash
  ) then
    raise exception 'default active lifecycle or generated signal failed on an entity table';
  end if;
end
$contract$;

rollback;
