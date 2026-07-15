-- ERP migration — Phase 1 of fix_schema_for_api.md (the safe serving-layer step).
--
-- What this does
-- --------------
-- 1. Adds api.plm_item_list: a stable, browser/read-facing VIEW over the live
--    Coldlion ERP item mirror (public.erp_items_current). No data is moved or
--    copied; a view stores no rows. It is a faithful 1:1 pass-through with clean,
--    forward-looking column names (external_id -> source_id).
-- 2. Repoints public.style_tracker_rows_with_bridge to read the ERP item columns
--    (canonical_description, erp_style_number) through the new api view instead of
--    selecting from public.erp_items_current directly.
--
-- Why (Phase 1 rationale)
-- -----------------------
-- Apps and internal views should read the ERP mirror through a stable api.* view,
-- never the physical table. A view insulates every reader from later table
-- changes: in Phases 2-5 we relocate the ERP mirror into ingest.* / plm.*; when we
-- do, we re-aim api.plm_item_list ONCE and no reader breaks. This is the same
-- insulation pattern already used by api.customer_list over core.customer.
--
-- Deliberately NOT in Phase 1
-- ---------------------------
-- plm.refresh_style_tracker_item_bridge() also reads public.erp_items_current, but
-- it is an entity-matching function that writes the physical ERP row id into the
-- FK plm.style_tracker_item_bridge.erp_item_id and has logic keyed on
-- target_table='erp_items_current'. Routing it through a view yields no real
-- decoupling and only adds risk. Its decoupling belongs to Phase 4, when that FK
-- is repointed to plm.item(id). See fix_schema_for_api.md sections 5-6.
--
-- Safety
-- ------
-- Additive + behavior-preserving. Verified read-only against production before
-- authoring: api.plm_item_list returns all 17,703 current items with a unique
-- source_id, and the rewritten style_tracker_rows_with_bridge is row-for-row
-- identical (0 mismatches across 15,509 bridge rows) for the ERP-derived columns.

-- 1. The serving contract ----------------------------------------------------

create or replace view api.plm_item_list
with (security_invoker = true) as
select
  e.id,
  e.external_id       as source_id,     -- Coldlion item id (natural key)
  e.style_number,
  e.item_description,
  e.mg_category,
  e.mg01_code,
  e.mg02_code,
  e.mg03_code,
  e.mg04_code,
  e.mg05_code,
  e.mg06_code,
  e.size_code,
  e.licensor_code,
  e.property_code,
  e.division_code,
  e.prepack_code,
  e.prepack_codes,
  e.dismissed,
  e.erp_updated_at,
  e.synced_at,
  e.source_system
from public.erp_items_current e;

comment on view api.plm_item_list is
  'Shared read-only Coldlion ERP item mirror (over public.erp_items_current). Readers use this view, never the base table, so relocating the ERP mirror in later phases (ingest.*/plm.*) never breaks app code. Faithful 1:1 pass-through; source_id is the Coldlion natural key (external_id). Phase 1 of fix_schema_for_api.md.';

grant select on api.plm_item_list to authenticated;

-- 2. Repoint the internal reader through the view ----------------------------
-- Identical column set/order and identical (security definer) execution mode as
-- the existing view; the ONLY change is the ERP source: public.erp_items_current
-- -> api.plm_item_list. All object references are schema-qualified.

create or replace view public.style_tracker_rows_with_bridge as
select
  r.id,
  r.source_workbook_id,
  r.source_sheet,
  r.source_row_number,
  r.tracker_type,
  r.sku,
  r.group_id,
  r.description,
  r.customer,
  r.designer,
  r.commissioned,
  r.upc,
  r.customer_sku,
  r.licensor,
  r.license_status,
  r.royalty,
  r.concept_status,
  r.pre_production_status,
  r.production_status,
  r.default_vendor,
  r.discontinued,
  r.notes,
  r.row_data,
  r.imported_at,
  r.created_at,
  r.updated_at,
  r.updated_by,
  b.id as bridge_id,
  b.erp_item_id,
  b.style_group_id,
  b.company_id,
  b.public_licensor_id,
  b.core_licensor_id,
  b.factory_id,
  b.plm_item_id,
  b.match_status,
  b.match_confidence,
  b.match_notes,
  b.last_matched_at,
  erp.item_description as canonical_description,
  company.name as canonical_customer_name,
  coalesce(core_lic.name, public_lic.name) as canonical_licensor_name,
  factory.name as canonical_factory_name,
  sg.sku as style_group_sku,
  erp.style_number as erp_style_number,
  b.creative_designer_id,
  creative.name as canonical_designer_name
from public.style_tracker_rows r
  left join plm.style_tracker_item_bridge b on b.style_tracker_row_id = r.id
  left join api.plm_item_list erp on erp.id = b.erp_item_id
  left join public.style_groups sg on sg.id = b.style_group_id
  left join core.customer company on company.id = b.company_id
  left join public.licensors public_lic on public_lic.id = b.public_licensor_id
  left join core.licensor core_lic on core_lic.id = b.core_licensor_id
  left join core.creative_designer creative on creative.id = b.creative_designer_id
  left join core.factory factory on factory.id = b.factory_id;
