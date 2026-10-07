# 2026-10-07 — grant PopDAM search access to all POP employees

Issue: https://github.com/u2giants/popdam3/issues/185

## Why
PopDAM search refuses every user without an `app.app_access` row for `dam`
("DAM access is required", 403), so the UI shows "No assets found". All 25 human
employees hold the legacy `public.app_access` `popdam` entry (which lets them sign in
and browse) but none hold the newer `dam` row; only administrators pass today.

Owner (Albert Hazan, verbatim from his chat): "every employee of POP creations should have popdam access?"

## Route
This is application-owned **row data**, not database structure: `popcre/shared-db`
AGENTS.md §0.0-B ("An application session changing its own *rows* does not belong here").
It is therefore not a migration and is not kept as an executable `.sql` file in this repo.
It is a one-time write, run once by the implementing session after an AI reviewer
APPROVE of this exact text and `ai-task-gates check --before database`, against the live
project `qsllyeztdwjgirsysgai` (target proved first by matching the granter profile below).

`granted_by_profile_id` records Albert, on whose instruction the grant is made.

## Exact statement (run once; aborts unless exactly 25 rows are inserted)
```sql
-- Grant PopDAM ("dam") app access to every active POP Creations employee profile.
-- Issue: https://github.com/u2giants/popdam3/issues/185
-- Owner (Albert, verbatim): "every employee of POP creations should have popdam access?"
-- Target: live project qsllyeztdwjgirsysgai (proved by the caller before running).
-- Scope: an explicit allowlist of the 25 human employees (all active @popcre.com
-- profiles minus the ai-tester and poppim-production-ai-test service accounts).
-- Each must already hold the legacy public.app_access 'popdam' entry (the layer
-- that lets them sign in today), so no deliberate PopDAM revocation is overridden.
-- Expected: exactly 25.
-- Never touches an existing row: a revoked dam row is a deliberate decision and is left alone.
begin;
do $$
declare n int;
begin
  if not exists (select 1 from auth.users u join app.profile p on p.auth_user_id = u.id
       where p.id = '0301af81-7aa9-4655-8746-61bccd93a78e' and lower(u.email) = 'albert@popcre.com' and p.status = 'active') then
    raise exception 'granter profile mismatch';
  end if;
  insert into app.app_access (profile_id, app, granted_by_profile_id)
  select p.id, 'dam', '0301af81-7aa9-4655-8746-61bccd93a78e'
  from app.profile p join auth.users u on u.id = p.auth_user_id
  where p.status = 'active'
    and lower(u.email) in (
      'aagudelo@popcre.com',
      'adweck@popcre.com',
      'albert@popcre.com',
      'amanoel@popcre.com',
      'apinilla@popcre.com',
      'asilva@popcre.com',
      'ccorral@popcre.com',
      'dsmith@popcre.com',
      'eparkin@popcre.com',
      'eperestrelo@popcre.com',
      'ftello@popcre.com',
      'ikereki@popcre.com',
      'jchaffier@popcre.com',
      'jcortazar@popcre.com',
      'jsafdieh@popcre.com',
      'larevalo@popcre.com',
      'mcameron@popcre.com',
      'mcardoso@popcre.com',
      'mzabo@popcre.com',
      'nschuchman@popcre.com',
      'umeka@popcre.com',
      'vbarot@popcre.com',
      'vdionisio@popcre.com',
      'yzhou@popcre.com',
      'zcalderon@popcre.com')
    and exists (select 1 from public.app_access pa where pa.user_id = u.id and pa.app = 'popdam')
    and not exists (select 1 from app.app_access aa where aa.profile_id = p.id and aa.app = 'dam')
    -- (any existing dam row, revoked or not, is left untouched)
  on conflict (profile_id, app) do nothing;
  get diagnostics n = row_count;
  if n is distinct from 25 then raise exception 'expected 25 rows, got %', n; end if;
end $$;
commit;
```
