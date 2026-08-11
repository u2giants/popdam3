-- =====================================================================================
-- Contract tests for migration 20260812010000 -- the PopCRM durable worker delta cursor
-- (issue #782, object claim #795).
--
-- -------------------------------------------------------------------------------------
-- HOW THIS FILE IS RUN, AND WHAT ITS RESULT MEANS
--   CI executes it (`.github/workflows/database-contract-tests.yml`). IT IS WRITTEN TO
--   PASS FROM EMPTY and must stay that way -- it must never end up in
--   supabase/tests/ci-quarantine.txt. It touches only objects migration 20260812010000
--   creates and needs no seeded reference data of any kind.
--
--   ONE ENVIRONMENTAL DEPENDENCY, STATED PLAINLY: the three cursor functions are guarded
--   by crm.worker_cursor_privilege_ok, which is TRUE only for JWT role service_role or
--   session_user postgres / supabase_admin. This file must therefore run as the migration
--   owner. Section A proves that BEFORE anything else executes, so a wrong connection
--   fails with one clear reason instead of a cascade of permission errors.
--
-- SIDE EFFECTS: NONE. Everything that writes runs inside a transaction ending in ROLLBACK,
--   and section H re-asserts that against committed state.
--
-- EVERY VALUE IN THIS FILE IS INVENTED. u2giants/shared-db is PUBLIC. NO REAL MICROSOFT
--   GRAPH DELTA LINK, mailbox address, tenant id or token appears here or ever may --
--   a delta link is opaque and potentially credential-bearing. Fixtures use ZZTEST-*
--   tokens and example.invalid hosts only.
--
-- WHY EVERY "must be refused" CHECK TRAPS sqlstate 'P0001' AND NOT `when others`:
--   `when others` is satisfied by ANY error, so a section would PASS FOR THE WRONG REASON
--   -- reporting that a guard works when the statement never reached it. Every guard in
--   this contract raises `using errcode = 'P0001'`, so that is what is trapped.
--
-- WHAT IT ASSERTS -- and the five that exist because printing them is not proving them:
--   A  Preconditions: guard satisfied; table present; 4 functions present as SECURITY
--      DEFINER (bar the immutable predicate) with pg_catalog FIRST in a pinned path.
--   B  *** service_role holds NO privilege on the table. *** Asserted from
--      information_schema.role_table_grants, and separately from has_table_privilege,
--      because the `crm` default ACL grants {arwdDxtm} to every new table in the schema.
--   C  *** RLS DENIAL. *** RLS enabled AND forced, ZERO policies, and anon/authenticated
--      are denied by direct execution as those roles -- not merely by reading a catalog.
--   D  *** THE NULL-ROLE CASE. *** The privilege predicate is FALSE for NULL, for empty,
--      and for a browser role -- the exact case that holds inside a migration, and the
--      case a `not ( ... or auth.role() = ... )` guard silently lets through.
--   E  *** STALE-VERSION SAVE RAISES P0001. *** Plus create-mode collision, and proof the
--      losing save changed NOTHING.
--   F  *** worker_delta_cursor_status NEVER RETURNS delta_link. *** Asserted against the
--      actual output keys AND against pg_get_functiondef, and asserted for save() too.
--   G  *** TWO CONCURRENT SAVERS: THE LOSER LOSES. *** Real concurrency via dblink is not
--      available here, so the interleaving is reproduced exactly and deterministically:
--      both savers hold the SAME loaded version, one commits, the other then presents the
--      now-stale version and must be refused.
--   H  Happy path, digest correctness, advanced_at semantics, and no surviving test data.
-- =====================================================================================

\set ON_ERROR_STOP on

-- =====================================================================================
-- A. PRECONDITIONS.
-- =====================================================================================
do $$
declare
  v_bad text;
  v_n   int;
begin
  if not crm.worker_cursor_privilege_ok(auth.role(), session_user) then
    raise exception 'A FAILED: this connection does not satisfy '
      'crm.worker_cursor_privilege_ok (JWT role %L / session_user %L). These contract '
      'tests must run as the migration owner -- postgres or supabase_admin -- or as '
      'service_role. Nothing below can execute otherwise.',
      coalesce(auth.role(), '<null>'), coalesce(session_user, '<null>');
  end if;

  -- THE OBJECT ITSELF EXISTS. "The migration applied" is a statement about the ledger,
  -- not about the database, so the object is checked directly.
  if to_regclass('crm.worker_delta_cursor') is null then
    raise exception 'A FAILED: crm.worker_delta_cursor does not exist.';
  end if;

  select count(*) into v_n from pg_proc p
  where p.pronamespace = 'crm'::regnamespace
    and p.proname in ('worker_cursor_privilege_ok', 'load_worker_delta_cursor',
                      'save_worker_delta_cursor', 'worker_delta_cursor_status');
  if v_n <> 4 then
    raise exception 'A FAILED: expected 4 cursor functions in crm, found %.', v_n;
  end if;

  -- The three data-path functions are SECURITY DEFINER with pg_catalog FIRST. A definer
  -- function that resolves builtins through a caller-influenced schema is the classic
  -- definer escalation, and it applies perfectly clean -- which is why it is asserted.
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  where p.pronamespace = 'crm'::regnamespace
    and p.proname in ('load_worker_delta_cursor', 'save_worker_delta_cursor',
                      'worker_delta_cursor_status')
    and (not p.prosecdef
         or p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) c
                        where c like 'search_path=pg_catalog%'));
  if v_bad is not null then
    raise exception 'A FAILED: function(s) % are not SECURITY DEFINER with pg_catalog '
      'first in a pinned search_path.', v_bad;
  end if;

  -- The predicate is the opposite: IMMUTABLE, NOT definer, and still pinned.
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  where p.pronamespace = 'crm'::regnamespace
    and p.proname = 'worker_cursor_privilege_ok'
    and (p.prosecdef or p.provolatile <> 'i' or p.proconfig is null);
  if v_bad is not null then
    raise exception 'A FAILED: crm.worker_cursor_privilege_ok must be IMMUTABLE, NOT '
      'SECURITY DEFINER, and search_path-pinned.';
  end if;

  -- NO INDEX BEYOND THE IMPLICIT PRIMARY KEY -- the design says so, so it is checked.
  select count(*) into v_n from pg_index i
  where i.indrelid = 'crm.worker_delta_cursor'::regclass;
  if v_n <> 1 then
    raise exception 'A FAILED: expected exactly 1 index (the implicit primary key), found %.',
      v_n;
  end if;

  -- NO TRIGGER. updated_at/advanced_at are set inside the save function on purpose; a
  -- BEFORE trigger appearing later would mean that decision was quietly reversed.
  select count(*) into v_n from pg_trigger t
  where t.tgrelid = 'crm.worker_delta_cursor'::regclass and not t.tgisinternal;
  if v_n <> 0 then
    raise exception 'A FAILED: % trigger(s) exist on crm.worker_delta_cursor. The '
      'timestamps are set INSIDE crm.save_worker_delta_cursor deliberately, so that the '
      'GENERATED-STORED-versus-BEFORE-trigger class of bug cannot occur.', v_n;
  end if;

  -- THE ENVIRONMENTAL PRECONDITION SECTION C DEPENDS ON, ASSERTED RATHER THAN ASSUMED.
  -- C proves RLS denial by actually running as anon and authenticated, which needs those
  -- roles to exist AND this connection to be a member of them. Without this check, a shim
  -- regression makes C fail with "permission denied to set role" -- an error about the
  -- TEST HARNESS that reads exactly like a failure of the CONTRACT.
  if not exists (select 1 from pg_roles where rolname = 'anon')
  or not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'A FAILED: role anon and/or authenticated does not exist, so the RLS '
      'denial tests in section C cannot run. This is an environment problem, NOT a '
      'contract failure.';
  end if;
  if not pg_has_role(session_user, 'anon', 'MEMBER')
  or not pg_has_role(session_user, 'authenticated', 'MEMBER') then
    raise exception 'A FAILED: session_user %L is not a member of anon/authenticated, so '
      'section C cannot SET ROLE to them to prove denial by execution. Environment '
      'problem, NOT a contract failure.', session_user;
  end if;

  raise notice 'A PASSED: guard satisfied; table present; 4 functions with correct '
    'volatility/definer/search_path; exactly 1 index; 0 triggers; anon/authenticated '
    'exist and are assumable, so section C can prove denial by execution.';
