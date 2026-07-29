-- =============================================================================
-- Close anonymous READ leaks in schema `public`
-- =============================================================================
-- Companion to 20260729120000 / 20260729130000 / 20260729180000, which closed the
-- EXECUTE half of the same trust boundary. This migration closes the RLS/GRANT half.
--
-- `anon` is the role behind the project's publishable "anon key", which ships in the
-- JavaScript bundle of every one of our apps and is NOT a secret. Anything `anon`
-- can read is readable by any anonymous caller on the internet.
--
-- `anon` holds USAGE on schema `public` ONLY (verified on production against
-- public/app/plm/api/crm/pim/core/ingest/dam), so `public` is the entire
-- anon-reachable surface.
--
-- FOUR leaks were confirmed on production (qsllyeztdwjgirsysgai) on 2026-07-29 with
-- nothing but the anon key:
--
--   GET /rest/v1/style_groups                    -> 206, 10,589 rows
--   GET /rest/v1/style_tracker_rows_with_bridge  -> 206, 15,534 rows
--   GET /rest/v1/sg_archive_usage                -> 206,    760 rows
--   GET /rest/v1/style_tracker_audit_log_with_user -> 206,  345 rows
--
-- Two distinct root causes, fixed separately below.
--
-- NOT CHANGED HERE (deliberate): `public.admin_config` returns exactly one row to
-- anon via the policy "anon can read SCAN_REQUEST for Realtime watcher"
-- (roles={anon}, USING key = 'SCAN_REQUEST'). That policy is intentional, narrowly
-- scoped to a single non-secret job-status key, and the DAM scanner's Realtime
-- watcher depends on it. Changing it is a product decision, not a bug fix.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Cause 1: a policy whose `roles` is the PUBLIC pseudo-role, not `authenticated`
-- -----------------------------------------------------------------------------
-- `public.style_groups` had:
--
--   CREATE POLICY "Authenticated users can read style_groups" ON public.style_groups
--     FOR SELECT USING (true);          -- no TO clause
--
-- Omitting `TO` defaults to the PUBLIC pseudo-role, which every role is a member of
-- -- including `anon`. So the policy granted precisely what its own name says it
-- should not. Re-create it scoped to `authenticated`, matching its stated intent.
--
-- The sibling policy "Admins can manage style_groups" (FOR ALL, USING
-- has_role(auth.uid(),'admin')) is intentionally left untouched: it already denies
-- anon because auth.uid() is NULL for an anonymous caller.
--
-- Safe to scope: an audit of every app repo (popdam3, popcrm-web, poppim-web,
-- monitor, hiclaw, dflow) found no unauthenticated reader of style_groups. Browser
-- reads sit behind popdam3's ProtectedRoute; all other reads use service_role from
-- edge functions and the worker.

drop policy if exists "Authenticated users can read style_groups" on public.style_groups;

create policy "Authenticated users can read style_groups"
  on public.style_groups
  for select
  to authenticated
  using (true);


-- -----------------------------------------------------------------------------
-- Cause 2: views bypass RLS, so a GRANT to `anon` is the only guard -- and it was there
-- -----------------------------------------------------------------------------
-- A Postgres view created without `security_invoker = true` runs as its OWNER
-- (`postgres`, which is BYPASSRLS on Supabase). Row-level security on the underlying
-- tables therefore does NOT apply to a caller reading through the view.
--
-- These three views each read tables whose own RLS correctly denies anon -- proven
-- on production: GET /rest/v1/style_tracker_rows returns 0 rows to anon while
-- GET /rest/v1/style_tracker_rows_with_bridge returned 15,534. The view defeated the
-- table's protection. Supabase's default ACLs granted `anon` SELECT on each view at
-- creation time, and nothing ever revoked it.
--
-- Fix by removing anon's grant. We deliberately do NOT set `security_invoker = true`
-- here: that would change what LOGGED-IN users see, silently and for the worse.
--   * style_tracker_audit_log_with_user joins public.profiles, whose RLS limits a
--     non-admin to their OWN row -- changed_by_label/changed_by_email would go NULL
--     for everyone else's entries, gutting the audit trail.
--   * style_tracker_rows_with_bridge joins core.customer / core.licensor /
--     core.creative_designer / core.factory, whose RLS requires an `app` role, so
--     canonical names would vanish for users without one.
-- Revoking anon's SELECT closes the hole and cannot change behaviour for
-- `authenticated` or `service_role`, whose grants are untouched.
--
-- All three views are non-updatable (joins/aggregates; information_schema
-- is_insertable_into = 'NO'), so the stray INSERT/UPDATE/DELETE grants were never
-- exploitable -- but we drop them too rather than leave a latent trap for whoever
-- later adds an INSTEAD OF trigger.

