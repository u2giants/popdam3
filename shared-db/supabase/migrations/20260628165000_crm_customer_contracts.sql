-- Add customer-named CRM API contracts while preserving legacy account-named
-- compatibility objects for already-deployed clients.

create or replace view api.crm_customer_list
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.domain,
  logo.logo_url,
  c.customer_status,
  c.chain_type,
  c.routing_aliases,
  c.so_patterns,
  c.company_type,
  c.status,
  c.primary_salesperson_profile_id,
  c.account_owner_profile_id,
  c.updated_at,
  c.is_potential
from core.customer c
left join lateral (
  select ci.logo_url
  from plm.customer_import ci
  where ci.company_id = c.id
    and nullif(ci.logo_url, '') is not null
  order by ci.updated_at desc nulls last, ci.imported_at desc nulls last
  limit 1
) logo on true;

create or replace view api.crm_customer_overview
with (security_invoker = true)
as
select
  c.id as company_id,
  c.name as company_name,
  c.status as company_status,
  count(distinct cc.contact_id) as contact_count,
  count(distinct d.id) as department_count,
  count(distinct o.id) as opportunity_count,
  count(distinct pr.id) as project_count,
  count(distinct po.id) as production_order_count,
  max(o.updated_at) as latest_opportunity_at
from core.customer c
left join core.contact_company cc on cc.company_id = c.id
left join crm.department d on d.company_id = c.id
left join crm.opportunity o on o.company_id = c.id
left join pim.project pr on pr.company_id = c.id
left join plm.production_order po on po.company_id = c.id
group by c.id, c.name, c.status;

create or replace function api.crm_update_customer(
  p_customer_id uuid,
  p_name text default null,
  p_domain text default null,
  p_customer_status text default null,
  p_chain_type text default null,
  p_routing_aliases text default null,
  p_so_patterns text default null
)
returns core.customer
language plpgsql
security definer
set search_path = app, core, crm, public
as $fn$
declare
  result core.customer;
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  update core.customer c
  set
    name            = coalesce(p_name, c.name),
    domain          = coalesce(p_domain, c.domain),
    customer_status = coalesce(p_customer_status, c.customer_status),
    chain_type      = coalesce(p_chain_type, c.chain_type),
    routing_aliases = coalesce(p_routing_aliases, c.routing_aliases),
    so_patterns     = coalesce(p_so_patterns, c.so_patterns)
  where c.id = p_customer_id
  returning c.* into result;

  if not found then
    raise exception 'crm: customer % not found', p_customer_id using errcode = 'no_data_found';
  end if;

  return result;
end;
$fn$;

revoke all on function api.crm_update_customer(uuid, text, text, text, text, text, text) from public;
grant select on api.crm_customer_list to authenticated;
grant select on api.crm_customer_overview to authenticated;
grant execute on function api.crm_update_customer(uuid, text, text, text, text, text, text) to authenticated;

comment on view api.crm_customer_list is
  'CRM customer list for customer pages, pickers, and inline edits. Customer-named replacement for deprecated api.crm_account_list.';
comment on view api.crm_customer_overview is
  'CRM customer summary across customers, contacts, departments, opportunities, PM projects, and PLM orders. Customer-named replacement for deprecated api.crm_account_overview.';
comment on function api.crm_update_customer(uuid, text, text, text, text, text, text) is
  'Guarded CRM customer update RPC. Customer-named replacement for deprecated api.crm_update_account.';

comment on view api.crm_account_list is
  'Deprecated compatibility name. Use api.crm_customer_list for CRM customer pages, pickers, and inline edits.';
comment on view api.crm_account_overview is
  'Deprecated compatibility name. Use api.crm_customer_overview for CRM customer summaries.';
comment on function api.crm_update_account(uuid, text, text, text, text, text, text) is
  'Deprecated compatibility name. Use api.crm_update_customer(p_customer_id, ...) for guarded CRM customer updates.';
