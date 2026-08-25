-- Issue #1184: ColdLion raw landing, unblocked structural phases 2-6.
-- Phase 1 already exists in 20260818232639 and is not recreated here.
-- Owner decisions D1-D13 in docs/plan_coldlion-landing-phases-2-6.md control.
-- No per-row raw archive (D5). Current-state source_hash is SHA-256 of the
-- complete fetched record before projection. Split history tables instead hash
-- their OWN GRAIN: line_source_hash excludes component and last* fields;
-- component_source_hash covers the component projection; lookup_source_hash
-- covers only the seven last* fields. This prevents flattened API rows from
-- re-fanning one purchase/sales line into one parent per component or lookup.
-- No application grants and no foreign keys to core.*.
-- EP001 exclusion and three-version pruning are loader/maintenance contracts;
-- this migration creates no loader because its runtime is still undecided.

do $$ begin
  if to_regclass('coldlion.sync_run') is null then
    raise exception 'ColdLion phase 1 spine is required before phases 2-6';
  end if;
end $$;

create table coldlion.merch_group_header (
  company_code text not null, division_code text not null, mg_type_code text not null,
  created_time timestamptz, mod_time timestamptz, mg_type_desc text,
  run_id uuid not null references coldlion.sync_run(id), fetched_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null, last_seen_at timestamptz not null,
  primary key (company_code, division_code, mg_type_code),
  check (division_code <> 'EP001'), check (last_seen_at >= first_seen_at)
);

create table coldlion.merch_group_detail (
  company_code text not null, division_code text not null, mg_type_code text not null, mg_code text not null,
  created_time timestamptz, mod_time timestamptz, mg_desc text, item_no_code text,
  mg_category text, mg_code2 text, active text,
  run_id uuid not null references coldlion.sync_run(id), fetched_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null, last_seen_at timestamptz not null,
  primary key (company_code, division_code, mg_type_code, mg_code),
  foreign key (company_code, division_code, mg_type_code)
    references coldlion.merch_group_header(company_code, division_code, mg_type_code),
  check (division_code <> 'EP001'), check (last_seen_at >= first_seen_at)
);

create table coldlion.item_header (
  company_code text not null, division_code text not null, item_no text not null,
  created_time timestamptz, mod_time timestamptz, item_desc text, item_status text, season_code text,
  udf01 text, udf02 text, udf03 text, udf04 text, udf_date01 date, udf_date02 date,
  retail_price numeric, item_length numeric, item_width numeric, item_height numeric, item_weight numeric,
  inner_pack_qty numeric, origin_country text, item_cost numeric, hts_number text, royalty_code text,
  carton_qty numeric, item_price_a numeric, item_price_b numeric, item_price_c numeric, item_price_d numeric,
  item_note text, design_no text, po_lead_time numeric, mfg_lead_time numeric, selling_price numeric,
  royalty_code2 text, carton_length numeric, carton_width numeric, carton_height numeric, compare_price numeric,
  item_display_desc text, non_inventory_item text, item_volume numeric, active text, item_available text,
  item_discontinued text, carton_weight numeric, sales_person_code1 text, sales_person_code2 text,
  product_manager text, hts_number2 text, brand_assurance_no text, movie_art text, character_likeness text,
  contract_sample_sent_date date, contract_sample_date date, annual_sample_sent_date date, annual_sample_date date,
  contract_sample_qty numeric, annual_sample_qty numeric, prepro_approved text, prepro_approved_date date,
  character_list text, mg_category text, has_image text,
  run_id uuid not null references coldlion.sync_run(id), fetched_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null, last_seen_at timestamptz not null,
  primary key (company_code, division_code, item_no),
  check (division_code <> 'EP001'), check (last_seen_at >= first_seen_at)
);

