-- Contract tests for the CRM contact clear-field flags and customer counts.
-- Pins review findings popcre/shared-db#6819 and #6837 (PRs #6818/#6836,
-- popcrm-web #39 / #57):
--   1. p_clear_* precedence: a clear flag beats a same-call value — exercised
--      for ALL three fields, including the auto-attach hazard on a
--      relation-less contact with a domain-matching address.
--   2. Normalization parity with crm_create_contact on the update path:
--      email lowercased+trimmed, phone and title trimmed.
--   3. api.crm_customer_counts.contact_count mirrors api.crm_contact_list's
--      top-relation attribution (is_primary desc, id): moving the contact's
--      top relation between customers moves the count; a secondary relation
--      never double-counts.
-- All fixture changes are transaction-bound and rolled back.

begin;

do $$
declare
  v_runner_role text;
  v_profile uuid;
  v_auth uuid;
  v_sales_role uuid;
  v_customer_a uuid;
  v_customer_b uuid;
  v_contact uuid;
  v_hazard uuid;
  v_a_domain text;
  v_count_a_before bigint;
  v_count_b_before bigint;
  v_count_a_after bigint;
  v_count_b_after bigint;
begin
  -- Metadata: security definer + pinned search_path on the fixed shape.
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'api.crm_update_contact(uuid,text,text,text,text,text,text,uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean)'::regprocedure
      and p.prosecdef
      and 'search_path=app, core, crm, public' = any(coalesce(p.proconfig, array[]::text[]))
  ) then
    raise exception 'crm_update_contact metadata drift (security definer / search_path)';
  end if;

  -- Fixture profile with sales role + crm access.
  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
    and not exists (select 1 from app.user_role ur where ur.profile_id = p.id and ur.revoked_at is null)
  order by p.created_at, p.id limit 1;
  if v_profile is null then
    raise exception 'fixture requires one role-less active authenticated profile';
  end if;
  select id into v_sales_role from app.role where slug = 'sales';
  if v_sales_role is null then
    raise exception 'fixture requires the sales role';
  end if;
  delete from app.app_access where profile_id = v_profile and app = 'crm';
  delete from app.user_role where profile_id = v_profile;
  insert into app.user_role (profile_id, role_id) values (v_profile, v_sales_role);
  insert into app.app_access (profile_id, app) values (v_profile, 'crm');

  -- Self-sufficient fixture customers (the ephemeral CI database carries no
  -- domain-bearing customers, so ambient rows cannot be relied on).
  v_a_domain := 'clear6819a.test';
  insert into core.customer (name, company_type, status, domain, customer_status)
  values ('6819 Clear Fixture A', 'customer', 'active', v_a_domain, 'active')
  returning id into v_customer_a;
  insert into core.customer (name, company_type, status, customer_status)
  values ('6819 Clear Fixture B', 'customer', 'active', 'active')
  returning id into v_customer_b;
  if v_customer_a is null or v_customer_b is null then
    raise exception 'fixture customers were not created';
  end if;

  select current_user into v_runner_role;  -- harness role for fixture surgery
  perform set_config('request.jwt.claim.sub', v_auth::text, true);
  perform set_config('role', 'authenticated', true);


  -- ------------------------------------------------------------------
  -- 1 + 2: normalization, then clear precedence for all three fields.
  v_contact := api.crm_create_contact(
    p_full_name => '6819 Clear Contract',
    p_email => '6819Clear' || chr(64) || 'Contract.Test',
    p_company_id => v_customer_a);

  -- Normalization: padded values round-trip trimmed, email lowercased+trimmed.
  perform api.crm_update_contact(
    p_contact_id => v_contact,
    p_email => '  Issue5791Update' || chr(64) || 'Example.Test  ',
    p_phone => ' 555-0100 ',
    p_job_title => ' Buyer ');
  if not exists (select 1 from core.contact
                 where id = v_contact
                   and email = 'issue5791update' || chr(64) || 'example.test'
                   and phone = '555-0100'
                   and title = 'Buyer') then
    raise exception 'crm_update_contact stored un-normalized email/phone/title';
  end if;

  -- Precedence: each clear flag beats the same-call value.
  perform api.crm_update_contact(
    p_contact_id => v_contact,
    p_phone => '999-9999',
    p_job_title => ' Chief ',
    p_email => 'Kept' || chr(64) || 'ShouldNot.Be',
    p_clear_phone => true,
    p_clear_job_title => true,
    p_clear_email => true);
  if exists (select 1 from core.contact
             where id = v_contact
               and (phone is not null or title is not null or email is not null)) then
    raise exception 'a p_clear_* flag did not beat its same-call value';
  end if;
  if exists (select 1 from core.contact_company
             where contact_id = v_contact and company_id <> v_customer_a) then
    raise exception 'a relation appeared from a value passed alongside a clear';
  end if;

  -- ------------------------------------------------------------------
  -- Auto-attach hazard (6819 finding 1): a relation-less contact whose email
  -- domain matches customer A; clearing the email together with a new
  -- domain-matching value must NOT materialize an auto-attach relation.
  v_hazard := api.crm_create_contact(
    p_full_name => '6819 Hazard Contract',
    p_email => 'hazard6819' || chr(64) || v_a_domain);
  -- Relation surgery runs as the harness role: the authenticated test role
  -- must not (and cannot) delete relation rows directly.
  perform set_config('role', v_runner_role, true);
  delete from core.contact_company where contact_id = v_hazard;
  perform set_config('role', 'authenticated', true);
  perform api.crm_update_contact(
    p_contact_id => v_hazard,
    p_email => 'stillmatches' || chr(64) || v_a_domain,
    p_clear_email => true);
  if exists (select 1 from core.contact where id = v_hazard and email is not null) then
    raise exception 'p_clear_email did not win on the relation-less contact';
  end if;
  if exists (select 1 from core.contact_company where contact_id = v_hazard) then
    raise exception 'auto-attach materialized a relation from the value passed alongside p_clear_email';
  end if;

  -- ------------------------------------------------------------------
  -- 3: counts mirror the view's top-relation attribution.
  select contact_count into v_count_a_before
    from api.crm_customer_counts() where customer_id = v_customer_a;
  select contact_count into v_count_b_before
    from api.crm_customer_counts() where customer_id = v_customer_b;
  if v_count_a_before is null or v_count_b_before is null then
    raise exception 'counts rows missing for fixture customers';
  end if;

  -- The view's attribution tiebreak is the random uuid id, so a fixture with
  -- two unflagged rows is not deterministic. Real data marks the primary row:
  -- pin A as primary (as the CRM UI does), then add B as a secondary.
  perform set_config('role', v_runner_role, true);
  update core.contact_company set is_primary = true
   where contact_id = v_contact and company_id = v_customer_a;
  insert into core.contact_company (contact_id, company_id, relationship_type, is_primary)
  values (v_contact, v_customer_b, 'buyer', false);
  perform set_config('role', 'authenticated', true);
  select contact_count into v_count_a_after
    from api.crm_customer_counts() where customer_id = v_customer_a;
  select contact_count into v_count_b_after
    from api.crm_customer_counts() where customer_id = v_customer_b;
  if v_count_b_after <> v_count_b_before then
    raise exception 'secondary relation changed the non-top customer''s count (% -> %)',
      v_count_b_before, v_count_b_after;
  end if;

  -- Moving the primary flag to B must move the count: B gains one, A loses one.
  perform set_config('role', v_runner_role, true);
  update core.contact_company set is_primary = (company_id = v_customer_b)
   where contact_id = v_contact;
  perform set_config('role', 'authenticated', true);
  select contact_count into v_count_a_after
    from api.crm_customer_counts() where customer_id = v_customer_a;
  select contact_count into v_count_b_after
    from api.crm_customer_counts() where customer_id = v_customer_b;
  if v_count_a_after <> v_count_a_before - 1 then
    raise exception 'losing the top relation did not decrement A''s count (% -> %, expected %)',
      v_count_a_before, v_count_a_after, v_count_a_before - 1;
  end if;
  if v_count_b_after <> v_count_b_before + 1 then
    raise exception 'gaining the top relation did not increment B''s count (% -> %, expected %)',
      v_count_b_before, v_count_b_after, v_count_b_before + 1;
  end if;
end;
$$;

rollback;
