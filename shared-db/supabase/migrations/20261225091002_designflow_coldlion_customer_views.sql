-- #6998: replace the shared DesignFlow customer copy with the ColdLion feed.
-- derived-from: 20260905104825
begin;

set local lock_timeout = '5s';

do $preflight$
begin
  if exists (select 1 from core."externalCustomer" where id <= 0) then
    raise exception 'D1: legacy ID collides with the ColdLion ID namespace';
  end if;

  if exists (
    select 1 from pg_class where oid = 'core."externalCustomer"'::regclass and relrowsecurity
  ) then
    raise exception 'D1: legacy customer row policies require separate review';
  end if;

  if exists (
    select 1 from pg_depend
    where refclassid = 'pg_class'::regclass
      and refobjid = 'core."externalCustomer"'::regclass and deptype = 'n'
  ) then
    raise exception 'D1: a dependent object would remain bound to the archived customer copy';
  end if;

  -- Inactive records remain available. The sandbox has one updated ERP
  -- description, so protect the customer match while accepting the new label.
  if exists (
    select 1
    from (select distinct "customerCode" from plm."ProdOrderHeader") orders
    left join core."externalCustomer" previous using ("customerCode")
    left join coldlion.customer customer
      on customer.company_code = 'EDGEHOME' and customer.customer_code = orders."customerCode"
    where (previous."customerCode" is null) <> (customer.customer_code is null)
  ) then
    raise exception 'D1: switching sources would change Tracking customer matches';
  end if;
end;
$preflight$;

-- The source loader updates rows by (company_code, customer_code) and retains
-- codes absent from subsequent snapshots. Negative IDs cannot collide with
-- archived positive IDs. Read-only views retain the original ID per consumer.
alter table coldlion.customer add column designflow_customer_id integer
  generated always as identity (start with -1 increment by -1);


alter table core."externalCustomer" rename constraint "externalCustomer_pkey" to external_customer_core_6998_pkey;
alter sequence core."externalCustomer_id_seq" rename to external_customer_core_6998_id_seq;
alter table core."externalCustomer" rename to external_customer_core_6998;
alter table core.external_customer_core_6998 set schema archive;

