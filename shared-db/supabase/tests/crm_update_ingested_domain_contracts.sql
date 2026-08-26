-- Contract tests for issue #1516 / migration 20260825215931.
-- Fixture changes are transaction-bound and rolled back.

begin;

do $$
declare
  v_allowed_profile uuid;
  v_allowed_auth uuid;
  v_denied_profile uuid;
  v_denied_auth uuid;
  v_admin_role uuid;
  v_domain_id uuid;
  v_before_count bigint;
  v_after_count bigint;
  v_row crm.ingested_domain;
  v_definer boolean;
  v_config text[];
begin
  if to_regprocedure('api.crm_update_ingested_domain(uuid,text)') is null then
    raise exception 'missing api.crm_update_ingested_domain(uuid,text)';
  end if;

  if has_function_privilege('public', 'api.crm_update_ingested_domain(uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'api.crm_update_ingested_domain(uuid,text)', 'execute') then
    raise exception 'RPC execute grants are not public=denied/authenticated=allowed';
  end if;

  if has_table_privilege('authenticated', 'crm.ingested_domain', 'insert')
     or has_table_privilege('authenticated', 'crm.ingested_domain', 'update')
     or has_table_privilege('authenticated', 'crm.ingested_domain', 'delete') then
    raise exception 'authenticated must retain zero direct ingested_domain write grants';
  end if;

  select p.prosecdef, p.proconfig into v_definer, v_config
  from pg_proc p
  where p.oid = 'api.crm_update_ingested_domain(uuid,text)'::regprocedure;
  if not v_definer or not ('search_path=app, crm, public' = any(coalesce(v_config, array[]::text[]))) then
    raise exception 'RPC must be SECURITY DEFINER with pinned search_path=app, crm, public';
  end if;

  select p.id, p.auth_user_id into v_allowed_profile, v_allowed_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 0;
  select p.id, p.auth_user_id into v_denied_profile, v_denied_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 1;
  if v_denied_profile is null then
    raise exception 'fixture requires two active authenticated profiles';
  end if;

  select id into v_admin_role from app.role where slug = 'administrator';
  delete from app.user_role
  where profile_id in (v_allowed_profile, v_denied_profile)
    and role_id = v_admin_role;
  delete from app.app_access
  where profile_id in (v_allowed_profile, v_denied_profile) and app = 'crm';
  insert into app.app_access (profile_id, app) values (v_allowed_profile, 'crm');

  insert into crm.ingested_domain (domain, status)
  values (('issue-1516-' || gen_random_uuid() || '.invalid')::extensions.citext, 'new')
  returning id into v_domain_id;
  create function pg_temp.customer_count() returns bigint
  language sql security definer set search_path = core, public
  as 'select count(*) from core.customer';
  select pg_temp.customer_count() into v_before_count;

  perform set_config('request.jwt.claim.sub', v_denied_auth::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform api.crm_update_ingested_domain(v_domain_id, 'OTHER');
    raise exception 'caller without CRM access unexpectedly updated the domain';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', v_allowed_auth::text, true);
  if (select status from crm.ingested_domain where id = v_domain_id) <> 'new' then
    raise exception 'denied call mutated the domain';
  end if;

  select * into v_row
  from api.crm_update_ingested_domain(v_domain_id, 'ACTIVE_CUSTOMER');
  if v_row.id <> v_domain_id or v_row.status <> 'ACTIVE_CUSTOMER'
     or (select status from crm.ingested_domain where id = v_domain_id) <> 'ACTIVE_CUSTOMER' then
    raise exception 'CRM-authorized classification did not persist and return the row';
  end if;

  select * into v_row
  from api.crm_update_ingested_domain(v_domain_id, null);
  if v_row.status <> 'ACTIVE_CUSTOMER' then
    raise exception 'null status did not preserve the current classification';
  end if;

  begin
    perform api.crm_update_ingested_domain(v_domain_id, 'promoted');
    raise exception 'retired promoted status was accepted';
  exception when check_violation then null;
  end;

  select pg_temp.customer_count() into v_after_count;
  if v_after_count <> v_before_count then
    raise exception 'domain triage changed core.customer';
  end if;
end;
$$;

rollback;
