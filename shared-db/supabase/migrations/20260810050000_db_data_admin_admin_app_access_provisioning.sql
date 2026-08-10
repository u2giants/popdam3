-- =====================================================================================
-- Issue #607 / #629 — provision the explicit `admin` app_access rows that DB Data Admin
-- has always required and that nothing has ever been able to create.
--
-- DATA ONLY. Zero DDL. No function, policy, grant, role or enum is touched.
--
-- THE DEFECT THIS FIXES IS GENERAL, NOT ONE PERSON'S ACCESS
-- ---------------------------------------------------------
-- Every DB Data Admin contract is gated on BOTH a role AND an explicit, non-revoked
-- `app.app_access` row with app = 'admin':
--
--   * app.require_db_data_admin_access()                     (20260722005000)
--       has_role('administrator') AND has_explicit_app_access('admin')
--   * app.require_db_data_admin_product_depth_access()       (20260809170500)
--       has_any_role('administrator','designer') AND has_explicit_app_access('admin')
--
-- `app.has_explicit_app_access` deliberately gives administrators NO implicit grant.
-- That two-arm design is correct and is NOT changed here: a role alone must never open
-- an admin tool.
--
-- But a live read of production on 2026-08-09 found **zero rows anywhere in
-- app.app_access with app = 'admin'** — not for the designer maintainer, not for any of
-- the three active administrators, not for anyone. Active rows were crm 27, dam 3, pm 2, admin 0. So the
-- second arm has never been satisfiable and every DB Data Admin screen has been closed
-- to every human user since 20260722005000 shipped.
--
-- Nothing can create such a row either. The only function in app/api/public that inserts
-- into app.app_access is the signup hook app.handle_new_auth_user, which grants 'crm'.
-- There is no provisioning RPC and no admin surface. That missing route is recorded as a
-- separate follow-up by the orchestrator; this migration restores the access itself.
--
-- NOT THE OTHER PERMISSION SYSTEM
-- --------------------------------
-- `public.app_access` is a DIFFERENT table with a DIFFERENT enum (popdam, styleguides)
-- and has no bearing on this gate. It is deliberately untouched. Confusing the two is a
-- known trap in this database.
--
-- WHO IS PROVISIONED, AND WHY IT IS A FIX RATHER THAN A NEW ENTITLEMENT
-- ---------------------------------------------------------------------
--   * The three active `administrator` profiles. They are already administrators; the
--     missing row is a provisioning defect, so this restores access they were always
--     meant to have. They are selected BY ROLE, not by a hard-coded list, so the
--     entitlement and the grant cannot drift apart.
--   * One active `designer` profile, addressed by profile UUID: the maintainer the owner
--     named in decision 1 on issue #597, already granted the designer role by migration
--     20260726210000. Addressed by UUID and never by email — this repository is public
--     and these are real people.
--
-- The rails below refuse loudly rather than grant a smaller set: a provisioning migration
-- that silently grants fewer rows than intended is exactly the failure mode being guarded
-- against. The rail that matters is the UNDER-GRANT rail — after the insert, the number of
-- live `admin` rows across the target set must equal the number of targets, exactly.
--
-- The expectation is DERIVED, never hard-coded. An earlier draft hard-coded "3
-- administrators, 4 targets" from a production read on 2026-08-09 and would have aborted
-- on preview, where the identity data differs, and would abort a future promotion run the
-- moment somebody hires an administrator. A count surprise is worth a NOTICE, not a
-- failed 47-migration promotion.
--
-- PREVIEW IDENTITY DATA IS NOT A PRODUCTION CLONE (verified 2026-08-09)
-- ---------------------------------------------------------------------
-- Preview's migration ledger tracks main, but its `app.profile` / `app.user_role` /
-- `app.app_access` data does NOT track production. Preview had 4 active administrators to
-- production's 3, and two of production's three administrator profiles do not exist in
-- `app.profile` on preview at all. Preview also carried 3 live `admin` app_access rows,
-- granted by hand on 2026-07-22, 07-24 and 07-28, that exist in no migration in this
-- repository. That is precisely why this defect stayed invisible: anyone exercising DB
-- Data Admin on preview saw a permission state production has never had.
--
-- PRODUCTION IS INERT UNTIL THE GATE ARRIVES
-- -------------------------------------------
-- Production is roughly 50 migrations behind and does not yet have the Product Depth
-- gate functions. These rows change nothing there until 20260809170500 lands through the
-- bounded promotion. A merged PR does NOT mean Depth is editable in production.
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- Targets
-- -------------------------------------------------------------------------------------

create temporary table admin_access_targets (
  profile_id uuid primary key,
  reason     text not null
) on commit drop;

-- Role-derived: every ACTIVE profile that currently holds an active `administrator` role.
--
-- The profile-status condition is a FILTER here, not an assertion. `user_role.revoked_at
-- is null` and `profile.status = 'active'` are independent — a deactivated profile whose
-- administrator role row was never revoked is an ordinary data state and nothing in the
-- schema prevents it. Asserting instead of filtering would abort the whole bounded
-- promotion run on a provisioning migration that had no business blocking it. An inactive
-- administrator is simply not a target; it is not an error.
insert into admin_access_targets (profile_id, reason)
select distinct ur.profile_id, 'active administrator role'
from app.user_role ur
join app.role r on r.id = ur.role_id
join app.profile p on p.id = ur.profile_id and p.status = 'active'
where r.slug = 'administrator'
  and ur.revoked_at is null;

