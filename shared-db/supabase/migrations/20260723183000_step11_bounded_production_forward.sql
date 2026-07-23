-- Step 11 bounded forward promotion.
-- Replays only the preview-proven DAM customer-hub wiring, UUID-scoped path facets,
-- and PLM customer-status preservation under a timestamp newer than production.
-- This avoids --include-all and intentionally excludes every unrelated pending migration.

-- BEGIN FORWARD COPY: supabase\migrations\20260722210100_dam_customer_hub_wiring.sql
-- Wire all PopDAM customer lists onto the curated core.customer hub.
--
-- Background: DAM stores "customer" as free text in public.style_groups,
-- public.assets and public.style_tracker_rows, and builds its pickers/filters
-- from those strings. The canonical dam.style_group / dam.asset tables (which
-- carry a real company_id FK) are empty; the app runs on the public.* tables.
-- Reconciliation (docs/dam-customer-reconciliation.md): 92% of rows map to an
-- active hub customer by exact/alias match. This migration:
--   1. adds a durable customer_id FK to public.style_groups + public.assets,
--   2. adds the three real retailers missing from the hub (CVS/Costco/Meijer,
--      Albert-ruled "potential"),
--   3. seeds curated aliases (typos/variants + Four Seasons->4SGM, BCF->Burlington,
--      Goldenlink, Desperate Signs, Stock+HomeGoods user-error -> TJX),
--   4. sets display_name on active hub customers that only had ugly ERP names,
--   5. backfills customer_id via a single reusable resolver, deliberately leaving
--      Albert-ruled non-customers (Stallion, Stock, Multicustomer, Licensor
--      Requests, Nissan, NONE) and multi-customer comma cells UNLINKED,
--   6. exposes a curated customers-with-assets facet RPC for the Library filter.
--
-- Customer identity is never guessed: only exact/alias/explicit-prefix matches
-- link; everything else stays null and visibly free text for manual selection.
--
-- The assets backfill updates a large existing table; keep the longer allowance
-- local to this migration transaction rather than changing a database-wide
-- statement timeout.
set local statement_timeout = '10min';

-- 1. Durable FK columns -------------------------------------------------------
alter table public.style_groups
  add column if not exists customer_id uuid references core.customer(id) on delete set null;
alter table public.assets
  add column if not exists customer_id uuid references core.customer(id) on delete set null;

comment on column public.style_groups.customer_id is
  'Canonical customer (core.customer). Labels come from api.dam_customer_list; the legacy free-text customer column is retained for provenance only.';
comment on column public.assets.customer_id is
  'Canonical customer (core.customer). Labels come from api.dam_customer_list; the legacy free-text customer column is retained for provenance only.';

create index if not exists style_groups_customer_id_idx
  on public.style_groups (customer_id) where customer_id is not null;
create index if not exists assets_customer_id_idx
  on public.assets (customer_id) where customer_id is not null;

-- 2. Add the real retailers missing from the hub (Albert: "potential") --------
insert into core.customer (name, display_name, status, is_potential)
select v.name, v.name, 'potential'::app.entity_status, true
from (values ('CVS'), ('Costco'), ('Meijer')) as v(name)
where not exists (
  select 1 from core.customer c
  where lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(v.name), '\s+', ' ', 'g'))
);