create table coldlion.item_merch_group (
  company_code text not null, division_code text not null, item_no text not null,
  slot_no smallint not null check (slot_no between 1 and 14), mg_code text not null,
  run_id uuid not null references coldlion.sync_run(id), fetched_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null, last_seen_at timestamptz not null,
  primary key (company_code, division_code, item_no, slot_no),
  foreign key (company_code, division_code, item_no)
    references coldlion.item_header(company_code, division_code, item_no) on delete cascade,
  check (division_code <> 'EP001'), check (last_seen_at >= first_seen_at)
);

comment on table coldlion.item_merch_group is
  'All fourteen ColdLion merch-group slots as rows. A cleared slot must be deleted by the current-state loader in the same transaction as its parent upsert; upsert-only would preserve stale taxonomy.';

create table coldlion.item_detail (
  company_code text not null, division_code text not null, item_no text not null, item_pkey text not null,
  created_time timestamptz, mod_time timestamptz, label_code text, pre_pack_code text, upc text,
  item_status text, retail_price numeric, item_cost numeric,
  merch_group01 text, merch_group02 text, merch_group03 text, merch_group04 text, merch_group05 text,
  merch_group06 text, merch_group07 text, merch_group08 text, merch_group09 text, merch_group10 text,
  merch_group11 text, merch_group12 text, merch_group13 text, merch_group14 text,
  udf01 text, udf02 text, udf03 text, udf04 text, udf_date01 date, udf_date02 date,
  hts_number text, item_length numeric, item_width numeric, item_height numeric, item_weight numeric,
  inner_pack_qty numeric, royalty_code text, item_price_a numeric, item_price_b numeric,
  item_price_c numeric, item_price_d numeric, carton_qty numeric, selling_price numeric, royalty_code2 text,
  nmfc_code text, carton_length numeric, carton_width numeric, carton_height numeric, item_volume numeric,
  season_code text, active text, item_available text, item_discontinued text, carton_weight numeric,
  sales_person_code1 text, sales_person_code2 text, actual_dims text,
  run_id uuid not null references coldlion.sync_run(id), fetched_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null, last_seen_at timestamptz not null,
  primary key (company_code, division_code, item_no, item_pkey),
  foreign key (company_code, division_code, item_no)
    references coldlion.item_header(company_code, division_code, item_no) on delete cascade,
  check (division_code <> 'EP001'), check (last_seen_at >= first_seen_at)
);

comment on table coldlion.item_detail is
  'One ColdLion SKU keyed by itemPkey. Colour and size are deliberately absent under owner decisions D4/D12; recovery if reconsidered is a fresh inexpensive itemDetails pull.';
comment on column coldlion.item_header.brand_assurance_no is
  'Write-back wanted by the owner. A supported PUT /items path exists, but this migration builds no write path.';
comment on column coldlion.item_detail.retail_price is
  'Write-back wanted by the owner. A supported PUT /itemDetails path exists, but this migration builds no write path. Other write-back-wanted item fields follow the same D6 contract.';