-- Named maintainer (issue #597 decision 1), addressed by profile UUID, never by email.
insert into admin_access_targets (profile_id, reason)
values ('a88e8c06-4787-47d9-a37a-2c3929f4c15a', 'designer maintainer for Product Depth (#597 decision 1, #607)')
on conflict (profile_id) do nothing;

-- -------------------------------------------------------------------------------------
-- Rail 1 — the NAMED designer maintainer must exist and be active.
--
-- This one stays a hard refusal, and only for the named UUID. The administrator targets
-- are already filtered to active profiles above, so they cannot trip it. But if the one
-- profile this migration was written for is missing or deactivated, the migration itself
-- is wrong and must not proceed quietly.
-- -------------------------------------------------------------------------------------

do $$
declare
  v_ok integer;
begin
  select count(*) into v_ok
  from app.profile p
  where p.id = 'a88e8c06-4787-47d9-a37a-2c3929f4c15a'::uuid
    and p.status = 'active';

  if v_ok <> 1 then
    raise exception
      'refusing to provision admin app_access: the named designer maintainer profile is missing or not active'
      using errcode = 'P0001';
  end if;
end
$$;

-- -------------------------------------------------------------------------------------
-- Rail 2 — the target set must be coherent. Derived, not hard-coded.
--   * refuse if there is no active administrator at all (the role query is broken, or
--     this is not a database that should be receiving this grant);
--   * refuse if the named designer maintainer is absent from the target set;
--   * NOTICE, never an error, if the administrator count is not the 3 verified live on
--     production on 2026-08-09. A hiring change must not abort a promotion run.
-- -------------------------------------------------------------------------------------

do $$
declare
  v_admins   integer;
  v_designer integer;
begin
  select count(*) into v_admins
    from admin_access_targets where reason = 'active administrator role';

  select count(*) into v_designer
    from admin_access_targets
   where profile_id = 'a88e8c06-4787-47d9-a37a-2c3929f4c15a'::uuid;

  if v_admins = 0 then
    raise exception
      'refusing to provision admin app_access: found zero active administrator profiles'
      using errcode = 'P0001';
  end if;

  if v_designer <> 1 then
    raise exception
      'refusing to provision admin app_access: the named designer maintainer is not in the target set'
      using errcode = 'P0001';
  end if;

  if v_admins <> 3 then
    raise notice
      'admin app_access provisioning: % active administrator profile(s) found; 3 were verified on production on 2026-08-09. Not an error — the target set is derived from the administrator role, so this simply reflects the administrator set of this database.',
      v_admins;
  end if;
end
$$;

-- -------------------------------------------------------------------------------------
-- Grant. Idempotent: a re-run re-activates a revoked row and otherwise changes nothing.
--
-- RE-ACTIVATION IS NOT SILENT. The DO UPDATE clears `revoked_at`, which means it can undo
-- a deliberate revocation. Rail 3 requires that behaviour — a target must end up with a
-- live row — but it must never happen invisibly, so the affected profiles are captured
-- first and named in the apply log. There are zero `admin` rows of any kind in production
-- today, so today's impact is nil; this migration may run against states we have not seen.
-- -------------------------------------------------------------------------------------

create temporary table admin_access_reactivated (profile_id uuid primary key) on commit drop;

insert into admin_access_reactivated (profile_id)
select aa.profile_id
from app.app_access aa
join admin_access_targets t on t.profile_id = aa.profile_id
where aa.app = 'admin'
  and aa.revoked_at is not null;

insert into app.app_access (profile_id, app, granted_at, revoked_at)
select t.profile_id, 'admin'::app.app_name, now(), null
from admin_access_targets t
on conflict (profile_id, app) do update
  set revoked_at = null,
      granted_at = now()
  where app.app_access.revoked_at is not null;

do $$
declare
  v_count integer;
  v_ids   text;
begin
  select count(*), string_agg(profile_id::text, ', ' order by profile_id::text)
    into v_count, v_ids
  from admin_access_reactivated;

  if v_count > 0 then
    raise notice
      'admin app_access provisioning: RE-ACTIVATED % previously revoked admin grant(s). Profile id(s): %. A revocation was undone — confirm that was intended.',
      v_count, v_ids;
  end if;
end
$$;

-- -------------------------------------------------------------------------------------
-- Rail 3 — the under-grant rail, and the one that matters. After the insert, every single
--          target must hold a live `admin` row. Granting fewer than intended fails loudly.
-- -------------------------------------------------------------------------------------

do $$
declare
  v_targets integer;
  v_granted integer;
begin
  select count(*) into v_targets from admin_access_targets;

  select count(*) into v_granted
  from admin_access_targets t
  join app.app_access aa
    on aa.profile_id = t.profile_id
   and aa.app = 'admin'
   and aa.revoked_at is null;

  if v_granted <> v_targets then
    raise exception
      'admin app_access provisioning did not take: % target(s) but only % live admin row(s)',
      v_targets, v_granted
      using errcode = 'P0001';
  end if;
end
$$;

commit;