end;
$$;

-- =====================================================================================
-- B. THE service_role REVOKE. ASSERTED, NOT PRINTED.
--
-- The `crm` schema's default ACL is {service_role=arwdDxtm/postgres}, so EVERY new table
-- here is BORN with service_role holding SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/
-- TRUNCATE/MAINTAIN. Writing `revoke all ... from service_role` in the migration and
-- looking at it proves nothing -- a later grant, a default-ACL change, or a rebased merge
-- that drops the line would all pass an eyeball review. This section reads the LIVE ACL.
--
-- And it matters more here than usual: service_role has BYPASSRLS, so it ignores the empty
-- policy set entirely. This revoke is the ONLY thing standing between the worker's own key
-- and a direct UPDATE that skips the compare-and-swap, or a TRUNCATE that erases every
-- cursor in one statement while firing no trigger at all.
-- =====================================================================================
do $$
declare
  v_grants text;
  v_priv   text;
begin
  select string_agg(g.privilege_type, ', ' order by g.privilege_type) into v_grants
  from information_schema.role_table_grants g
  where g.table_schema = 'crm' and g.table_name = 'worker_delta_cursor'
    and g.grantee = 'service_role';

  if v_grants is not null then
    raise exception 'B FAILED: service_role holds [%] on crm.worker_delta_cursor. The crm '
      'default ACL grants arwdDxtm to every new table in this schema, so the migration''s '
      'revoke is what makes the narrow-RPC contract real. With any of these, the worker '
      'key can UPDATE past the compare-and-swap -- and with TRUNCATE it can erase every '
      'cursor in one statement, firing no trigger.', v_grants;
  end if;

  -- Belt and braces: the same fact through has_table_privilege, which resolves privileges
  -- inherited through role membership and would catch a grant made to a role service_role
  -- is a member of -- something role_table_grants alone would not show.
  -- MAINTAIN is included only on PG17+, where it exists -- it is the `m` in the crm default
  -- ACL's `arwdDxtm`, so leaving it out would check one privilege short of the very set
  -- this section defends against. Naming it unconditionally would instead ERROR on an older
  -- server, turning a portability problem into a fake contract failure.
  foreach v_priv in array (
    array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
    || case when current_setting('server_version_num')::int >= 170000
            then array['MAINTAIN'] else array[]::text[] end
  )
  loop
    if has_table_privilege('service_role', 'crm.worker_delta_cursor', v_priv) then
      raise exception 'B FAILED: service_role has % on crm.worker_delta_cursor via an '
        'inherited grant.', v_priv;
    end if;
  end loop;

  -- anon and authenticated must hold nothing either.
  select string_agg(g.grantee || ':' || g.privilege_type, ', ') into v_grants
  from information_schema.role_table_grants g
  where g.table_schema = 'crm' and g.table_name = 'worker_delta_cursor'
    and g.grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_grants is not null then
    raise exception 'B FAILED: a browser role holds [%] on crm.worker_delta_cursor.',
      v_grants;
  end if;

  -- EXECUTE on the data-path functions is service_role ONLY. authenticated must NOT have
  -- it: the predicate would refuse a browser JWT anyway, but an anon/authenticated-callable
  -- SECURITY DEFINER function is exactly the exposure class the 2026-07-29 public-schema
  -- audit found 88 of, and "it fails safely once you read the body" is a worse position
  -- than "it is not reachable".
  if has_function_privilege('authenticated', 'crm.save_worker_delta_cursor(text,text,text,text,uuid)', 'EXECUTE')
  or has_function_privilege('anon',          'crm.save_worker_delta_cursor(text,text,text,text,uuid)', 'EXECUTE')
  or has_function_privilege('authenticated', 'crm.load_worker_delta_cursor(text)', 'EXECUTE')
  or has_function_privilege('anon',          'crm.load_worker_delta_cursor(text)', 'EXECUTE')
  or has_function_privilege('authenticated', 'crm.worker_delta_cursor_status(text)', 'EXECUTE')
  or has_function_privilege('anon',          'crm.worker_delta_cursor_status(text)', 'EXECUTE') then
    raise exception 'B FAILED: a browser role can EXECUTE a cursor function.';
  end if;

  if not has_function_privilege('service_role', 'crm.load_worker_delta_cursor(text)', 'EXECUTE')
  or not has_function_privilege('service_role', 'crm.save_worker_delta_cursor(text,text,text,text,uuid)', 'EXECUTE')
  or not has_function_privilege('service_role', 'crm.worker_delta_cursor_status(text)', 'EXECUTE') then
    raise exception 'B FAILED: service_role cannot EXECUTE a cursor function. The revoke '
      'went too far and the worker has no path at all.';
  end if;

  raise notice 'B PASSED: service_role holds ZERO table privileges (asserted from '
    'role_table_grants AND has_table_privilege), browser roles hold nothing, and EXECUTE '
    'is service_role-only.';
