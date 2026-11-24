-- #6998: restore one shared customer read source between the landing feed and consumers.
-- derived-from: 20260716140000, 20261225091002
begin;

set local lock_timeout = '5s';

alter table plm.erp_customer
  add column designflow_customer_id integer unique,
  add column landing_customer_details jsonb;

comment on column plm.erp_customer.landing_customer_details is
  'ColdLion source values needed by DesignFlow that have no dedicated ERP customer column.';

-- Only ERP-owned values are refreshed. Preserve customer_id, the historical
-- import payload, and prior contact details (§6.19). New rows stay unlinked
-- until the existing POP customer-linking process supplies a link.
create function plm.sync_erp_customer_from_landing(customer_codes text[])
returns void
language sql
set search_path = ''
as $sync$
  insert into plm.erp_customer as customer (
    customer_code, company_code, name, dba,
    active, parent_customer_code, customer_type_code, ar_customer_code,
    old_customer_code, region_code, salesperson_code_1, salesperson_code_2,
    commission_perc_1, commission_perc_2, factor_code, currency_code,
    gl_code,
    erp_created_at, erp_updated_at, designflow_customer_id, landing_customer_details
  )
  select
    source.customer_code,
    source.company_code,
    coalesce(source.customer_desc, source.customer_code),
    source.customer_dba,
    coalesce(source.active = 'Y', false),
    source.parent_customer_code,
    source.customer_type_code,
    source.ar_customer_code,
    source.old_customer_code,
    source.region_code,
    source.sales_person_code1,
    source.sales_person_code2,
    source.commission_perc1,
    source.commission_perc2,
    source.factor_code,
    source.currency_code,
    source.gl_code,
    source.created_time,
    source.mod_time,
    source.designflow_customer_id,
    jsonb_strip_nulls(jsonb_build_object(
      'active', source.active, 'customer_desc', source.customer_desc,
      'use_consolidated_invoice', source.use_consolidated_invoice,
      'udf01', source.udf01, 'udf02', source.udf02, 'udf03', source.udf03, 'udf04', source.udf04,
      'udf_date01', source.udf_date01, 'udf_date02', source.udf_date02,
      'vendor_number', source.vendor_number, 'ds_cat', source.ds_cat,
      'created_user', source.created_user, 'mod_user', source.mod_user
    ))
  from coldlion.customer source
  where source.company_code = 'EDGEHOME'
    and (customer_codes is null or source.customer_code = any(customer_codes))
  order by source.customer_code
  on conflict (customer_code) do update set
    company_code = excluded.company_code,
    name = excluded.name,
    dba = excluded.dba,
    active = excluded.active,
    parent_customer_code = excluded.parent_customer_code,
    customer_type_code = excluded.customer_type_code,
    ar_customer_code = excluded.ar_customer_code,
    old_customer_code = excluded.old_customer_code,
    region_code = excluded.region_code,
    salesperson_code_1 = excluded.salesperson_code_1,
    salesperson_code_2 = excluded.salesperson_code_2,
    commission_perc_1 = excluded.commission_perc_1,
    commission_perc_2 = excluded.commission_perc_2,
    factor_code = excluded.factor_code,
    currency_code = excluded.currency_code,
    gl_code = excluded.gl_code,
    erp_created_at = excluded.erp_created_at,
    erp_updated_at = excluded.erp_updated_at,
    designflow_customer_id = excluded.designflow_customer_id,
    landing_customer_details = excluded.landing_customer_details
  where row(
    customer.company_code, customer.name, customer.dba,
    customer.active, customer.parent_customer_code, customer.customer_type_code,
    customer.ar_customer_code, customer.old_customer_code, customer.region_code,
    customer.salesperson_code_1, customer.salesperson_code_2, customer.commission_perc_1,
    customer.commission_perc_2, customer.factor_code, customer.currency_code,
    customer.gl_code, customer.erp_created_at, customer.erp_updated_at,
    customer.designflow_customer_id, customer.landing_customer_details
  ) is distinct from row(
    excluded.company_code, excluded.name, excluded.dba,
    excluded.active, excluded.parent_customer_code, excluded.customer_type_code,
    excluded.ar_customer_code, excluded.old_customer_code, excluded.region_code,
    excluded.salesperson_code_1, excluded.salesperson_code_2, excluded.commission_perc_1,
    excluded.commission_perc_2, excluded.factor_code, excluded.currency_code,
    excluded.gl_code, excluded.erp_created_at, excluded.erp_updated_at,
    excluded.designflow_customer_id, excluded.landing_customer_details
  );
$sync$;

revoke all on function plm.sync_erp_customer_from_landing(text[]) from public, anon, authenticated;
grant execute on function plm.sync_erp_customer_from_landing(text[]) to service_role;

