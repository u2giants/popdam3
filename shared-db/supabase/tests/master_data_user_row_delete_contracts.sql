-- shared-db#5128: Master Data user-created row delete contracts.
-- add_style_tracker_rows stamps row_data.origin='user_added';
-- delete_style_tracker_rows is admin-gated, refuses every non-user-created
-- row (sheet-style and auto-flow included), and writes a row_deleted audit
-- event before the delete (the audit FK survives as ON DELETE SET NULL).
-- LOCAL THROWAWAY DATABASE ONLY; never execute against production.
-- The surrounding database-contract harness owns BEGIN/ROLLBACK.

-- Grants: callable by authenticated (the admin gate is inside), never by anon.
do $test$
begin
  if not has_function_privilege('authenticated', 'public.delete_style_tracker_rows(uuid[])', 'execute') then
    raise exception 'delete_style_tracker_rows must be executable by authenticated (admin gate is internal)';
  end if;
  if has_function_privilege('anon', 'public.delete_style_tracker_rows(uuid[])', 'execute') then
    raise exception 'delete_style_tracker_rows must not be executable by anon';
  end if;
end $test$;

-- Admin fixture on CI synthetic bootstrap user 1; user 2 stays non-admin.
-- The profile is created if front-door provisioning has not made it yet (local
-- replay databases start with the bootstrap auth.users but no profiles).
insert into public.profiles(user_id, email)
select a.id, a.email from auth.users a
where a.id = '00000000-7541-4000-8000-000000000001'::uuid
  and not exists (select 1 from public.profiles p where p.user_id = a.id);
insert into public.user_roles(user_id, role)
select '00000000-7541-4000-8000-000000000001'::uuid, 'admin'::public.app_role
where not exists (
  select 1 from public.user_roles
  where user_id = '00000000-7541-4000-8000-000000000001'::uuid and role = 'admin'
);
delete from public.user_roles
where user_id = '00000000-7541-4000-8000-000000000002'::uuid and role = 'admin';

-- Admin path: stamp, delete, audit, refusal of everything else.
select set_config('request.jwt.claim.sub', '00000000-7541-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"00000000-7541-4000-8000-000000000001","role":"authenticated","app_metadata":{"roles":["administrator"]}}', true);
set local role authenticated;
do $test$
declare
  v_row record;
  v_sheet_id uuid;
  v_autoflow_id uuid;
  v_del record;
begin
  select * into v_row from public.add_style_tracker_rows('License.Style', 'licensed', 1);
  if v_row.id is null then
    raise exception 'add_style_tracker_rows returned no row';
  end if;
  if v_row.row_data ->> 'origin' <> 'user_added' then
    raise exception 'add_style_tracker_rows must stamp origin=user_added, got %', v_row.row_data;
  end if;

  -- A sheet-style row (cells, no origin) and an auto-flow row must be refused.
  insert into public.style_tracker_rows(source_sheet, source_row_number, tracker_type, row_data)
  values ('License.Style', 9999991, 'licensed', '{"B": "ZZ5128-SHEET"}'::jsonb)
  returning id into v_sheet_id;
  insert into public.style_tracker_rows(source_sheet, source_row_number, tracker_type, row_data)
  values ('License.Style', 9999992, 'licensed', '{"origin": "plm_item_autoflow"}'::jsonb)
  returning id into v_autoflow_id;

  select * into v_del from public.delete_style_tracker_rows(array[v_sheet_id, v_autoflow_id, v_row.id]);
  if v_del.deleted_count <> 1 or v_del.skipped_count <> 2 then
    raise exception 'expected 1 deleted / 2 skipped, got %/%', v_del.deleted_count, v_del.skipped_count;
  end if;
  if exists (select 1 from public.style_tracker_rows where id = v_row.id) then
    raise exception 'user-created row was not deleted';
  end if;
  if not exists (select 1 from public.style_tracker_rows where id = v_sheet_id)
     or not exists (select 1 from public.style_tracker_rows where id = v_autoflow_id) then
    raise exception 'sheet-style and auto-flow rows must survive';
  end if;
  if not exists (
    select 1 from public.style_tracker_audit_log a
    where a.event_type = 'row_deleted'
      and a.metadata ->> 'origin' = 'user_added'
      and a.metadata -> 'row_data' ->> 'origin' = 'user_added'
  ) then
    raise exception 'row_deleted audit event missing or without pre-delete row_data';
  end if;
end $test$;
reset role;

-- Non-admin refusal, even for a user-created row id.
select set_config('request.jwt.claim.sub', '00000000-7541-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"00000000-7541-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $test$
begin
  begin
    perform public.delete_style_tracker_rows(array['00000000-0000-4000-8000-000000000001'::uuid]);
    raise exception 'non-admin delete was allowed';
  exception when insufficient_privilege then null;
  end;
end $test$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
