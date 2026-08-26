-- Restore browser-side CRM domain triage through the established guarded API
-- boundary. Ingested domains remain email evidence only: this function neither
-- reads nor writes core.customer and deliberately has no promotion behavior.

create or replace function api.crm_update_ingested_domain(
  p_ingested_domain_id uuid,
  p_status text default null
)
returns crm.ingested_domain
language plpgsql
security definer
set search_path = app, crm, public
as $fn$
declare
  result crm.ingested_domain;
begin
  if not coalesce(app.has_app_access('crm'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if p_status is not null
     and p_status not in ('new', 'ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER', 'OTHER') then
    raise exception 'crm: invalid ingested-domain status %', p_status
      using errcode = 'check_violation';
  end if;

  update crm.ingested_domain d
  set status = coalesce(p_status, d.status)
  where d.id = p_ingested_domain_id
  returning d.* into result;

  if not found then
    raise exception 'crm: ingested domain % not found', p_ingested_domain_id
      using errcode = 'no_data_found';
  end if;

  return result;
end;
$fn$;

revoke all on function api.crm_update_ingested_domain(uuid, text) from public;
grant execute on function api.crm_update_ingested_domain(uuid, text) to authenticated;

comment on function api.crm_update_ingested_domain(uuid, text) is
  'Guarded CRM triage update for email-domain evidence. Accepts new, ACTIVE_CUSTOMER, POTENTIAL_CUSTOMER, or OTHER; null preserves the current status. Never creates, links, or updates a customer.';

notify pgrst, 'reload schema';
