-- CONTRACT STEP — NOT a migration yet. Do not place in supabase/migrations/
-- until: (1) the copy-out in 20260625121000_crm_ingested_domain_split.sql has run
-- on preview, (2) the CRM worker writes ingested domains via
-- crm.record_ingested_domain() (no longer into core.customer), and (3) the owner
-- has signed off in an approved window. Then promote this to a timestamped
-- migration.
--
-- Deletes the email-noise rows that already leaked into core.customer. Guards are
-- identical to the copy-out, and every app FK that could reference a customer is
-- checked, so only provably-unreferenced noise is removed.

delete from core.customer c
using core.company_source_ref sr
where sr.company_id = c.id
  and sr.source_table = 'ingested_domains'
  and (c.customer_status is null or upper(c.customer_status) = 'UNASSIGNED')
  -- already captured in crm.ingested_domain by the copy-out
  and exists (
    select 1 from crm.ingested_domain d
    where d.metadata ->> 'leaked_from_core_customer_id' = c.id::text
  )
  -- never a confirmed customer
  and not exists (
    select 1 from core.company_source_ref e
    where e.company_id = c.id and e.source_system in ('designflow_plm', 'coldlion')
  )
  -- unreferenced by every app that FKs to the customer hub
  and not exists (select 1 from crm.opportunity o      where o.company_id = c.id)
  and not exists (select 1 from crm.department dp       where dp.company_id = c.id)
  and not exists (select 1 from crm.email_message em    where em.company_id = c.id)
  and not exists (select 1 from crm.meeting_note mn     where mn.company_id = c.id)
  and not exists (select 1 from crm.note n              where n.company_id = c.id)
  and not exists (select 1 from crm.task t              where t.company_id = c.id)
  and not exists (select 1 from core.contact_company cc where cc.company_id = c.id)
  and not exists (select 1 from pim.design_collection x where x.company_id = c.id)
  and not exists (select 1 from pim.project x           where x.company_id = c.id)
  and not exists (select 1 from pim.product x           where x.company_id = c.id)
  and not exists (select 1 from pim.customer_order x    where x.company_id = c.id)
  and not exists (select 1 from dam.style_group x       where x.company_id = c.id)
  and not exists (select 1 from dam.asset x             where x.company_id = c.id)
  and not exists (select 1 from dam.style_guide_file x  where x.company_id = c.id)
  and not exists (select 1 from plm.item x              where x.company_id = c.id)
  and not exists (select 1 from plm.production_order x  where x.company_id = c.id)
  and not exists (select 1 from plm.rfq_group x         where x.company_id = c.id)
  and not exists (select 1 from plm.customer_import x   where x.company_id = c.id);
