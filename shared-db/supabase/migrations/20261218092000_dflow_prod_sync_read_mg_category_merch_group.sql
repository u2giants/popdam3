-- derived-from: none
-- Claim popcre/shared-db#6728. App contract popcre/designflow-data-syncing#103 (PR 161).
-- Production merch-group repair preview reads category links from
-- core.mg_category_merch_group as designflow_prod_data_sync_grants and gets
-- permission denied. Grant SELECT only (role already granted plainly in
-- 20261204000800). Rollback: revoke select.
begin;
set local lock_timeout = '5s';
grant select on table core.mg_category_merch_group to designflow_prod_data_sync_grants;
commit;
