-- #4707 Lane G (claim #7053): read-only access for the DesignFlow canonical
-- plm.* read paths merged in designflow-item-master#283, designflow-tracking#243
-- and designflow-backend#547. Column-scoped SELECT only, each column taken from
-- that app's queries (plus the columns its row policy reads). No write rights.
-- Row visibility matches the Data Syncing copy policies: only copied DesignFlow
-- rows. Backend reads `select * from plm.designflow_item`, so it gets every
-- current column of that one table, still granted by name.
-- derived-from: none

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant usage on schema plm to designflow_prod_item_master_grants, designflow_prod_tracking_grants,
  designflow_prod_backend_grants;

-- Item Master
grant select (legacy_item_id, canonical_item_id, legacy_item_number, design_reference, vendor_code_fk,
  mod_time_date, item_descr_name, item_displ_descr_name, lic_comment)
  on plm.designflow_item to designflow_prod_item_master_grants;
grant select (item_id, slot_number, merch_group_id, legacy_merch_group_id, legacy_code, resolution)
  on plm.item_merch_group to designflow_prod_item_master_grants;
grant select (id, source_system, designflow_item_id, designflow_status_id, designflow_status_value,
  designflow_milestone_id)
  on plm.licensing_status to designflow_prod_item_master_grants;
grant select (licensing_status_id, designflow_user_id, position)
  on plm.licensing_status_assignee to designflow_prod_item_master_grants;
grant select (id, licensing_status_id, source_system, designflow_feedback_id)
  on plm.licensing_feedback to designflow_prod_item_master_grants;
grant select (licensing_feedback_id, designflow_user_id, position)
  on plm.licensing_feedback_mention to designflow_prod_item_master_grants;
grant select (licensing_status_id, licensing_feedback_id, source_reference)
  on plm.licensing_attachment to designflow_prod_item_master_grants;

-- Tracking
grant select (legacy_item_id, canonical_item_id)
  on plm.designflow_item to designflow_prod_tracking_grants;
grant select (id, source_system, designflow_source_item_id, designflow_status_id, designflow_status_value,
  designflow_event_date, designflow_milestone_id, milestone, designflow_milestone_at)
  on plm.licensing_status to designflow_prod_tracking_grants;
grant select (licensing_status_id, designflow_user_id, position)
  on plm.licensing_status_assignee to designflow_prod_tracking_grants;
grant select (id, licensing_status_id, source_system, designflow_feedback_id)
  on plm.licensing_feedback to designflow_prod_tracking_grants;
grant select (licensing_feedback_id, designflow_user_id, position)
  on plm.licensing_feedback_mention to designflow_prod_tracking_grants;
grant select (item_id, licensing_status_id, licensing_feedback_id, source_reference)
  on plm.licensing_attachment to designflow_prod_tracking_grants;

-- Backend
grant select (legacy_item_id, canonical_item_id, match_disposition, created_user_fk, created_time_date,
  item_active_status, discont_status, mod_time_date, mod_user_fk, dsn_ref_num, item_descr_name,
  item_displ_descr_name, item_length_size, item_width_size, item_depth_size, item_weight_size,
  uom_size_fk, uom_weight_fk, item_note, item_content, item_avail_status, item_cbm_size, item_cost_ext,
  hts_num_ext_fk, hts2_num_ext_fk, innerpack_qty, giftwrap, base_qty, carton_length_size,
  carton_width_size, carton_depth_size, carton_weight_size, carton_code_ext, carton_packtype_fk,
  carton_qty, allowed_sizes, origin_country_fk, season_code_fk, pack_type, retail_price, selling_price,
  mfg_lead_time, size_explo_code_ext, size_range_code_ext, legacy_non_inventory, uom_code,
  vendor_code_fk, old_item_num, on_hand_minimum_qty, ds_cat, compare_price, costcomp1, costcomp2,
  costcomp3, costcomp4, costcomp5, comm_code_ext, royalty_code_fk, royalty2_code_fk, salesper_code_fk,
  salesper2_code_fk, product_manager_fk, legacy_item_number, legacy_company_id, legacy_division_id,
  lic_comment, lic_company, lic_sample_no, lic_item_desc, lic_licensorcode, lic_brand_assurance_number,
  design_reference, productmanager, legacy_company_code, legacy_division_code, is_item_active,
  is_item_old, season_code_fk_id, tags, art_piece_id, lic_tracking_updated_date, due_date,
  item_type_id_fk, sample_start_date, hts_product_phrase, hts_product_phrase_source,
  hts_product_phrase_at)
  on plm.designflow_item to designflow_prod_backend_grants;
