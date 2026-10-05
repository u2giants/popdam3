-- =====================================================================================
-- Issue #2176 - ColdLion landing UNIT 6: consumer-safe promotion contracts.
--
-- Tracker: #2081. Plan: plan_coldlion_landing_schema_completion.md section 9 Step 8.
-- Author lane claim: #3838. Reserved version: 20261005025111. Structure only; this
-- migration loads no rows.
--
-- WHAT THIS UNIT PUBLISHES
-- ------------------------
-- Application roles must remain unable to query coldlion.*. Authorized consumers read
-- reviewed fields only through stable contracts:
--
--   * customer / vendor / season / salesperson promotion extends the plm.erp_* path.
--     plm.erp_customer and plm.erp_vendor already exist and stay the promotion
--     destination; this unit creates plm.erp_season and plm.erp_salesperson additively
--     and their landing-to-mirror importers.
--   * merch_group_header/detail -> read-only candidates function only. Licensor/property
--     link stays hand-curated; codes are unique only per division+type, never alone.
--   * item_header / item_detail / item_merch_group, production history, prepack and
--     prod detail -> plm.* views.
--   * sales history -> plm.* aggregate view of approved per-design quantities only.
--     NO fulfilment inference from document-number presence. NO source-document type
--     claim: ColdLion exposes no source-document marker (plan section 6.6).
--   * item image metadata -> pim.* view (landing under #2179 / 20260929093750).
--   * pickticket and receiving are out of scope (owner 2026-09-13).
--   * schema coldlion keeps no app-role grants (closed posture, schema-level).
--
-- NEVER CREATED HERE
-- ------------------
--   plm.import_coldlion_vendors does NOT exist live (dropped by 20260722213000 in
--   favour of the guarded vendor importer). Vendor promotion uses that guarded path.
--   This migration does not invent, recreate, or assume it.
--
-- NO AUTOMATIC PROMOTION INTO core.*
-- ---------------------------------
-- Per the settled placement (issue #2176, 2026-09-28): no automatic promotion into
-- core.* without a separately reviewed authority rule. Season and salesperson
-- promotion stops at plm.erp_*.
--
-- LAYER RULES
-- -----------
--   * Views use security_invoker=false so they can read closed coldlion.* landing
--     tables on the consumer's behalf. Consumers never receive landing grants.
--   * No named indexes, triggers, or policies beyond primary keys: those objects are
--     outside claim #3838's write set.
--   * Landing provenance (run_id, source_hash, first_seen_at, fetched_at) stays out of
--     consumer contracts except last_seen_at as a currency marker.
--   * User-defined fields (udf*) stay out: their business meaning is not established.
--   * prod_detail.item_desc and prod_detail.merch_group_05_desc stay out of the
--     consumer contract: the landing comments mark them as not exposable without an
--     owner ruling.
-- =====================================================================================

do $$ begin
  if to_regclass('coldlion.sync_run') is null then
    raise exception 'ColdLion phase 1 spine is required before unit 6 consumer contracts';
  end if;
  if to_regclass('coldlion.item_header') is null then
    raise exception 'ColdLion item landing (20260825023430) is required before unit 6';
  end if;
  if to_regclass('plm.erp_customer') is null then
    raise exception 'plm.erp_customer (20260715234500) is required before unit 6';
  end if;
end $$;

-- =====================================================================================
-- 1. Schema coldlion stays closed to application roles.
--    Written at SCHEMA level so this unit never opens a write on any landing table.
-- =====================================================================================
revoke all on all tables in schema coldlion from public, anon, authenticated;
revoke usage on schema coldlion from public, anon, authenticated;
grant usage on schema coldlion to service_role;
grant select, insert, update, delete on all tables in schema coldlion to service_role;

-- =====================================================================================
-- 2. Customer / vendor promotion path already on main. Touch the durable contract
--    comments only; do not rewrite the live importer body.
-- =====================================================================================
comment on table plm.erp_customer is
  'Typed Coldlion ERP (Edge Home) /customers mirror and the customer promotion destination under issue #2176 unit 6. Every Coldlion customer (active + inactive), keyed by customerCode. customer_id links to the canonical core.customer only for active accounts that were promoted (see plm.import_coldlion_customers). Consumers read this table; they never read coldlion.customer. No automatic promotion into core.* beyond the existing importer contract.';

comment on table plm.erp_vendor is
  'Typed Coldlion ERP (Edge Home) /vendors mirror and the vendor promotion destination under issue #2176 unit 6. Every Coldlion vendor (active + inactive), keyed by vendorCode. factory_id links to the canonical core.factory only for active vendors promoted by the guarded vendor importer (20260722213000). plm.import_coldlion_vendors does NOT exist and must not be recreated. Consumers read this table; they never read coldlion.vendor.';

comment on function plm.import_coldlion_customers(jsonb) is
  'Idempotently imports a Coldlion /customers payload array: raw -> ingest.raw_record, typed -> plm.erp_customer, and (active=Y only) resolves into core.customer + core.company_source_ref (source_system=coldlion). Matches existing canonical customers by normalized name to avoid duplicates. Issue #2176 unit 6 keeps this as the customer promotion function; consumers read plm.erp_customer, never coldlion.customer.';

-- =====================================================================================
-- 3. Season promotion objects (additive). Natural key follows coldlion.season:
--    (company_code, division_code, season_code). /seasons exposes no active marker
--    and no separate name, and this unit invents neither.
-- =====================================================================================
create table plm.erp_season (
  company_code   text        not null,
  division_code  text        not null,
  season_code    text        not null,
  -- /seasons returns only the code. Name is the code; do not invent a label.
  name           text        not null,
  -- NULL: ColdLion has no active marker on this endpoint (landing comment).
  active         boolean,
  erp_created_at timestamptz,
  erp_updated_at timestamptz,
  raw            jsonb       not null default '{}'::jsonb,
  source_hash    text        not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  imported_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (company_code, division_code, season_code)
);

comment on table plm.erp_season is
  'Typed ColdLion /seasons mirror and the season promotion destination (issue #2176 unit 6). Grain is one season code within one division within one company - never season_code alone. name is the code because the endpoint exposes no separate label. active is NULL because ColdLion has no active marker here; none is invented and last_seen_at is never read as one. source_hash is SHA-256 over the complete fetched record before projection, carried from coldlion.season for idempotent re-pull change detection. Consumers read this table; they never read coldlion.season.';

create table plm.erp_salesperson (
  company_code     text        not null,
  salesperson_code text        not null,
  -- coldlion.salesperson.last_name under its own promoted name. Widening the
  -- personal-data projection requires a NEW owner ruling (#2081 comment 5519623574).
  name             text,
  active           boolean,
  erp_created_at   timestamptz,
  erp_updated_at   timestamptz,
  raw              jsonb       not null default '{}'::jsonb,
  source_hash      text        not null,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  imported_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (company_code, salesperson_code)
);

comment on table plm.erp_salesperson is
  'Typed ColdLion /salespersons mirror and the salesperson promotion destination (issue #2176 unit 6). Grain is one sales rep within one company - NOT division-scoped. Deliberately narrow by owner ruling #2081 comment 5519623574: name, code, company and active status only. name is coldlion.salesperson.last_name as returned (this layer does not compose a display name). active is interpreted from the feed single-character flag and is NULL when blank; never guessed. E-mail, telephone, home address, commission and quota stay declined as personal data. Widening requires a NEW owner ruling. Consumers read this table; they never read coldlion.salesperson.';

revoke all on plm.erp_season from public, anon;
revoke all on plm.erp_salesperson from public, anon;
grant select on plm.erp_season to authenticated;
grant select on plm.erp_salesperson to authenticated;
grant all on plm.erp_season to service_role;
grant all on plm.erp_salesperson to service_role;

-- =====================================================================================
-- 4. Season / salesperson landing-to-mirror importers.
--    Promote coldlion.season / coldlion.salesperson into plm.erp_*. No core.* write.
-- =====================================================================================
create or replace function plm.import_coldlion_seasons()
returns table (
  seasons_seen      integer,
  seasons_upserted  integer
)
language plpgsql
security definer
set search_path = plm, coldlion, extensions, public
as $$
declare
  v_seen     integer;
  v_upserted integer;
begin
  select count(*) into v_seen from coldlion.season;

  insert into plm.erp_season (
    company_code, division_code, season_code,
    name, active,
    erp_created_at, erp_updated_at,
    raw, source_hash, first_seen_at, last_seen_at
  )
  select
    s.company_code,
    s.division_code,
    s.season_code,
    s.season_code,
    null::boolean,
    s.created_time,
    s.mod_time,
    jsonb_build_object(
      'companyCode',  s.company_code,
      'divisionCode', s.division_code,
      'seasonCode',   s.season_code
    ),
    s.source_hash,
    s.first_seen_at,
    s.last_seen_at
  from coldlion.season s
  on conflict (company_code, division_code, season_code) do update set
    name           = excluded.name,
    erp_created_at = excluded.erp_created_at,
    erp_updated_at = excluded.erp_updated_at,
    raw            = excluded.raw,
    source_hash    = excluded.source_hash,
    last_seen_at   = excluded.last_seen_at,
    updated_at     = now();

  get diagnostics v_upserted = row_count;
  return query select v_seen, v_upserted;
end
$$;

comment on function plm.import_coldlion_seasons is
  'Promotes coldlion.season into plm.erp_season additively (issue #2176 unit 6). Upsert on (company_code, division_code, season_code). first_seen_at never moves forward. No core.* write and no invented active flag. Structure only until a loader calls it.';

create or replace function plm.import_coldlion_salespersons()
returns table (
  salespersons_seen     integer,
  salespersons_upserted integer
)
language plpgsql
security definer
set search_path = plm, coldlion, extensions, public
as $$
declare
  v_seen     integer;
  v_upserted integer;
begin
  select count(*) into v_seen from coldlion.salesperson;

  insert into plm.erp_salesperson (
    company_code, salesperson_code,
    name, active,
    erp_created_at, erp_updated_at,
    raw, source_hash, first_seen_at, last_seen_at
  )
  select
    s.company_code,
    s.salesperson_code,
    s.last_name,
    case
      when s.active is null or btrim(s.active) = '' then null
      when upper(btrim(s.active)) in ('Y', 'YES', 'TRUE', 'T', '1') then true
      else false
    end,
    s.created_time,
    s.mod_time,
    jsonb_build_object(
      'companyCode',      s.company_code,
      'salesPersonCode',  s.salesperson_code,
      'lastName',         s.last_name,
      'active',           s.active
    ),
    s.source_hash,
    s.first_seen_at,
    s.last_seen_at
  from coldlion.salesperson s
  on conflict (company_code, salesperson_code) do update set
    name           = excluded.name,
    active         = excluded.active,
    erp_created_at = excluded.erp_created_at,
    erp_updated_at = excluded.erp_updated_at,
    raw            = excluded.raw,
    source_hash    = excluded.source_hash,
    last_seen_at   = excluded.last_seen_at,
    updated_at     = now();

  get diagnostics v_upserted = row_count;
  return query select v_seen, v_upserted;
end
$$;

comment on function plm.import_coldlion_salespersons is
  'Promotes coldlion.salesperson into plm.erp_salesperson additively (issue #2176 unit 6). Upsert on (company_code, salesperson_code). Preserves the owner-approved narrow projection only (name, code, company, active). No core.* write. Structure only until a loader calls it.';

revoke all on function plm.import_coldlion_seasons() from public;
revoke all on function plm.import_coldlion_salespersons() from public;
grant execute on function plm.import_coldlion_seasons() to service_role;
grant execute on function plm.import_coldlion_salespersons() to service_role;

-- =====================================================================================
-- 5. Merch-group candidates (read-only). Offers candidates only; never links.
--    Codes are unique per division+type, never alone. Licensor/property link stays
--    hand-curated under the existing authority rules.
-- =====================================================================================
create or replace function plm.coldlion_merch_group_candidates(
  p_company_code  text default null,
  p_division_code text default null
)
returns table (
  company_code     text,
  division_code    text,
  mg_type_code     text,
  mg_type_desc     text,
  mg_code          text,
  mg_desc          text,
  mg_category      text,
  active           text,
  candidate_kind   text,
  resolution_status text,
  last_seen_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = plm, coldlion, extensions, public
as $$
begin
  return query
  select
    h.company_code,
    h.division_code,
    h.mg_type_code,
    h.mg_type_desc,
    d.mg_code,
    d.mg_desc,
    d.mg_category,
    d.active,
    case
      when lower(btrim(h.mg_type_desc)) = 'licensor' then 'licensor'
      when lower(btrim(h.mg_type_desc)) = 'property' then 'property'
    end as candidate_kind,
    coalesce(l.resolution_status, p.resolution_status, 'unresolved') as resolution_status,
    d.last_seen_at
  from coldlion.merch_group_header h
  join coldlion.merch_group_detail d
    on  d.company_code  = h.company_code
    and d.division_code = h.division_code
    and d.mg_type_code  = h.mg_type_code
  left join plm.erp_licensor l
    on  l.company_code  = h.company_code
    and l.division_code = h.division_code
    and l.mg_type_code  = h.mg_type_code
    and l.mg_code       = d.mg_code
    and lower(btrim(h.mg_type_desc)) = 'licensor'
  left join plm.erp_property p
    on  p.company_code  = h.company_code
    and p.division_code = h.division_code
    and p.mg_type_code  = h.mg_type_code
    and p.mg_code       = d.mg_code
    and lower(btrim(h.mg_type_desc)) = 'property'
  where lower(btrim(h.mg_type_desc)) in ('licensor', 'property')
    and (p_company_code  is null or h.company_code  = p_company_code)
    and (p_division_code is null or h.division_code = p_division_code);
end
$$;

comment on function plm.coldlion_merch_group_candidates is
  'Read-only merch-group candidates for hand-curated licensor/property linking (issue #2176 unit 6). Offers candidates only: this function never writes, never auto-links, and never promotes into core.*. Codes are unique per (company, division, mg_type_code, mg_code) only. resolution_status is observed from plm.erp_licensor / plm.erp_property and is never mutated.';

revoke all on function plm.coldlion_merch_group_candidates(text, text) from public;
grant execute on function plm.coldlion_merch_group_candidates(text, text) to authenticated, service_role;

-- =====================================================================================
-- 6. Item header consumer contract.
--    Reviewed commercial and descriptive fields only. UDF fields stay out.
-- =====================================================================================
create or replace view plm.coldlion_item_header
with (security_invoker = false, security_barrier = true) as
select
  h.company_code,
  h.division_code,
  h.item_no,
  h.item_desc,
  h.item_display_desc,
  h.item_status,
  h.season_code,
  h.design_no,
  h.product_manager,
  h.brand_assurance_no,
  h.movie_art,
  h.character_likeness,
  h.character_list,
  h.royalty_code,
  h.royalty_code2,
  h.hts_number,
  h.hts_number2,
  h.origin_country,
  h.mg_category,
  h.retail_price,
  h.selling_price,
  h.compare_price,
  h.item_cost,
  h.item_price_a,
  h.item_price_b,
  h.item_price_c,
  h.item_price_d,
  h.item_length,
  h.item_width,
  h.item_height,
  h.item_weight,
  h.item_volume,
  h.carton_qty,
  h.carton_length,
  h.carton_width,
  h.carton_height,
  h.carton_weight,
  h.inner_pack_qty,
  h.po_lead_time,
  h.mfg_lead_time,
  h.sales_person_code1,
  h.sales_person_code2,
  h.active,
  h.item_available,
  h.item_discontinued,
  h.non_inventory_item,
  h.has_image,
  h.contract_sample_sent_date,
  h.contract_sample_date,
  h.annual_sample_sent_date,
  h.annual_sample_date,
  h.contract_sample_qty,
  h.annual_sample_qty,
  h.prepro_approved,
  h.prepro_approved_date,
  h.created_time as erp_created_at,
  h.mod_time    as erp_updated_at,
  h.last_seen_at
from coldlion.item_header h;

comment on view plm.coldlion_item_header is
  'Consumer contract over coldlion.item_header (issue #2176 unit 6). Reviewed item-master fields only: identity, description, commercial prices, physical dimensions, classification, status and sample flags. UDF fields are excluded (business meaning not established). Landing provenance other than last_seen_at stays out. Consumers never receive grants on coldlion.item_header.';

revoke all on plm.coldlion_item_header from public, anon;
grant select on plm.coldlion_item_header to authenticated, service_role;

-- =====================================================================================
-- 7. Item detail (SKU) consumer contract.
-- =====================================================================================
create or replace view plm.coldlion_item_detail
with (security_invoker = false, security_barrier = true) as
select
  d.company_code,
  d.division_code,
  d.item_no,
  d.item_pkey,
  d.label_code,
  d.pre_pack_code,
  d.upc,
  d.item_status,
  d.season_code,
  d.active,
  d.item_available,
  d.item_discontinued,
  d.retail_price,
  d.item_cost,
  d.selling_price,
  d.item_price_a,
  d.item_price_b,
  d.item_price_c,
  d.item_price_d,
  d.carton_qty,
  d.nmfc_code,
  d.actual_dims,
  d.item_length,
  d.item_width,
  d.item_height,
  d.item_weight,
  d.item_volume,
  d.carton_length,
  d.carton_width,
  d.carton_height,
  d.carton_weight,
  d.inner_pack_qty,
  d.hts_number,
  d.royalty_code,
  d.royalty_code2,
  d.sales_person_code1,
  d.sales_person_code2,
  d.created_time as erp_created_at,
  d.mod_time    as erp_updated_at,
  d.last_seen_at
from coldlion.item_detail d;

comment on view plm.coldlion_item_detail is
  'Consumer contract over coldlion.item_detail (issue #2176 unit 6). One row per ColdLion SKU (item_pkey). Colour and size are deliberately absent from the landing layer and therefore from this contract. Merch-group slots are deliberately absent here: they are rows in coldlion.item_merch_group, exposed through plm.coldlion_item_merch_group. UDF fields excluded. Consumers never receive grants on coldlion.item_detail.';

revoke all on plm.coldlion_item_detail from public, anon;
grant select on plm.coldlion_item_detail to authenticated, service_role;

-- =====================================================================================
-- 8. Item merch-group slots consumer contract.
-- =====================================================================================
create or replace view plm.coldlion_item_merch_group
with (security_invoker = false, security_barrier = true) as
select
  g.company_code,
  g.division_code,
  g.item_no,
  g.slot_no,
  g.mg_code,
  g.last_seen_at
from coldlion.item_merch_group g;

comment on view plm.coldlion_item_merch_group is
  'Consumer contract over coldlion.item_merch_group (issue #2176 unit 6). All fourteen ColdLion merch-group slots as rows. A cleared slot is deleted by the current-state loader; this view never synthesises empty slots. Consumers never receive grants on coldlion.item_merch_group.';

revoke all on plm.coldlion_item_merch_group from public, anon;
grant select on plm.coldlion_item_merch_group to authenticated, service_role;

-- =====================================================================================
-- 9. Sales-history aggregate consumer contract.
--    APPROVED PER-DESIGN QUANTITIES ONLY.
--    No fulfilment inference from document-number presence.
--    No source-document type claim of any kind (plan section 6.6).
-- =====================================================================================
create or replace view plm.coldlion_sales_history
with (security_invoker = false, security_barrier = true) as
select
  l.company_code,
  l.division_code,
  l.sales_order_no,
  l.sales_order_line_no,
  l.customer_code,
  l.customer_desc,
  l.po_number,
  l.sales_person_code1,
  l.start_date,
  l.cancel_date,
  l.master_item_no,
  l.label_code,
  l.pre_pack_code,
  l.warehouse_code,
  l.prod_cost,
  l.prod_reference_no,
  c.sub_item_no,
  c.sub_label_code,
  c.line_price,
  c.quantity    as component_qty,
  c.order_qty,
  c.invoice_qty,
  c.ship_qty,
  c.order_amount,
  c.ship_amount
from coldlion.order_history_line l
join coldlion.order_history_component c
  on c.line_id = l.id;

comment on view plm.coldlion_sales_history is
  'Consumer contract over ColdLion sales history (issue #2176 unit 6). One row per order-line component design. Exposes the approved per-design quantities and amounts only (order_qty, invoice_qty, ship_qty, order_amount, ship_amount, line_price). MUST NOT infer fulfilment from document-number presence: an invoice number never proves the row was invoiced. MUST NOT claim a source-document type: ColdLion exposes no source-document marker (plan section 6.6). Invoice and pick-ticket tokens stay on the landing tables and are deliberately absent here. Parent line_qty is a parent total and is never summed across components.';

revoke all on plm.coldlion_sales_history from public, anon;
grant select on plm.coldlion_sales_history to authenticated, service_role;

-- =====================================================================================
-- 10. Production-history consumer contract.
-- =====================================================================================
create or replace view plm.coldlion_prod_history
with (security_invoker = false, security_barrier = true) as
select
  l.company_code,
  l.division_code,
  l.prod_order_no,
  l.prod_line_seq,
  l.stage_code,
  l.requested_stage_code,
  l.prod_type_code,
  l.customer_code,
  l.customer_desc,
  l.vendor_code,
  l.vendor_desc,
  l.item_no,
  l.short_item_no,
  l.label_code,
  l.pre_pack_code,
  l.warehouse_code,
  l.warehouse_sku,
  l.prod_country,
  l.freight_forwarder_code,
  l.arrival_port_code,
  l.sales_order_no,
  l.sales_order_link_present,
  l.prod_reference_no,
  l.cust_po_number,
  l.prod_order_date,
  l.due_date,
  l.ship_date,
  l.receive_date,
  l.prod_order_qty,
  l.prepack_qty,
  l.total_ppk_qty,
  l.prod_cost,
  l.ext_cost,
  l.total_prod_cost,
  c.prepack_item_no,
  c.prepack_item_pkey,
  c.prepack_division_code,
  c.sub_item_no,
  c.line_price,
  c.ppk_detail_qty,
  c.ppk_detail_cost
from coldlion.prod_history_line l
left join coldlion.prod_history_component c
  on c.line_id = l.id;

comment on view plm.coldlion_prod_history is
  'Consumer contract over ColdLion production history (issue #2176 unit 6). One row per purchase-line version times component (a non-prepack line has one component row with NULL prepack_item_no). sales_order_no = 0 means no linked sales order and is never joined on. last_prod_cost lives on the landing lookup table and is deliberately absent: it is another production''s cost. Parent totals are never summed across components. Consumers never receive grants on coldlion.prod_history_*.';

revoke all on plm.coldlion_prod_history from public, anon;
grant select on plm.coldlion_prod_history to authenticated, service_role;

-- =====================================================================================
-- 11. Prepack-detail consumer contract.
-- =====================================================================================
create or replace view plm.coldlion_prepack_detail
with (security_invoker = false, security_barrier = true) as
select
  p.company_code,
  p.prepack_code,
  p.sequence_no,
  p.division_code,
  p.item_no,
  p.color_code,
  p.size_code,
  p.dim_code,
  p.label_code,
  p.quantity,
  p.detail_prepack,
  p.item_cost,
  p.item_price,
  p.item_price_capitalized,
  p.created_time as erp_created_at,
  p.mod_time    as erp_updated_at,
  p.last_seen_at
from coldlion.prepack_detail p;

comment on view plm.coldlion_prepack_detail is
  'Consumer contract over coldlion.prepack_detail (issue #2176 unit 6). One row per company + prepackCode + sequence. quantity is the recipe multiplier (how many of this SKU are in one prepack), never an order quantity. item_price and item_price_capitalized are ColdLion''s duplicate-cased properties and are both exposed; they are never folded.';

revoke all on plm.coldlion_prepack_detail from public, anon;
grant select on plm.coldlion_prepack_detail to authenticated, service_role;

-- =====================================================================================
-- 12. Prod-detail consumer contract.
--     item_desc and merch_group_05_desc stay out (landing ruling: not exposable
--     without an owner ruling).
-- =====================================================================================
create or replace view plm.coldlion_prod_detail
with (security_invoker = false, security_barrier = true) as
select
  d.company_code,
  d.pkey,
  d.prod_order_no,
  d.prod_line_seq,
  d.division_code,
  d.item_pkey,
  d.item_no,
  d.color_code,
  d.size_code,
  d.dim_code,
  d.label_code,
  d.prepack_code,
  d.prod_qty,
  d.wip_qty,
  d.prod_cost,
  d.cust_po_number,
  d.created_time as erp_created_at,
  d.mod_time    as erp_updated_at,
  d.last_seen_at
from coldlion.prod_detail d;

comment on view plm.coldlion_prod_detail is
  'Consumer contract over coldlion.prod_detail (issue #2176 unit 6). One row per production-order LINE. prod_detail.item_desc and prod_detail.merch_group_05_desc are deliberately absent: the landing layer marks them as not exposable without an owner ruling. wip_qty is recorded as sent and never derived.';

revoke all on plm.coldlion_prod_detail from public, anon;
grant select on plm.coldlion_prod_detail to authenticated, service_role;

-- =====================================================================================
-- 13. Item image metadata consumer contract (pim.*).
--     Metadata only. Image bytes are excluded from the landing layer entirely.
-- =====================================================================================
create or replace view pim.coldlion_item_image_metadata
with (security_invoker = false, security_barrier = true) as
select
  i.company_code,
  i.pkey,
  i.resource_id,
  i.division_code,
  i.item_no,
  i.color_code,
  i.label_code,
  i.file_name,
  i.file_type,
  i.item_image_desc,
  i.created_time as erp_created_at,
  i.mod_time    as erp_updated_at,
  i.last_seen_at
from coldlion.item_image_metadata i;

comment on view pim.coldlion_item_image_metadata is
  'Consumer contract over coldlion.item_image_metadata (issue #2176 unit 6). Metadata only: file name, type and description. resourceContent and thumbnail128 (image bytes) are excluded from the landing layer and have no column. resource_id is descriptive and is NOT an identity (8 duplicate groups over 75 sampled rows); pkey is the only proven identity. hasImage=Y is not proof a row exists.';

revoke all on pim.coldlion_item_image_metadata from public, anon;
grant select on pim.coldlion_item_image_metadata to authenticated, service_role;
