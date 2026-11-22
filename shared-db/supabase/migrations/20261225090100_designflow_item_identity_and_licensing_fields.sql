-- #4707: stable, DesignFlow-owned item identities and legacy licensing fields.
-- derived-from: none
-- Keep draft references outside the ColdLion item master and preserve source values.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table plm.designflow_item (
  legacy_item_id integer primary key check (legacy_item_id > 0),
  canonical_item_id uuid unique references plm.item(id) on delete set null,
  match_disposition text not null check (match_disposition in (
    'eligible', 'blank_number', 'unmatched_number', 'duplicate_legacy_number',
    'ambiguous_number', 'unknown'
  )),
  created_user_fk text,
  created_time_date timestamp without time zone,
  item_active_status text,
  discont_status text,
  mod_time_date timestamp without time zone,
  mod_user_fk text,
  dsn_ref_num text,
  item_descr_name text,
  item_displ_descr_name text,
  item_length_size numeric,
  item_width_size numeric,
  item_depth_size text,
  item_weight_size numeric,
  uom_size_fk text,
  uom_weight_fk text,
  item_note text,
  item_content text,
  item_avail_status text,
  item_cbm_size numeric,
  item_cost_ext numeric,
  hts_num_ext_fk text,
  hts2_num_ext_fk text,
  innerpack_qty integer,
  giftwrap text,
  base_qty integer,
  carton_length_size numeric,
  carton_width_size numeric,
  carton_depth_size numeric,
  carton_weight_size numeric,
  carton_code_ext text,
  carton_packtype_fk text,
  carton_qty integer,
  allowed_sizes text,
  origin_country_fk text,
  season_code_fk text,
  pack_type text,
  retail_price numeric,
  selling_price numeric,
  mfg_lead_time integer,
  size_explo_code_ext text,
  size_range_code_ext text,
  legacy_non_inventory text,
  uom_code text,
  vendor_code_fk text,
  old_item_num text,
  on_hand_minimum_qty integer,
  ds_cat text,
  compare_price numeric,
  costcomp1 numeric,
  costcomp2 numeric,
  costcomp3 numeric,
  costcomp4 numeric,
  costcomp5 numeric,
  comm_code_ext text,
  royalty_code_fk text,
  royalty2_code_fk text,
  salesper_code_fk text,
  salesper2_code_fk text,
  product_manager_fk text,
  legacy_item_number text,
  legacy_company_id integer,
  legacy_division_id integer,
  lic_comment text,
  lic_company text,
  lic_sample_no text,
  lic_item_desc text,
  lic_licensorcode text,
  lic_brand_assurance_number text,
  design_reference text,
  productmanager text,
  legacy_company_code text,
  legacy_division_code text,
  is_item_active boolean,
  is_item_old boolean,
  season_code_fk_id integer,
  tags text,
  art_piece_id integer,
  lic_tracking_updated_date timestamp with time zone,
  due_date timestamp with time zone,
  item_type_id_fk integer,
  sample_start_date text,
  hts_product_phrase text,
  hts_product_phrase_source text,
  hts_product_phrase_at timestamp with time zone,
  constraint designflow_item_verified_link
    check (canonical_item_id is null or match_disposition = 'eligible')
);

alter table plm.designflow_item enable row level security;
revoke all on plm.designflow_item from public, anon, authenticated;

alter table plm.licensing_status
  add column designflow_item_id integer references plm.designflow_item(legacy_item_id) on delete set null,
  add column designflow_source_item_id integer,
  add column designflow_status_id integer check (
    designflow_status_id is null
    or (designflow_status_id > 0 and source_system is not distinct from 'designflow_licensing_status')
  ),
  add column designflow_status_value text,
  add column designflow_event_date text,
  add column designflow_milestone_flag text,
  add column designflow_package boolean,
  add column designflow_feedback text,
  add column designflow_source_label text,
  add column designflow_modified_by text,
  add column designflow_assignor_id integer,
  add column designflow_tagged_group_id integer,
  add column designflow_pop_comments text,
  add constraint licensing_status_designflow_source_item_check check (
    designflow_item_id is null or designflow_item_id is not distinct from designflow_source_item_id
  ),
  add constraint licensing_status_designflow_metadata_owner check (
    num_nonnulls(designflow_item_id, designflow_source_item_id, designflow_status_id,
      designflow_status_value, designflow_event_date, designflow_milestone_flag,
      designflow_package, designflow_feedback, designflow_source_label,
      designflow_modified_by, designflow_assignor_id, designflow_tagged_group_id,
      designflow_pop_comments) = 0
    or coalesce(source_system in ('designflow_licensing_status', 'designflow_item_milestone'), false)
  );

create index licensing_status_designflow_item_idx
  on plm.licensing_status (designflow_item_id) where designflow_item_id is not null;

create unique index licensing_status_designflow_id_idx
  on plm.licensing_status (designflow_status_id) where designflow_status_id is not null;

alter table plm.licensing_feedback
  add column designflow_feedback_id integer check (designflow_feedback_id > 0),
  add column designflow_author_id integer,
  add constraint licensing_feedback_designflow_metadata_owner check (
    num_nonnulls(designflow_feedback_id, designflow_author_id) = 0
    or source_system is not distinct from 'designflow_licensing_feedback'
  );

create unique index licensing_feedback_designflow_id_idx
  on plm.licensing_feedback (designflow_feedback_id) where designflow_feedback_id is not null;

-- The existing PLM table policies also allow direct authenticated readers.
-- DesignFlow's server must remain the authorization boundary for its item records.
create policy licensing_status_designflow_private on plm.licensing_status
  as restrictive for all to authenticated
  using (coalesce(source_system not in ('designflow_licensing_status', 'designflow_item_milestone'), true))
  with check (coalesce(source_system not in ('designflow_licensing_status', 'designflow_item_milestone'), true));

create policy licensing_feedback_designflow_private on plm.licensing_feedback
  as restrictive for all to authenticated
  using (source_system is distinct from 'designflow_licensing_feedback')
  with check (source_system is distinct from 'designflow_licensing_feedback');

comment on table plm.designflow_item is
  'DesignFlow item workspace and source identity. An ERP item may be linked later without changing the existing DesignFlow ID.';
comment on column plm.designflow_item.legacy_division_code is
  'Original DesignFlow source value. The linked ColdLion item determines canonical division.';
comment on column plm.licensing_status.designflow_source_item_id is
  'Original DesignFlow item reference retained for review when its parent is missing or detached.';
comment on column plm.licensing_status.designflow_status_value is
  'The DesignFlow status value before canonical normalization, including an absent value.';
comment on column plm.licensing_status.designflow_event_date is
  'The original DesignFlow date text, retained for existing timeline behavior and nonstandard historical values.';

commit;
