-- Contract tests for issue #2662 batch 1 / migration 20260911124746.
-- A caller without CRM access reads zero rows from every CRM list view; a CRM
-- caller reads exactly the rows the service owner reads; public.sg_archive_usage
-- returns the owner's rows to every authenticated caller. Callers run under the
-- real authenticated role (not a bypass executor). Fixtures roll back.

begin;

do $$
declare
  v_allowed_profile uuid;
  v_allowed_auth uuid;
  v_denied_profile uuid;
  v_denied_auth uuid;
  v_admin_role uuid;
  v_owner_customers bigint;
  v_owner_domains bigint;
  v_owner_archive bigint;
  v_owner_segments bigint;
  v_count bigint;
  v_obj regclass;
begin
  foreach v_obj in array array[
    'api.crm_ingested_domain_list'::regclass, 'api.crm_contact_segment_list'::regclass,
    'api.crm_contact_segment_counts'::regclass, 'public.sg_archive_usage'::regclass]
  loop
    if not exists (select 1 from pg_class where oid = v_obj
                   and 'security_invoker=true' = any(coalesce(reloptions, '{}'))) then
      raise exception '% must be security_invoker', v_obj;
    end if;
  end loop;
  foreach v_obj in array array['api.crm_customer_list'::regclass, 'api.crm_account_list'::regclass]
  loop
    if exists (select 1 from pg_class where oid = v_obj
               and 'security_invoker=true' = any(coalesce(reloptions, '{}'))) then
      raise exception '% must keep definer semantics', v_obj;
    end if;
  end loop;

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
  where profile_id in (v_allowed_profile, v_denied_profile) and role_id = v_admin_role;
  delete from app.app_access
  where profile_id in (v_allowed_profile, v_denied_profile) and app = 'crm';
  -- The allowed caller holds CRM access and no role at all: base-table role RLS
  -- on core.customer would admit nobody, so a green result proves the gate path.
  delete from app.user_role where profile_id = v_allowed_profile;
  insert into app.app_access (profile_id, app) values (v_allowed_profile, 'crm');
  insert into core.customer (name) values ('ZZTEST-2662 customer');
  insert into crm.ingested_domain (domain, status)
  values (('issue-2662-' || gen_random_uuid() || '.invalid')::extensions.citext, 'new');
  -- Contact and style-guide fixtures make the segment and archive comparisons
  -- non-vacuous: both sides must be non-zero, not merely equal.
  insert into core.contact (full_name) values ('ZZTEST-2662 contact');
  insert into public.style_guide_files
    (root_label, relative_path, directory_path, filename, basename_no_ext, normalized_name)
  values ('ZZTEST-2662', 'zztest-2662/' || gen_random_uuid() || '.pdf', 'zztest-2662',
          'zztest-2662.pdf', 'zztest-2662', 'zztest 2662');

  -- Owner baselines, read before any role switch (RLS bypassed). The gated views
  -- return nothing to a session with no JWT, so their baseline is the base table.
  select count(*) into v_owner_customers from core.customer;
  select count(*) into v_owner_domains from crm.ingested_domain;
  select count(*) into v_owner_archive from public.sg_archive_usage;
  if v_owner_archive = 0 then
    raise exception 'fixture style guide file produced no archive rows';
  end if;

  perform set_config('request.jwt.claim.sub', v_denied_auth::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_denied_auth)::text, true);
  execute 'set local role authenticated';
  if current_user <> 'authenticated' then
    raise exception 'fixture did not switch to the authenticated role (current_user=%)', current_user;
  end if;
  if (select count(*) from api.crm_customer_list) <> 0
     or (select count(*) from api.crm_account_list) <> 0
     or (select count(*) from api.crm_ingested_domain_list) <> 0
     or (select count(*) from api.crm_contact_segment_list) <> 0
     or coalesce((select contact_count from api.crm_contact_segment_counts where crm_segment = 'all'), 0) <> 0 then
    raise exception 'caller without CRM access read CRM rows';
  end if;
  select count(*) into v_count from public.sg_archive_usage;
  if v_count <> v_owner_archive then
    raise exception 'non-CRM caller archive rows % differ from owner rows %', v_count, v_owner_archive;
  end if;

  perform set_config('request.jwt.claim.sub', v_allowed_auth::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_allowed_auth)::text, true);
  select count(*) into v_count from api.crm_customer_list;
  if v_count <> v_owner_customers or v_count = 0 then
    raise exception 'CRM caller customer rows % differ from owner rows %', v_count, v_owner_customers;
  end if;
  if (select count(*) from api.crm_account_list) <> v_owner_customers then
    raise exception 'CRM caller account rows differ from owner rows';
  end if;
  select count(*) into v_count from api.crm_ingested_domain_list;
  if v_count <> v_owner_domains or v_count = 0 then
    raise exception 'CRM caller domain rows % differ from owner rows %', v_count, v_owner_domains;
  end if;
  select count(*) into v_count from api.crm_contact_list;
  select count(*) into v_owner_segments from api.crm_contact_segment_list;
  if v_count = 0 or v_owner_segments <> v_count
     or coalesce((select contact_count from api.crm_contact_segment_counts where crm_segment = 'all'), 0) <> v_count then
    raise exception 'CRM caller segment rows differ from contact list rows';
  end if;
  select count(*) into v_count from public.sg_archive_usage;
  if v_count <> v_owner_archive then
    raise exception 'CRM caller archive rows % differ from owner rows %', v_count, v_owner_archive;
  end if;
  execute 'reset role';
end;
$$;

rollback;
