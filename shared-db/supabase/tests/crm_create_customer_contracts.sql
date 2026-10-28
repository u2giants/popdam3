-- Contract test for migration 20261028191645 (#4982): api.crm_create_customer.
-- All fixture changes are transaction-bound and rolled back.
begin;

do $$
declare
  v_tag text := replace(gen_random_uuid()::text, '-', '');
  v_root text;
  v_allowed_profile uuid; v_allowed_auth uuid;
  v_denied_profile uuid;  v_denied_auth uuid;
  v_definer boolean; v_config text[]; v_arg_names text[]; v_defaults int;
  v_row core.customer;
  v_contact uuid; v_dom uuid;
  v_n int;
begin
  v_root := 'zz' || v_tag || '.test';

  if to_regprocedure('api.crm_create_customer(text,text,text,text,text,text)') is null then
    raise exception 'missing api.crm_create_customer(text,text,text,text,text,text)';
  end if;
  select p.prosecdef, p.proconfig, p.proargnames, p.pronargdefaults
    into v_definer, v_config, v_arg_names, v_defaults
  from pg_proc p where p.oid = 'api.crm_create_customer(text,text,text,text,text,text)'::regprocedure;
  if not v_definer or not ('search_path=app, core, crm, public' = any(coalesce(v_config, array[]::text[]))) then
    raise exception 'RPC must be SECURITY DEFINER with pinned search_path';
  end if;
  if v_arg_names <> array['p_name','p_domain','p_customer_status','p_display_name','p_chain_type','p_routing_aliases']::text[]
     or v_defaults <> 4 then
    raise exception 'RPC argument names/defaults changed: %, %', v_arg_names, v_defaults;
  end if;
  if has_function_privilege('anon', 'api.crm_create_customer(text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'api.crm_create_customer(text,text,text,text,text,text)', 'execute') then
    raise exception 'RPC grants must be anon=denied/authenticated=allowed';
  end if;
  if has_table_privilege('authenticated', 'core.customer', 'insert') then
    raise exception 'authenticated gained a direct core.customer insert grant';
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
  delete from app.app_access where profile_id in (v_allowed_profile, v_denied_profile) and app = 'crm';
  delete from app.user_role where profile_id in (v_allowed_profile, v_denied_profile);
  insert into app.app_access (profile_id, app) values (v_allowed_profile, 'crm');

  -- Fixtures waiting for the new customer: an unattached contact and an ingested domain.
  insert into core.contact (email) values ('buyer@' || v_root) returning id into v_contact;
  insert into crm.ingested_domain (domain) values (v_root) returning id into v_dom;

  -- No CRM access: refused.
  perform set_config('request.jwt.claim.sub', v_denied_auth::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform api.crm_create_customer('ZZ denied ' || v_tag, v_root);
    raise exception 'caller without CRM access created a customer';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', v_allowed_auth::text, true);

  -- Blank name, bad status, bad chain type: refused.
  begin
    perform api.crm_create_customer('   ', v_root);
    raise exception 'blank name accepted';
  exception when check_violation then null;
  end;
  begin
    perform api.crm_create_customer('ZZ ' || v_tag, v_root, 'OTHER');
    raise exception 'OTHER status accepted';
  exception when check_violation then null;
  end;
  begin
    perform api.crm_create_customer('ZZ ' || v_tag, v_root, 'POTENTIAL_CUSTOMER', null, 'NOPE');
    raise exception 'unknown chain type accepted';
  exception when check_violation then null;
  end;

  -- Happy path: domain normalized, defaults to potential.
  select * into v_row from api.crm_create_customer('  ZZ Create ' || v_tag || ' ', '  ' || upper(v_root) || ' ',
    p_display_name => 'ZZ label', p_chain_type => 'specialty');
  if v_row.name <> 'ZZ Create ' || v_tag or v_row.domain <> v_root
     or v_row.customer_status <> 'POTENTIAL_CUSTOMER' or v_row.status <> 'potential'::app.entity_status
     or not v_row.is_potential or v_row.chain_type <> 'SPECIALTY' or v_row.display_name <> 'ZZ label' then
    raise exception 'created row has unexpected values: %', row_to_json(v_row);
  end if;

  -- Duplicate domain (any case/URL form): refused.
  begin
    perform api.crm_create_customer('ZZ dup ' || v_tag, 'https://www.' || v_root || '/');
    raise exception 'duplicate domain accepted';
  exception when unique_violation then null;
  end;

  execute 'reset role';

  -- Existing triggers linked the ingested domain and attached the contact.
  if (select customer_id from crm.ingested_domain where id = v_dom) is distinct from v_row.id then
    raise exception 'ingested domain was not linked to the new customer';
  end if;
  select count(*) into v_n from core.contact_company where contact_id = v_contact and company_id = v_row.id;
  if v_n <> 1 then raise exception 'contact on the domain was not attached (%)', v_n; end if;

  -- Visible in the CRM picker to the CRM user.
  perform set_config('role', 'authenticated', true);
  if not exists (select 1 from api.crm_customer_picker_list where id = v_row.id) then
    raise exception 'new customer is not visible in api.crm_customer_picker_list';
  end if;
  execute 'reset role';

  -- ACTIVE_CUSTOMER maps to active.
  perform set_config('role', 'authenticated', true);
  select * into v_row from api.crm_create_customer('ZZ Active ' || v_tag, 'a' || v_root, 'ACTIVE_CUSTOMER');
  if v_row.status <> 'active'::app.entity_status or v_row.is_potential or v_row.customer_status <> 'ACTIVE_CUSTOMER' then
    raise exception 'ACTIVE_CUSTOMER mapping wrong: %', row_to_json(v_row);
  end if;
  execute 'reset role';
end
$$;

rollback;