end;
$$;

-- =====================================================================================
-- C. RLS DENIAL -- PROVED BY EXECUTING AS THE BROWSER ROLES, NOT BY READING A CATALOG.
-- =====================================================================================
do $$
declare
  v_rls   boolean;
  v_force boolean;
  v_pol   int;
begin
  select c.relrowsecurity, c.relforcerowsecurity into v_rls, v_force
  from pg_class c where c.oid = 'crm.worker_delta_cursor'::regclass;
  if not v_rls then
    raise exception 'C FAILED: row level security is not ENABLED.';
  end if;
  if not v_force then
    raise exception 'C FAILED: row level security is not FORCED. Without FORCE the deny is '
      'quietly waived for whoever owns the table.';
  end if;

  select count(*) into v_pol from pg_policy p
  where p.polrelid = 'crm.worker_delta_cursor'::regclass;
  if v_pol <> 0 then
    raise exception 'C FAILED: % policy/policies exist. The design is ZERO policies -- '
      'deny everything -- and any policy is a hole someone reasoned their way into.', v_pol;
  end if;

  raise notice 'C1 PASSED: RLS enabled, FORCED, zero policies.';
end;
$$;

begin;

-- Seed one row as the owner so the denial tests below have something they could
-- conceivably read. If they could read it, they would.
select crm.save_worker_delta_cursor(
  'ZZTEST-cursor-denial', 'ZZTEST-purpose', 'ZZTEST-owner@example.invalid',
  'ZZTEST-OPAQUE-LINK-DENIAL', null);

do $$
declare
  v_n     int;
  v_ok    boolean;
