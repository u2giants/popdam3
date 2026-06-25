-- Rename core.company -> core.customer (hard rename, no compatibility shim), add
-- the is_potential flag, and recreate the only objects that resolve the old name
-- at runtime.
--
-- Why a HARD rename
-- -----------------
-- core.customer holds ONLY customers. "company" is the wrong name and the wrong
-- bucket: a factory is a company, a licensor is a company, an email spammer is a
-- company, and none of those are customers. They have their own homes
-- (core.factory, core.licensor) and email noise lives in crm.ingested_domain.
-- There is to be NO object named core.company afterwards -- not even a view.
--
-- What this touches
-- -----------------
-- * The table rename carries its FKs (plm/dam/pim/crm), indexes, triggers, table
--   grants, RLS policies, and composite rowtype automatically.
-- * VIEWS that referenced core.company (api.crm_*, api.global_search, etc.) track
--   the table by object id, so after the rename their definitions read
--   core.customer with no action needed.
-- * Only PL/pgSQL FUNCTION bodies resolve names as text at runtime, so the two
--   that name core.company (api.crm_update_account, plm.import_master_data) are
--   recreated below against core.customer.
--
-- Potential vs active customer
-- ----------------------------
-- Active/confirmed customers are companies we have actually done business with;
-- their authoritative source is PLM/ERP (ColdLion) only. A row is active iff it
-- has a designflow_plm/coldlion source ref. Everything else (CRM/PM-created, or
-- promoted from an ingested domain) is a potential customer. is_potential makes
-- that explicit and is kept authoritative by core.sync_customer_potential().

-- 1. Rename. FKs, indexes, triggers, grants, RLS, and the rowtype follow the table.
alter table core.company rename to customer;
alter index if exists core_company_normalized_name_idx rename to core_customer_normalized_name_idx;
alter index if exists core_company_domain_idx rename to core_customer_domain_idx;
alter index if exists core_company_customer_status_idx rename to core_customer_customer_status_idx;
comment on table core.customer is 'Canonical customer (potential + active) across CRM, PM, DAM path metadata, and PLM. Active iff it has a PLM/ERP source ref (see is_potential). NOT a generic company list: factories live in core.factory, licensors in core.licensor, email noise in crm.ingested_domain.';

-- 2. Potential-customer flag. Default true: anything not ERP-verified is potential.
alter table core.customer
  add column if not exists is_potential boolean not null default true;
comment on column core.customer.is_potential is
  'true = potential customer (not in PLM/ERP). false = active customer (has a designflow_plm/coldlion source ref). Maintained by core.sync_customer_potential().';
create index if not exists core_customer_is_potential_idx on core.customer (is_potential);

-- 3. Backfill: anything already linked to ERP is active, not potential.
update core.customer c
set is_potential = false
where exists (
  select 1 from core.company_source_ref sr
  where sr.company_id = c.id
    and sr.source_system in ('designflow_plm', 'coldlion')
);

-- 4. Keep is_potential authoritative: attaching an ERP source ref => active customer.
create or replace function core.sync_customer_potential()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $fn$
begin
  if new.source_system in ('designflow_plm', 'coldlion') then
    update core.customer
    set is_potential = false
    where id = new.company_id and is_potential is distinct from false;
  end if;
  return new;
end;
$fn$;

drop trigger if exists sync_customer_potential on core.company_source_ref;
create trigger sync_customer_potential
  after insert or update on core.company_source_ref
  for each row execute function core.sync_customer_potential();

-- 5. Recreate api.crm_update_account against core.customer (its body named the
--    old table). Return type is the same renamed rowtype, so create-or-replace is
--    allowed and grants are preserved.
create or replace function api.crm_update_account(
  p_company_id uuid,
  p_name text default null,
  p_domain text default null,
  p_customer_status text default null,
  p_chain_type text default null,
  p_routing_aliases text default null,
  p_so_patterns text default null
)
returns core.customer
language plpgsql
security definer
set search_path = app, core, crm, public
as $fn$
declare
  result core.customer;
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  update core.customer c
  set
    name            = coalesce(p_name, c.name),
    domain          = coalesce(p_domain, c.domain),
    customer_status = coalesce(p_customer_status, c.customer_status),
    chain_type      = coalesce(p_chain_type, c.chain_type),
    routing_aliases = coalesce(p_routing_aliases, c.routing_aliases),
    so_patterns     = coalesce(p_so_patterns, c.so_patterns)
  where c.id = p_company_id
  returning c.* into result;

  if not found then
    raise exception 'crm: customer % not found', p_company_id using errcode = 'no_data_found';
  end if;

  return result;
end;
$fn$;

-- 6. Recreate plm.import_master_data against core.customer. Body is identical to
--    20260624173000_plm_master_data_import.sql except core.company -> core.customer
--    (core.company_source_ref is unchanged). is_potential is set to false
--    automatically by the sync_customer_potential trigger when the ERP source ref
--    is inserted below.
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

    if core_company_id is null then
      select c.id
      into core_company_id
      from core.customer c
      where c.company_type = 'customer'
        and c.normalized_name = lower(regexp_replace(v_source_name, '\s+', ' ', 'g'))
      order by c.created_at
      limit 1;
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
      update core.customer
      set name = v_source_name,
          status = status_value,
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

-- 7. Surface is_potential on the CRM accounts contract so the UI can tell
--    potential from active customers. Appending a column is create-or-replace safe.
create or replace view api.crm_account_list
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.domain,
  c.customer_status,
  c.chain_type,
  c.routing_aliases,
  c.so_patterns,
  c.company_type,
  c.status,
  c.primary_salesperson_profile_id,
  c.account_owner_profile_id,
  c.updated_at,
  c.is_potential
from core.customer c;
