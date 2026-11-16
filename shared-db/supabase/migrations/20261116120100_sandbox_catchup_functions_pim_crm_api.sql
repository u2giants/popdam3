-- #6356 sandbox catch-up batch 9: DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Ports missing and changed api, app, core, crm, dflow, pim and plm functions from production (functions touching dflow_prod, dam-only or claimed by other work are deferred).
-- Grants to production-only runtime logins (designflow_prod_backend_runtime, pm_jev_triage_worker) are not ported: those roles do not exist on the sandbox.
-- Not ported: api.db_data_admin_licensor_property_tree (it reads an end-of-life table; the repository guard forbids new references, #1684).
-- Not ported: plm.alert_coldlion_property_skips (the repository holds a newer hardened body than production; it follows when production is promoted).
-- derived-from: none

set check_function_bodies = off;


CREATE OR REPLACE FUNCTION api.crm_admin_role_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  result jsonb;
begin
  if not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', r.slug::text,
           'name', r.name,
           'description', r.description
         ) order by r.slug::text), '[]'::jsonb)
  into result
  from app.role r;

  return result;
end;
$function$
;
revoke all on function api.crm_admin_role_list() from public, anon, authenticated;
grant execute on function api.crm_admin_role_list() to authenticated;
CREATE OR REPLACE FUNCTION api.crm_admin_set_app_access(p_profile_id uuid, p_app text, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_actor uuid := app.current_profile_id();
  v_app app.app_name;
begin
  if not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if p_profile_id is null or not exists (
    select 1 from app.profile p where p.id = p_profile_id and p.status <> 'deleted'
  ) then
    raise exception 'crm: profile not found' using errcode = 'no_data_found';
  end if;

  if p_enabled is null or p_app is null
     or not (p_app = any(enum_range(null::app.app_name)::text[])) then
    raise exception 'crm: unknown app or missing flag: %', coalesce(p_app, '<null>')
      using errcode = 'invalid_parameter_value';
  end if;
  v_app := p_app::app.app_name;

  if p_profile_id = v_actor and v_app = 'crm' and not p_enabled then
    raise exception 'crm: you cannot remove your own CRM access'
      using errcode = 'check_violation';
  end if;

  if p_enabled then
    insert into app.app_access (profile_id, app, granted_by_profile_id, granted_at, revoked_at)
    values (p_profile_id, v_app, v_actor, now(), null)
    on conflict (profile_id, app) do update
      set revoked_at = null,
          granted_at = now(),
          granted_by_profile_id = excluded.granted_by_profile_id
      where app.app_access.revoked_at is not null;
  else
    update app.app_access aa
       set revoked_at = now()
     where aa.profile_id = p_profile_id and aa.app = v_app and aa.revoked_at is null;
  end if;

  return (select e from jsonb_array_elements(api.crm_admin_user_directory()) e
          where e->>'id' = p_profile_id::text);
end;
$function$
;
revoke all on function api.crm_admin_set_app_access(p_profile_id uuid, p_app text, p_enabled boolean) from public, anon, authenticated;
grant execute on function api.crm_admin_set_app_access(p_profile_id uuid, p_app text, p_enabled boolean) to authenticated;
CREATE OR REPLACE FUNCTION api.crm_admin_set_department_salespeople(p_department_ids uuid[], p_profile_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_ids uuid[] := coalesce(p_profile_ids, array[]::uuid[]);
  v_primary uuid;
  v_secondary uuid;
  v_bad uuid;
  v_count integer;
begin
  if not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if cardinality(v_ids) > 2 then
    raise exception 'crm: a department can have at most two salespeople'
      using errcode = 'invalid_parameter_value';
  end if;
  v_primary := v_ids[1];
  v_secondary := v_ids[2];
  if v_secondary is not null and v_primary is null then
    raise exception 'crm: a second salesperson requires a first salesperson'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_secondary is not null and v_secondary = v_primary then
    raise exception 'crm: the same salesperson cannot be listed twice'
      using errcode = 'invalid_parameter_value';
  end if;

  select x into v_bad
  from unnest(array[v_primary, v_secondary]) as t(x)
  where x is not null and not exists (
    select 1
    from app.profile p
    join app.user_role ur on ur.profile_id = p.id and ur.revoked_at is null
    join app.role r on r.id = ur.role_id and r.slug = 'sales'
    where p.id = x and p.status = 'active'
  )
  limit 1;
  if v_bad is not null then
    raise exception 'crm: salesperson must be an active user with the sales role'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_department_ids is null or cardinality(p_department_ids) = 0 then
    return 0;
  end if;

  update crm.department d
     set salesperson_profile_id = v_primary,
         secondary_salesperson_profile_id = v_secondary,
         updated_at = now()
   where d.id = any(p_department_ids);

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;
revoke all on function api.crm_admin_set_department_salespeople(p_department_ids uuid[], p_profile_ids uuid[]) from public, anon, authenticated;
grant execute on function api.crm_admin_set_department_salespeople(p_department_ids uuid[], p_profile_ids uuid[]) to authenticated;
CREATE OR REPLACE FUNCTION api.crm_admin_set_user_roles(p_profile_id uuid, p_roles text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_actor uuid := app.current_profile_id();
  v_roles text[];
  v_unknown text[];
  v_role_ids uuid[];
begin
  if not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if p_profile_id is null or not exists (
    select 1 from app.profile p where p.id = p_profile_id and p.status <> 'deleted'
  ) then
    raise exception 'crm: profile not found' using errcode = 'no_data_found';
  end if;

  if p_roles is null then
    raise exception 'crm: roles must not be null' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(array_agg(distinct x), array[]::text[]) into v_roles
  from unnest(p_roles) as t(x) where x is not null;

  select array_agg(x order by x) into v_unknown
  from unnest(v_roles) as t(x)
  where not exists (select 1 from app.role r where r.slug::text = x);
  if v_unknown is not null then
    raise exception 'crm: unknown role(s): %', array_to_string(v_unknown, ', ')
      using errcode = 'invalid_parameter_value';
  end if;

  if p_profile_id = v_actor and not ('administrator' = any(v_roles)) then
    raise exception 'crm: you cannot remove your own administrator role'
      using errcode = 'check_violation';
  end if;

  -- Serialize role and status changes so the last-administrator check
  -- cannot race (same lock key as crm_admin_set_user_status).
  perform pg_advisory_xact_lock(hashtext('api.crm_admin_access_invariant'));

  select coalesce(array_agg(r.id), array[]::uuid[]) into v_role_ids
  from app.role r where r.slug = any(v_roles::app.app_role[]);

  update app.user_role ur
     set revoked_at = now()
   where ur.profile_id = p_profile_id
     and ur.revoked_at is null
     and not (ur.role_id = any(v_role_ids));

  insert into app.user_role (profile_id, role_id, granted_by_profile_id, granted_at, revoked_at)
  select p_profile_id, rid, v_actor, now(), null
  from unnest(v_role_ids) as t(rid)
  on conflict (profile_id, role_id) do update
    set revoked_at = null,
        granted_at = now(),
        granted_by_profile_id = excluded.granted_by_profile_id
    where app.user_role.revoked_at is not null;

  -- Fail closed: counts database grants only (not JWT app_metadata roles). If
  -- no active granted administrator exists, insert one into app.user_role.
  if not exists (
    select 1 from app.user_role ur
    join app.role r on r.id = ur.role_id
    join app.profile p on p.id = ur.profile_id
    where r.slug = 'administrator' and ur.revoked_at is null and p.status = 'active'
  ) then
    raise exception 'crm: at least one active administrator is required'
      using errcode = 'check_violation';
  end if;

  return (select e from jsonb_array_elements(api.crm_admin_user_directory()) e
          where e->>'id' = p_profile_id::text);
end;
$function$
;
revoke all on function api.crm_admin_set_user_roles(p_profile_id uuid, p_roles text[]) from public, anon, authenticated;
grant execute on function api.crm_admin_set_user_roles(p_profile_id uuid, p_roles text[]) to authenticated;
CREATE OR REPLACE FUNCTION api.crm_admin_set_user_status(p_profile_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
begin
  if not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'crm: status must be active or inactive'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_profile_id is null or not exists (
    select 1 from app.profile p where p.id = p_profile_id and p.status <> 'deleted'
  ) then
    raise exception 'crm: profile not found' using errcode = 'no_data_found';
  end if;

  if p_profile_id = app.current_profile_id() and p_status <> 'active' then
    raise exception 'crm: you cannot deactivate yourself'
      using errcode = 'check_violation';
  end if;

  -- Only active <-> inactive transitions; archived/potential are not managed here.
  if not exists (
    select 1 from app.profile p
    where p.id = p_profile_id and p.status in ('active', 'inactive')
  ) then
    raise exception 'crm: only active or inactive users can change status here'
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('api.crm_admin_access_invariant'));

  update app.profile p
     set status = p_status::app.entity_status
   where p.id = p_profile_id;

  -- Fail closed: counts database grants only (not JWT app_metadata roles). If
  -- no active granted administrator exists, insert one into app.user_role.
  if not exists (
    select 1 from app.user_role ur
    join app.role r on r.id = ur.role_id
    join app.profile p on p.id = ur.profile_id
    where r.slug = 'administrator' and ur.revoked_at is null and p.status = 'active'
  ) then
    raise exception 'crm: at least one active administrator is required'
      using errcode = 'check_violation';
  end if;

  return (select e from jsonb_array_elements(api.crm_admin_user_directory()) e
          where e->>'id' = p_profile_id::text);
end;
$function$
;
revoke all on function api.crm_admin_set_user_status(p_profile_id uuid, p_status text) from public, anon, authenticated;
grant execute on function api.crm_admin_set_user_status(p_profile_id uuid, p_status text) to authenticated;
CREATE OR REPLACE FUNCTION api.crm_admin_user_directory()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  result jsonb;
begin
  if not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(to_jsonb(u) order by lower(coalesce(u.display_name, u.email)), u.email), '[]'::jsonb)
  into result
  from (
    select
      p.id,
      p.email::text            as email,
      p.display_name,
      p.avatar_url,
      p.status::text           as status,
      p.created_at,
      au.last_sign_in_at,
      coalesce((
        select array_agg(r.slug::text order by r.slug::text)
        from app.user_role ur
        join app.role r on r.id = ur.role_id
        where ur.profile_id = p.id and ur.revoked_at is null
      ), array[]::text[])      as roles,
      coalesce((
        select array_agg(aa.app::text order by aa.app::text)
        from app.app_access aa
        where aa.profile_id = p.id and aa.revoked_at is null
      ), array[]::text[])      as apps,
      (
        exists (
          select 1 from app.app_access aa
          where aa.profile_id = p.id and aa.app = 'crm' and aa.revoked_at is null
        )
        or exists (
          select 1 from app.user_role ur
          join app.role r on r.id = ur.role_id
          where ur.profile_id = p.id and ur.revoked_at is null and r.slug = 'administrator'
        )
      )                        as crm_access,
      coalesce(dc.n, 0)        as department_count
    from app.profile p
    left join auth.users au on au.id = p.auth_user_id
    left join (
      -- Counts every department (active or not) where the person is the
      -- primary or the secondary salesperson; each department counts once.
      select x.pid, count(distinct x.id)::int as n
      from (
        select d.id, d.salesperson_profile_id as pid from crm.department d
        where d.salesperson_profile_id is not null
        union all
        select d.id, d.secondary_salesperson_profile_id from crm.department d
        where d.secondary_salesperson_profile_id is not null
      ) x
      group by x.pid
    ) dc on dc.pid = p.id
    where p.status <> 'deleted'
  ) u;

  return result;
end;
$function$
;
revoke all on function api.crm_admin_user_directory() from public, anon, authenticated;
grant execute on function api.crm_admin_user_directory() to authenticated;
CREATE OR REPLACE FUNCTION api.crm_create_customer(p_name text, p_domain text, p_customer_status text DEFAULT 'POTENTIAL_CUSTOMER'::text, p_display_name text DEFAULT NULL::text, p_chain_type text DEFAULT NULL::text, p_routing_aliases text DEFAULT NULL::text)
 RETURNS core.customer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'core', 'crm', 'public'
AS $function$
declare
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_domain text := lower(trim(both '.' from regexp_replace(btrim(coalesce(p_domain, '')), '^(https?://)?(www\.)?([^/:?#]*).*$', '\3', 'i')));
  v_status text := upper(btrim(coalesce(p_customer_status, 'POTENTIAL_CUSTOMER')));
  v_chain  text := nullif(upper(btrim(coalesce(p_chain_type, ''))), '');
  v_owner  text;
  result   core.customer;
begin
  if not coalesce(app.has_app_access('crm'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_name is null then
    raise exception 'crm: customer name is required' using errcode = 'check_violation';
  end if;

  if v_domain = '' or position('.' in v_domain) = 0 or v_domain ~ '\s' then
    raise exception 'crm: a valid customer domain is required' using errcode = 'check_violation';
  end if;

  if v_status not in ('ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER') then
    raise exception 'crm: customer status must be ACTIVE_CUSTOMER or POTENTIAL_CUSTOMER'
      using errcode = 'check_violation';
  end if;

  if v_chain is not null and v_chain not in
     ('OFF_PRICE', 'SPECIALTY', 'VALUE', 'MASS_MARKET', 'GROCERY_DRUG', 'ECOM', 'CLUB', 'OTHER') then
    raise exception 'crm: unknown chain type %', p_chain_type using errcode = 'check_violation';
  end if;

  -- Serialize concurrent creates for the same domain, then refuse a domain an
  -- existing customer already owns (same normalisation as the #4936 matcher).
  perform pg_advisory_xact_lock(hashtextextended('crm_create_customer:' || v_domain, 0));

  select c.name into v_owner
  from core.customer c
  where lower(trim(both '.' from regexp_replace(btrim(coalesce(c.domain, '')), '^(https?://)?(www\.)?([^/:?#]*).*$', '\3', 'i'))) = v_domain
  limit 1;
  if found then
    raise exception 'crm: domain % already belongs to customer "%"', v_domain, v_owner
      using errcode = 'unique_violation';
  end if;

  insert into core.customer (
    name, display_name, domain, status, is_potential,
    customer_status, chain_type, routing_aliases, metadata
  )
  values (
    v_name,
    nullif(btrim(coalesce(p_display_name, '')), ''),
    v_domain,
    case when v_status = 'ACTIVE_CUSTOMER' then 'active'::app.entity_status else 'potential'::app.entity_status end,
    v_status = 'POTENTIAL_CUSTOMER',
    v_status,
    v_chain,
    nullif(btrim(coalesce(p_routing_aliases, '')), ''),
    jsonb_build_object('source', 'crm_create_customer', 'created_by', auth.uid())
  )
  returning * into result;

  return result;
end;
$function$
;
revoke all on function api.crm_create_customer(p_name text, p_domain text, p_customer_status text, p_display_name text, p_chain_type text, p_routing_aliases text) from public, anon, authenticated;
grant execute on function api.crm_create_customer(p_name text, p_domain text, p_customer_status text, p_display_name text, p_chain_type text, p_routing_aliases text) to authenticated;
CREATE OR REPLACE FUNCTION api.crm_email_routing_stage_counts()
 RETURNS TABLE(needs_company bigint, needs_department bigint, needs_program bigint, routed bigint, skipped bigint, total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'api', 'crm', 'app', 'public'
AS $function$
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    count(*) filter (where e.opportunity_id is null and e.routing_status is distinct from 'SKIPPED'
                       and e.company_id is null),
    count(*) filter (where e.opportunity_id is null and e.routing_status is distinct from 'SKIPPED'
                       and e.company_id is not null and e.department_id is null),
    count(*) filter (where e.opportunity_id is null and e.routing_status is distinct from 'SKIPPED'
                       and e.company_id is not null and e.department_id is not null),
    count(*) filter (where e.opportunity_id is not null),
    count(*) filter (where e.opportunity_id is null and e.routing_status = 'SKIPPED'),
    count(*)
  from crm.email_message e;
end;
$function$
;
revoke all on function api.crm_email_routing_stage_counts() from public, anon, authenticated;
grant execute on function api.crm_email_routing_stage_counts() to authenticated;
CREATE OR REPLACE FUNCTION api.crm_email_routing_stage_page(p_stage text DEFAULT 'all'::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, subject text, sender text, recipients text, received_at timestamp with time zone, routing_status text, routing_method text, body_preview text, detected_so_numbers text, detected_po_numbers text, company_id uuid, company_name text, department_id uuid, department_name text, opportunity_id uuid, opportunity_name text, opportunity_stage text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'api', 'crm', 'core', 'app', 'public'
AS $function$
declare
  v_stage text := coalesce(nullif(p_stage, ''), 'all');
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;
  if v_stage not in ('all', 'needs_company', 'needs_department', 'needs_program', 'routed', 'skipped') then
    raise exception 'crm: unknown routing stage %', v_stage using errcode = 'invalid_parameter_value';
  end if;

  return query
  with page as (
    select src.*
      from crm.email_message src
     where case v_stage
             when 'all' then true
             when 'routed' then src.opportunity_id is not null
             when 'skipped' then src.opportunity_id is null and src.routing_status = 'SKIPPED'
             when 'needs_company' then src.opportunity_id is null and src.routing_status is distinct from 'SKIPPED'
                                       and src.company_id is null
             when 'needs_department' then src.opportunity_id is null and src.routing_status is distinct from 'SKIPPED'
                                          and src.company_id is not null and src.department_id is null
             else src.opportunity_id is null and src.routing_status is distinct from 'SKIPPED'
                  and src.company_id is not null and src.department_id is not null
           end
     order by src.received_at desc nulls last, src.id
     limit least(greatest(coalesce(p_limit, 100), 1), 1000)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    e.id, e.subject, e.sender, e.recipients, e.received_at, e.routing_status,
    e.routing_method, e.body_preview, e.detected_so_numbers, e.detected_po_numbers,
    e.company_id, comp.name, e.department_id, d.name,
    e.opportunity_id, o.name, o.stage, e.updated_at
  from page e
  left join core.customer comp on comp.id = e.company_id
  left join crm.department d on d.id = e.department_id
  left join crm.opportunity o on o.id = e.opportunity_id
  order by e.received_at desc nulls last, e.id;
end;
$function$
;
revoke all on function api.crm_email_routing_stage_page(p_stage text, p_limit integer, p_offset integer) from public, anon, authenticated;
grant execute on function api.crm_email_routing_stage_page(p_stage text, p_limit integer, p_offset integer) to authenticated;
CREATE OR REPLACE FUNCTION api.crm_update_contact(p_contact_id uuid, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_full_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_job_title text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid, p_crm_department_id uuid DEFAULT NULL::uuid, p_contact_type text DEFAULT NULL::text, p_scope text DEFAULT NULL::text, p_clear_company boolean DEFAULT false, p_clear_crm_department boolean DEFAULT false, p_clear_contact_type boolean DEFAULT false, p_clear_scope boolean DEFAULT false)
 RETURNS core.contact
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'core', 'crm', 'public'
AS $function$
declare
  result core.contact;
  v_dept_company uuid;
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if p_crm_department_id is not null then
    select d.company_id into v_dept_company
    from crm.department d
    where d.id = p_crm_department_id;

    if v_dept_company is null then
      raise exception 'crm: department % not found', p_crm_department_id using errcode = 'no_data_found';
    end if;

    if p_company_id is not null and p_company_id <> v_dept_company then
      raise exception 'crm: department % belongs to a different company', p_crm_department_id using errcode = 'foreign_key_violation';
    end if;
  end if;

  update core.contact ct
  set
    first_name = coalesce(p_first_name, ct.first_name),
    last_name  = coalesce(p_last_name, ct.last_name),
    full_name  = coalesce(
      p_full_name,
      nullif(trim(concat_ws(' ', coalesce(p_first_name, ct.first_name), coalesce(p_last_name, ct.last_name))), ''),
      ct.full_name
    ),
    email      = coalesce(p_email::extensions.citext, ct.email),
    phone      = coalesce(p_phone, ct.phone),
    title      = coalesce(p_job_title, ct.title)
  where ct.id = p_contact_id
  returning ct.* into result;

  if not found then
    raise exception 'crm: contact % not found', p_contact_id using errcode = 'no_data_found';
  end if;

  if p_clear_company then
    delete from core.contact_company cc
    where cc.contact_id = p_contact_id
      and cc.relationship_type = 'buyer';
  end if;

  if p_company_id is not null then
    update core.contact_company cc
    set is_primary = false
    where cc.contact_id = p_contact_id
      and cc.relationship_type = 'buyer'
      and cc.company_id <> p_company_id;

    insert into core.contact_company (
      contact_id,
      company_id,
      relationship_type,
      contact_type,
      scope,
      crm_department_id,
      is_primary
    )
    values (
      p_contact_id,
      p_company_id,
      'buyer',
      case when p_clear_contact_type then null else p_contact_type end,
      case
        when p_clear_scope then null
        when p_scope is not null then p_scope
        when p_crm_department_id is not null then 'DEPARTMENT'
        else null
      end,
      case when p_clear_crm_department then null else p_crm_department_id end,
      true
    )
    on conflict (contact_id, company_id, relationship_type) do update
    set
      contact_type = case
        when p_clear_contact_type then null
        when excluded.contact_type is not null then excluded.contact_type
        else core.contact_company.contact_type
      end,
      scope = case
        when p_clear_scope then null
        when p_scope is not null then p_scope
        when p_crm_department_id is not null then 'DEPARTMENT'
        when p_clear_crm_department and core.contact_company.scope = 'DEPARTMENT' then 'COMPANY_WIDE'
        else core.contact_company.scope
      end,
      crm_department_id = case
        when p_clear_crm_department then null
        when excluded.crm_department_id is not null then excluded.crm_department_id
        else core.contact_company.crm_department_id
      end,
      is_primary = true;
  elsif not p_clear_company and (
    p_clear_crm_department
    or p_clear_contact_type
    or p_clear_scope
    or p_crm_department_id is not null
    or p_contact_type is not null
    or p_scope is not null
  ) then
    update core.contact_company cc
    set
      contact_type = case
        when p_clear_contact_type then null
        when p_contact_type is not null then p_contact_type
        else cc.contact_type
      end,
      scope = case
        when p_clear_scope then null
        when p_scope is not null then p_scope
        when p_crm_department_id is not null then 'DEPARTMENT'
        when p_clear_crm_department and cc.scope = 'DEPARTMENT' then 'COMPANY_WIDE'
        else cc.scope
      end,
      crm_department_id = case
        when p_clear_crm_department then null
        when p_crm_department_id is not null then p_crm_department_id
        else cc.crm_department_id
      end
    where cc.id = (
      select x.id
      from core.contact_company x
      where x.contact_id = p_contact_id
        and x.relationship_type = 'buyer'
      order by x.is_primary desc nulls last, x.id
      limit 1
    );

    -- A department-only call for a contact with no buyer relation row used to
    -- land here, match nothing, and still report success. Create the row from
    -- the department's own company, the same inherit rule the flyout applies.
    -- (p_contact_type-only / p_scope-only calls on a relation-less contact stay
    -- intentional no-ops: there is no relation row to carry them.)
    if not found and p_crm_department_id is not null then
      insert into core.contact_company (
        contact_id,
        company_id,
        relationship_type,
        contact_type,
        scope,
        crm_department_id,
        is_primary
      )
      values (
        p_contact_id,
        v_dept_company,
        'buyer',
        case when p_clear_contact_type then null else p_contact_type end,
        case
          when p_clear_scope then null
          when p_scope is not null then p_scope
          else 'DEPARTMENT'
        end,
        case when p_clear_crm_department then null else p_crm_department_id end,
        not exists (
          select 1 from core.contact_company x
          where x.contact_id = p_contact_id
            and x.relationship_type = 'buyer'
            and x.is_primary
        )
      );
    end if;
  end if;

  return result;
end;
$function$
;
revoke all on function api.crm_update_contact(p_contact_id uuid, p_first_name text, p_last_name text, p_full_name text, p_email text, p_phone text, p_job_title text, p_company_id uuid, p_crm_department_id uuid, p_contact_type text, p_scope text, p_clear_company boolean, p_clear_crm_department boolean, p_clear_contact_type boolean, p_clear_scope boolean) from public, anon, authenticated;
grant execute on function api.crm_update_contact(p_contact_id uuid, p_first_name text, p_last_name text, p_full_name text, p_email text, p_phone text, p_job_title text, p_company_id uuid, p_crm_department_id uuid, p_contact_type text, p_scope text, p_clear_company boolean, p_clear_crm_department boolean, p_clear_contact_type boolean, p_clear_scope boolean) to authenticated;
CREATE OR REPLACE FUNCTION api.db_data_admin_decide_property_match(p_resolution_id uuid, p_decision text, p_licensed_property_ids bigint[], p_decision_reason text, p_client_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_actor text;
  v_decision text;
  v_status text;
  v_reason text;
  v_ids bigint[];
  v_existing plm.dcp_opa_property_resolution%rowtype;
  v_existing_ids bigint[];
  v_pending plm.dcp_opa_property_resolution%rowtype;
  v_written plm.dcp_opa_property_resolution%rowtype;
  v_repeat boolean := false;
begin
  perform app.require_licensing_manager_access();

  -- The reviewer is whoever holds the JWT, and nobody else.
  v_actor := coalesce(
    nullif(btrim(auth.uid()::text), ''),
    nullif(btrim(coalesce(current_setting('request.jwt.claim.sub', true), '')), '')
  );
  if v_actor is null then
    raise exception 'db_data_admin: a property match decision requires an authenticated reviewer'
      using errcode = 'insufficient_privilege';
  end if;

  if p_resolution_id is null or p_client_request_id is null then
    raise exception 'db_data_admin: resolution id and client request id are both required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_resolution_id = p_client_request_id then
    raise exception 'db_data_admin: the client request id may not reuse the decided resolution id'
      using errcode = 'invalid_parameter_value';
  end if;

  v_decision := lower(btrim(coalesce(p_decision, '')));
  if v_decision not in ('approve', 'reject') then
    raise exception 'db_data_admin: decision must be approve or reject'
      using errcode = 'invalid_parameter_value';
  end if;
  v_status := case v_decision when 'approve' then 'approved' else 'rejected' end;

  v_reason := nullif(btrim(coalesce(p_decision_reason, '')), '');
  if v_reason is null then
    raise exception 'db_data_admin: a decision reason is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}'::bigint[])
    into v_ids
  from unnest(coalesce(p_licensed_property_ids, '{}'::bigint[])) x
  where x is not null;

  if v_status = 'rejected' and array_length(v_ids, 1) is not null then
    raise exception 'db_data_admin: a rejection selects no OPA members'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Idempotent repeat. The client request id IS the new decision's primary key,
  -- so a retry of the identical call finds its own recorded decision and returns
  -- it. A DIFFERENT call reusing a spent request id is a caller bug and fails.
  select * into v_existing
  from plm.dcp_opa_property_resolution
  where resolution_id = p_client_request_id;

  if found then
    select coalesce(array_agg(m.licensed_property_id order by m.licensed_property_id), '{}'::bigint[])
      into v_existing_ids
    from plm.dcp_opa_property_resolution_member m
    where m.resolution_id = p_client_request_id;

    if v_existing.supersedes_resolution_id is distinct from p_resolution_id
       or v_existing.approval_status <> v_status
       or v_existing_ids is distinct from v_ids then
      raise exception 'db_data_admin: this client request id already recorded a different decision'
        using errcode = 'unique_violation';
    end if;

    v_written := v_existing;
    v_repeat := true;
  else
    select * into v_pending
    from plm.dcp_opa_property_resolution
    where resolution_id = p_resolution_id
    for share;

    if not found then
      raise exception 'db_data_admin: no such resolution'
        using errcode = 'no_data_found';
    end if;
    if v_pending.approval_status <> 'pending' then
      raise exception 'db_data_admin: resolution % is already %',
        p_resolution_id, v_pending.approval_status
        using errcode = 'restrict_violation';
    end if;
    if exists (
      select 1 from plm.dcp_opa_property_resolution newer
      where newer.supersedes_resolution_id = v_pending.resolution_id
    ) then
      raise exception 'db_data_admin: resolution % has already been superseded',
        p_resolution_id
        using errcode = 'restrict_violation';
    end if;

    -- Issue #2576. A copy-keyed approval may not un-serve the stable
    -- identity's working mapping. Refuse an approval whose member set
    -- disagrees with an existing terminal mapping of the same identity on
    -- another retained copy AND is not itself already held by one.
    if v_status = 'approved'
       and array_length(v_ids, 1) is not null
       and v_pending.source_property_id like 'dcpvault:%' then
      if (
        select count(*) filter (
                 where c.copy_state = 'mapped'
                   and c.fingerprint is distinct from p.fingerprint) > 0
           and count(*) filter (
                 where c.copy_state = 'mapped'
                   and c.fingerprint = p.fingerprint) = 0
        from (
          select coalesce(string_agg(
            'disney_opa|plm.opa_property|' || u::text, chr(10)
            order by 'disney_opa|plm.opa_property|' || u::text), '') as fingerprint
          from unnest(v_ids) u
        ) p
        left join lateral (
          select distinct on (t.source_system, t.source_table)
            (case
              when t.creative_decision_state is not null
                then t.creative_decision_state
              when t.approval_status = 'approved' and mf.fingerprint <> ''
                then 'mapped'
              else 'unmapped'
            end)::text as copy_state,
            mf.fingerprint
          from plm.dcp_opa_property_resolution t
          cross join lateral (
            select coalesce(string_agg(
              m.submission_source_system||'|'||m.submission_source_table||'|'||
                m.submission_source_id, chr(10)
              order by m.submission_source_system, m.submission_source_table,
                m.submission_source_id), '') as fingerprint
            from plm.dcp_opa_property_resolution_member m
            where m.resolution_id = t.resolution_id
          ) mf
          where t.approval_status in ('approved','rejected')
            and t.source_property_id = v_pending.source_property_id
            and not (t.source_system = v_pending.source_system
                 and t.source_table = v_pending.source_table)
          order by t.source_system, t.source_table, t.decision_version desc,
            t.approved_at desc nulls last, t.resolution_id desc
        ) c on true
      ) then
        raise exception 'db_data_admin: resolution % would give the stable identity % a member set that disagrees with a terminal mapping already recorded on another retained copy; reconcile the identity instead of recording a conflicting copy',
          p_resolution_id, v_pending.source_property_id
          using errcode = 'restrict_violation';
      end if;
    end if;

    begin
      -- Append-only: a superseding version, never an update of the pending row.
      insert into plm.dcp_opa_property_resolution (
        resolution_id, source_system, source_table, source_property_id,
        decision_version, approval_status, supersedes_resolution_id,
        evidence_reference, evidence_sha256, decision_reason,
        contract_asserted_studio_code, contract_evidence_reference,
        contract_evidence_sha256, approved_at, approved_by
      ) values (
        p_client_request_id, v_pending.source_system, v_pending.source_table,
        v_pending.source_property_id, v_pending.decision_version + 1, v_status,
        v_pending.resolution_id, v_pending.evidence_reference,
        v_pending.evidence_sha256, v_reason,
        v_pending.contract_asserted_studio_code,
        v_pending.contract_evidence_reference, v_pending.contract_evidence_sha256,
        case when v_status = 'approved' then clock_timestamp() end,
        case when v_status = 'approved' then v_actor end
      )
      returning * into v_written;

      -- Members belong to the SUPERSEDING version and are written inside the
      -- same call as the decision itself.
      insert into plm.dcp_opa_property_resolution_member (
        resolution_id, submission_source_system, submission_source_table,
        submission_source_id, licensed_property_id, member_ordinal
      )
      select v_written.resolution_id, 'disney_opa', 'plm.opa_property',
        s.licensed_property_id::text, s.licensed_property_id, s.member_ordinal
      from (
        select u as licensed_property_id,
               row_number() over (order by u)::integer as member_ordinal
        from unnest(v_ids) u
      ) s;
    exception when unique_violation then
      -- A concurrent caller got there first. Either it was this exact request
      -- (return its decision) or somebody else decided the same pending row.
      select * into v_existing
      from plm.dcp_opa_property_resolution
      where resolution_id = p_client_request_id;

      if not found then
        raise exception 'db_data_admin: resolution % was decided concurrently',
          p_resolution_id
          using errcode = 'serialization_failure';
      end if;

      -- The winner used THIS client request id. It is only a safe repeat when it
      -- recorded the same decision on the same pending row with the same member
      -- set. A different decision reusing a spent request id must fail loudly
      -- rather than silently returning somebody else's verdict.
      select coalesce(array_agg(m.licensed_property_id order by m.licensed_property_id), '{}'::bigint[])
        into v_existing_ids
      from plm.dcp_opa_property_resolution_member m
      where m.resolution_id = p_client_request_id;

      if v_existing.supersedes_resolution_id is distinct from p_resolution_id
         or v_existing.approval_status <> v_status
         or v_existing_ids is distinct from v_ids then
        raise exception 'db_data_admin: this client request id already recorded a different decision'
          using errcode = 'unique_violation';
      end if;

      v_written := v_existing;
      v_repeat := true;
    end;
  end if;

  return jsonb_build_object(
    'resolution_id', v_written.resolution_id,
    'source_system', v_written.source_system,
    'source_table', v_written.source_table,
    'source_property_id', v_written.source_property_id,
    'decision_version', v_written.decision_version,
    'approval_status', v_written.approval_status,
    'supersedes_resolution_id', v_written.supersedes_resolution_id,
    'decision_reason', v_written.decision_reason,
    'evidence_reference', v_written.evidence_reference,
    'evidence_sha256', v_written.evidence_sha256,
    'contract_asserted_studio_code', v_written.contract_asserted_studio_code,
    'approved_at', v_written.approved_at,
    'approved_by', v_written.approved_by,
    'created_at', v_written.created_at,
    -- Stable business identity this decision belongs to. Non-DCP sources
    -- keep their exact copy key: bare integer source ids collide between
    -- licensors, so they are never grouped across systems.
    'identity_key', case when v_written.source_property_id like 'dcpvault:%'
      then v_written.source_property_id
      else v_written.source_table||'|'||v_written.source_system||'|'||
           v_written.source_property_id end,
    'identity_decision_state', (
      select case
        when g.copy_count = 0 then null
        when g.mapped_fingerprints > 1 then 'conflict'
        when g.mapped_copies > 0 then 'mapped'
        else g.newest_state
      end
      from (
        select count(*) as copy_count,
          count(*) filter (where c.copy_state='mapped') as mapped_copies,
          count(distinct c.member_fingerprint)
            filter (where c.copy_state='mapped') as mapped_fingerprints,
          (array_agg(c.copy_state order by c.decision_version desc,
             c.approved_at desc nulls last, c.resolution_id desc))[1]
             as newest_state
        from (
          select distinct on (t.source_system, t.source_table)
            t.resolution_id, t.decision_version, t.approved_at,
            (case
              when t.creative_decision_state is not null
                then t.creative_decision_state
              when t.approval_status='approved' and mf.fingerprint <> ''
                then 'mapped'
              else 'unmapped'
            end)::text as copy_state,
            mf.fingerprint as member_fingerprint
          from plm.dcp_opa_property_resolution t
          cross join lateral (
            select coalesce(string_agg(
              m.submission_source_system||'|'||m.submission_source_table||'|'||
                m.submission_source_id, chr(10)
              order by m.submission_source_system, m.submission_source_table,
                m.submission_source_id), '') as fingerprint
            from plm.dcp_opa_property_resolution_member m
            where m.resolution_id = t.resolution_id
          ) mf
          where t.approval_status in ('approved','rejected')
            and case
                  when v_written.source_property_id like 'dcpvault:%'
                    then t.source_property_id = v_written.source_property_id
                  else t.source_system = v_written.source_system
                   and t.source_table = v_written.source_table
                   and t.source_property_id = v_written.source_property_id
                end
          order by t.source_system, t.source_table, t.decision_version desc,
            t.approved_at desc nulls last, t.resolution_id desc
        ) c
      ) g
    ),
    'identity_copies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_system', c.source_system,
        'source_table', c.source_table,
        'resolution_id', c.resolution_id,
        'decision_version', c.decision_version,
        'approval_status', c.approval_status,
        'creative_decision_state', c.creative_decision_state,
        'member_count', c.member_count
      ) order by c.source_table, c.source_system)
      from (
        select distinct on (t.source_system, t.source_table)
          t.resolution_id, t.source_system, t.source_table, t.decision_version,
          t.approval_status, t.creative_decision_state,
          (select count(*)::integer
             from plm.dcp_opa_property_resolution_member m
            where m.resolution_id = t.resolution_id) as member_count
        from plm.dcp_opa_property_resolution t
        where t.approval_status in ('approved','rejected')
          and case
                when v_written.source_property_id like 'dcpvault:%'
                  then t.source_property_id = v_written.source_property_id
                else t.source_system = v_written.source_system
                 and t.source_table = v_written.source_table
                 and t.source_property_id = v_written.source_property_id
              end
        order by t.source_system, t.source_table, t.decision_version desc,
          t.approved_at desc nulls last, t.resolution_id desc
      ) c
    ), '[]'::jsonb),
    'idempotent_repeat', v_repeat,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'licensed_property_id', m.licensed_property_id,
               'member_ordinal', m.member_ordinal
             ) order by m.member_ordinal)
      from plm.dcp_opa_property_resolution_member m
      where m.resolution_id = v_written.resolution_id
    ), '[]'::jsonb)
  );
end;
$function$
;
revoke all on function api.db_data_admin_decide_property_match(p_resolution_id uuid, p_decision text, p_licensed_property_ids bigint[], p_decision_reason text, p_client_request_id uuid) from public, anon, authenticated;
grant execute on function api.db_data_admin_decide_property_match(p_resolution_id uuid, p_decision text, p_licensed_property_ids bigint[], p_decision_reason text, p_client_request_id uuid) to authenticated;
CREATE OR REPLACE FUNCTION api.db_data_admin_property_match_queue(p_search text DEFAULT NULL::text, p_cursor text DEFAULT NULL::text, p_page_size integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_page_size integer;
  v_cursor_key text;
  v_search text;
  v_rows jsonb;
  v_fetched integer;
  v_last_key text;
  v_next_cursor text;
begin
  -- Authorization and every licensed read stay one server-side operation.
  perform app.require_licensing_manager_access();

  v_page_size := least(greatest(coalesce(p_page_size, 100), 1), 500);
  v_search := nullif(btrim(coalesce(p_search, '')), '');

  if p_cursor is not null then
    begin
      v_cursor_key := convert_from(decode(p_cursor, 'base64'), 'UTF8');
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_key is null or v_cursor_key = '' then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  with tip as (
    -- The LATEST version of every exact source identity, decided or not.
    select distinct on (r.source_system, r.source_table, r.source_property_id) r.*
    from plm.dcp_opa_property_resolution r
    order by r.source_system, r.source_table, r.source_property_id,
             r.decision_version desc, r.resolution_id desc
  ), pending as (
    -- Only an identity whose CURRENT version is undecided is a review case. An
    -- identity already approved or rejected is finished and never reappears.
    select t.* from tip t where t.approval_status = 'pending'
  ), prior as (
    select p.resolution_id as pending_resolution_id,
           a.resolution_id as prior_resolution_id,
           a.approval_status as prior_approval_status,
           a.decision_version as prior_decision_version,
           a.contract_asserted_studio_code as prior_contract_asserted_studio_code
    from pending p
    join lateral (
      select a.*
      from plm.dcp_opa_property_resolution a
      where a.source_system = p.source_system
        and a.source_table = p.source_table
        and a.source_property_id = p.source_property_id
        and a.approval_status = 'approved'
        and a.decision_version < p.decision_version
      order by a.decision_version desc, a.resolution_id desc
      limit 1
    ) a on true
  ), candidates as (
    select m.resolution_id,
           count(*)::integer as candidate_count,
           jsonb_agg(jsonb_build_object(
             'licensed_property_id', m.licensed_property_id,
             'member_ordinal', m.member_ordinal
           ) order by m.member_ordinal) as candidates
    from plm.dcp_opa_property_resolution_member m
    join pending p on p.resolution_id = m.resolution_id
    group by m.resolution_id
  ), named as (
    select p.*,
           coalesce(d.display_name, l.display_name, mv.display_name) as source_property_name,
           p.source_table || '|' || p.source_system || '|' || p.source_property_id as row_key
    from pending p
    left join plm.dcp_property d
      on p.source_table = 'plm.dcp_property'
     and d.source_system = p.source_system
     and d.source_id = p.source_property_id
    left join plm.lucasfilm_dcp_property l
      on p.source_table = 'plm.lucasfilm_dcp_property'
     and l.source_system = p.source_system
     and l.source_id = p.source_property_id
    left join plm.marvel_dcp_property mv
      on p.source_table = 'plm.marvel_dcp_property'
     and mv.source_system = p.source_system
     and mv.source_id = p.source_property_id
  ), filtered as (
    select n.* from named n
    where (v_search is null
           or n.source_property_id ilike '%' || v_search || '%'
           or coalesce(n.source_property_name, '') ilike '%' || v_search || '%')
      and (p_cursor is null or n.row_key collate "C" > v_cursor_key collate "C")
  ), ordered as (
    select f.* from filtered f
    order by f.row_key collate "C"
    limit v_page_size + 1
  ), numbered as (
    select o.*, row_number() over (order by o.row_key collate "C") as rn
    from ordered o
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'row_key', n.row_key,
        'resolution_id', n.resolution_id,
        'source_system', n.source_system,
        'source_table', n.source_table,
        'source_property_id', n.source_property_id,
        'source_property_name', n.source_property_name,
        'display_label', coalesce(
          nullif(btrim(n.source_property_name), ''),
          '[Unlabeled source ID: ' || n.source_property_id || ']'
        ),
        'decision_version', n.decision_version,
        'approval_status', n.approval_status,
        'evidence_reference', n.evidence_reference,
        'evidence_sha256', n.evidence_sha256,
        'decision_reason', n.decision_reason,
        'contract_asserted_studio_code', n.contract_asserted_studio_code,
        'contract_evidence_reference', n.contract_evidence_reference,
        'contract_evidence_sha256', n.contract_evidence_sha256,
        'supersedes_resolution_id', n.supersedes_resolution_id,
        'created_at', n.created_at,
        'prior_resolution_id', pr.prior_resolution_id,
        'prior_approval_status', pr.prior_approval_status,
        'prior_decision_version', pr.prior_decision_version,
        'prior_contract_asserted_studio_code', pr.prior_contract_asserted_studio_code,
        'candidate_count', coalesce(c.candidate_count, 0),
        'candidates', coalesce(c.candidates, '[]'::jsonb),
        -- Stable business identity for this row. Non-DCP sources keep their
        -- exact copy key: bare integer source ids collide between licensors.
        'identity_key', ik.identity_key,
        -- ONE coherent review state for the business identity behind this row.
        'identity_decision_state', idn.decision_state,
        'identity_resolution_id', idn.resolution_id,
        'identity_conflict', idn.decision_state = 'conflict',
        'identity_copy_count', idn.copy_count,
        -- Copy-level provenance and conflict evidence, retained in full.
        'identity_copies', idn.copies
      ) order by n.rn
    ) filter (where n.rn <= v_page_size), '[]'::jsonb),
    count(*)::integer,
    max(n.row_key) filter (where n.rn = v_page_size)
  into v_rows, v_fetched, v_last_key
  from numbered n
  left join candidates c on c.resolution_id = n.resolution_id
  left join prior pr on pr.pending_resolution_id = n.resolution_id
  cross join lateral (
    select case when n.source_property_id like 'dcpvault:%'
                then n.source_property_id
                else n.source_table||'|'||n.source_system||'|'||n.source_property_id
           end as identity_key
  ) ik
  cross join lateral (
    select
      case when g.mapped_fingerprints > 1 then null else g.pick_id end
        as resolution_id,
      (case
        when g.copy_count = 0 then null
        when g.mapped_fingerprints > 1 then 'conflict'
        when g.mapped_copies > 0 then 'mapped'
        else g.newest_state
      end)::text as decision_state,
      g.copy_count::integer as copy_count,
      g.copies
    from (
      select
        count(*) as copy_count,
        count(*) filter (where c2.copy_state='mapped') as mapped_copies,
        count(distinct c2.member_fingerprint)
          filter (where c2.copy_state='mapped') as mapped_fingerprints,
        (array_agg(c2.resolution_id order by (c2.copy_state='mapped') desc,
           c2.decision_version desc, c2.approved_at desc nulls last,
           c2.resolution_id desc))[1] as pick_id,
        (array_agg(c2.copy_state order by c2.decision_version desc,
           c2.approved_at desc nulls last, c2.resolution_id desc))[1]
           as newest_state,
        coalesce(jsonb_agg(jsonb_build_object(
          'source_system', c2.source_system,
          'source_table', c2.source_table,
          'resolution_id', c2.resolution_id,
          'decision_version', c2.decision_version,
          'approval_status', c2.approval_status,
          'creative_decision_state', c2.creative_decision_state,
          'copy_decision_state', c2.copy_state,
          'member_count', c2.member_count,
          'member_fingerprint', c2.member_fingerprint
        ) order by c2.source_table, c2.source_system), '[]'::jsonb) as copies
      from (
        -- Newest TERMINAL decision per retained copy. Pending rows are
        -- proposals: they stay in this queue and never hide a terminal
        -- decision.
        select distinct on (t.source_system, t.source_table)
          t.resolution_id, t.source_system, t.source_table, t.decision_version,
          t.approved_at, t.approval_status, t.creative_decision_state,
          (case
            when t.creative_decision_state is not null
              then t.creative_decision_state
            when t.approval_status='approved' and mf.fingerprint <> ''
              then 'mapped'
            else 'unmapped'
          end)::text as copy_state,
          mf.fingerprint as member_fingerprint,
          mf.member_count
        from plm.dcp_opa_property_resolution t
        cross join lateral (
          select coalesce(string_agg(
            m.submission_source_system||'|'||m.submission_source_table||'|'||
              m.submission_source_id, chr(10)
            order by m.submission_source_system, m.submission_source_table,
              m.submission_source_id), '') as fingerprint,
            count(*)::integer as member_count
          from plm.dcp_opa_property_resolution_member m
          where m.resolution_id = t.resolution_id
        ) mf
        where t.approval_status in ('approved','rejected')
          and case when ik.identity_key like 'dcpvault:%'
                   then t.source_property_id = ik.identity_key
                   else t.source_system = n.source_system
                    and t.source_table = n.source_table
                    and t.source_property_id = n.source_property_id
              end
        order by t.source_system, t.source_table, t.decision_version desc,
          t.approved_at desc nulls last, t.resolution_id desc
      ) c2
    ) g
  ) idn;

  if v_fetched > v_page_size and v_last_key is not null then
    v_next_cursor := encode(convert_to(v_last_key, 'UTF8'), 'base64');
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$function$
;
revoke all on function api.db_data_admin_property_match_queue(p_search text, p_cursor text, p_page_size integer) from public, anon, authenticated;
grant execute on function api.db_data_admin_property_match_queue(p_search text, p_cursor text, p_page_size integer) to authenticated;
CREATE OR REPLACE FUNCTION api.db_data_admin_scraped_properties(p_search text DEFAULT NULL::text, p_cursor text DEFAULT NULL::text, p_page_size integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_page_size integer;
  v_cursor_key text;
  v_rows jsonb;
  v_fetched integer;
  v_last_key text;
  v_next_cursor text;
begin
  -- Authorization and licensed-source reads remain one server-side operation.
  perform app.require_licensing_manager_access();

  v_page_size := least(greatest(coalesce(p_page_size, 500), 1), 1000);

  if p_cursor is not null then
    begin
      v_cursor_key := convert_from(decode(p_cursor, 'base64'), 'UTF8');
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_key is null or v_cursor_key = '' then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  with opa_scope_latest as materialized (
    select distinct on (
      m.licensed_property_id, m.region_code, m.branch_code,
      m.line_of_business_id, m.product_type_code, m.template_id, m.workflow_id
    )
      m.licensed_property_id, m.branch_code
    from plm.opa_property_scope_membership m
    where m.approval_status = 'approved'
    order by m.licensed_property_id, m.region_code, m.branch_code,
      m.line_of_business_id, m.product_type_code, m.template_id, m.workflow_id,
      m.source_captured_at desc, m.created_at desc, m.membership_id desc
  ), opa_scope_summary as materialized (
    select licensed_property_id,
      count(distinct branch_code) as scope_count,
      min(branch_code) as studio_code
    from opa_scope_latest
    group by licensed_property_id
  ), opa_studio_summary as materialized (
    select r.licensed_property_id,
      case
        when count(*) filter (where r.resolution_status = 'ambiguous_crossover') > 0
          or count(distinct r.studio_code) filter (where r.resolution_status = 'canonical') > 1
          then 'ambiguous_crossover'
        when count(*) filter (where r.resolution_status = 'canonical') = 1 then 'canonical'
        else 'unresolved'
      end as resolution_status,
      case
        when count(*) filter (where r.resolution_status = 'ambiguous_crossover') = 0
          and count(*) filter (where r.resolution_status = 'canonical') = 1
          then min(r.studio_code) filter (where r.resolution_status = 'canonical')
      end as studio_code
    from plm.opa_property_studio_resolution r
    group by r.licensed_property_id
  ), dcp_terminal_copies as materialized (
    -- Stable DCP identity authority must precede section selection and paging.
    select distinct on (r.source_system, r.source_table, r.source_property_id)
      r.*,
      case when r.source_property_id like 'dcpvault:%'
        then r.source_property_id
        else r.source_table||'|'||r.source_system||'|'||r.source_property_id
      end as identity_key,
      case when r.creative_decision_state is not null then r.creative_decision_state
        when r.approval_status = 'approved' and mf.fingerprint <> '' then 'mapped'
        else 'unmapped' end as copy_state,
      mf.fingerprint as member_fingerprint
    from plm.dcp_opa_property_resolution r
    cross join lateral (
      select coalesce(string_agg(
        m.submission_source_system||'|'||m.submission_source_table||'|'||
          m.submission_source_id, chr(10)
        order by m.submission_source_system,m.submission_source_table,
          m.submission_source_id), '') as fingerprint
      from plm.dcp_opa_property_resolution_member m
      where m.resolution_id = r.resolution_id
    ) mf
    where r.approval_status in ('approved','rejected')
      and (r.source_property_id like 'dcpvault:%'
        or r.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property'))
    order by r.source_system,r.source_table,r.source_property_id,
      r.decision_version desc,r.approved_at desc nulls last,r.resolution_id desc
  ), dcp_identity_authority as materialized (
    select identity_key,
      count(distinct member_fingerprint) filter (where copy_state='mapped') > 1
        or count(distinct contract_asserted_studio_code)
          filter (where copy_state='mapped') > 1 as authority_conflict,
      min(contract_asserted_studio_code) filter (where copy_state='mapped')
        as contract_asserted_studio_code,
      (array_agg(resolution_id order by (copy_state='mapped') desc,
        decision_version desc,approved_at desc nulls last,resolution_id desc))[1]
        as resolution_id
    from dcp_terminal_copies
    group by identity_key
  ), dcp_current_resolution as materialized (
    select r.resolution_id,r.source_system,r.source_table,r.source_property_id,
      a.contract_asserted_studio_code,
      case when a.authority_conflict then 'conflict' else r.copy_state end
        as decision_state
    from dcp_identity_authority a
    join dcp_terminal_copies r on r.resolution_id = a.resolution_id
  ), dcp_member_count as materialized (
    select rm.resolution_id, count(*) as member_count
    from plm.dcp_opa_property_resolution_member rm
    join dcp_current_resolution r on r.resolution_id = rm.resolution_id
    group by rm.resolution_id
  ), dcp_scope_latest as materialized (
    select distinct on (
      rm.resolution_id, rm.licensed_property_id, sm.region_code, sm.branch_code,
      sm.line_of_business_id, sm.product_type_code, sm.template_id, sm.workflow_id
    )
      rm.resolution_id, sm.branch_code
    from plm.dcp_opa_property_resolution_member rm
    join dcp_current_resolution r on r.resolution_id = rm.resolution_id
    join plm.opa_property_scope_membership sm
      on sm.licensed_property_id = rm.licensed_property_id
     and sm.approval_status = 'approved'
    order by rm.resolution_id, rm.licensed_property_id, sm.region_code, sm.branch_code,
      sm.line_of_business_id, sm.product_type_code, sm.template_id, sm.workflow_id,
      sm.source_captured_at desc, sm.created_at desc, sm.membership_id desc
  ), dcp_scope_summary as materialized (
    select resolution_id,
      count(distinct branch_code) as opa_scope_count,
      min(branch_code) as opa_studio_code
    from dcp_scope_latest
    group by resolution_id
  ), pmt_ranked as (
    select p.*,
           row_number() over (
             partition by p.property_source_id
             order by c.completed_at desc nulls last,
                      p.imported_at desc,
                      p.capture_id::text desc
           ) as capture_rank
    from plm.pmt_property p
    join plm.pmt_capture c on c.capture_id = p.capture_id
    where c.status = 'complete'
      and c.capture_kind = 'full'
  ), nbcu_ranked as (
    select p.*,
           row_number() over (
             partition by p.property_key
             order by c.source_captured_at desc,
                      p.source_captured_at desc,
                      p.capture_id::text desc
           ) as capture_rank
    from plm.nbcu_property p
    join plm.nbcu_capture c on c.id = p.capture_id
    where c.status = 'complete'
  ), wildbrain_ranked as (
    select e.*,
      row_number() over (
        partition by e.era_source_id
        order by c.source_captured_at desc, e.capture_id::text desc
      ) as capture_rank
    from plm.wildbrain_era e
    join plm.wildbrain_capture c on c.id = e.capture_id
    where c.status = 'complete'
  ), sega_submission_ranked as (
    select p.*,
      row_number() over (
        partition by p.property_source_id
        order by c.source_captured_at desc, p.submission_capture_id::text desc
      ) as capture_rank
    from plm.sega_submission_property p
    join plm.sega_submission_capture c on c.id = p.submission_capture_id
    where c.status = 'complete'
  ), sega_ranked as (
    select p.*,
      row_number() over (
        partition by p.property_source_id
        order by c.source_captured_at desc, p.capture_id::text desc
      ) as capture_rank
    from plm.sega_property p
    join plm.sega_capture c on c.id = p.capture_id
    where c.status = 'complete'
  ), pmt_trackerplus_latest as (
    select c.id
    from plm.pmt_trackerplus_submission_capture c
    where c.status = 'complete'
    order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
    limit 1
  ), coke_property_latest as (
    select c.id
    from plm.coke_capture c
    where c.status = 'complete'
    order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
    limit 1
  ), wwe_submission_latest as (
    select c.id
    from plm.wwe_submission_capture c
    where c.status = 'complete'
    order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
    limit 1
  ), source_rows as not materialized (
    select
      case
        when s.scope_status = 'direct_lucasfilm' then 'lucasfilm-star-wars-opa'
        when s.scope_status = 'direct_disney' and o.resolution_status = 'canonical'
          and o.studio_code in ('disney', 'marvel', 'pixar') then
          case o.studio_code when 'disney' then 'disney-opa'
            when 'marvel' then 'marvel-opa' when 'pixar' then 'pixar-opa' end
        when s.scope_status = 'direct_disney' then 'disney-opa'
        when s.scope_status = 'scope_conflict' or o.resolution_status = 'ambiguous_crossover'
          then 'opa-scope-conflict'
        when s.scope_status is null and o.resolution_status = 'canonical' then
          case o.studio_code when 'disney' then 'disney-opa'
            when 'marvel' then 'marvel-opa'
            when 'lucasfilm' then 'lucasfilm-star-wars-opa'
            when 'pixar' then 'pixar-opa' end
        else 'disney-opa-unresolved'
      end::text as presentation_licensor_key,
      case
        when s.scope_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Submissions (OPA)'
        when s.scope_status = 'direct_disney' and o.resolution_status = 'canonical'
          and o.studio_code = 'marvel' then 'Marvel - Submissions (OPA)'
        when s.scope_status = 'direct_disney' and o.resolution_status = 'canonical'
          and o.studio_code = 'pixar' then 'Pixar - Submissions (OPA)'
        when s.scope_status = 'direct_disney' then 'Disney - Submissions (OPA)'
        when s.scope_status = 'scope_conflict' or o.resolution_status = 'ambiguous_crossover'
          then 'OPA - Submissions (scope conflict)'
        when s.scope_status is null and o.resolution_status = 'canonical' then
          case o.studio_code when 'disney' then 'Disney - Submissions (OPA)'
            when 'marvel' then 'Marvel - Submissions (OPA)'
            when 'lucasfilm' then 'Lucasfilm / Star Wars - Submissions (OPA)'
            when 'pixar' then 'Pixar - Submissions (OPA)' end
        else 'OPA - Submissions (unresolved)'
      end::text as presentation_licensor_name,
      'disney_opa'::text as source_system,
      'plm.opa_property'::text as source_table,
      p.licensed_property_id::text as source_property_id,
      p.property_name::text as source_property_name,
      coalesce(s.scope_status, o.resolution_status, 'unresolved')::text as source_status,
      case when s.scope_status is not null then 'direct_opa_route_membership'
        else 'opa_studio_resolution' end::text as provenance_kind,
      p.last_seen_at::timestamptz as latest_seen_at,
      null::text as capture_marker
    from plm.opa_property p
    left join opa_scope_summary s0
      on s0.licensed_property_id = p.licensed_property_id
    left join lateral (
      select case
        when s0.scope_count > 1 then 'scope_conflict'
        when s0.studio_code = 'lucasfilm' then 'direct_lucasfilm'
        when s0.studio_code = 'disney' then 'direct_disney'
      end as scope_status
    ) s on true
    left join opa_studio_summary o
      on o.licensed_property_id = p.licensed_property_id

    union all
    select
      case when x.authority_status = 'direct_disney' then 'disney'
        when x.authority_status = 'direct_marvel' then 'marvel'
        when x.authority_status = 'direct_lucasfilm' then 'lucasfilm-star-wars'
        when x.authority_status = 'direct_pixar' then 'pixar'
        when x.authority_status = 'authority_conflict' then 'dcp-authority-conflict'
        when x.authority_status = 'contract_opa_conflict' then 'dcp-contract-opa-conflict'
        when x.authority_status = 'opa_scope_conflict' then 'dcp-opa-scope-conflict'
        else 'dcp-authority-unresolved' end,
      case when x.authority_status = 'direct_disney' then 'Disney - Creative (DCP Vault)'
        when x.authority_status = 'direct_marvel' then 'DCP Vault - Creative (authoritative Marvel scope)'
        when x.authority_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Creative (DCP Vault)'
        when x.authority_status = 'direct_pixar' then 'Pixar - Creative (DCP Vault)'
        when x.authority_status = 'authority_conflict' then 'DCP Creative - identity authority conflict'
        when x.authority_status = 'contract_opa_conflict' then 'DCP Creative - contract/OPA conflict'
        when x.authority_status = 'opa_scope_conflict' then 'DCP Creative - mapped OPA scope conflict'
        else 'DCP Creative - unresolved authority' end,
      p.source_system, 'plm.dcp_property', p.source_id, p.display_name,
      coalesce(x.authority_status, 'unresolved'),
      'explicit_dcp_to_opa_property_id_with_independent_contract_and_opa_authority', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.dcp_property p
    left join dcp_current_resolution r
      on r.source_property_id = p.source_id
     and (p.source_id like 'dcpvault:%'
       or (r.source_system = p.source_system and r.source_table = 'plm.dcp_property'))
    left join dcp_member_count mc on mc.resolution_id = r.resolution_id
    left join dcp_scope_summary o on o.resolution_id = r.resolution_id
    left join lateral (
      select case
        when r.decision_state = 'conflict' then 'authority_conflict'
        when r.decision_state is distinct from 'mapped' then null
        when o.opa_scope_count > 1 then 'opa_scope_conflict'
        when r.contract_asserted_studio_code is not null
          and o.opa_studio_code is not null
          and r.contract_asserted_studio_code <> o.opa_studio_code
          and not (
            r.contract_asserted_studio_code = 'marvel'
            and o.opa_studio_code = 'disney'
          )
          then 'contract_opa_conflict'
        when r.contract_asserted_studio_code is not null and mc.member_count > 0
          then 'direct_' || r.contract_asserted_studio_code
        when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
      end as authority_status
    ) x on true

    union all
    select
      'dcp-vault-non-authoritative-marvel-tag',
      'DCP Vault - Creative (non-authoritative Marvel tag)',
      p.source_system, 'plm.marvel_dcp_property', p.source_id, p.display_name,
      'non_authoritative',
      'dcp_property_licensor_resolution', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.marvel_dcp_property p

    union all
    select
      case when x.authority_status = 'direct_disney' then 'disney'
        when x.authority_status = 'direct_marvel' then 'marvel'
        when x.authority_status = 'direct_lucasfilm' then 'lucasfilm-star-wars'
        when x.authority_status = 'direct_pixar' then 'pixar'
        when x.authority_status = 'authority_conflict' then 'dcp-authority-conflict'
        when x.authority_status = 'contract_opa_conflict' then 'dcp-contract-opa-conflict'
        when x.authority_status = 'opa_scope_conflict' then 'dcp-opa-scope-conflict'
        else 'dcp-authority-unresolved' end,
      case when x.authority_status = 'direct_disney' then 'Disney - Creative (DCP Vault)'
        when x.authority_status = 'direct_marvel' then 'DCP Vault - Creative (authoritative Marvel scope)'
        when x.authority_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Creative (DCP Vault)'
        when x.authority_status = 'direct_pixar' then 'Pixar - Creative (DCP Vault)'
        when x.authority_status = 'authority_conflict' then 'DCP Creative - identity authority conflict'
        when x.authority_status = 'contract_opa_conflict' then 'DCP Creative - contract/OPA conflict'
        when x.authority_status = 'opa_scope_conflict' then 'DCP Creative - mapped OPA scope conflict'
        else 'DCP Creative - unresolved authority' end,
      p.source_system, 'plm.lucasfilm_dcp_property', p.source_id, p.display_name,
      coalesce(x.authority_status, 'unresolved'),
      'explicit_dcp_to_opa_property_id_with_independent_contract_and_opa_authority', null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.lucasfilm_dcp_property p
    left join dcp_current_resolution r
      on r.source_property_id = p.source_id
     and (p.source_id like 'dcpvault:%'
       or (r.source_system = p.source_system and r.source_table = 'plm.lucasfilm_dcp_property'))
    left join dcp_member_count mc on mc.resolution_id = r.resolution_id
    left join dcp_scope_summary o on o.resolution_id = r.resolution_id
    left join lateral (
      select case
        when r.decision_state = 'conflict' then 'authority_conflict'
        when r.decision_state is distinct from 'mapped' then null
        when o.opa_scope_count > 1 then 'opa_scope_conflict'
        when r.contract_asserted_studio_code is not null
          and o.opa_studio_code is not null
          and r.contract_asserted_studio_code <> o.opa_studio_code
          and not (r.contract_asserted_studio_code = 'marvel' and o.opa_studio_code = 'disney')
          then 'contract_opa_conflict'
        when r.contract_asserted_studio_code is not null and mc.member_count > 0
          then 'direct_' || r.contract_asserted_studio_code
        when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
      end as authority_status
    ) x on true

    union all
    select
      'marvel-asgard-creative',
      'Marvel - Creative (ASGARD)',
      'marvel_asgard',
      'plm.marvel_asgard_style_guide',
      g.source_identity_key,
      g.exact_label,
      case when g.is_actively_observed then 'active' else 'retained' end,
      'direct_asgard_style_guide',
      null::timestamptz,
      g.last_seen_capture_key::text
    from plm.marvel_asgard_style_guide g

    union all
    select
      case when p.source_id not like 'dcpvault:%' then '20th-century'
        when x.authority_status = 'direct_disney' then 'disney'
        when x.authority_status = 'direct_marvel' then 'marvel'
        when x.authority_status = 'direct_lucasfilm' then 'lucasfilm-star-wars'
        when x.authority_status = 'direct_pixar' then 'pixar'
        when x.authority_status = 'authority_conflict' then 'dcp-authority-conflict'
        when x.authority_status = 'contract_opa_conflict' then 'dcp-contract-opa-conflict'
        when x.authority_status = 'opa_scope_conflict' then 'dcp-opa-scope-conflict'
        else 'dcp-authority-unresolved' end,
      case when p.source_id not like 'dcpvault:%' then '20th Century - Creative (DCP Vault)'
        when x.authority_status = 'direct_disney' then 'Disney - Creative (DCP Vault)'
        when x.authority_status = 'direct_marvel' then 'DCP Vault - Creative (authoritative Marvel scope)'
        when x.authority_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Creative (DCP Vault)'
        when x.authority_status = 'direct_pixar' then 'Pixar - Creative (DCP Vault)'
        when x.authority_status = 'authority_conflict' then 'DCP Creative - identity authority conflict'
        when x.authority_status = 'contract_opa_conflict' then 'DCP Creative - contract/OPA conflict'
        when x.authority_status = 'opa_scope_conflict' then 'DCP Creative - mapped OPA scope conflict'
        else 'DCP Creative - unresolved authority' end,
      p.source_system, 'plm.twentieth_century_dcp_property', p.source_id, p.display_name,
      case when p.source_id like 'dcpvault:%' then coalesce(x.authority_status, 'unresolved') end,
      case when p.source_id like 'dcpvault:%'
        then 'explicit_dcp_to_opa_property_id_with_independent_contract_and_opa_authority'
        else 'metadata_properties_array' end, null::timestamptz,
      p.last_seen_metadata_run_id::text
    from plm.twentieth_century_dcp_property p
    left join dcp_current_resolution r
      on r.source_property_id = p.source_id
     and (p.source_id like 'dcpvault:%'
       or (r.source_system = p.source_system and r.source_table = 'plm.twentieth_century_dcp_property'))
    left join dcp_member_count mc on mc.resolution_id = r.resolution_id
    left join dcp_scope_summary o on o.resolution_id = r.resolution_id
    left join lateral (
      select case
        when r.decision_state = 'conflict' then 'authority_conflict'
        when r.decision_state is distinct from 'mapped' then null
        when o.opa_scope_count > 1 then 'opa_scope_conflict'
        when r.contract_asserted_studio_code is not null
          and o.opa_studio_code is not null
          and r.contract_asserted_studio_code <> o.opa_studio_code
          and not (
            r.contract_asserted_studio_code = 'marvel'
            and o.opa_studio_code = 'disney'
          )
          then 'contract_opa_conflict'
        when r.contract_asserted_studio_code is not null and mc.member_count > 0
          then 'direct_' || r.contract_asserted_studio_code
        when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
      end as authority_status
    ) x on true

    union all
    select 'paramount', 'Paramount - Creative (Creative Library)', 'paramount_creative_library',
           'plm.pmt_property', p.property_source_id::text, p.property_name,
           case when p.is_licensed_selection then 'licensed_selection'
                else 'asset_metadata' end,
           case when p.is_licensed_selection then 'portal_property_selection'
                else 'asset_metadata_property' end,
           p.imported_at, p.capture_id::text
    from pmt_ranked p
    where p.capture_rank = 1

    union all
    select 'warner-bros', 'Warner Bros. - Creative (STARLABS)', 'warner_starlabs',
           'plm.wb_property',
           p.source_namespace || ':' || p.identity_method || ':' ||
             coalesce(p.source_id, p.fallback_key),
           p.label, null,
           'normalized_' || p.identity_method,
           p.last_seen_at, p.capture_id::text
    from plm.wb_property p

    union all
    select 'nbcuniversal', 'NBCUniversal - Creative (Creative Asset Factory)', 'nbcu_creative_asset_factory',
           'plm.nbcu_property', p.property_key, p.property_label, null,
           p.source_kind, p.source_captured_at, p.capture_id::text
    from nbcu_ranked p
    where p.capture_rank = 1

    union all
    select 'strawberry-shortcake-creative', 'Strawberry Shortcake - Creative',
           'wildbrain_tenovos', 'plm.wildbrain_era', e.era_source_id,
           e.era_label, case when e.is_root then 'root' else 'descendant' end,
           'declared_era_hierarchy', null::timestamptz, e.capture_id::text
    from wildbrain_ranked e
    where e.capture_rank = 1

    union all
    select 'sega-submissions', 'Sega - Submissions', 'sega_product_approval',
           'plm.sega_submission_property', p.property_source_id,
           p.property_label, 'complete', 'product_approval_property_picker',
           null::timestamptz, p.submission_capture_id::text
    from sega_submission_ranked p
    where p.capture_rank = 1

    union all
    select 'sega-creative', 'Sega - Creative',
           'sega_dsi', 'plm.sega_property', p.property_source_id,
           p.property_label, p.source_status, 'portal_ip_registry',
           null::timestamptz, p.capture_id::text
    from sega_ranked p
    where p.capture_rank = 1

    union all
    select 'paramount-submissions', 'Paramount - Submissions (TrackerPlus)',
           'paramount_trackerplus', 'plm.pmt_trackerplus_submission_property',
           p.property_local_key, p.exact_label, 'complete',
           'trackerplus_submission_property_picker',
           null::timestamptz, p.capture_id::text
    from plm.pmt_trackerplus_submission_property p
    join pmt_trackerplus_latest c on c.id = p.capture_id

    union all
    select 'coca-cola-creative', 'Coca-Cola - Creative (Asset Library Property choices)',
           'coke_brandcomply', 'plm.coke_asset_property_option', o.option_key,
           o.exact_label, o.classification_status, 'asset_library_property_choice',
           null::timestamptz, o.capture_id::text
    from (
      select distinct on (opt.option_key)
             opt.option_key, opt.exact_label, opt.classification_status, opt.capture_id
      from plm.coke_asset_property_option opt
      join coke_property_latest c on c.id = opt.capture_id
      order by opt.option_key, opt.ordinal, opt.exact_label
    ) o

    union all
    select 'wwe-submissions', 'WWE - Submissions', 'wwe_submissions',
           'plm.wwe_property', p.property_source_id, p.property_label,
           case when p.parent_property_source_id is null then 'root' else 'descendant' end,
           'submission_property_picker', null::timestamptz, p.capture_id::text
    from plm.wwe_property p
    join wwe_submission_latest c on c.id = p.capture_id
  ), keyed as (
    select
      jsonb_build_array(
        s.presentation_licensor_key,
        s.source_system,
        s.source_table,
        s.source_property_id
      )::text as row_key,
      s.*,
      case when s.source_table = 'plm.opa_property' then 'Submissions (OPA)'
        when s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property') then 'Creative (DCP Vault)'
        when s.source_table = 'plm.marvel_dcp_property' then 'Retained DCP evidence - not Marvel Creative authority'
        when s.source_table = 'plm.marvel_asgard_style_guide' then 'Creative (ASGARD)'
        when s.source_table = 'plm.twentieth_century_dcp_property' then 'Creative (DCP Vault)'
        when s.source_table = 'plm.pmt_property' then 'Creative (Creative Library)'
        when s.source_table = 'plm.wb_property' then 'Creative (STARLABS)'
        when s.source_table = 'plm.nbcu_property' then 'Creative (Creative Asset Factory)'
        when s.source_table = 'plm.wildbrain_era' then 'Creative'
        when s.source_table = 'plm.sega_submission_property' then 'Submissions'
        when s.source_table = 'plm.sega_property' then 'Creative'
        when s.source_table = 'plm.pmt_trackerplus_submission_property'
          then 'Submissions (TrackerPlus)'
        when s.source_table = 'plm.coke_asset_property_option'
          then 'Creative (Asset Library Property choices)'
        when s.source_table = 'plm.wwe_property' then 'Submissions'
        else 'Creative' end::text as source_purpose,
      case
        when s.source_status = 'authority_conflict' then 'Retained copies of this stable DCP identity carry conflicting approved mappings or signed studio assertions; Licensing must review those exact decisions.'
        when s.source_status in ('contract_opa_conflict','opa_scope_conflict') and s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property') then 'Authoritative signed-contract and direct captured OPA assertions disagree, or mapped OPA IDs have conflicting direct scopes; Licensing must review the concrete assertions and named style guides.'
        when s.source_status = 'scope_conflict' then 'Direct approved OPA route memberships place this Property in both Disney and Lucasfilm scope; Licensing must resolve whether both memberships are intentional.'
        when s.source_status = 'ambiguous_crossover' then 'Approved OPA studio evidence is ambiguous or names multiple studios; Licensing must resolve the direct source scope.'
        when s.source_status in ('unresolved') or s.source_status is null then case
          when s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property')
            then 'DCP supplied a Creative metadata value but no approved exact OPA Property ID link carries an authoritative signed-contract assertion or direct captured OPA scope.'
          else 'No current approved direct authority evidence is available.' end
        when s.source_table = 'plm.marvel_dcp_property' then 'DCP Marvel tags are retained mixed-guide evidence and are not Marvel Creative authority.'
        else null::text
      end::text as review_reason,
      case
        when s.source_status = 'authority_conflict' then 'latest terminal decisions across retained copies of the exact stable DCP identity'
        when s.source_status in ('contract_opa_conflict','opa_scope_conflict') and s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property') then 'authoritative signed-contract assertion compared independently with direct latest captured OPA scope through exact OPA Property IDs'
        when s.source_status = 'scope_conflict' then 'approved direct OPA route memberships'
        when s.source_status = 'ambiguous_crossover' then 'approved OPA studio-resolution records'
        when s.source_status = 'unresolved' or s.source_status is null then case
          when s.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property')
            then 'DCP Creative evidence has no authoritative signed-contract assertion or direct captured OPA scope through an approved exact OPA Property ID link'
          else 'no current approved direct authority record' end
        else null::text end::text as evidence_basis,
      case when s.source_status in ('authority_conflict','scope_conflict','ambiguous_crossover','unresolved') or s.source_status is null
        then case
          when s.source_status = 'authority_conflict' then 'Compare the direct authority records and approve one superseding exact-identity decision. Do not infer authority from a property name or landing table.'
          when s.source_status = 'scope_conflict' then 'Compare the approved Disney and Lucasfilm route records, then approve or reject the exact memberships. Do not use a name keyword as scope evidence.'
          else 'Review direct source identity and approve an evidence-backed decision; do not infer from names or landing tables.' end
        else null::text end::text as review_guidance
    from source_rows s
  ), labeled as (
    select
      k.*,
      case
        when k.source_table in (
          'plm.dcp_property',
          'plm.marvel_dcp_property',
          'plm.lucasfilm_dcp_property'
        )
          and nullif(btrim(k.source_property_name), '') is null
          and position('/' in k.source_property_id) > 0
          and btrim(regexp_replace(
                regexp_replace(k.source_property_id, '^.*/', ''),
                '[-_]+', ' ', 'g'
              )) ~ '[[:alnum:]]'
        then replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(
                          replace(
                            replace(
                              replace(
                                replace(
                                  initcap(btrim(regexp_replace(
                                    regexp_replace(k.source_property_id, '^.*/', ''),
                                    '[-_]+', ' ', 'g'
                                  ))),
                                  ' And ', ' and '
                                ),
                                ' Or ', ' or '
                              ),
                              ' Of ', ' of '
                            ),
                            ' The ', ' the '
                          ),
                          ' A ', ' a '
                        ),
                        ' An ', ' an '
                      ),
                      ' To ', ' to '
                    ),
                    ' For ', ' for '
                  ),
                  ' In ', ' in '
                ),
                ' On ', ' on '
              ),
              ' At ', ' at '
            ),
            ' By ', ' by '
          ),
                    '''S', '''s'
                  ),
                  '''T', '''t'
                ),
                '''Re', '''re'
              ),
              '''Ve', '''ve'
            ),
            '''Ll', '''ll'
          ),
          '''D', '''d'
        ),
        '''M', '''m'
        )
        else null
      end as derived_display_label
    from keyed k
  ), filtered as (
    select l.*
    from labeled l
    where (
      p_search is null
      or l.presentation_licensor_name ilike '%' || p_search || '%'
      or l.source_system ilike '%' || p_search || '%'
      or l.source_property_id ilike '%' || p_search || '%'
      or l.source_property_name ilike '%' || p_search || '%'
      or l.derived_display_label ilike '%' || p_search || '%'
    )
      and (p_cursor is null or l.row_key collate "C" > v_cursor_key collate "C")
  ), ordered as materialized (
    select f.*
    from filtered f
    order by f.row_key collate "C"
    limit v_page_size + 1
  ), page_creative_decision as materialized (
    -- One stable DCP source id is the business Creative identity. Every
    -- retained source-system/table copy of it is provenance, not a separate
    -- business fact. Non-DCP sources keep their exact copy key because bare
    -- integer source ids collide between licensors.
    select o.row_key, r.resolution_id, r.decision_state
    from ordered o
    cross join lateral (
      select case when o.source_property_id like 'dcpvault:%'
                  then o.source_property_id
                  else o.source_table||'|'||o.source_system||'|'||o.source_property_id
             end as identity_key
    ) k
    left join lateral (
      select
        -- Fails closed: a genuine terminal disagreement serves no mapping.
        case when g.mapped_fingerprints > 1 then null else g.pick_id end
          as resolution_id,
        (case
          when g.copy_count = 0 then null
          when g.mapped_fingerprints > 1 then 'conflict'
          when g.mapped_copies > 0 then 'mapped'
          else g.newest_state
        end)::text as decision_state
      from (
        select
          count(*) as copy_count,
          count(*) filter (where c.copy_state='mapped') as mapped_copies,
          count(distinct c.member_fingerprint)
            filter (where c.copy_state='mapped') as mapped_fingerprints,
          (array_agg(c.resolution_id order by (c.copy_state='mapped') desc,
             c.decision_version desc, c.approved_at desc nulls last,
             c.resolution_id desc))[1] as pick_id,
          (array_agg(c.copy_state order by c.decision_version desc,
             c.approved_at desc nulls last, c.resolution_id desc))[1]
             as newest_state
        from (
          -- Newest TERMINAL decision per retained copy. Pending rows are
          -- proposals: they stay queued and never hide a terminal decision.
          select distinct on (t.source_system, t.source_table)
            t.resolution_id, t.decision_version, t.approved_at,
            (case
              when t.creative_decision_state is not null
                then t.creative_decision_state
              when t.approval_status='approved' and mf.fingerprint <> ''
                then 'mapped'
              else 'unmapped'
            end)::text as copy_state,
            mf.fingerprint as member_fingerprint
          from plm.dcp_opa_property_resolution t
          cross join lateral (
            select coalesce(string_agg(
              m.submission_source_system||'|'||m.submission_source_table||'|'||
                m.submission_source_id, chr(10)
              order by m.submission_source_system, m.submission_source_table,
                m.submission_source_id), '') as fingerprint
            from plm.dcp_opa_property_resolution_member m
            where m.resolution_id = t.resolution_id
          ) mf
          where t.approval_status in ('approved','rejected')
            and case when k.identity_key like 'dcpvault:%'
                     then t.source_property_id = k.identity_key
                     else t.source_system = o.source_system
                      and t.source_table = o.source_table
                      and t.source_property_id = o.source_property_id
                end
          order by t.source_system, t.source_table, t.decision_version desc,
            t.approved_at desc nulls last, t.resolution_id desc
        ) c
      ) g
    ) r on true
  ), page_submission_identity as materialized (
    select distinct m.submission_source_system,m.submission_source_table,
      m.submission_source_id
    from page_creative_decision d
    join plm.dcp_opa_property_resolution_member m
      on m.resolution_id=d.resolution_id
  ), page_submission_source_candidates as materialized (
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.property_name::text as source_property_name
      from plm.opa_property p
      where i.submission_source_id ~ '^-?[0-9]+$'
        and p.licensed_property_id=i.submission_source_id::bigint
      limit 1
    ) p on true
    where i.submission_source_system='disney_opa'
      and i.submission_source_table='plm.opa_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.display_name::text as source_property_name
      from plm.dcp_property p
      where p.source_system=i.submission_source_system
        and p.source_id=i.submission_source_id limit 1
    ) p on true
    where i.submission_source_table='plm.dcp_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.display_name::text as source_property_name
      from plm.marvel_dcp_property p
      where p.source_system=i.submission_source_system
        and p.source_id=i.submission_source_id limit 1
    ) p on true
    where i.submission_source_table='plm.marvel_dcp_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.display_name::text as source_property_name
      from plm.lucasfilm_dcp_property p
      where p.source_system=i.submission_source_system
        and p.source_id=i.submission_source_id limit 1
    ) p on true
    where i.submission_source_table='plm.lucasfilm_dcp_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.display_name::text as source_property_name
      from plm.twentieth_century_dcp_property p
      where p.source_system=i.submission_source_system
        and p.source_id=i.submission_source_id limit 1
    ) p on true
    where i.submission_source_table='plm.twentieth_century_dcp_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.property_name::text as source_property_name
      from plm.pmt_property p
      join plm.pmt_capture c on c.capture_id=p.capture_id
      where p.property_source_id::text=i.submission_source_id
        and c.status='complete' and c.capture_kind='full'
      order by c.completed_at desc nulls last,p.imported_at desc,
        p.capture_id::text desc limit 1
    ) p on true
    where i.submission_source_system='paramount_creative_library'
      and i.submission_source_table='plm.pmt_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.label::text as source_property_name
    from page_submission_identity i
    join plm.wb_property p
      on p.source_namespace || ':' || p.identity_method || ':' ||
        coalesce(p.source_id,p.fallback_key)=i.submission_source_id
    where i.submission_source_system='warner_starlabs'
      and i.submission_source_table='plm.wb_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.property_label::text as source_property_name
      from plm.nbcu_property p
      join plm.nbcu_capture c on c.id=p.capture_id
      where p.property_key=i.submission_source_id and c.status='complete'
      order by c.source_captured_at desc,p.source_captured_at desc,
        p.capture_id::text desc limit 1
    ) p on true
    where i.submission_source_system='nbcu_creative_asset_factory'
      and i.submission_source_table='plm.nbcu_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select e.era_label::text as source_property_name
      from plm.wildbrain_era e
      join plm.wildbrain_capture c on c.id=e.capture_id
      where e.era_source_id=i.submission_source_id and c.status='complete'
      order by c.source_captured_at desc,e.capture_id::text desc limit 1
    ) p on true
    where i.submission_source_system='wildbrain_tenovos'
      and i.submission_source_table='plm.wildbrain_era'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.property_label::text as source_property_name
      from plm.sega_submission_property p
      join plm.sega_submission_capture c on c.id=p.submission_capture_id
      where p.property_source_id=i.submission_source_id and c.status='complete'
      order by c.source_captured_at desc,p.submission_capture_id::text desc
      limit 1
    ) p on true
    where i.submission_source_system='sega_product_approval'
      and i.submission_source_table='plm.sega_submission_property'

    union all
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,p.source_property_name
    from page_submission_identity i
    join lateral (
      select p.property_label::text as source_property_name
      from plm.sega_property p
      join plm.sega_capture c on c.id=p.capture_id
      where p.property_source_id=i.submission_source_id and c.status='complete'
      order by c.source_captured_at desc,p.capture_id::text desc limit 1
    ) p on true
    where i.submission_source_system='sega_dsi'
      and i.submission_source_table='plm.sega_property'
  ), page_submission_source as materialized (
    select i.submission_source_system,i.submission_source_table,
      i.submission_source_id,c.source_property_name
    from page_submission_identity i
    left join page_submission_source_candidates c
      on c.submission_source_system=i.submission_source_system
     and c.submission_source_table=i.submission_source_table
     and c.submission_source_id=i.submission_source_id
  ), enriched as materialized (
    select
      o.*,
      creative_decision.decision_state::text as creative_mapping_state,
      coalesce(submission_summary.members,'[]'::jsonb) as submission_members,
      submission_summary.contract_status::text as sanitized_contract_status
    from ordered o
    left join page_creative_decision creative_decision
      on creative_decision.row_key=o.row_key
    left join lateral (
      select
        coalesce(jsonb_agg(jsonb_build_object(
          'source_system',m.submission_source_system,
          'source_table',m.submission_source_table,
          'source_id',m.submission_source_id,
          'display_label',submission_source.source_property_name
        ) order by m.submission_source_system,m.submission_source_table,m.submission_source_id),'[]'::jsonb) members,
        case
          when bool_or(contract_decision.decision_state='conflict') then 'conflict'
          when bool_or(contract_decision.resolution_id is null) then 'unknown'
          when bool_or(contract_decision.decision_state='evidenced' and not capture.controlling_chain_complete) then 'incomplete_chain'
          when bool_or(contract_decision.decision_state='not_evidenced')
            or bool_or(contract_decision.decision_state='evidenced' and evidence.id is null) then 'not_evidenced'
          when bool_and(contract_decision.decision_state='evidenced'
            and capture.controlling_chain_complete and evidence.id is not null) then 'evidenced'
          else 'unknown' end contract_status
      from plm.dcp_opa_property_resolution_member m
      left join page_submission_source submission_source
        on submission_source.submission_source_system=m.submission_source_system
       and submission_source.submission_source_table=m.submission_source_table
       and submission_source.submission_source_id=m.submission_source_id
      left join lateral (
        select cr.* from plm.creative_submission_contract_resolution cr
        where cr.submission_source_system=m.submission_source_system
          and cr.submission_source_table=m.submission_source_table
          and cr.submission_source_id=m.submission_source_id
          and not exists (select 1 from plm.creative_submission_contract_resolution newer
            where newer.supersedes_resolution_id=cr.resolution_id)
        order by cr.decision_version desc,cr.approved_at desc,cr.resolution_id desc limit 1
      ) contract_decision on true
      left join plm.contract_property_capture capture on capture.id=contract_decision.contract_capture_id
      left join lateral (select e.id from plm.contract_property_evidence e
        where e.capture_id=contract_decision.contract_capture_id
          and e.property_id=contract_decision.contract_property_id limit 1) evidence on true
      where m.resolution_id=creative_decision.resolution_id
    ) submission_summary on true
  ), page_dcp_properties as materialized (
    select e.row_key,p.id as property_id
    from enriched e
    join plm.dcp_property p
      on p.source_system=e.source_system and p.source_id=e.source_property_id
    where e.source_table='plm.dcp_property'
  ), page_lucasfilm_dcp_properties as materialized (
    select e.row_key,p.id as property_id
    from enriched e
    join plm.lucasfilm_dcp_property p
      on p.source_system=e.source_system and p.source_id=e.source_property_id
    where e.source_table='plm.lucasfilm_dcp_property'
  ), page_dcp_retained_assets as materialized (
    select p.property_id,o.asset_id
    from page_dcp_properties p
    cross join lateral (
      select distinct o.dcp_asset_id as asset_id
      from plm.dcp_asset_property_observation o
      where o.dcp_property_id=p.property_id
    ) o
  ), page_lucasfilm_dcp_retained_assets as materialized (
    select p.property_id,o.asset_id
    from page_lucasfilm_dcp_properties p
    cross join lateral (
      select distinct o.lucasfilm_dcp_asset_id as asset_id
      from plm.lucasfilm_dcp_asset_property_observation o
      where o.lucasfilm_dcp_property_id=p.property_id
    ) o
  ), dcp_asset_counts as materialized (
    select property_id,count(*) asset_count
    from page_dcp_retained_assets group by property_id
  ), lucasfilm_dcp_asset_counts as materialized (
    select property_id,count(*) asset_count
    from page_lucasfilm_dcp_retained_assets group by property_id
  ), dcp_asset_style as materialized (
    select a.id,a.style_guide_id from plm.dcp_asset a
  ), lucasfilm_dcp_asset_style as materialized (
    select a.id,a.style_guide_id from plm.lucasfilm_dcp_asset a
  ), dcp_property_style_ids as materialized (
    -- Resolve style guides for this page's retained assets only; never
    -- materialize the whole asset catalog (issue 2744).
    select distinct r.property_id,a.style_guide_id
    from page_dcp_retained_assets r
    join dcp_asset_style a on a.id=r.asset_id
  ), lucasfilm_dcp_property_style_ids as materialized (
    select distinct r.property_id,a.style_guide_id
    from page_lucasfilm_dcp_retained_assets r
    join lucasfilm_dcp_asset_style a on a.id=r.asset_id
  ), dcp_property_styles as materialized (
    select s.property_id,s.style_guide_id,g.folder_name
    from dcp_property_style_ids s
    left join plm.dcp_style_guide g on g.id=s.style_guide_id
  ), lucasfilm_dcp_property_styles as materialized (
    select s.property_id,s.style_guide_id,g.folder_name
    from lucasfilm_dcp_property_style_ids s
    left join plm.lucasfilm_dcp_style_guide g on g.id=s.style_guide_id
  ), dcp_style_context as materialized (
    select property_id,count(style_guide_id) style_guide_count,
      coalesce(jsonb_agg(folder_name order by folder_name)
        filter (where folder_name is not null),'[]'::jsonb) style_guide_names
    from dcp_property_styles group by property_id
  ), lucasfilm_dcp_style_context as materialized (
    select property_id,count(style_guide_id) style_guide_count,
      coalesce(jsonb_agg(folder_name order by folder_name)
        filter (where folder_name is not null),'[]'::jsonb) style_guide_names
    from lucasfilm_dcp_property_styles group by property_id
  ), dcp_property_context as materialized (
    select c.property_id,c.asset_count,
      coalesce(s.style_guide_count,0) style_guide_count,
      coalesce(s.style_guide_names,'[]'::jsonb) style_guide_names
    from dcp_asset_counts c left join dcp_style_context s using (property_id)
  ), lucasfilm_dcp_property_context as materialized (
    select c.property_id,c.asset_count,
      coalesce(s.style_guide_count,0) style_guide_count,
      coalesce(s.style_guide_names,'[]'::jsonb) style_guide_names
    from lucasfilm_dcp_asset_counts c
    left join lucasfilm_dcp_style_context s using (property_id)
  ), page_dcp_context_rows as materialized (
    select p.row_key,c.asset_count,c.style_guide_count,c.style_guide_names
    from page_dcp_properties p
    left join dcp_property_context c on c.property_id=p.property_id
    union all
    select p.row_key,c.asset_count,c.style_guide_count,c.style_guide_names
    from page_lucasfilm_dcp_properties p
    left join lucasfilm_dcp_property_context c on c.property_id=p.property_id
  ), page_dcp_context as materialized (
    select * from page_dcp_context_rows
  ), page_rights_ids as materialized (
    select o.row_key,o.source_property_id::bigint as licensed_property_id
    from ordered o where o.source_table='plm.opa_property'
    union
    select d.row_key,m.licensed_property_id
    from page_creative_decision d
    join plm.dcp_opa_property_resolution_member m on m.resolution_id=d.resolution_id
    where d.decision_state='mapped' and m.submission_source_table='plm.opa_property'
  ), page_current_rights as materialized (
    select i.row_key,i.licensed_property_id,r.region_code,r.branch_code,r.line_of_business_id,
      r.product_type_code,r.template_id,r.workflow_id,r.account_scope_sha256,
      coalesce(r.compliance_status,'unknown') as compliance_status,r.source_captured_at,
      coalesce(r.eligible_for_new_styles,false) as eligible_for_new_styles,
      coalesce(r.eligible_for_new_coldlion_entry,false) as eligible_for_new_coldlion_entry,
      coalesce(r.absent_from_newer_complete_capture,false) as absent_from_newer_complete_capture
    from page_rights_ids i left join plm.opa_property_current_compliance r
      on r.licensed_property_id=i.licensed_property_id
  ), page_rights_summary as materialized (
    select row_key,
      case when bool_and(compliance_status='compliant') then 'compliant'
        when bool_and(compliance_status='non_compliant') then 'non_compliant'
        when bool_and(compliance_status='unknown') then 'unknown'
        else 'route_specific' end as current_rights_status,
      jsonb_agg(jsonb_build_object(
        'licensed_property_id',licensed_property_id,
        'region_code',region_code,'branch_code',branch_code,'line_of_business_id',line_of_business_id,
        'product_type_code',product_type_code,'template_id',template_id,'workflow_id',workflow_id,
        'account_scope_sha256',account_scope_sha256,'compliance_status',compliance_status,
        'source_captured_at',source_captured_at,'eligible_for_new_styles',eligible_for_new_styles,
        'eligible_for_new_coldlion_entry',eligible_for_new_coldlion_entry,
        'absent_from_newer_complete_capture',absent_from_newer_complete_capture)
        order by licensed_property_id,region_code,branch_code,line_of_business_id,product_type_code,
          template_id,workflow_id,account_scope_sha256) as current_rights
    from page_current_rights group by row_key
  ), numbered as (
    select e.*,
      rights.current_rights_status,rights.current_rights,
      c.asset_count as context_asset_count,
      c.style_guide_count as context_style_guide_count,
      c.style_guide_names as context_style_guide_names,
      row_number() over (order by e.row_key collate "C") as rn
    from enriched e
    left join page_dcp_context c on c.row_key=e.row_key
    left join page_rights_summary rights on rights.row_key=e.row_key
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'row_key', n.row_key,
        'presentation_licensor_key', n.presentation_licensor_key,
        'presentation_licensor_name', case
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
               and n.presentation_licensor_key = 'disney'
            then 'Disney - Creative (DCP Vault)'
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
               and n.presentation_licensor_key in ('star-wars','lucasfilm-star-wars')
            then 'Lucasfilm / Star Wars - Creative (DCP Vault)'
          else n.presentation_licensor_name
        end,
        'source_system', n.source_system,
        'source_table', n.source_table,
        'source_property_id', n.source_property_id,
        'source_property_name', n.source_property_name,
        'display_label', coalesce(
          nullif(btrim(n.source_property_name), ''),
          n.derived_display_label,
          '[Unlabeled source ID: ' || n.source_property_id || ']'
        ),
        -- source_status explains retained studio/provenance, never current selection rights.
        'source_status', n.source_status,
        'current_rights_status',case when n.source_table='plm.opa_property'
          or n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property')
          then coalesce(n.current_rights_status,'unknown') else null end,
        'current_rights',coalesce(n.current_rights,'[]'::jsonb),
        'rights_require_exact_route',n.source_table in ('plm.opa_property','plm.dcp_property',
          'plm.lucasfilm_dcp_property','plm.twentieth_century_dcp_property'),
        'provenance_kind', n.provenance_kind,
        'latest_seen_at', n.latest_seen_at,
        'capture_marker', n.capture_marker,
        'source_purpose', n.source_purpose,
        'review_reason', n.review_reason,
        'evidence_basis', n.evidence_basis,
        'review_guidance', n.review_guidance,
        'mapping_state',case when n.source_purpose like 'Creative%'
          then coalesce(n.creative_mapping_state,'unmapped') else null end,
        'submissions',case when n.source_purpose like 'Creative%'
          then coalesce(n.submission_members,'[]'::jsonb) else '[]'::jsonb end,
        'contract_status',case when n.source_purpose not like 'Creative%' then null
          when coalesce(n.creative_mapping_state,'unmapped')='conflict' then 'conflict'
          when coalesce(n.creative_mapping_state,'unmapped')<>'mapped' then 'unknown'
          else coalesce(n.sanitized_contract_status,'unknown') end,
        'asset_count', case
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
            then coalesce(n.context_asset_count,0)
          else null end,
        'style_guide_count', case
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
            then coalesce(n.context_style_guide_count,0)
          else null end,
        'style_guide_names', case
          when n.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property')
            then coalesce(n.context_style_guide_names,'[]'::jsonb)
          else '[]'::jsonb end
      ) order by n.rn
    ) filter (where n.rn <= v_page_size), '[]'::jsonb),
    count(*)::integer,
    max(n.row_key) filter (where n.rn = v_page_size)
  into v_rows, v_fetched, v_last_key
  from numbered n;

  if v_fetched > v_page_size and v_last_key is not null then
    v_next_cursor := encode(convert_to(v_last_key, 'UTF8'), 'base64');
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$function$
;
revoke all on function api.db_data_admin_scraped_properties(p_search text, p_cursor text, p_page_size integer) from public, anon, authenticated;
grant execute on function api.db_data_admin_scraped_properties(p_search text, p_cursor text, p_page_size integer) to authenticated;
CREATE OR REPLACE FUNCTION api.db_data_admin_scraped_source_inventory(p_entity_kind text, p_search text DEFAULT NULL::text, p_cursor text DEFAULT NULL::text, p_page_size integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_entity_kind text;
  v_page_size integer;
  v_cursor_key text;
  v_rows jsonb;
  v_fetched integer := 0;
  v_last_key text;
  v_next_cursor text;
begin
  perform app.require_licensing_manager_access();

  v_entity_kind := lower(btrim(coalesce(p_entity_kind, '')));
  if v_entity_kind not in ('property', 'character', 'style_guide') then
    raise exception 'db_data_admin: invalid entity kind'
      using errcode = 'invalid_parameter_value';
  end if;

  v_page_size := least(greatest(coalesce(p_page_size, 500), 1), 1000);

  if p_cursor is not null then
    begin
      v_cursor_key := convert_from(decode(p_cursor, 'base64'), 'UTF8');
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_key is null or v_cursor_key = '' then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_entity_kind = 'property' then
    with opa_scope_latest as materialized (
      select distinct on (
        m.licensed_property_id, m.region_code, m.branch_code,
        m.line_of_business_id, m.product_type_code, m.template_id, m.workflow_id
      )
        m.licensed_property_id, m.branch_code
      from plm.opa_property_scope_membership m
      where m.approval_status = 'approved'
      order by m.licensed_property_id, m.region_code, m.branch_code,
        m.line_of_business_id, m.product_type_code, m.template_id, m.workflow_id,
        m.source_captured_at desc, m.created_at desc, m.membership_id desc
    ), opa_scope_summary as materialized (
      select licensed_property_id,
        count(distinct branch_code) as scope_count,
        min(branch_code) as studio_code
      from opa_scope_latest
      group by licensed_property_id
    ), opa_studio_summary as materialized (
      select r.licensed_property_id,
        case
          when count(*) filter (where r.resolution_status = 'ambiguous_crossover') > 0
            or count(distinct r.studio_code) filter (where r.resolution_status = 'canonical') > 1
            then 'ambiguous_crossover'
          when count(*) filter (where r.resolution_status = 'canonical') = 1 then 'canonical'
          else 'unresolved'
        end as resolution_status,
        case
          when count(*) filter (where r.resolution_status = 'ambiguous_crossover') = 0
            and count(*) filter (where r.resolution_status = 'canonical') = 1
            then min(r.studio_code) filter (where r.resolution_status = 'canonical')
        end as studio_code
      from plm.opa_property_studio_resolution r
      group by r.licensed_property_id
    ), dcp_terminal_copies as materialized (
      select distinct on (r.source_system, r.source_table, r.source_property_id)
        r.*,
        case when r.source_property_id like 'dcpvault:%'
          then r.source_property_id
          else r.source_table||'|'||r.source_system||'|'||r.source_property_id
        end as identity_key,
        case when r.creative_decision_state is not null then r.creative_decision_state
          when r.approval_status = 'approved' and mf.fingerprint <> '' then 'mapped'
          else 'unmapped' end as copy_state,
        mf.fingerprint as member_fingerprint
      from plm.dcp_opa_property_resolution r
      cross join lateral (
        select coalesce(string_agg(
          m.submission_source_system||'|'||m.submission_source_table||'|'||
            m.submission_source_id, chr(10)
          order by m.submission_source_system,m.submission_source_table,
            m.submission_source_id), '') as fingerprint
        from plm.dcp_opa_property_resolution_member m
        where m.resolution_id = r.resolution_id
      ) mf
      where r.approval_status in ('approved','rejected')
        and (r.source_property_id like 'dcpvault:%'
          or r.source_table in ('plm.dcp_property','plm.lucasfilm_dcp_property'))
      order by r.source_system,r.source_table,r.source_property_id,
        r.decision_version desc,r.approved_at desc nulls last,r.resolution_id desc
    ), dcp_identity_authority as materialized (
      select identity_key,
        count(distinct member_fingerprint) filter (where copy_state='mapped') > 1
          or count(distinct contract_asserted_studio_code)
            filter (where copy_state='mapped') > 1 as authority_conflict,
        min(contract_asserted_studio_code) filter (where copy_state='mapped')
          as contract_asserted_studio_code,
        (array_agg(resolution_id order by (copy_state='mapped') desc,
          decision_version desc,approved_at desc nulls last,resolution_id desc))[1]
          as resolution_id
      from dcp_terminal_copies
      group by identity_key
    ), dcp_current_resolution as materialized (
      select r.resolution_id,r.source_system,r.source_table,r.source_property_id,
        a.contract_asserted_studio_code,
        case when a.authority_conflict then 'conflict' else r.copy_state end
          as decision_state
      from dcp_identity_authority a
      join dcp_terminal_copies r on r.resolution_id = a.resolution_id
    ), dcp_member_count as materialized (
      select rm.resolution_id, count(*) as member_count
      from plm.dcp_opa_property_resolution_member rm
      join dcp_current_resolution r on r.resolution_id = rm.resolution_id
      group by rm.resolution_id
    ), dcp_scope_latest as materialized (
      select distinct on (
        rm.resolution_id, rm.licensed_property_id, sm.region_code, sm.branch_code,
        sm.line_of_business_id, sm.product_type_code, sm.template_id, sm.workflow_id
      )
        rm.resolution_id, sm.branch_code
      from plm.dcp_opa_property_resolution_member rm
      join dcp_current_resolution r on r.resolution_id = rm.resolution_id
      join plm.opa_property_scope_membership sm
        on sm.licensed_property_id = rm.licensed_property_id
       and sm.approval_status = 'approved'
      order by rm.resolution_id, rm.licensed_property_id, sm.region_code, sm.branch_code,
        sm.line_of_business_id, sm.product_type_code, sm.template_id, sm.workflow_id,
        sm.source_captured_at desc, sm.created_at desc, sm.membership_id desc
    ), dcp_scope_summary as materialized (
      select resolution_id,
        count(distinct branch_code) as opa_scope_count,
        min(branch_code) as opa_studio_code
      from dcp_scope_latest
      group by resolution_id
    ), pmt_ranked as (
      select p.*,
             row_number() over (
               partition by p.property_source_id
               order by c.completed_at desc nulls last,
                        p.imported_at desc,
                        p.capture_id::text desc
             ) as capture_rank
      from plm.pmt_property p
      join plm.pmt_capture c on c.capture_id = p.capture_id
      where c.status = 'complete'
        and c.capture_kind = 'full'
    ), nbcu_ranked as (
      select p.*,
             row_number() over (
               partition by p.property_key
               order by c.source_captured_at desc,
                        p.source_captured_at desc,
                        p.capture_id::text desc
             ) as capture_rank
      from plm.nbcu_property p
      join plm.nbcu_capture c on c.id = p.capture_id
      where c.status = 'complete'
    ), wildbrain_ranked as (
      select e.*,
        row_number() over (
          partition by e.era_source_id
          order by c.source_captured_at desc, e.capture_id::text desc
        ) as capture_rank
      from plm.wildbrain_era e
      join plm.wildbrain_capture c on c.id = e.capture_id
      where c.status = 'complete'
    ), sega_submission_ranked as (
      select p.*,
        row_number() over (
          partition by p.property_source_id
          order by c.source_captured_at desc, p.submission_capture_id::text desc
        ) as capture_rank
      from plm.sega_submission_property p
      join plm.sega_submission_capture c on c.id = p.submission_capture_id
      where c.status = 'complete'
    ), sega_ranked as (
      select p.*,
        row_number() over (
          partition by p.property_source_id
          order by c.source_captured_at desc, p.capture_id::text desc
        ) as capture_rank
      from plm.sega_property p
      join plm.sega_capture c on c.id = p.capture_id
      where c.status = 'complete'
    ), pmt_trackerplus_latest as (
      select c.id
      from plm.pmt_trackerplus_submission_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), coke_property_latest as (
      select c.id
      from plm.coke_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), wwe_submission_latest as (
      select c.id
      from plm.wwe_submission_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), wwe_creative_latest as (
      select c.id
      from plm.wwe_creative_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), peanuts_property_latest as (
      select c.id
      from plm.peanuts_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), sesame_property_latest as (
      select c.id
      from plm.sesame_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), source_rows as not materialized (
      select
        case
          when s.scope_status = 'direct_lucasfilm' then 'lucasfilm-star-wars-opa'
          when s.scope_status = 'direct_disney' and o.resolution_status = 'canonical'
            and o.studio_code in ('disney', 'marvel', 'pixar') then
            case o.studio_code when 'disney' then 'disney-opa'
              when 'marvel' then 'marvel-opa' when 'pixar' then 'pixar-opa' end
          when s.scope_status = 'direct_disney' then 'disney-opa'
          when s.scope_status = 'scope_conflict' or o.resolution_status = 'ambiguous_crossover'
            then 'opa-scope-conflict'
          when s.scope_status is null and o.resolution_status = 'canonical' then
            case o.studio_code when 'disney' then 'disney-opa'
              when 'marvel' then 'marvel-opa'
              when 'lucasfilm' then 'lucasfilm-star-wars-opa'
              when 'pixar' then 'pixar-opa' end
          else 'disney-opa-unresolved'
        end::text as licensor_key,
        case
          when s.scope_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Submissions (OPA)'
          when s.scope_status = 'direct_disney' and o.resolution_status = 'canonical'
            and o.studio_code = 'marvel' then 'Marvel - Submissions (OPA)'
          when s.scope_status = 'direct_disney' and o.resolution_status = 'canonical'
            and o.studio_code = 'pixar' then 'Disney (Pixar) - Submissions (OPA)'
          when s.scope_status = 'direct_disney' then 'Disney - Submissions (OPA)'
          when s.scope_status = 'scope_conflict' or o.resolution_status = 'ambiguous_crossover'
            then 'OPA - Submissions (scope conflict)'
          when s.scope_status is null and o.resolution_status = 'canonical' then
            case o.studio_code when 'disney' then 'Disney - Submissions (OPA)'
              when 'marvel' then 'Marvel - Submissions (OPA)'
              when 'lucasfilm' then 'Lucasfilm / Star Wars - Submissions (OPA)'
              when 'pixar' then 'Disney (Pixar) - Submissions (OPA)' end
          else 'OPA - Submissions (unresolved)'
        end::text as licensor_name,
        'Submissions'::text as source_purpose,
        'disney_opa'::text as source_system,
        'plm.opa_property'::text as source_table,
        p.licensed_property_id::text as source_id,
        p.property_name::text as source_label,
        coalesce(s.scope_status, o.resolution_status, 'unresolved')::text as source_status,
        p.last_seen_at::timestamptz as latest_seen_at,
        null::text as capture_marker
      from plm.opa_property p
      left join opa_scope_summary s0
        on s0.licensed_property_id = p.licensed_property_id
      left join lateral (
        select case
          when s0.scope_count > 1 then 'scope_conflict'
          when s0.studio_code = 'lucasfilm' then 'direct_lucasfilm'
          when s0.studio_code = 'disney' then 'direct_disney'
        end as scope_status
      ) s on true
      left join opa_studio_summary o
        on o.licensed_property_id = p.licensed_property_id

      union all
      select
        case when x.authority_status = 'direct_disney' then 'disney'
          when x.authority_status = 'direct_marvel' then 'marvel'
          when x.authority_status = 'direct_lucasfilm' then 'lucasfilm-star-wars'
          when x.authority_status = 'direct_pixar' then 'pixar'
          when x.authority_status = 'authority_conflict' then 'dcp-authority-conflict'
          when x.authority_status = 'contract_opa_conflict' then 'dcp-contract-opa-conflict'
          when x.authority_status = 'opa_scope_conflict' then 'dcp-opa-scope-conflict'
          else 'dcp-authority-unresolved' end,
        case when x.authority_status = 'direct_disney' then 'Disney - Creative (DCP Vault)'
          when x.authority_status = 'direct_marvel' then 'DCP Vault - Creative (authoritative Marvel scope)'
          when x.authority_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Creative (DCP Vault)'
          when x.authority_status = 'direct_pixar' then 'Disney (Pixar) - Creative (DCP Vault)'
          when x.authority_status = 'authority_conflict' then 'DCP Creative - identity authority conflict'
          when x.authority_status = 'contract_opa_conflict' then 'DCP Creative - contract/OPA conflict'
          when x.authority_status = 'opa_scope_conflict' then 'DCP Creative - mapped OPA scope conflict'
          else 'DCP Creative - unresolved authority' end,
        'Creative',
        p.source_system, 'plm.dcp_property', p.source_id, p.display_name,
        coalesce(x.authority_status, 'unresolved'),
        null::timestamptz,
        p.last_seen_metadata_run_id::text
      from plm.dcp_property p
      left join dcp_current_resolution r
        on r.source_property_id = p.source_id
       and (p.source_id like 'dcpvault:%'
         or (r.source_system = p.source_system and r.source_table = 'plm.dcp_property'))
      left join dcp_member_count mc on mc.resolution_id = r.resolution_id
      left join dcp_scope_summary o on o.resolution_id = r.resolution_id
      left join lateral (
        select case
          when r.decision_state = 'conflict' then 'authority_conflict'
          when r.decision_state is distinct from 'mapped' then null
          when o.opa_scope_count > 1 then 'opa_scope_conflict'
          when r.contract_asserted_studio_code is not null
            and o.opa_studio_code is not null
            and r.contract_asserted_studio_code <> o.opa_studio_code
            and not (
              r.contract_asserted_studio_code = 'marvel'
              and o.opa_studio_code = 'disney'
            )
            then 'contract_opa_conflict'
          when r.contract_asserted_studio_code is not null and mc.member_count > 0
            then 'direct_' || r.contract_asserted_studio_code
          when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
        end as authority_status
      ) x on true

      union all
      select
        'dcp-vault-non-authoritative-marvel-tag',
        'DCP Vault - Creative (non-authoritative Marvel tag)',
        'Creative',
        p.source_system, 'plm.marvel_dcp_property', p.source_id, p.display_name,
        'non_authoritative',
        null::timestamptz,
        p.last_seen_metadata_run_id::text
      from plm.marvel_dcp_property p

      union all
      select
        case when x.authority_status = 'direct_disney' then 'disney'
          when x.authority_status = 'direct_marvel' then 'marvel'
          when x.authority_status = 'direct_lucasfilm' then 'lucasfilm-star-wars'
          when x.authority_status = 'direct_pixar' then 'pixar'
          when x.authority_status = 'authority_conflict' then 'dcp-authority-conflict'
          when x.authority_status = 'contract_opa_conflict' then 'dcp-contract-opa-conflict'
          when x.authority_status = 'opa_scope_conflict' then 'dcp-opa-scope-conflict'
          else 'dcp-authority-unresolved' end,
        case when x.authority_status = 'direct_disney' then 'Disney - Creative (DCP Vault)'
          when x.authority_status = 'direct_marvel' then 'DCP Vault - Creative (authoritative Marvel scope)'
          when x.authority_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Creative (DCP Vault)'
          when x.authority_status = 'direct_pixar' then 'Disney (Pixar) - Creative (DCP Vault)'
          when x.authority_status = 'authority_conflict' then 'DCP Creative - identity authority conflict'
          when x.authority_status = 'contract_opa_conflict' then 'DCP Creative - contract/OPA conflict'
          when x.authority_status = 'opa_scope_conflict' then 'DCP Creative - mapped OPA scope conflict'
          else 'DCP Creative - unresolved authority' end,
        'Creative',
        p.source_system, 'plm.lucasfilm_dcp_property', p.source_id, p.display_name,
        coalesce(x.authority_status, 'unresolved'),
        null::timestamptz,
        p.last_seen_metadata_run_id::text
      from plm.lucasfilm_dcp_property p
      left join dcp_current_resolution r
        on r.source_property_id = p.source_id
       and (p.source_id like 'dcpvault:%'
         or (r.source_system = p.source_system and r.source_table = 'plm.lucasfilm_dcp_property'))
      left join dcp_member_count mc on mc.resolution_id = r.resolution_id
      left join dcp_scope_summary o on o.resolution_id = r.resolution_id
      left join lateral (
        select case
          when r.decision_state = 'conflict' then 'authority_conflict'
          when r.decision_state is distinct from 'mapped' then null
          when o.opa_scope_count > 1 then 'opa_scope_conflict'
          when r.contract_asserted_studio_code is not null
            and o.opa_studio_code is not null
            and r.contract_asserted_studio_code <> o.opa_studio_code
            and not (r.contract_asserted_studio_code = 'marvel' and o.opa_studio_code = 'disney')
            then 'contract_opa_conflict'
          when r.contract_asserted_studio_code is not null and mc.member_count > 0
            then 'direct_' || r.contract_asserted_studio_code
          when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
        end as authority_status
      ) x on true
      -- #3947: hide a Lucasfilm row whose exact source_id already exists as a
      -- Disney dcp_property identity. The Disney arm's surviving row is kept;
      -- unique Lucasfilm identities have no Disney twin and stay visible.
      -- Display-level only: canonical licensor ownership is not inferred or
      -- changed, and every DCP resolution / member association keyed on the
      -- shared dcpvault source_id remains reachable through the Disney row.
      where not exists (
        select 1 from plm.dcp_property d
        where d.source_system = 'disney_dcpvault'
          and d.source_id = p.source_id
      )
      -- #4081: also hide a Lucasfilm row whose source_id equals a Disney
      -- identity, or an earlier-sorting Lucasfilm spelling, once runs of '-'
      -- are collapsed (DCP Vault publishes some Star Wars titles under two or
      -- three hyphenations of the same slug).
        and not exists (
        select 1 from plm.dcp_property d
        where d.source_system = 'disney_dcpvault'
          and regexp_replace(d.source_id, '-+', '-', 'g')
            = regexp_replace(p.source_id, '-+', '-', 'g')
      )
        and not exists (
        select 1 from plm.lucasfilm_dcp_property q
        where regexp_replace(q.source_id, '-+', '-', 'g')
            = regexp_replace(p.source_id, '-+', '-', 'g')
          and q.source_id collate "C" < p.source_id collate "C"
      )

      union all
      select
        'marvel-asgard-creative',
        'Marvel - Creative (ASGARD)',
        'Creative',
        'marvel_asgard',
        'plm.marvel_asgard_style_guide',
        g.source_identity_key,
        g.exact_label,
        case when g.is_actively_observed then 'active' else 'retained' end,
        null::timestamptz,
        g.last_seen_capture_key::text
      from plm.marvel_asgard_style_guide g

      union all
      select
        case when p.source_id not like 'dcpvault:%' then '20th-century'
          when x.authority_status = 'direct_disney' then 'disney'
          when x.authority_status = 'direct_marvel' then 'marvel'
          when x.authority_status = 'direct_lucasfilm' then 'lucasfilm-star-wars'
          when x.authority_status = 'direct_pixar' then 'pixar'
          when x.authority_status = 'authority_conflict' then 'dcp-authority-conflict'
          when x.authority_status = 'contract_opa_conflict' then 'dcp-contract-opa-conflict'
          when x.authority_status = 'opa_scope_conflict' then 'dcp-opa-scope-conflict'
          else 'dcp-authority-unresolved' end,
        case when p.source_id not like 'dcpvault:%' then '20th Century - Creative (DCP Vault)'
          when x.authority_status = 'direct_disney' then 'Disney - Creative (DCP Vault)'
          when x.authority_status = 'direct_marvel' then 'DCP Vault - Creative (authoritative Marvel scope)'
          when x.authority_status = 'direct_lucasfilm' then 'Lucasfilm / Star Wars - Creative (DCP Vault)'
          when x.authority_status = 'direct_pixar' then 'Disney (Pixar) - Creative (DCP Vault)'
          when x.authority_status = 'authority_conflict' then 'DCP Creative - identity authority conflict'
          when x.authority_status = 'contract_opa_conflict' then 'DCP Creative - contract/OPA conflict'
          when x.authority_status = 'opa_scope_conflict' then 'DCP Creative - mapped OPA scope conflict'
          else 'DCP Creative - unresolved authority' end,
        'Creative',
        p.source_system, 'plm.twentieth_century_dcp_property', p.source_id, p.display_name,
        case when p.source_id like 'dcpvault:%' then coalesce(x.authority_status, 'unresolved') end,
        null::timestamptz,
        p.last_seen_metadata_run_id::text
      from plm.twentieth_century_dcp_property p
      left join dcp_current_resolution r
        on r.source_property_id = p.source_id
       and (p.source_id like 'dcpvault:%'
         or (r.source_system = p.source_system and r.source_table = 'plm.twentieth_century_dcp_property'))
      left join dcp_member_count mc on mc.resolution_id = r.resolution_id
      left join dcp_scope_summary o on o.resolution_id = r.resolution_id
      left join lateral (
        select case
          when r.decision_state = 'conflict' then 'authority_conflict'
          when r.decision_state is distinct from 'mapped' then null
          when o.opa_scope_count > 1 then 'opa_scope_conflict'
          when r.contract_asserted_studio_code is not null
            and o.opa_studio_code is not null
            and r.contract_asserted_studio_code <> o.opa_studio_code
            and not (
              r.contract_asserted_studio_code = 'marvel'
              and o.opa_studio_code = 'disney'
            )
            then 'contract_opa_conflict'
          when r.contract_asserted_studio_code is not null and mc.member_count > 0
            then 'direct_' || r.contract_asserted_studio_code
          when o.opa_studio_code is not null then 'direct_' || o.opa_studio_code
        end as authority_status
      ) x on true

      union all
      select 'paramount', 'Paramount - Creative (Creative Library)', 'Creative',
             'paramount_creative_library',
             'plm.pmt_property', p.property_source_id::text, p.property_name,
             case when p.is_licensed_selection then 'licensed_selection'
                  else 'asset_metadata' end,
             p.imported_at, p.capture_id::text
      from pmt_ranked p
      where p.capture_rank = 1

      union all
      select 'warner-bros',
             case when p.source_namespace = 'warner_product_catalogue'
               then 'Warner Bros. - Submissions (STARLABS Product catalogue)'
               else 'Warner Bros. - Creative (STARLABS)' end,
             case when p.source_namespace = 'warner_product_catalogue'
               then 'Submissions' else 'Creative' end,
             'warner_starlabs',
             'plm.wb_property',
             p.source_namespace || ':' || p.identity_method || ':' ||
               coalesce(p.source_id, p.fallback_key),
             p.label, null,
             p.last_seen_at, p.capture_id::text
      from plm.wb_property p
      -- #3947: hide a natural_key_fallback row when a source_id row with the same
      -- label exists in the same namespace. The fallback rows' only file links
      -- point at the 'STAR LABS' placeholder and none share a file with their
      -- source_id twin, so the fallback is a duplicate vocabulary entry.
      -- #4081: the AND below binds tighter than the OR, so this reads
      -- (source_id row AND not a catalogue twin) OR (fallback-twin rule). The
      -- second disjunct never admits a source_id row: such a row is always its
      -- own same-namespace, same-label source_id match (label is NOT NULL;
      -- table check). So a source_id row is
      -- visible exactly when it is not a catalogue twin, and a fallback row
      -- keeps the #3947 rule unchanged.
      where p.identity_method <> 'natural_key_fallback'
        -- #4081: hide the product-catalogue copy of a title whose art-assets
        -- source_id row exists; the art-assets (Creative) row survives.
        and not (p.source_namespace = 'warner_product_catalogue'
          and exists (
            select 1 from plm.wb_property a
            where a.source_namespace = 'warner_art_assets'
              and a.identity_method = 'source_id'
              and a.source_id = p.source_id
          ))
         or not exists (
           select 1 from plm.wb_property t
           where t.source_namespace = p.source_namespace
             and t.identity_method = 'source_id'
             and t.label = p.label
         )

      union all
      select 'nbcuniversal',
             case when p.source_kind in ('property', 'franchise_asset')
               then 'NBCUniversal - Submissions (Product Submissions picker)'
               else 'NBCUniversal - Creative (Creative Asset Factory)' end,
             case when p.source_kind in ('property', 'franchise_asset')
               then 'Submissions' else 'Creative' end,
             'nbcu_creative_asset_factory',
             'plm.nbcu_property', p.property_key, p.property_label, null,
             p.source_captured_at, p.capture_id::text
      from nbcu_ranked p
      where p.capture_rank = 1

      union all
      select 'strawberry-shortcake-creative', 'Strawberry Shortcake - Creative', 'Creative',
             'wildbrain_tenovos', 'plm.wildbrain_era', e.era_source_id,
             e.era_label, case when e.is_root then 'root' else 'descendant' end,
             null::timestamptz, e.capture_id::text
      from wildbrain_ranked e
      where e.capture_rank = 1

      union all
      select 'sega-submissions', 'Sega - Submissions', 'Submissions',
             'sega_product_approval',
             'plm.sega_submission_property', p.property_source_id,
             p.property_label, 'complete',
             null::timestamptz, p.submission_capture_id::text
      from sega_submission_ranked p
      where p.capture_rank = 1

      union all
      select 'sega-creative', 'Sega - Creative', 'Creative',
             'sega_dsi', 'plm.sega_property', p.property_source_id,
             p.property_label, p.source_status,
             null::timestamptz, p.capture_id::text
      from sega_ranked p
      where p.capture_rank = 1

      union all
      select 'paramount-submissions', 'Paramount - Submissions (TrackerPlus)', 'Submissions',
             'paramount_trackerplus', 'plm.pmt_trackerplus_submission_property',
             p.property_local_key, p.exact_label, 'complete',
             null::timestamptz, p.capture_id::text
      from plm.pmt_trackerplus_submission_property p
      join pmt_trackerplus_latest c on c.id = p.capture_id

      union all
      select 'coca-cola-creative', 'Coca-Cola - Creative (Asset Library Property choices)',
             'Creative',
             'coke_brandcomply', 'plm.coke_asset_property_option', o.option_key,
             o.exact_label, o.classification_status,
             null::timestamptz, o.capture_id::text
      from (
        select distinct on (opt.option_key)
               opt.option_key, opt.exact_label, opt.classification_status, opt.capture_id
        from plm.coke_asset_property_option opt
        join coke_property_latest c on c.id = opt.capture_id
        order by opt.option_key, opt.ordinal, opt.exact_label
      ) o

      union all
      select 'wwe-submissions', 'WWE - Submissions', 'Submissions',
             'wwe_submissions',
             'plm.wwe_property', p.property_source_id, p.property_label,
             case when p.parent_property_source_id is null then 'root' else 'descendant' end,
             null::timestamptz, p.capture_id::text
      from plm.wwe_property p
      join wwe_submission_latest c on c.id = p.capture_id
      union all
      select 'coca-cola-submissions', 'Coca-Cola - Submissions (BrandComply brands)',
             'Submissions',
             'coke_brandcomply', 'plm.coke_approval_vocabulary_value', b.value_key,
             b.exact_label, null,
             null::timestamptz, b.capture_id::text
      from (
        select distinct on (v.value_key)
               v.value_key, coalesce(cv.exact_label, v.value_key) as exact_label, v.capture_id
        from plm.coke_approval_vocabulary_value v
        join coke_property_latest c on c.id = v.capture_id
        left join plm.coke_vocabulary_value cv
          on cv.capture_id = v.capture_id
         and cv.vocabulary_kind = v.vocabulary_kind
         and cv.value_key = v.value_key
        where v.vocabulary_kind = 'brand'
        order by v.value_key
      ) b

      union all
      select 'wwe-creative', 'WWE - Creative (Frontify)', 'Creative',
             'wwe_creative', 'plm.wwe_creative_brand', b.brand_source_id,
             b.brand_label, null,
             null::timestamptz, b.capture_id::text
      from plm.wwe_creative_brand b
      join wwe_creative_latest c on c.id = b.capture_id

      union all
      select 'peanuts-creative', 'Peanuts - Creative (Tenovos Art Program)', 'Creative',
             'peanuts_tenovos', 'source.tenovos_art_program',
             a.source_value_id,
             a.value_label, null,
             null::timestamptz, a.capture_id::text
      from plm.peanuts_art_program a
      join peanuts_property_latest c on c.id = a.capture_id
      -- Rows without a Tenovos id have no ledger identity; left out on purpose.
      where a.source_value_id is not null

      union all
      select 'sesame-creative', 'Sesame Workshop - Creative (NetX)', 'Creative',
             'sesame_thelettera_netx', 'source.thelettera_brand',
             'label:' || b.value_label, b.value_label, b.field_generation,
             null::timestamptz, b.capture_id::text
      from (
        -- #3947: one row per value_key, preferring field_generation current.
        -- Legacy rows are the lowercase free-text twin of the current curated
        -- spelling; per-file links exist only for current. Mapping decisions
        -- keyed on 'label:<lowercase>' were checked before hiding: none exist.
        select distinct on (sb.value_key)
               sb.value_key, sb.value_label, sb.field_generation, sb.capture_id
        from plm.sesame_brand sb
        join sesame_property_latest c on c.id = sb.capture_id
        order by sb.value_key, (sb.field_generation = 'current') desc, sb.value_label
      ) b

      union all
      select 'sesame-submissions', 'Sesame Workshop - Submissions (MediaBox)', 'Submissions',
             'sesame_mediabox', 'plm.sesame_submission_property_option', o.option_key,
             o.exact_label, null,
             o.source_captured_at, null::text
      from plm.sesame_submission_property_option o

      union all
      select 'wildbrain-submissions', 'Strawberry Shortcake - Submissions (MediaBox)', 'Submissions',
             'wildbrain_mediabox', 'plm.wildbrain_submission_property_option', o.option_key,
             o.exact_label, null,
             o.source_captured_at, null::text
      from plm.wildbrain_submission_property_option o

      union all
      select 'peanuts-submissions', 'Peanuts - Submissions (owner-entered)', 'Submissions',
             'peanuts_owner_manual', 'plm.peanuts_submission_property_option', o.option_key,
             o.exact_label, null,
             o.source_captured_at, null::text
      from plm.peanuts_submission_property_option o
    ), excluded_identity as materialized (
      -- #3545: identities whose page decision is 'excluded', computed ONCE per call
      -- with exactly the identity and copy rules of page_creative_decision below:
      -- a dcpvault:% id is one identity across source systems, otherwise the exact
      -- copy is the identity; the newest approved/rejected decision per retained
      -- copy counts; any mapped copy wins; otherwise the newest copy decides. One
      -- pass over the ledger (served by identity_version_key for the per-copy
      -- ordering), instead of a correlated probe per Creative row.
      select g.identity_key
      from (
        select
          case when c.source_property_id like 'dcpvault:%'
               then c.source_property_id
               else c.source_table||'|'||c.source_system||'|'||c.source_property_id
          end as identity_key,
          c.copy_state, c.decision_version, c.approved_at, c.resolution_id
        from (
          select distinct on (t.source_system, t.source_table, t.source_property_id)
            t.source_system, t.source_table, t.source_property_id,
            t.decision_version, t.approved_at, t.resolution_id,
            (case
              when t.creative_decision_state is not null then t.creative_decision_state
              when t.approval_status = 'approved' and exists (
                select 1 from plm.dcp_opa_property_resolution_member m
                where m.resolution_id = t.resolution_id) then 'mapped'
              else 'unmapped'
            end)::text as copy_state
          from plm.dcp_opa_property_resolution t
          where t.approval_status in ('approved','rejected')
          order by t.source_system, t.source_table, t.source_property_id,
            t.decision_version desc, t.approved_at desc nulls last, t.resolution_id desc
        ) c
      ) g
      group by g.identity_key
      having count(*) filter (where g.copy_state = 'mapped') = 0
         and (array_agg(g.copy_state order by g.decision_version desc,
                g.approved_at desc nulls last, g.resolution_id desc))[1] = 'excluded'
    ), keyed as (
      select
        jsonb_build_array(
          'property', s.licensor_key, s.source_system, s.source_table, s.source_id
        )::text as row_key,
        s.*,
        case
          when s.source_system = 'disney_dcpvault' then 'disney'
          when s.source_system = 'marvel_dcpvault' then 'marvel'
          when s.source_system = 'lucasfilm_dcpvault' then 'lucasfilm-star-wars'
          when s.source_system = 'twentieth_century_dcpvault' then '20th-century'
          when s.licensor_key in ('disney', 'disney-opa') then 'disney'
          when s.licensor_key in ('marvel', 'marvel-opa', 'marvel-asgard-creative') then 'marvel'
          when s.licensor_key in ('pixar', 'pixar-opa') then 'disney'
          when s.licensor_key in ('lucasfilm-star-wars', 'lucasfilm-star-wars-opa') then 'lucasfilm-star-wars'
          when s.licensor_key = '20th-century' then '20th-century'
          when s.licensor_key = 'warner-bros' then 'warner-bros'
          when s.licensor_key = 'nbcuniversal' then 'nbcuniversal'
          when s.licensor_key in ('paramount', 'paramount-submissions') then 'paramount'
          when s.licensor_key in ('strawberry-shortcake-creative', 'wildbrain-submissions') then 'strawberry-shortcake'
          when s.licensor_key in ('sega-creative', 'sega-submissions') then 'sega'
          when s.licensor_key in ('coca-cola-creative', 'coca-cola-submissions') then 'coca-cola'
          when s.licensor_key in ('peanuts-creative', 'peanuts-submissions') then 'peanuts'
          when s.licensor_key in ('sesame-creative', 'sesame-submissions') then 'sesame-workshop'
          when s.licensor_key in ('wwe-creative', 'wwe-submissions') then 'wwe'
          else 'unresolved'
        end::text as licensor_group_key,
        case
          when s.source_system = 'disney_dcpvault' then 'Disney'
          when s.source_system = 'marvel_dcpvault' then 'Marvel'
          when s.source_system = 'lucasfilm_dcpvault' then 'Lucasfilm / Star Wars'
          when s.source_system = 'twentieth_century_dcpvault' then '20th Century'
          when s.licensor_key in ('disney', 'disney-opa') then 'Disney'
          when s.licensor_key in ('marvel', 'marvel-opa', 'marvel-asgard-creative') then 'Marvel'
          when s.licensor_key in ('pixar', 'pixar-opa') then 'Disney'
          when s.licensor_key in ('lucasfilm-star-wars', 'lucasfilm-star-wars-opa') then 'Lucasfilm / Star Wars'
          when s.licensor_key = '20th-century' then '20th Century'
          when s.licensor_key = 'warner-bros' then 'Warner Bros.'
          when s.licensor_key = 'nbcuniversal' then 'NBCUniversal'
          when s.licensor_key in ('paramount', 'paramount-submissions') then 'Paramount'
          when s.licensor_key in ('strawberry-shortcake-creative', 'wildbrain-submissions') then 'Strawberry Shortcake'
          when s.licensor_key in ('sega-creative', 'sega-submissions') then 'Sega'
          when s.licensor_key in ('coca-cola-creative', 'coca-cola-submissions') then 'Coca-Cola'
          when s.licensor_key in ('peanuts-creative', 'peanuts-submissions') then 'Peanuts'
          when s.licensor_key in ('sesame-creative', 'sesame-submissions') then 'Sesame Workshop'
          when s.licensor_key in ('wwe-creative', 'wwe-submissions') then 'WWE'
          else 'Licensor not yet determined'
        end::text as licensor_group_name,
        coalesce(
          nullif(btrim(s.source_label), ''),
          nullif(btrim(regexp_replace(
            regexp_replace(s.source_id, '^.*/', ''), '[-_]+', ' ', 'g'
          )), '')
        ) as display_label
      from source_rows s
    ), filtered as (
      select k.*
      from keyed k
      where (
        p_search is null
        or k.licensor_name ilike '%' || p_search || '%'
        or k.source_system ilike '%' || p_search || '%'
        or k.source_id ilike '%' || p_search || '%'
        or k.display_label ilike '%' || p_search || '%'
      )
        and (p_cursor is null or k.row_key collate "C" > v_cursor_key collate "C")
        -- #3545: a Creative identity whose page decision is the owner's
        -- 'excluded' (do-not-ingest) decision is not a POP Property. It is omitted
        -- before paging; the source row itself is kept. See excluded_identity.
        and not (k.source_purpose = 'Creative'
          and (case when k.source_id like 'dcpvault:%' then k.source_id
                    else k.source_table||'|'||k.source_system||'|'||k.source_id end)
              in (select x.identity_key from excluded_identity x))
    ), ordered as materialized (
      select f.*
      from filtered f
      order by f.row_key collate "C"
      limit v_page_size + 1
    ), page_creative_decision as materialized (
      -- One stable DCP source id is the business Creative identity. Every retained
      -- source-system/table copy of it is provenance, not a separate business fact.
      -- Non-DCP sources keep their exact copy key because bare integer source ids
      -- collide between licensors.
      select o.row_key, r.decision_state
      from ordered o
      cross join lateral (
        select case when o.source_id like 'dcpvault:%'
                    then o.source_id
                    else o.source_table||'|'||o.source_system||'|'||o.source_id
               end as identity_key
      ) k
      left join lateral (
        select
          (case
            when g.copy_count = 0 then null
            when g.mapped_fingerprints > 1 then 'conflict'
            when g.mapped_copies > 0 then 'mapped'
            else g.newest_state
          end)::text as decision_state
        from (
          select
            count(*) as copy_count,
            count(*) filter (where c.copy_state='mapped') as mapped_copies,
            count(distinct c.member_fingerprint)
              filter (where c.copy_state='mapped') as mapped_fingerprints,
            (array_agg(c.copy_state order by c.decision_version desc,
               c.approved_at desc nulls last, c.resolution_id desc))[1]
               as newest_state
          from (
            select distinct on (t.source_system, t.source_table)
              t.resolution_id, t.decision_version, t.approved_at,
              (case
                when t.creative_decision_state is not null
                  then t.creative_decision_state
                when t.approval_status='approved' and mf.fingerprint <> ''
                  then 'mapped'
                else 'unmapped'
              end)::text as copy_state,
              mf.fingerprint as member_fingerprint
            from plm.dcp_opa_property_resolution t
            cross join lateral (
              select coalesce(string_agg(
                m.submission_source_system||'|'||m.submission_source_table||'|'||
                  m.submission_source_id, chr(10)
                order by m.submission_source_system, m.submission_source_table,
                  m.submission_source_id), '') as fingerprint
              from plm.dcp_opa_property_resolution_member m
              where m.resolution_id = t.resolution_id
            ) mf
            where t.approval_status in ('approved','rejected')
              and case when k.identity_key like 'dcpvault:%'
                       then t.source_property_id = k.identity_key
                       else t.source_system = o.source_system
                        and t.source_table = o.source_table
                        and t.source_property_id = o.source_id
                  end
            order by t.source_system, t.source_table, t.decision_version desc,
              t.approved_at desc nulls last, t.resolution_id desc
          ) c
        ) g
      ) r on true
    ), current_copy as materialized (
      -- The newest approved/rejected decision for every retained source copy.
      -- Same copy and identity rules as page_creative_decision above.
      select distinct on (t.source_system, t.source_table, t.source_property_id)
        t.resolution_id,
        case when t.source_property_id like 'dcpvault:%'
             then t.source_property_id
             else t.source_table||'|'||t.source_system||'|'||t.source_property_id
        end as identity_key,
        (case
          when t.creative_decision_state is not null then t.creative_decision_state
          when t.approval_status='approved' and mf.fingerprint <> '' then 'mapped'
          else 'unmapped'
        end)::text as copy_state,
        mf.fingerprint as member_fingerprint
      from plm.dcp_opa_property_resolution t
      cross join lateral (
        select coalesce(string_agg(
          m.submission_source_system||'|'||m.submission_source_table||'|'||
            m.submission_source_id, chr(10)
          order by m.submission_source_system, m.submission_source_table,
            m.submission_source_id), '') as fingerprint
        from plm.dcp_opa_property_resolution_member m
        where m.resolution_id = t.resolution_id
      ) mf
      where t.approval_status in ('approved','rejected')
      order by t.source_system, t.source_table, t.source_property_id,
        t.decision_version desc, t.approved_at desc nulls last, t.resolution_id desc
    ), mapped_member as materialized (
      -- Members of the winning mapped decision of every Creative identity whose
      -- decision state is exactly 'mapped' (never conflict).
      select distinct c.identity_key,
        m.submission_source_system, m.submission_source_table, m.submission_source_id
      from current_copy c
      join plm.dcp_opa_property_resolution_member m on m.resolution_id = c.resolution_id
      where c.copy_state = 'mapped'
        and c.identity_key in (
          select cc.identity_key
          from current_copy cc
          group by cc.identity_key
          having count(*) filter (where cc.copy_state='mapped') > 0
             and count(distinct cc.member_fingerprint)
               filter (where cc.copy_state='mapped') = 1
        )
    ), page_identity as materialized (
      select o.row_key, o.source_purpose, o.source_table, o.source_id,
        case when o.source_id like 'dcpvault:%'
             then o.source_id
             else o.source_table||'|'||o.source_system||'|'||o.source_id
        end as identity_key
      from ordered o
    ), page_submissions as materialized (
      -- Creative rows: the Submissions members of the winning mapped decision.
      select x.row_key,
        jsonb_agg(jsonb_build_object(
          'source_system', x.submission_source_system,
          'source_table', x.submission_source_table,
          'source_id', x.submission_source_id,
          'display_label', x.display_label
        ) order by x.display_label, x.submission_source_system,
          x.submission_source_table, x.submission_source_id) as submissions
      from (
        select p.row_key, mm.submission_source_system, mm.submission_source_table,
          mm.submission_source_id,
          coalesce((array_agg(k.display_label
            order by (k.source_system = mm.submission_source_system) desc nulls last,
              k.row_key collate "C"))[1], mm.submission_source_id) as display_label
        from page_identity p
        join page_creative_decision d
          on d.row_key = p.row_key and d.decision_state = 'mapped'
        join mapped_member mm on mm.identity_key = p.identity_key
        left join keyed k
          on k.source_table = mm.submission_source_table
         and k.source_id = mm.submission_source_id
        where p.source_purpose = 'Creative'
        group by p.row_key, mm.submission_source_system, mm.submission_source_table,
          mm.submission_source_id
      ) x
      group by x.row_key
    ), page_mapped_creative as materialized (
      -- Submissions rows: one entry per Creative identity mapped to this row.
      select x.row_key,
        jsonb_agg(jsonb_build_object(
          'source_system', x.source_system,
          'source_table', x.source_table,
          'source_id', x.source_id,
          'display_label', x.display_label
        ) order by x.display_label, x.source_system, x.source_table, x.source_id)
          as mapped_creative
      from (
        select distinct on (p.row_key, mm.identity_key)
          p.row_key, k.source_system, k.source_table, k.source_id, k.display_label
        from page_identity p
        join mapped_member mm
          on mm.submission_source_table = p.source_table
         and mm.submission_source_id = p.source_id
        join keyed k
          on k.source_purpose = 'Creative'
         and case when k.source_id like 'dcpvault:%'
                  then k.source_id
                  else k.source_table||'|'||k.source_system||'|'||k.source_id
             end = mm.identity_key
        where p.source_purpose = 'Submissions'
        order by p.row_key, mm.identity_key, k.row_key collate "C"
      ) x
      group by x.row_key
    ), numbered as (
      select o.*,
        d.decision_state,
        ps.submissions,
        pc.mapped_creative,
        row_number() over (order by o.row_key collate "C") as rn
      from ordered o
      left join page_creative_decision d on d.row_key = o.row_key
      left join page_submissions ps on ps.row_key = o.row_key
      left join page_mapped_creative pc on pc.row_key = o.row_key
    )
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'row_key', n.row_key,
          'entity_kind', 'property',
          'licensor_key', n.licensor_key,
          'licensor_name', n.licensor_name,
          'licensor_group_key', n.licensor_group_key,
          'licensor_group_name', n.licensor_group_name,
          'source_purpose', n.source_purpose,
          'display_label', n.display_label,
          'source_system', n.source_system,
          'source_table', n.source_table,
          'source_id', n.source_id,
          'source_status', n.source_status,
          'latest_seen_at', n.latest_seen_at,
          'capture_marker', n.capture_marker,
          'mapping_state', case when n.source_purpose = 'Creative'
            then coalesce(n.decision_state, 'unmapped') else null end,
          'submissions', case when n.source_purpose = 'Creative'
            then coalesce(n.submissions, '[]'::jsonb) else null end,
          'mapped_creative', case when n.source_purpose = 'Submissions'
            then coalesce(n.mapped_creative, '[]'::jsonb) else null end
        ) order by n.rn
      ) filter (where n.rn <= v_page_size), '[]'::jsonb),
      count(*)::integer,
      max(n.row_key) filter (where n.rn = v_page_size)
    into v_rows, v_fetched, v_last_key
    from numbered n;

  elsif v_entity_kind = 'character' then
    with opa_scope_latest as materialized (
      select distinct on (
        m.licensed_property_id, m.region_code, m.branch_code,
        m.line_of_business_id, m.product_type_code, m.template_id, m.workflow_id
      )
        m.licensed_property_id, m.branch_code
      from plm.opa_property_scope_membership m
      where m.approval_status = 'approved'
      order by m.licensed_property_id, m.region_code, m.branch_code,
        m.line_of_business_id, m.product_type_code, m.template_id, m.workflow_id,
        m.source_captured_at desc, m.created_at desc, m.membership_id desc
    ), opa_studio_summary as materialized (
      select r.licensed_property_id,
        case
          when count(*) filter (where r.resolution_status = 'ambiguous_crossover') > 0
            or count(distinct r.studio_code) filter (where r.resolution_status = 'canonical') > 1
            then 'ambiguous_crossover'
          when count(*) filter (where r.resolution_status = 'canonical') = 1 then 'canonical'
          else 'unresolved'
        end as resolution_status,
        case
          when count(*) filter (where r.resolution_status = 'ambiguous_crossover') = 0
            and count(*) filter (where r.resolution_status = 'canonical') = 1
            then min(r.studio_code) filter (where r.resolution_status = 'canonical')
        end as studio_code
      from plm.opa_property_studio_resolution r
      group by r.licensed_property_id
    ), opa_character_scope as materialized (
      -- A character has no scope of its own. 609 OPA characters belong to more than
      -- one property, so studio is inherited through EVERY parent property and a
      -- character whose parents sit in more than one studio branch is a scope
      -- conflict, never silently attributed to Disney.
      select pc.character_id,
        count(distinct s.branch_code) as scope_count,
        min(s.branch_code) as studio_code
      from plm.opa_property_character pc
      join opa_scope_latest s on s.licensed_property_id = pc.licensed_property_id
      group by pc.character_id
    ), opa_character_studio as materialized (
      select pc.character_id,
        case
          when count(*) filter (where o.resolution_status = 'ambiguous_crossover') > 0
            or count(distinct o.studio_code) filter (where o.resolution_status = 'canonical') > 1
            then 'ambiguous_crossover'
          when count(*) filter (where o.resolution_status = 'canonical') > 0 then 'canonical'
          else 'unresolved'
        end as resolution_status,
        case
          when count(*) filter (where o.resolution_status = 'ambiguous_crossover') = 0
            and count(distinct o.studio_code) filter (where o.resolution_status = 'canonical') = 1
            then min(o.studio_code) filter (where o.resolution_status = 'canonical')
        end as studio_code
      from plm.opa_property_character pc
      join opa_studio_summary o on o.licensed_property_id = pc.licensed_property_id
      group by pc.character_id
    ), nbcu_character_ranked as (
      select ch.*,
        row_number() over (
          partition by ch.character_key
          order by c.source_captured_at desc, ch.source_captured_at desc,
            ch.capture_id::text desc
        ) as capture_rank
      from plm.nbcu_character ch
      join plm.nbcu_capture c on c.id = ch.capture_id
      where c.status = 'complete'
    ), pmt_character_ranked as (
      select ch.*,
        row_number() over (
          partition by ch.character_source_id
          order by c.completed_at desc nulls last, ch.imported_at desc,
            ch.capture_id::text desc
        ) as capture_rank
      from plm.pmt_character ch
      join plm.pmt_capture c on c.capture_id = ch.capture_id
      where c.status = 'complete'
        and c.capture_kind = 'full'
    ), wildbrain_character_ranked as (
      select ch.*,
        row_number() over (
          partition by ch.character_source_id
          order by c.source_captured_at desc, ch.capture_id::text desc
        ) as capture_rank
      from plm.wildbrain_character ch
      join plm.wildbrain_capture c on c.id = ch.capture_id
      where c.status = 'complete'
    ), peanuts_latest as (
      select c.id
      from plm.peanuts_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), sesame_latest as (
      select c.id
      from plm.sesame_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), source_rows as not materialized (
      select
        case
          when sc.scope_count > 1 or st.resolution_status = 'ambiguous_crossover'
            then 'opa-scope-conflict'
          when sc.studio_code = 'lucasfilm' then 'lucasfilm-star-wars-opa'
          when sc.studio_code = 'disney' and st.resolution_status = 'canonical'
            and st.studio_code in ('disney','marvel','pixar') then
            case st.studio_code when 'disney' then 'disney-opa'
              when 'marvel' then 'marvel-opa' when 'pixar' then 'pixar-opa' end
          when sc.studio_code = 'disney' then 'disney-opa'
          when sc.studio_code is null and st.resolution_status = 'canonical' then
            case st.studio_code when 'disney' then 'disney-opa'
              when 'marvel' then 'marvel-opa'
              when 'lucasfilm' then 'lucasfilm-star-wars-opa'
              when 'pixar' then 'pixar-opa' end
          else 'disney-opa-unresolved'
        end::text as licensor_key,
        case
          when sc.scope_count > 1 or st.resolution_status = 'ambiguous_crossover'
            then 'OPA - Submissions (scope conflict)'
          when sc.studio_code = 'lucasfilm' then 'Lucasfilm / Star Wars - Submissions (OPA)'
          when sc.studio_code = 'disney' and st.resolution_status = 'canonical'
            and st.studio_code = 'marvel' then 'Marvel - Submissions (OPA)'
          when sc.studio_code = 'disney' and st.resolution_status = 'canonical'
            and st.studio_code = 'pixar' then 'Disney (Pixar) - Submissions (OPA)'
          when sc.studio_code = 'disney' then 'Disney - Submissions (OPA)'
          when sc.studio_code is null and st.resolution_status = 'canonical' then
            case st.studio_code when 'disney' then 'Disney - Submissions (OPA)'
              when 'marvel' then 'Marvel - Submissions (OPA)'
              when 'lucasfilm' then 'Lucasfilm / Star Wars - Submissions (OPA)'
              when 'pixar' then 'Disney (Pixar) - Submissions (OPA)' end
          else 'OPA - Submissions (unresolved)'
        end::text as licensor_name,
        'Submissions'::text as source_purpose,
        'disney_opa'::text as source_system,
        'plm.opa_character'::text as source_table,
        ch.character_id::text as source_id,
        ch.character_name::text as source_label,
        coalesce(ch.resolution_status, 'unresolved')::text as source_status,
        ch.last_seen_at::timestamptz as latest_seen_at,
        null::text as capture_marker
      from plm.opa_character ch
      left join opa_character_scope sc on sc.character_id = ch.character_id
      left join opa_character_studio st on st.character_id = ch.character_id

      union all
      select 'disney', 'Disney - Creative (DCP Vault)', 'Creative',
             ch.source_system, 'plm.dcp_character', ch.source_id, ch.display_name,
             null, null::timestamptz, ch.last_seen_metadata_run_id::text
      from plm.dcp_character ch

      union all
      select 'lucasfilm-star-wars', 'Lucasfilm / Star Wars - Creative (DCP Vault)', 'Creative',
             ch.source_system, 'plm.lucasfilm_dcp_character', ch.source_id, ch.display_name,
             null, null::timestamptz, ch.last_seen_metadata_run_id::text
      from plm.lucasfilm_dcp_character ch

      union all
      select '20th-century', '20th Century - Creative (DCP Vault)', 'Creative',
             ch.source_system, 'plm.twentieth_century_dcp_character', ch.source_id,
             ch.display_name, null, null::timestamptz,
             ch.last_seen_metadata_run_id::text
      from plm.twentieth_century_dcp_character ch

      union all
      select 'dcp-vault-non-authoritative-marvel-tag',
             'DCP Vault - Creative (non-authoritative Marvel tag)', 'Creative',
             ch.source_system, 'plm.marvel_dcp_character', ch.source_id, ch.display_name,
             'non_authoritative', null::timestamptz,
             ch.last_seen_metadata_run_id::text
      from plm.marvel_dcp_character ch

      union all
      select 'marvel-asgard-creative', 'Marvel - Creative (ASGARD)', 'Creative',
             'marvel_asgard', 'plm.marvel_asgard_character', ch.source_identity_key,
             ch.exact_label,
             case when ch.is_actively_observed then 'active' else 'retained' end,
             null::timestamptz, ch.last_seen_capture_key::text
      from plm.marvel_asgard_character ch

      union all
      select 'warner-bros', 'Warner Bros. - Creative (STARLABS)', 'Creative',
             'warner_starlabs', 'plm.wb_character_normalized',
             ch.source_namespace || ':' || coalesce(ch.source_id, ch.fallback_key), ch.label, ch.status,
             ch.last_seen_at, ch.capture_id::text
      from plm.wb_character_normalized ch

      union all
      select 'nbcuniversal', 'NBCUniversal - Creative (Creative Asset Factory)', 'Creative',
             'nbcu_creative_asset_factory', 'plm.nbcu_character', ch.character_key,
             ch.character_label, coalesce(ch.resolution_status, 'unresolved'),
             ch.source_captured_at, ch.capture_id::text
      from nbcu_character_ranked ch
      where ch.capture_rank = 1

      union all
      select 'paramount', 'Paramount - Creative (Creative Library)', 'Creative',
             'paramount_creative_library', 'plm.pmt_character',
             ch.character_source_id::text, ch.character_name,
             coalesce(ch.resolution_status, 'unresolved'),
             ch.imported_at, ch.capture_id::text
      from pmt_character_ranked ch
      where ch.capture_rank = 1

      union all
      select 'strawberry-shortcake-creative', 'Strawberry Shortcake - Creative', 'Creative',
             'wildbrain_tenovos', 'plm.wildbrain_character', ch.character_source_id,
             ch.character_label,
             case when ch.in_source_dictionary then 'in_source_dictionary'
                  else 'asset_value_only' end,
             null::timestamptz, ch.capture_id::text
      from wildbrain_character_ranked ch
      where ch.capture_rank = 1

      union all
      select 'peanuts-creative', 'Peanuts - Creative (Tenovos)', 'Creative',
             'peanuts_tenovos', 'plm.peanuts_character', ch.value_key, ch.value_label,
             null, null::timestamptz, ch.capture_id::text
      from plm.peanuts_character ch
      join peanuts_latest c on c.id = ch.capture_id

      union all
      select 'sesame-creative', 'Sesame Workshop - Creative (NetX)', 'Creative',
             'sesame_netx', 'plm.sesame_character',
             ch.field_generation || ':' || ch.value_key, ch.value_label,
             ch.field_generation, null::timestamptz, ch.capture_id::text
      from plm.sesame_character ch
      join sesame_latest c on c.id = ch.capture_id
    ), keyed as (
      select
        jsonb_build_array(
          'character', s.licensor_key, s.source_system, s.source_table, s.source_id
        )::text as row_key,
        s.*,
        case
          when s.source_system = 'disney_dcpvault' then 'disney'
          when s.source_system = 'marvel_dcpvault' then 'marvel'
          when s.source_system = 'lucasfilm_dcpvault' then 'lucasfilm-star-wars'
          when s.source_system = 'twentieth_century_dcpvault' then '20th-century'
          when s.licensor_key in ('disney', 'disney-opa') then 'disney'
          when s.licensor_key in ('marvel', 'marvel-opa', 'marvel-asgard-creative') then 'marvel'
          when s.licensor_key in ('pixar', 'pixar-opa') then 'disney'
          when s.licensor_key in ('lucasfilm-star-wars', 'lucasfilm-star-wars-opa') then 'lucasfilm-star-wars'
          when s.licensor_key = '20th-century' then '20th-century'
          when s.licensor_key = 'warner-bros' then 'warner-bros'
          when s.licensor_key = 'nbcuniversal' then 'nbcuniversal'
          when s.licensor_key in ('paramount', 'paramount-submissions') then 'paramount'
          when s.licensor_key in ('strawberry-shortcake-creative', 'wildbrain-submissions') then 'strawberry-shortcake'
          when s.licensor_key in ('sega-creative', 'sega-submissions') then 'sega'
          when s.licensor_key in ('coca-cola-creative', 'coca-cola-submissions') then 'coca-cola'
          when s.licensor_key in ('peanuts-creative', 'peanuts-submissions') then 'peanuts'
          when s.licensor_key in ('sesame-creative', 'sesame-submissions') then 'sesame-workshop'
          when s.licensor_key in ('wwe-creative', 'wwe-submissions') then 'wwe'
          else 'unresolved'
        end::text as licensor_group_key,
        case
          when s.source_system = 'disney_dcpvault' then 'Disney'
          when s.source_system = 'marvel_dcpvault' then 'Marvel'
          when s.source_system = 'lucasfilm_dcpvault' then 'Lucasfilm / Star Wars'
          when s.source_system = 'twentieth_century_dcpvault' then '20th Century'
          when s.licensor_key in ('disney', 'disney-opa') then 'Disney'
          when s.licensor_key in ('marvel', 'marvel-opa', 'marvel-asgard-creative') then 'Marvel'
          when s.licensor_key in ('pixar', 'pixar-opa') then 'Disney'
          when s.licensor_key in ('lucasfilm-star-wars', 'lucasfilm-star-wars-opa') then 'Lucasfilm / Star Wars'
          when s.licensor_key = '20th-century' then '20th Century'
          when s.licensor_key = 'warner-bros' then 'Warner Bros.'
          when s.licensor_key = 'nbcuniversal' then 'NBCUniversal'
          when s.licensor_key in ('paramount', 'paramount-submissions') then 'Paramount'
          when s.licensor_key in ('strawberry-shortcake-creative', 'wildbrain-submissions') then 'Strawberry Shortcake'
          when s.licensor_key in ('sega-creative', 'sega-submissions') then 'Sega'
          when s.licensor_key in ('coca-cola-creative', 'coca-cola-submissions') then 'Coca-Cola'
          when s.licensor_key in ('peanuts-creative', 'peanuts-submissions') then 'Peanuts'
          when s.licensor_key in ('sesame-creative', 'sesame-submissions') then 'Sesame Workshop'
          when s.licensor_key in ('wwe-creative', 'wwe-submissions') then 'WWE'
          else 'Licensor not yet determined'
        end::text as licensor_group_name,
        coalesce(
          nullif(btrim(s.source_label), ''),
          nullif(btrim(regexp_replace(
            regexp_replace(s.source_id, '^.*/', ''), '[-_]+', ' ', 'g'
          )), '')
        ) as display_label
      from source_rows s
    ), filtered as (
      select k.*
      from keyed k
      where (
        p_search is null
        or k.licensor_name ilike '%' || p_search || '%'
        or k.source_system ilike '%' || p_search || '%'
        or k.source_id ilike '%' || p_search || '%'
        or k.display_label ilike '%' || p_search || '%'
      )
        and (p_cursor is null or k.row_key collate "C" > v_cursor_key collate "C")
    ), ordered as materialized (
      select f.*
      from filtered f
      order by f.row_key collate "C"
      limit v_page_size + 1
    ), numbered as (
      select o.*, row_number() over (order by o.row_key collate "C") as rn
      from ordered o
    )
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'row_key', n.row_key,
          'entity_kind', 'character',
          'licensor_key', n.licensor_key,
          'licensor_name', n.licensor_name,
          'licensor_group_key', n.licensor_group_key,
          'licensor_group_name', n.licensor_group_name,
          'source_purpose', n.source_purpose,
          'display_label', n.display_label,
          'source_system', n.source_system,
          'source_table', n.source_table,
          'source_id', n.source_id,
          'source_status', n.source_status,
          'latest_seen_at', n.latest_seen_at,
          'capture_marker', n.capture_marker,
          'mapping_state', null
        ) order by n.rn
      ) filter (where n.rn <= v_page_size), '[]'::jsonb),
      count(*)::integer,
      max(n.row_key) filter (where n.rn = v_page_size)
    into v_rows, v_fetched, v_last_key
    from numbered n;

  else
    with nbcu_style_guide_ranked as (
      select g.*,
        row_number() over (
          partition by g.style_guide_key
          order by c.source_captured_at desc, g.source_captured_at desc,
            g.capture_id::text desc
        ) as capture_rank
      from plm.nbcu_style_guide g
      join plm.nbcu_capture c on c.id = g.capture_id
      where c.status = 'complete'
    ), peanuts_latest as (
      select c.id
      from plm.peanuts_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), sesame_latest as (
      select c.id
      from plm.sesame_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), wwe_creative_latest as (
      select c.id
      from plm.wwe_creative_capture c
      where c.status = 'complete'
      order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
      limit 1
    ), source_rows as not materialized (
      select
        'disney'::text as licensor_key,
        'Disney - Creative (DCP Vault)'::text as licensor_name,
        'Creative'::text as source_purpose,
        g.source_system::text as source_system,
        'plm.dcp_style_guide'::text as source_table,
        g.source_path::text as source_id,
        g.folder_name::text as source_label,
        coalesce(g.resolution_status, 'unresolved')::text as source_status,
        null::timestamptz as latest_seen_at,
        g.last_seen_crawl_id::text as capture_marker
      from plm.dcp_style_guide g

      union all
      select 'lucasfilm-star-wars', 'Lucasfilm / Star Wars - Creative (DCP Vault)', 'Creative',
             g.source_system, 'plm.lucasfilm_dcp_style_guide', g.source_path,
             g.folder_name, coalesce(g.resolution_status, 'unresolved'),
             null::timestamptz, g.last_seen_crawl_id::text
      from plm.lucasfilm_dcp_style_guide g

      union all
      select '20th-century', '20th Century - Creative (DCP Vault)', 'Creative',
             g.source_system, 'plm.twentieth_century_dcp_style_guide', g.source_path,
             g.folder_name, coalesce(g.resolution_status, 'unresolved'),
             null::timestamptz, g.last_seen_crawl_id::text
      from plm.twentieth_century_dcp_style_guide g

      union all
      select 'dcp-vault-non-authoritative-marvel-tag',
             'DCP Vault - Creative (non-authoritative Marvel tag)', 'Creative',
             g.source_system, 'plm.marvel_dcp_style_guide', g.source_path,
             g.folder_name, 'non_authoritative',
             null::timestamptz, g.last_seen_crawl_id::text
      from plm.marvel_dcp_style_guide g

      union all
      select 'marvel-asgard-creative', 'Marvel - Creative (ASGARD)', 'Creative',
             'marvel_asgard', 'plm.marvel_asgard_style_guide', g.source_identity_key,
             g.exact_label,
             case when g.is_actively_observed then 'active' else 'retained' end,
             null::timestamptz, g.last_seen_capture_key::text
      from plm.marvel_asgard_style_guide g

      union all
      select 'warner-bros', 'Warner Bros. - Creative (STARLABS)', 'Creative',
             'warner_starlabs', 'plm.wb_style_guide_normalized',
             g.source_namespace || ':' || coalesce(g.source_id, g.fallback_key),
             g.label, g.status, g.last_seen_at, g.capture_id::text
      from plm.wb_style_guide_normalized g

      union all
      select 'nbcuniversal', 'NBCUniversal - Creative (Creative Asset Factory)', 'Creative',
             'nbcu_creative_asset_factory', 'plm.nbcu_style_guide', g.style_guide_key,
             g.style_guide_label, coalesce(g.resolution_status, 'unresolved'),
             g.source_captured_at, g.capture_id::text
      from nbcu_style_guide_ranked g
      where g.capture_rank = 1

      union all
      select 'peanuts-creative', 'Peanuts - Creative (Tenovos)', 'Creative',
             'peanuts_tenovos', 'plm.peanuts_style_guide', g.value_key, g.value_label,
             null, null::timestamptz, g.capture_id::text
      from plm.peanuts_style_guide g
      join peanuts_latest c on c.id = g.capture_id

      union all
      select 'sesame-creative', 'Sesame Workshop - Creative (NetX)', 'Creative',
             'sesame_netx', 'plm.sesame_style_guide',
             g.field_generation || ':' || g.value_key, g.value_label,
             g.field_generation, null::timestamptz, g.capture_id::text
      from plm.sesame_style_guide g
      join sesame_latest c on c.id = g.capture_id

      union all
      select 'wwe-creative', 'WWE - Creative', 'Creative',
             'wwe_creative', 'plm.wwe_style_guide', g.guideline_source_id,
             g.guideline_label, null, null::timestamptz, g.capture_id::text
      from plm.wwe_style_guide g
      join wwe_creative_latest c on c.id = g.capture_id
    ), keyed as (
      select
        jsonb_build_array(
          'style_guide', s.licensor_key, s.source_system, s.source_table, s.source_id
        )::text as row_key,
        s.*,
        case
          when s.source_system = 'disney_dcpvault' then 'disney'
          when s.source_system = 'marvel_dcpvault' then 'marvel'
          when s.source_system = 'lucasfilm_dcpvault' then 'lucasfilm-star-wars'
          when s.source_system = 'twentieth_century_dcpvault' then '20th-century'
          when s.licensor_key in ('disney', 'disney-opa') then 'disney'
          when s.licensor_key in ('marvel', 'marvel-opa', 'marvel-asgard-creative') then 'marvel'
          when s.licensor_key in ('pixar', 'pixar-opa') then 'disney'
          when s.licensor_key in ('lucasfilm-star-wars', 'lucasfilm-star-wars-opa') then 'lucasfilm-star-wars'
          when s.licensor_key = '20th-century' then '20th-century'
          when s.licensor_key = 'warner-bros' then 'warner-bros'
          when s.licensor_key = 'nbcuniversal' then 'nbcuniversal'
          when s.licensor_key in ('paramount', 'paramount-submissions') then 'paramount'
          when s.licensor_key in ('strawberry-shortcake-creative', 'wildbrain-submissions') then 'strawberry-shortcake'
          when s.licensor_key in ('sega-creative', 'sega-submissions') then 'sega'
          when s.licensor_key in ('coca-cola-creative', 'coca-cola-submissions') then 'coca-cola'
          when s.licensor_key in ('peanuts-creative', 'peanuts-submissions') then 'peanuts'
          when s.licensor_key in ('sesame-creative', 'sesame-submissions') then 'sesame-workshop'
          when s.licensor_key in ('wwe-creative', 'wwe-submissions') then 'wwe'
          else 'unresolved'
        end::text as licensor_group_key,
        case
          when s.source_system = 'disney_dcpvault' then 'Disney'
          when s.source_system = 'marvel_dcpvault' then 'Marvel'
          when s.source_system = 'lucasfilm_dcpvault' then 'Lucasfilm / Star Wars'
          when s.source_system = 'twentieth_century_dcpvault' then '20th Century'
          when s.licensor_key in ('disney', 'disney-opa') then 'Disney'
          when s.licensor_key in ('marvel', 'marvel-opa', 'marvel-asgard-creative') then 'Marvel'
          when s.licensor_key in ('pixar', 'pixar-opa') then 'Disney'
          when s.licensor_key in ('lucasfilm-star-wars', 'lucasfilm-star-wars-opa') then 'Lucasfilm / Star Wars'
          when s.licensor_key = '20th-century' then '20th Century'
          when s.licensor_key = 'warner-bros' then 'Warner Bros.'
          when s.licensor_key = 'nbcuniversal' then 'NBCUniversal'
          when s.licensor_key in ('paramount', 'paramount-submissions') then 'Paramount'
          when s.licensor_key in ('strawberry-shortcake-creative', 'wildbrain-submissions') then 'Strawberry Shortcake'
          when s.licensor_key in ('sega-creative', 'sega-submissions') then 'Sega'
          when s.licensor_key in ('coca-cola-creative', 'coca-cola-submissions') then 'Coca-Cola'
          when s.licensor_key in ('peanuts-creative', 'peanuts-submissions') then 'Peanuts'
          when s.licensor_key in ('sesame-creative', 'sesame-submissions') then 'Sesame Workshop'
          when s.licensor_key in ('wwe-creative', 'wwe-submissions') then 'WWE'
          else 'Licensor not yet determined'
        end::text as licensor_group_name,
        coalesce(
          nullif(btrim(s.source_label), ''),
          nullif(btrim(regexp_replace(
            regexp_replace(s.source_id, '^.*/', ''), '[-_]+', ' ', 'g'
          )), '')
        ) as display_label
      from source_rows s
    ), filtered as (
      select k.*
      from keyed k
      where (
        p_search is null
        or k.licensor_name ilike '%' || p_search || '%'
        or k.source_system ilike '%' || p_search || '%'
        or k.source_id ilike '%' || p_search || '%'
        or k.display_label ilike '%' || p_search || '%'
      )
        and (p_cursor is null or k.row_key collate "C" > v_cursor_key collate "C")
    ), ordered as materialized (
      select f.*
      from filtered f
      order by f.row_key collate "C"
      limit v_page_size + 1
    ), numbered as (
      select o.*, row_number() over (order by o.row_key collate "C") as rn
      from ordered o
    )
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'row_key', n.row_key,
          'entity_kind', 'style_guide',
          'licensor_key', n.licensor_key,
          'licensor_name', n.licensor_name,
          'licensor_group_key', n.licensor_group_key,
          'licensor_group_name', n.licensor_group_name,
          'source_purpose', n.source_purpose,
          'display_label', n.display_label,
          'source_system', n.source_system,
          'source_table', n.source_table,
          'source_id', n.source_id,
          'source_status', n.source_status,
          'latest_seen_at', n.latest_seen_at,
          'capture_marker', n.capture_marker,
          'mapping_state', null
        ) order by n.rn
      ) filter (where n.rn <= v_page_size), '[]'::jsonb),
      count(*)::integer,
      max(n.row_key) filter (where n.rn = v_page_size)
    into v_rows, v_fetched, v_last_key
    from numbered n;
  end if;

  if v_fetched > v_page_size and v_last_key is not null then
    v_next_cursor := encode(convert_to(v_last_key, 'UTF8'), 'base64');
  end if;

  return jsonb_build_object(
    'rows', coalesce(v_rows, '[]'::jsonb),
    'next_cursor', v_next_cursor,
    'page_size', v_page_size,
    'entity_kind', v_entity_kind
  );
end;
$function$
;
revoke all on function api.db_data_admin_scraped_source_inventory(p_entity_kind text, p_search text, p_cursor text, p_page_size integer) from public, anon, authenticated;
grant execute on function api.db_data_admin_scraped_source_inventory(p_entity_kind text, p_search text, p_cursor text, p_page_size integer) to authenticated;
CREATE OR REPLACE FUNCTION api.dflow_admin_access_history(p_actor_profile_id uuid, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
begin
  perform app.dflow_admin_assume_actor(p_actor_profile_id);
  begin
    v_result := api.crm_admin_access_history(p_limit);
  exception when others then
    perform app.dflow_admin_restore_claims(v_sub, v_claims);
    raise;
  end;
  perform app.dflow_admin_restore_claims(v_sub, v_claims);
  return v_result;
end;
$function$
;
revoke all on function api.dflow_admin_access_history(p_actor_profile_id uuid, p_limit integer) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION api.dflow_admin_actor_profile_id(p_email text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
  select p.id
  from app.profile p
  where lower(p.email::text) = lower(btrim(p_email))
    and p.status = 'active'
  order by p.created_at, p.id
  limit 1;
$function$
;
revoke all on function api.dflow_admin_actor_profile_id(p_email text) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION api.dflow_admin_role_list(p_actor_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
begin
  perform app.dflow_admin_assume_actor(p_actor_profile_id);
  begin
    v_result := api.crm_admin_role_list();
  exception when others then
    perform app.dflow_admin_restore_claims(v_sub, v_claims);
    raise;
  end;
  perform app.dflow_admin_restore_claims(v_sub, v_claims);
  return v_result;
end;
$function$
;
revoke all on function api.dflow_admin_role_list(p_actor_profile_id uuid) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION api.dflow_admin_set_app_access(p_actor_profile_id uuid, p_profile_id uuid, p_app text, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
begin
  perform app.dflow_admin_assume_actor(p_actor_profile_id);
  begin
    v_result := api.crm_admin_set_app_access(p_profile_id, p_app, p_enabled);
  exception when others then
    perform app.dflow_admin_restore_claims(v_sub, v_claims);
    raise;
  end;
  perform app.dflow_admin_restore_claims(v_sub, v_claims);
  return v_result;
end;
$function$
;
revoke all on function api.dflow_admin_set_app_access(p_actor_profile_id uuid, p_profile_id uuid, p_app text, p_enabled boolean) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION api.dflow_admin_set_user_roles(p_actor_profile_id uuid, p_profile_id uuid, p_roles text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
begin
  perform app.dflow_admin_assume_actor(p_actor_profile_id);
  begin
    v_result := api.crm_admin_set_user_roles(p_profile_id, p_roles);
  exception when others then
    perform app.dflow_admin_restore_claims(v_sub, v_claims);
    raise;
  end;
  perform app.dflow_admin_restore_claims(v_sub, v_claims);
  return v_result;
end;
$function$
;
revoke all on function api.dflow_admin_set_user_roles(p_actor_profile_id uuid, p_profile_id uuid, p_roles text[]) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION api.dflow_admin_set_user_status(p_actor_profile_id uuid, p_profile_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
begin
  perform app.dflow_admin_assume_actor(p_actor_profile_id);
  begin
    v_result := api.crm_admin_set_user_status(p_profile_id, p_status);
  exception when others then
    perform app.dflow_admin_restore_claims(v_sub, v_claims);
    raise;
  end;
  perform app.dflow_admin_restore_claims(v_sub, v_claims);
  return v_result;
end;
$function$
;
revoke all on function api.dflow_admin_set_user_status(p_actor_profile_id uuid, p_profile_id uuid, p_status text) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION api.dflow_admin_user_directory(p_actor_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
begin
  perform app.dflow_admin_assume_actor(p_actor_profile_id);
  begin
    v_result := api.crm_admin_user_directory();
  exception when others then
    perform app.dflow_admin_restore_claims(v_sub, v_claims);
    raise;
  end;
  perform app.dflow_admin_restore_claims(v_sub, v_claims);
  return v_result;
end;
$function$
;
revoke all on function api.dflow_admin_user_directory(p_actor_profile_id uuid) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION api.mg06_site_path(p_property_id uuid, p_licensor_site text)
 RETURNS TABLE(site_property_name text, site_property_id text, site_character_name text, site_character_id text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p.site_property_name, p.site_property_id, p.site_character_name, p.site_character_id
  from core.property_site_path p
  where p.property_id = p_property_id
    and p.licensor_site = p_licensor_site
    and p.is_current
  order by p.ordinal, p.site_property_name, p.site_character_name nulls first;
$function$
;
revoke all on function api.mg06_site_path(p_property_id uuid, p_licensor_site text) from public, anon, authenticated;
grant execute on function api.mg06_site_path(p_property_id uuid, p_licensor_site text) to authenticated;
grant execute on function api.mg06_site_path(p_property_id uuid, p_licensor_site text) to service_role;
CREATE OR REPLACE FUNCTION api.pm_accept_activity_triage(p_triage_id uuid, p_title text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_due_at date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_row pim.ai_activity_triage%rowtype;
  v_comment app.comment%rowtype;
  v_record_id uuid;
  v_kind text;
  v_result jsonb;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();

  select * into v_row
  from pim.ai_activity_triage t
  where t.id = p_triage_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PM_TRIAGE_NOT_FOUND';
  end if;
  if v_row.requester_profile_id <> v_profile then
    raise exception using errcode = '42501', message = 'PM_NOT_ROW_REQUESTER';
  end if;
  if v_row.state in ('accepted', 'dismissed', 'source_changed', 'expired') then
    return jsonb_build_object(
      'status', case when v_row.state = 'accepted' then 'already_accepted'
                     when v_row.state = 'dismissed' then 'already_dismissed'
                     else v_row.state end,
      'triage_id', v_row.id,
      'created_record_table', v_row.created_record_table,
      'created_record_id', v_row.created_record_id
    );
  end if;
  if v_row.state <> 'succeeded' or v_row.action_label is null then
    raise exception using errcode = '22023', message = 'PM_TRIAGE_NOT_ACTIONABLE';
  end if;
  if v_row.action_label in ('routine_update', 'unclear') then
    raise exception using errcode = '22023', message = 'PM_TRIAGE_NOT_ACTIONABLE';
  end if;

  select * into v_comment
  from app.comment c where c.id = v_row.comment_id;
  if not found or v_comment.body_revision <> v_row.source_body_revision then
    update pim.ai_activity_triage
    set state = 'source_changed', updated_at = now()
    where id = p_triage_id;
    return jsonb_build_object('status', 'source_changed', 'triage_id', p_triage_id);
  end if;

  v_kind := v_row.action_label;
  if v_kind = 'blocker_dependency' then
    if p_title is null or length(btrim(p_title)) < 1 or length(btrim(p_title)) > 200 then
      raise exception using errcode = '22023', message = 'PM_INVALID_DEPENDENCY_TITLE';
    end if;
    v_result := api.pm_create_dependency(v_row.product_id, btrim(p_title));
    v_record_id := (v_result ->> 'id')::uuid;
  elsif v_kind = 'decision' then
    if p_type is null or length(btrim(p_type)) < 1 or length(btrim(p_type)) > 100 then
      raise exception using errcode = '22023', message = 'PM_INVALID_DECISION_TYPE';
    end if;
    v_result := api.pm_create_decision(v_row.product_id, btrim(p_type), p_notes);
    v_record_id := (v_result ->> 'id')::uuid;
  elsif v_kind = 'follow_up_reminder' then
    if p_title is null or length(btrim(p_title)) < 1 or length(btrim(p_title)) > 200 then
      raise exception using errcode = '22023', message = 'PM_INVALID_REMINDER_TITLE';
    end if;
    v_result := api.pm_create_reminder(v_row.product_id, btrim(p_title), p_due_at);
    v_record_id := (v_result ->> 'id')::uuid;
  else
    raise exception using errcode = '22023', message = 'PM_TRIAGE_NOT_ACTIONABLE';
  end if;

  update pim.ai_activity_triage
  set state = 'accepted',
      accepted_at = now(),
      reviewed_at = now(),
      reviewed_by_profile_id = v_profile,
      created_record_table = case when v_kind = 'follow_up_reminder' then 'app.notification' else 'app.activity' end,
      created_record_id = v_record_id,
      updated_at = now()
  where id = p_triage_id;

  return jsonb_build_object(
    'status', 'accepted',
    'triage_id', p_triage_id,
    'created_record_table', case when v_kind = 'follow_up_reminder' then 'app.notification' else 'app.activity' end,
    'created_record_id', v_record_id
  );
end $function$
;
revoke all on function api.pm_accept_activity_triage(p_triage_id uuid, p_title text, p_type text, p_notes text, p_due_at date) from public, anon, authenticated;
grant execute on function api.pm_accept_activity_triage(p_triage_id uuid, p_title text, p_type text, p_notes text, p_due_at date) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_add_product_comment(p_product_id uuid, p_body text, p_client_operation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_body text;
  v_comment_id uuid;
  v_revision integer;
  v_elig pim.ai_activity_triage_eligibility%rowtype;
  v_existing app.comment%rowtype;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  v_body := pim.pm_validate_comment_body(p_body);

  if p_product_id is null then
    raise exception using errcode = '22023', message = 'PM_INVALID_PRODUCT';
  end if;
  if not exists (select 1 from pim.product p where p.id = p_product_id) then
    raise exception using errcode = 'P0002', message = 'PM_PRODUCT_NOT_FOUND';
  end if;

  if p_client_operation_id is not null then
    select * into v_existing
    from app.comment c
    where c.created_by_profile_id = v_profile
      and c.source_system = 'poppim-web-comment'
      and c.source_id = p_client_operation_id::text
      and c.target_schema = 'pim'
      and c.target_table = 'product'
      and c.target_id = p_product_id;
    if found then
      return jsonb_build_object(
        'status', 'replayed',
        'comment_id', v_existing.id,
        'body_revision', v_existing.body_revision,
        'client_operation_id', p_client_operation_id
      );
    end if;

    select * into v_elig
    from pim.ai_activity_triage_eligibility e
    where e.requester_profile_id = v_profile
      and e.client_operation_id = p_client_operation_id
      and e.eligibility_state = 'reserved'
      and e.expires_at > now()
    order by e.eligibility_version desc
    limit 1
    for update;

    if not found then
      raise exception using errcode = '22023', message = 'PM_RESERVATION_REQUIRED';
    end if;
    if v_elig.product_id <> p_product_id then
      raise exception using errcode = '22023', message = 'PM_RESERVATION_PRODUCT_MISMATCH';
    end if;
  end if;

  begin
    insert into app.comment (
      target_schema, target_table, target_id, body,
      visibility, created_by_profile_id, source_system, source_id
    ) values (
      'pim', 'product', p_product_id, v_body,
      'internal', v_profile, 'poppim-web-comment',
      p_client_operation_id::text
    )
    returning id, body_revision into v_comment_id, v_revision;
  exception when unique_violation then
    -- Concurrent replay of the same client_operation_id returns the original row.
    select * into v_existing
    from app.comment c
    where c.created_by_profile_id = v_profile
      and c.source_system = 'poppim-web-comment'
      and c.source_id = p_client_operation_id::text
      and c.target_schema = 'pim'
      and c.target_table = 'product'
      and c.target_id = p_product_id;
    if found then
      return jsonb_build_object(
        'status', 'replayed',
        'comment_id', v_existing.id,
        'body_revision', v_existing.body_revision,
        'client_operation_id', p_client_operation_id
      );
    end if;
    raise;
  end;

  if p_client_operation_id is not null then
    update pim.ai_activity_triage_eligibility
    set eligibility_state = 'submitted',
        comment_id = v_comment_id,
        source_body_revision = v_revision,
        submitted_at = now(),
        updated_at = now()
    where id = v_elig.id;
  end if;

  return jsonb_build_object(
    'status', 'created',
    'comment_id', v_comment_id,
    'body_revision', v_revision,
    'client_operation_id', p_client_operation_id,
    'created_by_profile_id', v_profile
  );
end $function$
;
revoke all on function api.pm_add_product_comment(p_product_id uuid, p_body text, p_client_operation_id uuid) from public, anon, authenticated;
grant execute on function api.pm_add_product_comment(p_product_id uuid, p_body text, p_client_operation_id uuid) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_begin_activity_triage(p_comment_id uuid, p_input_digest text, p_input_key_version text, p_model text, p_contract_version text, p_envelope jsonb DEFAULT NULL::jsonb, p_signature text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_comment app.comment%rowtype;
  v_existing pim.ai_activity_triage%rowtype;
  v_elig pim.ai_activity_triage_eligibility%rowtype;
  v_lease_hash text;
  v_lease_token text;
  v_row pim.ai_activity_triage%rowtype;
  v_recent integer;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();

  if p_comment_id is null or p_input_digest is null or p_input_key_version is null
     or p_model is null or p_contract_version is null then
    raise exception using errcode = '22023', message = 'PM_INVALID_TRIAGE_REQUEST';
  end if;

  if p_envelope is not null or p_signature is not null then
    if not pim.pm_verify_jev_hmac_envelope(p_envelope, p_signature) then
      raise exception using errcode = '22023', message = 'PM_ENVELOPE_INVALID';
    end if;
  end if;

  select * into v_comment
  from app.comment c
  where c.id = p_comment_id and c.created_by_profile_id = v_profile
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'PM_COMMENT_NOT_OWNED';
  end if;
  if v_comment.target_schema <> 'pim' or v_comment.target_table <> 'product' then
    raise exception using errcode = '22023', message = 'PM_COMMENT_TARGET_INVALID';
  end if;

  -- Serialize concurrent begins for this profile (rate limit + idempotency).
  perform pg_advisory_xact_lock(hashtext('pm_jev_begin:' || v_profile::text));

  select * into v_existing
  from pim.ai_activity_triage t
  where t.comment_id = p_comment_id
    and t.input_digest = p_input_digest
    and t.input_key_version = p_input_key_version
    and t.model = p_model
    and t.contract_version = p_contract_version
  for update;
  if found then
    -- Terminal outcomes never re-lease.
    if v_existing.state in ('accepted', 'dismissed', 'source_changed', 'failed', 'succeeded') then
      return jsonb_build_object(
        'status', 'existing',
        'triage_id', v_existing.id,
        'state', v_existing.state,
        'lease_acquired', false
      );
    end if;
    -- Re-lease a queued row (timeout retry) or take over an expired lease.
    -- Late completion from the old lease is rejected by the workers' lease check.
    if v_existing.state = 'queued'
       or (v_existing.state in ('leased', 'claimed')
           and v_existing.lease_expires_at is not null
           and v_existing.lease_expires_at < now()) then
      v_lease_token := encode(extensions.gen_random_bytes(16), 'hex');
      v_lease_hash := encode(extensions.digest(convert_to(v_lease_token, 'utf8'), 'sha256'), 'hex');
      update pim.ai_activity_triage t
      set state = 'leased',
          lease_token_hash = v_lease_hash,
          lease_expires_at = now() + interval '10 minutes',
          lease_acquired_at = now(),
          attempt_count = t.attempt_count + 1,
          updated_at = now()
      where t.id = v_existing.id
      returning * into v_row;
      return jsonb_build_object(
        'status', 'reclaimed',
        'triage_id', v_row.id,
        'lease_token', v_lease_token,
        'lease_token_hash', v_lease_hash,
        'state', v_row.state,
        'source_body_revision', v_row.source_body_revision
      );
    end if;
    return jsonb_build_object(
      'status', 'existing',
      'triage_id', v_existing.id,
      'state', v_existing.state,
      'lease_acquired', v_existing.state in ('leased', 'claimed')
        and v_existing.lease_expires_at is not null
        and v_existing.lease_expires_at >= now()
    );
  end if;

  -- Per-profile rolling request limit (50 per 24h) applies only when a new
  -- row would be created; re-fetching or reclaiming an existing row is free.
  select count(*) into v_recent
  from pim.ai_activity_triage t
  where t.requester_profile_id = v_profile
    and t.created_at > now() - interval '24 hours';
  if v_recent >= 50 then
    raise exception using errcode = '22023', message = 'PM_RATE_LIMITED';
  end if;

  insert into pim.ai_activity_triage_eligibility (
    requester_profile_id, client_operation_id, eligibility_version,
    comment_id, product_id, source_body_revision, eligibility_state
  ) values (
    v_profile, gen_random_uuid(), 1,
    p_comment_id, v_comment.target_id, v_comment.body_revision, 'queued'
  )
  returning * into v_elig;

  v_lease_token := encode(extensions.gen_random_bytes(16), 'hex');
  v_lease_hash := encode(extensions.digest(convert_to(v_lease_token, 'utf8'), 'sha256'), 'hex');

  begin
    insert into pim.ai_activity_triage (
      eligibility_id, comment_id, requester_profile_id, product_id,
      source_body_revision, live_comment_id, live_product_id, live_requester_profile_id,
      input_digest, input_key_version, model, contract_version,
      state, lease_token_hash, lease_expires_at, lease_acquired_at, attempt_count
    ) values (
      v_elig.id, p_comment_id, v_profile, v_comment.target_id,
      v_comment.body_revision, p_comment_id, v_comment.target_id, v_profile,
      p_input_digest, p_input_key_version, p_model, p_contract_version,
      'leased', v_lease_hash, now() + interval '10 minutes', now(), 1
    )
    returning * into v_row;
  exception when unique_violation then
    -- Concurrent begin for the same idempotency key returns the existing row.
    select * into v_existing
    from pim.ai_activity_triage t
    where t.comment_id = p_comment_id
      and t.input_digest = p_input_digest
      and t.input_key_version = p_input_key_version
      and t.model = p_model
      and t.contract_version = p_contract_version
    for update;
    if found then
      return jsonb_build_object(
        'status', 'existing',
        'triage_id', v_existing.id,
        'state', v_existing.state,
        'lease_acquired', v_existing.state in ('leased', 'claimed')
          and v_existing.lease_expires_at is not null
          and v_existing.lease_expires_at >= now()
      );
    end if;
    raise;
  end;

  return jsonb_build_object(
    'status', 'leased',
    'triage_id', v_row.id,
    'lease_token', v_lease_token,
    'lease_token_hash', v_lease_hash,
    'state', v_row.state,
    'source_body_revision', v_row.source_body_revision
  );
end $function$
;
revoke all on function api.pm_begin_activity_triage(p_comment_id uuid, p_input_digest text, p_input_key_version text, p_model text, p_contract_version text, p_envelope jsonb, p_signature text) from public, anon, authenticated;
grant execute on function api.pm_begin_activity_triage(p_comment_id uuid, p_input_digest text, p_input_key_version text, p_model text, p_contract_version text, p_envelope jsonb, p_signature text) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_cancel_product_comment_reservation(p_recovery_handle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_token text;
  v_hash text;
  v_row pim.ai_activity_triage_eligibility%rowtype;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  if p_recovery_handle is null or position('.' in p_recovery_handle) < 2 then
    return jsonb_build_object('status', 'unavailable');
  end if;
  v_token := split_part(p_recovery_handle, '.', 1);
  v_hash := encode(extensions.digest(convert_to(v_token, 'utf8'), 'sha256'), 'hex');

  select * into v_row
  from pim.ai_activity_triage_eligibility e
  where e.reservation_token_hash = v_hash
    and e.requester_profile_id = v_profile
  order by e.eligibility_version desc
  limit 1
  for update;

  if not found or v_row.eligibility_state <> 'reserved' then
    return jsonb_build_object('status', 'unavailable');
  end if;

  update pim.ai_activity_triage_eligibility
  set eligibility_state = 'canceled',
      canceled_at = now(),
      updated_at = now()
  where id = v_row.id;

  return jsonb_build_object('status', 'canceled', 'eligibility_id', v_row.id);
end $function$
;
revoke all on function api.pm_cancel_product_comment_reservation(p_recovery_handle text) from public, anon, authenticated;
grant execute on function api.pm_cancel_product_comment_reservation(p_recovery_handle text) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_complete_activity_triage(p_triage_id uuid, p_lease_token_hash text, p_action_label text, p_result_payload jsonb DEFAULT '{}'::jsonb, p_usage_payload jsonb DEFAULT '{}'::jsonb, p_envelope jsonb DEFAULT NULL::jsonb, p_signature text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_row pim.ai_activity_triage%rowtype;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  select * into v_row
  from pim.ai_activity_triage t
  where t.id = p_triage_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'PM_TRIAGE_NOT_FOUND';
  end if;
  if v_row.requester_profile_id <> v_profile then
    raise exception using errcode = '42501', message = 'PM_NOT_ROW_REQUESTER';
  end if;

  if p_envelope is null or p_signature is null
     or not pim.pm_verify_jev_hmac_envelope(p_envelope, p_signature) then
    raise exception using errcode = '22023', message = 'PM_ENVELOPE_INVALID';
  end if;
  -- Bind envelope fields to this exact row and action (prevents cross-row replay).
  if (p_envelope ->> 'requester_profile_id') is distinct from v_row.requester_profile_id::text
     or (p_envelope ->> 'comment_id') is distinct from v_row.comment_id::text
     or (p_envelope ->> 'product_id') is distinct from v_row.product_id::text
     or (p_envelope ->> 'source_body_revision') is distinct from v_row.source_body_revision::text
     or (p_envelope ->> 'input_digest') is distinct from v_row.input_digest
     or (p_envelope ->> 'disposition') is distinct from p_action_label
     or (p_envelope ->> 'lease_token') is null
     or encode(extensions.digest(convert_to(p_envelope ->> 'lease_token', 'utf8'), 'sha256'), 'hex')
        is distinct from v_row.lease_token_hash then
    raise exception using errcode = '22023', message = 'PM_ENVELOPE_ROW_MISMATCH';
  end if;

  perform pim.pm_complete_activity_triage_worker(
    p_triage_id, p_lease_token_hash, p_action_label, p_result_payload, p_usage_payload, null
  );

  return jsonb_build_object('status', 'succeeded', 'triage_id', p_triage_id);
end $function$
;
revoke all on function api.pm_complete_activity_triage(p_triage_id uuid, p_lease_token_hash text, p_action_label text, p_result_payload jsonb, p_usage_payload jsonb, p_envelope jsonb, p_signature text) from public, anon, authenticated;
grant execute on function api.pm_complete_activity_triage(p_triage_id uuid, p_lease_token_hash text, p_action_label text, p_result_payload jsonb, p_usage_payload jsonb, p_envelope jsonb, p_signature text) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_create_decision(p_product_id uuid, p_type text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_type text;
  v_notes text;
  v_id uuid;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  if p_product_id is null or not exists (select 1 from pim.product p where p.id = p_product_id) then
    raise exception using errcode = 'P0002', message = 'PM_PRODUCT_NOT_FOUND';
  end if;
  v_type := btrim(p_type);
  if v_type is null or length(v_type) < 1 or length(v_type) > 100 then
    raise exception using errcode = '22023', message = 'PM_INVALID_DECISION_TYPE';
  end if;
  if exists (select 1 from unnest(regexp_split_to_array(v_type, '')) as ch where ascii(ch) < 32) then
    raise exception using errcode = '22023', message = 'PM_INVALID_CONTROL_CHARS';
  end if;
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  if v_notes is not null and length(v_notes) > 2000 then
    raise exception using errcode = '22023', message = 'PM_INVALID_DECISION_NOTES';
  end if;
  if v_notes is not null and exists (select 1 from unnest(regexp_split_to_array(v_notes, '')) as ch where ascii(ch) < 32) then
    raise exception using errcode = '22023', message = 'PM_INVALID_CONTROL_CHARS';
  end if;

  insert into app.activity (target_schema, target_table, target_id, action, summary, payload, actor_profile_id)
  values (
    'pim', 'product', p_product_id, 'pm_decision', v_type,
    jsonb_build_object('kind', 'decision', 'type', v_type, 'notes', v_notes, 'status', 'decided'),
    v_profile
  )
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id, 'kind', 'decision', 'type', v_type);
end $function$
;
revoke all on function api.pm_create_decision(p_product_id uuid, p_type text, p_notes text) from public, anon, authenticated;
grant execute on function api.pm_create_decision(p_product_id uuid, p_type text, p_notes text) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_create_dependency(p_product_id uuid, p_title text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_title text;
  v_id uuid;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  if p_product_id is null or not exists (select 1 from pim.product p where p.id = p_product_id) then
    raise exception using errcode = 'P0002', message = 'PM_PRODUCT_NOT_FOUND';
  end if;
  v_title := btrim(p_title);
  if v_title is null or length(v_title) < 1 or length(v_title) > 200 then
    raise exception using errcode = '22023', message = 'PM_INVALID_DEPENDENCY_TITLE';
  end if;
  if exists (select 1 from unnest(regexp_split_to_array(v_title, '')) as ch where ascii(ch) < 32) then
    raise exception using errcode = '22023', message = 'PM_INVALID_CONTROL_CHARS';
  end if;

  insert into app.activity (target_schema, target_table, target_id, action, summary, payload, actor_profile_id)
  values (
    'pim', 'product', p_product_id, 'pm_dependency', v_title,
    jsonb_build_object('kind', 'dependency', 'type', 'blocked_by', 'title', v_title, 'status', 'open'),
    v_profile
  )
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id, 'kind', 'dependency', 'title', v_title);
end $function$
;
revoke all on function api.pm_create_dependency(p_product_id uuid, p_title text) from public, anon, authenticated;
grant execute on function api.pm_create_dependency(p_product_id uuid, p_title text) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_create_reminder(p_product_id uuid, p_title text, p_due_at date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_title text;
  v_id uuid;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  if p_product_id is null or not exists (select 1 from pim.product p where p.id = p_product_id) then
    raise exception using errcode = 'P0002', message = 'PM_PRODUCT_NOT_FOUND';
  end if;
  v_title := btrim(p_title);
  if v_title is null or length(v_title) < 1 or length(v_title) > 200 then
    raise exception using errcode = '22023', message = 'PM_INVALID_REMINDER_TITLE';
  end if;
  if exists (select 1 from unnest(regexp_split_to_array(v_title, '')) as ch where ascii(ch) < 32) then
    raise exception using errcode = '22023', message = 'PM_INVALID_CONTROL_CHARS';
  end if;
  if p_due_at is not null and p_due_at < date '2000-01-01' then
    raise exception using errcode = '22023', message = 'PM_INVALID_REMINDER_DUE';
  end if;

  insert into app.notification (profile_id, app, target_schema, target_table, target_id, title, body, payload)
  values (
    v_profile, 'pm', 'pim', 'product', p_product_id, v_title, null,
    jsonb_build_object(
      'kind', 'reminder',
      'title', v_title,
      'due_at', case when p_due_at is null then null else to_char(p_due_at, 'YYYY-MM-DD') end,
      'status', 'open',
      'reminder_type', 'follow_up'
    )
  )
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id, 'kind', 'reminder', 'title', v_title);
end $function$
;
revoke all on function api.pm_create_reminder(p_product_id uuid, p_title text, p_due_at date) from public, anon, authenticated;
grant execute on function api.pm_create_reminder(p_product_id uuid, p_title text, p_due_at date) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_dismiss_activity_triage(p_triage_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_row pim.ai_activity_triage%rowtype;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();

  select * into v_row
  from pim.ai_activity_triage t
  where t.id = p_triage_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PM_TRIAGE_NOT_FOUND';
  end if;
  if v_row.requester_profile_id <> v_profile then
    raise exception using errcode = '42501', message = 'PM_NOT_ROW_REQUESTER';
  end if;
  if v_row.state = 'dismissed' then
    return jsonb_build_object('status', 'already_dismissed', 'triage_id', p_triage_id);
  end if;
  if v_row.state in ('accepted', 'source_changed', 'expired') then
    raise exception using errcode = '22023', message = 'PM_TRIAGE_ALREADY_FINAL';
  end if;

  update pim.ai_activity_triage
  set state = 'dismissed',
      dismissed_at = now(),
      reviewed_at = now(),
      reviewed_by_profile_id = v_profile,
      lease_token_hash = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_triage_id;

  return jsonb_build_object('status', 'dismissed', 'triage_id', p_triage_id);
end $function$
;
revoke all on function api.pm_dismiss_activity_triage(p_triage_id uuid) from public, anon, authenticated;
grant execute on function api.pm_dismiss_activity_triage(p_triage_id uuid) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_fail_activity_triage(p_triage_id uuid, p_lease_token_hash text, p_error_code text, p_envelope jsonb DEFAULT NULL::jsonb, p_signature text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_row pim.ai_activity_triage%rowtype;
  v_state text;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  select * into v_row
  from pim.ai_activity_triage t
  where t.id = p_triage_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'PM_TRIAGE_NOT_FOUND';
  end if;
  if v_row.requester_profile_id <> v_profile then
    raise exception using errcode = '42501', message = 'PM_NOT_ROW_REQUESTER';
  end if;

  if p_envelope is null or p_signature is null
     or not pim.pm_verify_jev_hmac_envelope(p_envelope, p_signature) then
    raise exception using errcode = '22023', message = 'PM_ENVELOPE_INVALID';
  end if;
  if (p_envelope ->> 'requester_profile_id') is distinct from v_row.requester_profile_id::text
     or (p_envelope ->> 'comment_id') is distinct from v_row.comment_id::text
     or (p_envelope ->> 'product_id') is distinct from v_row.product_id::text
     or (p_envelope ->> 'source_body_revision') is distinct from v_row.source_body_revision::text
     or (p_envelope ->> 'input_digest') is distinct from v_row.input_digest
     or (p_envelope ->> 'lease_token') is null
     or encode(extensions.digest(convert_to(p_envelope ->> 'lease_token', 'utf8'), 'sha256'), 'hex')
        is distinct from v_row.lease_token_hash then
    raise exception using errcode = '22023', message = 'PM_ENVELOPE_ROW_MISMATCH';
  end if;

  perform pim.pm_fail_activity_triage_worker(p_triage_id, p_lease_token_hash, p_error_code);

  select state into v_state from pim.ai_activity_triage where id = p_triage_id;
  return jsonb_build_object(
    'status', case when v_state = 'queued' then 'retryable' else 'failed' end,
    'triage_id', p_triage_id,
    'state', v_state
  );
end $function$
;
revoke all on function api.pm_fail_activity_triage(p_triage_id uuid, p_lease_token_hash text, p_error_code text, p_envelope jsonb, p_signature text) from public, anon, authenticated;
grant execute on function api.pm_fail_activity_triage(p_triage_id uuid, p_lease_token_hash text, p_error_code text, p_envelope jsonb, p_signature text) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_get_activity_triage(p_comment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_row pim.ai_activity_triage%rowtype;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  select * into v_row
  from pim.ai_activity_triage t
  where t.comment_id = p_comment_id
    and t.requester_profile_id = v_profile
  order by t.created_at desc
  limit 1;
  if not found then
    return jsonb_build_object('status', 'absent');
  end if;

  return jsonb_build_object(
    'status', 'found',
    'triage_id', v_row.id,
    'state', v_row.state,
    'action_label', v_row.action_label,
    'source_body_revision', v_row.source_body_revision,
    'reviewed_at', v_row.reviewed_at,
    'accepted_at', v_row.accepted_at,
    'dismissed_at', v_row.dismissed_at
  );
end $function$
;
revoke all on function api.pm_get_activity_triage(p_comment_id uuid) from public, anon, authenticated;
grant execute on function api.pm_get_activity_triage(p_comment_id uuid) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_list_active_jev_triage()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'triage_id', t.id,
      'comment_id', t.comment_id,
      'state', t.state,
      'action_label', t.action_label,
      'source_body_revision', t.source_body_revision,
      'created_at', t.created_at
    ) order by t.created_at desc)
    from pim.ai_activity_triage t
    where t.requester_profile_id = v_profile
      and t.state in ('queued', 'claimed', 'leased', 'succeeded')
  ), '[]'::jsonb);
end $function$
;
revoke all on function api.pm_list_active_jev_triage() from public, anon, authenticated;
grant execute on function api.pm_list_active_jev_triage() to authenticated;
CREATE OR REPLACE FUNCTION api.pm_list_reviewed_jev_triage()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'triage_id', t.id,
      'comment_id', t.comment_id,
      'state', t.state,
      'action_label', t.action_label,
      'reviewed_at', t.reviewed_at,
      'accepted_at', t.accepted_at,
      'dismissed_at', t.dismissed_at
    ) order by coalesce(t.reviewed_at, t.updated_at) desc)
    from pim.ai_activity_triage t
    where t.requester_profile_id = v_profile
      and t.state in ('accepted', 'dismissed', 'source_changed', 'expired', 'failed')
  ), '[]'::jsonb);
end $function$
;
revoke all on function api.pm_list_reviewed_jev_triage() from public, anon, authenticated;
grant execute on function api.pm_list_reviewed_jev_triage() to authenticated;
CREATE OR REPLACE FUNCTION api.pm_record_jev_suggestion_impression(p_triage_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  update pim.ai_activity_triage
  set first_impression_at = coalesce(first_impression_at, now()),
      updated_at = now()
  where id = p_triage_id
    and requester_profile_id = v_profile
    and first_impression_at is null;

  if found then
    return jsonb_build_object('status', 'recorded');
  end if;
  if exists (
    select 1 from pim.ai_activity_triage t
    where t.id = p_triage_id and t.requester_profile_id = v_profile
  ) then
    return jsonb_build_object('status', 'already_recorded');
  end if;
  return jsonb_build_object('status', 'unavailable');
end $function$
;
revoke all on function api.pm_record_jev_suggestion_impression(p_triage_id uuid) from public, anon, authenticated;
grant execute on function api.pm_record_jev_suggestion_impression(p_triage_id uuid) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_recover_product_comment_handle(p_recovery_handle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_token text;
  v_hash text;
  v_row pim.ai_activity_triage_eligibility%rowtype;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  if p_recovery_handle is null or position('.' in p_recovery_handle) < 2 then
    return jsonb_build_object('status', 'unavailable');
  end if;
  v_token := split_part(p_recovery_handle, '.', 1);
  v_hash := encode(extensions.digest(convert_to(v_token, 'utf8'), 'sha256'), 'hex');

  select * into v_row
  from pim.ai_activity_triage_eligibility e
  where e.reservation_token_hash = v_hash
    and e.requester_profile_id = v_profile
  order by e.eligibility_version desc
  limit 1;

  if not found
     or v_row.expires_at < now()
     or not exists (select 1 from pim.product p where p.id = v_row.product_id) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  return jsonb_build_object(
    'status', v_row.eligibility_state,
    'product_id', v_row.product_id,
    'eligibility_id', v_row.id,
    'client_operation_id', v_row.client_operation_id,
    'comment_id', v_row.comment_id
  );
end $function$
;
revoke all on function api.pm_recover_product_comment_handle(p_recovery_handle text) from public, anon, authenticated;
grant execute on function api.pm_recover_product_comment_handle(p_recovery_handle text) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_repair_comment_triage_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_changed integer := 0;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  update pim.ai_activity_triage t
  set state = 'source_changed',
      lease_token_hash = null,
      lease_expires_at = null,
      updated_at = now()
  from app.comment c
  where t.live_comment_id = c.id
    and t.requester_profile_id = v_profile
    and t.state in ('queued', 'claimed', 'leased', 'succeeded')
    and c.body_revision is distinct from t.source_body_revision;

  get diagnostics v_changed = row_count;
  return jsonb_build_object('status', 'repaired', 'source_changed_count', v_changed);
end $function$
;
revoke all on function api.pm_repair_comment_triage_queue() from public, anon, authenticated;
grant execute on function api.pm_repair_comment_triage_queue() to authenticated;
CREATE OR REPLACE FUNCTION api.pm_reserve_product_comment_operation(p_product_id uuid, p_client_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_existing pim.ai_activity_triage_eligibility%rowtype;
  v_token text;
  v_token_hash text;
  v_handle text;
  v_row pim.ai_activity_triage_eligibility%rowtype;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  if p_product_id is null or p_client_operation_id is null then
    raise exception using errcode = '22023', message = 'PM_INVALID_RESERVATION';
  end if;
  if not exists (
    select 1 from pim.product p where p.id = p_product_id
  ) then
    raise exception using errcode = 'P0002', message = 'PM_PRODUCT_NOT_FOUND';
  end if;

  select * into v_existing
  from pim.ai_activity_triage_eligibility e
  where e.requester_profile_id = v_profile
    and e.client_operation_id = p_client_operation_id
  order by e.eligibility_version desc
  limit 1;

  if found and v_existing.eligibility_state = 'reserved' and v_existing.expires_at > now() then
    return jsonb_build_object(
      'status', 'reserved',
      'eligibility_id', v_existing.id,
      'client_operation_id', v_existing.client_operation_id,
      'expires_at', v_existing.expires_at
    );
  end if;

  if found and v_existing.eligibility_state = 'submitted' then
    return jsonb_build_object(
      'status', 'submitted',
      'eligibility_id', v_existing.id,
      'client_operation_id', v_existing.client_operation_id,
      'comment_id', v_existing.comment_id
    );
  end if;

  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  v_token_hash := encode(extensions.digest(convert_to(v_token, 'utf8'), 'sha256'), 'hex');
  v_handle := v_token || '.' || v_token_hash;

  begin
    insert into pim.ai_activity_triage_eligibility (
      requester_profile_id, client_operation_id, eligibility_version,
      product_id, source_body_revision, eligibility_state,
      reservation_token_hash, recovery_handle_mac, expires_at
    ) values (
      v_profile, p_client_operation_id,
      coalesce((select max(e2.eligibility_version) from pim.ai_activity_triage_eligibility e2
                where e2.requester_profile_id = v_profile
                  and e2.client_operation_id = p_client_operation_id), 0) + 1,
      p_product_id, 1, 'reserved',
      v_token_hash, v_token_hash, now() + interval '7 days'
    )
    returning * into v_row;
  exception when unique_violation then
    -- Concurrent double-reserve returns the winner's reservation.
    select * into v_existing
    from pim.ai_activity_triage_eligibility e
    where e.requester_profile_id = v_profile
      and e.client_operation_id = p_client_operation_id
    order by e.eligibility_version desc
    limit 1;
    if found and v_existing.eligibility_state = 'reserved' and v_existing.expires_at > now() then
      return jsonb_build_object(
        'status', 'reserved',
        'eligibility_id', v_existing.id,
        'client_operation_id', v_existing.client_operation_id,
        'expires_at', v_existing.expires_at
      );
    end if;
    raise;
  end;

  return jsonb_build_object(
    'status', 'reserved',
    'eligibility_id', v_row.id,
    'client_operation_id', v_row.client_operation_id,
    'recovery_handle', v_handle,
    'expires_at', v_row.expires_at
  );
end $function$
;
revoke all on function api.pm_reserve_product_comment_operation(p_product_id uuid, p_client_operation_id uuid) from public, anon, authenticated;
grant execute on function api.pm_reserve_product_comment_operation(p_product_id uuid, p_client_operation_id uuid) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_update_dependency_status(p_activity_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_row app.activity%rowtype;
  v_status text;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  v_status := lower(btrim(p_status));
  if v_status is null or v_status not in ('open', 'waiting', 'resolved', 'canceled') then
    raise exception using errcode = '22023', message = 'PM_INVALID_DEPENDENCY_STATUS';
  end if;

  select * into v_row from app.activity a where a.id = p_activity_id for update;
  if not found or v_row.action <> 'pm_dependency' then
    raise exception using errcode = 'P0002', message = 'PM_DEPENDENCY_NOT_FOUND';
  end if;

  update app.activity
  set payload = payload || jsonb_build_object('status', v_status)
  where id = p_activity_id;

  return jsonb_build_object('status', v_status, 'id', p_activity_id);
end $function$
;
revoke all on function api.pm_update_dependency_status(p_activity_id uuid, p_status text) from public, anon, authenticated;
grant execute on function api.pm_update_dependency_status(p_activity_id uuid, p_status text) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_update_reminder_status(p_notification_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_row app.notification%rowtype;
  v_status text;
begin
  v_profile := pim.pm_jev_require_admin_pm_writer();
  v_status := lower(btrim(p_status));
  if v_status is null or v_status not in ('open', 'snoozed', 'done', 'canceled') then
    raise exception using errcode = '22023', message = 'PM_INVALID_REMINDER_STATUS';
  end if;

  select * into v_row from app.notification n where n.id = p_notification_id for update;
  if not found or v_row.app <> 'pm' or v_row.profile_id <> v_profile then
    raise exception using errcode = 'P0002', message = 'PM_REMINDER_NOT_FOUND';
  end if;

  update app.notification
  set payload = payload || jsonb_build_object('status', v_status),
      read_at = case when v_status in ('done', 'canceled') then now() else read_at end
  where id = p_notification_id;

  return jsonb_build_object('status', v_status, 'id', p_notification_id);
end $function$
;
revoke all on function api.pm_update_reminder_status(p_notification_id uuid, p_status text) from public, anon, authenticated;
grant execute on function api.pm_update_reminder_status(p_notification_id uuid, p_status text) to authenticated;
CREATE OR REPLACE FUNCTION api.pm_verify_jev_runtime_fence(p_triage_id uuid, p_lease_token_hash text, p_release_digest text, p_emergency_generation integer, p_timestamp timestamp with time zone, p_nonce text, p_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
  v_row pim.ai_activity_triage%rowtype;
  v_key text;
  v_canon text;
  v_expected text;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  select * into v_row
  from pim.ai_activity_triage t where t.id = p_triage_id;
  if not found or v_row.requester_profile_id <> v_profile then
    return jsonb_build_object('allowed', false, 'reason', 'unavailable');
  end if;
  if v_row.state not in ('claimed', 'leased') then
    return jsonb_build_object('allowed', false, 'reason', 'state');
  end if;
  if v_row.lease_token_hash is null or v_row.lease_token_hash <> p_lease_token_hash then
    return jsonb_build_object('allowed', false, 'reason', 'lease');
  end if;
  if p_signature is null or length(btrim(p_signature)) < 32 then
    return jsonb_build_object('allowed', false, 'reason', 'signature');
  end if;
  if p_timestamp is null or p_timestamp < now() - interval '5 minutes'
     or p_timestamp > now() + interval '5 minutes' then
    return jsonb_build_object('allowed', false, 'reason', 'expired');
  end if;
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'jev_envelope_hmac_key';
  exception when others then
    return jsonb_build_object('allowed', false, 'reason', 'key_unavailable');
  end;
  if v_key is null or length(v_key) < 16 then
    return jsonb_build_object('allowed', false, 'reason', 'key_unavailable');
  end if;
  v_canon := 'fence|' || p_triage_id::text || '|' || coalesce(p_lease_token_hash, '') || '|'
    || coalesce(p_release_digest, '') || '|' || coalesce(p_emergency_generation::text, '') || '|'
    || extract(epoch from p_timestamp)::text || '|' || coalesce(p_nonce, '');
  v_expected := encode(extensions.hmac(convert_to(v_canon, 'utf8'), convert_to(v_key, 'utf8'), 'sha256'), 'hex');
  if v_expected <> lower(btrim(p_signature)) then
    return jsonb_build_object('allowed', false, 'reason', 'signature');
  end if;

  return jsonb_build_object('allowed', true, 'emergency_generation', 0);
end $function$
;
revoke all on function api.pm_verify_jev_runtime_fence(p_triage_id uuid, p_lease_token_hash text, p_release_digest text, p_emergency_generation integer, p_timestamp timestamp with time zone, p_nonce text, p_signature text) from public, anon, authenticated;
grant execute on function api.pm_verify_jev_runtime_fence(p_triage_id uuid, p_lease_token_hash text, p_release_digest text, p_emergency_generation integer, p_timestamp timestamp with time zone, p_nonce text, p_signature text) to authenticated;
CREATE OR REPLACE FUNCTION api.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid DEFAULT NULL::uuid, p_core_character_id uuid DEFAULT NULL::uuid, p_core_style_guide_id uuid DEFAULT NULL::uuid, p_dam_asset_id uuid DEFAULT NULL::uuid, p_resolution_reason text DEFAULT NULL::text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS plm.source_resolution
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Thin delegation on purpose. Any validation copied here would be a second,
  -- silently diverging rule set; the setter is the only write path.
  return plm.set_source_resolution(
    p_source_system,
    p_entity_kind,
    p_source_id,
    p_resolution_status,
    p_core_property_id,
    p_core_character_id,
    p_core_style_guide_id,
    p_dam_asset_id,
    p_resolution_reason,
    p_expected_updated_at
  );
end;
$function$
;
revoke all on function api.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone) from public, anon, authenticated;
grant execute on function api.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone) to authenticated;
grant execute on function api.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone) to service_role;
CREATE OR REPLACE FUNCTION api.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone, p_core_licensor_id uuid, p_core_franchise_id uuid)
 RETURNS plm.source_resolution
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  return plm.set_source_resolution(
    p_source_system,
    p_entity_kind,
    p_source_id,
    p_resolution_status,
    p_core_property_id,
    p_core_character_id,
    p_core_style_guide_id,
    p_dam_asset_id,
    p_resolution_reason,
    p_expected_updated_at,
    p_core_licensor_id,
    p_core_franchise_id
  );
end;
$function$
;
revoke all on function api.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone, p_core_licensor_id uuid, p_core_franchise_id uuid) from public, anon, authenticated;
grant execute on function api.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone, p_core_licensor_id uuid, p_core_franchise_id uuid) to authenticated;
grant execute on function api.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone, p_core_licensor_id uuid, p_core_franchise_id uuid) to service_role;
CREATE OR REPLACE FUNCTION api.source_capture_inventory_exact(p_table_name text DEFAULT NULL::text)
 RETURNS TABLE(source_system text, table_name name, row_count bigint, carries_resolution boolean, table_comment text, retained_row_count bigint, latest_complete_row_count bigint, count_basis text, latest_complete_status text, count_note text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'api', 'plm'
AS $function$
with latest as (
  select
    (select capture_id from plm.pmt_capture
      where status = 'complete' and capture_kind = 'full'
      order by completed_at desc nulls last, started_at desc, capture_id desc limit 1)
      as pmt_capture_id,
    (select id from plm.nbcu_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as nbcu_capture_id,
    (select crawl_id from plm.dcp_crawl
      where status = 'complete'
      order by captured_on desc, finished_at desc, crawl_id desc limit 1)
      as dcp_crawl_id,
    (select metadata_run_id from plm.dcp_metadata_run
      where status = 'complete'
      order by captured_on desc, finished_at desc, metadata_run_id desc limit 1)
      as dcp_metadata_run_id,
    (select id from plm.sega_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_capture_id,
    (select id from plm.sega_submission_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_submission_capture_id,
    (select id from plm.peanuts_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as peanuts_capture_id,
    (select id from plm.wildbrain_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as wildbrain_capture_id,
    (select id from plm.sesame_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sesame_capture_id,
    (select id from plm.coke_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as coke_capture_id,
    (select id from plm.pmt_trackerplus_submission_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as pmt_trackerplus_capture_id,
    -- Restored from 20260909115140: the coherent OPA capture root. Dropping it here
    -- would silently revert the three append-only OPA tables to a snapshot count.
    (select id from plm.opa_capture where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as opa_capture_id
), catalog as (
  select
    c.oid,
    c.relname,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'capture_id') as has_capture_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped
      and a.attname = 'submission_capture_id') as has_submission_capture_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'crawl_id') as has_crawl_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'metadata_run_id') as has_metadata_run_id,
    exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        and a.attname in ('core_property_id','core_character_id','core_licensor_id',
                          'resolved_at','resolution_status')
    ) as carries_resolution,
    obj_description(c.oid, 'pg_class') as table_comment
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'plm' and c.relkind = 'r'
    and (p_table_name is null or c.relname = p_table_name)
), classified as (
  select c.*,
    case
      when c.relname like 'dcp\_%' or c.relname like 'opa\_%' then 'disney'
      when c.relname like 'pmt\_%' then 'paramount'
      when c.relname like 'nbcu\_%' then 'nbcu'
      when c.relname like 'wb\_%' then 'warner'
      when c.relname like 'erp\_%' then 'coldlion'
      when c.relname like 'sega\_%' then 'sega'
      when c.relname like 'peanuts\_%' then 'peanuts'
      -- Appended BELOW every pre-existing arm, so nothing above can change meaning. It
      -- cannot be shadowed by the `wb\_%` -> warner arm either: `wildbrain_` does not
      -- start with `wb_`.
      when c.relname like 'wildbrain\_%' then 'wildbrain'
      -- Appended below every pre-existing arm; no earlier classification changes.
      when c.relname like 'sesame\_%' then 'sesame'
      when c.relname like 'coke\_%' then 'coca-cola'
      -- Appended below every pre-existing arm. These two families landed AFTER the
      -- inventory was written and were reported as 'other'. Neither can shadow an
      -- earlier arm: no earlier prefix is a prefix of 'marvel_' or 'wwe_'.
      when c.relname like 'lucasfilm\_dcp\_%' then 'lucasfilm_dcpvault'
      when c.relname like 'twentieth_century\_dcp\_%' then 'twentieth_century_dcpvault'
      when c.relname like 'marvel\_%' then 'marvel'
      when c.relname like 'wwe\_%' then 'wwe'
      else 'other'
    end as source_system
  from catalog c
), counted as (
  select c.*, l.*,
    (xpath('/row/cnt/text()', query_to_xml(
      format('select count(*) as cnt from plm.%I', c.relname), false, true, ''
    )))[1]::text::bigint as retained_count,
    case
      -- The three append-only OPA capture tables must use one completed root. These
      -- arms come from 20260909115140 and must stay AHEAD of the broader mutable OPA
      -- current-snapshot family below.
      when c.relname = 'opa_capture' then
        case when l.opa_capture_id is null then null else 1::bigint end
      when c.relname in ('opa_capture_scope', 'opa_property_character_capture') then
        case when l.opa_capture_id is null then null else
          (xpath('/row/cnt/text()', query_to_xml(format(
            'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
            c.relname, l.opa_capture_id::text), false, true, '')))[1]::text::bigint
        end

      -- Other OPA tables are deliberately upserted current state, not retained captures.
      when c.relname like 'opa\_%' then
        (xpath('/row/cnt/text()', query_to_xml(
          format('select count(*) as cnt from plm.%I', c.relname), false, true, ''
        )))[1]::text::bigint

      -- Paramount TrackerPlus submissions have their own complete-capture clock and are
      -- tested BEFORE the pmt_ arms below, which would otherwise pin them to the
      -- Creative Library capture. The inner null test keeps them off that clock even
      -- when no complete TrackerPlus capture exists yet.
      when c.relname = 'pmt_trackerplus_submission_capture' then
        case when l.pmt_trackerplus_capture_id is null then null else 1::bigint end
      when c.relname like 'pmt\_trackerplus\_%' and c.has_capture_id then
        case when l.pmt_trackerplus_capture_id is null then null else
          (xpath('/row/cnt/text()', query_to_xml(format(
            'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
            c.relname, l.pmt_trackerplus_capture_id::text), false, true, '')))[1]::text::bigint
        end

      -- Paramount: one latest complete FULL capture, matching api.pmt_latest_complete_capture.
      when c.relname = 'pmt_capture' then case when l.pmt_capture_id is null then null else 1::bigint end
      when c.relname like 'pmt\_%' and c.has_capture_id and l.pmt_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.pmt_capture_id::text), false, true, '')))[1]::text::bigint

      -- NBCU: one latest complete capture; rejected and abandoned attempts stay retained only.
      when c.relname = 'nbcu_capture' then case when l.nbcu_capture_id is null then null else 1::bigint end
      when c.relname like 'nbcu\_%' and c.has_capture_id and l.nbcu_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.nbcu_capture_id::text), false, true, '')))[1]::text::bigint

      -- Sega submission vocabulary has its own complete-capture clock.
      when c.relname = 'sega_submission_capture' then
        case when l.sega_submission_capture_id is null then null else 1::bigint end
      when c.relname = 'sega_submission_property' and c.has_submission_capture_id
           and l.sega_submission_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where submission_capture_id = %L::uuid',
          c.relname, l.sega_submission_capture_id::text), false, true, '')))[1]::text::bigint

      -- Sega asset evidence: one latest complete capture.
      when c.relname = 'sega_capture' then case when l.sega_capture_id is null then null else 1::bigint end
      when c.relname like 'sega\_%' and c.has_capture_id and l.sega_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.sega_capture_id::text), false, true, '')))[1]::text::bigint

      -- Peanuts: identical contract to NBCU and Sega -- one latest complete capture, and
      -- loading, rejected and abandoned attempts stay retained only.
      when c.relname = 'peanuts_capture' then case when l.peanuts_capture_id is null then null else 1::bigint end
      when c.relname like 'peanuts\_%' and c.has_capture_id and l.peanuts_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.peanuts_capture_id::text), false, true, '')))[1]::text::bigint

      -- WildBrain: identical contract to NBCU, Sega and Peanuts -- one latest complete
      -- capture, and loading, rejected and abandoned attempts stay retained only.
      when c.relname = 'wildbrain_capture' then case when l.wildbrain_capture_id is null then null else 1::bigint end
      when c.relname like 'wildbrain\_%' and c.has_capture_id and l.wildbrain_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.wildbrain_capture_id::text), false, true, '')))[1]::text::bigint

      -- Sesame: identical complete-capture contract to NBCU, Sega, Peanuts and WildBrain.
      when c.relname = 'sesame_capture' then case when l.sesame_capture_id is null then null else 1::bigint end
      when c.relname like 'sesame\_%' and c.has_capture_id and l.sesame_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.sesame_capture_id::text), false, true, '')))[1]::text::bigint

      -- Coca-Cola: one latest complete capture; incomplete attempts remain retained only.
      when c.relname = 'coke_capture' then case when l.coke_capture_id is null then null else 1::bigint end
      when c.relname like 'coke\_%' and c.has_capture_id and l.coke_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.coke_capture_id::text), false, true, '')))[1]::text::bigint

      -- DCP path crawl: asset identity is stable, so membership comes through dcp_asset_crawl.
      when c.relname = 'dcp_crawl' then case when l.dcp_crawl_id is null then null else 1::bigint end
      when c.relname = 'dcp_asset' and l.dcp_crawl_id is not null then
        (select count(*) from plm.dcp_asset_crawl ac where ac.crawl_id = l.dcp_crawl_id)
      when c.relname like 'dcp\_%' and c.has_crawl_id and l.dcp_crawl_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where crawl_id = %L::uuid',
          c.relname, l.dcp_crawl_id::text), false, true, '')))[1]::text::bigint
      when c.relname = 'dcp_crawl_gap' and l.dcp_crawl_id is not null then
        (select count(*) from plm.dcp_crawl_gap g
          join plm.dcp_crawl_section s on s.id = g.crawl_section_id
          where s.crawl_id = l.dcp_crawl_id)

      -- DCP metadata has its own complete-run clock, separate from path crawls.
      when c.relname = 'dcp_metadata_run' then
        case when l.dcp_metadata_run_id is null then null else 1::bigint end
      when c.relname like 'dcp\_%' and c.has_metadata_run_id
           and l.dcp_metadata_run_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where metadata_run_id = %L::uuid',
          c.relname, l.dcp_metadata_run_id::text), false, true, '')))[1]::text::bigint
      else null
    end as latest_count
  from classified c cross join latest l
)
select
  source_system,
  relname as table_name,
  retained_count as row_count,
  carries_resolution,
  table_comment,
  retained_count as retained_row_count,
  latest_count as latest_complete_row_count,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture')
      then 'latest_complete'
    when relname like 'opa\_%' then 'current_snapshot'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
      then 'latest_complete'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then 'latest_complete'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then 'latest_complete'
    when relname in ('sega_submission_capture','sega_submission_property') then 'latest_complete'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then 'latest_complete'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then 'latest_complete'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id) then 'latest_complete'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then 'latest_complete'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id) then 'latest_complete'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id) then 'latest_complete'
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then 'latest_complete'
    else 'retained_only'
  end as count_basis,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture')
      then case when opa_capture_id is null then null else 'complete' end
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
      then case when pmt_trackerplus_capture_id is null then null else 'complete' end
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id)
      then case when pmt_capture_id is null then null else 'complete' end
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id)
      then case when nbcu_capture_id is null then null else 'complete' end
    when relname in ('sega_submission_capture','sega_submission_property')
      then case when sega_submission_capture_id is null then null else 'complete' end
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
      then case when sega_capture_id is null then null else 'complete' end
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id)
      then case when peanuts_capture_id is null then null else 'complete' end
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id)
      then case when wildbrain_capture_id is null then null else 'complete' end
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
      then case when sesame_capture_id is null then null else 'complete' end
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id)
      then case when coke_capture_id is null then null else 'complete' end
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id)
      then case when dcp_crawl_id is null then null else 'complete' end
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then case when dcp_metadata_run_id is null then null else 'complete' end
    else null
  end as latest_complete_status,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture') then
      case when opa_capture_id is null
        then 'No complete coherent OPA capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete coherent OPA capture; loading and rejected roots are excluded and no licensed row value is exposed.' end
    when relname like 'opa\_%' then
      'Current upserted OPA snapshot; coherent capture evidence is available only on the three capture tables.'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
         and pmt_trackerplus_capture_id is null then
      'No complete Paramount TrackerPlus submission capture exists; latest-complete count is unknown, not zero.'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id) then
      'Latest complete Paramount TrackerPlus submission capture; loading and rejected captures excluded.'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id)
         and pmt_capture_id is null then
      'No complete full Paramount capture exists; latest-complete count is unknown, not zero.'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then
      'Latest complete full Paramount capture; failed, abandoned, targeted and test captures excluded.'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id)
         and nbcu_capture_id is null then
      'No complete NBCU capture exists; latest-complete count is unknown, not zero.'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then
      'Latest complete NBCU capture; loading, rejected and abandoned captures excluded.'
    when relname in ('sega_submission_capture','sega_submission_property')
         and sega_submission_capture_id is null then
      'No complete Sega submission vocabulary capture exists; latest-complete count is unknown, not zero.'
    when relname in ('sega_submission_capture','sega_submission_property') then
      'Latest complete read-only Sega submission vocabulary capture; rejected attempts excluded.'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
         and sega_capture_id is null then
      'No complete Sega capture exists; latest-complete count is unknown, not zero.'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then
      'Latest complete Sega capture; loading, rejected and abandoned captures excluded.'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id)
         and peanuts_capture_id is null then
      'No complete Peanuts capture exists; latest-complete count is unknown, not zero.'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then
      'Latest complete Peanuts capture; loading, rejected and abandoned captures excluded.'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id)
         and wildbrain_capture_id is null then
      'No complete WildBrain capture exists; latest-complete count is unknown, not zero.'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id) then
      'Latest complete WildBrain capture; loading, rejected and abandoned captures excluded.'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
         and sesame_capture_id is null then
      'No complete Sesame capture exists; latest-complete count is unknown, not zero.'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then
      'Latest complete Sesame capture; loading, rejected and abandoned captures excluded.'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id)
         and coke_capture_id is null then
      'No complete Coca-Cola capture exists; latest-complete count is unknown, not zero.'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id) then
      'Latest complete Coca-Cola capture; loading and rejected captures excluded.'
    when (relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
          or (relname like 'dcp\_%' and has_crawl_id)) and dcp_crawl_id is null then
      'No complete DCP crawl exists; latest-complete membership is unknown, not zero.'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id) then
      'Latest complete DCP path crawl, using immutable crawl membership where required.'
    when (relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id))
         and dcp_metadata_run_id is null then
      'No complete DCP metadata run exists; latest-complete count is unknown, not zero.'
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id) then
      'Latest complete DCP metadata run, separate from the path-crawl clock.'
    when relname = 'dcp_style_guide' then
      'Retained style-guide identities only. Historical latest-complete membership cannot be derived from mutable last_seen_crawl_id; NULL is intentional.'
    when relname like 'dcp\_%' then
      'Retained DCP rows only; this table has no exact immutable latest-complete membership path.'
    else
      'Retained rows only; no source-specific latest-complete contract is defined for this table.'
  end as count_note
from counted;
$function$
;
revoke all on function api.source_capture_inventory_exact(p_table_name text) from public, anon, authenticated;
grant execute on function api.source_capture_inventory_exact(p_table_name text) to authenticated;
grant execute on function api.source_capture_inventory_exact(p_table_name text) to service_role;
CREATE OR REPLACE FUNCTION app.comment_body_revision_trg_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.body_revision is null then
      new.body_revision := 1;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.body is distinct from old.body then
    new.body_revision := greatest(coalesce(old.body_revision, 1), 1) + 1;
    new.updated_at := now();
  end if;
  return new;
end $function$
;
revoke all on function app.comment_body_revision_trg_fn() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION app.dflow_admin_assume_actor(p_actor_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_auth_user_id uuid;
begin
  select p.auth_user_id into v_auth_user_id
  from app.profile p
  where p.id = p_actor_profile_id
    and p.status = 'active'
    and p.auth_user_id is not null
    and exists (
      select 1 from app.user_role ur
      join app.role r on r.id = ur.role_id
      where ur.profile_id = p.id and ur.revoked_at is null and r.slug = 'administrator'
    );

  if p_actor_profile_id is null or v_auth_user_id is null then
    raise exception 'dflow: actor is not an active administrator'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('request.jwt.claim.sub', v_auth_user_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_auth_user_id::text, 'role', 'authenticated')::text, true);
end;
$function$
;
revoke all on function app.dflow_admin_assume_actor(p_actor_profile_id uuid) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION app.dflow_admin_restore_claims(p_sub text, p_claims text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(p_claims, ''), true);
end;
$function$
;
revoke all on function app.dflow_admin_restore_claims(p_sub text, p_claims text) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION app.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_profile_id uuid;
  v_admin_role_id uuid;
  v_crm_app app.app_name := 'crm';
  v_dam_app app.app_name := 'dam';
  v_pm_app app.app_name := 'pm';
begin
  -- Upsert profile (in case a pre-seeded profile exists with matching email)
  insert into app.profile (auth_user_id, email, display_name, provider, status)
  values (
    new.id,
    new.email::extensions.citext,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    new.raw_app_meta_data->>'provider',
    'active'
  )
  on conflict (auth_user_id) do update
    set email        = excluded.email,
        display_name = coalesce(excluded.display_name, app.profile.display_name),
        provider     = excluded.provider
  returning id into v_profile_id;

  -- Grant CRM access for everyone who logs in (single-app context; admins can revoke)
  insert into app.app_access (profile_id, app)
  values (v_profile_id, v_crm_app)
  on conflict (profile_id, app) do nothing;

  -- Every POP Creations employee gets PopDAM access (owner rule, u2giants/popdam3#185).
  -- `do nothing` keeps an admin's earlier revocation in place.
  -- Whole-address match: exactly one '@', domain exactly popcre.com (no subdomains).
  if lower(new.email) ~ ('^[^@]+' || '@' || 'popcre[.]com$') then
    insert into app.app_access (profile_id, app)
    values (v_profile_id, v_dam_app)
    on conflict (profile_id, app) do nothing;

    -- Microsoft-SSO employees also get PopPIM (owner rule, u2giants/popdam3#545).
    if new.raw_app_meta_data->>'provider' = 'azure' then
      insert into app.app_access (profile_id, app)
      values (v_profile_id, v_pm_app)
      on conflict (profile_id, app) do nothing;
    end if;
  end if;

  -- Grant administrator role to the two owner emails, unchanged from 20260715184500
  -- Same whole-string, case-insensitive equality as the base `ilike` (no wildcards), written
  -- as concatenations so no address literal is added (PII forward guard).
  if lower(new.email) = 'u2giants' || '@' || 'gmail.com'
     or lower(new.email) = 'albert' || '@' || 'popcre.com' then
    select id into v_admin_role_id from app.role where slug = 'administrator';
    if v_admin_role_id is not null then
      insert into app.user_role (profile_id, role_id)
      values (v_profile_id, v_admin_role_id)
      on conflict (profile_id, role_id) do nothing;
    end if;
  end if;

  return new;
end;
$function$
;
revoke all on function app.handle_new_auth_user() from public, anon, authenticated;
grant execute on function app.handle_new_auth_user() to public;
grant execute on function app.handle_new_auth_user() to service_role;
CREATE OR REPLACE FUNCTION coldlion.rotate_change_log(p_dry_run boolean DEFAULT true)
 RETURNS TABLE(tier text, deleted bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'coldlion'
 SET lock_timeout TO '2s'
AS $function$
declare
  v_now timestamptz := now();
  v_week timestamptz := v_now - interval '7 days';
  v_two_months timestamptz := v_now - interval '2 months';
  v_year timestamptz := v_now - interval '1 year';
  v_batch int;
begin
  drop table if exists pg_temp._coldlion_rotation;
  create temp table _coldlion_rotation (id uuid primary key, tier text not null) on commit drop;

  insert into _coldlion_rotation (id, tier)
  select x.id, x.tier
    from (
      select c.id, c.changed_at,
             case when c.changed_at < v_year then 'older_than_1_year'
                  when c.changed_at < v_two_months then 'weekly_2_months_to_1_year'
                  else 'daily_7_days_to_2_months' end as tier,
             row_number() over (partition by c.table_name, c.natural_key
                                order by c.changed_at desc, c.id desc) as key_rank,
             row_number() over (partition by c.table_name, c.natural_key,
                                case when c.changed_at < v_year then null
                                     when c.changed_at < v_two_months
                                       then date_trunc('week', c.changed_at at time zone 'America/New_York')
                                     when c.changed_at < v_week
                                       then date_trunc('day', c.changed_at at time zone 'America/New_York')
                                     else c.changed_at at time zone 'UTC' end,
                                (c.changed_at < v_year)
                                order by c.changed_at desc, c.id desc) as bucket_rank
        from coldlion.change_log c
    ) x
   where x.changed_at < v_week
     and x.key_rank > 1
     and (x.tier = 'older_than_1_year' or x.bucket_rank > 1);

  if not p_dry_run then
    loop
      with batch as (
        select r.id from _coldlion_rotation r
         where exists (select 1 from coldlion.change_log c where c.id = r.id)
         limit 20000
      )
      delete from coldlion.change_log c using batch b where c.id = b.id;
      get diagnostics v_batch = row_count;
      exit when v_batch = 0;
    end loop;
  end if;

  return query
  select t.tier, coalesce(count(r.id), 0)::bigint
    from (values ('daily_7_days_to_2_months', 1), ('weekly_2_months_to_1_year', 2), ('older_than_1_year', 3)) t(tier, ord)
    left join _coldlion_rotation r on r.tier = t.tier
   group by t.tier, t.ord
   order by t.ord;
end;
$function$
;
revoke all on function coldlion.rotate_change_log(p_dry_run boolean) from public, anon, authenticated;
grant execute on function coldlion.rotate_change_log(p_dry_run boolean) to service_role;
CREATE OR REPLACE FUNCTION core.guard_character_alias_licensor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'pg_catalog'
AS $function$
declare
  v_parent_licensor uuid;
  v_found           boolean;
begin
  select c.licensor_id, true into v_parent_licensor, v_found
  from core.character c
  where c.id = new.character_id;

  if not coalesce(v_found, false) then
    raise exception 'core.character_alias refused: no core.character row %', new.character_id
      using errcode = 'P0001';
  end if;

  if v_parent_licensor is null then
    raise exception
      'core.character_alias refused: core.character % has no licensor, so an alias for it cannot be scoped -- an unscoped alias is a name coincidence, not an identity',
      new.character_id
      using errcode = 'P0001';
  end if;

  if new.licensor_id <> v_parent_licensor then
    raise exception
      'core.character_alias refused: licensor_id % is not the licensor % of character % -- an alias may never cross a licensor boundary',
      new.licensor_id, v_parent_licensor, new.character_id
      using errcode = 'P0001';
  end if;

  return new;
end
$function$
;
revoke all on function core.guard_character_alias_licensor() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION core.merge_customer(p_loser uuid, p_survivor uuid, p_alias_loser_name boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'crm', 'pim', 'dam', 'plm', 'app', 'public'
AS $function$
declare
  v_loser_name text;
  v_loser_display text;
begin
  if p_loser = p_survivor then
    raise exception 'merge_customer: loser and survivor are the same (%).', p_loser;
  end if;
  if not exists (select 1 from core.customer where id = p_survivor) then
    raise exception 'merge_customer: survivor % does not exist.', p_survivor;
  end if;
  select name, display_name into v_loser_name, v_loser_display
  from core.customer where id = p_loser;
  if not found then
    raise exception 'merge_customer: loser % does not exist.', p_loser;
  end if;

  -- Serialize concurrent attempts for the same pair in a stable order.
  perform pg_advisory_xact_lock(hashtextextended(least(p_loser::text, p_survivor::text), 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(p_loser::text, p_survivor::text), 0));

  -- Per-app 1:1 rows: move one-sided data, collapse identical rows, and stop
  -- before data loss when business fields differ.
  perform core.reconcile_merge_extension_row('crm.customer_ext', 'customer_id', p_loser, p_survivor);
  perform core.reconcile_merge_extension_row('pim.customer_ext', 'customer_id', p_loser, p_survivor);
  perform core.reconcile_merge_extension_row('dam.customer_ext', 'customer_id', p_loser, p_survivor);

  -- Customer Channels are set membership. Preserve the survivor assignment on
  -- duplicate membership and move every loser-only assignment.
  delete from core.customer_channel lc
  where lc.customer_id = p_loser
    and exists (
      select 1 from core.customer_channel sc
      where sc.customer_id = p_survivor and sc.channel_id = lc.channel_id
    );
  update core.customer_channel set customer_id = p_survivor where customer_id = p_loser;

  -- CRM department/company consistency must be resolved before ordinary FK
  -- repoints because enforcement triggers validate both columns together.
  update core.contact_company cc
  set company_id = p_survivor, crm_department_id = s.id
  from crm.department l
  join crm.department s on s.company_id = p_survivor and s.name = l.name
  where l.company_id = p_loser and cc.crm_department_id = l.id;

  update crm.opportunity o
  set company_id = p_survivor, department_id = s.id
  from crm.department l
  join crm.department s on s.company_id = p_survivor and s.name = l.name
  where l.company_id = p_loser and o.department_id = l.id;

  delete from crm.department l
  where l.company_id = p_loser
    and exists (
      select 1 from crm.department s
      where s.company_id = p_survivor and s.name = l.name
    );
  update crm.department set company_id = p_survivor where company_id = p_loser;

  delete from core.contact_company lc
  where lc.company_id = p_loser
    and exists (
      select 1 from core.contact_company sc
      where sc.company_id = p_survivor and sc.contact_id = lc.contact_id
    );
  update core.contact_company set company_id = p_survivor where company_id = p_loser;
  update crm.opportunity set company_id = p_survivor where company_id = p_loser;

  delete from core.customer_alias la
  where la.customer_id = p_loser
    and exists (
      select 1 from core.customer_alias sa
      where sa.customer_id = p_survivor
        and sa.normalized_alias = la.normalized_alias
    );
  update core.customer_alias set customer_id = p_survivor where customer_id = p_loser;

  update core.company_source_ref set company_id = p_survivor where company_id = p_loser;

  update core.factory set company_id = p_survivor where company_id = p_loser;
  update crm.email_message set company_id = p_survivor where company_id = p_loser;
  update crm.ingested_domain set customer_id = p_survivor where customer_id = p_loser;
  update crm.licensor_approval_thread set company_id = p_survivor where company_id = p_loser;
  update crm.meeting_note set company_id = p_survivor where company_id = p_loser;
  update crm.note set company_id = p_survivor where company_id = p_loser;
  update crm.task set company_id = p_survivor where company_id = p_loser;
  update dam.asset set company_id = p_survivor where company_id = p_loser;
  update dam.style_group set company_id = p_survivor where company_id = p_loser;
  update dam.style_guide_file set company_id = p_survivor where company_id = p_loser;
  update pim.customer_order set company_id = p_survivor where company_id = p_loser;
  update pim.design_collection set company_id = p_survivor where company_id = p_loser;
  update pim.product set company_id = p_survivor where company_id = p_loser;
  update pim.project set company_id = p_survivor where company_id = p_loser;
  update plm.customer_import set company_id = p_survivor where company_id = p_loser;
  update plm.erp_customer set customer_id = p_survivor where customer_id = p_loser;
  update plm.item set company_id = p_survivor where company_id = p_loser;


  update plm.production_order set company_id = p_survivor where company_id = p_loser;
  update plm.rfq_group set company_id = p_survivor where company_id = p_loser;
  update plm.style_tracker_item_bridge set company_id = p_survivor where company_id = p_loser;
  update public.assets set customer_id = p_survivor where customer_id = p_loser;
  update public.style_groups set customer_id = p_survivor where customer_id = p_loser;
  update public.style_tracker_rows set customer_id = p_survivor where customer_id = p_loser;

  if p_alias_loser_name then
    insert into core.customer_alias (customer_id, alias, alias_type, source_system, notes)
    select p_survivor, v_loser_name, 'other', 'merge', 'from merged customer ' || p_loser
    on conflict (customer_id, normalized_alias) do nothing;
    if v_loser_display is not null and lower(v_loser_display) <> lower(v_loser_name) then
      insert into core.customer_alias (customer_id, alias, alias_type, source_system, notes)
      select p_survivor, v_loser_display, 'other', 'merge',
        'display name from merged customer ' || p_loser
      on conflict (customer_id, normalized_alias) do nothing;
    end if;
  end if;

  delete from core.customer where id = p_loser;
end;
$function$
;
revoke all on function core.merge_customer(p_loser uuid, p_survivor uuid, p_alias_loser_name boolean) from public, anon, authenticated;
grant execute on function core.merge_customer(p_loser uuid, p_survivor uuid, p_alias_loser_name boolean) to service_role;
CREATE OR REPLACE FUNCTION core.merge_factory(p_loser uuid, p_survivor uuid, p_alias_loser_name boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'crm', 'pim', 'dam', 'plm', 'app', 'public'
AS $function$
declare
  v_loser_name text;
  v_loser_display text;
  v_loser core.factory%rowtype;
begin
  if p_loser = p_survivor then
    raise exception 'merge_factory: loser and survivor are the same (%).', p_loser;
  end if;
  if not exists (select 1 from core.factory where id = p_survivor) then
    raise exception 'merge_factory: survivor % does not exist.', p_survivor;
  end if;
  select name, display_name into v_loser_name, v_loser_display
  from core.factory where id = p_loser;
  if not found then
    raise exception 'merge_factory: loser % does not exist.', p_loser;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(p_loser::text, p_survivor::text), 1));
  perform pg_advisory_xact_lock(hashtextextended(greatest(p_loser::text, p_survivor::text), 1));

  perform core.reconcile_merge_extension_row('crm.factory_ext', 'factory_id', p_loser, p_survivor);
  perform core.reconcile_merge_extension_row('pim.factory_ext', 'factory_id', p_loser, p_survivor);
  perform core.reconcile_merge_extension_row('dam.factory_ext', 'factory_id', p_loser, p_survivor);

  delete from core.vendor_contact lc
  where lc.factory_id = p_loser
    and exists (
      select 1 from core.vendor_contact sc
      where sc.factory_id = p_survivor
        and sc.contact_id is not distinct from lc.contact_id
        and sc.role is not distinct from lc.role
    );
  update core.vendor_contact set factory_id = p_survivor where factory_id = p_loser;

  delete from core.factory_alias la
  where la.factory_id = p_loser
    and exists (
      select 1 from core.factory_alias sa
      where sa.factory_id = p_survivor
        and sa.normalized_alias = la.normalized_alias
    );
  update core.factory_alias set factory_id = p_survivor where factory_id = p_loser;

  update core.factory_source_ref set factory_id = p_survivor where factory_id = p_loser;

  update crm.opportunity set factory_id = p_survivor where factory_id = p_loser;
  update pim.product set factory_id = p_survivor where factory_id = p_loser;
  update pim.product_sample set factory_id = p_survivor where factory_id = p_loser;
  update plm.erp_vendor set factory_id = p_survivor where factory_id = p_loser;
  update plm.production_order set factory_id = p_survivor where factory_id = p_loser;
  update plm.rfq_vendor set factory_id = p_survivor where factory_id = p_loser;
  update plm.style_tracker_item_bridge set factory_id = p_survivor where factory_id = p_loser;

  -- #4708: owner-reviewed fields fill survivor gaps; link rows move and dedupe.
  select * into v_loser from core.factory where id = p_loser;
  update core.factory set designflow_vendor_id = null where id = p_loser;
  update core.factory s set
    designflow_vendor_id = coalesce(s.designflow_vendor_id, v_loser.designflow_vendor_id),
    party_type = coalesce(s.party_type, v_loser.party_type),
    trade_name = coalesce(s.trade_name, v_loser.trade_name),
    orders_completed = coalesce(s.orders_completed, v_loser.orders_completed),
    orders_with_problem = coalesce(s.orders_with_problem, v_loser.orders_with_problem)
  where s.id = p_survivor;

  insert into core.factory_rep (factory_id, name)
  select p_survivor, name from core.factory_rep where factory_id = p_loser
  on conflict (factory_id, name) do nothing;
  delete from core.factory_rep where factory_id = p_loser;

  update core.factory_vendor_login set factory_id = p_survivor where factory_id = p_loser;

  delete from core.factory_representation
  where (trading_company_id = p_loser and factory_id = p_survivor)
     or (trading_company_id = p_survivor and factory_id = p_loser);
  insert into core.factory_representation (trading_company_id, factory_id)
  select p_survivor, factory_id from core.factory_representation where trading_company_id = p_loser
  on conflict do nothing;
  insert into core.factory_representation (trading_company_id, factory_id)
  select trading_company_id, p_survivor from core.factory_representation where factory_id = p_loser
  on conflict do nothing;
  delete from core.factory_representation where trading_company_id = p_loser or factory_id = p_loser;

  -- Survivor's categories keep their ranks; the loser's extra ones follow, up to five.
  insert into core.factory_product_category (factory_id, product_category_id, rank)
  select p_survivor, l.product_category_id,
         (select coalesce(max(rank), 0) from core.factory_product_category where factory_id = p_survivor)
           + row_number() over (order by l.rank)
  from core.factory_product_category l
  where l.factory_id = p_loser
    and not exists (select 1 from core.factory_product_category s
                    where s.factory_id = p_survivor and s.product_category_id = l.product_category_id)
  order by l.rank
  limit greatest(0, 5 - (select count(*) from core.factory_product_category where factory_id = p_survivor));
  delete from core.factory_product_category where factory_id = p_loser;

  if p_alias_loser_name then
    insert into core.factory_alias (factory_id, alias, alias_type, source_system, notes)
    select p_survivor, v_loser_name, 'other', 'merge', 'from merged factory ' || p_loser
    on conflict (factory_id, normalized_alias) do nothing;
    if v_loser_display is not null and lower(v_loser_display) <> lower(v_loser_name) then
      insert into core.factory_alias (factory_id, alias, alias_type, source_system, notes)
      select p_survivor, v_loser_display, 'other', 'merge',
        'display name from merged factory ' || p_loser
      on conflict (factory_id, normalized_alias) do nothing;
    end if;
  end if;

  delete from core.factory where id = p_loser;
end;
$function$
;
revoke all on function core.merge_factory(p_loser uuid, p_survivor uuid, p_alias_loser_name boolean) from public, anon, authenticated;
grant execute on function core.merge_factory(p_loser uuid, p_survivor uuid, p_alias_loser_name boolean) to service_role;
CREATE OR REPLACE FUNCTION crm.customer_domain_link_ingested()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cd text := lower(trim(both '.' from regexp_replace(btrim(coalesce(new.domain, '')), '^(https?://)?(www\.)?([^/:?#]*).*$', '\3', 'i')));
begin
  if tg_op = 'UPDATE' then
    update crm.ingested_domain d
       set customer_id = null
     where d.customer_id = new.id
       and crm.match_ingested_domain_customer(d.domain::text) is distinct from new.id;
  end if;
  if v_cd <> '' then
    update crm.ingested_domain d
       set customer_id = crm.match_ingested_domain_customer(d.domain::text)
     where d.customer_id is null
       and (lower(d.domain::text) = v_cd or lower(d.domain::text) like '%.' || v_cd)
       and crm.match_ingested_domain_customer(d.domain::text) is not null;
  end if;
  return null;
end;
$function$
;
revoke all on function crm.customer_domain_link_ingested() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION crm.enforce_department_salesperson()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_col text;
  v_new uuid;
  v_old uuid;
begin
  if new.secondary_salesperson_profile_id is not null
     and new.secondary_salesperson_profile_id = new.salesperson_profile_id then
    raise exception 'crm: the second salesperson must differ from the first'
      using errcode = 'invalid_parameter_value';
  end if;

  foreach v_col in array array['salesperson_profile_id', 'secondary_salesperson_profile_id'] loop
    if v_col = 'salesperson_profile_id' then
      v_new := new.salesperson_profile_id;
      v_old := case when tg_op = 'UPDATE' then old.salesperson_profile_id end;
    else
      v_new := new.secondary_salesperson_profile_id;
      v_old := case when tg_op = 'UPDATE' then old.secondary_salesperson_profile_id end;
    end if;
    if v_new is not null
       and (tg_op = 'INSERT' or v_new is distinct from v_old)
       and not exists (
         select 1
         from app.profile p
         join app.user_role ur on ur.profile_id = p.id and ur.revoked_at is null
         join app.role r on r.id = ur.role_id and r.slug = 'sales'
         where p.id = v_new and p.status = 'active'
       ) then
      raise exception 'crm: salesperson must be an active user with the sales role'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  return new;
end;
$function$
;
revoke all on function crm.enforce_department_salesperson() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION crm.ingested_domain_link_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.customer_id is null then
    new.customer_id := crm.match_ingested_domain_customer(new.domain::text);
  end if;
  return new;
end;
$function$
;
revoke all on function crm.ingested_domain_link_customer() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION crm.match_ingested_domain_customer(p_domain text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with m as (
    select c.id
    from core.customer c
    cross join lateral (
      select lower(trim(both '.' from regexp_replace(btrim(c.domain), '^(https?://)?(www\.)?([^/:?#]*).*$', '\3', 'i'))) as cd
    ) n
    where nullif(n.cd, '') is not null
      and (lower(btrim(p_domain)) = n.cd or lower(btrim(p_domain)) like '%.' || n.cd)
  )
  select case when count(*) = 1 then min(id::text)::uuid end from m;
$function$
;
revoke all on function crm.match_ingested_domain_customer(p_domain text) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION dflow.reject_item_assignment_history_rewrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'dflow'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'item assignment history is append-only' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
     or new.rfq_item_id is distinct from old.rfq_item_id
     or new.function_key is distinct from old.function_key
     or new.user_id is distinct from old.user_id
     or new.assigned_by_user_id is distinct from old.assigned_by_user_id
     or new.effective_from is distinct from old.effective_from
     or new.assignment_context is distinct from old.assignment_context
     or new.created_at is distinct from old.created_at
     or old.effective_to is not null
     or new.effective_to is null then
    raise exception 'assignment facts are immutable; only close an active assignment once' using errcode = '55000';
  end if;
  return new;
end
$function$
;
revoke all on function dflow.reject_item_assignment_history_rewrite() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION dflow.reject_item_workflow_action_rewrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'dflow'
AS $function$
begin
  raise exception 'workflow action history is append-only' using errcode = '55000';
end
$function$
;
revoke all on function dflow.reject_item_workflow_action_rewrite() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION pim.pm_complete_activity_triage_worker(p_triage_id uuid, p_lease_token_hash text, p_action_label text, p_result_payload jsonb, p_usage_payload jsonb, p_error_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row pim.ai_activity_triage%rowtype;
begin
  if p_action_label is null or p_action_label not in
    ('routine_update', 'blocker_dependency', 'decision', 'follow_up_reminder', 'unclear') then
    raise exception using errcode = '22023', message = 'PM_INVALID_ACTION_LABEL';
  end if;

  select * into v_row
  from pim.ai_activity_triage
  where id = p_triage_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PM_TRIAGE_NOT_FOUND';
  end if;
  if v_row.state in ('accepted', 'dismissed', 'source_changed', 'expired', 'failed') then
    raise exception using errcode = '22023', message = 'PM_TRIAGE_ALREADY_FINAL';
  end if;
  if v_row.lease_token_hash is null or v_row.lease_token_hash <> p_lease_token_hash then
    raise exception using errcode = '22023', message = 'PM_LEASE_MISMATCH';
  end if;
  if v_row.lease_expires_at is not null and v_row.lease_expires_at < now() then
    raise exception using errcode = '22023', message = 'PM_LEASE_EXPIRED';
  end if;

  update pim.ai_activity_triage
  set state = 'succeeded',
      action_label = p_action_label,
      result_payload = coalesce(p_result_payload, '{}'::jsonb),
      usage_payload = coalesce(p_usage_payload, '{}'::jsonb),
      error_code = p_error_code,
      lease_token_hash = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_triage_id;

  return p_triage_id;
end $function$
;
revoke all on function pim.pm_complete_activity_triage_worker(p_triage_id uuid, p_lease_token_hash text, p_action_label text, p_result_payload jsonb, p_usage_payload jsonb, p_error_code text) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION pim.pm_fail_activity_triage_worker(p_triage_id uuid, p_lease_token_hash text, p_error_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row pim.ai_activity_triage%rowtype;
begin
  if p_error_code is null or length(p_error_code) > 64 then
    raise exception using errcode = '22023', message = 'PM_INVALID_ERROR_CODE';
  end if;

  select * into v_row
  from pim.ai_activity_triage
  where id = p_triage_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PM_TRIAGE_NOT_FOUND';
  end if;
  if v_row.state in ('accepted', 'dismissed', 'source_changed', 'expired', 'failed', 'succeeded') then
    raise exception using errcode = '22023', message = 'PM_TRIAGE_ALREADY_FINAL';
  end if;
  if v_row.lease_token_hash is null or v_row.lease_token_hash <> p_lease_token_hash then
    raise exception using errcode = '22023', message = 'PM_LEASE_MISMATCH';
  end if;
  if v_row.lease_expires_at is not null and v_row.lease_expires_at < now() then
    raise exception using errcode = '22023', message = 'PM_LEASE_EXPIRED';
  end if;

  update pim.ai_activity_triage
  set
    -- Timeouts stay re-leaseable until the retry budget is spent; any other
    -- error is terminal. Late completion from the old lease is still rejected
    -- by the lease-token check on complete.
    state = case
      when p_error_code = 'timeout' and timeout_count < 2 then 'queued'
      else 'failed'
    end,
    error_code = p_error_code,
    timeout_count = case when p_error_code = 'timeout' then timeout_count + 1 else timeout_count end,
    lease_token_hash = null,
    lease_expires_at = null,
    lease_acquired_at = null,
    updated_at = now()
  where id = p_triage_id;

  return p_triage_id;
end $function$
;
revoke all on function pim.pm_fail_activity_triage_worker(p_triage_id uuid, p_lease_token_hash text, p_error_code text) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION pim.pm_jev_require_admin_pm_writer()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile uuid;
begin
  v_profile := app.current_profile_id();
  if v_profile is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;
  if not exists (
    select 1 from app.profile p
    where p.id = v_profile and p.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'PM_PROFILE_INACTIVE';
  end if;
  if not (app.has_app_access('pm') or app.has_role('administrator')) then
    raise exception using errcode = '42501', message = 'PM_ACCESS_DENIED';
  end if;
  if not app.has_role('administrator') then
    raise exception using errcode = '42501', message = 'PM_ADMIN_REQUIRED';
  end if;
  return v_profile;
end $function$
;
revoke all on function pim.pm_jev_require_admin_pm_writer() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION pim.pm_jev_source_changed_trg_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE' and new.body is distinct from old.body then
    update pim.ai_activity_triage
    set state = 'source_changed',
        lease_token_hash = null,
        lease_expires_at = null,
        updated_at = now()
    where live_comment_id = new.id
      and state in ('queued', 'claimed', 'leased', 'succeeded');
    update pim.ai_activity_triage_eligibility
    set eligibility_state = 'source_changed',
        updated_at = now()
    where comment_id = new.id
      and eligibility_state in ('reserved', 'submitted', 'queued');
  end if;
  return new;
end $function$
;
revoke all on function pim.pm_jev_source_changed_trg_fn() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION pim.pm_validate_comment_body(p_body text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v text;
begin
  if p_body is null then
    raise exception using errcode = '22023', message = 'PM_COMMENT_BODY_REQUIRED';
  end if;
  v := btrim(p_body);
  if length(v) < 1 then
    raise exception using errcode = '22023', message = 'PM_COMMENT_BODY_EMPTY';
  end if;
  if length(v) > 4000 then
    raise exception using errcode = '22023', message = 'PM_COMMENT_BODY_TOO_LONG';
  end if;
  -- Reject NUL/controls except tab, newline, carriage return (issue allows those).
  if exists (
    select 1 from unnest(regexp_split_to_array(v, '')) as ch
    where ascii(ch) < 32 and ascii(ch) not in (9, 10, 13)
  ) then
    raise exception using errcode = '22023', message = 'PM_COMMENT_BODY_CONTROL_CHARS';
  end if;
  return v;
end $function$
;
revoke all on function pim.pm_validate_comment_body(p_body text) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION pim.pm_verify_jev_hmac_envelope(p_envelope jsonb, p_signature text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text;
  v_canonical text;
  v_expected text;
  v_required text[] := array[
    'environment', 'requester_profile_id', 'product_id', 'comment_id',
    'eligibility_id', 'source_body_revision', 'lease_token', 'disposition',
    'input_byte_count', 'input_digest', 'input_key_version', 'model',
    'contract_version', 'quality_release_digest', 'target_deployment_digest',
    'emergency_generation', 'timestamp', 'nonce'
  ];
  k text;
begin
  if p_envelope is null or p_signature is null or length(btrim(p_signature)) < 32 then
    return false;
  end if;
  if jsonb_typeof(p_envelope) <> 'object' then
    return false;
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_envelope) ok
    where ok <> all (v_required)
  ) then
    return false;
  end if;
  foreach k in array v_required loop
    if not (p_envelope ? k) then
      return false;
    end if;
  end loop;

  begin
    select decrypted_secret into v_key
    from vault.decrypted_secrets
    where name = 'jev_envelope_hmac_key';
  exception when others then
    return false;
  end;
  if v_key is null or length(v_key) < 16 then
    return false;
  end if;

  v_canonical := (
    select string_agg(
      length(k2) || ':' || k2 || '=' ||
      case when p_envelope ->> k2 is null then ' '
           else length(p_envelope ->> k2) || ':' || (p_envelope ->> k2)
      end,
      ''
      order by k2
    )
    from unnest(v_required) as k2
  );

  v_expected := encode(
    extensions.hmac(convert_to(v_canonical, 'utf8'), convert_to(v_key, 'utf8'), 'sha256'),
    'hex'
  );
  if v_expected <> lower(btrim(p_signature)) then
    return false;
  end if;
  -- Short expiry on the signed timestamp (5 minutes).
  begin
    if (p_envelope ->> 'timestamp') is null
       or abs(extract(epoch from ((p_envelope ->> 'timestamp')::timestamptz - now()))) > 300 then
      return false;
    end if;
  exception when others then
    return false;
  end;
  return true;
end $function$
;
revoke all on function pim.pm_verify_jev_hmac_envelope(p_envelope jsonb, p_signature text) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION plm.check_taxonomy_sync_health(p_max_success_age interval DEFAULT '36:00:00'::interval, p_options jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plm', 'core', 'ingest', 'public'
AS $function$
declare
  v_opts jsonb := coalesce(p_options, '{}'::jsonb);
  v_baseline_key text;
  v_pins jsonb;
  v_pin_error text;

  -- Deliberately NOT `constant`, and deliberately NOT initialised here. A raise in
  -- the DECLARE block happens outside every exception handler, before any
  -- sync_run, alert or observation can be written -- which is exactly the
  -- both-detectors-dark-with-no-evidence failure this guards against.
  c_expected_licensor_count integer;
  c_expected_property_count integer;
  c_expected_licensor_uuid_hash text;
  c_expected_property_uuid_hash text;
  c_expected_licensor_status_hash text;
  c_expected_property_status_hash text;
  c_expected_parent_edge_hash text;
  c_expected_taxonomy_source_ref_count integer;
  c_expected_coldlion_refs integer;
  c_expected_designflow_refs integer;
  c_expected_linked_licensors integer;
  c_expected_linked_properties integer;

  v_force_fail boolean := coalesce((v_opts ->> 'force_fail')::boolean, false);
  v_skip_alert boolean := coalesce((v_opts ->> 'skip_alert')::boolean, false);
  v_max_age interval := coalesce(p_max_success_age, interval '36 hours');
  v_is_drill boolean := v_force_fail;

  v_issues jsonb := '[]'::jsonb;
  v_ok boolean := true;
  v_snap jsonb;
  v_cl_latest ingest.sync_run%rowtype;
  v_df_latest ingest.sync_run%rowtype;
  v_cl_prev ingest.sync_run%rowtype;
  v_obs plm.taxonomy_parallel_observation%rowtype;
  v_alert_id uuid;
  v_health_run_id uuid;
  v_cl_failures integer := 0;
begin
  -- ------------------------------------------------------------------
  -- REFUSAL GATE: no baseline governs this database.
  -- Not a pass (a false green) and not a critical alert (a false red -- it would
  -- auto-trip the breaker for a configuration state, and on production that means
  -- tripping the lane over the FR divergence AGENTS.md 6.5 calls expected).
  -- A failed sync_run plus a WARNING alert: durable, visible, inert.
  -- ------------------------------------------------------------------
  v_baseline_key := coalesce(nullif(btrim(v_opts ->> 'baseline_key'), ''),
                             plm.active_taxonomy_baseline_key());

  if v_baseline_key is null then
    insert into ingest.sync_run (
      source_system, source_name, status, started_at, finished_at,
      rows_seen, rows_failed, error, metadata)
    values (
      'shared_db', 'coldlion_designflow_sync_health', 'failed'::ingest.sync_status,
      now(), now(), 1, 1,
      'phase6 health REFUSED: no active taxonomy baseline on this database',
      jsonb_build_object(
        'refused', true,
        'reason', 'no_active_baseline',
        'environment', plm.resolve_deployment_environment(),
        'remedy', 'derive this environment''s expected values FROM THIS DATABASE, seed them under their own baseline_key, then call plm.activate_taxonomy_baseline(...)'))
    returning id into v_health_run_id;

    -- One standing warning, not one per run: this is a configuration state that
    -- persists until somebody acts, and a daily repeat would bury the real alerts.
    if not v_skip_alert and not exists (
      select 1 from plm.taxonomy_sync_alert
      where source_name = 'coldlion_designflow_sync_health'
        and acknowledged_at is null
        and reason like 'refused: no active taxonomy baseline%'
    ) then
      v_alert_id := plm.record_taxonomy_sync_alert(
        'warning',
        'coldlion_designflow_sync_health',
        'refused: no active taxonomy baseline on this database -- the health check cannot report green or red until one is activated',
        v_health_run_id, null, (timezone('utc', now()))::date, false,
        jsonb_build_object('refused', true, 'reason', 'no_active_baseline',
                           'environment', plm.resolve_deployment_environment()));
    end if;

    return jsonb_build_object(
      'ok', false, 'refused', true, 'reason', 'no_active_baseline',
      'environment', plm.resolve_deployment_environment(),
      'health_run_id', v_health_run_id, 'alert_id', v_alert_id);
  end if;

  -- ------------------------------------------------------------------
  -- The baseline exists but may be UNREADABLE -- e.g. a pin superseded with no
  -- replacement. Fail CLOSED (critical => the lane auto-trips) and leave evidence,
  -- rather than raising out of the function and rolling back every trace that it
  -- ran at all.
  -- ------------------------------------------------------------------
  begin
    v_pins := plm.taxonomy_baseline_pin_set(v_baseline_key);
  exception when others then
    v_pin_error := left(sqlerrm, 2000);

    insert into ingest.sync_run (
      source_system, source_name, status, started_at, finished_at,
      rows_seen, rows_failed, error, metadata)
    values (
      'shared_db', 'coldlion_designflow_sync_health', 'failed'::ingest.sync_status,
      now(), now(), 1, 1,
      left('phase6 health BLIND: ' || v_pin_error, 4000),
      jsonb_build_object('baseline_unreadable', true, 'baseline_key', v_baseline_key,
                         'error', v_pin_error))
    returning id into v_health_run_id;

    if not v_skip_alert then
      v_alert_id := plm.record_taxonomy_sync_alert(
        'critical',
        'coldlion_designflow_sync_health',
        'baseline unreadable, health check is BLIND: ' || v_pin_error,
        v_health_run_id, null, (timezone('utc', now()))::date, false,
        jsonb_build_object('baseline_unreadable', true, 'baseline_key', v_baseline_key,
                           'failed_invariant', 'taxonomy_baseline_unreadable',
                           'error', v_pin_error));
    end if;

    return jsonb_build_object(
      'ok', false, 'baseline_unreadable', true, 'baseline_key', v_baseline_key,
      'error', v_pin_error, 'health_run_id', v_health_run_id, 'alert_id', v_alert_id);
  end;

  c_expected_licensor_count := (v_pins ->> 'licensor_count')::integer;
  c_expected_property_count := (v_pins ->> 'property_count')::integer;
  c_expected_licensor_uuid_hash := v_pins ->> 'licensor_uuid_hash';
  c_expected_property_uuid_hash := v_pins ->> 'property_uuid_hash';
  c_expected_licensor_status_hash := v_pins ->> 'licensor_status_hash';
  c_expected_property_status_hash := v_pins ->> 'property_status_hash';
  c_expected_parent_edge_hash := v_pins ->> 'parent_edge_hash';
  c_expected_taxonomy_source_ref_count := (v_pins ->> 'taxonomy_source_ref_count')::integer;
  c_expected_coldlion_refs := (v_pins ->> 'coldlion_source_ref_count')::integer;
  c_expected_designflow_refs := (v_pins ->> 'designflow_source_ref_count')::integer;
  c_expected_linked_licensors := (v_pins ->> 'linked_licensor_count')::integer;
  c_expected_linked_properties := (v_pins ->> 'linked_property_count')::integer;

  v_snap := plm.compute_taxonomy_immutability_snapshot();

  -- Issue #552: refuse an unreviewed licensor-status state before this
  -- detector can write an observation, alert, health run, or breaker signal.
  -- These are the only two states covered by the owner-reviewed transition:
  -- the pre-ruling hash and the post-ruling hash from 20260802171000.
  if (v_snap ->> 'licensor_status_hash') is null
     or (v_snap ->> 'licensor_status_hash') not in (
    'd9b07759bf80ff227e2fa9bd635d2138',
    '00bf7069fff79b9deab1d14dbd9112b2'
  ) then
    raise exception using
      message = 'taxonomy health refused: live licensor_status_hash is outside the reviewed transition',
      detail = format(
        'actual=%s allowed=d9b07759bf80ff227e2fa9bd635d2138,00bf7069fff79b9deab1d14dbd9112b2',
        coalesce(v_snap ->> 'licensor_status_hash', '<null>')
      ),
      hint = 'Review the licensor-status change and ship a new governed transition before running health or observation functions.';
  end if;

  select * into v_cl_latest
  from ingest.sync_run
  where source_system = 'coldlion'
    and source_name = 'coldlion_licensors_properties_api'
  order by coalesce(finished_at, started_at, created_at) desc nulls last
  limit 1;

  select * into v_cl_prev
  from ingest.sync_run
  where source_system = 'coldlion'
    and source_name = 'coldlion_licensors_properties_api'
  order by coalesce(finished_at, started_at, created_at) desc nulls last
  offset 1
  limit 1;

  select * into v_df_latest
  from ingest.sync_run
  where source_system = 'designflow_plm'
    and source_name = 'plm_master_data_api'
  order by coalesce(finished_at, started_at, created_at) desc nulls last
  limit 1;

  -- Gate uses most recent NON-DRILL daily observation only.
  select * into v_obs
  from plm.taxonomy_parallel_observation
  where is_drill = false
  order by observed_at desc
  limit 1;

  if v_cl_latest.id is null then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'missing_run', 'lane', 'coldlion'
    ));
  elsif v_cl_latest.status is distinct from 'succeeded' then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'failed_run', 'lane', 'coldlion',
      'run_id', v_cl_latest.id, 'status', v_cl_latest.status
    ));
  elsif coalesce(v_cl_latest.finished_at, v_cl_latest.started_at) < (now() - v_max_age) then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'stale_run', 'lane', 'coldlion',
      'run_id', v_cl_latest.id,
      'finished_at', v_cl_latest.finished_at,
      'max_age', v_max_age::text
    ));
  end if;

  -- Retired DesignFlow run metadata is historical only; no freshness/status gate.

  if v_cl_latest.status is not distinct from 'failed'
     and v_cl_prev.status is not distinct from 'failed'
  then
    v_ok := false;
    v_cl_failures := 2;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'two_consecutive_failures', 'lane', 'coldlion'
    ));
  end if;

  -- Live baseline comparison (same pins as the daily comparison, now from data).
  if (v_snap ->> 'licensor_count')::integer is distinct from c_expected_licensor_count
     or (v_snap ->> 'property_count')::integer is distinct from c_expected_property_count
     or (v_snap ->> 'licensor_uuid_hash') is distinct from c_expected_licensor_uuid_hash
     or (v_snap ->> 'property_uuid_hash') is distinct from c_expected_property_uuid_hash
     or (v_snap ->> 'licensor_status_hash') is distinct from c_expected_licensor_status_hash
     or (v_snap ->> 'property_status_hash') is distinct from c_expected_property_status_hash
     or (v_snap ->> 'parent_edge_hash') is distinct from c_expected_parent_edge_hash
     or (v_snap ->> 'taxonomy_source_ref_count')::integer is distinct from c_expected_taxonomy_source_ref_count
     or (v_snap ->> 'coldlion_source_ref_count')::integer is distinct from c_expected_coldlion_refs
     or (v_snap ->> 'designflow_source_ref_count')::integer is distinct from c_expected_designflow_refs
     or (v_snap ->> 'linked_licensor_count')::integer is distinct from c_expected_linked_licensors
     or (v_snap ->> 'linked_property_count')::integer is distinct from c_expected_linked_properties
  then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'phase4_baseline_drift',
      'baseline_key', v_baseline_key,
      'coldlion_source_ref_count', (v_snap ->> 'coldlion_source_ref_count')::integer,
      'linked_licensor_count', (v_snap ->> 'linked_licensor_count')::integer,
      'linked_property_count', (v_snap ->> 'linked_property_count')::integer
    ));
  end if;

  if v_obs.id is not null
     and v_obs.pass is not true
     and v_obs.observation_date >= (timezone('utc', now()))::date - 1
  then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'recent_nondrill_observation_failed',
      'observation_id', v_obs.id,
      'observation_date', v_obs.observation_date,
      'unexplained_diff_count', v_obs.unexplained_diff_count
    ));
  end if;

  if v_force_fail then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'forced_failure_drill',
      'note', 'Distinct drill signal; does not rewrite non-drill observation evidence'
    ));
  end if;

  insert into ingest.sync_run (
    source_system, source_name, status, started_at, finished_at,
    rows_seen, rows_failed, error, metadata
  )
  values (
    'shared_db',
    'coldlion_designflow_sync_health',
    case when v_ok then 'succeeded'::ingest.sync_status else 'failed'::ingest.sync_status end,
    now(),
    now(),
    1,
    case when v_ok then 0 else jsonb_array_length(v_issues) end,
    case when v_ok then null else left('phase6 health failed: ' || jsonb_array_length(v_issues)::text || ' issue(s)', 4000) end,
    jsonb_build_object(
      'ok', v_ok,
      'is_drill', v_is_drill,
      'issues', v_issues,
      'force_fail', v_force_fail,
      'max_success_age', v_max_age::text,
      'baseline_key', v_baseline_key,
      'latest_nondrill_observation_id', v_obs.id,
      'coldlion_consecutive_failures', v_cl_failures,
      'designflow_lane', jsonb_build_object('status', 'retired', 'required', false)
    )
  )
  returning id into v_health_run_id;

  if not v_ok and not v_skip_alert then
    v_alert_id := plm.record_taxonomy_sync_alert(
      'critical',
      'coldlion_designflow_sync_health',
      case
        when v_force_fail then 'forced_failure_drill'
        else 'sync health check failed with ' || jsonb_array_length(v_issues)::text || ' issue(s)'
      end,
      v_health_run_id,
      case when v_obs.is_drill is not true then v_obs.id else null end,
      v_obs.observation_date,
      v_is_drill,
      jsonb_build_object(
        'ok', v_ok,
        'is_drill', v_is_drill,
        'issues', v_issues,
        'force_fail', v_force_fail,
        'baseline_key', v_baseline_key,
        'latest_nondrill_observation_id', v_obs.id
      )
    );
  end if;

  return jsonb_build_object(
    'ok', v_ok,
    'is_drill', v_is_drill,
    'issues', v_issues,
    'health_run_id', v_health_run_id,
    'alert_id', v_alert_id,
    'baseline_key', v_baseline_key,
    'baseline_pins', v_pins,
    'latest_nondrill_observation_id', v_obs.id,
    'coldlion_run_id', v_cl_latest.id,
    'designflow_run_id', v_df_latest.id,
    'designflow_lane', jsonb_build_object('status', 'retired', 'required', false),
    'coldlion_source_ref_count', (v_snap ->> 'coldlion_source_ref_count')::integer,
    'linked_licensor_count', (v_snap ->> 'linked_licensor_count')::integer,
    'linked_property_count', (v_snap ->> 'linked_property_count')::integer,
    'force_fail', v_force_fail
  );
end;
$function$
;
revoke all on function plm.check_taxonomy_sync_health(p_max_success_age interval, p_options jsonb) from public, anon, authenticated;
grant execute on function plm.check_taxonomy_sync_health(p_max_success_age interval, p_options jsonb) to service_role;
CREATE OR REPLACE FUNCTION plm.coldlion_merch_group_candidates(p_company_code text DEFAULT NULL::text, p_division_code text DEFAULT NULL::text)
 RETURNS TABLE(company_code text, division_code text, mg_type_code text, mg_type_desc text, mg_code text, mg_desc text, mg_category text, active text, candidate_kind text, resolution_status text, last_seen_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'plm', 'coldlion', 'extensions', 'public'
AS $function$
begin
  return query
  select
    h.company_code,
    h.division_code,
    h.mg_type_code,
    h.mg_type_desc,
    d.mg_code,
    d.mg_desc,
    d.mg_category,
    d.active,
    case
      when lower(btrim(h.mg_type_desc)) = 'licensor' then 'licensor'
      when lower(btrim(h.mg_type_desc)) = 'property' then 'property'
    end as candidate_kind,
    coalesce(l.resolution_status, p.resolution_status, 'unresolved') as resolution_status,
    d.last_seen_at
  from coldlion.merch_group_header h
  join coldlion.merch_group_detail d
    on  d.company_code  = h.company_code
    and d.division_code = h.division_code
    and d.mg_type_code  = h.mg_type_code
  left join plm.erp_licensor l
    on  l.company_code  = h.company_code
    and l.division_code = h.division_code
    and l.mg_type_code  = h.mg_type_code
    and l.mg_code       = d.mg_code
    and lower(btrim(h.mg_type_desc)) = 'licensor'
  left join plm.erp_property p
    on  p.company_code  = h.company_code
    and p.division_code = h.division_code
    and p.mg_type_code  = h.mg_type_code
    and p.mg_code       = d.mg_code
    and lower(btrim(h.mg_type_desc)) = 'property'
  where lower(btrim(h.mg_type_desc)) in ('licensor', 'property')
    and (p_company_code  is null or h.company_code  = p_company_code)
    and (p_division_code is null or h.division_code = p_division_code);
end
$function$
;
revoke all on function plm.coldlion_merch_group_candidates(p_company_code text, p_division_code text) from public, anon, authenticated;
grant execute on function plm.coldlion_merch_group_candidates(p_company_code text, p_division_code text) to authenticated;
grant execute on function plm.coldlion_merch_group_candidates(p_company_code text, p_division_code text) to service_role;
CREATE OR REPLACE FUNCTION plm.coldlion_property_sync_run_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'plm'
AS $function$
begin
  perform plm.alert_coldlion_property_skips(new.id);
  return null;
end;
$function$
;
revoke all on function plm.coldlion_property_sync_run_alert() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION plm.import_coldlion_salespersons()
 RETURNS TABLE(salespersons_seen integer, salespersons_upserted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plm', 'coldlion', 'extensions', 'public'
AS $function$
declare
  v_seen     integer;
  v_upserted integer;
begin
  select count(*) into v_seen from coldlion.salesperson;

  insert into plm.erp_salesperson (
    company_code, salesperson_code,
    name, active,
    erp_created_at, erp_updated_at,
    raw, source_hash, first_seen_at, last_seen_at
  )
  select
    s.company_code,
    s.salesperson_code,
    s.last_name,
    case
      when s.active is null or btrim(s.active) = '' then null
      when upper(s.active) = 'Y' then true
      else false
    end,
    s.created_time,
    s.mod_time,
    jsonb_build_object(
      'companyCode',      s.company_code,
      'salesPersonCode',  s.salesperson_code,
      'lastName',         s.last_name,
      'active',           s.active
    ),
    s.source_hash,
    s.first_seen_at,
    s.last_seen_at
  from coldlion.salesperson s
  on conflict (company_code, salesperson_code) do update set
    name           = excluded.name,
    active         = excluded.active,
    erp_created_at = excluded.erp_created_at,
    erp_updated_at = excluded.erp_updated_at,
    raw            = excluded.raw,
    source_hash    = excluded.source_hash,
    last_seen_at   = excluded.last_seen_at,
    updated_at     = now();

  get diagnostics v_upserted = row_count;
  return query select v_seen, v_upserted;
end
$function$
;
revoke all on function plm.import_coldlion_salespersons() from public, anon, authenticated;
grant execute on function plm.import_coldlion_salespersons() to service_role;
CREATE OR REPLACE FUNCTION plm.import_coldlion_seasons()
 RETURNS TABLE(seasons_seen integer, seasons_upserted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plm', 'coldlion', 'extensions', 'public'
AS $function$
declare
  v_seen     integer;
  v_upserted integer;
begin
  select count(*) into v_seen from coldlion.season;

  insert into plm.erp_season (
    company_code, division_code, season_code,
    name, active,
    erp_created_at, erp_updated_at,
    raw, source_hash, first_seen_at, last_seen_at
  )
  select
    s.company_code,
    s.division_code,
    s.season_code,
    s.season_code,
    null::boolean,
    s.created_time,
    s.mod_time,
    jsonb_build_object(
      'companyCode',  s.company_code,
      'divisionCode', s.division_code,
      'seasonCode',   s.season_code
    ),
    s.source_hash,
    s.first_seen_at,
    s.last_seen_at
  from coldlion.season s
  on conflict (company_code, division_code, season_code) do update set
    name           = excluded.name,
    erp_created_at = excluded.erp_created_at,
    erp_updated_at = excluded.erp_updated_at,
    raw            = excluded.raw,
    source_hash    = excluded.source_hash,
    last_seen_at   = excluded.last_seen_at,
    updated_at     = now();

  get diagnostics v_upserted = row_count;
  return query select v_seen, v_upserted;
end
$function$
;
revoke all on function plm.import_coldlion_seasons() from public, anon, authenticated;
grant execute on function plm.import_coldlion_seasons() to service_role;
CREATE OR REPLACE FUNCTION plm.import_item_master_data(import_payload jsonb)
 RETURNS TABLE(sync_run_id uuid, rows_seen integer, rows_inserted integer, rows_updated integer, rows_resolved integer, rows_partially_resolved integer, rows_ambiguous integer, rows_unresolved integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'core', 'ingest', 'plm', 'extensions', 'public'
AS $function$
declare
  sync_id uuid := coalesce(nullif(import_payload ->> 'sweepId', '')::uuid, gen_random_uuid());
  items jsonb := coalesce(import_payload -> 'items', '[]'::jsonb);
  terminal_reached boolean := coalesce((import_payload ->> 'terminalReached')::boolean, false);
  sanity_ratio numeric := coalesce(nullif(import_payload ->> 'minimumSilverRatio', '')::numeric, 0.80);
  seen_count integer := 0;
  inserted_count integer := 0;
  updated_count integer := 0;
  existing_count integer := 0;
  resolved_count integer := 0;
  partial_count integer := 0;
  ambiguous_count integer := 0;
  unresolved_count integer := 0;
begin
  if jsonb_typeof(items) <> 'array' then raise exception 'import_payload.items must be a JSON array'; end if;
  if sanity_ratio <= 0 or sanity_ratio > 1 then raise exception 'minimumSilverRatio must be greater than 0 and at most 1'; end if;

  insert into ingest.sync_run(id, source_system, source_name, status, started_at, metadata)
  values (sync_id, 'coldlion', 'item_taxonomy_resolver', 'running', now(),
    jsonb_build_object('endpoint','/items','terminal_reached',terminal_reached,'minimum_silver_ratio',sanity_ratio));

  if not terminal_reached then raise exception 'item sweep did not reach a terminal or empty page; silver was not promoted'; end if;

  delete from plm.item_import_staging where sweep_id=sync_id;
  insert into plm.item_import_staging(
    sweep_id, company_code, division_code, item_no, item_description, style_number, status,
    merch_group_01, merch_group_02, merch_group_03, merch_group_04, merch_group_05, merch_group_06,
    merch_groups, raw)
  select sync_id,
    nullif(btrim(x->>'companyCode'),''), nullif(btrim(x->>'divisionCode'),''), nullif(btrim(x->>'itemNo'),''),
    nullif(x->>'itemDesc',''), nullif(coalesce(x->>'styleNumber',x->>'styleNo'),''), nullif(x->>'status',''),
    nullif(x->>'merchGroup01',''), nullif(x->>'merchGroup02',''), nullif(x->>'merchGroup03',''),
    nullif(x->>'merchGroup04',''), nullif(x->>'merchGroup05',''), nullif(x->>'merchGroup06',''),
    jsonb_build_object('01',x->>'merchGroup01','02',x->>'merchGroup02','03',x->>'merchGroup03',
      '04',x->>'merchGroup04','05',x->>'merchGroup05','06',x->>'merchGroup06'), x
  from jsonb_array_elements(items) x;

  if exists(select 1 from plm.item_import_staging where sweep_id=sync_id and
    (company_code is null or division_code is null or item_no is null)) then
    raise exception 'items payload contains a row missing companyCode, divisionCode, or itemNo';
  end if;

  select count(*) into seen_count from plm.item_import_staging where sweep_id=sync_id;
  if seen_count=0 then raise exception 'item sweep is empty; silver was not promoted'; end if;
  if exists(select 1 from (select division_code, count(*) c from plm.item_import_staging where sweep_id=sync_id group by division_code) d where c=0) then
    raise exception 'item sweep contains a zero-row division; silver was not promoted';
  end if;
  select count(*) into existing_count from plm.item_import;
  -- A retiring EDGEHOME/EP001 (absent from this sweep) does not count against the band.
  if existing_count>0 and seen_count < ceil(sanity_ratio * (existing_count - case
       when exists(select 1 from plm.item_import_staging st where st.sweep_id=sync_id
                   and st.company_code='EDGEHOME' and st.division_code='EP001') then 0
       else (select count(*) from plm.item_import where company_code='EDGEHOME' and division_code='EP001') end)) then
    raise exception 'item sweep row count % is below sanity band % of current silver %', seen_count, sanity_ratio, existing_count;
  end if;
  if existing_count>0 and exists(
    select 1 from (select distinct company_code, division_code from plm.item_import) current_division
    -- EDGEHOME/EP001 is permanently out of scope (owner ruling 2026-08-28): its absence
    -- from a sweep is a retirement, pruned below by the full-sweep promotion and
    -- recorded in this run's metadata as retired_divisions, not a failure.
    where (current_division.company_code, current_division.division_code) <> ('EDGEHOME', 'EP001')
      and not exists(select 1 from plm.item_import_staging staged
      where staged.sweep_id=sync_id and staged.company_code=current_division.company_code
        and staged.division_code=current_division.division_code)
  ) then
    raise exception 'item sweep omitted a division present in current silver; silver was not promoted';
  end if;
  -- Retiring EP001 cascades its quarantine and disagreement rows; never let that
  -- silently discard a human reviewed/dismissed disagreement decision.
  if exists(select 1 from plm.item_taxonomy_disagreement d
            where d.company_code='EDGEHOME' and d.division_code='EP001' and d.status <> 'open')
     and not exists(select 1 from plm.item_import_staging st where st.sweep_id=sync_id
                    and st.company_code='EDGEHOME' and st.division_code='EP001') then
    raise exception 'retiring EDGEHOME/EP001 would delete reviewed disagreement decisions; silver was not promoted';
  end if;

  select count(*) into inserted_count from plm.item_import_staging s left join plm.item_import i
    using(company_code,division_code,item_no) where s.sweep_id=sync_id and i.item_no is null;
  drop table if exists item_taxonomy_changed_rows;
  create temporary table item_taxonomy_changed_rows (
    company_code text not null,
    division_code text not null,
    item_no text not null,
    primary key(company_code,division_code,item_no)
  ) on commit drop;
  insert into item_taxonomy_changed_rows
  select s.company_code,s.division_code,s.item_no from plm.item_import_staging s join plm.item_import i
    using(company_code,division_code,item_no) where s.sweep_id=sync_id and
    (i.item_description,i.style_number,i.status,i.merch_group_01,i.merch_group_02,i.merch_group_03,
     i.merch_group_04,i.merch_group_05,i.merch_group_06,i.merch_groups,i.raw) is distinct from
    (s.item_description,s.style_number,s.status,s.merch_group_01,s.merch_group_02,s.merch_group_03,
     s.merch_group_04,s.merch_group_05,s.merch_group_06,s.merch_groups,s.raw);

  insert into ingest.raw_record(sync_run_id,source_system,source_table,source_id,record_hash,payload,imported_at)
  select sync_id,'coldlion','items',company_code||'|'||division_code||'|'||item_no,md5(raw::text),raw,now()
  from plm.item_import_staging where sweep_id=sync_id
  on conflict(source_system,source_table,source_id) do update set sync_run_id=excluded.sync_run_id,
    record_hash=excluded.record_hash,payload=excluded.payload,imported_at=excluded.imported_at
  -- unchanged payloads are not rewritten; sync_run_id then names the run that last changed it
  where ingest.raw_record.record_hash is distinct from excluded.record_hash;

  insert into plm.item_import(company_code,division_code,item_no,item_description,style_number,status,
    merch_group_01,merch_group_02,merch_group_03,merch_group_04,merch_group_05,merch_group_06,merch_groups,raw,imported_at)
  select company_code,division_code,item_no,item_description,style_number,status,merch_group_01,merch_group_02,
    merch_group_03,merch_group_04,merch_group_05,merch_group_06,merch_groups,raw,now()
  from plm.item_import_staging where sweep_id=sync_id
  on conflict(company_code,division_code,item_no) do update set item_description=excluded.item_description,
    style_number=excluded.style_number,status=excluded.status,merch_group_01=excluded.merch_group_01,
    merch_group_02=excluded.merch_group_02,merch_group_03=excluded.merch_group_03,
    merch_group_04=excluded.merch_group_04,merch_group_05=excluded.merch_group_05,
    merch_group_06=excluded.merch_group_06,merch_groups=excluded.merch_groups,raw=excluded.raw,imported_at=excluded.imported_at
  where (plm.item_import.item_description,plm.item_import.style_number,plm.item_import.status,
         plm.item_import.merch_group_01,plm.item_import.merch_group_02,plm.item_import.merch_group_03,
         plm.item_import.merch_group_04,plm.item_import.merch_group_05,plm.item_import.merch_group_06,
         plm.item_import.merch_groups,plm.item_import.raw)
    is distinct from
        (excluded.item_description,excluded.style_number,excluded.status,excluded.merch_group_01,
         excluded.merch_group_02,excluded.merch_group_03,excluded.merch_group_04,excluded.merch_group_05,
         excluded.merch_group_06,excluded.merch_groups,excluded.raw);

  update ingest.sync_run set metadata=metadata || jsonb_build_object('retired_divisions',
    coalesce((select jsonb_agg(distinct i.company_code||'|'||i.division_code) from plm.item_import i
      where not exists(select 1 from plm.item_import_staging s where s.sweep_id=sync_id
        and s.company_code=i.company_code and s.division_code=i.division_code)),'[]'::jsonb))
  where id=sync_id;

  -- A full-sweep promotion makes silver an exact last-good snapshot.
  delete from plm.item_import i where not exists(select 1 from plm.item_import_staging s where s.sweep_id=sync_id
    and (s.company_code,s.division_code,s.item_no)=(i.company_code,i.division_code,i.item_no));

  drop table if exists item_taxonomy_resolution;
  create temporary table item_taxonomy_resolution on commit drop as
  with base as (
    select i.*,
      lower(btrim(h5.mg_type_desc)) meaning_05, lower(btrim(h6.mg_type_desc)) meaning_06
    from plm.item_import i
    left join plm.merch_group_header h5 on h5.company_code=i.company_code and h5.division_code=i.division_code and h5.mg_type_code='05'
    left join plm.merch_group_header h6 on h6.company_code=i.company_code and h6.division_code=i.division_code and h6.mg_type_code='06'
  ), candidates as (
    select b.*,
      lc.candidate_count lic_count, lc.candidate_id slot_licensor_id,
      pc.candidate_count property_count, pc.candidate_id sole_property_id, pc.parent_id sole_property_licensor_id,
      sp.candidate_count scoped_property_count, sp.candidate_id scoped_property_id, sp.parent_id scoped_property_licensor_id
    from base b
    left join lateral (select count(*)::int candidate_count, (array_agg(id order by id))[1] candidate_id from core.licensor where code=case when b.merch_group_05 in ('DC','HP') then 'WB' else b.merch_group_05 end) lc on true
    left join lateral (select count(*)::int candidate_count, (array_agg(id order by id))[1] candidate_id,
      (array_agg(licensor_id order by id))[1] parent_id from core.property where code=b.merch_group_06) pc on true
    left join lateral (select count(*)::int candidate_count, (array_agg(id order by id))[1] candidate_id,
      (array_agg(licensor_id order by id))[1] parent_id from core.property
      where code=b.merch_group_06 and licensor_id=lc.candidate_id) sp on true
  )
  select c.*,
    case when not (lic_count>1 or (meaning_06='property' and scoped_property_count=0 and property_count>1))
      and meaning_05='licensor' and lic_count=1 then slot_licensor_id end resolved_slot_licensor_id,
    case when not (lic_count>1 or (meaning_06='property' and scoped_property_count=0 and property_count>1)) then
      case when meaning_06='property' and scoped_property_count=1 then scoped_property_id
           when meaning_06='property' and property_count=1 then sole_property_id end end resolved_property_id,
    case when not (lic_count>1 or (meaning_06='property' and scoped_property_count=0 and property_count>1)) then
      case when meaning_06='property' and scoped_property_count=1 then scoped_property_licensor_id
           when meaning_06='property' and property_count=1 then sole_property_licensor_id
           when meaning_05='licensor' and lic_count=1 then slot_licensor_id end end resolved_licensor_id,
    case
      when (meaning_05='licensor' and lic_count>1) or
           (meaning_06='property' and scoped_property_count=0 and property_count>1) then 'ambiguous'
      when meaning_05='licensor' and meaning_06='property' and lic_count=1 and
           (scoped_property_count=1 or property_count=1) then 'resolved'
      when (meaning_05='licensor' and lic_count=1) or
           (meaning_06='property' and (scoped_property_count=1 or property_count=1)) then 'partially-resolved'
      else 'unresolved'
    end outcome
  from candidates c;

  -- plm.item receives only the two locked taxonomy FKs. product_type_id and
  -- merch_group_id remain untouched because their canonical tables are empty.
  insert into item_taxonomy_changed_rows(company_code,division_code,item_no)
  select r.company_code,r.division_code,r.item_no
  from item_taxonomy_resolution r
  join plm.item p on p.source_system='coldlion' and p.source_id=r.company_code||'|'||r.division_code||'|'||r.item_no
  where (p.item_number,p.name,p.description,p.licensor_id,p.property_id,p.status,p.raw) is distinct from
    (r.item_no,r.style_number,r.item_description,r.resolved_licensor_id,r.resolved_property_id,r.status,r.raw)
  on conflict do nothing;
  select count(*) into updated_count from item_taxonomy_changed_rows;

  insert into plm.item(item_number,name,description,licensor_id,property_id,status,source_system,source_id,raw)
  select item_no,style_number,item_description,resolved_licensor_id,resolved_property_id,status,'coldlion',
    company_code||'|'||division_code||'|'||item_no,raw from item_taxonomy_resolution
  on conflict(source_system,source_id) do update set item_number=excluded.item_number,name=excluded.name,
    description=excluded.description,licensor_id=excluded.licensor_id,property_id=excluded.property_id,
    status=excluded.status,raw=excluded.raw,updated_at=now()
  -- Only real changes bump updated_at; an unchanged nightly sweep writes nothing (#3910).
  where (plm.item.item_number,plm.item.name,plm.item.description,plm.item.licensor_id,
         plm.item.property_id,plm.item.status,plm.item.raw)
    is distinct from
        (excluded.item_number,excluded.name,excluded.description,excluded.licensor_id,
         excluded.property_id,excluded.status,excluded.raw);

  update plm.item_import i set item_id=p.id,resolution_outcome=r.outcome
  from item_taxonomy_resolution r join plm.item p on p.source_system='coldlion' and
    p.source_id=r.company_code||'|'||r.division_code||'|'||r.item_no
  where (i.company_code,i.division_code,i.item_no)=(r.company_code,r.division_code,r.item_no)
    and (i.item_id,i.resolution_outcome) is distinct from (p.id,r.outcome);

  -- Rebuild the current quarantine for this sweep. This deliberately clears a
  -- formerly unresolved (item, slot) when the same slot resolves on re-run.
  delete from plm.item_import_unresolved u using item_taxonomy_resolution r
  where (u.company_code,u.division_code,u.item_no)=(r.company_code,r.division_code,r.item_no);

  insert into plm.item_import_unresolved(company_code,division_code,item_no,slot_code,slot_meaning,
    source_code,outcome,reason,candidate_count,tiebreak,last_seen_at,sync_run_id)
  select company_code,division_code,item_no,slot_code,slot_meaning,source_code,
    case when outcome='resolved' then 'partially-resolved' else outcome end,
    reason,candidate_count,'none; ambiguous candidates are quarantined',now(),sync_id
  from item_taxonomy_resolution r
  cross join lateral (values
    ('05',r.meaning_05,r.merch_group_05,
      case when r.meaning_05 is null then 'unknown division-scoped slot meaning'
           when r.meaning_05<>'licensor' then 'slot is '||r.meaning_05||', not licensor'
           when r.merch_group_05 is null then 'licensor slot is empty'
           when r.lic_count=0 then 'licensor code did not match core.licensor.code'
           when r.lic_count>1 then 'licensor code matched multiple candidates'
      end,r.lic_count),
    ('06',r.meaning_06,r.merch_group_06,
      case when r.meaning_06 is null then 'unknown division-scoped slot meaning'
           when r.meaning_06<>'property' then 'slot is '||r.meaning_06||', not property'
           when r.merch_group_06 is null then 'property slot is empty'
           when r.scoped_property_count=0 and r.property_count=0 then 'property code did not match core.property.code'
           when r.scoped_property_count=0 and r.property_count>1 then 'property code is ambiguous outside the resolved licensor'
      end,r.property_count)
  ) q(slot_code,slot_meaning,source_code,reason,candidate_count)
  where reason is not null;

  insert into plm.item_taxonomy_disagreement(company_code,division_code,item_no,licensor_slot_code,
    property_slot_code,slot_licensor_id,property_id,property_licensor_id,reason,last_seen_at,sync_run_id)
  select company_code,division_code,item_no,merch_group_05,merch_group_06,resolved_slot_licensor_id,
    resolved_property_id,resolved_licensor_id,'property parent wins: property.licensor_id disagrees with the item licensor slot',now(),sync_id
  from item_taxonomy_resolution where resolved_property_id is not null and resolved_slot_licensor_id is not null
    and resolved_slot_licensor_id is distinct from resolved_licensor_id
  on conflict(company_code,division_code,item_no) do update set licensor_slot_code=excluded.licensor_slot_code,
    property_slot_code=excluded.property_slot_code,slot_licensor_id=excluded.slot_licensor_id,
    property_id=excluded.property_id,property_licensor_id=excluded.property_licensor_id,
    reason=excluded.reason,last_seen_at=excluded.last_seen_at,sync_run_id=excluded.sync_run_id,
    -- a reviewed/dismissed decision is re-opened only when the disagreement itself changed
    status=case when (plm.item_taxonomy_disagreement.licensor_slot_code,plm.item_taxonomy_disagreement.property_slot_code,
                      plm.item_taxonomy_disagreement.slot_licensor_id,plm.item_taxonomy_disagreement.property_id,
                      plm.item_taxonomy_disagreement.property_licensor_id)
                     is distinct from
                     (excluded.licensor_slot_code,excluded.property_slot_code,excluded.slot_licensor_id,
                      excluded.property_id,excluded.property_licensor_id)
                then 'open' else plm.item_taxonomy_disagreement.status end;

  delete from plm.item_taxonomy_disagreement d using item_taxonomy_resolution r
  where (d.company_code,d.division_code,d.item_no)=(r.company_code,r.division_code,r.item_no)
    and not (r.resolved_property_id is not null and r.resolved_slot_licensor_id is not null
      and r.resolved_slot_licensor_id is distinct from r.resolved_licensor_id);

  delete from plm.item_import_staging where sweep_id=sync_id;

  select count(*) filter(where outcome='resolved'),count(*) filter(where outcome='partially-resolved'),
    count(*) filter(where outcome='ambiguous'),count(*) filter(where outcome='unresolved')
  into resolved_count,partial_count,ambiguous_count,unresolved_count from item_taxonomy_resolution;

  update ingest.sync_run set status='succeeded',finished_at=now(),rows_seen=seen_count,
    rows_inserted=inserted_count,rows_updated=updated_count,rows_failed=ambiguous_count+unresolved_count,
    metadata=metadata || jsonb_build_object(
      'outcomes',jsonb_build_object('resolved',resolved_count,'partially_resolved',partial_count,'ambiguous',ambiguous_count,'unresolved',unresolved_count),
      'per_division_per_outcome',coalesce((select jsonb_object_agg(division_code,counts) from
        (select division_code,jsonb_object_agg(outcome,row_count) counts from
          (select division_code,outcome,count(*) row_count from item_taxonomy_resolution group by division_code,outcome) x
         group by division_code) y),'{}'::jsonb),
      'per_division_per_type',coalesce((select jsonb_object_agg(division_code,counts) from
        (select division_code,jsonb_build_object(
          'items',count(*),
          'licensor_resolved',count(*) filter(where resolved_licensor_id is not null),
          'property_resolved',count(*) filter(where resolved_property_id is not null),
          'licensor_quarantined',count(*) filter(where meaning_05 is distinct from 'licensor' or resolved_licensor_id is null),
          'property_quarantined',count(*) filter(where meaning_06 is distinct from 'property' or resolved_property_id is null)
        ) counts from item_taxonomy_resolution group by division_code) z),'{}'::jsonb))
  where id=sync_id;

  -- #4941: live Master Data auto-flow. Runs inside the same transaction as the
  -- item upserts above, so the Licensed tracker row for every new item is created
  -- and linked before this sweep commits (owner direction 2026-10-27: live, not a
  -- scheduled copy). Idempotent per-SKU; a sweep with zero new items costs one
  -- count query and skips the bridge refresh entirely. The nested block isolates
  -- the flow: a sync fault must never fail the item landing itself; the row then
  -- appears via the nightly 05:50 UTC backstop instead.
  begin
    perform * from public.sync_new_items_into_style_tracker(p_dry_run => false);
  exception when others then
    raise warning 'master data live auto-flow deferred to the nightly backstop: %', sqlerrm;
  end;

  return query select sync_id,seen_count,inserted_count,updated_count,resolved_count,partial_count,ambiguous_count,unresolved_count;
end;
$function$
;
revoke all on function plm.import_item_master_data(import_payload jsonb) from public, anon, authenticated;
grant execute on function plm.import_item_master_data(import_payload jsonb) to service_role;
CREATE OR REPLACE FUNCTION plm.record_taxonomy_parallel_observation(p_observation_date date DEFAULT (timezone('utc'::text, now()))::date, p_options jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plm', 'core', 'ingest', 'public'
AS $function$
declare
  v_opts jsonb := coalesce(p_options, '{}'::jsonb);
  v_baseline_key text;
  v_pins jsonb;
  v_pin_error text;

  -- Not `constant`, not initialised here -- see the identical note in
  -- plm.check_taxonomy_sync_health above.
  c_expected_licensor_count integer;
  c_expected_property_count integer;
  c_expected_licensor_uuid_hash text;
  c_expected_property_uuid_hash text;
  c_expected_licensor_status_hash text;
  c_expected_property_status_hash text;
  c_expected_parent_edge_hash text;
  c_expected_taxonomy_source_ref_count integer;
  c_expected_coldlion_refs integer;
  c_expected_designflow_refs integer;
  c_expected_linked_licensors integer;
  c_expected_linked_properties integer;

  v_day date := coalesce(p_observation_date, (timezone('utc', now()))::date);
  v_max_age interval := coalesce(
    nullif(v_opts ->> 'max_success_age', '')::interval,
    interval '36 hours'
  );
  v_force_fail boolean := coalesce((v_opts ->> 'force_fail')::boolean, false);
  v_skip_alert boolean := coalesce((v_opts ->> 'skip_alert')::boolean, false);
  v_is_drill boolean := v_force_fail;

  v_snap jsonb;
  v_prior plm.taxonomy_parallel_observation%rowtype;
  v_cl ingest.sync_run%rowtype;
  v_df ingest.sync_run%rowtype;

  v_baseline_ok boolean := true;
  v_coldlion_ok boolean := false;
  -- Compatibility NOT NULL field: true means not required, NOT a successful run.
  v_designflow_ok boolean := true;
  v_links_ok boolean := false;
  v_immutability_ok boolean := true;
  v_pass boolean := false;
  v_unexplained integer := 0;
  v_details jsonb := '{}'::jsonb;
  v_diffs jsonb := '[]'::jsonb;
  v_cmp_run_id uuid;
  v_obs_id uuid;
  v_alert_id uuid;
  v_result jsonb;
begin
  -- REFUSAL GATE -- see the same block in plm.check_taxonomy_sync_health.
  -- No observation row is written, so the failed-observation auto-trip trigger
  -- from 20260728134500 cannot fire on a configuration state either.
  v_baseline_key := coalesce(nullif(btrim(v_opts ->> 'baseline_key'), ''),
                             plm.active_taxonomy_baseline_key());

  if v_baseline_key is null then
    insert into ingest.sync_run (
      source_system, source_name, status, started_at, finished_at,
      rows_seen, rows_failed, error, metadata)
    values (
      'shared_db', 'coldlion_designflow_daily_comparison', 'failed'::ingest.sync_status,
      now(), now(), 1, 1,
      'phase6 comparison REFUSED: no active taxonomy baseline on this database',
      jsonb_build_object(
        'refused', true,
        'reason', 'no_active_baseline',
        'observation_date', v_day,
        'environment', plm.resolve_deployment_environment()))
    returning id into v_cmp_run_id;

    if not v_skip_alert and not exists (
      select 1 from plm.taxonomy_sync_alert
      where source_name = 'coldlion_designflow_daily_comparison'
        and acknowledged_at is null
        and reason like 'refused: no active taxonomy baseline%'
    ) then
      v_alert_id := plm.record_taxonomy_sync_alert(
        'warning',
        'coldlion_designflow_daily_comparison',
        'refused: no active taxonomy baseline on this database -- no observation was recorded',
        v_cmp_run_id, null, v_day, false,
        jsonb_build_object('refused', true, 'reason', 'no_active_baseline',
                           'environment', plm.resolve_deployment_environment()));
    end if;

    return jsonb_build_object(
      'refused', true, 'reason', 'no_active_baseline', 'pass', false,
      'observation_date', v_day,
      'environment', plm.resolve_deployment_environment(),
      'comparison_run_id', v_cmp_run_id, 'alert_id', v_alert_id);
  end if;

  begin
    v_pins := plm.taxonomy_baseline_pin_set(v_baseline_key);
  exception when others then
    v_pin_error := left(sqlerrm, 2000);

    insert into ingest.sync_run (
      source_system, source_name, status, started_at, finished_at,
      rows_seen, rows_failed, error, metadata)
    values (
      'shared_db', 'coldlion_designflow_daily_comparison', 'failed'::ingest.sync_status,
      now(), now(), 1, 1,
      left('phase6 comparison BLIND: ' || v_pin_error, 4000),
      jsonb_build_object('baseline_unreadable', true, 'baseline_key', v_baseline_key,
                         'observation_date', v_day, 'error', v_pin_error))
    returning id into v_cmp_run_id;

    if not v_skip_alert then
      v_alert_id := plm.record_taxonomy_sync_alert(
        'critical',
        'coldlion_designflow_daily_comparison',
        'baseline unreadable, daily comparison is BLIND: ' || v_pin_error,
        v_cmp_run_id, null, v_day, false,
        jsonb_build_object('baseline_unreadable', true, 'baseline_key', v_baseline_key,
                           'failed_invariant', 'taxonomy_baseline_unreadable',
                           'error', v_pin_error));
    end if;

    return jsonb_build_object(
      'pass', false, 'baseline_unreadable', true, 'baseline_key', v_baseline_key,
      'error', v_pin_error, 'observation_date', v_day,
      'comparison_run_id', v_cmp_run_id, 'alert_id', v_alert_id);
  end;

  c_expected_licensor_count := (v_pins ->> 'licensor_count')::integer;
  c_expected_property_count := (v_pins ->> 'property_count')::integer;
  c_expected_licensor_uuid_hash := v_pins ->> 'licensor_uuid_hash';
  c_expected_property_uuid_hash := v_pins ->> 'property_uuid_hash';
  c_expected_licensor_status_hash := v_pins ->> 'licensor_status_hash';
  c_expected_property_status_hash := v_pins ->> 'property_status_hash';
  c_expected_parent_edge_hash := v_pins ->> 'parent_edge_hash';
  c_expected_taxonomy_source_ref_count := (v_pins ->> 'taxonomy_source_ref_count')::integer;
  c_expected_coldlion_refs := (v_pins ->> 'coldlion_source_ref_count')::integer;
  c_expected_designflow_refs := (v_pins ->> 'designflow_source_ref_count')::integer;
  c_expected_linked_licensors := (v_pins ->> 'linked_licensor_count')::integer;
  c_expected_linked_properties := (v_pins ->> 'linked_property_count')::integer;

  -- Live snapshot (never from caller).
  v_snap := plm.compute_taxonomy_immutability_snapshot();

  -- Issue #552: refuse an unreviewed licensor-status state before this
  -- detector can write an observation, alert, health run, or breaker signal.
  -- These are the only two states covered by the owner-reviewed transition:
  -- the pre-ruling hash and the post-ruling hash from 20260802171000.
  if (v_snap ->> 'licensor_status_hash') is null
     or (v_snap ->> 'licensor_status_hash') not in (
    'd9b07759bf80ff227e2fa9bd635d2138',
    '00bf7069fff79b9deab1d14dbd9112b2'
  ) then
    raise exception using
      message = 'taxonomy health refused: live licensor_status_hash is outside the reviewed transition',
      detail = format(
        'actual=%s allowed=d9b07759bf80ff227e2fa9bd635d2138,00bf7069fff79b9deab1d14dbd9112b2',
        coalesce(v_snap ->> 'licensor_status_hash', '<null>')
      ),
      hint = 'Review the licensor-status change and ship a new governed transition before running health or observation functions.';
  end if;

  select * into v_cl
  from ingest.sync_run
  where source_system = 'coldlion'
    and source_name = 'coldlion_licensors_properties_api'
  order by coalesce(finished_at, started_at, created_at) desc nulls last
  limit 1;

  select * into v_df
  from ingest.sync_run
  where source_system = 'designflow_plm'
    and source_name = 'plm_master_data_api'
  order by coalesce(finished_at, started_at, created_at) desc nulls last
  limit 1;

  -- Prior for day-over-day: most recent NON-DRILL observation (never a drill).
  select * into v_prior
  from plm.taxonomy_parallel_observation
  where is_drill = false
    and observation_date <= v_day
  order by observed_at desc
  limit 1;

  -- ------------------------------------------------------------------
  -- Baseline pins (always; first day included)
  -- ------------------------------------------------------------------
  if (v_snap ->> 'licensor_count')::integer is distinct from c_expected_licensor_count
     or (v_snap ->> 'property_count')::integer is distinct from c_expected_property_count
     or (v_snap ->> 'licensor_uuid_hash') is distinct from c_expected_licensor_uuid_hash
     or (v_snap ->> 'property_uuid_hash') is distinct from c_expected_property_uuid_hash
     or (v_snap ->> 'licensor_status_hash') is distinct from c_expected_licensor_status_hash
     or (v_snap ->> 'property_status_hash') is distinct from c_expected_property_status_hash
     or (v_snap ->> 'parent_edge_hash') is distinct from c_expected_parent_edge_hash
     or (v_snap ->> 'taxonomy_source_ref_count')::integer is distinct from c_expected_taxonomy_source_ref_count
     or (v_snap ->> 'coldlion_source_ref_count')::integer is distinct from c_expected_coldlion_refs
     or (v_snap ->> 'designflow_source_ref_count')::integer is distinct from c_expected_designflow_refs
     or (v_snap ->> 'linked_licensor_count')::integer is distinct from c_expected_linked_licensors
     or (v_snap ->> 'linked_property_count')::integer is distinct from c_expected_linked_properties
  then
    v_baseline_ok := false;
    v_unexplained := v_unexplained + 1;
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'kind', 'phase4_baseline_drift',
      'baseline_key', v_baseline_key,
      'expected', jsonb_build_object(
        'licensor_count', c_expected_licensor_count,
        'property_count', c_expected_property_count,
        'licensor_uuid_hash', c_expected_licensor_uuid_hash,
        'property_uuid_hash', c_expected_property_uuid_hash,
        'licensor_status_hash', c_expected_licensor_status_hash,
        'property_status_hash', c_expected_property_status_hash,
        'parent_edge_hash', c_expected_parent_edge_hash,
        'taxonomy_source_ref_count', c_expected_taxonomy_source_ref_count,
        'coldlion_source_ref_count', c_expected_coldlion_refs,
        'designflow_source_ref_count', c_expected_designflow_refs,
        'linked_licensor_count', c_expected_linked_licensors,
        'linked_property_count', c_expected_linked_properties
      ),
      'actual', jsonb_build_object(
        'licensor_count', (v_snap ->> 'licensor_count')::integer,
        'property_count', (v_snap ->> 'property_count')::integer,
        'licensor_uuid_hash', v_snap ->> 'licensor_uuid_hash',
        'property_uuid_hash', v_snap ->> 'property_uuid_hash',
        'licensor_status_hash', v_snap ->> 'licensor_status_hash',
        'property_status_hash', v_snap ->> 'property_status_hash',
        'parent_edge_hash', v_snap ->> 'parent_edge_hash',
        'taxonomy_source_ref_count', (v_snap ->> 'taxonomy_source_ref_count')::integer,
        'coldlion_source_ref_count', (v_snap ->> 'coldlion_source_ref_count')::integer,
        'designflow_source_ref_count', (v_snap ->> 'designflow_source_ref_count')::integer,
        'linked_licensor_count', (v_snap ->> 'linked_licensor_count')::integer,
        'linked_property_count', (v_snap ->> 'linked_property_count')::integer
      )
    ));
  end if;

  -- Link pins (subset of baseline; kept for explicit diffs).
  v_links_ok :=
    (v_snap ->> 'coldlion_source_ref_count')::integer = c_expected_coldlion_refs
    and (v_snap ->> 'linked_licensor_count')::integer = c_expected_linked_licensors
    and (v_snap ->> 'linked_property_count')::integer = c_expected_linked_properties
    and (v_snap ->> 'designflow_source_ref_count')::integer = c_expected_designflow_refs
    and (v_snap ->> 'taxonomy_source_ref_count')::integer = c_expected_taxonomy_source_ref_count;

  if not v_links_ok then
    v_unexplained := v_unexplained + 1;
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'kind', 'link_drift',
      'expected_coldlion_refs', c_expected_coldlion_refs,
      'actual_coldlion_refs', (v_snap ->> 'coldlion_source_ref_count')::integer,
      'expected_linked_licensors', c_expected_linked_licensors,
      'actual_linked_licensors', (v_snap ->> 'linked_licensor_count')::integer,
      'expected_linked_properties', c_expected_linked_properties,
      'actual_linked_properties', (v_snap ->> 'linked_property_count')::integer
    ));
  end if;

  -- Lane freshness/status.
  if v_cl.id is not null
     and v_cl.status = 'succeeded'
     and coalesce(v_cl.finished_at, v_cl.started_at) >= (now() - v_max_age)
  then
    v_coldlion_ok := true;
  else
    v_unexplained := v_unexplained + 1;
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'kind', 'coldlion_lane',
      'status', coalesce(v_cl.status::text, 'missing'),
      'run_id', v_cl.id,
      'finished_at', v_cl.finished_at,
      'max_age', v_max_age::text
    ));
  end if;

  -- DesignFlow runtime lane retired: keep its evidence, but never require a run.

  -- Day-over-day vs prior non-drill (additional to baseline pins).
  if v_prior.id is not null and v_prior.is_drill is not true then
    if v_prior.licensor_uuid_hash is distinct from (v_snap ->> 'licensor_uuid_hash')
       or v_prior.property_uuid_hash is distinct from (v_snap ->> 'property_uuid_hash')
       or v_prior.licensor_status_hash is distinct from (v_snap ->> 'licensor_status_hash')
       or v_prior.property_status_hash is distinct from (v_snap ->> 'property_status_hash')
       or v_prior.parent_edge_hash is distinct from (v_snap ->> 'parent_edge_hash')
       or v_prior.source_ref_hash is distinct from (v_snap ->> 'source_ref_hash')
       or v_prior.coldlion_source_ref_count is distinct from (v_snap ->> 'coldlion_source_ref_count')::integer
       or v_prior.linked_licensor_count is distinct from (v_snap ->> 'linked_licensor_count')::integer
       or v_prior.linked_property_count is distinct from (v_snap ->> 'linked_property_count')::integer
    then
      v_immutability_ok := false;
      v_unexplained := v_unexplained + 1;
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
        'kind', 'prior_nondrill_drift',
        'prior_observation_id', v_prior.id,
        'prior_observation_date', v_prior.observation_date
      ));
    end if;
  end if;

  if v_force_fail then
    v_unexplained := v_unexplained + 1;
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'kind', 'forced_failure_drill',
      'note', 'Append-only drill evidence; does not overwrite non-drill daily rows; no canonical mutation'
    ));
  end if;

  v_pass := v_baseline_ok
        and v_coldlion_ok
        and v_links_ok
        and v_immutability_ok
        and not v_force_fail
        and v_unexplained = 0;

  v_details := jsonb_build_object(
    'snapshot', v_snap,
    'designflow_lane', jsonb_build_object('status', 'retired', 'required', false),
    'max_success_age', v_max_age::text,
    'is_drill', v_is_drill,
    'baseline_key', v_baseline_key,
    'baseline_source', 'plm.taxonomy_baseline_pin',
    'phase4_baseline', jsonb_build_object(
      'licensor_count', c_expected_licensor_count,
      'property_count', c_expected_property_count,
      'licensor_uuid_hash', c_expected_licensor_uuid_hash,
      'property_uuid_hash', c_expected_property_uuid_hash,
      'licensor_status_hash', c_expected_licensor_status_hash,
      'property_status_hash', c_expected_property_status_hash,
      'parent_edge_hash', c_expected_parent_edge_hash,
      'taxonomy_source_ref_count', c_expected_taxonomy_source_ref_count,
      'coldlion_source_ref_count', c_expected_coldlion_refs,
      'designflow_source_ref_count', c_expected_designflow_refs,
      'linked_licensors', c_expected_linked_licensors,
      'linked_properties', c_expected_linked_properties
    ),
    'diffs', v_diffs,
    'force_fail', v_force_fail,
    'phase', '6A',
    'recorded_by', 'plm.record_taxonomy_parallel_observation',
    'append_only', true
  );

  insert into ingest.sync_run (
    source_system, source_name, status, started_at, finished_at, rows_seen,
    rows_failed, error, metadata
  )
  values (
    'shared_db',
    'coldlion_designflow_daily_comparison',
    case when v_pass then 'succeeded'::ingest.sync_status else 'failed'::ingest.sync_status end,
    now(),
    now(),
    1,
    case when v_pass then 0 else greatest(v_unexplained, 1) end,
    case when v_pass then null else left('phase6 comparison failed: ' || v_unexplained::text || ' unexplained', 4000) end,
    jsonb_build_object(
      'observation_date', v_day,
      'pass', v_pass,
      'is_drill', v_is_drill,
      'baseline_key', v_baseline_key,
      'unexplained_diff_count', v_unexplained,
      'coldlion_run_id', v_cl.id,
      'designflow_run_id', v_df.id,
      'designflow_lane', jsonb_build_object('status', 'retired', 'required', false)
    )
  )
  returning id into v_cmp_run_id;

  -- APPEND-ONLY: always INSERT a new row. Never UPDATE / ON CONFLICT.
  insert into plm.taxonomy_parallel_observation (
    observation_date, observed_at, is_drill,
    coldlion_run_id, coldlion_run_status, coldlion_run_finished_at,
    designflow_run_id, designflow_run_status, designflow_run_finished_at,
    comparison_run_id,
    licensor_count, property_count, taxonomy_source_ref_count,
    coldlion_source_ref_count, designflow_source_ref_count,
    linked_licensor_count, linked_property_count, open_review_count,
    licensor_uuid_hash, property_uuid_hash, licensor_status_hash,
    property_status_hash, status_hash, parent_edge_hash, source_ref_hash,
    coldlion_mirror_key_hash,
    prior_observation_id, prior_observation_date,
    prior_licensor_uuid_hash, prior_property_uuid_hash,
    prior_licensor_status_hash, prior_property_status_hash,
    prior_status_hash, prior_parent_edge_hash, prior_source_ref_hash,
    prior_coldlion_source_ref_count, prior_linked_licensor_count,
    prior_linked_property_count,
    baseline_ok, coldlion_ok, designflow_ok, immutability_ok, links_ok, pass,
    unexplained_diff_count, details
  )
  values (
    v_day,
    now(),
    v_is_drill,
    v_cl.id,
    v_cl.status::text,
    v_cl.finished_at,
    v_df.id,
    v_df.status::text,
    v_df.finished_at,
    v_cmp_run_id,
    (v_snap ->> 'licensor_count')::integer,
    (v_snap ->> 'property_count')::integer,
    (v_snap ->> 'taxonomy_source_ref_count')::integer,
    (v_snap ->> 'coldlion_source_ref_count')::integer,
    (v_snap ->> 'designflow_source_ref_count')::integer,
    (v_snap ->> 'linked_licensor_count')::integer,
    (v_snap ->> 'linked_property_count')::integer,
    (v_snap ->> 'open_review_count')::integer,
    v_snap ->> 'licensor_uuid_hash',
    v_snap ->> 'property_uuid_hash',
    v_snap ->> 'licensor_status_hash',
    v_snap ->> 'property_status_hash',
    v_snap ->> 'status_hash',
    v_snap ->> 'parent_edge_hash',
    v_snap ->> 'source_ref_hash',
    v_snap ->> 'coldlion_mirror_key_hash',
    case when v_prior.is_drill is not true then v_prior.id else null end,
    case when v_prior.is_drill is not true then v_prior.observation_date else null end,
    case when v_prior.is_drill is not true then v_prior.licensor_uuid_hash else null end,
    case when v_prior.is_drill is not true then v_prior.property_uuid_hash else null end,
    case when v_prior.is_drill is not true then v_prior.licensor_status_hash else null end,
    case when v_prior.is_drill is not true then v_prior.property_status_hash else null end,
    case when v_prior.is_drill is not true then v_prior.status_hash else null end,
    case when v_prior.is_drill is not true then v_prior.parent_edge_hash else null end,
    case when v_prior.is_drill is not true then v_prior.source_ref_hash else null end,
    case when v_prior.is_drill is not true then v_prior.coldlion_source_ref_count else null end,
    case when v_prior.is_drill is not true then v_prior.linked_licensor_count else null end,
    case when v_prior.is_drill is not true then v_prior.linked_property_count else null end,
    v_baseline_ok,
    v_coldlion_ok,
    v_designflow_ok,
    v_immutability_ok,
    v_links_ok,
    v_pass,
    v_unexplained,
    v_details
  )
  returning id into v_obs_id;

  if not v_pass and not v_skip_alert then
    v_alert_id := plm.record_taxonomy_sync_alert(
      'critical',
      'coldlion_designflow_daily_comparison',
      case
        when v_force_fail then 'forced_failure_drill'
        else 'daily comparison failed with ' || v_unexplained::text || ' unexplained diff(s)'
      end,
      v_cmp_run_id,
      v_obs_id,
      v_day,
      v_is_drill,
      jsonb_build_object(
        'pass', v_pass,
        'is_drill', v_is_drill,
        'baseline_key', v_baseline_key,
        'unexplained_diff_count', v_unexplained,
        'diffs', v_diffs,
        'force_fail', v_force_fail,
        'observation_id', v_obs_id
      )
    );
  end if;

  v_result := jsonb_build_object(
    'observation_id', v_obs_id,
    'observation_date', v_day,
    'is_drill', v_is_drill,
    'pass', v_pass,
    'baseline_ok', v_baseline_ok,
    'baseline_key', v_baseline_key,
    'coldlion_ok', v_coldlion_ok,
    'designflow_ok', v_designflow_ok,
    'designflow_lane', jsonb_build_object('status', 'retired', 'required', false),
    'links_ok', v_links_ok,
    'immutability_ok', v_immutability_ok,
    'unexplained_diff_count', v_unexplained,
    'comparison_run_id', v_cmp_run_id,
    'alert_id', v_alert_id,
    'coldlion_run_id', v_cl.id,
    'designflow_run_id', v_df.id,
    'licensor_count', (v_snap ->> 'licensor_count')::integer,
    'property_count', (v_snap ->> 'property_count')::integer,
    'taxonomy_source_ref_count', (v_snap ->> 'taxonomy_source_ref_count')::integer,
    'coldlion_source_ref_count', (v_snap ->> 'coldlion_source_ref_count')::integer,
    'designflow_source_ref_count', (v_snap ->> 'designflow_source_ref_count')::integer,
    'linked_licensor_count', (v_snap ->> 'linked_licensor_count')::integer,
    'linked_property_count', (v_snap ->> 'linked_property_count')::integer,
    'licensor_uuid_hash', v_snap ->> 'licensor_uuid_hash',
    'property_uuid_hash', v_snap ->> 'property_uuid_hash',
    'licensor_status_hash', v_snap ->> 'licensor_status_hash',
    'property_status_hash', v_snap ->> 'property_status_hash',
    'status_hash', v_snap ->> 'status_hash',
    'parent_edge_hash', v_snap ->> 'parent_edge_hash',
    'source_ref_hash', v_snap ->> 'source_ref_hash',
    'diffs', v_diffs
  );

  return v_result;
end;
$function$
;
revoke all on function plm.record_taxonomy_parallel_observation(p_observation_date date, p_options jsonb) from public, anon, authenticated;
grant execute on function plm.record_taxonomy_parallel_observation(p_observation_date date, p_options jsonb) to service_role;
CREATE OR REPLACE FUNCTION plm.refresh_style_tracker_item_bridge()
 RETURNS TABLE(inserted_count integer, updated_count integer, total_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'plm', 'core', 'extensions'
AS $function$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  SELECT count(*) INTO v_before FROM plm.style_tracker_item_bridge;

  WITH erp_matches AS (
    SELECT upper(trim(style_number)) AS normalized_sku, CASE WHEN count(*) = 1 THEN min(id::text)::uuid END AS id, count(*) AS candidate_count
    FROM plm.legacy_erp_item_identity
    WHERE style_number IS NOT NULL AND trim(style_number) <> ''
    GROUP BY upper(trim(style_number))
  ),
  style_group_matches AS (
    SELECT upper(trim(sku)) AS normalized_sku, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM public.style_groups
    WHERE sku IS NOT NULL AND trim(sku) <> ''
    GROUP BY upper(trim(sku))
  ),
  company_matches AS (
    SELECT lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS normalized_name, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM core.customer
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ),
  public_licensor_matches AS (
    SELECT lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS normalized_name, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM public.licensors
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ),
  core_licensor_matches AS (
    SELECT lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS normalized_name, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM core.licensor
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ),
  factory_matches AS (
    SELECT lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS normalized_name, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM core.factory
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ),
  plm_item_matches AS (
    SELECT upper(trim(coalesce(style_number, item_number))) AS normalized_sku, CASE WHEN count(*) = 1 THEN min(id::text)::uuid END AS id, count(*) AS candidate_count
    FROM plm.item
    WHERE coalesce(style_number, item_number) IS NOT NULL AND trim(coalesce(style_number, item_number)) <> ''
    GROUP BY upper(trim(coalesce(style_number, item_number)))
  ),
  row_values AS (
    SELECT
      r.*,
      plm.normalize_style_tracker_value('sku', r.sku) AS sku_norm,
      plm.normalize_style_tracker_value('customer', r.customer) AS customer_norm,
      plm.normalize_style_tracker_value('licensor', r.licensor) AS licensor_norm,
      plm.normalize_style_tracker_value('factory', r.default_vendor) AS factory_norm
    FROM public.style_tracker_rows r
    WHERE r.source_sheet IN ('License.Style', 'Generic.Style')
  ),
  customer_values AS (
    SELECT DISTINCT customer_norm, customer
    FROM row_values
    WHERE customer_norm IS NOT NULL
  ),
  licensor_values AS (
    SELECT DISTINCT licensor_norm, licensor
    FROM row_values
    WHERE licensor_norm IS NOT NULL
  ),
  factory_values AS (
    SELECT DISTINCT factory_norm, default_vendor
    FROM row_values
    WHERE factory_norm IS NOT NULL
  ),
  fuzzy_customers AS (
    SELECT DISTINCT ON (v.customer_norm)
      v.customer_norm,
      jsonb_build_object('target_schema', c.target_schema, 'target_table', c.target_table, 'target_id', c.target_id, 'target_label', c.target_label, 'score', c.score) AS suggestion
    FROM customer_values v
    CROSS JOIN LATERAL public.search_style_tracker_link_candidates('customer', v.customer, 1) c
    ORDER BY v.customer_norm, c.score DESC
  ),
  fuzzy_licensors AS (
    SELECT DISTINCT ON (v.licensor_norm)
      v.licensor_norm,
      jsonb_build_object('target_schema', c.target_schema, 'target_table', c.target_table, 'target_id', c.target_id, 'target_label', c.target_label, 'score', c.score) AS suggestion
    FROM licensor_values v
    CROSS JOIN LATERAL public.search_style_tracker_link_candidates('licensor', v.licensor, 1) c
    ORDER BY v.licensor_norm, c.score DESC
  ),
  fuzzy_factories AS (
    SELECT DISTINCT ON (v.factory_norm)
      v.factory_norm,
      jsonb_build_object('target_schema', c.target_schema, 'target_table', c.target_table, 'target_id', c.target_id, 'target_label', c.target_label, 'score', c.score) AS suggestion
    FROM factory_values v
    CROSS JOIN LATERAL public.search_style_tracker_link_candidates('factory', v.default_vendor, 1) c
    ORDER BY v.factory_norm, c.score DESC
  ),
  resolved AS (
    SELECT
      r.*,
      CASE WHEN sku_res.resolution_type = 'canonical' AND sku_res.target_schema = 'public' AND sku_res.target_table = 'erp_items_current' THEN sku_res.target_id ELSE erp.id END AS erp_item_id,
      CASE WHEN sku_res.resolution_type = 'canonical' AND sku_res.target_schema = 'public' AND sku_res.target_table = 'style_groups' THEN sku_res.target_id ELSE sg.id END AS style_group_id,
      CASE WHEN customer_res.resolution_type = 'canonical' AND customer_res.target_schema = 'core' AND customer_res.target_table = 'customer' THEN customer_res.target_id ELSE company.id END AS company_id,
      CASE WHEN licensor_res.resolution_type = 'canonical' AND licensor_res.target_schema = 'public' AND licensor_res.target_table = 'licensors' THEN licensor_res.target_id ELSE public_lic.id END AS public_licensor_id,
      CASE WHEN licensor_res.resolution_type = 'canonical' AND licensor_res.target_schema = 'core' AND licensor_res.target_table = 'licensor' THEN licensor_res.target_id ELSE core_lic.id END AS core_licensor_id,
      CASE WHEN factory_res.resolution_type = 'canonical' AND factory_res.target_schema = 'core' AND factory_res.target_table = 'factory' THEN factory_res.target_id ELSE factory.id END AS factory_id,
      CASE WHEN sku_res.resolution_type = 'canonical' AND sku_res.target_schema = 'plm' AND sku_res.target_table = 'item' THEN sku_res.target_id ELSE coalesce(plm_item.id, content_item.id) END AS plm_item_id,
      sku_res.local_value AS local_sku_value,
      customer_res.local_value AS local_customer_value,
      licensor_res.local_value AS local_licensor_value,
      factory_res.local_value AS local_factory_value,
      coalesce(erp.candidate_count, 0) AS erp_candidates,
      coalesce(sg.candidate_count, 0) AS style_group_candidates,
      coalesce(company.candidate_count, 0) AS company_candidates,
      coalesce(public_lic.candidate_count, 0) AS public_licensor_candidates,
      coalesce(core_lic.candidate_count, 0) AS core_licensor_candidates,
      coalesce(factory.candidate_count, 0) AS factory_candidates,
      coalesce(nullif(content_item.candidate_count, 0), plm_item.candidate_count, 0) AS plm_item_candidates,
      fuzzy_customer.suggestion AS fuzzy_customer_suggestion,
      fuzzy_licensor.suggestion AS fuzzy_licensor_suggestion,
      fuzzy_factory.suggestion AS fuzzy_factory_suggestion
    FROM row_values r
    LEFT JOIN erp_matches erp ON erp.normalized_sku = r.sku_norm
    LEFT JOIN style_group_matches sg ON sg.normalized_sku = r.sku_norm
    LEFT JOIN company_matches company ON company.normalized_name = r.customer_norm
    LEFT JOIN public_licensor_matches public_lic ON public_lic.normalized_name = r.licensor_norm
    LEFT JOIN core_licensor_matches core_lic ON core_lic.normalized_name = r.licensor_norm
    LEFT JOIN factory_matches factory ON factory.normalized_name = r.factory_norm
    LEFT JOIN plm_item_matches plm_item ON plm_item.normalized_sku = r.sku_norm
    LEFT JOIN plm.style_tracker_item_bridge existing_bridge ON existing_bridge.style_tracker_row_id = r.id
    LEFT JOIN plm.legacy_erp_item_identity existing_erp ON existing_erp.id = existing_bridge.erp_item_id
    LEFT JOIN LATERAL (
      WITH scored AS (
        SELECT p.id,
          ((nullif(trim(existing_erp.item_description), '') is not null and upper(trim(existing_erp.item_description)) = upper(trim(p.description)))::int +
           (nullif(trim(existing_erp.mg01_code), '') is not null and upper(trim(existing_erp.mg01_code)) = upper(trim(p.raw ->> 'merchGroup01')))::int +
           (nullif(trim(existing_erp.mg02_code), '') is not null and upper(trim(existing_erp.mg02_code)) = upper(trim(p.raw ->> 'merchGroup02')))::int +
           (nullif(trim(existing_erp.mg03_code), '') is not null and upper(trim(existing_erp.mg03_code)) = upper(trim(p.raw ->> 'merchGroup03')))::int +
           (nullif(trim(existing_erp.mg04_code), '') is not null and upper(trim(existing_erp.mg04_code)) = upper(trim(p.raw ->> 'merchGroup04')))::int +
           (nullif(trim(existing_erp.mg05_code), '') is not null and upper(trim(existing_erp.mg05_code)) = upper(trim(p.raw ->> 'merchGroup05')))::int +
           (nullif(trim(existing_erp.mg06_code), '') is not null and upper(trim(existing_erp.mg06_code)) = upper(trim(p.raw ->> 'merchGroup06')))::int) AS score
        FROM plm.item p
        WHERE existing_erp.id is not null
          AND upper(trim(p.item_number)) = upper(trim(existing_erp.external_id))
      ), ranked AS (
        SELECT id, score, dense_rank() over (order by score desc) AS score_rank
        FROM scored
      )
      SELECT CASE WHEN count(*) = 1 AND max(score) > 0 THEN min(id::text)::uuid END AS id,
             CASE WHEN max(score) > 0 THEN count(*)::bigint ELSE 0::bigint END AS candidate_count
      FROM ranked
      WHERE score_rank = 1
    ) content_item ON plm_item.candidate_count > 1
    LEFT JOIN plm.style_tracker_value_resolution sku_res ON sku_res.field_key = 'sku' AND sku_res.normalized_value = r.sku_norm
    LEFT JOIN plm.style_tracker_value_resolution customer_res ON customer_res.field_key = 'customer' AND customer_res.normalized_value = r.customer_norm
    LEFT JOIN plm.style_tracker_value_resolution licensor_res ON licensor_res.field_key = 'licensor' AND licensor_res.normalized_value = r.licensor_norm
    LEFT JOIN plm.style_tracker_value_resolution factory_res ON factory_res.field_key = 'factory' AND factory_res.normalized_value = r.factory_norm
    LEFT JOIN fuzzy_customers fuzzy_customer ON fuzzy_customer.customer_norm = r.customer_norm AND company.id IS NULL AND customer_res.id IS NULL
    LEFT JOIN fuzzy_licensors fuzzy_licensor ON fuzzy_licensor.licensor_norm = r.licensor_norm AND public_lic.id IS NULL AND core_lic.id IS NULL AND licensor_res.id IS NULL
    LEFT JOIN fuzzy_factories fuzzy_factory ON fuzzy_factory.factory_norm = r.factory_norm AND factory.id IS NULL AND factory_res.id IS NULL
  ),
  upserted AS (
    INSERT INTO plm.style_tracker_item_bridge (
      style_tracker_row_id,
      source_workbook_id,
      source_sheet,
      source_row_number,
      tracker_type,
      sku,
      description,
      customer_name,
      designer_name,
      commissioned,
      upc,
      customer_sku,
      licensor_name,
      license_status,
      royalty,
      concept_status,
      pre_production_status,
      production_status,
      default_vendor_name,
      discontinued,
      notes,
      erp_item_id,
      style_group_id,
      company_id,
      public_licensor_id,
      core_licensor_id,
      factory_id,
      plm_item_id,
      match_status,
      match_confidence,
      match_notes,
      raw_row_data,
      last_matched_at
    )
    SELECT
      id,
      source_workbook_id,
      source_sheet,
      source_row_number,
      tracker_type,
      sku,
      description,
      customer,
      designer,
      commissioned,
      upc,
      customer_sku,
      licensor,
      license_status,
      royalty,
      concept_status,
      pre_production_status,
      production_status,
      default_vendor,
      discontinued,
      notes,
      erp_item_id,
      style_group_id,
      company_id,
      public_licensor_id,
      core_licensor_id,
      factory_id,
      plm_item_id,
      CASE
        WHEN greatest(erp_candidates, style_group_candidates, company_candidates, public_licensor_candidates, core_licensor_candidates, factory_candidates, plm_item_candidates) > 1
          THEN 'needs_review'
        WHEN fuzzy_customer_suggestion IS NOT NULL OR fuzzy_licensor_suggestion IS NOT NULL OR fuzzy_factory_suggestion IS NOT NULL
          THEN 'needs_review'
        WHEN erp_item_id IS NOT NULL OR style_group_id IS NOT NULL OR company_id IS NOT NULL OR public_licensor_id IS NOT NULL OR core_licensor_id IS NOT NULL OR factory_id IS NOT NULL OR plm_item_id IS NOT NULL
          THEN CASE WHEN erp_item_id IS NOT NULL OR style_group_id IS NOT NULL OR plm_item_id IS NOT NULL THEN 'matched' ELSE 'partial' END
        WHEN local_sku_value IS NOT NULL OR local_customer_value IS NOT NULL OR local_licensor_value IS NOT NULL OR local_factory_value IS NOT NULL
          THEN 'partial'
        ELSE 'unmatched'
      END,
      CASE
        WHEN greatest(erp_candidates, style_group_candidates, company_candidates, public_licensor_candidates, core_licensor_candidates, factory_candidates, plm_item_candidates) > 1
          THEN 'conflict'
        WHEN fuzzy_customer_suggestion IS NOT NULL OR fuzzy_licensor_suggestion IS NOT NULL OR fuzzy_factory_suggestion IS NOT NULL
          THEN 'possible'
        WHEN erp_item_id IS NOT NULL OR style_group_id IS NOT NULL OR plm_item_id IS NOT NULL
          THEN 'probable'
        WHEN company_id IS NOT NULL OR public_licensor_id IS NOT NULL OR core_licensor_id IS NOT NULL OR factory_id IS NOT NULL
          THEN 'possible'
        ELSE 'possible'
      END,
      jsonb_strip_nulls(jsonb_build_object(
        'erp_candidates', erp_candidates,
        'style_group_candidates', style_group_candidates,
        'company_candidates', company_candidates,
        'public_licensor_candidates', public_licensor_candidates,
        'core_licensor_candidates', core_licensor_candidates,
        'factory_candidates', factory_candidates,
        'plm_item_candidates', plm_item_candidates,
        'fuzzy', jsonb_strip_nulls(jsonb_build_object(
          'customer', fuzzy_customer_suggestion,
          'licensor', fuzzy_licensor_suggestion,
          'factory', fuzzy_factory_suggestion
        )),
        'master_data_values', jsonb_strip_nulls(jsonb_build_object(
          'sku', local_sku_value,
          'customer', local_customer_value,
          'licensor', local_licensor_value,
          'factory', local_factory_value
        ))
      )),
      row_data,
      now()
    FROM resolved
    ON CONFLICT (style_tracker_row_id) DO UPDATE SET
      source_workbook_id = EXCLUDED.source_workbook_id,
      source_sheet = EXCLUDED.source_sheet,
      source_row_number = EXCLUDED.source_row_number,
      tracker_type = EXCLUDED.tracker_type,
      sku = EXCLUDED.sku,
      description = EXCLUDED.description,
      customer_name = EXCLUDED.customer_name,
      designer_name = EXCLUDED.designer_name,
      commissioned = EXCLUDED.commissioned,
      upc = EXCLUDED.upc,
      customer_sku = EXCLUDED.customer_sku,
      licensor_name = EXCLUDED.licensor_name,
      license_status = EXCLUDED.license_status,
      royalty = EXCLUDED.royalty,
      concept_status = EXCLUDED.concept_status,
      pre_production_status = EXCLUDED.pre_production_status,
      production_status = EXCLUDED.production_status,
      default_vendor_name = EXCLUDED.default_vendor_name,
      discontinued = EXCLUDED.discontinued,
      notes = EXCLUDED.notes,
      erp_item_id = coalesce(plm.style_tracker_item_bridge.erp_item_id, EXCLUDED.erp_item_id),
      style_group_id = EXCLUDED.style_group_id,
      company_id = EXCLUDED.company_id,
      public_licensor_id = EXCLUDED.public_licensor_id,
      core_licensor_id = EXCLUDED.core_licensor_id,
      factory_id = EXCLUDED.factory_id,
      plm_item_id = coalesce(plm.style_tracker_item_bridge.plm_item_id, EXCLUDED.plm_item_id),
      match_status = EXCLUDED.match_status,
      match_confidence = EXCLUDED.match_confidence,
      match_notes = EXCLUDED.match_notes,
      raw_row_data = EXCLUDED.raw_row_data,
      last_matched_at = EXCLUDED.last_matched_at
    RETURNING (xmax = 0)::integer AS inserted_flag
  )
  SELECT
    coalesce(sum(inserted_flag), 0)::integer,
    (count(*) - coalesce(sum(inserted_flag), 0))::integer,
    count(*)::integer
  INTO inserted_count, updated_count, total_count
  FROM upserted;

  SELECT count(*) INTO v_after FROM plm.style_tracker_item_bridge;
  inserted_count := greatest(v_after - v_before, 0);

  RETURN NEXT;
END;
$function$
;
revoke all on function plm.refresh_style_tracker_item_bridge() from public, anon, authenticated;
grant execute on function plm.refresh_style_tracker_item_bridge() to service_role;
CREATE OR REPLACE FUNCTION plm.wb_validate_normalized_row(p_target text, p_row jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  allowed text[];
  k text;
  identity_key text;
begin
  if jsonb_typeof(p_row)<>'object' then raise exception 'Warner normalized import refused: row is not an object.' using errcode='P0001'; end if;
  allowed:=case p_target
    when 'wb_franchise' then array['source_namespace','source_id','fallback_key','label','identity_method','source_url']
    when 'wb_property' then array['source_namespace','source_id','fallback_key','label','identity_method','source_url']
    when 'wb_character_normalized' then array['source_namespace','source_id','fallback_key','label','identity_method','source_url']
    when 'wb_style_guide_normalized' then array['source_namespace','source_id','fallback_key','label','identity_method','source_url']
    when 'wb_asset_normalized' then array['source_namespace','source_id','warner_asset_id','file_name','source_path','season','file_size_bytes','source_created_at','source_modified_at','source_url']
    when 'wb_asset_franchise' then array['asset_namespace','asset_source_id','franchise_namespace','franchise_source_id','franchise_fallback_key','source_url']
    when 'wb_asset_property' then array['asset_namespace','asset_source_id','property_namespace','property_source_id','property_fallback_key','source_url']
    when 'wb_asset_character_normalized' then array['asset_namespace','asset_source_id','character_namespace','character_source_id','character_fallback_key','source_url']
    when 'wb_asset_style_guide_normalized' then array['asset_namespace','asset_source_id','style_guide_namespace','style_guide_source_id','style_guide_fallback_key','source_url']
    when 'wb_property_character_normalized' then array['property_namespace','property_source_id','property_fallback_key','character_namespace','character_source_id','character_fallback_key','property_label','character_label','identity_fallback','source_url']
    when 'wb_franchise_property_evidence' then array['franchise_namespace','franchise_source_id','franchise_fallback_key','property_namespace','property_source_id','property_fallback_key','evidence_source','source_url']
  end;
  foreach k in array array(select jsonb_object_keys(p_row)) loop
    if not k=any(allowed) or k~*'(token|secret|password|cookie|authorization|session)' then
      raise exception 'Warner normalized import refused: unexpected or forbidden field.' using errcode='P0001';
    end if;
  end loop;

  foreach identity_key in array array[
    'source_namespace','source_id','fallback_key','asset_namespace','asset_source_id',
    'franchise_namespace','franchise_source_id','franchise_fallback_key',
    'property_namespace','property_source_id','property_fallback_key',
    'character_namespace','character_source_id','character_fallback_key',
    'style_guide_namespace','style_guide_source_id','style_guide_fallback_key','evidence_source'
  ] loop
    if p_row ? identity_key and p_row->>identity_key is distinct from btrim(p_row->>identity_key) then
      raise exception 'Warner normalized import refused: identity fields must be trimmed.' using errcode='P0001';
    end if;
  end loop;

  if btrim(coalesce(p_row->>'source_url',''))='' or p_row->>'source_url'~'[?#]' then raise exception 'Warner normalized import refused: source URL must be an origin.' using errcode='P0001'; end if;
  if p_target in('wb_franchise','wb_property','wb_character_normalized','wb_style_guide_normalized') and not (
    btrim(coalesce(p_row->>'source_namespace',''))<>'' and btrim(coalesce(p_row->>'label',''))<>'' and
    ((p_row->>'identity_method'='source_id' and btrim(coalesce(p_row->>'source_id',''))<>'' and nullif(btrim(p_row->>'fallback_key'),'') is null) or
     (p_row->>'identity_method'='natural_key_fallback' and nullif(btrim(p_row->>'source_id'),'') is null and btrim(coalesce(p_row->>'fallback_key',''))<>'')))
  then raise exception 'Warner normalized import refused: identity fields are inconsistent.' using errcode='P0001'; end if;
  if p_target='wb_property' and p_row->>'source_namespace' not in('warner_product_catalogue','warner_art_assets') then raise exception 'Warner normalized import refused: Property namespace is invalid.' using errcode='P0001'; end if;
  if p_target='wb_asset_normalized' then
    if btrim(coalesce(p_row->>'source_namespace',''))='' or btrim(coalesce(p_row->>'source_id',''))='' or btrim(coalesce(p_row->>'file_name',''))='' or btrim(coalesce(p_row->>'source_path',''))='' then raise exception 'Warner normalized import refused: Asset identity is incomplete.' using errcode='P0001'; end if;
    begin
      perform (p_row->>'file_size_bytes')::bigint where p_row ? 'file_size_bytes';
      perform (p_row->>'source_created_at')::timestamptz where p_row ? 'source_created_at';
      perform (p_row->>'source_modified_at')::timestamptz where p_row ? 'source_modified_at';
    exception when others then raise exception 'Warner normalized import refused: an Asset value is invalid.' using errcode='P0001'; end;
  end if;
  if p_target like 'wb_asset_%' and p_target<>'wb_asset_normalized' and (btrim(coalesce(p_row->>'asset_namespace',''))='' or btrim(coalesce(p_row->>'asset_source_id',''))='') then raise exception 'Warner normalized import refused: Asset endpoint is incomplete.' using errcode='P0001'; end if;
  if p_target in('wb_asset_property','wb_property_character_normalized','wb_franchise_property_evidence') and (p_row->>'property_namespace' not in('warner_product_catalogue','warner_art_assets') or ((nullif(btrim(p_row->>'property_source_id'),'') is null)=(nullif(btrim(p_row->>'property_fallback_key'),'') is null))) then raise exception 'Warner normalized import refused: Property endpoint identity is invalid.' using errcode='P0001'; end if;
  if p_target='wb_property_character_normalized' and p_row->>'property_namespace'<>'warner_product_catalogue' then raise exception 'Warner normalized import refused: direct Property-to-Character evidence must come from the Product catalogue.' using errcode='P0001'; end if;
  if p_target in('wb_asset_franchise','wb_franchise_property_evidence') and (btrim(coalesce(p_row->>'franchise_namespace',''))='' or ((nullif(btrim(p_row->>'franchise_source_id'),'') is null)=(nullif(btrim(p_row->>'franchise_fallback_key'),'') is null))) then raise exception 'Warner normalized import refused: Franchise endpoint identity is invalid.' using errcode='P0001'; end if;
  if p_target in('wb_asset_character_normalized','wb_property_character_normalized') and (btrim(coalesce(p_row->>'character_namespace',''))='' or ((nullif(btrim(p_row->>'character_source_id'),'') is null)=(nullif(btrim(p_row->>'character_fallback_key'),'') is null))) then raise exception 'Warner normalized import refused: Character endpoint identity is invalid.' using errcode='P0001'; end if;
  if p_target='wb_asset_style_guide_normalized' and (btrim(coalesce(p_row->>'style_guide_namespace',''))='' or ((nullif(btrim(p_row->>'style_guide_source_id'),'') is null)=(nullif(btrim(p_row->>'style_guide_fallback_key'),'') is null))) then raise exception 'Warner normalized import refused: Style Guide endpoint identity is invalid.' using errcode='P0001'; end if;
  if p_target='wb_property_character_normalized' and (btrim(coalesce(p_row->>'property_label',''))='' or btrim(coalesce(p_row->>'character_label',''))='') then raise exception 'Warner normalized import refused: direct relationship labels are required.' using errcode='P0001'; end if;
  if p_target='wb_property_character_normalized' and p_row ? 'identity_fallback' then
    begin perform (p_row->>'identity_fallback')::boolean;
    exception when others then raise exception 'Warner normalized import refused: a relationship value is invalid.' using errcode='P0001'; end;
  end if;
  if p_target='wb_franchise_property_evidence' and btrim(coalesce(p_row->>'evidence_source',''))='' then raise exception 'Warner normalized import refused: direct evidence source is required.' using errcode='P0001'; end if;
end $function$
;
revoke all on function plm.wb_validate_normalized_row(p_target text, p_row jsonb) from public, anon, authenticated;
grant execute on function plm.wb_validate_normalized_row(p_target text, p_row jsonb) to service_role;


