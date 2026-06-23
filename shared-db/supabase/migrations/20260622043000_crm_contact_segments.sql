-- CRM contact segmentation API for popcrm-web.
--
-- Shared-db context:
-- - This database is shared by CRM, PIM, DAM, and PLM. These API objects are
--   browser-facing contracts, not one-off frontend implementation details.
-- - The existing api.crm_contact_list column contract is preserved.
-- - New segment views let popcrm-web fetch Cust Contacts, Dept Contacts, and
--   Triage independently without fetching every contact on page open.
-- - The "All" list remains available through api.crm_contact_segment_list with
--   no segment filter, but the frontend should lazy-load it only when the user
--   asks for All.
-- - Do not splice realtime base-table payloads into these rows. Realtime emits
--   core/crm table rows without joined display fields; consumers should refetch
--   the relevant api view after a short debounce.

create index if not exists core_contact_company_contact_primary_idx
  on core.contact_company (contact_id, is_primary desc, id);

create index if not exists core_contact_company_crm_department_idx
  on core.contact_company (crm_department_id);

-- Replace the original contact-list view with the same columns plus an explicit
-- CRM access gate. This keeps existing consumers working while matching the
-- production contract used by popcrm-web after the Supabase cutover.
create or replace view api.crm_contact_list
with (security_invoker = false) as
select
  ct.id,
  coalesce(ct.full_name, nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '')) as name,
  ct.first_name,
  ct.last_name,
  ct.email::text as email,
  ct.phone,
  ct.title as job_title,
  cc.contact_type,
  cc.scope,
  cc.company_id,
  comp.name as company_name,
  comp.customer_status as company_customer_status,
  cc.crm_department_id as department_id,
  d.name as department_name,
  ct.updated_at
from core.contact ct
left join lateral (
  select x.*
  from core.contact_company x
  where x.contact_id = ct.id
  order by x.is_primary desc nulls last, x.id
  limit 1
) cc on true
left join core.company comp on comp.id = cc.company_id
left join crm.department d on d.id = cc.crm_department_id
where app.has_app_access('crm');

comment on view api.crm_contact_list is
  'CRM contact list. Preserves the original popcrm-web contact columns and gates access through app.has_app_access(''crm''). Do not add derived-field ordering here; browser consumers page this view without server-side sort.';

-- Segment-specific contract for the CRM Contacts screen.
--
-- Segment meanings:
-- - customer: linked to ACTIVE_CUSTOMER/POTENTIAL_CUSTOMER account, no department.
-- - department: linked to ACTIVE_CUSTOMER/POTENTIAL_CUSTOMER account and a CRM department.
-- - triage: not linked to an ACTIVE_CUSTOMER/POTENTIAL_CUSTOMER account.
--
-- The column list intentionally matches api.crm_contact_list, with crm_segment
-- appended. Consumers can switch between the generic and segmented contracts
-- without remapping business fields.
create or replace view api.crm_contact_segment_list
with (security_invoker = false) as
select
  contact_rows.*,
  case
    when contact_rows.company_customer_status in ('ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER')
      and contact_rows.department_id is null
      then 'customer'
    when contact_rows.company_customer_status in ('ACTIVE_CUSTOMER', 'POTENTIAL_CUSTOMER')
      and contact_rows.department_id is not null
      then 'department'
    else 'triage'
  end as crm_segment
from api.crm_contact_list contact_rows;

comment on view api.crm_contact_segment_list is
  'CRM contact list plus server-computed crm_segment (customer, department, triage). Used so popcrm-web can fetch each visible Contacts tab as a bounded logical slice instead of loading all contacts to classify client-side.';

-- Lightweight counts for badges/tabs. Includes an "all" row so clients can show
-- the total without eager-loading the All table.
create or replace view api.crm_contact_segment_counts
with (security_invoker = false) as
select
  segment_counts.crm_segment,
  segment_counts.contact_count
from (
  select
    crm_segment,
    count(*)::bigint as contact_count
  from api.crm_contact_segment_list
  group by crm_segment

  union all

  select
    'all'::text as crm_segment,
    count(*)::bigint as contact_count
  from api.crm_contact_segment_list
) segment_counts;

comment on view api.crm_contact_segment_counts is
  'CRM Contacts tab counts for customer, department, triage, and all. Lets popcrm-web render badges without loading every contact.';

grant select on
  api.crm_contact_list,
  api.crm_contact_segment_list,
  api.crm_contact_segment_counts
to authenticated;

notify pgrst, 'reload schema';
