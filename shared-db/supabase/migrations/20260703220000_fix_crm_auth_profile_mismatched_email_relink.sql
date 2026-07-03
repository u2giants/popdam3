-- Relink CRM profiles whose existing auth_user_id points at a different email.
--
-- Some imported CRM profiles were linked to older auth.users rows from a
-- different identity provider/email. First Microsoft SSO for the CRM email then
-- tried to insert a second app.profile row and failed on app.profile.email.

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
  --
  -- Also repair stale or cross-provider auth links where the current auth user
  -- has a different email than the CRM profile being claimed.
  if v_email is not null then
    update app.profile p
       set auth_user_id = new.id,
           email = v_email,
           display_name = coalesce(v_display_name, p.display_name),
           provider = coalesce(v_provider, p.provider),
           status = 'active',
           updated_at = now()
      from auth.users linked_user
     where p.email = v_email
       and p.auth_user_id = linked_user.id
       and lower(linked_user.email) is distinct from lower(v_email::text)
     returning p.id into v_profile_id;

    if v_profile_id is null then
      update app.profile p
         set auth_user_id = new.id,
             email = v_email,
             display_name = coalesce(v_display_name, p.display_name),
             provider = coalesce(v_provider, p.provider),
             status = 'active',
             updated_at = now()
       where p.email = v_email
         and p.auth_user_id is null
       returning p.id into v_profile_id;
    end if;
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
  'Auto-provisions or relinks app.profile + CRM app_access on first Microsoft SSO login. Grants administrator role to the owner email.';
