-- Rewrite api.crm_customer_counts to compute each contact's top relation
-- exactly once.
-- Claim: popcre/shared-db#6819 / #6837 (PR #6836 follow-up; found by running
-- the contract test against preview).
--
-- The 20261225010001 shape evaluated the top-relation lateral subquery per
-- (contact, customer) pair, which is quadratic and does not finish on real
-- volumes (the contract test itself timed out calling the function on
-- preview). This rewrite computes the per-contact attribution once in a
-- single lateral pass, aggregates both counts with hash aggregates, and
-- joins them to the customer list — same semantics (top core.contact_company
-- row by is_primary desc nulls last, id; any relationship_type;
-- crm.contact_ext.archived_at excluded; program_count = non-archived
-- crm.opportunity), one scan each.
--
-- derived-from: 20261225010001

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
