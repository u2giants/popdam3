-- Preview/disposable verification for DB Data Admin foundation. All fixture
-- changes roll back. Run only after 20260722002500 is applied.
begin;

do $$
declare
  v_profile_id uuid;
  v_auth_user_id uuid;
  v_event_id uuid;
  v_grid_key text := 'foundation-fixture-' || gen_random_uuid()::text;
begin
  if to_regprocedure('app.has_explicit_app_access(app.app_name)') is null then
    raise exception 'explicit app-access helper is missing';
  end if;

  if to_regclass('app.db_data_admin_audit_event') is null
     or to_regclass('app.db_data_admin_grid_state') is null then
    raise exception 'DB Data Admin foundation tables are missing';
  end if;

  if has_table_privilege('authenticated', 'app.db_data_admin_audit_event', 'select')
     or has_table_privilege('authenticated', 'app.db_data_admin_audit_event', 'insert')
     or has_table_privilege('authenticated', 'app.db_data_admin_grid_state', 'select')
     or has_table_privilege('authenticated', 'app.db_data_admin_grid_state', 'insert') then
    raise exception 'authenticated received a direct DB Data Admin table grant';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'app.db_data_admin_audit_event'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'app.db_data_admin_grid_state'::regclass) then
    raise exception 'RLS is not enabled on both DB Data Admin tables';
  end if;

  if exists (
    select 1 from pg_policy
    where polrelid in (
      'app.db_data_admin_audit_event'::regclass,
      'app.db_data_admin_grid_state'::regclass
    )
  ) then
    raise exception 'foundation storage must not expose direct RLS policies';
  end if;

  select p.id, p.auth_user_id
  into v_profile_id, v_auth_user_id
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at
  limit 1;

  if v_profile_id is null then
    raise exception 'fixture requires one active authenticated profile';
  end if;

  insert into app.app_access (profile_id, app, revoked_at)
  values (v_profile_id, 'admin', null)
  on conflict (profile_id, app) do update set revoked_at = null;

  perform set_config('request.jwt.claim.sub', v_auth_user_id::text, true);
  if not app.has_explicit_app_access('admin') then
    raise exception 'explicit non-revoked admin grant was not recognized';
  end if;

  update app.app_access
  set revoked_at = now()
  where profile_id = v_profile_id and app = 'admin';

  if app.has_explicit_app_access('admin') then
    raise exception 'revoked admin grant was accepted';
  end if;

  insert into app.db_data_admin_grid_state (
    profile_id, entity_type, view_key, state
  ) values (
    v_profile_id, 'customer', v_grid_key, '{"filters":[]}'::jsonb
  );

  insert into app.db_data_admin_audit_event (
    operation_id,
    entity_type,
    entity_id,
    action,
    old_snapshot,
    new_snapshot,
    reason,
    actor_profile_id,
    actor_user_id,
    succeeded
  ) values (
    gen_random_uuid(),
    'customer',
    gen_random_uuid(),
    'fixture_update',
    '{"display_name":"Before"}'::jsonb,
    '{"display_name":"After"}'::jsonb,
    'Verify immutable audit behavior',
    v_profile_id,
    v_auth_user_id,
    true
  ) returning id into v_event_id;

  begin
    update app.db_data_admin_audit_event
    set reason = 'This mutation must fail'
    where id = v_event_id;
    raise exception 'audit update unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    delete from app.db_data_admin_audit_event where id = v_event_id;
    raise exception 'audit delete unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end $$;

rollback;

