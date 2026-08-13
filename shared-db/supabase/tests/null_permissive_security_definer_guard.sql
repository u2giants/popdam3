-- Contract tests for 20260813030000_null_permissive_security_definer_guard_fix.sql
-- (issue #861 -- the NULL-permissive SECURITY DEFINER guard).
--
-- Rollback-safe. Writes NOTHING: every authorised call is aimed at an argument
-- combination that fails a POST-GUARD validation, so the test can prove "the guard
-- let this caller through" without inserting or updating a single row.
--
-- WHY THE NULL CASE IS THE WHOLE POINT
-- ------------------------------------
-- The broken guard was:
--     if not (app.has_role('administrator') or auth.role() = 'service_role') then
-- Under a WRONG-but-present role ('authenticated') that expression is
--     not (false or false) = true
-- so the raise fires and a wrong-role test PASSES AGAINST THE BROKEN FORM and proves
-- nothing. Only a NULL `auth.role()` distinguishes the two:
--     not (false or NULL) = NULL, and `IF NULL` is not true -> the raise is SKIPPED.
-- Section A executes that arithmetic against a scratch copy of the OLD shape so the
-- suite itself demonstrates, on every CI run, that section B is a meaningful test and
-- not a tautology.
--
-- Sections:
--   A. The OLD shape ADMITS a NULL-role caller; the NEW shape DENIES it.
--   B. All four functions REJECT a session with no JWT claims (auth.role() IS NULL).
--   C. All four functions REJECT a present-but-wrong role ('authenticated').
--   D. administrator and service_role are STILL ADMITTED (the guard is not now
--      over-tight): the call gets past the guard and fails a later validation.
--   E. Static assertion: no live prosrc still contains the null-permissive shape.

begin;

do $$
declare
  v_role_seen  text;
  v_admitted   boolean;
  v_failed     text := '';
  v_sqlstate   text;
  v_src        text;
  v_fn         text;
  v_claims_admin   text := '{"role":"authenticated","app_metadata":{"roles":["administrator"]}}';
  v_claims_wrong   text := '{"role":"authenticated","app_metadata":{"roles":["viewer"]}}';
  v_claims_service text := '{"role":"service_role"}';
begin
  -- ==========================================================================
  -- A. The old shape admits a NULL role; the new shape denies it.
  -- ==========================================================================
  perform set_config('request.jwt.claims', null, true);
  v_role_seen := auth.role();

  if v_role_seen is not null then
    raise exception
      'A0. FAIL - this test needs auth.role() to be NULL with no claims set, got %',
      v_role_seen;
  end if;
  raise notice 'A0. PASS - with no JWT claims, auth.role() is NULL (the exploitable session shape)';

  -- A1. A scratch copy of the EXACT pre-fix guard. It must NOT raise. If this
  --     assertion ever starts failing, the premise of issue #861 has changed and
  --     section B has stopped being a meaningful test -- read this file again.
  create function pg_temp.legacy_shape_guard() returns text
  language plpgsql as $legacy$
  begin
    if not (app.has_role('administrator') or auth.role() = 'service_role') then
      raise exception 'legacy_shape_guard: administrator role required'
        using errcode = 'insufficient_privilege';
    end if;
    return 'admitted';
  end;
  $legacy$;

  v_admitted := false;
  begin
    perform pg_temp.legacy_shape_guard();
    v_admitted := true;
  exception when insufficient_privilege then
    v_admitted := false;
  end;

  if not v_admitted then
    v_failed := v_failed || E'\nA1. FAIL - the pre-fix guard shape refused a NULL-role caller. '
      || 'The defect this migration fixes could not be reproduced; do not trust section B.';
  else
    raise notice 'A1. PASS (defect reproduced) - the PRE-FIX guard shape ADMITS a NULL-role caller';
  end if;

  -- A2. The same scratch guard written in the fixed shape must refuse.
  create function pg_temp.fixed_shape_guard() returns text
  language plpgsql as $fixed$
  declare
    v_jwt_role text;
  begin
    begin
      v_jwt_role := nullif(btrim(coalesce(auth.role(), '')), '');
    exception when others then
      v_jwt_role := null;
    end;

    if not (coalesce(app.has_role('administrator'), false)
            or (v_jwt_role is not null and v_jwt_role = 'service_role')) then
      raise exception 'fixed_shape_guard: administrator role required'
        using errcode = 'insufficient_privilege';
    end if;
    return 'admitted';
  end;
  $fixed$;

  v_admitted := false;
  begin
    perform pg_temp.fixed_shape_guard();
    v_admitted := true;
  exception when insufficient_privilege then
    v_admitted := false;
  end;

  if v_admitted then
    v_failed := v_failed || E'\nA2. FAIL - the fixed guard shape ADMITTED a NULL-role caller';
  else
    raise notice 'A2. PASS - the FIXED guard shape DENIES a NULL-role caller';
  end if;

  -- ==========================================================================
  -- B. NULL auth.role() is REJECTED by all four functions.
  --    (claims are already NULL from section A)
  -- ==========================================================================

  -- B1. propose_popsg_property_resolution
  begin
    perform public.propose_popsg_property_resolution(
      gen_random_uuid(), 'B1 null role probe', 'exact_existing');
    v_failed := v_failed || E'\nB1. FAIL - propose_popsg_property_resolution ran with auth.role() NULL';
  exception
    when insufficient_privilege then
      raise notice 'B1. PASS - propose_popsg_property_resolution denies a NULL-role caller';
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      v_failed := v_failed || E'\nB1. FAIL - propose_popsg_property_resolution got PAST the guard '
        || 'with auth.role() NULL and failed later with SQLSTATE ' || v_sqlstate;
  end;

  -- B2. activate_popsg_property_decision_batch
  begin
    perform public.activate_popsg_property_decision_batch(null, null, 0);
    v_failed := v_failed || E'\nB2. FAIL - activate_popsg_property_decision_batch ran with auth.role() NULL';
  exception
    when insufficient_privilege then
      raise notice 'B2. PASS - activate_popsg_property_decision_batch denies a NULL-role caller';
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      v_failed := v_failed || E'\nB2. FAIL - activate_popsg_property_decision_batch got PAST the guard '
        || 'with auth.role() NULL and failed later with SQLSTATE ' || v_sqlstate;
  end;

  -- B3. promote_property_alias_batch
  begin
    perform public.promote_property_alias_batch(
      gen_random_uuid(), 'B3 null role probe', 'sha-not-approved', false, '');
    v_failed := v_failed || E'\nB3. FAIL - promote_property_alias_batch ran with auth.role() NULL';
  exception
    when insufficient_privilege then
      raise notice 'B3. PASS - promote_property_alias_batch denies a NULL-role caller';
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      v_failed := v_failed || E'\nB3. FAIL - promote_property_alias_batch got PAST the guard '
        || 'with auth.role() NULL and failed later with SQLSTATE ' || v_sqlstate;
  end;

  -- B4. approve_licensor_alias
  begin
    perform public.approve_licensor_alias('B4 null role probe', '', '');
    v_failed := v_failed || E'\nB4. FAIL - approve_licensor_alias ran with auth.role() NULL';
  exception
    when insufficient_privilege then
      raise notice 'B4. PASS - approve_licensor_alias denies a NULL-role caller';
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      v_failed := v_failed || E'\nB4. FAIL - approve_licensor_alias got PAST the guard '
        || 'with auth.role() NULL and failed later with SQLSTATE ' || v_sqlstate;
  end;

  -- ==========================================================================
  -- C. A present-but-wrong role is still rejected (this held before the fix too;
  --    it is here so the fix cannot loosen the ordinary path).
  -- ==========================================================================
  perform set_config('request.jwt.claims', v_claims_wrong, true);

  begin
    perform public.propose_popsg_property_resolution(
      gen_random_uuid(), 'C1 wrong role probe', 'exact_existing');
    v_failed := v_failed || E'\nC1. FAIL - propose_popsg_property_resolution admitted role authenticated';
  exception when insufficient_privilege then
    raise notice 'C1. PASS - propose_popsg_property_resolution denies a wrong role';
  end;

  begin
    perform public.activate_popsg_property_decision_batch('c2', 'c2', 0);
    v_failed := v_failed || E'\nC2. FAIL - activate_popsg_property_decision_batch admitted role authenticated';
  exception when insufficient_privilege then
    raise notice 'C2. PASS - activate_popsg_property_decision_batch denies a wrong role';
  end;

  begin
    perform public.promote_property_alias_batch(
      gen_random_uuid(), 'C3', 'sha', false, '');
    v_failed := v_failed || E'\nC3. FAIL - promote_property_alias_batch admitted role authenticated';
  exception when insufficient_privilege then
    raise notice 'C3. PASS - promote_property_alias_batch denies a wrong role';
  end;

  begin
    perform public.approve_licensor_alias('C4', '', '');
    v_failed := v_failed || E'\nC4. FAIL - approve_licensor_alias admitted role authenticated';
  exception when insufficient_privilege then
    raise notice 'C4. PASS - approve_licensor_alias denies a wrong role';
  end;

  -- ==========================================================================
  -- D. The authorised paths STILL WORK.
  --
  --    Each call below is deliberately invalid AFTER the guard, so "admitted"
  --    is proved by the call failing with the LATER errcode rather than with
  --    insufficient_privilege. Nothing is written.
  -- ==========================================================================

  -- D1..D4: administrator (via app_metadata.roles).
  perform set_config('request.jwt.claims', v_claims_admin, true);

  if not app.has_role('administrator') then
    v_failed := v_failed || E'\nD0. FAIL - administrator claims did not produce app.has_role(administrator)';
  else
    raise notice 'D0. PASS - administrator claims resolve through app.has_role()';
  end if;

  begin
    perform public.propose_popsg_property_resolution(gen_random_uuid(), '   ', 'exact_existing');
    v_failed := v_failed || E'\nD1. FAIL - propose_popsg_property_resolution accepted a blank observation';
  exception
    when insufficient_privilege then
      v_failed := v_failed || E'\nD1. FAIL - administrator was REFUSED by propose_popsg_property_resolution';
    when check_violation then
      raise notice 'D1. PASS - administrator passes the guard (blocked later by the blank-observation rule)';
  end;

  begin
    perform public.activate_popsg_property_decision_batch(null, null, 0);
    v_failed := v_failed || E'\nD2. FAIL - activate_popsg_property_decision_batch accepted null batch id/hash';
  exception
    when insufficient_privilege then
      v_failed := v_failed || E'\nD2. FAIL - administrator was REFUSED by activate_popsg_property_decision_batch';
    when null_value_not_allowed then
      raise notice 'D2. PASS - administrator passes the guard (blocked later by the required batch id/hash)';
  end;

  begin
    perform public.promote_property_alias_batch(gen_random_uuid(), 'D3', 'sha', false, 'tester');
    v_failed := v_failed || E'\nD3. FAIL - promote_property_alias_batch accepted an uncertified promotion';
  exception
    when insufficient_privilege then
      v_failed := v_failed || E'\nD3. FAIL - administrator was REFUSED by promote_property_alias_batch';
    when check_violation then
      raise notice 'D3. PASS - administrator passes the guard (blocked later by the certification rule)';
  end;

  begin
    perform public.approve_licensor_alias('D4', '', '');
    v_failed := v_failed || E'\nD4. FAIL - approve_licensor_alias accepted a blank approver';
  exception
    when insufficient_privilege then
      v_failed := v_failed || E'\nD4. FAIL - administrator was REFUSED by approve_licensor_alias';
    when null_value_not_allowed then
      raise notice 'D4. PASS - administrator passes the guard (blocked later by the approver/evidence rule)';
  end;

  -- D5..D8: service_role.
  perform set_config('request.jwt.claims', v_claims_service, true);

  begin
    perform public.propose_popsg_property_resolution(gen_random_uuid(), '   ', 'exact_existing');
    v_failed := v_failed || E'\nD5. FAIL - propose_popsg_property_resolution accepted a blank observation';
  exception
    when insufficient_privilege then
      v_failed := v_failed || E'\nD5. FAIL - service_role was REFUSED by propose_popsg_property_resolution';
    when check_violation then
      raise notice 'D5. PASS - service_role passes the guard';
  end;

  begin
    perform public.activate_popsg_property_decision_batch(null, null, 0);
    v_failed := v_failed || E'\nD6. FAIL - activate_popsg_property_decision_batch accepted null batch id/hash';
  exception
    when insufficient_privilege then
      v_failed := v_failed || E'\nD6. FAIL - service_role was REFUSED by activate_popsg_property_decision_batch';
    when null_value_not_allowed then
      raise notice 'D6. PASS - service_role passes the guard';
  end;

  begin
    perform public.promote_property_alias_batch(gen_random_uuid(), 'D7', 'sha', false, 'tester');
    v_failed := v_failed || E'\nD7. FAIL - promote_property_alias_batch accepted an uncertified promotion';
  exception
    when insufficient_privilege then
      v_failed := v_failed || E'\nD7. FAIL - service_role was REFUSED by promote_property_alias_batch';
    when check_violation then
      raise notice 'D7. PASS - service_role passes the guard';
  end;

  begin
    perform public.approve_licensor_alias('D8', '', '');
    v_failed := v_failed || E'\nD8. FAIL - approve_licensor_alias accepted a blank approver';
  exception
    when insufficient_privilege then
      v_failed := v_failed || E'\nD8. FAIL - service_role was REFUSED by approve_licensor_alias';
    when null_value_not_allowed then
      raise notice 'D8. PASS - service_role passes the guard';
  end;

  perform set_config('request.jwt.claims', null, true);

  -- ==========================================================================
  -- E. Static assertion against the LIVE bodies. A future edit that reintroduces
  --    the shape is caught here even if it somehow still passed section B.
  -- ==========================================================================
  for v_fn, v_src in
    select p.oid::regprocedure::text, p.prosrc
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'propose_popsg_property_resolution',
         'activate_popsg_property_decision_batch',
         'promote_property_alias_batch',
         'approve_licensor_alias')
  loop
    if v_src ~ 'not\s*\(\s*app\.has_role\(''administrator''\)\s*or\s*auth\.role\(\)\s*=\s*''service_role''\s*\)' then
      v_failed := v_failed || E'\nE. FAIL - ' || v_fn || ' still carries the null-permissive guard shape';
    end if;
  end loop;

  if v_failed = '' then
    raise notice '';
    raise notice 'ALL #861 NULL-PERMISSIVE GUARD TESTS PASSED';
  else
    raise exception '#861 guard tests FAILED:%', v_failed;
  end if;
end;
$$;

rollback;
