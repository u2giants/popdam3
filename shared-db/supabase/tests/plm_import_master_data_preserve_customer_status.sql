-- Rollback-safe contract test for migration
-- 20260723140000_plm_import_master_data_preserve_customer_status.sql
--
-- Proves:
--   1. Matched re-pull does NOT overwrite curated core.customer.status
--      (inactive stays inactive when PLM payload says ACTIVE).
--   2. Matched re-pull still updates plm.customer_import.status (PLM context).
--   3. Brand-new customer rows still seed status from customers_status.
--
-- Run against preview after the migration is applied. Fixtures roll back.
begin;

do $$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_existing_id uuid;
  v_new_plm_id text := 'step11-new-' || v_suffix;
  v_existing_plm_id text := 'step11-exist-' || v_suffix;
  v_status app.entity_status;
  v_import_status text;
  v_new_id uuid;
  v_seen integer;
begin
  -- ------------------------------------------------------------------
  -- Fixture: curated inactive customer already linked to DesignFlow PLM.
  -- ------------------------------------------------------------------
  insert into core.customer (
    name,
    company_type,
    status,
    display_name,
    metadata
  )
  values (
    'Step11 Status Preserve Existing ' || v_suffix,
    'customer',
    'inactive',
    'Step11 Existing ' || v_suffix,
    jsonb_build_object('test', 'plm_import_status_preserve', 'suffix', v_suffix)
  )
  returning id into v_existing_id;

  insert into core.company_source_ref (
    company_id,
    source_system,
    source_table,
    source_id,
    source_code,
    source_name,
    confidence,
    raw
  )
  values (
    v_existing_id,
    'designflow_plm',
    'customers',
    v_existing_plm_id,
    'S11X' || left(v_suffix, 4),
    'Step11 Status Preserve Existing ' || v_suffix,
    'verified',
    jsonb_build_object('test', true)
  );

  -- ------------------------------------------------------------------
  -- Re-pull: PLM says ACTIVE for the existing row; also includes a new ACTIVE
  -- customer and an empty licensor list.
  -- ------------------------------------------------------------------
  select customers_seen
  into v_seen
  from plm.import_master_data(
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object(
        'customers_id', v_existing_plm_id,
        'customers_code', 'S11X' || left(v_suffix, 4),
        'customers_name', 'Step11 Status Preserve Existing ' || v_suffix,
        'customers_status', 'ACTIVE',
        'customers_phonenum', '555-0100',
        'customers_email', 'step11-existing-' || v_suffix || '@example.test'
      ),
      jsonb_build_object(
        'customers_id', v_new_plm_id,
        'customers_code', 'S11N' || left(v_suffix, 4),
        'customers_name', 'Step11 Status Preserve New ' || v_suffix,
        'customers_status', 'ACTIVE',
        'customers_phonenum', '555-0101',
        'customers_email', 'step11-new-' || v_suffix || '@example.test'
      )
    )
  );

  if v_seen is distinct from 2 then
    raise exception 'expected customers_seen=2, got %', v_seen;
  end if;

  select status into v_status
  from core.customer
  where id = v_existing_id;

  if v_status is distinct from 'inactive'::app.entity_status then
    raise exception
      'matched re-pull overwrote curated status: expected inactive, got %',
      v_status;
  end if;

  select status into v_import_status
  from plm.customer_import
  where plm_customer_id = v_existing_plm_id;

  if upper(coalesce(v_import_status, '')) is distinct from 'ACTIVE' then
    raise exception
      'plm.customer_import.status should mirror PLM ACTIVE context, got %',
      v_import_status;
  end if;

  select c.id, c.status
  into v_new_id, v_status
  from core.company_source_ref csr
  join core.customer c on c.id = csr.company_id
  where csr.source_system = 'designflow_plm'
    and csr.source_table = 'customers'
    and csr.source_id = v_new_plm_id;

  if v_new_id is null then
    raise exception 'new customer from PLM payload was not created';
  end if;

  if v_status is distinct from 'active'::app.entity_status then
    raise exception
      'new customer should seed status=active from ACTIVE payload, got %',
      v_status;
  end if;

  -- ------------------------------------------------------------------
  -- Second re-pull with inactive PLM status must still leave curated
  -- inactive alone (and must not force active either).
  -- ------------------------------------------------------------------
  update core.customer
  set status = 'potential'
  where id = v_existing_id;

  perform plm.import_master_data(
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object(
        'customers_id', v_existing_plm_id,
        'customers_code', 'S11X' || left(v_suffix, 4),
        'customers_name', 'Step11 Status Preserve Existing ' || v_suffix,
        'customers_status', 'INACTIVE',
        'customers_phonenum', '555-0100'
      )
    )
  );

  select status into v_status
  from core.customer
  where id = v_existing_id;

  if v_status is distinct from 'potential'::app.entity_status then
    raise exception
      'second re-pull overwrote curated potential status: got %',
      v_status;
  end if;

  select status into v_import_status
  from plm.customer_import
  where plm_customer_id = v_existing_plm_id;

  if upper(coalesce(v_import_status, '')) is distinct from 'INACTIVE' then
    raise exception
      'plm.customer_import.status should mirror PLM INACTIVE context, got %',
      v_import_status;
  end if;

  raise notice 'plm_import_master_data_preserve_customer_status: OK (suffix=%)', v_suffix;
end;
$$;

rollback;