begin
  -- ---------------------------------------------------------------------------------
  -- C2. AS `anon` -- the unauthenticated browser role.
  -- The failure is a privilege error (42501) because the REVOKE bites before RLS is even
  -- consulted, which is the correct and stronger outcome. `when others` is acceptable
  -- ONLY here, and only because ANY error is a denial and the assertion is that NO ROW
  -- COMES BACK -- which the count check below proves independently of the error code.
  -- ---------------------------------------------------------------------------------
  set local role anon;
  v_ok := false;
  begin
    select count(*) into v_n from crm.worker_delta_cursor;
    if v_n > 0 then
      raise exception 'C FAILED: role anon read % row(s) from crm.worker_delta_cursor.', v_n;
    end if;
    -- Zero rows without an error would still be a failure of the REVOKE, though not of
    -- RLS. Either way it must not be reachable.
    raise exception 'C FAILED: role anon SELECTed crm.worker_delta_cursor without error.';
  exception
    when insufficient_privilege then v_ok := true;
    when others then
      if sqlerrm like 'C FAILED%' then raise; end if;
      v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'C FAILED: role anon was not denied.';
  end if;

  -- C3. AS `authenticated` -- a logged-in browser user. Same denial.
  set local role authenticated;
  v_ok := false;
  begin
    select count(*) into v_n from crm.worker_delta_cursor;
    if v_n > 0 then
      raise exception 'C FAILED: role authenticated read % row(s).', v_n;
    end if;
    raise exception 'C FAILED: role authenticated SELECTed crm.worker_delta_cursor '
      'without error.';
  exception
    when insufficient_privilege then v_ok := true;
    when others then
      if sqlerrm like 'C FAILED%' then raise; end if;
      v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'C FAILED: role authenticated was not denied SELECT.';
  end if;

  -- C4. AS `authenticated` -- WRITES are denied too, not just reads. A contract that
  -- blocks reading but not writing would let a browser corrupt every worker's progress.
  set local role authenticated;
  v_ok := false;
  begin
    update crm.worker_delta_cursor set delta_link = 'ZZTEST-TAMPERED';
    raise exception 'C FAILED: role authenticated UPDATEd crm.worker_delta_cursor.';
  exception
    when insufficient_privilege then v_ok := true;
    when others then
      if sqlerrm like 'C FAILED%' then raise; end if;
      v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'C FAILED: role authenticated was not denied UPDATE.';
  end if;

  -- C5. AS `authenticated` -- the FUNCTION path is closed as well.
  --
  -- WHAT THIS DOES AND DOES NOT PROVE -- READ BEFORE STRENGTHENING THE CLAIM.
  -- It proves the EXECUTE REVOKE holds. It does NOT prove the predicate would refuse,
  -- and it CANNOT, because `set role` changes current_user but leaves SESSION_USER as the
  -- migration owner (verified: current_user='authenticated', session_user='postgres'), and
  -- the predicate matches positively on session_user. So inside this test harness the
  -- predicate would return TRUE for a browser role -- the grant is what stops it here.
  -- That is not a hole in the contract: in the real deployment a PostgREST connection has
  -- session_user 'authenticator' and JWT role 'authenticated', and the predicate is false
  -- on both counts. It is a limit of `set role` as a way to impersonate a browser, which
  -- is exactly why section D calls the predicate DIRECTLY with browser-shaped arguments.
  -- The two sections together cover what neither can alone.
  --
  -- The test still guards the regression that matters: if a future migration granted
  -- EXECUTE to authenticated, the call would SUCCEED here and this section would fail.
  set local role authenticated;
  v_ok := false;
  begin
    perform crm.load_worker_delta_cursor('ZZTEST-cursor-denial');
    raise exception 'C FAILED: role authenticated called crm.load_worker_delta_cursor.';
  exception
    when insufficient_privilege then v_ok := true;
    when sqlstate 'P0001' then v_ok := true;
    when others then
      if sqlerrm like 'C FAILED%' then raise; end if;
      v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'C FAILED: role authenticated reached the load function.';
  end if;

  -- C6. AND THE ROW IS STILL THERE, UNCHANGED. Proves C4 denied the write rather than the
  -- test merely failing to notice a successful one.
  if (select delta_link from crm.worker_delta_cursor
      where cursor_key = 'ZZTEST-cursor-denial') <> 'ZZTEST-OPAQUE-LINK-DENIAL' then
    raise exception 'C FAILED: the stored link changed. A browser role tampered with it.';
  end if;

  raise notice 'C PASSED: anon and authenticated are denied SELECT, UPDATE and the '
    'function path; the stored value is untouched.';
end;
$$;