-- Use the current ERP active value for every row. The 767 legacy core flags
-- differ, but activity is not a filter on the Tracking reader.
create view archive.external_customer_feed_6998 with (security_barrier = true) as
select
  customer.designflow_customer_id,
  customer.company_code::varchar as "companyCode",
  customer.customer_code::varchar as "customerCode",
  customer.active::varchar as active,
  customer.address1::varchar as address1,
  customer.address2::varchar as address2,
  customer.ar_customer_code::varchar as "aRCustomerCode",
  customer.city::varchar as city,
  customer.country_code::varchar as "countryCode",
  customer.customer_desc::varchar as "customerDesc",
  customer.customer_type_code::varchar as "customerTypeCode",
  customer.fax_no::varchar as "faxNo",
  customer.phone_no::varchar as "phoneNo",
  customer.state::varchar as state,
  customer.use_consolidated_invoice::varchar as "useConsolidatedInvoice",
  customer.zip_code::varchar as "zipCode",
  customer.parent_customer_code::varchar as "parentCustomerCode",
  customer.customer_dba::varchar as "customerDBA",
  customer.udf01::varchar as udf01,
  customer.udf02::varchar as udf02,
  customer.udf03::varchar as udf03,
  customer.udf04::varchar as udf04,
  customer.udf_date01::varchar as "udfDate01",
  customer.udf_date02::varchar as "udfDate02",
  customer.old_customer_code::varchar as "oldCustomerCode",
  customer.vendor_number::varchar as "vendorNumber",
  customer.address3::varchar as address3,
  customer.region_code::varchar as "regionCode",
  customer.ds_cat::varchar as "dsCat",
  customer.sales_person_code1::varchar as "salesPersonCode1",
  customer.sales_person_code2::varchar as "salesPersonCode2",
  customer.commission_perc1::varchar as "commissionPerc1",
  customer.commission_perc2::varchar as "commissionPerc2",
  customer.factor_code::varchar as "factorCode",
  customer.currency_code::varchar as "currencyCode",
  customer.gl_code::varchar as "glCode",
  to_char(customer.created_time at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS')::varchar as "createdTime",
  customer.created_user::varchar as "createdUser",
  to_char(customer.mod_time at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS')::varchar as "modTime",
  customer.mod_user::varchar as "modUser"
from coldlion.customer customer
where customer.company_code = 'EDGEHOME';

create view core."externalCustomer" with (security_barrier = true) as
select
  coalesce(previous.id, feed.designflow_customer_id) as id,
  feed."companyCode",
  feed."customerCode",
  feed.active,
  feed.address1,
  feed.address2,
  feed."aRCustomerCode",
  feed.city,
  feed."countryCode",
  feed."customerDesc",
  feed."customerTypeCode",
  feed."faxNo",
  feed."phoneNo",
  feed.state,
  feed."useConsolidatedInvoice",
  feed."zipCode",
  feed."parentCustomerCode",
  feed."customerDBA",
  feed.udf01,
  feed.udf02,
  feed.udf03,
  feed.udf04,
  feed."udfDate01",
  feed."udfDate02",
  feed."oldCustomerCode",
  feed."vendorNumber",
  feed.address3,
  feed."regionCode",
  feed."dsCat",
  feed."salesPersonCode1",
  feed."salesPersonCode2",
  feed."commissionPerc1",
  feed."commissionPerc2",
  feed."factorCode",
  feed."currencyCode",
  feed."glCode",
  feed."createdTime",
  feed."createdUser",
  feed."modTime",
  feed."modUser"
from archive.external_customer_feed_6998 feed
left join archive.external_customer_core_6998 previous using ("customerCode");


-- The owner-mediated view preserves the exact existing readers without
-- giving them direct access to the private ColdLion source.
revoke all on archive.external_customer_feed_6998 from public, anon, authenticated, service_role;
revoke all on core."externalCustomer" from public, anon, authenticated, service_role;

do $privileges$
declare
  archived constant regclass := 'archive.external_customer_core_6998'::regclass;
  archived_id constant regclass := 'archive.external_customer_core_6998_id_seq'::regclass;
  reader constant regclass := 'core."externalCustomer"'::regclass;
  permission record;
  recipient text;
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = archived and attnum > 0 and attacl is not null
  ) then
    raise exception 'D1: unexpected column grants on archived customer relation';
  end if;

  for permission in
    select distinct acl.grantee, role.rolname
    from pg_class relation
    cross join lateral aclexplode(relation.relacl) acl
    left join pg_roles role on role.oid = acl.grantee
    where relation.oid = reader and acl.grantee <> relation.relowner
  loop
    recipient := case when permission.grantee = 0 then 'public' else quote_ident(permission.rolname) end;
    execute format('revoke all on table %s from %s', reader, recipient);
  end loop;

  for permission in
    select acl.grantee, role.rolname, bool_or(acl.privilege_type = 'SELECT') as can_read
    from pg_class relation
    cross join lateral aclexplode(relation.relacl) acl
    left join pg_roles role on role.oid = acl.grantee
    where relation.oid = archived and acl.grantee <> relation.relowner
    group by acl.grantee, role.rolname
  loop
    recipient := case when permission.grantee = 0 then 'public' else quote_ident(permission.rolname) end;
    if permission.can_read then
      execute format('grant select on table %s to %s', reader, recipient);
      if not exists (
        select 1
        from pg_class relation
        cross join lateral aclexplode(relation.relacl) acl
        where relation.oid = reader and acl.grantee = permission.grantee
          and acl.privilege_type = 'SELECT'
      ) then
        raise exception 'D1: customer reader grant was not preserved';
      end if;
    end if;
    execute format('revoke all on table %s from %s', archived, recipient);
  end loop;

  for permission in
    select distinct acl.grantee, role.rolname
    from pg_class relation
    cross join lateral aclexplode(relation.relacl) acl
    left join pg_roles role on role.oid = acl.grantee
    where relation.oid = archived_id and acl.grantee <> relation.relowner
  loop
    recipient := case when permission.grantee = 0 then 'public' else quote_ident(permission.rolname) end;
    execute format('revoke all on sequence %s from %s', archived_id, recipient);
  end loop;

  if exists (
    select 1
    from pg_class relation
    cross join lateral aclexplode(relation.relacl) acl
    where acl.grantee <> relation.relowner
      and (relation.oid in (archived, archived_id)
        or (relation.oid = reader and acl.privilege_type <> 'SELECT'))
  ) then
    raise exception 'D1: archived or write access remains on a customer relation';
  end if;
end;
$privileges$;

comment on view core."externalCustomer" is
  'DesignFlow read-only ERP customer contract over the current ColdLion Edge Home customer feed.';
commit;
