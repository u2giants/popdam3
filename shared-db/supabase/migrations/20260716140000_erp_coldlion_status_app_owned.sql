-- Make core.customer/core.factory STATUS app-owned for Coldlion-imported rows.
--
-- Why
-- ---
-- The original importers (20260715234500) force `status = 'active'` on every
-- MATCHED canonical row on each pull. That means any manual inactivation done on
-- our side (marking a dormant ERP account inactive) would be silently reverted the
-- next time Coldlion is re-pulled. That violates the repo's standing rule that
-- app-side curation flags are OURS and must survive a re-pull
-- (see fix_schema_for_api.md, the `dismissed`-is-ours principle).
--
-- Coldlion's own `active` Y/N flag is unreliable for our purposes (~90% of the
-- accounts it reports active are dormant in reality), so `status` becomes the
-- authoritative, human-curated visibility signal on our side. Coldlion's raw flag
-- is still preserved verbatim in plm.erp_customer.active / plm.erp_vendor.active
-- and in ingest.raw_record for reference.
--
-- What changes
-- ------------
-- Both resolver functions are replaced with ONE line removed from each: the
-- `status = 'active'` assignment in the "matched existing row" UPDATE branch.
--   * NEW rows are still inserted with status='active' (a fresh ERP account starts
--     visible; you curate it down).
--   * EXISTING rows keep whatever status we've set — re-pulls never touch it.
--   * is_potential is still set false on match (a matched ERP account is a
--     confirmed real customer, independent of active/inactive).
-- Tables, policies, grants, and comments are unchanged.

-- Customer resolver ------------------------------------------------------------

create or replace function plm.import_coldlion_customers(customers_payload jsonb)
returns table (
  sync_run_id       uuid,
  customers_seen    integer,
  customers_active  integer,
  canonical_created integer,
  canonical_matched integer
)
language plpgsql
security definer
set search_path = app, core, ingest, plm, extensions, public
as $$
declare
  sync_id           uuid;
  customer_row      jsonb;
  v_code            text;
  v_name            text;
  v_active          boolean;
  v_address         jsonb;
  core_customer_id  uuid;
  was_matched       boolean;
  seen_count        integer := 0;
  active_count      integer := 0;
  created_count     integer := 0;
  matched_count     integer := 0;