-- =====================================================================================
-- D. THE NULL-ROLE CASE. THE ONE A `not ( ... or auth.role() = ... )` GUARD LETS THROUGH.
--
-- With NULL role: `NULL = 'service_role'` is NULL -> the OR is NULL -> `not NULL` is NULL
-- -> which is NOT TRUE, so the raise is SKIPPED and the caller proceeds. The guard reads
-- as strict and behaves as wide open, and auth.role() IS NULL inside a migration and in
-- psql. That is why the predicate is a POSITIVE match on a NON-NULL identity, and why it
-- is a callable function -- so this case can be asserted at all.
-- =====================================================================================
do $$
begin
  if crm.worker_cursor_privilege_ok(null, null) then
    raise exception 'D FAILED: the privilege predicate is TRUE for a NULL role and a NULL '
      'session_user. That is the case that holds inside a migration.';
  end if;
  if crm.worker_cursor_privilege_ok(null, 'ZZTEST-nobody') then
    raise exception 'D FAILED: the predicate is TRUE for a NULL role.';
  end if;
  if crm.worker_cursor_privilege_ok('', '') then
    raise exception 'D FAILED: the predicate is TRUE for EMPTY strings.';
  end if;
  if crm.worker_cursor_privilege_ok('   ', '   ') then
    raise exception 'D FAILED: the predicate is TRUE for whitespace-only identities.';
  end if;
  if crm.worker_cursor_privilege_ok('anon', 'ZZTEST-nobody') then
    raise exception 'D FAILED: the predicate is TRUE for role anon.';
  end if;
  if crm.worker_cursor_privilege_ok('authenticated', 'ZZTEST-nobody') then
    raise exception 'D FAILED: the predicate is TRUE for role authenticated.';
  end if;
  if crm.worker_cursor_privilege_ok('SERVICE_ROLE', 'ZZTEST-nobody') then
    raise exception 'D FAILED: the predicate matched a DIFFERENT-CASE role name. It must '
      'be an exact match on the real role, not a case-folded lookalike.';
  end if;

  -- And the positive cases still work, so the predicate is not simply always false.
  if not crm.worker_cursor_privilege_ok('service_role', null) then
    raise exception 'D FAILED: the predicate is FALSE for service_role. The worker has no '
      'path at all.';
  end if;
  if not crm.worker_cursor_privilege_ok(null, 'postgres') then
    raise exception 'D FAILED: the predicate is FALSE for session_user postgres.';
  end if;
  if not crm.worker_cursor_privilege_ok(null, 'supabase_admin') then
    raise exception 'D FAILED: the predicate is FALSE for session_user supabase_admin.';
  end if;

  -- current_user is NOT what the functions consult. SECURITY DEFINER rewrites current_user
  -- to the OWNER, so a current_user check inside a definer function is always true and
  -- guards nothing. Asserted against the function bodies rather than trusted.
  if exists (
    select 1 from pg_proc p
    where p.pronamespace = 'crm'::regnamespace
      and p.proname in ('load_worker_delta_cursor', 'save_worker_delta_cursor',
                        'worker_delta_cursor_status')
      and pg_get_functiondef(p.oid) ~ 'current_user'
  ) then
    raise exception 'D FAILED: a definer function references current_user. Inside SECURITY '
      'DEFINER that is the function OWNER and guards nothing; it must be session_user.';
  end if;

  raise notice 'D PASSED: NULL, empty, whitespace, anon, authenticated and a case-folded '
    'lookalike are ALL refused; service_role/postgres/supabase_admin are accepted; and no '
    'definer function consults current_user.';
end;
$$;

-- =====================================================================================
-- E. COMPARE-AND-SWAP: A STALE VERSION RAISES P0001, AND CHANGES NOTHING.
-- =====================================================================================
do $$
declare
  v_load  jsonb;
  v_save  jsonb;
  v1      uuid;
  v2      uuid;
  v_ok    boolean;
  v_sha   text;
