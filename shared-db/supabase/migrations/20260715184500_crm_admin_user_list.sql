-- CRM admin user directory + owner admin grant for popcrm-web impersonation.
--
-- popcrm-web adds an admin-only "impersonate another user" ("view as") feature.
-- The browser cannot read the `app` schema directly, so listing every user with
-- their role types must go through an `api` security-definer function that is
-- hard-gated to administrators.
--
-- Also extends the first-login auto-provision trigger so the second owner email
-- (albert@popcre.com) is granted the administrator role like u2giants@gmail.com,
-- and backfills that grant for the already-provisioned profile if present.
--
-- Additive only: one new function + one function replacement + idempotent
-- backfill. Nothing is renamed or dropped.

-- 1. Admin-only user directory: id, identity, role slugs, app grants, crm access.
--    Hard-checks app.has_role('administrator'); never trust the client.
create or replace function api.crm_admin_user_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
  result jsonb;
begin
  if not app.has_role('administrator') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(u order by lower(u.display_name), u.email), '[]'::jsonb)
  into result
  from (
    select
      p.id,
      p.email::text            as email,
      p.display_name,
      p.avatar_url,
      p.status::text           as status,
      coalesce((
        select array_agg(r.slug::text order by r.slug)
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
      )                        as crm_access
    from app.profile p
    where p.status = 'active'
  ) u;

  return result;
end;
$$;

revoke all on function api.crm_admin_user_list() from public;
grant execute on function api.crm_admin_user_list() to authenticated;

comment on function api.crm_admin_user_list() is
  'Admin-only CRM user directory (id, email, display_name, avatar_url, roles[], apps[], crm_access). Hard-gated to administrators; powers popcrm-web impersonation.';

-- 2. Grant administrator on first SSO login to both owner emails.
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

  -- Grant administrator role to the owner email(s)
  if new.email ilike 'u2giants@gmail.com' or new.email ilike 'albert@popcre.com' then
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
  'Auto-provisions app.profile + CRM app_access on first Microsoft SSO login. Grants administrator role to the owner emails (u2giants@gmail.com, albert@popcre.com).';

-- 3. Backfill: grant administrator to albert@popcre.com if the profile already exists.
insert into app.user_role (profile_id, role_id)
select p.id, r.id
from app.profile p
cross join app.role r
where p.email = 'albert@popcre.com'::extensions.citext
  and r.slug = 'administrator'
on conflict (profile_id, role_id) do nothing;
