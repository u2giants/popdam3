begin transaction read only;

select jsonb_build_object(
  'db_data_admin_list_function', exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname = 'db_data_admin_licensor_property_list'
  ),
  'db_data_admin_tree_function', exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname = 'db_data_admin_licensor_property_tree'
  ),
  'dam_asset_library_rows', (select count(*) from api.dam_asset_library),
  'dam_character_catalog_rows', (select count(*) from public.dam_character_catalog),
  'pm_product_board_rows', (select count(*) from api.pm_product_board),
  'plm_item_status_rows', (select count(*) from api.plm_item_status),
  'style_tracker_rows', (select count(*) from public.style_tracker_rows_with_bridge),
  'licensor_reconciliation_rows', (select count(*) from api.coldlion_licensor_reconciliation),
  'property_reconciliation_rows', (select count(*) from api.coldlion_property_reconciliation),
  'cutover_summary_rows', (select count(*) from api.coldlion_taxonomy_cutover_summary),
  'crm_licensor_fk_rows', (select count(*) from crm.licensor_approval_thread),
  'pim_product_rows', (select count(*) from pim.product),
  'plm_item_rows', (select count(*) from plm.item),
  'invalid_core_fk_count', (
    select count(*)
    from pg_constraint
    where contype = 'f'
      and not convalidated
      and confrelid in ('core.licensor'::regclass, 'core.property'::regclass)
  ),
  'designflow_still_present', (
    to_regclass('plm.licensor_import') is not null
    and to_regclass('plm.property_import') is not null
    and to_regprocedure('plm.import_master_data(jsonb,jsonb)') is not null
  )
) as smoke;

rollback;
