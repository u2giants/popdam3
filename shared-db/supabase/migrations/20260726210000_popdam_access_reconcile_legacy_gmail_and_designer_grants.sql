-- 20260726210000_popdam_access_reconcile_legacy_gmail_and_designer_grants.sql
--
-- PopDAM access reconciliation. DATA ONLY: no DDL, no enum change, no RLS change.
--
-- Part A: revoke PopDAM access for 11 legacy personal-Gmail logins that were
--         superseded by Microsoft SSO (@popcre.com, Azure provider).
--         Access rows only -- auth.users and public.profiles are LEFT INTACT
--         (Albert's explicit decision, 2026-07-26). Those auth ids are
--         referenced by public.asset_checkouts.user_id, public.invitations
--         .invited_by and created_by-style columns; deleting them is
--         irreversible and would orphan history.
--         Matching is by auth user id, never by email string, so a later email
--         change cannot retarget these statements.
--         u2giants@gmail.com (Albert's own admin account) is deliberately NOT
--         in this list and is untouched.
--
-- Part B: grant the app-schema `designer` role to 5 @popcre.com accounts that
--         have an active app.profile but zero app.user_role rows. Every core.*,
--         api.* and dam.* policy is app-schema gated (e.g.
--         core.customer.shared_read -> app.has_any_role(...)), so these users
--         currently see an empty Styles page even though public.app_access
--         grants them 'popdam'. Albert chose designer over viewer (2026-07-26).
--
-- Verified live against qsllyeztdwjgirsysgai before authoring:
--   * all 11 hold exactly app_access('popdam') + user_roles('user'),
--     no 'admin', no 'styleguides', no app.profile, no asset_checkouts rows;
--   * all 5 grantees have status='active' and 0 app.user_role rows.
--
-- NOT in scope (deliberately): the 13 @popcre.com accounts already holding
-- viewer, albert@popcre.com (administrator), the 3 @designflow.app test
-- accounts, derricksmith21@comcast.net, and the public.style_tracker_rows
-- write policies.

begin;

-- ---------------------------------------------------------------------------
-- Part A -- revoke access for the 11 legacy Gmail logins
-- ---------------------------------------------------------------------------

create temporary table legacy_gmail_logins (user_id uuid primary key) on commit drop;

insert into legacy_gmail_logins (user_id) values
  ('89f0cd2a-d7ae-4140-98f9-b9be7c15052f'), -- adamsdweck@gmail.com      -> adweck@popcre.com
  ('7f7699e8-cbb8-43b7-bdfe-38d7c3796960'), -- deborah.asalles@gmail.com -> no SSO counterpart
  ('a3f77e70-188f-4d39-8a83-61d9de4a71ff'), -- devopswithkube@gmail.com  -> no SSO counterpart
  ('7402d4b2-ec59-474e-9f02-5a0c54ad124c'), -- ilonakereki93@gmail.com   -> no SSO counterpart
  ('74b9c565-9475-4c2e-ac0c-a0cd81df39d4'), -- jenniferchaffier@gmail.com-> jchaffier@popcre.com
  ('2733172b-5b3d-4a19-8fd4-a01427d66408'), -- jessi20036@gmail.com      -> no SSO counterpart
  ('0b2422fd-fe0e-4dec-b794-c703f7dcb324'), -- jmilenacortazar@gmail.com -> jcortazar@popcre.com
  ('385fda19-1a76-4dfa-96e0-8f64f1d54bd8'), -- lizsmith1007@gmail.com    -> eparkin@popcre.com
  ('5523b46b-dcad-4343-bedb-4e472501817e'), -- malachicameron@gmail.com  -> mcameron@popcre.com
  ('a8361851-12b6-432b-966d-bb0e05b616b5'), -- marcelzabo@gmail.com      -> mzabo@popcre.com
  ('6a562f74-d072-4c96-b444-9fa8903b55cc'); -- musubishan@gmail.com      -> no SSO counterpart

-- Safety rail: Albert's own Gmail admin account must never appear here.
do $$
begin
  if exists (
    select 1 from legacy_gmail_logins
    where user_id = '83e78985-94e3-4a28-924c-82cbb189ac9c'::uuid
  ) then
    raise exception 'refusing to revoke u2giants@gmail.com (Albert admin account)';
  end if;
end
$$;

-- Safety rail: none of the 11 may hold admin. If that changed since 2026-07-26,
-- stop rather than silently stripping an administrator.
do $$
declare
  admin_count integer;
begin
  select count(*) into admin_count
  from public.user_roles r
  join legacy_gmail_logins g on g.user_id = r.user_id
  where r.role = 'admin';

  if admin_count > 0 then
    raise exception
      'refusing to proceed: % of the legacy Gmail accounts now hold role=admin', admin_count;
  end if;
end
$$;

delete from public.app_access a
using legacy_gmail_logins g
where a.user_id = g.user_id;

delete from public.user_roles r
using legacy_gmail_logins g
where r.user_id = g.user_id;

-- ---------------------------------------------------------------------------
-- Part B -- grant app-schema `designer` to 5 @popcre.com staff accounts
-- ---------------------------------------------------------------------------

-- granted_by_profile_id is nullable, but attribute the grant to Albert when his
-- profile resolves. Resolved by auth_user_id ownership, not by email text.
insert into app.user_role (profile_id, role_id, granted_by_profile_id, granted_at, revoked_at)
select p.id,
       'd6a73086-8f57-48a1-99ee-4f6b22ea1744'::uuid, -- app.role slug 'designer'
       (select ap.id
          from app.profile ap
          join auth.users au on au.id = ap.auth_user_id
         where au.email = 'albert@popcre.com'
         limit 1),
       now(),
       null
from app.profile p
where p.id in (
  '36750823-430b-4fa7-88ac-771993381196', -- ai-tester@popcre.com
  'a88e8c06-4787-47d9-a37a-2c3929f4c15a', -- ccorral@popcre.com
  '6e9a19b4-e070-460d-9178-b4dfc5cac5a9', -- eparkin@popcre.com
  '5240da36-549f-4511-8fd3-b433530c35af', -- jsafdieh@popcre.com
  '8f383a14-f303-4890-90a2-80306a2d4665'  -- larevalo@popcre.com
)
on conflict (profile_id, role_id) do update
  set revoked_at = null,
      granted_at = now()
  where app.user_role.revoked_at is not null;

commit;
