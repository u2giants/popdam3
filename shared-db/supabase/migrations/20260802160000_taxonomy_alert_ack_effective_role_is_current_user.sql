-- =====================================================================================
-- Forward-only fix: resolve the effective role from `current_user`, not `session_user`.
--
-- WHY A FOURTH FILE. 20260802140000/141000/150000 are applied to preview. The ledger keys on
-- the VERSION, so editing any of them would desync file from database. Every fix is FORWARD.
--
-- THE DEFECT, and how it was found.
-- 20260802150000 adopted GLM 5.2's review fix: a caller holding a machine credential
-- (`service_role`, `supabase_admin`) may not record `actor_type = 'human'`. The check itself
-- was correct. The value it tested was not.
--
-- plm.assert_taxonomy_alert_ack_authority() resolved the effective role as:
--
--     v_effective := coalesce(v_jwt_role, session_user)
--
-- `session_user` is the role that OPENED the connection and does NOT change on `SET ROLE`.
-- So on a direct admin connection that had done `SET LOCAL ROLE service_role`, the effective
-- role still read `postgres`, the binding did not fire, and the call succeeded — recording
-- `acknowledged_by = 'human:John Smith'` for a caller running as `service_role`. Reproduced
-- on preview 2026-08-02 13:26 UTC / 09:26 America/New_York:
--
--     step: reject: service_role claiming actor_type=human
--     got:  RETURNED {... "acknowledged_by": "human:John Smith" ...}      <-- should have raised
--
-- This is the same class of failure as the null-permissive guard the original migration was
-- written against: a check that reads strict, installs cleanly, and never fires. It was NOT
-- caught by reading the SQL — including by an independent model review, which proposed the
-- fix but had no way to see that the value under test was the wrong one. It was caught by
-- ASSERTING THE BEHAVIOUR.
--
-- THE FIX. `current_user` is the role whose privileges Postgres actually checks against the
-- UPDATE, and it DOES follow `SET ROLE`. Under PostgREST it is exactly the request role
-- (`anon` / `authenticated` / `service_role`, since PostgREST issues `SET LOCAL ROLE`). On a
-- direct admin connection it is `postgres`. In every case it is the role that genuinely
-- governs the write, which is precisely what this assertion is supposed to be about.
--
-- Safe because these functions are SECURITY INVOKER: `current_user` is the CALLER's role, not
-- an owner the definer bit substituted in. If either function is ever changed to SECURITY
-- DEFINER this reasoning breaks — `current_user` would become the owner and the assertion
-- would silently pass for everyone. The regression test in
-- tools/taxonomy-alert-acknowledgement.test.mjs pins SECURITY INVOKER for that reason.
--
-- session_user is still RECORDED in payload.acknowledgement.connection — it is useful
-- forensic evidence. It is simply no longer what authority is decided on.
-- =====================================================================================

create or replace function plm.assert_taxonomy_alert_ack_authority()
returns text
language plpgsql
stable
set search_path = plm, public, auth
as $$
declare
  v_jwt_role   text;
  v_effective  text;
  v_allowed    text[] := array['postgres', 'service_role', 'supabase_admin'];
begin
  begin
    v_jwt_role := nullif(btrim(coalesce(auth.role(), '')), '');
  exception when others then
    v_jwt_role := null;
  end;

  if v_jwt_role is not null and not (v_jwt_role = any (v_allowed)) then
    raise exception
      'acknowledging a taxonomy sync alert is not permitted for request role %', v_jwt_role
      using errcode = 'P0001';
  end if;

  -- current_user, NOT session_user: it follows SET ROLE and is the role Postgres checks the
  -- UPDATE against. Valid only because this function is SECURITY INVOKER.
  v_effective := coalesce(v_jwt_role, nullif(btrim(current_user::text), ''));

  if v_effective is null then
    raise exception
      'acknowledging a taxonomy sync alert requires a determinable database role; none was resolved'
      using errcode = 'P0001';
  end if;

  if not (v_effective = any (v_allowed)) then
    raise exception
      'acknowledging a taxonomy sync alert is not permitted for role %', v_effective
      using errcode = 'P0001';
  end if;

  return v_effective;
end;
$$;

comment on function plm.assert_taxonomy_alert_ack_authority() is
  'Defence-in-depth role assertion for alert acknowledgement. Requires a NON-NULL effective role AND a positive allow-list match, and refuses when no role can be resolved. As of 20260802160000 the effective role is resolved from current_user, NOT session_user: session_user does not follow SET ROLE, so a connection that had done SET ROLE service_role still resolved as postgres and escaped the machine-credential binding (reproduced on preview 2026-08-02). Deliberately NOT written as `if not (... or auth.role() = ''service_role'')`, which never fires when auth.role() is NULL. Correct only while the calling function is SECURITY INVOKER — under SECURITY DEFINER, current_user becomes the owner and this assertion would pass for everyone.';

revoke all on function plm.assert_taxonomy_alert_ack_authority() from public;
grant execute on function plm.assert_taxonomy_alert_ack_authority() to service_role;
