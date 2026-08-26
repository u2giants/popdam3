-- Let CRM rename the customer-facing label without changing the canonical
-- customer identity, classification, or ERP linkage.

-- PostgreSQL rejects an overlapping overload when both signatures have
-- trailing defaults, and it also refuses to remove defaults with CREATE OR
-- REPLACE. The migration runner wraps this file in one transaction, so dropping
-- the old signature immediately before creating its replacement exposes no gap.
drop function api.crm_update_customer(uuid, text, text, text, text, text, text);

create function api.crm_update_customer(
  p_customer_id uuid,
  p_name text default null,
  p_domain text default null,
  p_customer_status text default null,
  p_chain_type text default null,
  p_routing_aliases text default null,
  p_so_patterns text default null,
  p_display_name text default null
)
returns core.customer
language plpgsql
security definer
set search_path = app, core, crm, public
as $fn$
declare
  result core.customer;
begin
  if not coalesce(app.has_app_access('crm'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  update core.customer c
  set
    name            = coalesce(p_name, c.name),
    domain          = coalesce(p_domain, c.domain),
    customer_status = coalesce(p_customer_status, c.customer_status),
    chain_type      = coalesce(p_chain_type, c.chain_type),
    routing_aliases = coalesce(p_routing_aliases, c.routing_aliases),
    so_patterns     = coalesce(p_so_patterns, c.so_patterns),
    display_name    = coalesce(p_display_name, c.display_name)
  where c.id = p_customer_id
  returning c.* into result;

  if not found then
    raise exception 'crm: customer % not found', p_customer_id using errcode = 'no_data_found';
  end if;

  return result;
end;
$fn$;

revoke all on function api.crm_update_customer(uuid, text, text, text, text, text, text, text) from public;
grant execute on function api.crm_update_customer(uuid, text, text, text, text, text, text, text) to authenticated;

comment on function api.crm_update_customer(uuid, text, text, text, text, text, text, text) is
  'Guarded CRM customer update RPC. Appended display_name changes the customer-facing label without changing customer identity or classification; null arguments preserve existing values.';

notify pgrst, 'reload schema';