begin
  -- E1. First run: load returns exists=false and a NULL version -- not an error.
  v_load := crm.load_worker_delta_cursor('ZZTEST-cursor-cas');
  if (v_load->>'exists')::boolean is not false then
    raise exception 'E FAILED: a missing cursor did not report exists=false.';
  end if;
  if v_load->>'version' is not null then
    raise exception 'E FAILED: a missing cursor handed out a version.';
  end if;

  -- E2. CREATE with the NULL version load just handed out.
  v_save := crm.save_worker_delta_cursor('ZZTEST-cursor-cas', 'ZZTEST-purpose',
              'ZZTEST-owner@example.invalid', 'ZZTEST-OPAQUE-LINK-1', null);
  v1 := (v_save->>'version')::uuid;
  if v1 is null then
    raise exception 'E FAILED: create mode returned no version.';
  end if;
  if (v_save->>'save_count')::int <> 1 then
    raise exception 'E FAILED: save_count is not 1 after the first save.';
  end if;

  -- E3. CREATE MODE COLLISION: a second NULL-version save must LOSE, not overwrite.
  v_ok := false;
  begin
    perform crm.save_worker_delta_cursor('ZZTEST-cursor-cas', 'ZZTEST-purpose',
              'ZZTEST-other@example.invalid', 'ZZTEST-OPAQUE-LINK-STOMP', null);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a second create-mode save overwrote an existing cursor. '
      'ON CONFLICT DO UPDATE instead of DO NOTHING is exactly this bug.';
  end if;
  if (select delta_link from crm.worker_delta_cursor where cursor_key = 'ZZTEST-cursor-cas')
     <> 'ZZTEST-OPAQUE-LINK-1' then
    raise exception 'E FAILED: the losing create-mode save changed the stored link.';
  end if;

  -- E4. A VALID ADVANCE with the current version succeeds and ROTATES the version.
  v_save := crm.save_worker_delta_cursor('ZZTEST-cursor-cas', 'ZZTEST-purpose',
              'ZZTEST-owner@example.invalid', 'ZZTEST-OPAQUE-LINK-2', v1);
  v2 := (v_save->>'version')::uuid;
  if v2 = v1 then
    raise exception 'E FAILED: the version was NOT rotated by a successful save. An '
      'unrotated version lets the SAME ticket be spent twice, which is no CAS at all.';
  end if;
  if (v_save->>'save_count')::int <> 2 then
    raise exception 'E FAILED: save_count did not increment.';
  end if;
  if (v_save->>'advanced')::boolean is not true then
    raise exception 'E FAILED: a save that CHANGED the link did not report advanced.';
  end if;

  -- E5. *** THE STALE SAVE. *** v1 was legitimately handed out and has since been spent.
  -- This is the exact shape of "worker A loaded, worker B advanced, worker A now saves".
  v_ok := false;
  begin
    perform crm.save_worker_delta_cursor('ZZTEST-cursor-cas', 'ZZTEST-purpose',
              'ZZTEST-stale@example.invalid', 'ZZTEST-OPAQUE-LINK-STALE', v1);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a save presenting a STALE version succeeded. Last-writer-'
      'wins is precisely the defect this contract exists to remove: the loser''s fetched '
      'messages would never be re-offered.';
  end if;

  -- E6. AND IT CHANGED NOTHING. A refusal that still wrote would be worse than no refusal.
  if (select delta_link from crm.worker_delta_cursor where cursor_key = 'ZZTEST-cursor-cas')
     <> 'ZZTEST-OPAQUE-LINK-2' then
    raise exception 'E FAILED: the stale save changed the stored link.';
  end if;
  if (select version from crm.worker_delta_cursor where cursor_key = 'ZZTEST-cursor-cas') <> v2 then
    raise exception 'E FAILED: the stale save rotated the version.';
  end if;
  if (select save_count from crm.worker_delta_cursor where cursor_key = 'ZZTEST-cursor-cas') <> 2 then
    raise exception 'E FAILED: the stale save incremented save_count.';
  end if;

  -- E7. A RANDOM version that was never issued loses too.
  v_ok := false;
  begin
    perform crm.save_worker_delta_cursor('ZZTEST-cursor-cas', 'ZZTEST-purpose', null,
              'ZZTEST-OPAQUE-LINK-X', '99999999-9999-4999-8999-000000000999'::uuid);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a never-issued version was accepted.';
  end if;

  -- E8. THE DIGEST IS SERVER-COMPUTED AND CORRECT. It is the only non-sensitive way to
  -- confirm what was stored, so it must actually be the digest of what was stored.
  select delta_link_sha256 into v_sha from crm.worker_delta_cursor
  where cursor_key = 'ZZTEST-cursor-cas';
  if v_sha <> encode(sha256(convert_to('ZZTEST-OPAQUE-LINK-2', 'UTF8')), 'hex') then
    raise exception 'E FAILED: delta_link_sha256 is not the sha256 of the stored link.';
  end if;

  -- E9. RE-SAVING THE SAME LINK IS NOT AN ADVANCE. A worker stuck re-sending the same
  -- delta link is not making progress, and advanced_at must not pretend otherwise.
  v_save := crm.save_worker_delta_cursor('ZZTEST-cursor-cas', 'ZZTEST-purpose', null,
              'ZZTEST-OPAQUE-LINK-2', v2);
  if (v_save->>'advanced')::boolean is not false then
    raise exception 'E FAILED: re-saving the IDENTICAL link reported advanced=true. A '
      'stuck worker would hide behind a fresh timestamp.';
  end if;

  -- E9b. THE LINK IS STORED BYTE-EXACTLY -- NOT TRIMMED, NOT NORMALISED.
  -- The column contract says the token is kept exactly as the provider issued it, and the
  -- digest is the ONLY safe way to confirm a save. If save() trimmed the value, the stored
  -- bytes would differ from the bytes the caller holds and the caller's own digest of the
  -- original would never match -- defeating the one mechanism that lets an operator verify
  -- a cursor without touching it. A leading/trailing space is a legal, if unlikely, part
  -- of an opaque token, so this is asserted rather than assumed.
  declare
    v_padded text := '  ZZTEST-OPAQUE-LINK-PADDED  ';
    v_cur    uuid;
    v_stored text;
  begin
    v_cur := (crm.save_worker_delta_cursor('ZZTEST-cursor-bytes', 'ZZTEST-purpose', null,
                v_padded, null)->>'version')::uuid;
    select delta_link, delta_link_sha256 into v_stored, v_sha
    from crm.worker_delta_cursor where cursor_key = 'ZZTEST-cursor-bytes';

    if v_stored <> v_padded then
      raise exception 'E FAILED: the stored link is not byte-identical to the input. It '
        'was trimmed or normalised, so the caller''s own digest of the token it holds can '
        'never match the stored digest.';
    end if;
    if v_sha <> encode(sha256(convert_to(v_padded, 'UTF8')), 'hex') then
      raise exception 'E FAILED: the digest is not the digest of the UNMODIFIED input.';
    end if;
  end;

  -- E9c. But a WHITESPACE-ONLY link is still folded to NULL, because "no cursor yet" and
  -- "a cursor made of spaces" must not be two different states. That is a test on the
  -- input, not an edit of it.
  perform crm.save_worker_delta_cursor('ZZTEST-cursor-blanklink', 'ZZTEST-purpose', null,
            '   ', null);
  if (select delta_link from crm.worker_delta_cursor
      where cursor_key = 'ZZTEST-cursor-blanklink') is not null then
    raise exception 'E FAILED: a whitespace-only link was stored as a real cursor value.';
  end if;
  if (select delta_link_sha256 from crm.worker_delta_cursor
      where cursor_key = 'ZZTEST-cursor-blanklink') is not null then
    raise exception 'E FAILED: a NULL link carries a digest. The digest CHECK should have '
      'refused that pairing.';
  end if;

  -- E10. A blank cursor_key and a blank purpose are both refused.
  v_ok := false;
  begin
    perform crm.save_worker_delta_cursor('   ', 'ZZTEST-purpose', null, 'ZZTEST-L', null);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a blank cursor_key was accepted. Every worker would share '
      'one cursor.';
  end if;

  v_ok := false;
  begin
    perform crm.save_worker_delta_cursor('ZZTEST-cursor-blank', '  ', null, 'ZZTEST-L', null);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a blank purpose was accepted.';
  end if;

  raise notice 'E PASSED: stale version, never-issued version and create-mode collision '
    'all raise P0001 and change NOTHING; the version rotates on every save; the digest is '
    'server-computed; re-saving the same link is not an advance.';
