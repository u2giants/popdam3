-- Preserve ordinary CRM-authorized customer updates while restricting the
-- destructive domain-clear operation to the established Administrator role.
-- derived-from: 20260827095753

create or replace function api.crm_update_customer(
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

  if coalesce(p_clear_domain, false)
     and not coalesce(app.has_role('administrator'), false) then
    raise exception 'crm: administrator required to clear customer domain'
      using errcode = 'insufficient_privilege';
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
  'Guarded CRM customer update RPC. Ordinary updates require CRM access. Intentional domain clearing with p_clear_domain=true additionally requires the established Administrator role; false, NULL, or omitted preserves the domain unless p_domain supplies a replacement.';

notify pgrst, 'reload schema';