revoke all on table public.style_tracker_rows_with_bridge from anon;
revoke all on table public.style_tracker_audit_log_with_user from anon;
revoke all on table public.sg_archive_usage from anon;

-- Also drop the PUBLIC pseudo-role's grants, which anon would otherwise inherit.
-- (None were observed on production, but this makes the outcome unconditional.)
revoke all on table public.style_tracker_rows_with_bridge from public;
revoke all on table public.style_tracker_audit_log_with_user from public;
revoke all on table public.sg_archive_usage from public;


-- =============================================================================
-- Self-assertion: fail loudly rather than land a false sense of security
-- =============================================================================
-- This migration must never "succeed" while the leak is still open, and must never
-- close the leak by breaking the logged-in apps. Both directions are asserted.
--
-- `set local role` drops the BYPASSRLS that the migration's own `postgres` role
-- carries, so these checks exercise the real policy path.

do $$
declare
  v_anon_rows   bigint;
  v_auth_rows   bigint;
  v_view        text;
  v_leaked      text[] := '{}';
begin
  -- ---------------------------------------------------------------------------
  -- 1. anon must NOT be able to read style_groups.
  -- ---------------------------------------------------------------------------
  set local role anon;
  select count(*) into v_anon_rows from public.style_groups;
  reset role;

  if v_anon_rows <> 0 then
    raise exception
      'SECURITY ASSERTION FAILED: role anon can still read public.style_groups (% rows visible). The anon read leak is NOT closed.',
      v_anon_rows;
  end if;

  -- ---------------------------------------------------------------------------
  -- 2. authenticated MUST still be able to read style_groups.
  --    Guards against over-tightening: the DAM app depends on this read.
  --    Asserted only when the table actually holds rows, so the check stays valid
  --    on an empty/seeded environment.
  -- ---------------------------------------------------------------------------
  if (select count(*) from public.style_groups) > 0 then
    set local role authenticated;
    select count(*) into v_auth_rows from public.style_groups;
    reset role;

    if v_auth_rows = 0 then
      raise exception
        'REGRESSION ASSERTION FAILED: role authenticated can no longer read public.style_groups. The fix has broken the logged-in apps.';
    end if;

    raise notice 'OK: public.style_groups -- anon sees 0 rows, authenticated sees % rows.', v_auth_rows;
  else
    raise notice 'OK: public.style_groups -- anon sees 0 rows (table is empty, so the authenticated-side check was skipped).';
  end if;

  -- ---------------------------------------------------------------------------
  -- 3. anon must NOT be able to read any of the three views.
  --    After the revoke, `set role anon` + SELECT must raise insufficient_privilege
  --    (SQLSTATE 42501). Anything else -- rows returned, or any other error -- is a
  --    failure we want to hear about.
  -- ---------------------------------------------------------------------------
  foreach v_view in array array[
    'public.style_tracker_rows_with_bridge',
    'public.style_tracker_audit_log_with_user',
    'public.sg_archive_usage'
  ]
  loop
    begin
      set local role anon;
      execute format('select count(*) from %s', v_view) into v_anon_rows;
      reset role;
      -- No exception raised: anon still holds SELECT on the view.
      v_leaked := v_leaked || (v_view || ' (readable, ' || v_anon_rows || ' rows)');
    exception
      when insufficient_privilege then
        reset role;
        raise notice 'OK: anon is denied SELECT on % (42501, as intended).', v_view;
      when others then
        reset role;
        v_leaked := v_leaked || (v_view || ' (unexpected error ' || sqlstate || ': ' || sqlerrm || ')');
    end;
  end loop;

  if array_length(v_leaked, 1) > 0 then
    raise exception
      'SECURITY ASSERTION FAILED: role anon can still reach these views: %',
      array_to_string(v_leaked, '; ');
  end if;

  -- ---------------------------------------------------------------------------
  -- 4. authenticated MUST still be able to read all three views.
  -- ---------------------------------------------------------------------------
  foreach v_view in array array[
    'public.style_tracker_rows_with_bridge',
    'public.style_tracker_audit_log_with_user',
    'public.sg_archive_usage'
  ]
  loop
    begin
      set local role authenticated;
      execute format('select count(*) from %s', v_view) into v_auth_rows;
      reset role;
      raise notice 'OK: authenticated can still read % (% rows).', v_view, v_auth_rows;
    exception
      when others then
        reset role;
        raise exception
          'REGRESSION ASSERTION FAILED: role authenticated can no longer read %  (SQLSTATE %: %). The fix has broken the logged-in apps.',
          v_view, sqlstate, sqlerrm;
    end;
  end loop;

  raise notice 'All anon read-leak assertions passed.';
end
$$;