begin
  if jsonb_typeof(coalesce(customers_payload, '[]'::jsonb)) <> 'array' then
    raise exception 'customers_payload must be a JSON array';
  end if;

  insert into ingest.sync_run (source_system, source_name, status, started_at, metadata)
  values ('coldlion', 'coldlion_customers_api', 'running', now(),
          jsonb_build_object('endpoint', '/customers', 'company_code', 'EDGEHOME'))
  returning id into sync_id;

  for customer_row in
    select value from jsonb_array_elements(coalesce(customers_payload, '[]'::jsonb))
  loop
    v_code := nullif(customer_row ->> 'customerCode', '');
    v_name := nullif(customer_row ->> 'customerDesc', '');
    v_active := upper(coalesce(customer_row ->> 'active', '')) = 'Y';

    if v_code is null then
      continue;
    end if;

    seen_count := seen_count + 1;

    v_address := jsonb_strip_nulls(jsonb_build_object(
      'address1', nullif(customer_row ->> 'address1', ''),
      'address2', nullif(customer_row ->> 'address2', ''),
      'address3', nullif(customer_row ->> 'address3', ''),
      'city',     nullif(customer_row ->> 'city', ''),
      'state',    nullif(customer_row ->> 'state', ''),
      'zip',      nullif(customer_row ->> 'zipCode', ''),
      'country',  nullif(customer_row ->> 'countryCode', ''),
      'region',   nullif(customer_row ->> 'regionCode', '')
    ));

    insert into ingest.raw_record (
      sync_run_id, source_system, source_table, source_id, record_hash, payload, imported_at
    )
    values (
      sync_id, 'coldlion', 'customers', v_code, md5(customer_row::text), customer_row, now()
    )
    on conflict (source_system, source_table, source_id) do update
    set sync_run_id = excluded.sync_run_id,
        record_hash = excluded.record_hash,
        payload     = excluded.payload,
        imported_at = excluded.imported_at;

    core_customer_id := null;

    if v_active and v_name is not null then
      active_count := active_count + 1;

      select csr.company_id into core_customer_id
      from core.company_source_ref csr
      where csr.source_system = 'coldlion'
        and csr.source_table = 'customers'
        and csr.source_id = v_code;

      if core_customer_id is null then
        select c.id into core_customer_id
        from core.customer c
        where c.company_type = 'customer'
          and c.normalized_name = lower(regexp_replace(v_name, '\s+', ' ', 'g'))
        order by c.created_at
        limit 1;
      end if;

      was_matched := core_customer_id is not null;

      if not was_matched then
        insert into core.customer (name, company_type, status, is_potential, phone, address, metadata)
        values (
          v_name, 'customer', 'active', false,
          nullif(customer_row ->> 'phoneNo', ''),
          v_address,
          jsonb_build_object('coldlion_customer_code', v_code, 'coldlion_import_source', 'coldlion')
        )
        returning id into core_customer_id;
        created_count := created_count + 1;
      else
        -- STATUS is app-owned: do NOT reset it here (survives re-pull).
        update core.customer
        set is_potential = false,
            phone        = coalesce(phone, nullif(customer_row ->> 'phoneNo', '')),
            address      = case when address = '{}'::jsonb or address is null then v_address else address end,
            metadata     = metadata || jsonb_build_object(
                             'coldlion_customer_code', v_code,
                             'coldlion_import_source', 'coldlion')
        where id = core_customer_id;
        matched_count := matched_count + 1;
      end if;

      insert into core.company_source_ref (
        company_id, source_system, source_table, source_id, source_code, source_name, confidence, raw
      )
      values (
        core_customer_id, 'coldlion', 'customers', v_code, v_code, v_name, 'verified', customer_row
      )
      on conflict (source_system, source_table, source_id) do update
      set company_id  = excluded.company_id,
          source_code = excluded.source_code,
          source_name = excluded.source_name,
          confidence  = excluded.confidence,
          raw         = excluded.raw;
    end if;

    insert into plm.erp_customer (
      customer_code, company_code, customer_id, name, dba, active,
      parent_customer_code, customer_type_code, ar_customer_code, old_customer_code,
      address, phone, fax, region_code,
      salesperson_code_1, salesperson_code_2, commission_perc_1, commission_perc_2,
      factor_code, currency_code, gl_code, erp_created_at, erp_updated_at, raw, imported_at
    )
    values (
      v_code,
      nullif(customer_row ->> 'companyCode', ''),
      core_customer_id,
      coalesce(v_name, v_code),
      nullif(customer_row ->> 'customerDBA', ''),
      v_active,
      nullif(customer_row ->> 'parentCustomerCode', ''),
      nullif(customer_row ->> 'customerTypeCode', ''),
      nullif(customer_row ->> 'aRCustomerCode', ''),
      nullif(customer_row ->> 'oldCustomerCode', ''),
      v_address,
      nullif(customer_row ->> 'phoneNo', ''),
      nullif(customer_row ->> 'faxNo', ''),
      nullif(customer_row ->> 'regionCode', ''),
      nullif(customer_row ->> 'salesPersonCode1', ''),
      nullif(customer_row ->> 'salesPersonCode2', ''),
      nullif(customer_row ->> 'commissionPerc1', '')::numeric,
      nullif(customer_row ->> 'commissionPerc2', '')::numeric,
      nullif(customer_row ->> 'factorCode', ''),
      nullif(customer_row ->> 'currencyCode', ''),
      nullif(customer_row ->> 'glCode', ''),
      nullif(customer_row ->> 'createdTime', '')::timestamptz,
      nullif(customer_row ->> 'modTime', '')::timestamptz,
      customer_row,
      now()
    )
    on conflict (customer_code) do update
    set company_code         = excluded.company_code,
        customer_id          = coalesce(excluded.customer_id, plm.erp_customer.customer_id),
        name                 = excluded.name,
        dba                  = excluded.dba,
        active               = excluded.active,
        parent_customer_code = excluded.parent_customer_code,
        customer_type_code   = excluded.customer_type_code,
        ar_customer_code     = excluded.ar_customer_code,
        old_customer_code    = excluded.old_customer_code,
        address              = excluded.address,
        phone                = excluded.phone,
        fax                  = excluded.fax,
        region_code          = excluded.region_code,
        salesperson_code_1   = excluded.salesperson_code_1,
        salesperson_code_2   = excluded.salesperson_code_2,
        commission_perc_1    = excluded.commission_perc_1,
        commission_perc_2    = excluded.commission_perc_2,
        factor_code          = excluded.factor_code,
        currency_code        = excluded.currency_code,
        gl_code              = excluded.gl_code,
        erp_created_at       = excluded.erp_created_at,
        erp_updated_at       = excluded.erp_updated_at,
        raw                  = excluded.raw,
        imported_at          = excluded.imported_at;
  end loop;

  update ingest.sync_run
  set status = 'succeeded', finished_at = now(),
      rows_seen = seen_count, rows_inserted = created_count,
      rows_updated = matched_count, rows_failed = 0,
      metadata = metadata || jsonb_build_object(
        'customers_seen', seen_count,
        'customers_active', active_count,
        'canonical_created', created_count,
        'canonical_matched', matched_count)
  where id = sync_id;

  return query select sync_id, seen_count, active_count, created_count, matched_count;
