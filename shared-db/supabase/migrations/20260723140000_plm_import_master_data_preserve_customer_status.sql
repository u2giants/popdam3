-- Step 11 tranche 1: preserve curated global core.customer.status on PLM re-pull.
--
-- Why
-- ---
-- plm.import_master_data() previously force-set core.customer.status from DesignFlow
-- customers_status on EVERY matched row. That undoes human curation in DB Data Admin
-- (and any other global status edit) the next time the PLM master-data sync runs.
-- Coldlion's customer importer already preserves status on match
-- (20260716140000_erp_coldlion_status_app_owned.sql); this migration makes the PLM
-- importer match that contract.
--
-- What changes
-- ------------
-- Replaces plm.import_master_data(jsonb, jsonb):
--   * NEW core.customer rows still receive status from customers_status (ACTIVE→active,
--     else inactive).
--   * EXISTING matched rows keep whatever global status we already have — re-pulls
--     never touch core.customer.status.
--   * PLM raw status continues to land in plm.customer_import.status (application
--     context / mirror), source refs, and ingest.raw_record.
--   * Licensor/property paths are unchanged in this tranche.
--
-- Safety
-- ------
-- Additive function body replace only. No table changes. Preview-first. Do NOT promote
-- to production in Step 11 without an approved window. Do NOT restart the currently
-- failing PLM sync as part of this change.
create or replace function plm.import_master_data(
  licensors_payload jsonb,
  customers_payload jsonb
)
returns table (
  sync_run_id uuid,
  licensors_seen integer,
  properties_seen integer,
  customers_seen integer,
  raw_records_upserted integer
)
language plpgsql
security definer
set search_path = app, core, ingest, plm, extensions, public
as $$
declare
  sync_id uuid;
  licensor_row jsonb;
  property_row jsonb;
  customer_row jsonb;
  sanitized jsonb;
  v_source_id text;
  v_source_code text;
  v_source_name text;
  status_value app.entity_status;
  core_company_id uuid;
  v_match_id uuid;
  v_review_id uuid;
  v_review_sim real;
  v_erp_domain text;
  core_licensor_id uuid;
  core_property_id uuid;
  parent_core_licensor_id uuid;
  licensor_count integer := 0;
  property_count integer := 0;
  customer_count integer := 0;
  raw_count integer := 0;
