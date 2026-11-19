-- CRM contact update: close the 18-argument function's ACL and retire the
-- legacy 15-argument overload — companion of 20261225010406 (final
-- deliverable for popcrm-web #39). Version 20261225010407 reserved atomically
-- (refs/db-claims); same claim thread (#6820).
--
-- Runs AFTER 20261225010406 in the same batch: revokes default PUBLIC
-- execute, grants authenticated only, documents the contract, and drops the
-- pre-batch 15-argument overload (IF EXISTS: already gone on preview,
-- effective on production). Statements are byte-identical to the tail of
-- 20261225010304; together the two files carry its exact executable SQL.
-- No restores-retired-object declaration: in the walked histories no APPLIED
-- version has dropped this name (the 10104/10304 drops are stranded
-- versions), and 20261225010406's create precedes this file, so nothing here
-- references a removed object in either walk.
--
-- derived-from: none

revoke all on function api.crm_update_contact(uuid, text, text, text, text, text, text, uuid, uuid, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public;
revoke all on function api.crm_update_contact(uuid, text, text, text, text, text, text, uuid, uuid, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean) from anon;
grant execute on function api.crm_update_contact(uuid, text, text, text, text, text, text, uuid, uuid, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

comment on function api.crm_update_contact(uuid, text, text, text, text, text, text, uuid, uuid, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean) is
  'CRM contact update. Precedence: p_clear_email / p_clear_phone / p_clear_job_title beat a same-call value (both = clear). Values are normalized like crm_create_contact (email lowercased+trimmed, phone/title trimmed).';

drop function if exists api.crm_update_contact(
  uuid, text, text, text, text, text, text, uuid, uuid, text, text,
  boolean, boolean, boolean, boolean
);
