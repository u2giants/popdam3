-- Expose core.customer.display_name through the customer serving views so app
-- dropdowns/pickers can show coalesce(display_name, name). Additive (new trailing
-- column); existing consumers are unaffected.

create or replace view api.crm_customer_list as
 SELECT c.id, c.name, c.domain,
    api.crm_customer_logo_url(c.metadata, logo.logo_url) AS logo_url,
    c.customer_status, c.chain_type, c.routing_aliases, c.so_patterns,
    c.company_type, c.status, c.primary_salesperson_profile_id,
    c.account_owner_profile_id, c.updated_at, c.is_potential, c.display_name
   FROM core.customer c
     LEFT JOIN LATERAL ( SELECT ci.logo_url FROM plm.customer_import ci
          WHERE ci.company_id = c.id AND NULLIF(ci.logo_url, ''::text) IS NOT NULL
          ORDER BY ci.updated_at DESC NULLS LAST, ci.imported_at DESC NULLS LAST
         LIMIT 1) logo ON true;

create or replace view api.crm_account_list as
 SELECT id, name, domain, customer_status, chain_type, routing_aliases, so_patterns,
    company_type, status, primary_salesperson_profile_id, account_owner_profile_id,
    updated_at, is_potential, display_name
   FROM core.customer c;
