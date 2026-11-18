-- #5825: grants item-master and data-sync need before production switches
-- them from designflow_prod_backend_runtime to their own runtime logins.
-- derived-from: none
-- Evidence: read-only privilege diff as each runtime login (2026-11-18) cut to
-- the privileges each service's production main actually exercises (file:line
-- list on #5825). Additive only; no rows, owners, RLS or memberships change.
-- itemDetail stays column-isolated (#4659): only the two columns the Item
-- Library assortment filter reads are granted.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $pre$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION '#5825: require postgres';
  END IF;
  IF to_regrole('designflow_prod_item_master_grants') IS NULL
     OR to_regrole('designflow_prod_data_sync_grants') IS NULL THEN
    RAISE EXCEPTION '#5825: service grant roles missing';
  END IF;
END
$pre$;

-- designflow-item-master
GRANT UPDATE ON TABLE dflow_prod."itemHeader" TO designflow_prod_item_master_grants;
GRANT SELECT (item_num_id, prepack_code_fk) ON TABLE dflow_prod."itemDetail" TO designflow_prod_item_master_grants;
GRANT UPDATE ON TABLE dflow_prod."groups" TO designflow_prod_item_master_grants;
GRANT SELECT ON TABLE dflow_prod."externalVendor" TO designflow_prod_item_master_grants;
GRANT SELECT ON TABLE dflow_prod.app_settings TO designflow_prod_item_master_grants;
GRANT SELECT ON TABLE dflow_prod."AuditLog" TO designflow_prod_item_master_grants;

-- designflow-data-syncing
GRANT SELECT ON TABLE dflow_prod."SeasonCode" TO designflow_prod_data_sync_grants;
GRANT SELECT ON TABLE dflow_prod."externalVendor" TO designflow_prod_data_sync_grants;
GRANT SELECT ON TABLE dflow_prod."externalCustomer" TO designflow_prod_data_sync_grants;

DO $post$
BEGIN
  IF NOT has_table_privilege('designflow_prod_item_master_grants','dflow_prod."itemHeader"','UPDATE')
     OR NOT has_column_privilege('designflow_prod_item_master_grants','dflow_prod."itemDetail"','prepack_code_fk','SELECT')
     OR has_table_privilege('designflow_prod_item_master_grants','dflow_prod."itemDetail"','SELECT')
     OR NOT has_table_privilege('designflow_prod_data_sync_grants','dflow_prod."SeasonCode"','SELECT') THEN
    RAISE EXCEPTION '#5825: post-condition failed';
  END IF;
END
$post$;
COMMIT;