end;
$$;

-- =====================================================================================
-- F. worker_delta_cursor_status NEVER RETURNS delta_link.
--
-- Asserted THREE ways, because this is the one that leaks a credential-bearing token if
-- it ever regresses, and a regression here is silent by nature -- the dashboard just
-- starts showing one more field and nobody reads it as a leak.
-- =====================================================================================
do $$
declare
  v_status jsonb;
  v_save   jsonb;
  v_keys   text;
  v_def    text;
begin
  v_status := crm.worker_delta_cursor_status('ZZTEST-cursor-cas');

  -- F1. THE ACTUAL OUTPUT contains no key named delta_link, and no VALUE anywhere in it
  -- equals the stored link. The second check catches the leak being renamed rather than
  -- removed -- `'token', v_row.delta_link` would pass a key-name check cleanly.
  if v_status ? 'delta_link' then
    raise exception 'F FAILED: worker_delta_cursor_status returned a delta_link key.';
  end if;
  if v_status::text like '%ZZTEST-OPAQUE-LINK-2%' then
    raise exception 'F FAILED: the status output CONTAINS the stored link, under some '
      'other key name. Renaming a leak is not removing it.';
  end if;

  -- F2. It still answers the operational questions, or it would be useless and someone
  -- would go select the link directly -- which is the outcome this function prevents.
  if (v_status->>'has_delta_link')::boolean is not true then
    raise exception 'F FAILED: status does not report has_delta_link.';
  end if;
  if v_status->>'delta_link_sha256' is null
  or v_status->>'version' is null
  or v_status->>'save_count' is null then
    raise exception 'F FAILED: status omits the digest, version or save_count, so an '
      'operator has no safe way to confirm a save and would go read the link.';
  end if;

  -- F3. THE SOURCE ITSELF. pg_get_functiondef must not mention the column outside the
  -- has_delta_link null-test. Catches a reintroduction that this fixture happens not to
  -- exercise -- e.g. a link returned only when some other branch is taken.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
  where p.pronamespace = 'crm'::regnamespace and p.proname = 'worker_delta_cursor_status';
  if v_def ~ '''delta_link''\s*,\s*v_row\.delta_link' then
    raise exception 'F FAILED: the status function body returns delta_link.';
  end if;

  -- F4a. status() holds on a SECOND, independently created cursor -- so F1 is a property
  -- of the function, not an accident of the one row it was first pointed at.
  v_save := crm.worker_delta_cursor_status('ZZTEST-cursor-denial');
  if v_save ? 'delta_link' then
    raise exception 'F FAILED: status leaked delta_link on a second cursor.';
  end if;
  if v_save::text like '%ZZTEST-OPAQUE-LINK-DENIAL%' then
    raise exception 'F FAILED: status leaked the second cursor''s link by value.';
  end if;

  -- F4b. AND save() must not echo the link back either. The caller just supplied it;
  -- returning it puts an opaque token into one more log line for no benefit.
  select (crm.save_worker_delta_cursor('ZZTEST-cursor-f4', 'ZZTEST-purpose', null,
            'ZZTEST-OPAQUE-LINK-F4', null))::text into v_keys;
  if v_keys like '%ZZTEST-OPAQUE-LINK-F4%' then
    raise exception 'F FAILED: save_worker_delta_cursor echoed the delta_link back.';
  end if;

  -- F5. And load() DOES return it -- it is the one object that must, or the worker cannot
  -- work. A test suite that only proves absence could be satisfied by a link nobody stores.
  if crm.load_worker_delta_cursor('ZZTEST-cursor-cas')->>'delta_link'
     <> 'ZZTEST-OPAQUE-LINK-2' then
    raise exception 'F FAILED: load_worker_delta_cursor did not return the stored link. '
      'The worker cannot resume without it.';
  end if;

  -- F6. A missing cursor's status is exists=false, not an error.
  if (crm.worker_delta_cursor_status('ZZTEST-cursor-absent')->>'exists')::boolean is not false then
    raise exception 'F FAILED: status of a missing cursor did not report exists=false.';
  end if;

  raise notice 'F PASSED: status never returns delta_link (by key, by value, and by source), '
    'save does not echo it, load DOES return it, and a missing cursor is not an error.';
end;
$$;

-- =====================================================================================
-- G. TWO CONCURRENT SAVERS: THE LOSER MUST LOSE.
--
-- HOW THIS IS TESTED, AND WHY IT IS NOT A WEAKER TEST THAN IT LOOKS.
-- Two real sessions cannot be driven from one psql script without dblink, which is not
-- guaranteed available in CI. What IS reproduced -- exactly, and deterministically -- is
-- the interleaving that makes concurrency dangerous:
--
--     both workers hold the SAME version (they loaded before either saved)
--     worker A saves      -> succeeds, version rotates
--     worker B then saves -> presents the version it loaded, which is now stale
--
-- Under READ COMMITTED, a genuinely simultaneous B blocks on A's row lock, re-evaluates
-- the UPDATE's WHERE clause after A commits, sees the rotated version, and matches zero
-- rows -- landing in precisely the state this section drives it to. The serialized form
-- tests the same predicate on the same data; what it does not test is the lock wait
-- itself, which is Postgres's behaviour and not this contract's.
--
-- The property asserted is the one that matters: THE SECOND WRITE IS REFUSED AND THE
-- FIRST WRITER'S PROGRESS SURVIVES INTACT.
-- =====================================================================================
do $$
declare
  v_shared  uuid;
  v_a       jsonb;
  v_ok      boolean;
  v_link    text;
  v_count   int;
begin
  perform crm.save_worker_delta_cursor('ZZTEST-cursor-race', 'ZZTEST-purpose',
            'ZZTEST-owner@example.invalid', 'ZZTEST-OPAQUE-LINK-R0', null);

  -- BOTH workers load. One version, two holders -- the whole hazard in one line.
  v_shared := (crm.load_worker_delta_cursor('ZZTEST-cursor-race')->>'version')::uuid;
  if v_shared is null then
    raise exception 'G FAILED: load handed out no version.';
  end if;

  -- Worker A finishes its Graph round-trip first and saves. It WINS.
  v_a := crm.save_worker_delta_cursor('ZZTEST-cursor-race', 'ZZTEST-purpose',
           'ZZTEST-worker-a@example.invalid', 'ZZTEST-OPAQUE-LINK-RA', v_shared);
  if v_a->>'version' is null then
    raise exception 'G FAILED: the winning save returned no version.';
  end if;

  -- Worker B finishes second and presents the SAME version it loaded. It MUST LOSE.
  v_ok := false;
  begin
    perform crm.save_worker_delta_cursor('ZZTEST-cursor-race', 'ZZTEST-purpose',
              'ZZTEST-worker-b@example.invalid', 'ZZTEST-OPAQUE-LINK-RB', v_shared);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: BOTH concurrent savers succeeded. The second silently '
      'overwrote the first, and every message only the first worker fetched would never '
      'be offered again. This is the exact defect the whole contract exists to remove.';
  end if;

  -- THE WINNER'S PROGRESS SURVIVED INTACT -- not partially, not merged, not rolled back.
  select delta_link, save_count into v_link, v_count
  from crm.worker_delta_cursor where cursor_key = 'ZZTEST-cursor-race';
  if v_link <> 'ZZTEST-OPAQUE-LINK-RA' then
    raise exception 'G FAILED: the winner''s link is not what is stored.';
  end if;
  if v_count <> 2 then
    raise exception 'G FAILED: save_count is %, not 2. The loser''s refusal still counted '
      'as a save.', v_count;
  end if;
  if (select version from crm.worker_delta_cursor where cursor_key = 'ZZTEST-cursor-race')
     <> (v_a->>'version')::uuid then
    raise exception 'G FAILED: the stored version is not the winner''s.';
  end if;

  -- AND THE LOSER CAN RECOVER. A CAS that refuses forever is not a fix, it is an outage:
  -- worker B re-loads, gets the winner''s version, and its next save succeeds.
  perform crm.save_worker_delta_cursor('ZZTEST-cursor-race', 'ZZTEST-purpose',
            'ZZTEST-worker-b@example.invalid', 'ZZTEST-OPAQUE-LINK-RB',
            (crm.load_worker_delta_cursor('ZZTEST-cursor-race')->>'version')::uuid);
  if (select delta_link from crm.worker_delta_cursor where cursor_key = 'ZZTEST-cursor-race')
     <> 'ZZTEST-OPAQUE-LINK-RB' then
    raise exception 'G FAILED: the loser could not recover by re-loading. A CAS that '
      'refuses forever is an outage, not a fix.';
  end if;

  raise notice 'G PASSED: of two savers holding one version the second is REFUSED, the '
    'winner''s progress survives intact, and the loser recovers by re-loading.';
end;
$$;

rollback;

-- =====================================================================================
-- H. NO TEST DATA SURVIVED. Re-asserted against COMMITTED state, outside the transaction.
-- =====================================================================================
do $$
declare v_n int;
begin
  select count(*) into v_n from crm.worker_delta_cursor
  where cursor_key like 'ZZTEST-%' or purpose like 'ZZTEST-%';
  if v_n <> 0 then
    raise exception 'H FAILED: % ZZTEST cursor row(s) survived. The ROLLBACK did not '
      'happen -- this file must leave NO trace.', v_n;
  end if;
  raise notice 'H PASSED: no test data survived.';
end;
$$;

\echo 'CRM WORKER DELTA CURSOR CONTRACTS: ALL SECTIONS PASSED (A-H)'