create table coldlion.order_history_line (
  sales_order_no bigint not null, item_no text not null, label_code text,
  cancel_date date, company_code text, customer_code text, po_number text, sales_person_code1 text,
  start_date date, division_code text, pre_pack_code text, line_qty numeric, line_cancelled_qty numeric,
  item_desc text, brand_assurance_no text, short_item_no text, prepack_qty numeric,
  customer_desc text, warehouse_code text, prod_cost numeric, prod_reference_no text,
  line_source_hash text not null check (line_source_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid not null references coldlion.sync_run(id), fetched_at timestamptz not null,
  unique nulls not distinct (sales_order_no, item_no, label_code, line_source_hash),
  check (division_code is null or division_code <> 'EP001')
);

comment on table coldlion.order_history_line is
  'Append-only sales-order line. Evidence-backed derived identity is (salesOrderNo,itemNo,labelCode); ColdLion line number is not exposed. Empty labelCode normalises to NULL and the unique constraint uses NULLS NOT DISTINCT, so a replay cannot duplicate it. Because no substitute line number exists, a loader seeing two distinct line-grain hashes for the same order+item+NULL label in one pull must refuse as ambiguous rather than silently merge them. line_source_hash is over line-grain fields only: it excludes component fields including linePrice and therefore one prepack produces one parent. No FK to item_header: many historical lines have no item master row.';
comment on column coldlion.order_history_line.brand_assurance_no is
  'Write-back wanted by the owner but currently impossible: ColdLion exposes no write endpoint for orderHistory. Flag only; no invented write path.';

create table coldlion.order_history_component (
  sales_order_no bigint not null, item_no text not null, label_code text, sub_item_no text,
  line_price numeric, quantity numeric, sub_label_code text, sub_upc text,
  sub_merch_group01 text, sub_merch_group02 text, sub_merch_group03 text,
  sub_merch_group04 text, sub_merch_group05 text, sub_merch_group06 text,
  component_source_hash text not null check (component_source_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid not null references coldlion.sync_run(id), fetched_at timestamptz not null,
  unique nulls not distinct (sales_order_no, item_no, label_code, sub_item_no, component_source_hash)
);

comment on table coldlion.order_history_component is
  'Append-only component of an orderHistory line. component_source_hash is over this component grain. linePrice is per component, not per line. Empty subItemNo normalises to NULL; on non-prepacks the parent itemNo already supplies the component identity and NULLS NOT DISTINCT makes replay idempotent. Loader must assert component quantity sum equals the parent prepackQty before completing a window.';

create table coldlion.prod_history_line (
  prod_order_no bigint not null, prod_line_seq bigint not null,
  company_code text, division_code text, customer_code text, prod_type_code text,
  stage_code text not null check (stage_code in ('ISS','INTRAN','REC')),
  ship_date date, ship_cancel_date date, orig_ship_date date, orig_due_date date, orig_ship_cancel_date date,
  prod_order_date date, prod_country text, freight_forwarder_code text, warehouse_code text, vendor_code text,
  arrival_port_code text, sales_order_no bigint, prod_reference_no text, due_date date, item_no text,
  label_code text, pre_pack_code text, prod_cost numeric, warehouse_sku text, prod_order_qty numeric,
  customer_desc text, total_prod_cost numeric, deposit_perc numeric, ext_cost numeric, receive_date date,
  cust_po_number text, cust_start_date date, cust_cancel_date date, vendor_desc text, prepack_qty numeric,
  item_desc text, short_item_no text,
  line_source_hash text not null check (line_source_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid not null references coldlion.sync_run(id), fetched_at timestamptz not null,
  unique (prod_order_no, prod_line_seq, stage_code, line_source_hash),
  check (division_code is null or division_code <> 'EP001')
);

comment on table coldlion.prod_history_line is
  'Append-only real purchase line. Distinct prodLineSeq values are distinct purchases and must never be merged. line_source_hash is over line-grain fields only and excludes component and last* fields, preventing those flattened differences from duplicating a purchase. salesOrderNo=0 means no linked sales order and is not a foreign key. stage_code is stamped from the request because Prod Stage is not exposed in the API, and is part of every production-history grain identity so identical payloads observed in different stages never collide.';
comment on column coldlion.prod_history_line.deposit_perc is
  'Write-back wanted by the owner but currently impossible: ColdLion exposes no write endpoint for prodHistory. Flag only; no invented write path.';

create table coldlion.prod_history_component (
  prod_order_no bigint not null, prod_line_seq bigint not null,
  stage_code text not null check (stage_code in ('ISS','INTRAN','REC')),
  prepack_item_no text not null,
  prepack_dim_code text, prepack_division_code text, total_ppk_qty numeric, ppk_detail_qty numeric,
  ppk_detail_cost numeric, ppk_detail_qty2 numeric, prepack_item_pkey text,
  ppk_merch_group01 text, ppk_merch_group02 text, ppk_merch_group03 text, ppk_merch_group04 text,
  ppk_merch_group05 text, ppk_merch_group06 text, ppk_merch_group07 text, ppk_merch_group08 text,
  ppk_merch_group09 text, ppk_merch_group10 text, ppk_merch_group11 text, ppk_merch_group12 text,
  ppk_merch_group13 text, ppk_merch_group14 text,
  ppk_merch_group01_desc text, ppk_merch_group02_desc text, ppk_merch_group03_desc text,
  ppk_merch_group04_desc text, ppk_merch_group05_desc text, ppk_merch_group06_desc text,
  ppk_merch_group07_desc text, ppk_merch_group08_desc text, ppk_merch_group09_desc text,
  ppk_merch_group10_desc text, ppk_merch_group11_desc text, ppk_merch_group12_desc text,
  ppk_merch_group13_desc text, ppk_merch_group14_desc text,
  sub_item_no text, line_price numeric,
  component_source_hash text not null check (component_source_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid not null references coldlion.sync_run(id), fetched_at timestamptz not null,
  unique (prod_order_no, prod_line_seq, stage_code, prepack_item_no, component_source_hash)
);

comment on table coldlion.prod_history_component is
  'One production-history component. subItemNo and linePrice belong here because the API row grain is purchase line times component and no within-line invariant is proven. component_source_hash covers this component projection. stage_code is stamped from the request and participates in identity.';

create table coldlion.prod_history_last_lookup (
  prod_order_no bigint not null, prod_line_seq bigint not null,
  stage_code text not null check (stage_code in ('ISS','INTRAN','REC')),
  last_prod_ref_no text, last_due_date date, last_prod_date date, last_warehouse_code text,
  last_vendor_code text, last_vendor_desc text, last_prod_cost numeric,
  lookup_source_hash text not null check (lookup_source_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid not null references coldlion.sync_run(id), fetched_at timestamptz not null,
  unique (prod_order_no, prod_line_seq, stage_code, lookup_source_hash)
);

comment on table coldlion.prod_history_last_lookup is
  'The seven last* fields are a most-recent-production lookup, separate from the purchase. lookup_source_hash covers only these lookup fields, so a changed lookup never duplicates prod_history_line. lastProdCost is never the cost of this order; extCost on prod_history_line is. stage_code is stamped from the request and participates in identity.';

create table coldlion.customer (
  company_code text not null, customer_code text not null, created_time timestamptz, mod_time timestamptz,
  active text, customer_desc text, vendor_number text,
  run_id uuid not null references coldlion.sync_run(id), fetched_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null, last_seen_at timestamptz not null,
  primary key (company_code, customer_code), check (last_seen_at >= first_seen_at)
);

create table coldlion.vendor (
  company_code text not null, vendor_code text not null, created_time timestamptz, mod_time timestamptz,
  vendor_desc text, city text, country_code text, active text, fema_exp_date date, nbc_exp_date date,
  run_id uuid not null references coldlion.sync_run(id), fetched_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null, last_seen_at timestamptz not null,
  primary key (company_code, vendor_code), check (last_seen_at >= first_seen_at)
);

comment on column coldlion.vendor.fema_exp_date is
  'Write-back wanted by the owner but currently impossible: ColdLion exposes no vendor write endpoint. Flag only; no invented write path.';
comment on column coldlion.vendor.nbc_exp_date is
  'Write-back wanted by the owner but currently impossible: ColdLion exposes no vendor write endpoint. Flag only; no invented write path.';

-- No application role may read or mutate the landing layer.
do $access$
declare r record;
begin
  for r in
    select c.oid::regclass as relation_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'coldlion' and c.relkind = 'r'
      and c.relname not in ('sync_run','window_ledger','change_log')
  loop
    execute format('alter table %s enable row level security', r.relation_name);
    execute format('revoke all on table %s from public, anon, authenticated', r.relation_name);
    execute format('grant all on table %s to service_role', r.relation_name);
  end loop;
end
$access$;
