-- #6998: one shared ERP customer source without overwriting POP customer data.
begin;

do $test$
declare
  pop_customer uuid;
  existing_id integer;
  new_id integer;
begin
  select id into pop_customer from core.customer order by id limit 1;

  insert into plm.erp_customer (customer_code, company_code, customer_id, name, active, address, raw)
  values ('TEST6998-SHARED-EXISTING', 'EDGEHOME', pop_customer, 'Old ERP name', true,
    '{"address1":"Old address","pop_note":"keep"}', '{"history":"keep"}');

  insert into coldlion.sync_run (id, endpoint, requested_by)
  values ('69980600-0000-4000-8000-000000000001', '/customers', '6998-shared-contract');

  insert into coldlion.customer (
    company_code, customer_code, customer_desc, active, address1, run_id, fetched_at,
    source_hash, first_seen_at, last_seen_at
  )
  values
    ('EDGEHOME', 'TEST6998-SHARED-EXISTING', 'Current ERP name', 'N', null,
      '69980600-0000-4000-8000-000000000001', now(), repeat('1',64), now(), now()),
    ('EDGEHOME', 'TEST6998-SHARED-NEW', 'New ERP customer', 'Y', 'Source contact stays in landing',
      '69980600-0000-4000-8000-000000000001', now(), repeat('2',64), now(), now()),
    ('OTHER', 'TEST6998-SHARED-NEW', 'Another company', 'N', null,
      '69980600-0000-4000-8000-000000000001', now(), repeat('3',64), now(), now());

  select designflow_customer_id into strict existing_id
  from plm.erp_customer where customer_code = 'TEST6998-SHARED-EXISTING';
  select designflow_customer_id into strict new_id
  from plm.erp_customer where customer_code = 'TEST6998-SHARED-NEW';

  assert existing_id < 0 and new_id < 0 and existing_id <> new_id;
  assert exists (
    select 1 from plm.erp_customer where customer_code = 'TEST6998-SHARED-EXISTING'
      and name = 'Current ERP name' and not active
      and address = '{"address1":"Old address","pop_note":"keep"}' and raw = '{"history":"keep"}'
      and customer_id is not distinct from pop_customer
  ), 'The landing refresh changed a POP field or failed to update the ERP fields';

  assert exists (
    select 1 from plm.erp_customer where customer_code = 'TEST6998-SHARED-NEW'
      and name = 'New ERP customer' and active and customer_id is null
      and address = '{}' and phone is null and fax is null
  ), 'Customer reconciliation linked a new code without POP authority or chose another company';

  assert exists (
    select 1 from core."externalCustomer" where "customerCode" = 'TEST6998-SHARED-EXISTING'
      and "customerDesc" = 'Current ERP name' and active = 'N' and id = existing_id
  ), 'DesignFlow dropped an inactive customer';

  update coldlion.customer set active = 'N'
  where company_code = 'EDGEHOME' and customer_code = 'TEST6998-SHARED-NEW';

  assert exists (
    select 1 from core."externalCustomer"
    where "customerCode" = 'TEST6998-SHARED-NEW' and active = 'N' and id = new_id
  ), 'The landing update did not reach DesignFlow through the shared table';

  update plm.erp_customer set landing_customer_details =
    jsonb_set(landing_customer_details, '{customer_desc}', '"Read-through proof"')
  where customer_code = 'TEST6998-SHARED-NEW';

  assert exists (
    select 1 from core."externalCustomer" where "customerCode" = 'TEST6998-SHARED-NEW'
      and "customerDesc" = 'Read-through proof'
  ), 'DesignFlow is not reading the shared table';
end;
$test$;

rollback;
