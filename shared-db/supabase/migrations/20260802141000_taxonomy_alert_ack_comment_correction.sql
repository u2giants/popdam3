-- =====================================================================================
-- Forward-only correction to the function comments added by 20260802140000.
--
-- WHY A SECOND FILE AND NOT AN EDIT.
-- 20260802140000 is already applied to preview. Supabase's ledger keys on the VERSION, so
-- editing that file would change the repository without changing the database and leave the
-- two permanently out of step — the exact desync AGENTS.md §4 rule 4 forbids. Every fix is
-- FORWARD.
--
-- WHAT WAS WRONG.
-- 20260802140000's comment on the public wrapper asserted that a caller lacking "UPDATE on
-- plm.taxonomy_sync_alert and USAGE on schema plm" cannot use it. Behavioural verification on
-- preview (2026-08-02 13:13 UTC / 09:13 America/New_York) found that `authenticated` DOES
-- hold USAGE on schema plm — a PRE-EXISTING grant, unrelated to and unchanged by this work.
-- The wrapper is still unreachable by `authenticated`, but by three OTHER guards, and a
-- future reader must not be told the schema-USAGE one is doing work it is not.
--
-- VERIFIED PRIVILEGE FACTS ON PREVIEW (has_*_privilege, not assumption):
--   anon          EXECUTE on public.acknowledge_taxonomy_sync_alert  -> false
--   authenticated EXECUTE on public.acknowledge_taxonomy_sync_alert  -> false
--   service_role  EXECUTE on public.acknowledge_taxonomy_sync_alert  -> true
--   authenticated UPDATE  on plm.taxonomy_sync_alert                 -> false
--   authenticated USAGE   on schema plm                              -> TRUE  (pre-existing)
-- and, behaviourally, a request arriving with auth.role() = 'authenticated' or 'anon' is
-- refused by plm.assert_taxonomy_alert_ack_authority() with
-- "acknowledging a taxonomy sync alert is not permitted for request role <role>".
--
-- No function body, signature, grant or behaviour changes here. Comments only.
-- =====================================================================================

comment on function public.acknowledge_taxonomy_sync_alert(uuid, jsonb) is
  'service_role-facing wrapper for plm.acknowledge_taxonomy_sync_alert. SECURITY INVOKER, so no privilege escalation path exists. Three independent guards keep browser roles out, verified on preview 2026-08-02: (1) EXECUTE is revoked from anon and authenticated; (2) UPDATE on plm.taxonomy_sync_alert is granted only to postgres and service_role; (3) plm.assert_taxonomy_alert_ack_authority() refuses any request whose auth.role() is present but not in {postgres, service_role, supabase_admin}. NOTE: authenticated DOES hold USAGE on schema plm (a pre-existing grant) — schema USAGE is NOT one of the guards, despite what the original 20260802140000 comment implied.';

comment on function plm.acknowledge_taxonomy_sync_alert(uuid, jsonb) is
  'The ONLY supported way to set plm.taxonomy_sync_alert.acknowledged_at. Requires actor_type (''human''|''automation''), actor, a >=20 character reason, and — for automation — the named human it acts for. Stores a prefixed, function-constructed acknowledged_by (human:… / automation:… (on behalf of human:…)) so an automated acknowledger can never be mistaken for a person, the way plm.taxonomy_circuit_breaker.reset_by was. Append-only: the payload is merged, the row is never deleted, and re-acknowledging RAISES rather than overwriting. SECURITY INVOKER, so the UPDATE grant on plm.taxonomy_sync_alert is the primary guard and plm.assert_taxonomy_alert_ack_authority() is defence in depth. It can acknowledge ANY alert by design — an operator must be able to close a genuine alert after handling it; the safety property is that nothing can be closed anonymously, silently, or without a stated reason.';
