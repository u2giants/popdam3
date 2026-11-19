-- Drop the legacy 14-argument api.crm_update_contact overload.
-- Claim: popcre/shared-db#6819 / #6837 (PR #6836 follow-up found by the
-- contract test run on preview).
--
-- 20261223010101 added p_clear_email/p_clear_phone/p_clear_job_title to
-- api.crm_update_contact. Because CREATE OR REPLACE cannot change a
-- signature, that created a NEW 17-argument function while the original
-- 14-argument overload stayed. Every parameter name of the old overload
-- exists in the new one, so any named-argument call that does not mention
-- one of the three new flags (exactly how the popcrm-web client calls it on
-- a plain edit, commit ff135e85) is ambiguous between the two shapes and
-- fails with 'function ... is not unique'. The same ambiguity broke the
-- contract test in supabase/tests/crm_update_contact_clear_contracts.sql.
--
-- The 17-argument shape is the only intended one; nothing else in any
-- consumer calls the old overload positionally (grep over the shared-db
-- migrations and the consumer repos finds only named-argument PostgREST
-- calls). Dropping the legacy shape is what 20261106144500 did for its own
-- predecessors' replacement cycles.
--
-- derived-from: 20261223010101

drop function if exists api.crm_update_contact(
  uuid, text, text, text, text, text, text, uuid, uuid, text, text,
  boolean, boolean, boolean, boolean
);
