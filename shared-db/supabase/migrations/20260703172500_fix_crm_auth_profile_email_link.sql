-- Link pre-seeded staff profiles by email during first Supabase Auth login.
--
-- Some app.profile rows were imported before the matching auth.users row exists.
-- The previous trigger tried to insert by auth_user_id only, so first SSO login
-- for those emails could violate app.profile.email's unique constraint and make
-- Supabase Auth return "Database error saving new user".

create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_profile_id uuid;
  v_admin_role_id uuid;
  v_crm_app app.app_name := 'crm';
  v_email extensions.citext := new.email::extensions.citext;
  v_display_name text := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email);
  v_provider text := new.raw_app_meta_data->>'provider';
begin
  -- Prefer linking an imported/profile-seeded row by email before inserting a
  -- new profile. This keeps historical CRM relationships attached to the user.
  if v_email is not null then
    update app.profile
       set auth_user_id = new.id,
           email = v_email,
           display_name = coalesce(v_display_name, app.profile.display_name),
           provider = coalesce(v_provider, app.profile.provider),
           status = 'active',
           updated_at = now()
     where email = v_email
       and auth_user_id is null
     returning id into v_profile_id;
  end if;

  if v_profile_id is null then
    insert into app.profile (auth_user_id, email, display_name, provider, status)
    values (new.id, v_email, v_display_name, v_provider, 'active')
    on conflict (auth_user_id) do update
      set email        = excluded.email,
          display_name = coalesce(excluded.display_name, app.profile.display_name),
          provider     = coalesce(excluded.provider, app.profile.provider),
          status       = 'active',
          updated_at   = now()
    returning id into v_profile_id;
  end if;

  -- Grant CRM access for everyone who logs in (single-app context; admins can revoke).
  insert into app.app_access (profile_id, app)
  values (v_profile_id, v_crm_app)
  on conflict (profile_id, app) do nothing;

  -- Grant administrator role to the owner email.
  if new.email ilike 'u2giants@gmail.com' then
    select id into v_admin_role_id from app.role where slug = 'administrator';
    if v_admin_role_id is not null then
      insert into app.user_role (profile_id, role_id)
      values (v_profile_id, v_admin_role_id)
      on conflict (profile_id, role_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

comment on function app.handle_new_auth_user() is
  'Auto-provisions or links app.profile + CRM app_access on first Microsoft SSO login. Grants administrator role to the owner email.';