grant select (item_id, slot_number, merch_group_id, legacy_merch_group_id, legacy_code, resolution)
  on plm.item_merch_group to designflow_prod_backend_grants;
grant select (id, source_system, designflow_item_id, designflow_status_id, designflow_status_value,
  designflow_event_date, designflow_milestone_id, milestone, designflow_milestone_at)
  on plm.licensing_status to designflow_prod_backend_grants;
grant select (licensing_status_id, designflow_user_id, position)
  on plm.licensing_status_assignee to designflow_prod_backend_grants;
grant select (id, licensing_status_id, source_system, designflow_feedback_id, body)
  on plm.licensing_feedback to designflow_prod_backend_grants;
grant select (licensing_feedback_id, designflow_user_id, position)
  on plm.licensing_feedback_mention to designflow_prod_backend_grants;
grant select (id, item_id, licensing_status_id, licensing_feedback_id, file_object_id, source_reference,
  position)
  on plm.licensing_attachment to designflow_prod_backend_grants;

-- Data Syncing reconcile (designflow-data-syncing scripts/reconcile-designflow-item-state.js)
-- captures whole-row before-images (select t.*, to_jsonb(t)) of the licensing
-- tables. 20261225091301 granted only DELETE/UPDATE there, and the copy grants
-- are column-scoped, so these columns were never readable: production reconcile
-- failed with permission denied. Read-only completion; no new write right.
grant select (item_id, licensor_id, property_id, due_date, completed_at, metadata, created_at, updated_at)
  on plm.licensing_status to designflow_prod_data_sync_grants;
grant select (author_name, reply_to_id) on plm.licensing_feedback to designflow_prod_data_sync_grants;
grant select (profile_id) on plm.licensing_status_assignee to designflow_prod_data_sync_grants;
grant select (profile_id) on plm.licensing_feedback_mention to designflow_prod_data_sync_grants;
grant select (id) on plm.licensing_attachment to designflow_prod_data_sync_grants;

-- Row policies: the same copied-row predicates as the Data Syncing read policies.
create policy designflow_item_designflow_runtime_read on plm.designflow_item for select
  to designflow_prod_item_master_grants, designflow_prod_tracking_grants, designflow_prod_backend_grants
  using (true);
create policy item_merch_group_designflow_runtime_read on plm.item_merch_group for select
  to designflow_prod_item_master_grants, designflow_prod_backend_grants
  using (exists (select from plm.designflow_item h where h.canonical_item_id = item_id));
create policy licensing_status_designflow_runtime_read on plm.licensing_status for select
  to designflow_prod_item_master_grants, designflow_prod_tracking_grants, designflow_prod_backend_grants
  using (source_system in ('designflow_licensing_status', 'designflow_item_milestone'));
create policy licensing_status_assignee_designflow_runtime_read on plm.licensing_status_assignee for select
  to designflow_prod_item_master_grants, designflow_prod_tracking_grants, designflow_prod_backend_grants
  using (exists (select from plm.licensing_status s
    where s.id = licensing_status_id and s.source_system = 'designflow_licensing_status'));
create policy licensing_feedback_designflow_runtime_read on plm.licensing_feedback for select
  to designflow_prod_item_master_grants, designflow_prod_tracking_grants, designflow_prod_backend_grants
  using (source_system = 'designflow_licensing_feedback');
create policy licensing_feedback_mention_designflow_runtime_read on plm.licensing_feedback_mention for select
  to designflow_prod_item_master_grants, designflow_prod_tracking_grants, designflow_prod_backend_grants
  using (exists (select from plm.licensing_feedback f
    where f.id = licensing_feedback_id and f.source_system = 'designflow_licensing_feedback'));
create policy licensing_attachment_designflow_runtime_read on plm.licensing_attachment for select
  to designflow_prod_item_master_grants, designflow_prod_tracking_grants, designflow_prod_backend_grants
  using (source_reference ~ '^(itemAttachment|licensingStatus|licensingFeedbackReply):[0-9]+(:[0-9]+)?$');

commit;
