-- Ingested domains are email triage artifacts, not customers.
--
-- Contract:
-- - crm.ingested_domain must not FK to, promote into, or source-ref core.customer.
-- - core.customer must not contain rows whose only provenance is Directus
--   ingested_domains.
-- - api.customer_list is removed because it exposed polluted broad customer data
--   under a trustworthy picker name.

begin;

drop view if exists api.customer_list;
drop view if exists api.crm_ingested_domain_list;
drop function if exists crm.promote_ingested_domain(text, text);

with polluted_only as (
  select c.id
  from core.customer c
  where exists (
    select 1
    from core.company_source_ref csr
    where csr.company_id = c.id
      and csr.source_system = 'directus'
      and csr.source_table = 'ingested_domains'
  )
  and not exists (
    select 1
    from core.company_source_ref csr
    where csr.company_id = c.id
      and not (csr.source_system = 'directus' and csr.source_table = 'ingested_domains')
  )
),
deleted_customers as (
  delete from core.customer c
  using polluted_only p
  where c.id = p.id
  returning c.id
),
deleted_source_refs as (
  delete from core.company_source_ref csr
  where csr.source_system = 'directus'
    and csr.source_table = 'ingested_domains'
  returning csr.id
),
cleaned_remaining_customers as (
  update core.customer c
  set metadata = c.metadata - 'promoted_from_ingested_domain'
  where c.metadata ? 'promoted_from_ingested_domain'
  returning c.id
)
select
  (select count(*) from deleted_customers)::bigint as deleted_ingested_domain_only_customers,
  (select count(*) from deleted_source_refs)::bigint as deleted_ingested_domain_source_refs,
  (select count(*) from cleaned_remaining_customers)::bigint as cleaned_remaining_customer_metadata;

drop index if exists crm.crm_ingested_domain_promoted_idx;
drop index if exists crm_ingested_domain_promoted_idx;
alter table crm.ingested_domain drop column if exists promoted_customer_id;

create or replace view api.crm_ingested_domain_list as
select
  d.id,
  d.domain::text as domain,
  d.display_name,
  d.status,
  d.email_count,
  d.first_seen_at,
  d.last_seen_at,
  d.last_sender::text as last_sender,
  d.sample_subject,
  d.updated_at
from crm.ingested_domain d;

comment on view api.crm_ingested_domain_list is
  'CRM-private ingested email-domain triage list. Ingested domains are not customers and have no customer association.';

grant select on api.crm_ingested_domain_list to authenticated;

create or replace function api.crm_customer_segment_counts()
returns table(active bigint, triage bigint, dismissed bigint, "all" bigint)
language sql
security definer
set search_path to 'api', 'core', 'crm', 'app', 'public'
as $$
  select
    count(*) filter (where c.customer_status in ('ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER')) as active,
    (
      select count(*)
      from crm.ingested_domain d
      where coalesce(d.status, 'new') not in ('ignored', 'dismissed')
    ) as triage,
    count(*) filter (where c.customer_status = 'OTHER') as dismissed,
    count(*) as "all"
  from core.customer c
  where app.has_app_access('crm');
$$;

comment on function api.crm_customer_segment_counts() is
  'CRM customer counts plus ingested-domain triage count. Ingested domains are not customers and are not linked/promoted to customers.';

commit;
