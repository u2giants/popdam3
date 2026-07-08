-- CRM-owned customer logo overrides.
--
-- Full-width customer logos can come from PLM customer_import rows, but CRM
-- admins also need to upload/choose logos directly. Store those direct choices
-- on core.customer.metadata so PLM imports remain untouched and reversible.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crm-customer-logos',
  'crm-customer-logos',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists crm_customer_logos_read on storage.objects;
drop policy if exists crm_customer_logos_insert on storage.objects;
drop policy if exists crm_customer_logos_update on storage.objects;
drop policy if exists crm_customer_logos_delete on storage.objects;

create policy crm_customer_logos_read on storage.objects
for select
to public
using (bucket_id = 'crm-customer-logos');

create policy crm_customer_logos_insert on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'crm-customer-logos'
  and app.has_app_access('crm')
);

create policy crm_customer_logos_update on storage.objects
for update
to authenticated
using (
  bucket_id = 'crm-customer-logos'
  and app.has_app_access('crm')
)
with check (
  bucket_id = 'crm-customer-logos'
  and app.has_app_access('crm')
);

create policy crm_customer_logos_delete on storage.objects
for delete
to authenticated
using (
  bucket_id = 'crm-customer-logos'
  and app.has_app_access('crm')
);

create or replace function api.crm_customer_logo_url(p_metadata jsonb, p_import_logo_url text)
returns text
language sql
stable
as $$
  select coalesce(nullif(p_metadata ->> 'crm_logo_url', ''), nullif(p_import_logo_url, ''));
$$;

revoke all on function api.crm_customer_logo_url(jsonb, text) from public;
grant execute on function api.crm_customer_logo_url(jsonb, text) to authenticated, service_role;

create or replace view api.crm_customer_list
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.domain,
  api.crm_customer_logo_url(c.metadata, logo.logo_url) as logo_url,
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
    c.is_potential
  from customer_rows c
  left join latest_logo on latest_logo.company_id = c.id
  order by c.name nulls last, c.id;
$$;

create or replace function api.crm_set_customer_logo(
  p_customer_id uuid,
  p_logo_url text default null
)
returns core.customer
language plpgsql
security definer
set search_path = app, core, crm, public
as $fn$
declare
  result core.customer;
  next_metadata jsonb;
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if nullif(btrim(coalesce(p_logo_url, '')), '') is null then
    update core.customer c
    set metadata = coalesce(c.metadata, '{}'::jsonb) - 'crm_logo_url'
    where c.id = p_customer_id
    returning c.* into result;
  else
    next_metadata := jsonb_set(
      coalesce((select c.metadata from core.customer c where c.id = p_customer_id), '{}'::jsonb),
      '{crm_logo_url}',
      to_jsonb(btrim(p_logo_url)),
      true
    );

    update core.customer c
    set metadata = next_metadata
    where c.id = p_customer_id
    returning c.* into result;
  end if;

  if not found then
    raise exception 'crm: customer % not found', p_customer_id using errcode = 'no_data_found';
  end if;

  return result;
end;
$fn$;

revoke all on function api.crm_set_customer_logo(uuid, text) from public;
grant select on api.crm_customer_list to authenticated;
grant execute on function api.crm_customer_segment_list(text, integer) to authenticated;
grant execute on function api.crm_set_customer_logo(uuid, text) to authenticated;

comment on function api.crm_set_customer_logo(uuid, text) is
  'Sets or clears the CRM-owned full logo override stored on core.customer.metadata.crm_logo_url. CRM customer APIs prefer this over PLM-imported logo URLs.';
comment on function api.crm_customer_logo_url(jsonb, text) is
  'Resolves the customer logo URL exposed to CRM: manual CRM override first, then PLM-imported logo.';
