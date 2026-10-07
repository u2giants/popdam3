begin;

-- u2giants/popdam3#185: a new popcre.com-domain sign-in gets app_access 'dam'; an outside
-- email gets only 'crm'. Runs the real triggers on auth.users, rolled back. Provider azure
-- (company SSO, the real employee path) passes the invitation gate in public.handle_new_user().
do $$
declare
  v_emp uuid := gen_random_uuid();
  v_out uuid := gen_random_uuid();
  v_multi uuid := gen_random_uuid();
  v_fake_owner uuid := gen_random_uuid();
  v_upper uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_null uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_emp, 'zz-signup-test-' || v_emp || '@' || 'popcre.com', '{}', '{"provider":"azure"}'),
         (v_out, 'zz-signup-test-' || v_out || '@example.com', '{}', '{"provider":"azure"}'),
         (v_multi, 'zz-signup-test-' || v_multi || '@' || 'popcre.com' || '@' || 'example.com', '{}', '{"provider":"azure"}'),
         (v_fake_owner, 'u2giants' || '@' || 'gmail.com' || '@' || 'example.com', '{}', '{"provider":"azure"}'),
         (v_upper, 'ZZ-Signup-Test-' || v_upper || '@' || 'PopCre.COM', '{}', '{"provider":"azure"}'),
         (v_null, null, '{}', '{"provider":"azure"}');
  -- The real owner address: inserted (rolled back) when absent; when it already exists, the
  -- existing owner is checked instead, so this assertion never skips silently.
  if not exists (select 1 from auth.users where lower(email) = 'albert' || '@' || 'popcre.com') then
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values (v_owner, 'Albert' || '@' || 'PopCre.com', '{}', '{"provider":"azure"}');
  else
    select id into v_owner from auth.users where lower(email) = 'albert' || '@' || 'popcre.com' limit 1;
  end if;
  if not exists (select 1 from app.role where slug = 'administrator') then
    raise exception 'administrator role missing; owner grant cannot be verified';
  end if;
  if not exists (select 1 from app.user_role ur join app.profile p on p.id = ur.profile_id
                 join app.role r on r.id = ur.role_id
                 where p.auth_user_id = v_owner and r.slug = 'administrator') then
    raise exception 'owner address no longer receives administrator';
  end if;
  if not exists (select 1 from app.app_access a join app.profile p on p.id = a.profile_id
                 where p.auth_user_id = v_upper and a.app = 'dam') then
    raise exception 'mixed-case popcre.com address did not get dam access';
  end if;

  if not exists (select 1 from app.app_access a join app.profile p on p.id = a.profile_id
                 where p.auth_user_id = v_emp and a.app = 'dam') then
    raise exception 'new popcre.com user did not get dam access';
  end if;
  if exists (select 1 from app.app_access a join app.profile p on p.id = a.profile_id
             where p.auth_user_id = v_out and a.app = 'dam') then
    raise exception 'non-employee user was granted dam access';
  end if;
  if not exists (select 1 from app.app_access a join app.profile p on p.id = a.profile_id
                 where p.auth_user_id = v_out and a.app = 'crm') then
    raise exception 'crm grant regressed';
  end if;
  if exists (select 1 from app.app_access a join app.profile p on p.id = a.profile_id
             where p.auth_user_id = v_multi and a.app = 'dam') then
    raise exception 'multi-at address was granted dam access';
  end if;
  if exists (select 1 from app.user_role ur join app.profile p on p.id = ur.profile_id
             join app.role r on r.id = ur.role_id
             where p.auth_user_id = v_fake_owner and r.slug = 'administrator') then
    raise exception 'owner-prefixed multi-at address was granted administrator';
  end if;
  if exists (select 1 from app.app_access a join app.profile p on p.id = a.profile_id
             where p.auth_user_id = v_null and a.app = 'dam') then
    raise exception 'null-email user was granted dam access';
  end if;
end $$;

rollback;