-- 3. Curated aliases: free-text variant -> canonical hub customer -------------
-- Resolve each target by an unambiguous existing name/display_name so we never
-- hard-code a uuid. Insert only when that exact alias is not already present.
with seed(alias, target) as (
  values
    ('Kohl''s',              'KOHLS'),
    ('Books-a-Million',      'Books A Million'),
    ('Books-A-Million',      'Books A Million'),
    ('BAM',                  'Books A Million'),
    ('Sams Club',            'Sam''s Club'),
    ('Hobby Lobbby',         'HOBBY LOBBY LLC'),
    ('Barnes and Noble',     'Barnes & Noble'),
    ('Beall''s Outlets',     'BEALL''S OUTLET STORES INC'),
    ('5 Below',              'Five Below'),
    ('DD''s',                'DD''S DISCOUNT SUPPLIERS'),
    ('dd''s',                'DD''S DISCOUNT SUPPLIERS'),
    ('DD',                   'DD''S DISCOUNT SUPPLIERS'),
    ('Ollie''s',             'OLLIE''S BARGAIN OUTLET INC'),
    ('Christmas Tree Shops', 'CHRISTMAS TREE SHOPS INC'),
    ('Spirit of Halloween',  'Spirit Halloween'),
    ('Spirit Halloween Christmas', 'Spirit Halloween'),
    ('Spirit of Christmas',  'Spirit Halloween'),
    ('Gabriel Bros',         'Gabes'),
    ('Shoppers Worlds',      'SW GROUP-SHOPPERS WORLD'),
    ('IKONICK',              'IKONICK.COM'),
    ('Rooms 2 Go',           'Rooms to Go'),
    ('TJMaxx',               'TJX'),
    ('TJX Giftables',        'TJX'),
    ('BCF',                  'Burlington'),
    ('Ltd Commodities',      'LTD COMMODITIES LLC'),
    ('Bed Bath and Beyond',  'BED BATH & BEYOND'),
    ('Goldenlink',           'Golden Link Inc. DBA Only In Theatres'),
    ('Desperate Signs',      'Desperate Enterprises Billing'),
    ('Four Seasons',         'FOUR SEASONS GENERAL MERCH'),
    ('Stock, HomeGoods',     'TJX')
),
resolved as (
  select distinct on (
    c.id,
    lower(regexp_replace(trim(s.alias), '\s+', ' ', 'g'))
  ) s.alias, c.id as customer_id
  from seed s
  join core.customer c
    on lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(s.target), '\s+', ' ', 'g'))
  order by c.id, lower(regexp_replace(trim(s.alias), '\s+', ' ', 'g')), s.alias
)
insert into core.customer_alias (customer_id, alias, alias_type, source_system, notes)
select r.customer_id, r.alias,
       'other', 'popdam3',
       'Seeded 2026-07-22 to link legacy DAM free-text customer values to the hub.'
from resolved r
where not exists (
  select 1 from core.customer_alias a
  where a.customer_id = r.customer_id
    and a.normalized_alias = lower(regexp_replace(trim(r.alias), '\s+', ' ', 'g'))
);

-- 4. Give ugly-but-active hub customers a clean picker label -------------------
update core.customer c set display_name = v.label
from (values
  ('HOBBY LOBBY LLC',                        'Hobby Lobby'),
  ('HOT TOPIC MERCHANDISCING INC',           'Hot Topic'),
  ('KOHLS',                                  'Kohl''s'),
  ('Golden Link Inc. DBA Only In Theatres',  'Goldenlink'),
  ('CHRISTMAS TREE SHOPS INC',               'Christmas Tree Shops'),
  ('Five Below',                             'Five Below'),
  ('Gabes',                                  'Gabes'),
  ('SW GROUP-SHOPPERS WORLD',                'Shoppers World'),
  ('Rooms to Go',                            'Rooms to Go'),
  ('Barnes & Noble',                         'Barnes & Noble')
) as v(name, label)
where c.name = v.name and (c.display_name is null or c.display_name = '');

