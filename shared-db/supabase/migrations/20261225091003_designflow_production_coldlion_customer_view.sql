-- #6998: switch the single-schema DesignFlow production recipient.
-- derived-from: 20261225091002, 20260824011750, 20261008025618, 20261218101500
begin;

set local lock_timeout = '5s';

do $preflight$
begin
  if exists (select 1 from dflow_prod."externalCustomer" where id <= 0) then
    raise exception 'D1: legacy ID collides with the ColdLion ID namespace';
  end if;

  if exists (
    select 1 from pg_class where oid = 'dflow_prod."externalCustomer"'::regclass and relrowsecurity
  ) then
    raise exception 'D1: legacy customer row policies require separate review';
  end if;

  if exists (
    select 1 from pg_depend
    where refclassid = 'pg_class'::regclass
      and refobjid = 'dflow_prod."externalCustomer"'::regclass and deptype = 'n'
  ) then
    raise exception 'D1: a dependent object would remain bound to the archived customer copy';
  end if;

  if exists (
    select 1
    from (select distinct "customerCode" from dflow_prod."ProdOrderHeader") orders
    left join dflow_prod."externalCustomer" previous using ("customerCode")
    left join archive.external_customer_feed_6998 feed using ("customerCode")
    where (previous."customerCode" is null) <> (feed."customerCode" is null)
       or previous."customerDesc" is distinct from feed."customerDesc"
  ) then
    raise exception 'D1: switching sources would change production Tracking customer matches or labels';
  end if;
end;
$preflight$;

alter table dflow_prod."externalCustomer" rename constraint "externalCustomer_pkey" to external_customer_prod_6998_pkey;
alter sequence dflow_prod."externalCustomer_id_seq" rename to external_customer_prod_6998_id_seq;
alter table dflow_prod."externalCustomer" rename to external_customer_prod_6998;
alter table dflow_prod.external_customer_prod_6998 set schema archive;

create view dflow_prod."externalCustomer" with (security_barrier = true) as
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
left join archive.external_customer_prod_6998 previous using ("customerCode");


-- The existing production contract names these two read roles. Refuse any
-- additional legacy grants before narrowing writers and archiving the copy.
revoke all on dflow_prod."externalCustomer" from public, anon, authenticated, service_role;
grant select on dflow_prod."externalCustomer" to designflow_prod_tracking_grants, designflow_prod_data_sync_grants;
revoke all on archive.external_customer_prod_6998 from designflow_prod_tracking_grants, designflow_prod_data_sync_grants;
revoke all on archive.external_customer_prod_6998_id_seq
  from public, anon, authenticated, service_role, designflow_prod_data_sync_grants;

do $verify$
begin
  if exists (
    select 1
    from pg_class relation
    cross join lateral aclexplode(relation.relacl) acl
    where acl.grantee <> relation.relowner
      and (relation.oid in ('archive.external_customer_prod_6998'::regclass,
        'archive.external_customer_prod_6998_id_seq'::regclass)
        or (relation.oid = 'dflow_prod."externalCustomer"'::regclass
          and (acl.grantee not in ('designflow_prod_tracking_grants'::regrole, 'designflow_prod_data_sync_grants'::regrole)
            or acl.privilege_type <> 'SELECT')))
  ) or exists (
    select 1 from pg_attribute
    where attrelid = 'archive.external_customer_prod_6998'::regclass and attnum > 0 and attacl is not null
  ) then
    raise exception 'D1: unexpected grants on the production customer view or archive';
  end if;
end;
$verify$;

comment on view dflow_prod."externalCustomer" is
  'Production DesignFlow read-only ERP customer contract over the current ColdLion Edge Home customer feed.';

commit;
