-- Contract tests for issues #1544 and #1615 / migrations 20260826001704 and
-- 20260827095753.
-- All fixture changes are transaction-bound and rolled back.

begin;

do $$
declare
  v_allowed_profile uuid;
  v_allowed_auth uuid;
  v_denied_profile uuid;
  v_denied_auth uuid;
  v_customer_id uuid;
  v_original_name text;
  v_original_display_name text;
  v_row core.customer;
  v_definer boolean;
  v_config text[];
  v_arg_names text[];
  v_defaults integer;
begin
  if to_regprocedure('api.crm_update_customer(uuid,text,text,text,text,text,text)') is not null then
    raise exception 'retired seven-argument crm_update_customer overload still exists';
  end if;
  if to_regprocedure('api.crm_update_customer(uuid,text,text,text,text,text,text,text)') is not null then
    raise exception 'retired eight-argument crm_update_customer overload still exists';
  end if;
  if to_regprocedure('api.crm_update_customer(uuid,text,text,text,text,text,text,text,boolean)') is null then
    raise exception 'missing nine-argument crm_update_customer replacement';
  end if;

  select p.prosecdef, p.proconfig, p.proargnames, p.pronargdefaults
    into v_definer, v_config, v_arg_names, v_defaults
  from pg_proc p
  where p.oid = 'api.crm_update_customer(uuid,text,text,text,text,text,text,text,boolean)'::regprocedure;

  if not v_definer
     or not ('search_path=app, core, crm, public' = any(coalesce(v_config, array[]::text[]))) then
    raise exception 'RPC must remain SECURITY DEFINER with its pinned search_path';
  end if;
  if v_arg_names <> array[
       'p_customer_id', 'p_name', 'p_domain', 'p_customer_status',
       'p_chain_type', 'p_routing_aliases', 'p_so_patterns', 'p_display_name',
       'p_clear_domain'
     ]::text[] or v_defaults <> 8 then
    raise exception 'RPC argument order/names/defaults changed: names %, defaults %',
      v_arg_names, v_defaults;
  end if;

  if has_function_privilege(
       'public', 'api.crm_update_customer(uuid,text,text,text,text,text,text,text,boolean)', 'execute')
     or not has_function_privilege(
       'authenticated', 'api.crm_update_customer(uuid,text,text,text,text,text,text,text,boolean)', 'execute') then
    raise exception 'RPC execute grants are not public=denied/authenticated=allowed';
  end if;
  if has_table_privilege('authenticated', 'core.customer', 'insert')
     or has_table_privilege('authenticated', 'core.customer', 'update')
     or has_table_privilege('authenticated', 'core.customer', 'delete') then
    raise exception 'authenticated gained a direct core.customer write grant';
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

  delete from app.app_access
  where profile_id in (v_allowed_profile, v_denied_profile) and app = 'crm';
  insert into app.app_access (profile_id, app) values (v_allowed_profile, 'crm');

  select c.id, c.name, c.display_name
    into v_customer_id, v_original_name, v_original_display_name
  from core.customer c
  order by c.created_at, c.id
  limit 1;
  if v_customer_id is null then
    raise exception 'fixture requires one customer';
  end if;

  perform set_config('request.jwt.claim.sub', v_denied_auth::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform api.crm_update_customer(
      p_customer_id => v_customer_id,
      p_display_name => 'Issue 1544 denied label');
    raise exception 'caller without CRM access unexpectedly updated display_name';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', v_allowed_auth::text, true);
  select * into v_row
  from api.crm_update_customer(
    p_customer_id => v_customer_id,
    p_display_name => 'Issue 1544 display label');
  if v_row.display_name <> 'Issue 1544 display label'
     or v_row.name is distinct from v_original_name then
    raise exception 'display-label update changed the wrong customer fields';
  end if;

  -- Existing callers omit p_display_name; this must resolve to the replacement
  -- and preserve the display label while retaining the old named arguments.
  select * into v_row
  from api.crm_update_customer(
    p_customer_id => v_customer_id,
    p_name => v_original_name);
  if v_row.name is distinct from v_original_name
     or v_row.display_name <> 'Issue 1544 display label' then
    raise exception 'legacy omitted-display_name call is not backward compatible';
  end if;

  -- NULL remains a preserve operation, including for an originally NULL label.
  select * into v_row
  from api.crm_update_customer(
    p_customer_id => v_customer_id,
    p_display_name => null);
  if v_row.display_name <> 'Issue 1544 display label' then
    raise exception 'null display_name did not preserve the current label';
  end if;

  select * into v_row
  from api.crm_update_customer(
    p_customer_id => v_customer_id,
    p_domain => 'issue-1615.example.invalid');
  if v_row.domain <> 'issue-1615.example.invalid' then
    raise exception 'non-null domain update was not preserved';
  end if;

  select * into v_row
  from api.crm_update_customer(
    p_customer_id => v_customer_id,
    p_domain => null);
  if v_row.domain <> 'issue-1615.example.invalid' then
    raise exception 'null domain did not preserve the current domain';
  end if;

  select * into v_row
  from api.crm_update_customer(
    p_customer_id => v_customer_id,
    p_domain => 'must-not-win.example.invalid',
    p_clear_domain => true);
  if v_row.domain is not null then
    raise exception 'p_clear_domain did not take precedence over p_domain';
  end if;
end;
$$;

rollback;
