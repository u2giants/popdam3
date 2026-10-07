-- Grant PopDAM ("dam") app access to adweck@popcre.com (Microsoft sign-in).
-- Issue: https://github.com/u2giants/popdam3/issues/185
-- Target: live project qsllyeztdwjgirsysgai. Exactly one row; aborts otherwise.
-- Why: his searches fail with "DAM access is required" (403) and show "No assets found".
begin;
do $$
declare n int;
begin
  if not exists (
       select 1 from auth.users u
       join app.profile p on p.auth_user_id = u.id
       where u.id = 'fde045bf-c899-4b75-b579-e4fef0308380'
         and u.email is not distinct from 'adweck@popcre.com'
         and p.id = 'c6c3b9e1-7235-4ed1-8c2c-cc230a884736'
         and p.status = 'active') then
    raise exception 'target profile mismatch';
  end if;
  -- Granter must be Albert's active administrator profile.
  if not exists (
       select 1 from auth.users u
       join app.profile p on p.auth_user_id = u.id
       where p.id = '0301af81-7aa9-4655-8746-61bccd93a78e'
         and u.email is not distinct from 'albert@popcre.com'
         and p.status = 'active') then
    raise exception 'granter profile mismatch';
  end if;
  -- unique(profile_id, app): reactivate a revoked row instead of failing.
  insert into app.app_access (profile_id, app, granted_by_profile_id)
  values ('c6c3b9e1-7235-4ed1-8c2c-cc230a884736', 'dam', '0301af81-7aa9-4655-8746-61bccd93a78e')
  on conflict (profile_id, app) do update
    set revoked_at = null, granted_at = now(), granted_by_profile_id = excluded.granted_by_profile_id
    where app.app_access.revoked_at is not null;
  get diagnostics n = row_count;
  if n is distinct from 1 then raise exception 'expected 1 row, got %', n; end if;
end $$;
commit;
