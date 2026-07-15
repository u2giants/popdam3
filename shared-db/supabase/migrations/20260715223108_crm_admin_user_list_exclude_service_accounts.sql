-- Exclude service/test accounts from the CRM impersonation directory.
--
-- api.crm_admin_user_list() (added in 20260715184500) powers popcrm-web's admin
-- "impersonate / view as" picker. A handful of non-human accounts (e2e test
-- users, Codex verification bots, and the svc@ service account) were showing up
-- as impersonation targets. This filters them out at the source so the picker
-- only lists real people. Server-side is the right place: these accounts should
-- not be enumerable via the impersonation endpoint at all, and the live app
-- picks up the change with no frontend redeploy.
--
-- Additive/behavioral only: same function, same shape, fewer rows. The denylist
-- is pattern-based and documented; extend it here if new bot/test patterns
-- appear. (Rows with a null email also drop out — an account with no email
-- identity is not a usable impersonation target.)

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
      -- Only real people are impersonation targets: drop service/test accounts.
      and p.email is not null
      and p.email not ilike '%@example.com'   -- e2e test accounts
      and p.email not ilike 'svc@%'           -- service accounts (e.g. svc@popcre.com)
      and p.email not ilike 'codex%'          -- Codex verification / bot accounts
      and p.email not ilike '%e2e%'           -- e2e smoke-test accounts
  ) u;

  return result;
end;
$$;

revoke all on function api.crm_admin_user_list() from public;
grant execute on function api.crm_admin_user_list() to authenticated;

comment on function api.crm_admin_user_list() is
  'Admin-only CRM user directory (id, email, display_name, avatar_url, roles[], apps[], crm_access) for popcrm-web impersonation. Hard-gated to administrators; excludes service/test accounts (see 20260715223108).';
