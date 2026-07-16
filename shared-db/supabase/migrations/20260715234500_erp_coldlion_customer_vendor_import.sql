-- Coldlion ERP (Edge Home) customer + vendor import machinery.
--
-- What this does
-- --------------
-- Adds the "silver" typed mirrors and idempotent resolver functions that pull the
-- Coldlion CLAPIServerEhp /customers and /vendors masters into the shared backend,
-- following the already-proven plm.import_master_data() customer pattern:
--
--   Coldlion API (source of record)
--        v
--   ingest.raw_record         <- every row, exact payload, append/replace by natural key
--   plm.erp_customer          <- NEW typed customer mirror (all 836 rows, active + inactive)
--   plm.erp_vendor            <- NEW typed vendor mirror   (all 539 rows, active + inactive)
--        v  (active='Y' only, per product decision 2026-07-15)
--   core.customer  + core.company_source_ref   (canonical, source_system='coldlion')
--   core.factory   + core.factory_source_ref   (canonical, source_system='coldlion')
--
-- Promotion scope (deliberate): ONLY records flagged active='Y' in Coldlion are
-- resolved into the canonical core.customer / core.factory hubs (the rows the CRM /
-- PM / DAM apps read). Inactive/dormant ERP accounts still land in ingest.raw_record
-- and the typed plm mirror (with a NULL canonical link) so nothing is lost and they
-- can be promoted later by a one-line change, but they do not flood the app UIs.
--
-- Idempotent: all writes are upserts keyed on the Coldlion natural key
-- (customerCode / vendorCode). Re-running a pull only refreshes; it never duplicates.
-- Canonical matching is by normalized name so re-pulls and the existing 139 customers
-- (designflow_plm + directus) are de-duplicated, never re-created.
--
-- Source labels: source_system='coldlion', source_table='customers'|'vendors',
-- source_id = customerCode|vendorCode. This is a NEW source ref that sits alongside
-- the existing 'designflow_plm' and 'directus' refs on the same canonical rows.
--
-- Safety: additive only (new tables + functions). No existing object is altered or
-- dropped. The actual API pull + function call is an operational step run separately
-- with the service role AFTER this migration is applied; migrations never call the
-- external API.

-- 1. Typed customer mirror -----------------------------------------------------

