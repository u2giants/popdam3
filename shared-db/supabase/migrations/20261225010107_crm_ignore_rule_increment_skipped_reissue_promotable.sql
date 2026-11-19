-- Promotable re-issue of crm.increment_ignore_rule_emails_skipped.
-- Claim: popcrm-web issue #69, comment 7000445808 (the object's claim thread),
-- folded into popcre/shared-db#6820 (CRM audit fixes batch), comment
-- 7010998738 (2026-11-19). Version 20261225010107 reserved atomically
-- (refs/db-claims).
--
-- WHY A RE-ISSUE: 20261223010104 (PR #6818) was rehearsed on preview outside
-- the dispatch lane, so preview's ledger holds the version while NO dispatched
-- preview run exists for it; the historical-recovery gate can never prove it
-- and the never-reapply guard refuses a fresh preview apply (runs 44532807597,
-- 44533994147, 44535389768). Stranded-promotion repair: fix-forward under a
-- new version, scoped to this claim's own object.
--
-- CONTENT: byte-identical re-issue of the atomic skip-counter function from
-- 20261223010104 (service_role only, never decreases). Preview: no-op (same
-- shape already rehearsed). Production: creates it for the popcrm-web worker.
--
-- CREATE OR REPLACE of a self-contained function body: written from
-- scratch, no earlier rewrite dependency, no declared base.
-- derived-from: none

create or replace function crm.increment_ignore_rule_emails_skipped(
  p_rule_id uuid,
  p_n integer default 1
)
returns void
language plpgsql
security definer
set search_path = 'app', 'core', 'crm', 'public'
as $$
begin
  update crm.ignore_rule
     set emails_skipped = emails_skipped + greatest(coalesce(p_n, 1), 0)
   where id = p_rule_id;
end;
$$;

revoke all on function crm.increment_ignore_rule_emails_skipped(uuid, integer) from public;
revoke all on function crm.increment_ignore_rule_emails_skipped(uuid, integer) from anon;
revoke all on function crm.increment_ignore_rule_emails_skipped(uuid, integer) from authenticated;
grant execute on function crm.increment_ignore_rule_emails_skipped(uuid, integer) to service_role;

comment on function crm.increment_ignore_rule_emails_skipped(uuid, integer) is
'Atomic crm.ignore_rule.emails_skipped increment for the popcrm-web worker (service_role only): adds greatest(coalesce(p_n,1),0), never decreases. Replaces the read-modify-write that lost counts under concurrency.';
