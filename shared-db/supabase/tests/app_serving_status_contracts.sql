-- Preview/disposable verification for the Step 6 per-app serving contracts
-- (migration 20260722005100). All fixture changes roll back.
--
-- Proves, as real authenticated app users (SET LOCAL role + JWT sub):
--   * every new view exists, is security_invoker, and is granted to
--     authenticated;
--   * the effective-visibility rule: global active/potential AND per-app
--     extension status active (missing ext row defaults to active);
--   * per-app-inactive rows are hidden from that app's picker only;
--   * globally inactive rows never appear.
--
-- Run only after 20260722005100 is applied to the target database.
begin;

do $$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_admin_role uuid;
  v_viewer_role uuid;
  v_crm_profile uuid;
  v_crm_auth uuid;
  v_pm_profile uuid;
  v_pm_auth uuid;
  v_dam_profile uuid;
  v_dam_auth uuid;
  v_hidden uuid;
  v_visible uuid;
  v_global_off uuid;
  v_factory_hidden uuid;
  v_factory_visible uuid;
  v_count integer;
  v_status text;
  v_view text;
begin
  -- ------------------------------------------------------------------
  -- Static assertions: existence, security_invoker, authenticated grant.
  -- ------------------------------------------------------------------
  foreach v_view in array array[
    'api.crm_customer_picker_list',
    'api.pm_customer_list',
    'api.crm_factory_picker_list',
    'api.pm_factory_list',
    'api.dam_factory_list'
  ] loop
    if to_regclass(v_view) is null then
      raise exception 'missing serving view: %', v_view;
    end if;
    if not coalesce((
      select c.reloptions @> array['security_invoker=true']::text[]
      from pg_class c
      where c.oid = v_view::regclass
    ), false) then
      raise exception '% must be a security_invoker view', v_view;
    end if;
    if not has_table_privilege('authenticated', v_view::regclass, 'select') then
      raise exception 'authenticated must have select on %', v_view;
    end if;
  end loop;

  -- ------------------------------------------------------------------
  -- Fixture app users (CRM, PM, DAM): reuse active preview identities and
  -- normalize their grants inside this rollback-only transaction. Creating
  -- auth.users would trip the invitation-only signup guard.
  -- ------------------------------------------------------------------
  select p.id, p.auth_user_id into v_crm_profile, v_crm_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 0;
  select p.id, p.auth_user_id into v_pm_profile, v_pm_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 1;
  select p.id, p.auth_user_id into v_dam_profile, v_dam_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 2;
  if v_dam_profile is null then
    raise exception 'fixture requires three active authenticated profiles';
  end if;

  select id into v_admin_role from app.role where slug = 'administrator';
  select id into v_viewer_role from app.role where slug = 'viewer';
  if v_viewer_role is null then
    raise exception 'fixture requires the viewer role';
  end if;
  delete from app.user_role
  where profile_id in (v_crm_profile, v_pm_profile, v_dam_profile)
    and role_id = v_admin_role;
  delete from app.app_access
  where profile_id in (v_crm_profile, v_pm_profile, v_dam_profile)
    and app in ('crm', 'pm', 'dam');

  insert into app.app_access (profile_id, app) values
    (v_crm_profile, 'crm'),
    (v_pm_profile, 'pm'),
    (v_dam_profile, 'dam');
  insert into app.user_role (profile_id, role_id) values
    (v_crm_profile, v_viewer_role),
    (v_pm_profile, v_viewer_role),
    (v_dam_profile, v_viewer_role)
  on conflict (profile_id, role_id) do update set revoked_at = null;

  -- ------------------------------------------------------------------
  -- Customer fixtures: hidden (app-inactive ext), visible, globally off.
  -- ------------------------------------------------------------------
  insert into core.customer (name, status)
  values ('Step6 Serve Hidden ' || v_suffix, 'active')
  returning id into v_hidden;
  insert into core.customer (name, status)
  values ('Step6 Serve Visible ' || v_suffix, 'active')
  returning id into v_visible;
  insert into core.customer (name, status)
  values ('Step6 Serve GlobalOff ' || v_suffix, 'inactive')
  returning id into v_global_off;

  insert into crm.customer_ext (customer_id, status, status_reason, status_changed_at, status_changed_by)
  values (v_hidden, 'inactive', 'Step6 serve fixture', now(), v_crm_profile);
  insert into pim.customer_ext (customer_id, status, status_reason, status_changed_at, status_changed_by)
  values (v_hidden, 'inactive', 'Step6 serve fixture', now(), v_pm_profile);

  -- CRM user: effective visibility enforced.
  perform set_config('request.jwt.claim.sub', v_crm_auth::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count
  from api.crm_customer_picker_list
  where id in (v_hidden, v_visible, v_global_off);
  if v_count <> 1 then
    raise exception 'CRM picker must return exactly the CRM-visible fixture customer';
  end if;
  if exists (select 1 from api.crm_customer_picker_list where id = v_hidden) then
    raise exception 'CRM-inactive customer must be hidden from the CRM picker';
  end if;
  if exists (select 1 from api.crm_customer_picker_list where id = v_global_off) then
    raise exception 'globally inactive customer must never appear in the CRM picker';
  end if;
  select crm_status into v_status from api.crm_customer_picker_list where id = v_visible;
  if v_status <> 'active' then
    raise exception 'visible customer must report crm_status active';
  end if;

  perform set_config('role', 'none', true);

  -- PM user: same enforcement through the PM contract.
  perform set_config('request.jwt.claim.sub', v_pm_auth::text, true);
  perform set_config('role', 'authenticated', true);

  if exists (select 1 from api.pm_customer_list where id = v_hidden) then
    raise exception 'PM-inactive customer must be hidden from the PM picker';
  end if;
  if not exists (select 1 from api.pm_customer_list where id = v_visible) then
    raise exception 'PM picker must include the visible customer';
  end if;
  if exists (select 1 from api.pm_customer_list where id = v_global_off) then
    raise exception 'globally inactive customer must never appear in the PM picker';
  end if;

  perform set_config('role', 'none', true);

  -- ------------------------------------------------------------------
  -- Vendor fixtures: hidden carries inactive ext rows for all three apps.
  -- ------------------------------------------------------------------
  insert into core.factory (name, code, status)
  values ('Step6 Serve Factory Hidden ' || v_suffix, 'S6H-' || v_suffix, 'active')
  returning id into v_factory_hidden;
  insert into core.factory (name, code, status)
  values ('Step6 Serve Factory Visible ' || v_suffix, 'S6V-' || v_suffix, 'active')
  returning id into v_factory_visible;

  insert into crm.factory_ext (factory_id, status, status_reason, status_changed_at, status_changed_by)
  values (v_factory_hidden, 'inactive', 'Step6 serve fixture', now(), v_crm_profile);
  insert into pim.factory_ext (factory_id, status, status_reason, status_changed_at, status_changed_by)
  values (v_factory_hidden, 'inactive', 'Step6 serve fixture', now(), v_pm_profile);
  insert into dam.factory_ext (factory_id, status, status_reason, status_changed_at, status_changed_by)
  values (v_factory_hidden, 'inactive', 'Step6 serve fixture', now(), v_dam_profile);

  -- CRM vendor picker.
  perform set_config('request.jwt.claim.sub', v_crm_auth::text, true);
  perform set_config('role', 'authenticated', true);

  if exists (select 1 from api.crm_factory_picker_list where id = v_factory_hidden) then
    raise exception 'CRM-inactive vendor must be hidden from the CRM picker';
  end if;
  if not exists (select 1 from api.crm_factory_picker_list where id = v_factory_visible) then
    raise exception 'CRM vendor picker must include the visible vendor';
  end if;

  perform set_config('role', 'none', true);

  -- PM vendor picker.
  perform set_config('request.jwt.claim.sub', v_pm_auth::text, true);
  perform set_config('role', 'authenticated', true);

  if exists (select 1 from api.pm_factory_list where id = v_factory_hidden) then
    raise exception 'PM-inactive vendor must be hidden from the PM picker';
  end if;
  if not exists (select 1 from api.pm_factory_list where id = v_factory_visible) then
    raise exception 'PM vendor picker must include the visible vendor';
  end if;

  perform set_config('role', 'none', true);

  -- DAM vendor picker (dam stays unexposed in PostgREST; the api view is the
  -- sanctioned serving path).
  perform set_config('request.jwt.claim.sub', v_dam_auth::text, true);
  perform set_config('role', 'authenticated', true);

  if exists (select 1 from api.dam_factory_list where id = v_factory_hidden) then
    raise exception 'DAM-inactive vendor must be hidden from the DAM picker';
  end if;
  if not exists (select 1 from api.dam_factory_list where id = v_factory_visible) then
    raise exception 'DAM vendor picker must include the visible vendor';
  end if;
  select dam_status into v_status from api.dam_factory_list where id = v_factory_visible;
  if v_status <> 'active' then
    raise exception 'visible vendor must report dam_status active';
  end if;

  perform set_config('role', 'none', true);
end $$;

rollback;
