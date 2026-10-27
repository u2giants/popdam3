-- Contract tests for issue #4920 / migration 20261027182138.
-- api.crm_email_routing_stage_counts and api.crm_email_routing_stage_page:
-- a caller without CRM access is refused; a CRM caller's stage counts equal the
-- stage rule applied to the whole table, sum to the total, and each stage page
-- returns exactly that stage's rows. Callers run as the real authenticated role.
-- Fixtures roll back.

begin;

do $$
declare
  v_allowed_profile uuid; v_allowed_auth uuid;
  v_denied_profile uuid; v_denied_auth uuid;
  v_customer uuid; v_department uuid; v_opportunity uuid;
  v_tag text := 'ZZTEST-4920 ' || gen_random_uuid()::text;
  v_exp record;
  v_got record;
  v_refused boolean;
  v_stage text;
  v_n bigint;
  v_page_n bigint;
begin
  select p.id, p.auth_user_id into v_allowed_profile, v_allowed_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 0;
  select p.id, p.auth_user_id into v_denied_profile, v_denied_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 1;
  if v_denied_profile is null then
    raise exception 'fixture requires two active authenticated profiles';
  end if;

  delete from app.user_role where profile_id in (v_allowed_profile, v_denied_profile);
  delete from app.app_access where profile_id in (v_allowed_profile, v_denied_profile) and app = 'crm';
  insert into app.app_access (profile_id, app) values (v_allowed_profile, 'crm');

  insert into core.customer (name) values (v_tag) returning id into v_customer;
  insert into crm.department (company_id, name) values (v_customer, v_tag) returning id into v_department;
  insert into crm.opportunity (name) values (v_tag) returning id into v_opportunity;

  -- One message per stage, newest of all so stage page 1 must contain each.
  insert into crm.email_message (external_source, external_id, subject, received_at, routing_status, company_id, department_id, opportunity_id) values
    ('zztest-4920', v_tag || ' needs_company', v_tag || ' needs_company',    now() + interval '1 day', 'UNROUTED',     null,        null,         null),
    ('zztest-4920', v_tag || ' needs_department', v_tag || ' needs_department', now() + interval '1 day', 'COMPANY_ONLY', v_customer,  null,         null),
    ('zztest-4920', v_tag || ' needs_program', v_tag || ' needs_program',    now() + interval '1 day', 'COMPANY_DEPT', v_customer,  v_department, null),
    ('zztest-4920', v_tag || ' routed', v_tag || ' routed',           now() + interval '1 day', 'SKIPPED',      v_customer,  v_department, v_opportunity),
    ('zztest-4920', v_tag || ' skipped', v_tag || ' skipped',          now() + interval '1 day', 'SKIPPED',      null,        null,         null);

  -- Owner baseline, before any role switch.
  select
    count(*) filter (where opportunity_id is null and routing_status is distinct from 'SKIPPED' and company_id is null) as needs_company,
    count(*) filter (where opportunity_id is null and routing_status is distinct from 'SKIPPED' and company_id is not null and department_id is null) as needs_department,
    count(*) filter (where opportunity_id is null and routing_status is distinct from 'SKIPPED' and company_id is not null and department_id is not null) as needs_program,
    count(*) filter (where opportunity_id is not null) as routed,
    count(*) filter (where opportunity_id is null and routing_status = 'SKIPPED') as skipped,
    count(*) as total
  into v_exp from crm.email_message;

  perform set_config('request.jwt.claim.sub', v_denied_auth::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_denied_auth)::text, true);
  execute 'set local role authenticated';
  if current_user <> 'authenticated' then
    raise exception 'fixture did not switch to the authenticated role';
  end if;
  begin
    perform * from api.crm_email_routing_stage_counts();
    v_refused := false;
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then raise exception 'caller without CRM access read stage counts'; end if;
  begin
    perform * from api.crm_email_routing_stage_page('all', 10, 0);
    v_refused := false;
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then raise exception 'caller without CRM access read a stage page'; end if;

  perform set_config('request.jwt.claim.sub', v_allowed_auth::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_allowed_auth)::text, true);
  select * into v_got from api.crm_email_routing_stage_counts();
  if (v_got.needs_company, v_got.needs_department, v_got.needs_program, v_got.routed, v_got.skipped, v_got.total)
     is distinct from (v_exp.needs_company, v_exp.needs_department, v_exp.needs_program, v_exp.routed, v_exp.skipped, v_exp.total) then
    raise exception 'stage counts % differ from owner baseline %', v_got, v_exp;
  end if;
  if v_got.needs_company + v_got.needs_department + v_got.needs_program + v_got.routed + v_got.skipped <> v_got.total then
    raise exception 'stage counts do not sum to total';
  end if;

  foreach v_stage in array array['needs_company', 'needs_department', 'needs_program', 'routed', 'skipped'] loop
    select count(*) into v_n from api.crm_email_routing_stage_page(v_stage, 1000, 0)
     where subject like v_tag || ' %';
    if v_n <> 1 then raise exception 'stage % page holds % fixture rows, expected 1', v_stage, v_n; end if;
    select count(*) into v_n from api.crm_email_routing_stage_page(v_stage, 1000, 0)
     where subject = v_tag || ' ' || v_stage;
    if v_n <> 1 then raise exception 'stage % page is missing its own fixture row', v_stage; end if;
  end loop;

  select count(*) into v_page_n from api.crm_email_routing_stage_page('all', 1000, 0);
  if v_page_n <> least(v_exp.total, 1000) then
    raise exception 'all page returned % rows, expected %', v_page_n, least(v_exp.total, 1000);
  end if;
  select count(*) into v_n from api.crm_email_routing_stage_page('all', 5000, 0);
  if v_n > 1000 then raise exception 'page limit is not capped at 1000'; end if;
  if (select company_name from api.crm_email_routing_stage_page('routed', 1000, 0)
       where subject = v_tag || ' routed') is distinct from v_tag then
    raise exception 'routed row is missing its company name';
  end if;
  begin
    perform * from api.crm_email_routing_stage_page('bogus', 10, 0);
    v_refused := false;
  exception when invalid_parameter_value then v_refused := true;
  end;
  if not v_refused then raise exception 'unknown stage was accepted'; end if;

  execute 'reset role';
end;
$$;

rollback;