exception when others then
  if sync_id is not null then
    update ingest.sync_run set status = 'failed', finished_at = now(), error = sqlerrm where id = sync_id;
  end if;
  raise;
end;
$$;

-- Vendor resolver --------------------------------------------------------------

create or replace function plm.import_coldlion_vendors(vendors_payload jsonb)
returns table (
  sync_run_id       uuid,
  vendors_seen      integer,
  vendors_active    integer,
  canonical_created integer,
  canonical_matched integer
)
language plpgsql
security definer
set search_path = app, core, ingest, plm, extensions, public
as $$
declare
  sync_id         uuid;
  vendor_row      jsonb;
  v_code          text;
  v_name          text;
  v_active        boolean;
  v_country       text;
  v_address       jsonb;
  core_factory_id uuid;
  was_matched     boolean;
  seen_count      integer := 0;
  active_count    integer := 0;
  created_count   integer := 0;
  matched_count   integer := 0;
begin
  if jsonb_typeof(coalesce(vendors_payload, '[]'::jsonb)) <> 'array' then
    raise exception 'vendors_payload must be a JSON array';
  end if;

  insert into ingest.sync_run (source_system, source_name, status, started_at, metadata)
  values ('coldlion', 'coldlion_vendors_api', 'running', now(),
          jsonb_build_object('endpoint', '/vendors', 'company_code', 'EDGEHOME'))
  returning id into sync_id;

  for vendor_row in
    select value from jsonb_array_elements(coalesce(vendors_payload, '[]'::jsonb))
  loop
    v_code := nullif(vendor_row ->> 'vendorCode', '');
    v_name := nullif(vendor_row ->> 'vendorDesc', '');
    v_active := upper(coalesce(vendor_row ->> 'active', '')) = 'Y';
    v_country := nullif(vendor_row ->> 'countryCode', '');

    if v_code is null then
      continue;
    end if;

    seen_count := seen_count + 1;

    v_address := jsonb_strip_nulls(jsonb_build_object(
      'address1', nullif(vendor_row ->> 'address1', ''),
      'address2', nullif(vendor_row ->> 'address2', ''),
      'address3', nullif(vendor_row ->> 'address3', ''),
      'city',     nullif(vendor_row ->> 'city', ''),
      'state',    nullif(vendor_row ->> 'state', ''),
      'zip',      nullif(vendor_row ->> 'zipCode', ''),
      'country',  v_country
    ));

    insert into ingest.raw_record (
      sync_run_id, source_system, source_table, source_id, record_hash, payload, imported_at
    )
    values (
      sync_id, 'coldlion', 'vendors', v_code, md5(vendor_row::text), vendor_row, now()
    )
    on conflict (source_system, source_table, source_id) do update
    set sync_run_id = excluded.sync_run_id,
        record_hash = excluded.record_hash,
        payload     = excluded.payload,
        imported_at = excluded.imported_at;

    core_factory_id := null;

    if v_active and v_name is not null then
      active_count := active_count + 1;

      select fsr.factory_id into core_factory_id
      from core.factory_source_ref fsr
      where fsr.source_system = 'coldlion'
        and fsr.source_table = 'vendors'
        and fsr.source_id = v_code;

      if core_factory_id is null then
        select f.id into core_factory_id
        from core.factory f
        where lower(regexp_replace(f.name, '\s+', ' ', 'g')) = lower(regexp_replace(v_name, '\s+', ' ', 'g'))
        order by f.created_at
        limit 1;
      end if;

      was_matched := core_factory_id is not null;

      if not was_matched then
        begin
          insert into core.factory (name, code, status, country, metadata)
          values (
            v_name, v_code, 'active', v_country,
            jsonb_build_object('coldlion_vendor_code', v_code, 'coldlion_import_source', 'coldlion')
          )
          returning id into core_factory_id;
          created_count := created_count + 1;
        exception when unique_violation then
          select f.id into core_factory_id from core.factory f where f.code = v_code limit 1;
          matched_count := matched_count + 1;
        end;
      else
        -- STATUS is app-owned: do NOT reset it here (survives re-pull).
        update core.factory
        set country  = coalesce(country, v_country),
            metadata = metadata || jsonb_build_object(
                         'coldlion_vendor_code', v_code, 'coldlion_import_source', 'coldlion')
        where id = core_factory_id;
        matched_count := matched_count + 1;
      end if;

      insert into core.factory_source_ref (
        factory_id, source_system, source_table, source_id, source_code, confidence, raw
      )
      values (
        core_factory_id, 'coldlion', 'vendors', v_code, v_code, 'verified', vendor_row
      )
      on conflict (source_system, source_table, source_id) do update
      set factory_id  = excluded.factory_id,
          source_code = excluded.source_code,
          confidence  = excluded.confidence,
          raw         = excluded.raw;
    end if;

    insert into plm.erp_vendor (
      vendor_code, company_code, factory_id, name, active, address, phone, fax, email,
      country_code, pay_term_code, gl_code, separate_check, erp_created_at, erp_updated_at, raw, imported_at
    )
    values (
      v_code,
      nullif(vendor_row ->> 'companyCode', ''),
      core_factory_id,
      coalesce(v_name, v_code),
      v_active,
      v_address,
      nullif(vendor_row ->> 'phoneNo', ''),
      nullif(vendor_row ->> 'faxNo', ''),
      nullif(vendor_row ->> 'email', ''),
      v_country,
      nullif(vendor_row ->> 'payTermCode', ''),
      nullif(vendor_row ->> 'glCode', ''),
      nullif(vendor_row ->> 'separateCheck', ''),
      nullif(vendor_row ->> 'createdTime', '')::timestamptz,
      nullif(vendor_row ->> 'modTime', '')::timestamptz,
      vendor_row,
      now()
    )
    on conflict (vendor_code) do update
    set company_code   = excluded.company_code,
        factory_id     = coalesce(excluded.factory_id, plm.erp_vendor.factory_id),
        name           = excluded.name,
        active         = excluded.active,
        address        = excluded.address,
        phone          = excluded.phone,
        fax            = excluded.fax,
        email          = excluded.email,
        country_code   = excluded.country_code,
        pay_term_code  = excluded.pay_term_code,
        gl_code        = excluded.gl_code,
        separate_check = excluded.separate_check,
        erp_created_at = excluded.erp_created_at,
        erp_updated_at = excluded.erp_updated_at,
        raw            = excluded.raw,
        imported_at    = excluded.imported_at;
  end loop;

  update ingest.sync_run
  set status = 'succeeded', finished_at = now(),
      rows_seen = seen_count, rows_inserted = created_count,
      rows_updated = matched_count, rows_failed = 0,
      metadata = metadata || jsonb_build_object(
        'vendors_seen', seen_count,
        'vendors_active', active_count,
        'canonical_created', created_count,
        'canonical_matched', matched_count)
  where id = sync_id;

  return query select sync_id, seen_count, active_count, created_count, matched_count;
exception when others then
  if sync_id is not null then
    update ingest.sync_run set status = 'failed', finished_at = now(), error = sqlerrm where id = sync_id;
  end if;
  raise;
end;
$$;

comment on function plm.import_coldlion_customers(jsonb) is
  'Idempotently imports a Coldlion /customers payload: raw -> ingest.raw_record, typed -> plm.erp_customer, and (active=Y) resolves into core.customer + core.company_source_ref (source_system=coldlion). STATUS is app-owned: set on insert only, never reset on re-pull, so manual inactivation survives. Matches existing customers by normalized name.';
comment on function plm.import_coldlion_vendors(jsonb) is
  'Idempotently imports a Coldlion /vendors payload: raw -> ingest.raw_record, typed -> plm.erp_vendor, and (active=Y) resolves into core.factory + core.factory_source_ref (source_system=coldlion). STATUS is app-owned: set on insert only, never reset on re-pull. Matches existing factories by name.';
