-- Let CRM explicitly clear a customer domain while preserving the existing
-- null-means-no-change contract for every caller that omits the clear flag.
-- derived-from: 20260826001704

-- PostgreSQL cannot replace this function in place because the appended
-- defaulted argument changes its identity. The migration is transactional, so
-- there is no externally visible gap between the drop and replacement.
drop function api.crm_update_customer(uuid, text, text, text, text, text, text, text);

create function api.crm_update_customer(
  p_customer_id uuid,
  p_name text default null,
  p_domain text default null,
  p_customer_status text default null,
  p_chain_type text default null,
  p_routing_aliases text default null,
  p_so_patterns text default null,
  p_display_name text default null,
  p_clear_domain boolean default false
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
    domain          = case when p_clear_domain then null else coalesce(p_domain, c.domain) end,
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

revoke all on function api.crm_update_customer(uuid, text, text, text, text, text, text, text, boolean) from public;
grant execute on function api.crm_update_customer(uuid, text, text, text, text, text, text, text, boolean) to authenticated;

comment on function api.crm_update_customer(uuid, text, text, text, text, text, text, text, boolean) is
  'Guarded CRM customer update RPC. Appended display_name changes the customer-facing label without changing customer identity or classification; p_clear_domain clears domain explicitly; otherwise null arguments preserve existing values.';

notify pgrst, 'reload schema';