begin
  if jsonb_typeof(coalesce(licensors_payload, '[]'::jsonb)) <> 'array' then
    raise exception 'licensors_payload must be a JSON array';
  end if;

  if jsonb_typeof(coalesce(customers_payload, '[]'::jsonb)) <> 'array' then
    raise exception 'customers_payload must be a JSON array';
  end if;

  insert into ingest.sync_run (
    source_system,
    source_name,
    status,
    started_at,
    metadata
  )
  values (
    'designflow_plm',
    'plm_master_data_api',
    'running',
    now(),
    jsonb_build_object(
      'licensors_endpoint', 'getLicensorsWithProperties',
      'customers_endpoint', 'getCustomers'
    )
  )
  returning id into sync_id;

  for customer_row in
    select value
    from jsonb_array_elements(coalesce(customers_payload, '[]'::jsonb))
  loop
    v_source_id := nullif(customer_row ->> 'customers_id', '');
    v_source_code := nullif(customer_row ->> 'customers_code', '');
    v_source_name := nullif(customer_row ->> 'customers_name', '');
    sanitized := customer_row - 'customers_passw';

    if v_source_id is null or v_source_name is null then
      continue;
    end if;

    customer_count := customer_count + 1;
    status_value := case
      when upper(coalesce(customer_row ->> 'customers_status', '')) = 'ACTIVE' then 'active'::app.entity_status
      else 'inactive'::app.entity_status
    end;

    select csr.company_id
    into core_company_id
    from core.company_source_ref csr
    where csr.source_system = 'designflow_plm'
      and csr.source_table = 'customers'
      and csr.source_id = (customer_row ->> 'customers_id');

    -- Fuzzy entity resolution: exact name -> exact domain -> high-similarity name.
    -- A mid-band similarity is NOT auto-merged; it is flagged for human review.
    if core_company_id is null then
      v_erp_domain := lower(split_part(nullif(customer_row ->> 'customers_email', ''), '@', 2));
      select m.match_id, m.review_id, m.review_sim
        into v_match_id, v_review_id, v_review_sim
      from core.match_customer(v_source_name, v_erp_domain) m;
      core_company_id := v_match_id;
    end if;

    if core_company_id is null then
      insert into core.customer (
        name,
        company_type,
        status,
        phone,
        metadata
      )
      values (
        v_source_name,
        'customer',
        status_value,
        nullif(customer_row ->> 'customers_phonenum', ''),
        jsonb_build_object(
          'plm_customer_code', v_source_code,
          'plm_import_source', 'designflow_plm'
        )
      )
      returning id into core_company_id;
    else
      -- STATUS is app-owned: do NOT reset it here (survives re-pull).
      -- PLM customers_status continues to land in plm.customer_import.status
      -- as read-only application context for DB Data Admin / DesignFlow.
      update core.customer
      set name = v_source_name,
          phone = coalesce(nullif(customer_row ->> 'customers_phonenum', ''), phone),
          metadata = metadata
            || jsonb_build_object(
              'plm_customer_code', v_source_code,
              'plm_import_source', 'designflow_plm'
            )
      where id = core_company_id;
    end if;

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
      core_company_id,
      'designflow_plm',
      'customers',
      v_source_id,
      v_source_code,
      v_source_name,
      'verified',
      sanitized
    )
    on conflict (source_system, source_table, source_id) do update
    set company_id = excluded.company_id,
        source_code = excluded.source_code,
        source_name = excluded.source_name,
        confidence = excluded.confidence,
        raw = excluded.raw;

    if v_review_id is not null then
      insert into ingest.dedupe_candidate (
        entity_schema, entity_table, left_entity_id, right_entity_id,
        source_system, confidence, reason, raw
      )
      values (
        'core', 'customer', core_company_id, v_review_id,
        'designflow_plm', 'possible',
        format('Fuzzy name match %s between ERP customer "%s" and an existing potential customer; review for merge.', round(v_review_sim::numeric, 2), v_source_name),
        jsonb_build_object('erp_customer_id', v_source_id, 'erp_name', v_source_name, 'similarity', v_review_sim)
      );
    end if;

    insert into plm.customer_import (
      plm_customer_id,
      company_id,
      customer_code,
      customer_name,
      status,
      email,
      phone,
      dilution,
      logistic_load,
      logo_url,
      airbyte_customers_hashid,
      airbyte_emitted_at,
      raw,
      imported_at
    )
    values (
      v_source_id,
      core_company_id,
      v_source_code,
      v_source_name,
      nullif(customer_row ->> 'customers_status', ''),
      nullif(customer_row ->> 'customers_email', '')::extensions.citext,
      nullif(customer_row ->> 'customers_phonenum', ''),
      nullif(customer_row ->> 'customers_dilution', '')::numeric,
      nullif(customer_row ->> 'customers_logistic_load', '')::numeric,
      nullif(customer_row ->> 'customers_logo', ''),
      nullif(customer_row ->> 'customers_airbyte_customers_hashid', ''),
      nullif(customer_row ->> 'customers_airbyte_emitted_at', '')::timestamptz,
      sanitized,
      now()
    )
    on conflict (plm_customer_id) do update
    set company_id = excluded.company_id,
        customer_code = excluded.customer_code,
        customer_name = excluded.customer_name,
        status = excluded.status,
        email = excluded.email,
        phone = excluded.phone,
        dilution = excluded.dilution,
        logistic_load = excluded.logistic_load,
        logo_url = excluded.logo_url,
        airbyte_customers_hashid = excluded.airbyte_customers_hashid,
        airbyte_emitted_at = excluded.airbyte_emitted_at,
        raw = excluded.raw,
        imported_at = excluded.imported_at;

    insert into ingest.raw_record (
      sync_run_id,
      source_system,
      source_table,
      source_id,
      record_hash,
      payload,
      imported_at
    )
    values (
      sync_id,
      'designflow_plm',
      'customers',
      v_source_id,
      md5(sanitized::text),
      sanitized,
      now()
    )
    on conflict (source_system, source_table, source_id) do update
    set sync_run_id = excluded.sync_run_id,
        record_hash = excluded.record_hash,
        payload = excluded.payload,
        imported_at = excluded.imported_at;

    raw_count := raw_count + 1;
  end loop;

  for licensor_row in
    select value
    from jsonb_array_elements(coalesce(licensors_payload, '[]'::jsonb))
  loop
    v_source_id := nullif(licensor_row ->> 'id', '');
    v_source_code := nullif(coalesce(licensor_row ->> 'mg_code', licensor_row ->> 'mgCode2'), '');
    v_source_name := nullif(licensor_row ->> 'title', '');
    sanitized := licensor_row - 'properties';

    if v_source_id is null or v_source_name is null then
      continue;
    end if;

    licensor_count := licensor_count + 1;

    select tsr.entity_id
    into core_licensor_id
    from core.taxonomy_source_ref tsr
    where tsr.entity_schema = 'core'
      and tsr.entity_table = 'licensor'
      and tsr.source_system = 'designflow_plm'
      and tsr.source_table = 'merchGroup'
      and tsr.source_id = (licensor_row ->> 'id');

    if core_licensor_id is null and v_source_code is not null then
      select l.id
      into core_licensor_id
      from core.licensor l
      where l.code = v_source_code
      limit 1;
    end if;

    if core_licensor_id is null then
      select l.id
      into core_licensor_id
      from core.licensor l
      where lower(l.name) = lower(v_source_name)
      order by l.created_at
      limit 1;
    end if;

    if core_licensor_id is null then
      begin
        insert into core.licensor (name, code, status, metadata)
        values (
          v_source_name,
          v_source_code,
          'active',
          jsonb_build_object('plm_import_source', 'designflow_plm')
        )
        returning id into core_licensor_id;
      exception when unique_violation then
        select l.id
        into core_licensor_id
        from core.licensor l
        where (v_source_code is not null and l.code = v_source_code)
           or lower(l.name) = lower(v_source_name)
        order by l.created_at
        limit 1;
      end;
    else
      update core.licensor
      set name = v_source_name,
          code = coalesce(v_source_code, code),
          status = 'active',
          metadata = metadata || jsonb_build_object('plm_import_source', 'designflow_plm')
      where id = core_licensor_id;
    end if;

    insert into core.taxonomy_source_ref (
      entity_schema,
      entity_table,
      entity_id,
      source_system,
      source_table,
      source_id,
      source_code,
      source_name,
      confidence,
      raw
    )
    values (
      'core',
      'licensor',
      core_licensor_id,
      'designflow_plm',
      'merchGroup',
      v_source_id,
      v_source_code,
      v_source_name,
      'verified',
      sanitized
    )
    on conflict (source_system, source_table, source_id) do update
    set entity_schema = excluded.entity_schema,
        entity_table = excluded.entity_table,
        entity_id = excluded.entity_id,
        source_code = excluded.source_code,
        source_name = excluded.source_name,
        confidence = excluded.confidence,
        raw = excluded.raw;

    insert into plm.licensor_import (
      plm_licensor_id,
      licensor_id,
      title,
      mg_code,
      parent_id,
      division_code,
      mg_code2,
      mg_category,
      raw,
      imported_at
    )
    values (
      v_source_id,
      core_licensor_id,
      v_source_name,
      nullif(licensor_row ->> 'mg_code', ''),
      nullif(licensor_row ->> 'parent_id', ''),
      nullif(licensor_row ->> 'divisionCode', ''),
      nullif(licensor_row ->> 'mgCode2', ''),
      nullif(licensor_row ->> 'mgCategory', ''),
      sanitized,
      now()
    )
    on conflict (plm_licensor_id) do update
    set licensor_id = excluded.licensor_id,
        title = excluded.title,
        mg_code = excluded.mg_code,
        parent_id = excluded.parent_id,
        division_code = excluded.division_code,
        mg_code2 = excluded.mg_code2,
        mg_category = excluded.mg_category,
        raw = excluded.raw,
        imported_at = excluded.imported_at;

    insert into ingest.raw_record (
      sync_run_id,
      source_system,
      source_table,
      source_id,
      record_hash,
      payload,
      imported_at
    )
    values (
      sync_id,
      'designflow_plm',
      'merchGroup',
      v_source_id,
      md5(sanitized::text),
      sanitized,
      now()
    )
    on conflict (source_system, source_table, source_id) do update
    set sync_run_id = excluded.sync_run_id,
        record_hash = excluded.record_hash,
        payload = excluded.payload,
        imported_at = excluded.imported_at;

    raw_count := raw_count + 1;

    for property_row in
      select value
      from jsonb_array_elements(coalesce(licensor_row -> 'properties', '[]'::jsonb))
    loop
      v_source_id := nullif(property_row ->> 'id', '');
      v_source_code := nullif(coalesce(property_row ->> 'mg_code', property_row ->> 'mgCode2'), '');
      v_source_name := nullif(property_row ->> 'title', '');
      sanitized := property_row;
      parent_core_licensor_id := core_licensor_id;

      if v_source_id is null or v_source_name is null then
        continue;
      end if;

      property_count := property_count + 1;

      select tsr.entity_id
      into core_property_id
      from core.taxonomy_source_ref tsr
      where tsr.entity_schema = 'core'
        and tsr.entity_table = 'property'
        and tsr.source_system = 'designflow_plm'
        and tsr.source_table = 'merchGroup'
        and tsr.source_id = (property_row ->> 'id');

      if core_property_id is null and v_source_code is not null then
        select p.id
        into core_property_id
        from core.property p
        where p.licensor_id = parent_core_licensor_id
          and p.code = v_source_code
        limit 1;
      end if;

      if core_property_id is null then
        select p.id
        into core_property_id
        from core.property p
        where p.licensor_id = parent_core_licensor_id
          and lower(p.name) = lower(v_source_name)
        order by p.created_at
        limit 1;
      end if;

      if core_property_id is null then
        begin
          insert into core.property (licensor_id, name, code, status, metadata)
          values (
            parent_core_licensor_id,
            v_source_name,
            v_source_code,
            'active',
            jsonb_build_object('plm_import_source', 'designflow_plm')
          )
          returning id into core_property_id;
        exception when unique_violation then
          select p.id
          into core_property_id
          from core.property p
          where p.licensor_id = parent_core_licensor_id
            and (
              (v_source_code is not null and p.code = v_source_code)
              or lower(p.name) = lower(v_source_name)
            )
          order by p.created_at
          limit 1;
        end;
      else
        update core.property
        set licensor_id = parent_core_licensor_id,
            name = v_source_name,
            code = coalesce(v_source_code, code),
            status = 'active',
            metadata = metadata || jsonb_build_object('plm_import_source', 'designflow_plm')
        where id = core_property_id;
      end if;

      insert into core.taxonomy_source_ref (
        entity_schema,
        entity_table,
        entity_id,
        source_system,
        source_table,
        source_id,
        source_code,
        source_name,
        confidence,
        raw
      )
      values (
        'core',
        'property',
        core_property_id,
        'designflow_plm',
        'merchGroup',
        v_source_id,
        v_source_code,
        v_source_name,
        'verified',
        sanitized
      )
      on conflict (source_system, source_table, source_id) do update
      set entity_schema = excluded.entity_schema,
          entity_table = excluded.entity_table,
          entity_id = excluded.entity_id,
          source_code = excluded.source_code,
          source_name = excluded.source_name,
          confidence = excluded.confidence,
          raw = excluded.raw;

      insert into plm.property_import (
        plm_property_id,
        property_id,
        plm_parent_licensor_id,
        licensor_id,
        title,
        mg_code,
        parent_id,
        division_code,
        mg_code2,
        mg_category,
        raw,
        imported_at
      )
      values (
        v_source_id,
        core_property_id,
        nullif(property_row ->> 'parent_id', ''),
        parent_core_licensor_id,
        v_source_name,
        nullif(property_row ->> 'mg_code', ''),
        nullif(property_row ->> 'parent_id', ''),
        nullif(property_row ->> 'divisionCode', ''),
        nullif(property_row ->> 'mgCode2', ''),
        nullif(property_row ->> 'mgCategory', ''),
        sanitized,
        now()
      )
      on conflict (plm_property_id) do update
      set property_id = excluded.property_id,
          plm_parent_licensor_id = excluded.plm_parent_licensor_id,
          licensor_id = excluded.licensor_id,
          title = excluded.title,
          mg_code = excluded.mg_code,
          parent_id = excluded.parent_id,
          division_code = excluded.division_code,
          mg_code2 = excluded.mg_code2,
          mg_category = excluded.mg_category,
          raw = excluded.raw,
          imported_at = excluded.imported_at;

      insert into ingest.raw_record (
        sync_run_id,
        source_system,
        source_table,
        source_id,
        record_hash,
        payload,
        imported_at
      )
      values (
        sync_id,
        'designflow_plm',
        'merchGroup',
        v_source_id,
        md5(sanitized::text),
        sanitized,
        now()
      )
      on conflict (source_system, source_table, source_id) do update
      set sync_run_id = excluded.sync_run_id,
          record_hash = excluded.record_hash,
          payload = excluded.payload,
          imported_at = excluded.imported_at;

      raw_count := raw_count + 1;
    end loop;
  end loop;

  update ingest.sync_run
  set status = 'succeeded',
      finished_at = now(),
      rows_seen = licensor_count + property_count + customer_count,
      rows_inserted = licensor_count + property_count + customer_count,
      rows_updated = 0,
      rows_failed = 0,
      metadata = metadata || jsonb_build_object(
        'licensors_seen', licensor_count,
        'properties_seen', property_count,
        'customers_seen', customer_count,
        'raw_records_upserted', raw_count
      )
  where id = sync_id;

  return query
  select sync_id, licensor_count, property_count, customer_count, raw_count;
exception when others then
  if sync_id is not null then
    update ingest.sync_run
    set status = 'failed',
        finished_at = now(),
        error = sqlerrm
    where id = sync_id;
  end if;

  raise;
end;
$$;
comment on function plm.import_master_data(jsonb, jsonb) is
  'Idempotently imports Designflow PLM master data API payloads into core canonical rows, source refs, raw ingest records, and PLM import tables. Matched core.customer.status is app-owned and is never overwritten on re-pull; new rows still seed status from customers_status. PLM status context is stored on plm.customer_import.status.';

revoke all on function plm.import_master_data(jsonb, jsonb) from public;
grant execute on function plm.import_master_data(jsonb, jsonb) to service_role;