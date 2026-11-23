-- #6998: maintain both legacy contracts while reading the same ColdLion rows.
begin;

do $test$
declare
  pair record;
  columns_sql constant text := '
    select array_agg(
      format(''%s %s'', attname, format_type(atttypid, atttypmod)) order by attnum
    )
    from pg_attribute
    where attrelid = $1 and attnum > 0 and not attisdropped';
  view_columns text[];
  archive_columns text[];
begin
  for pair in
    select * from (values
      ('core."externalCustomer"'::regclass, 'archive.external_customer_core_6998'::regclass),
      ('dflow_prod."externalCustomer"'::regclass, 'archive.external_customer_prod_6998'::regclass)
    ) as relations(reader, archived)
  loop
    execute columns_sql into view_columns using pair.reader;
    execute columns_sql into archive_columns using pair.archived;
    assert view_columns = archive_columns, 'DesignFlow customer columns or types changed';

    assert pg_relation_is_updatable(pair.reader, false) = 0, 'DesignFlow customer view permits writes';
  end loop;

  insert into archive.external_customer_core_6998 (id, "customerCode")
  overriding system value values (69981, 'TEST6998-EXISTING');
  insert into archive.external_customer_prod_6998 (id, "customerCode")
  overriding system value values (69982, 'TEST6998-EXISTING');

  assert has_table_privilege('designflow_prod_tracking_grants', 'dflow_prod."externalCustomer"', 'SELECT');
  assert has_table_privilege('designflow_prod_data_sync_grants', 'dflow_prod."externalCustomer"', 'SELECT');
  assert not has_table_privilege('designflow_prod_data_sync_grants', 'dflow_prod."externalCustomer"', 'INSERT');
  assert not has_table_privilege('designflow_prod_tracking_grants', 'coldlion.customer', 'SELECT');
  assert not has_table_privilege('designflow_prod_tracking_grants', 'archive.external_customer_prod_6998', 'SELECT');
  assert not has_sequence_privilege('designflow_prod_data_sync_grants', 'archive.external_customer_prod_6998_id_seq', 'USAGE');

  insert into coldlion.sync_run (id, endpoint, requested_by)
  values ('69980000-0000-4000-8000-000000000001', '/customers', '6998-contract');

  insert into coldlion.customer (
    company_code, customer_code, customer_desc, active, mod_time, run_id, fetched_at,
    source_hash, first_seen_at, last_seen_at
  )
  values
    ('EDGEHOME', 'TEST6998-INACTIVE', 'Inactive customer', 'N', null,
      '69980000-0000-4000-8000-000000000001', now(), repeat('1',64), now(), now()),
    ('OTHER', 'TEST6998-INACTIVE', 'Other company', 'Y', null,
      '69980000-0000-4000-8000-000000000001', now(), repeat('2',64), now(), now()),
    ('EDGEHOME', 'TEST6998-EXISTING', 'Existing customer', 'N', '2026-10-30 12:34:56.789+00',
      '69980000-0000-4000-8000-000000000001', now(), repeat('3',64), now(), now());

  perform set_config('TimeZone', 'America/New_York', true);
  assert (
    select id = 69981 and active = 'N' and "modTime" = '2026-10-30 12:34:56.789'
    from core."externalCustomer" where "customerCode" = 'TEST6998-EXISTING'
  ), 'Nonproduction changed the old customer ID or timestamp format';
  assert (
    select id = 69982 and active = 'N' and "modTime" = '2026-10-30 12:34:56.789'
    from dflow_prod."externalCustomer" where "customerCode" = 'TEST6998-EXISTING'
  ), 'Production changed the old customer ID or timestamp format';

  assert (
    select count(*) = 1 and bool_and(id < 0 and active = 'N')
    from core."externalCustomer" where "customerCode" = 'TEST6998-INACTIVE'
  ), 'Nonproduction hides inactive customers or includes another company';

  assert (
    select count(*) = 1 and bool_and(id < 0 and active = 'N')
    from dflow_prod."externalCustomer" where "customerCode" = 'TEST6998-INACTIVE'
  ), 'Production hides inactive customers or includes another company';

  assert (
    select p.id = c.id
    from dflow_prod."externalCustomer" p
    join core."externalCustomer" c using ("customerCode")
    where p."customerCode" = 'TEST6998-INACTIVE'
  ), 'New customer IDs differ across environments';
end;
$test$;

rollback;