-- 5. Reusable resolver + backfill --------------------------------------------
-- Maps a free-text customer string to a canonical customer id. Exact matches on
-- name/display_name/alias win; a longest explicit-prefix match (e.g.
-- "Burlington - BGP6ASSSS01") resolves style-code suffixes. Values containing a
-- comma are never prefix-matched, so multi-customer cells stay unlinked.
create or replace function public.dam_resolve_customer(p_text text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with n as (select lower(regexp_replace(trim(coalesce(p_text, '')), '\s+', ' ', 'g')) as t),
  nc as (
    select c.id,
      lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')) as nname,
      lower(regexp_replace(trim(coalesce(c.display_name, '')), '\s+', ' ', 'g')) as dname
    from core.customer c
  ),
  na as (
    select a.customer_id as id, lower(regexp_replace(trim(a.alias), '\s+', ' ', 'g')) as aname
    from core.customer_alias a
  ),
  cand as (
    select nc.id, 100 as pri, length(nc.nname) as keylen from n, nc where nc.nname = n.t
    union all
    select nc.id, 100, length(nc.dname) from n, nc where nc.dname <> '' and nc.dname = n.t
    union all
    select na.id, 100, length(na.aname) from n, na where na.aname = n.t
    union all
    select nc.id, 50, length(nc.nname) from n, nc
      where position(',' in n.t) = 0 and length(nc.nname) >= 3
        and (n.t like nc.nname || ' %' or n.t like nc.nname || '-%')
    union all
    select nc.id, 50, length(nc.dname) from n, nc
      where position(',' in n.t) = 0 and nc.dname <> '' and length(nc.dname) >= 3
        and (n.t like nc.dname || ' %' or n.t like nc.dname || '-%')
    union all
    select na.id, 50, length(na.aname) from n, na
      where position(',' in n.t) = 0 and length(na.aname) >= 3
        and (n.t like na.aname || ' %' or n.t like na.aname || '-%')
  )
  select id from cand
  where (select t from n) <> ''
  order by pri desc, keylen desc
  limit 1
$function$;

comment on function public.dam_resolve_customer(text) is
  'Best-effort map of a legacy free-text DAM customer string to core.customer.id. Exact name/display/alias match, else longest explicit-prefix match; comma (multi-customer) values are never prefix-matched. Returns null when no confident match.';

with customer_map as materialized (
  select d.customer, public.dam_resolve_customer(d.customer) as customer_id
  from (
    select distinct customer from public.style_groups
    where customer_id is null and nullif(trim(customer), '') is not null
  ) d
)
update public.style_groups s
  set customer_id = m.customer_id
  from customer_map m
  where s.customer_id is null and s.customer = m.customer and m.customer_id is not null;

with customer_map as materialized (
  select d.customer, public.dam_resolve_customer(d.customer) as customer_id
  from (
    select distinct customer from public.assets
    where customer_id is null and nullif(trim(customer), '') is not null
  ) d
)
update public.assets a
  set customer_id = m.customer_id
  from customer_map m
  where a.customer_id is null and a.customer = m.customer and m.customer_id is not null;

-- Extend style_tracker_rows coverage using the new aliases. Suspend the audit
-- trigger so this backfill does not generate a customer-change event per row
-- (matches how the original 20260721143000 backfill ran before the trigger).
alter table public.style_tracker_rows disable trigger trg_style_tracker_row_audit;
with customer_map as materialized (
  select d.customer, public.dam_resolve_customer(d.customer) as customer_id
  from (
    select distinct customer from public.style_tracker_rows
    where customer_id is null and nullif(trim(customer), '') is not null
  ) d
)
update public.style_tracker_rows s
  set customer_id = m.customer_id
  from customer_map m
  where s.customer_id is null and s.customer = m.customer and m.customer_id is not null;
alter table public.style_tracker_rows enable trigger trg_style_tracker_row_audit;

-- 6. Curated Library filter facet — only hub customers that have DAM assets ----
create or replace function public.get_dam_customer_facets()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.label, 'count', f.cnt)
                            order by f.label), '[]'::jsonb)
  from (
    select d.id, coalesce(d.display_name, d.name) as label, count(*) as cnt
    from (
      select customer_id from public.style_groups where customer_id is not null
      union all
      select customer_id from public.assets where customer_id is not null
    ) u
    join api.dam_customer_list d on d.id = u.customer_id
    group by d.id, coalesce(d.display_name, d.name)
  ) f
$function$;

comment on function public.get_dam_customer_facets() is
  'Curated Library customer filter: active/potential hub customers (api.dam_customer_list) that have at least one DAM style_group or asset, with counts. Canonical labels; replaces the free-text get_path_facets customer list.';

grant execute on function public.dam_resolve_customer(text) to authenticated, service_role;
grant execute on function public.get_dam_customer_facets() to authenticated, service_role;

notify pgrst, 'reload schema';
-- END FORWARD COPY: supabase\migrations\20260722210100_dam_customer_hub_wiring.sql

-- BEGIN FORWARD COPY: supabase\migrations\20260722222000_dam_path_facets_by_customer_id.sql
-- Scope DAM Library "program" facets by the canonical customer_id FK.
--
-- The Library customer filter now selects a core.customer id (from
-- api.dam_customer_list) instead of a free-text customer string, and the customer
-- option list comes from get_dam_customer_facets (20260722210000). get_path_facets
-- therefore no longer needs to emit customers or key off free text — it only
-- scopes the program list to the selected customer via style_groups.customer_id.
--
-- Replaces the legacy get_path_facets(p_customer text) signature.

drop function if exists public.get_path_facets(text);

create or replace function public.get_path_facets(p_customer_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select jsonb_build_object(
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object('name', program, 'count', cnt) order by program)
      from (
        select program, count(*) as cnt
        from style_groups
        where program is not null
          and (p_customer_id is null or customer_id = p_customer_id)
        group by program
      ) p
    ), '[]'::jsonb)
  );
$function$;

comment on function public.get_path_facets(uuid) is
  'DAM Library program facets, optionally scoped to a core.customer id via style_groups.customer_id. Customer options come from get_dam_customer_facets, not this function.';

grant execute on function public.get_path_facets(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
-- END FORWARD COPY: supabase\migrations\20260722222000_dam_path_facets_by_customer_id.sql

-- BEGIN FORWARD COPY: supabase\migrations\20260723140000_plm_import_master_data_preserve_customer_status.sql
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
-- END FORWARD COPY: supabase\migrations\20260723140000_plm_import_master_data_preserve_customer_status.sql