-- Each transition table carries the rows touched by that landing statement.
-- A bulk refresh stays atomic and unrelated customer rows are not rewritten.
create function coldlion.apply_erp_customer_landing_trigger()
returns trigger
language plpgsql
set search_path = ''
as $trigger$
declare
  changed_codes text[];
begin
  select array_agg(customer_code) into changed_codes
  from changed_customers
  where company_code = 'EDGEHOME';

  if changed_codes is not null then
    perform plm.sync_erp_customer_from_landing(changed_codes);
  end if;
  return null;
end;
$trigger$;

revoke all on function coldlion.apply_erp_customer_landing_trigger() from public, anon, authenticated;

create trigger sync_erp_customer_insert
  after insert on coldlion.customer
  referencing new table as changed_customers
  for each statement execute function coldlion.apply_erp_customer_landing_trigger();

create trigger sync_erp_customer_update
  after update on coldlion.customer
  referencing new table as changed_customers
  for each statement execute function coldlion.apply_erp_customer_landing_trigger();

do $intake_check$
begin
  -- Order Intake can fall back to the active ERP record. A changed flag is
  -- safe only if the existing POP reference resolves to that same customer.
  if exists (
    select 1
    from plm.erp_customer customer
    join coldlion.customer source using (company_code, customer_code)
    where source.company_code = 'EDGEHOME'
      and customer.active is distinct from coalesce(source.active = 'Y', false)
      and customer.customer_id is not null
      and not exists (
        select 1 from core.company_source_ref link
        where link.source_system = 'coldlion' and link.source_table = 'customers'
          and link.source_id = customer.customer_code and link.company_id = customer.customer_id
      )
  ) then
    raise exception 'ERP customer refresh would change an Order Intake customer resolution';
  end if;
end;
$intake_check$;

select plm.sync_erp_customer_from_landing(null);

create or replace view archive.external_customer_feed_6998 with (security_barrier = true) as
select
  designflow_customer_id,
  (company_code)::varchar as "companyCode",
  (customer_code)::varchar as "customerCode",
  (landing_customer_details ->> 'active')::varchar as active,
  (address ->> 'address1')::varchar as address1,
  (address ->> 'address2')::varchar as address2,
  (ar_customer_code)::varchar as "aRCustomerCode",
  (address ->> 'city')::varchar as city,
  (address ->> 'country')::varchar as "countryCode",
  (landing_customer_details ->> 'customer_desc')::varchar as "customerDesc",
  (customer_type_code)::varchar as "customerTypeCode",
  (fax)::varchar as "faxNo",
  (phone)::varchar as "phoneNo",
  (address ->> 'state')::varchar as state,
  (landing_customer_details ->> 'use_consolidated_invoice')::varchar as "useConsolidatedInvoice",
  (address ->> 'zip')::varchar as "zipCode",
  (parent_customer_code)::varchar as "parentCustomerCode",
  (dba)::varchar as "customerDBA",
  (landing_customer_details ->> 'udf01')::varchar as udf01,
  (landing_customer_details ->> 'udf02')::varchar as udf02,
  (landing_customer_details ->> 'udf03')::varchar as udf03,
  (landing_customer_details ->> 'udf04')::varchar as udf04,
  ((landing_customer_details ->> 'udf_date01')::date)::varchar as "udfDate01",
  ((landing_customer_details ->> 'udf_date02')::date)::varchar as "udfDate02",
  (old_customer_code)::varchar as "oldCustomerCode",
  (landing_customer_details ->> 'vendor_number')::varchar as "vendorNumber",
  (address ->> 'address3')::varchar as address3,
  (region_code)::varchar as "regionCode",
  (landing_customer_details ->> 'ds_cat')::varchar as "dsCat",
  (salesperson_code_1)::varchar as "salesPersonCode1",
  (salesperson_code_2)::varchar as "salesPersonCode2",
  (commission_perc_1)::varchar as "commissionPerc1",
  (commission_perc_2)::varchar as "commissionPerc2",
  (factor_code)::varchar as "factorCode",
  (currency_code)::varchar as "currencyCode",
  (gl_code)::varchar as "glCode",
  (to_char(erp_created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS'))::varchar as "createdTime",
  (landing_customer_details ->> 'created_user')::varchar as "createdUser",
  (to_char(erp_updated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS'))::varchar as "modTime",
  (landing_customer_details ->> 'mod_user')::varchar as "modUser"
from plm.erp_customer
where designflow_customer_id is not null;

comment on table plm.erp_customer is
  'Shared ERP customer source refreshed from the ColdLion landing feed. POP-managed customer links remain independent of the ERP active flag.';
comment on view archive.external_customer_feed_6998 is
  'Private DesignFlow compatibility projection. Both legacy read names use the shared plm.erp_customer table.';

commit;
