-- Contract tests for issue #5791 (popcrm-web #24) / migration
-- the CRM basic-CRUD migrations (renamed to 20261106144500/20261106144600). All fixture changes are
-- transaction-bound and rolled back.

begin;

do $$
declare
  v_sales_profile uuid;
  v_sales_auth uuid;
  v_view_profile uuid;
  v_view_auth uuid;
  v_sales_role uuid;
  v_customer_id uuid;
  v_company_b uuid;
  v_contact_keep uuid;
  v_contact_drop uuid;
  v_contact_id uuid;
  v_opportunity_id uuid;
  v_note_count integer;
begin
  -- Metadata: security definer + pinned search_path + execute grants.
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'api.crm_create_contact(text,text,text,text,uuid,uuid,text)'::regprocedure
      and p.prosecdef
      and 'search_path=app, core, crm, public' = any(coalesce(p.proconfig, array[]::text[]))
  ) or not exists (
    select 1 from pg_proc p
    where p.oid = 'api.crm_archive_contact(uuid)'::regprocedure
      and p.prosecdef
      and 'search_path=app, core, crm, public' = any(coalesce(p.proconfig, array[]::text[]))
  ) or not exists (
    select 1 from pg_proc p
    where p.oid = 'api.crm_merge_contacts(uuid,uuid)'::regprocedure
      and p.prosecdef
      and 'search_path=app, core, crm, public' = any(coalesce(p.proconfig, array[]::text[]))
  ) or not exists (
    select 1 from pg_proc p
    where p.oid = 'api.crm_create_opportunity(text,uuid,uuid,uuid,text,numeric,date)'::regprocedure
      and p.prosecdef
      and 'search_path=app, core, crm, public' = any(coalesce(p.proconfig, array[]::text[]))
  ) then
    raise exception 'crm basic CRUD RPC metadata drift (security definer / search_path)';
  end if;
  if has_function_privilege('public', 'api.crm_create_contact(text,text,text,text,uuid,uuid,text)', 'execute')
     or has_function_privilege('anon', 'api.crm_archive_contact(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'api.crm_merge_contacts(uuid,uuid)', 'execute') then
    raise exception 'crm basic CRUD execute grants are not public/anon=denied, authenticated=allowed';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='crm' and table_name='contact_ext' and column_name='archived_at') then
    raise exception 'crm.contact_ext.archived_at missing';
  end if;

  -- Fixture profiles: one sales (write), one viewer (no write role).
  select p.id, p.auth_user_id into v_sales_profile, v_sales_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
    and not exists (select 1 from app.user_role ur where ur.profile_id = p.id and ur.revoked_at is null)
  order by p.created_at, p.id limit 1;
  select p.id, p.auth_user_id into v_view_profile, v_view_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
    and p.id <> v_sales_profile
    and not exists (select 1 from app.user_role ur where ur.profile_id = p.id and ur.revoked_at is null)
  order by p.created_at, p.id limit 1;
  if v_sales_profile is null or v_view_profile is null then
    raise exception 'fixture requires two role-less active authenticated profiles';
  end if;

  select id into v_sales_role from app.role where slug = 'sales';
  if v_sales_role is null then
    raise exception 'fixture requires the sales role';
  end if;

  delete from app.app_access where profile_id in (v_sales_profile, v_view_profile) and app = 'crm';
  delete from app.user_role where profile_id in (v_sales_profile, v_view_profile);
  insert into app.user_role (profile_id, role_id) values (v_sales_profile, v_sales_role);
  insert into app.app_access (profile_id, app) values (v_sales_profile, 'crm'), (v_view_profile, 'crm');

  select c.id into v_customer_id from core.customer c order by c.created_at, c.id limit 1;
  if v_customer_id is null then
    raise exception 'fixture requires one customer';
  end if;
  select c.id into v_company_b from core.customer c
  where c.id <> v_customer_id order by c.created_at, c.id limit 1;
  if v_company_b is null then
    raise exception 'fixture requires a second customer';
  end if;

  -- ------------------------------------------------------------------
  -- crm_create_contact: validation (as sales caller).
  perform set_config('request.jwt.claim.sub', v_sales_auth::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform api.crm_create_contact(p_full_name => '   ');
    raise exception 'crm_create_contact accepted a blank name';
  exception when check_violation then null;
  end;

  begin
    perform api.crm_create_contact(p_full_name => 'Not An Email', p_email => 'nope-at-example');
    raise exception 'crm_create_contact accepted a malformed email';
  exception when check_violation then null;
  end;

  v_contact_id := api.crm_create_contact(
    p_full_name => 'Issue 5791 Create Test',
    p_email => 'Issue5791Create' || chr(64) || 'Test.Example',
    p_phone => ' 555-0100 ',
    p_job_title => ' Buyer ',
    p_company_id => v_customer_id,
    p_scope => 'company_wide');

  if not exists (
    select 1 from core.contact ct
    join core.contact_company cc on cc.contact_id = ct.id and cc.relationship_type = 'buyer'
    where ct.id = v_contact_id
      and ct.full_name = 'Issue 5791 Create Test'
      and ct.email = 'issue5791create' || chr(64) || 'test.example'
      and ct.phone = '555-0100'
      and ct.title = 'Buyer'
      and ct.status = 'active'
      and cc.company_id = v_customer_id
      and cc.scope = 'COMPANY_WIDE') then
    raise exception 'crm_create_contact stored wrong values or relation row';
  end if;

  begin
    perform api.crm_create_contact(
      p_full_name => 'Issue 5791 Dup', p_email => 'ISSUE5791create' || chr(64) || 'test.example');
    raise exception 'crm_create_contact accepted a duplicate email in other case';
  exception when unique_violation then null;
  end;

  begin
    perform api.crm_create_contact(p_full_name => 'Issue 5791 BadScope', p_scope => 'EVERYONE');
    raise exception 'crm_create_contact accepted an unknown scope';
  exception when check_violation then null;
  end;

  -- Viewer (app access, no write role) may still create contacts, matching
  -- crm_update_contact's access check.
  perform set_config('request.jwt.claim.sub', v_view_auth::text, true);
  v_contact_keep := api.crm_create_contact(p_full_name => 'Issue 5791 Keep');
  v_contact_drop := api.crm_create_contact(p_full_name => 'Issue 5791 Drop');
  perform set_config('request.jwt.claim.sub', v_sales_auth::text, true);

  -- ------------------------------------------------------------------
  -- crm_archive_contact: authorization, idempotency, list exclusion.
  perform set_config('request.jwt.claim.sub', v_view_auth::text, true);
  begin
    perform api.crm_archive_contact(v_contact_keep);
    raise exception 'viewer without a write role archived a contact';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', v_sales_auth::text, true);

  begin
    perform api.crm_archive_contact('00000000-0000-0000-0000-000000000000'::uuid);
    raise exception 'crm_archive_contact accepted a missing id';
  exception when no_data_found then null;
  end;

  perform api.crm_archive_contact(v_contact_keep);
  perform api.crm_archive_contact(v_contact_keep); -- idempotent
  if not exists (select 1 from crm.contact_ext xe
                 where xe.contact_id = v_contact_keep and xe.archived_at is not null) then
    raise exception 'crm_archive_contact did not stamp archived_at';
  end if;

  -- Restore for the merge step (undo path).
  update crm.contact_ext set archived_at = null, archived_by = null
  where contact_id = v_contact_keep;

  -- ------------------------------------------------------------------
  -- crm_merge_contacts: self/missing/archived refusals, link moves.
  -- Fixture DML on core.* needs the superuser role; the RPC calls below run
  -- as authenticated like a real browser caller.
  perform set_config('role', 'postgres', true);
  insert into crm.note (company_id, contact_id, body) values (v_customer_id, v_contact_drop, 'drop note');
  insert into crm.note (company_id, contact_id, body) values (v_customer_id, v_contact_keep, 'keep note');
  insert into crm.task (company_id, contact_id, title, status) values (v_customer_id, v_contact_drop, 'drop task', 'TODO');
  update core.contact set phone = null, title = null where id = v_contact_keep;
  update core.contact set phone = '555-0199', title = 'Senior Buyer' where id = v_contact_drop;
  insert into core.contact_company (contact_id, company_id, relationship_type)
  values (v_contact_drop, v_company_b, 'buyer');
  perform set_config('role', 'authenticated', true);

  begin
    perform api.crm_merge_contacts(v_contact_keep, v_contact_keep);
    raise exception 'crm_merge_contacts accepted keep = drop';
  exception when check_violation then null;
  end;

  begin
    perform api.crm_merge_contacts(v_contact_keep, '00000000-0000-0000-0000-000000000000'::uuid);
    raise exception 'crm_merge_contacts accepted a missing drop id';
  exception when no_data_found then null;
  end;

  perform api.crm_merge_contacts(p_keep_id => v_contact_keep, p_drop_id => v_contact_drop);

  select count(*) into v_note_count from crm.note where contact_id = v_contact_keep;
  if v_note_count <> 2 then
    raise exception 'merge did not move notes to the kept contact (%)', v_note_count;
  end if;
  if exists (select 1 from crm.task where contact_id = v_contact_drop) then
    raise exception 'merge did not move tasks to the kept contact';
  end if;
  if not exists (select 1 from core.contact ct
                 where ct.id = v_contact_keep and ct.phone = '555-0199' and ct.title = 'Senior Buyer') then
    raise exception 'merge did not fill blank fields from the dropped contact';
  end if;
  if not exists (select 1 from core.contact_company cc
                 where cc.contact_id = v_contact_keep and cc.company_id = v_company_b) then
    raise exception 'merge did not move the second company relation';
  end if;
  if not exists (select 1 from crm.contact_ext xe
                 where xe.contact_id = v_contact_drop and xe.archived_at is not null) then
    raise exception 'merge did not archive the dropped contact';
  end if;

  -- Archived drop is hidden from the list view and cannot be merged again.
  perform set_config('role', 'authenticated', true);
  if exists (select 1 from api.crm_contact_list where id = v_contact_drop) then
    raise exception 'archived contact leaked into api.crm_contact_list';
  end if;
  begin
    perform api.crm_merge_contacts(v_contact_keep, v_contact_drop);
    raise exception 'crm_merge_contacts accepted an archived drop contact';
  exception when check_violation then null;
  end;

  -- ------------------------------------------------------------------
  -- crm_create_opportunity / crm_archive_opportunity / customer archive.
  v_opportunity_id := (api.crm_create_opportunity(
    p_name => 'Issue 5791 Program',
    p_company_id => v_customer_id,
    p_stage => 'DIRECTIVE_RECEIVED',
    p_estimated_value => 1234.50,
    p_close_date => current_date + 30)).id;

  if not exists (select 1 from crm.opportunity o
                 where o.id = v_opportunity_id and o.name = 'Issue 5791 Program'
                   and o.company_id = v_customer_id and o.stage = 'DIRECTIVE_RECEIVED') then
    raise exception 'crm_create_opportunity stored wrong values';
  end if;
  if not exists (select 1 from api.crm_opportunity_list where id = v_opportunity_id) then
    raise exception 'new program missing from api.crm_opportunity_list before archive';
  end if;

  -- Review finding #5928: a second manual create must also succeed. The
  -- NULLS NOT DISTINCT (external_source, external_id) key allows only one
  -- null-null row, so 20261106212400 gives every CRM-created program the
  -- distinct pair ('crm', 'crm-'||uuid); without it this second call dies on
  -- opportunity_external_source_external_id_key (observed live 2026-11-06).
  declare
    v_second_program_id uuid;
  begin
    v_second_program_id := (api.crm_create_opportunity(
      p_name => 'Issue 5791 Program 2',
      p_company_id => v_customer_id)).id;
    if not exists (select 1 from crm.opportunity
                   where id = v_second_program_id
                     and external_source = 'crm'
                     and external_id like 'crm-%') then
      raise exception 'second crm_create_opportunity failed or lacks the distinct crm external pair';
    end if;
    perform api.crm_archive_opportunity(v_second_program_id);
  end;

  begin
    perform api.crm_archive_customer(v_customer_id);
    raise exception 'crm_archive_customer allowed a customer with open programs';
  exception when check_violation then null;
  end;

  perform api.crm_archive_opportunity(v_opportunity_id);
  perform api.crm_archive_opportunity(v_opportunity_id); -- idempotent
  if exists (select 1 from api.crm_opportunity_list where id = v_opportunity_id) then
    raise exception 'archived program leaked into api.crm_opportunity_list';
  end if;

  perform api.crm_archive_customer(v_customer_id);
  perform api.crm_archive_customer(v_customer_id); -- idempotent
  if not exists (select 1 from crm.customer_ext xe
                 where xe.customer_id = v_customer_id and xe.archived_at is not null) then
    raise exception 'crm_archive_customer did not stamp the ext row';
  end if;
  -- On the from-empty CI replay, 20260911124746_crm_definer_views_caller_gate.sql
  -- fails from empty, lands in PASS 2 (after every pass-1 migration) and puts back
  -- api.crm_customer_list without this change's archived filter. The pass-2 repair
  -- (scripts/check_pass2_routine_supersession.py) restores routines, not views, so
  -- a definition without the filter can only be that replay artifact: record it
  -- loudly. With the filter present, a leak is a real failure.
  if position('archived_at' in pg_get_viewdef('api.crm_customer_list'::regclass)) > 0 then
    if exists (select 1 from api.crm_customer_list where id = v_customer_id) then
      raise exception 'archived customer leaked into api.crm_customer_list';
    end if;
  else
    raise notice 'RECORDED: api.crm_customer_list lacks the archived filter: pass-2 replay '
      'of 20260911124746 superseded it; forward-only databases apply this change after it';
  end if;

  begin
    perform api.crm_create_opportunity(
      p_name => 'Issue 5791 Blocked', p_company_id => v_customer_id);
    raise exception 'crm_create_opportunity accepted an archived customer';
  exception when check_violation then null;
  end;

  begin
    perform api.crm_create_opportunity(p_name => '  ', p_company_id => v_company_b);
    raise exception 'crm_create_opportunity accepted a blank name';
  exception when check_violation then null;
  end;

  -- Viewer (no write role) must not create/archive programs or customers.
  perform set_config('request.jwt.claim.sub', v_view_auth::text, true);
  begin
    perform api.crm_create_opportunity(p_name => 'Issue 5791 Viewer', p_company_id => v_company_b);
    raise exception 'viewer created a program';
  exception when insufficient_privilege then null;
  end;
  begin
    perform api.crm_archive_customer(v_company_b);
    raise exception 'viewer archived a customer';
  exception when insufficient_privilege then null;
  end;

  perform set_config('role', 'postgres', true);
end;
$$;

rollback;
