-- CRM per-customer contact and program counts.
-- Claim: popcrm-web issue #57, comment 7000442432 (2026-11-19).
-- Object: new function api.crm_customer_counts().
--
-- CustomersPage currently downloads EVERY contact and EVERY program just to
-- fill two count columns, and never reads those queries' errors, so a failed
-- fetch renders 0 everywhere (popcrm-web #57). This function returns the same
-- counts server-side in one call.
--
-- Semantics mirror what the CRM screens show, per the current view contract:
--   * customers      = api.crm_customer_list's population: core.customer rows
--                      with no crm.customer_ext.archived_at (20261106144600).
--                      The view applies NO customer_status filter to the 'all'
--                      segment CustomersPage counts, so neither does this.
--   * contact_count  = non-archived contacts holding a 'buyer' relation to the
--                      customer: api.crm_contact_list hides contacts with
--                      crm.contact_ext.archived_at, and every CRM contact
--                      relation is relationship_type='buyer' (verified on
--                      production 2026-11-19: 1055 rows, no other type).
--   * program_count  = crm.opportunity rows for the customer with
--                      coalesce(status,'') <> 'archived', exactly
--                      api.crm_opportunity_list's filter (20261106144600).
--
-- One row per non-archived customer, zeros included: a missing row can only
-- mean the customer left the list, never a failed count.
--
-- derived-from: none
-- (new object; the access-check shape follows api.crm_overview_counts of
--  20260812130000).

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
  select c.id,
         (select count(*)
            from core.contact ct
           where ct.id in (
                   select cc.contact_id
                     from core.contact_company cc
                    where cc.company_id = c.id
                      and cc.relationship_type = 'buyer'
                 )
             and not exists (
                   select 1 from crm.contact_ext xe
                    where xe.contact_id = ct.id and xe.archived_at is not null
                 )) as contact_count,
         (select count(*)
            from crm.opportunity o
           where o.company_id = c.id
             and coalesce(o.status, '') <> 'archived') as program_count
  from core.customer c
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
  'CRM per-customer counts (contact_count = non-archived buyer-related contacts, program_count = non-archived opportunities) for one row per non-archived customer, so list screens stop downloading full contact/program tables. Hard-gated on app.has_app_access(''crm'').';
