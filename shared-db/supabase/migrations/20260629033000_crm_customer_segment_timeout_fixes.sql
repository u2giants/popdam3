-- Fast customer segment contracts for CRM browser pages.
--
-- The compatibility view api.crm_customer_list remains available, but broad
-- browser reads against the view can time out under PostgREST. These RPCs keep
-- customer page/list semantics while filtering and ordering directly on
-- core.customer before joining optional labels.

create or replace function api.crm_customer_segment_list(
  p_segment text default 'active',
  p_limit integer default null
)
returns table (
  id uuid,
  name text,
  domain text,
  logo_url text,
  customer_status text,
  chain_type text,
  routing_aliases text,
  so_patterns text,
  company_type text,
  status text,
  primary_salesperson_profile_id uuid,
  account_owner_profile_id uuid,
  updated_at timestamptz,
  is_potential boolean
)
language sql
security definer
set search_path = api, core, crm, plm, app, public
as $$
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
    latest_logo.logo_url,
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
  from customer_rows c
  left join latest_logo on latest_logo.company_id = c.id
  order by c.name nulls last, c.id;
$$;

create or replace function api.crm_customer_segment_counts()
returns table (
  active bigint,
  triage bigint,
  dismissed bigint,
  "all" bigint
)
language sql
security definer
set search_path = api, core, crm, app, public
as $$
  select
    count(*) filter (where c.customer_status in ('ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER')) as active,
    (
      select count(*)
      from crm.ingested_domain d
      where d.promoted_customer_id is null
    ) as triage,
    count(*) filter (where c.customer_status = 'OTHER') as dismissed,
    count(*) as "all"
  from core.customer c
  where app.has_app_access('crm');
$$;

revoke all on function api.crm_customer_segment_list(text, integer) from public;
revoke all on function api.crm_customer_segment_counts() from public;
grant execute on function api.crm_customer_segment_list(text, integer) to authenticated;
grant execute on function api.crm_customer_segment_counts() to authenticated;

comment on function api.crm_customer_segment_list(text, integer) is
  'Fast CRM customer segment feed for Customers and active-customer pickers. Filters core.customer directly before joining optional PLM logo URLs.';
comment on function api.crm_customer_segment_counts() is
  'Fast CRM customer tab counts including active/dismissed customers and unpromoted ingested-domain triage rows.';
