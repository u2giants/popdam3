-- 20260728160000_popdam_user_tables_foreign_keys.sql
--
-- Purpose
-- -------
-- Restore referential integrity between the three PopDAM user tables in
-- `public`, and — as the immediate business reason — make the PostgREST
-- embed used by the PopDAM admin "Settings -> user management" screen work
-- again.
--
-- Symptom this fixes (production, 2026-07-28)
-- -------------------------------------------
--   popdam3 edge function `admin-api`, action `list-users` -> HTTP 500
--     "Could not find a relationship between 'profiles' and 'user_roles'
--      in the schema cache"
--   Reproduced straight against PostgREST, so it is not an app bug:
--     GET /rest/v1/profiles?select=user_id,email,user_roles(role)&limit=1
--     -> 400 PGRST200
--
-- Root cause
-- ----------
-- `public.profiles`, `public.user_roles` and `public.app_access` had NO
-- foreign key constraints at all — not to each other and not to `auth.users`.
-- They merely shared a `user_id` column, which PostgREST cannot infer a
-- relationship from, so the embed `profiles?select=...,user_roles(role)` had
-- nothing to resolve.
--
-- Why user_roles/app_access point at public.profiles and NOT at auth.users
-- -----------------------------------------------------------------------
-- Deliberate. The admin screen embeds those two tables INSIDE `profiles`, and
-- PostgREST resolves an embed only along a foreign key between the two tables
-- being embedded. Pointing them at `auth.users` would restore integrity but
-- would NOT fix the screen.
--
-- Safety checks performed against production (qsllyeztdwjgirsysgai) before
-- writing this migration, 2026-07-28:
--   profiles                                    36 rows
--   user_roles                                  26 rows
--   app_access                                  29 rows
--   user_roles rows with no matching profile     0
--   app_access rows with no matching profile     0
--   profiles rows with no matching auth.users    0
-- No backfill or cleanup is required.
--
-- Signup ordering re-confirmed (this is what makes the FKs safe):
--   `public.handle_new_user` (trigger `on_auth_user_created_popdam`,
--   AFTER INSERT on auth.users) inserts profiles FIRST, then user_roles, then
--   app_access, in BOTH of its branches (SSO branch and invitation branch).
--   Because the trigger is AFTER INSERT, the `auth.users` row already exists,
--   so `profiles_user_id_fkey` is satisfied too.
--   It is the ONLY database function that writes to `public.user_roles`.
--   The other auth.users triggers (`on_auth_user_created` ->
--   handle_new_auth_user, `on_auth_user_email_confirmed` ->
--   handle_user_confirmed) do not touch these three tables.
--   No other app writes them: POP CRM (popcrm-web) and PM/PIM (poppim-web)
--   contain zero references to profiles/user_roles/app_access.
--
-- ON DELETE CASCADE is intentional: deleting an auth user now also removes
-- their profile, their roles and their app access, instead of leaving orphans.
-- popdam3's invite-revocation path (admin-api `revoke-invite`) already deletes
-- the auth user and previously left those rows behind; it will now clean up.
--
-- These are additive constraints only. No RLS policy is changed. No data is
-- deleted. Duplicate-looking `user_roles` rows are LEFT ALONE on purpose — a
-- user legitimately holding both 'user' and 'admin' is valid under
-- UNIQUE (user_id, role).
--
-- Idempotent: safe to re-run.

begin;

-- 1) profiles.user_id -> auth.users(id)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname  = 'profiles_user_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- 2) user_roles.user_id -> public.profiles(user_id)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_roles'::regclass
      and conname  = 'user_roles_user_id_fkey'
  ) then
    alter table public.user_roles
      add constraint user_roles_user_id_fkey
      foreign key (user_id) references public.profiles(user_id) on delete cascade;
  end if;
end $$;

-- 3) app_access.user_id -> public.profiles(user_id)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_access'::regclass
      and conname  = 'app_access_user_id_fkey'
  ) then
    alter table public.app_access
      add constraint app_access_user_id_fkey
      foreign key (user_id) references public.profiles(user_id) on delete cascade;
  end if;
end $$;

-- Supporting indexes on the referencing side. Without these, a cascading
-- delete of a profile has to sequentially scan the child tables, and the FK
-- check on every profile delete is unindexed.
create index if not exists user_roles_user_id_idx  on public.user_roles  (user_id);
create index if not exists app_access_user_id_idx  on public.app_access  (user_id);

commit;

-- PostgREST caches the schema; without this the embed keeps failing even
-- though the constraints now exist.
notify pgrst, 'reload schema';
