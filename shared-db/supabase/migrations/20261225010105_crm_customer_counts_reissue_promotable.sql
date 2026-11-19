-- Promotable re-issue of api.crm_customer_counts (one-pass shape).
-- Claim: popcrm-web issue #57, comment 7000442432 (the object's claim thread),
-- folded into popcre/shared-db#6820 (CRM audit fixes batch), comment
-- 7010998738 (2026-11-19). Version 20261225010105 reserved atomically
-- (refs/db-claims).
--
-- WHY A RE-ISSUE: the batch (20261223010101-05, PR #6818) and its fix-forward
-- (20261225010001/10003/10004, PR #6836) were rehearsed on preview outside the
-- dispatch lane, so preview's ledger holds those versions while NO dispatched
-- preview run exists for any of them; historical_preview_original_run_map has
-- nothing to name and the recovery gate's digest proof can never pass. The
-- plain preview apply is refused by the never-reapply guard (runs 44532807597,
-- 44533994147, 44535389768) and production apply stays skipped. The
-- stranded-promotion repair route is fix-forward under a new version; this is
-- it, scoped to this claim's own object.
--
-- CONTENT: byte-identical re-issue of the approved one-pass function from
-- 20261225010004 (the final shape after review findings #6819/#6837: top-relation
-- attribution computed once per contact, hash aggregates, one scan each).
-- Preview: no-op (same shape already rehearsed). Production: creates the
-- server-side counts function that popcrm-web CustomersPage consumes.
--
-- This file writes the whole function body from scratch, so it depends on
-- no earlier rewrite and declares no base (issue #1608 gate: the named
-- strands sit in no ledger outside preview and can never be bases).
-- derived-from: none

create or replace function api.crm_customer_counts()
returns table (
  customer_id uuid,
  contact_count bigint,
  program_count bigint
)
language plpgsql
stable
security definer
set search_path = 'app', 'core', 'crm', 'public'
as $$
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
  with contact_top as (
    select ct.id as contact_id, t.company_id as company_id
    from core.contact ct
    left join lateral (
      select x.company_id
      from core.contact_company x
      where x.contact_id = ct.id
      order by x.is_primary desc nulls last, x.id
      limit 1
    ) t on true
    where not exists (
      select 1 from crm.contact_ext xe
      where xe.contact_id = ct.id and xe.archived_at is not null
    )
  ),
  contacts_per_customer as (
    select company_id, count(*) as n from contact_top group by company_id
  ),
  programs_per_customer as (
    select o.company_id, count(*) as n
    from crm.opportunity o
    where coalesce(o.status, '') <> 'archived'
    group by o.company_id
  )
  select c.id,
         coalesce(cp.n, 0),
         coalesce(pp.n, 0)
  from core.customer c
  left join contacts_per_customer cp on cp.company_id = c.id
  left join programs_per_customer pp on pp.company_id = c.id
  where not exists (
    select 1 from crm.customer_ext xe
    where xe.customer_id = c.id and xe.archived_at is not null
  );
end;
$$;

revoke all on function api.crm_customer_counts() from public;
revoke all on function api.crm_customer_counts() from anon;
revoke all on function api.crm_customer_counts() from authenticated;
grant execute on function api.crm_customer_counts() to authenticated;

comment on function api.crm_customer_counts() is
  'CRM per-customer counts, one lateral pass. contact_count mirrors api.crm_contact_list exactly: a contact counts for the customer of its TOP core.contact_company row (is_primary desc, id, any relationship_type), excluding CRM-archived contacts; program_count = non-archived crm.opportunity rows. One row per non-archived customer. Hard-gated on app.has_app_access(''crm'').';
