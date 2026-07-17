-- Add display_name to api.crm_customer_segment_list so the CRM customer pickers
-- (which fetch through this RPC, not the crm_customer_list view) can show
-- coalesce(display_name, name). The RPC already returns the hub `status` enum, so
-- the frontend can filter selectable options to active/potential; it was only
-- missing display_name. Additive column appended to the return signature.
--
-- Return type changes require DROP + CREATE (CREATE OR REPLACE cannot alter the
-- OUT columns). The function is called only via PostgREST RPC, nothing in-DB
-- depends on it, so the drop is safe. Grants re-applied.

drop function if exists api.crm_customer_segment_list(text, integer);

create function api.crm_customer_segment_list(p_segment text default 'active'::text, p_limit integer default null::integer)
returns table(id uuid, name text, domain text, logo_url text, customer_status text, chain_type text, routing_aliases text, so_patterns text, company_type text, status text, primary_salesperson_profile_id uuid, account_owner_profile_id uuid, updated_at timestamp with time zone, is_potential boolean, display_name text)
language sql
security definer
set search_path to 'api', 'core', 'crm', 'plm', 'app', 'public'
as $function$
  with checked as (
    select case
      when app.has_app_access('crm') then least(greatest(coalesce(nullif(p_limit, -1), 5000), 1), 5000)
      else null::integer
    end as row_limit
  ),
  latest_logo as (
    select distinct on (ci.company_id)
      ci.company_id,
      ci.logo_url
    from plm.customer_import ci
    where nullif(ci.logo_url, '') is not null
    order by ci.company_id, ci.updated_at desc nulls last, ci.imported_at desc nulls last
  ),
  customer_rows as (
    select c.*
    from core.customer c, checked
    where checked.row_limit is not null
      and (
        coalesce(p_segment, 'active') = 'all'
        or (
          coalesce(p_segment, 'active') = 'active'
          and c.customer_status in ('ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER')
        )
        or (
          coalesce(p_segment, 'active') = 'dismissed'
          and c.customer_status = 'OTHER'
        )
      )
    order by c.name nulls last, c.id
    limit (select row_limit from checked)
  )
  select
    c.id,
    c.name,
    c.domain,
    api.crm_customer_logo_url(c.metadata, latest_logo.logo_url) as logo_url,
    c.customer_status,
    c.chain_type,
    c.routing_aliases,
    c.so_patterns,
    c.company_type,
    c.status,
    c.primary_salesperson_profile_id,
    c.account_owner_profile_id,
    c.updated_at,
    c.is_potential,
    c.display_name
  from customer_rows c
  left join latest_logo on latest_logo.company_id = c.id
  order by c.name nulls last, c.id;
$function$;

revoke all on function api.crm_customer_segment_list(text, integer) from public;
grant execute on function api.crm_customer_segment_list(text, integer) to authenticated;
grant execute on function api.crm_customer_segment_list(text, integer) to service_role;
