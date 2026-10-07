-- Grant PopDAM ("dam") app access to every active POP Creations employee profile.
-- Issue: https://github.com/u2giants/popdam3/issues/185
-- Owner (Albert, verbatim): "every employee of POP creations should have popdam access?"
-- Target: live project qsllyeztdwjgirsysgai (proved by the caller before running).
-- Scope: active app.profile rows whose auth email ends in @popcre.com, excluding the
-- two automated test accounts, that have no dam row. Expected: exactly 25.
-- Never touches an existing row: a revoked dam row is a deliberate decision and is left alone.
begin;
do $$
declare n int;
begin
  if not exists (select 1 from auth.users u join app.profile p on p.auth_user_id = u.id
       where p.id = '0301af81-7aa9-4655-8746-61bccd93a78e' and u.email = 'albert@popcre.com' and p.status = 'active') then
    raise exception 'granter profile mismatch';
  end if;
  insert into app.app_access (profile_id, app, granted_by_profile_id)
  select p.id, 'dam', '0301af81-7aa9-4655-8746-61bccd93a78e'
  from app.profile p join auth.users u on u.id = p.auth_user_id
  where p.status = 'active'
    and lower(u.email) like '%@popcre.com'
    and lower(u.email) not in ('ai-tester@popcre.com', 'poppim-production-ai-test@popcre.com')
    and not exists (select 1 from app.app_access aa where aa.profile_id = p.id and aa.app = 'dam')
  on conflict (profile_id, app) do nothing;
  get diagnostics n = row_count;
  if n is distinct from 25 then raise exception 'expected 25 rows, got %', n; end if;
end $$;
commit;
