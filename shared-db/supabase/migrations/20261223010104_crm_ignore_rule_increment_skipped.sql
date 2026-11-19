-- Atomic ignore-rule skip counter.
-- Claim: popcrm-web issue #69, comment 7000445808 (2026-11-19).
-- Object: new function crm.increment_ignore_rule_emails_skipped(uuid, integer).
--
-- The popcrm-web worker increments crm.ignore_rule.emails_skipped as
-- read-modify-write (fetch row, add in JS, update), so two concurrent worker
-- passes lose counts (popcrm-web #69, fix_bugs.md item F). This function makes
-- the increment one atomic UPDATE inside the database.
--
-- Schema crm, NOT api: the consumer is the host worker's service_role key, the
-- crm.worker_delta_cursor function pattern (20260812010000) -- no browser role
-- ever calls it, so it is not exposed through the api schema. crm.ignore_rule
-- has no updated_at column (verified 2026-11-19), so nothing else is touched.
--
-- greatest(coalesce(p_n,1),0): a null or negative argument can never DECREASE
-- the counter -- this function only ever adds.
-- derived-from: none
-- (the grant pattern follows 20260812010000).

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