create table plm.erp_customer (
  customer_code        text primary key,          -- Coldlion customerCode (natural key)
  company_code         text,                       -- Coldlion companyCode (EDGEHOME)
  customer_id          uuid references core.customer(id) on delete set null, -- canonical link (NULL until/unless promoted)
  name                 text not null,              -- customerDesc
  dba                  text,                       -- customerDBA
  active               boolean not null default false,
  parent_customer_code text,
  customer_type_code   text,
  ar_customer_code     text,
  old_customer_code    text,
  address              jsonb not null default '{}'::jsonb,
  phone                text,
  fax                  text,
  region_code          text,
  salesperson_code_1   text,
  salesperson_code_2   text,
  commission_perc_1    numeric,
  commission_perc_2    numeric,
  factor_code          text,
  currency_code        text,
  gl_code              text,
  erp_created_at       timestamptz,                -- Coldlion createdTime
  erp_updated_at       timestamptz,                -- Coldlion modTime
  raw                  jsonb not null default '{}'::jsonb,
  imported_at          timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index plm_erp_customer_customer_idx on plm.erp_customer (customer_id);
create index plm_erp_customer_active_idx on plm.erp_customer (active);

create trigger set_updated_at before update on plm.erp_customer
  for each row execute function app.set_updated_at();

-- 2. Typed vendor mirror -------------------------------------------------------

create table plm.erp_vendor (
  vendor_code     text primary key,                -- Coldlion vendorCode (natural key)
  company_code    text,
  factory_id      uuid references core.factory(id) on delete set null, -- canonical link (NULL until/unless promoted)
  name            text not null,                   -- vendorDesc
  active          boolean not null default false,
  address         jsonb not null default '{}'::jsonb,
  phone           text,
  fax             text,
  email           text,
  country_code    text,
  pay_term_code   text,
  gl_code         text,
  separate_check  text,
  erp_created_at  timestamptz,
  erp_updated_at  timestamptz,
  raw             jsonb not null default '{}'::jsonb,
  imported_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index plm_erp_vendor_factory_idx on plm.erp_vendor (factory_id);
create index plm_erp_vendor_active_idx on plm.erp_vendor (active);

create trigger set_updated_at before update on plm.erp_vendor
  for each row execute function app.set_updated_at();

-- 3. Customer importer ---------------------------------------------------------

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
      continue;                     -- no natural key -> unusable, skip
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

    -- Bronze: raw landing (all rows, active or not)
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

    -- Gold: promote ONLY active customers into the canonical hub
    if v_active and v_name is not null then
      active_count := active_count + 1;

      -- (a) already linked via a Coldlion source ref?
      select csr.company_id into core_customer_id
      from core.company_source_ref csr
      where csr.source_system = 'coldlion'
        and csr.source_table = 'customers'
        and csr.source_id = v_code;

      -- (b) else match an existing canonical customer by normalized name
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
        -- (c) else create a new canonical customer (ERP-backed => not potential, active)
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
        -- Refresh ERP-backed status without clobbering CRM-curated fields.
        update core.customer
        set status       = 'active',
            is_potential = false,
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

    -- Silver: typed mirror (all rows; canonical link NULL when not promoted)
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

-- 4. Vendor importer -----------------------------------------------------------

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

      -- (a) already linked via a Coldlion source ref?
      select fsr.factory_id into core_factory_id
      from core.factory_source_ref fsr
      where fsr.source_system = 'coldlion'
        and fsr.source_table = 'vendors'
        and fsr.source_id = v_code;

      -- (b) else match an existing canonical factory by name (case/space-insensitive)
      if core_factory_id is null then
        select f.id into core_factory_id
        from core.factory f
        where lower(regexp_replace(f.name, '\s+', ' ', 'g')) = lower(regexp_replace(v_name, '\s+', ' ', 'g'))
        order by f.created_at
        limit 1;
      end if;

      was_matched := core_factory_id is not null;

      if not was_matched then
        -- (c) else create; code = Coldlion vendorCode. Guard the UNIQUE(code) in case
        --     a code somehow already exists, then fall back to matching on it.
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
        -- Refresh status without clobbering an existing (e.g. directus) code.
        update core.factory
        set status   = 'active',
            country  = coalesce(country, v_country),
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

-- 5. RLS + grants (mirror plm.customer_import: admin-read, service-role write) --

alter table plm.erp_customer enable row level security;
alter table plm.erp_vendor enable row level security;

create policy plm_erp_customer_admin_only on plm.erp_customer
  for all to authenticated
  using (app.has_role('administrator'))
  with check (app.has_role('administrator'));

create policy plm_erp_vendor_admin_only on plm.erp_vendor
  for all to authenticated
  using (app.has_role('administrator'))
  with check (app.has_role('administrator'));

grant select on plm.erp_customer to authenticated;
grant select on plm.erp_vendor to authenticated;
grant all on plm.erp_customer to service_role;
grant all on plm.erp_vendor to service_role;

revoke all on function plm.import_coldlion_customers(jsonb) from public;
revoke all on function plm.import_coldlion_vendors(jsonb) from public;
grant execute on function plm.import_coldlion_customers(jsonb) to service_role;
grant execute on function plm.import_coldlion_vendors(jsonb) to service_role;

-- 6. Comments ------------------------------------------------------------------

comment on table plm.erp_customer is
  'Typed Coldlion ERP (Edge Home) /customers mirror. Every Coldlion customer (active + inactive), keyed by customerCode. customer_id links to the canonical core.customer only for active accounts that were promoted (see plm.import_coldlion_customers). Faithful replica, safe to re-pull.';
comment on table plm.erp_vendor is
  'Typed Coldlion ERP (Edge Home) /vendors mirror. Every Coldlion vendor (active + inactive), keyed by vendorCode. factory_id links to the canonical core.factory (our "Vendor") only for active vendors that were promoted. Faithful replica, safe to re-pull.';
comment on function plm.import_coldlion_customers(jsonb) is
  'Idempotently imports a Coldlion /customers payload array: raw -> ingest.raw_record, typed -> plm.erp_customer, and (active=Y only) resolves into core.customer + core.company_source_ref (source_system=coldlion). Matches existing canonical customers by normalized name to avoid duplicates.';
comment on function plm.import_coldlion_vendors(jsonb) is
  'Idempotently imports a Coldlion /vendors payload array: raw -> ingest.raw_record, typed -> plm.erp_vendor, and (active=Y only) resolves into core.factory + core.factory_source_ref (source_system=coldlion). Matches existing factories by name to avoid duplicates.';
