-- Remove legacy email-domain noise from the shared customer picker.
--
-- Part 1 is the contract half of 20260625153010_crm_ingested_domain_split.sql.
-- That migration copied provable leaked ingested-domain rows into
-- crm.ingested_domain without deleting from core.customer. This deletes only rows
-- that are:
--   * sourced from Directus ingested_domains,
--   * already captured in crm.ingested_domain,
--   * not confirmed by PLM/ColdLion source refs,
--   * still untriaged,
--   * unreferenced by any app table that points at the customer hub.
--
-- Part 2 tightens api.customer_list. The shared picker/basic-read contract should
-- list active and potential customers, not CRM triage rows explicitly marked
-- OTHER/UNASSIGNED. CRM triage can still read those through CRM-specific views.

delete from core.customer c
using core.company_source_ref sr
where sr.company_id = c.id
  and sr.source_table = 'ingested_domains'
  and (c.customer_status is null or upper(c.customer_status) = 'UNASSIGNED')
  -- Already captured in crm.ingested_domain by the copy-out.
  and exists (
    select 1
    from crm.ingested_domain d
    where d.metadata ->> 'leaked_from_core_customer_id' = c.id::text
  )
  -- Never a confirmed customer.
  and not exists (
    select 1
    from core.company_source_ref e
    where e.company_id = c.id
      and e.source_system in ('designflow_plm', 'coldlion')
  )
  -- Unreferenced by every app that FKs to the customer hub.
  and not exists (select 1 from crm.opportunity o      where o.company_id = c.id)
  and not exists (select 1 from crm.department dp      where dp.company_id = c.id)
  and not exists (select 1 from crm.email_message em   where em.company_id = c.id)
  and not exists (select 1 from crm.meeting_note mn    where mn.company_id = c.id)
  and not exists (select 1 from crm.note n             where n.company_id = c.id)
  and not exists (select 1 from crm.task t             where t.company_id = c.id)
  and not exists (select 1 from core.contact_company cc where cc.company_id = c.id)
  and not exists (select 1 from pim.design_collection x where x.company_id = c.id)
  and not exists (select 1 from pim.project x          where x.company_id = c.id)
  and not exists (select 1 from pim.product x          where x.company_id = c.id)
  and not exists (select 1 from pim.customer_order x   where x.company_id = c.id)
  and not exists (select 1 from dam.style_group x      where x.company_id = c.id)
  and not exists (select 1 from dam.asset x            where x.company_id = c.id)
  and not exists (select 1 from dam.style_guide_file x where x.company_id = c.id)
  and not exists (select 1 from plm.item x             where x.company_id = c.id)
  and not exists (select 1 from plm.production_order x where x.company_id = c.id)
  and not exists (select 1 from plm.rfq_group x        where x.company_id = c.id)
  and not exists (select 1 from plm.customer_import x  where x.company_id = c.id);

create or replace view api.customer_list
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.customer_status,
  c.is_potential,
  c.domain,
  c.status,
  c.updated_at
from core.customer c
where c.customer_status is null
  or upper(c.customer_status) not in ('OTHER', 'UNASSIGNED');

comment on view api.customer_list is
  'Shared plain customer list for picker/basic reads. Excludes CRM triage statuses OTHER and UNASSIGNED; CRM triage views own those rows. Exposes only stable, picker-safe columns. is_potential distinguishes active/PLM-confirmed customers from potential customers.';

grant select on api.customer_list to authenticated;
