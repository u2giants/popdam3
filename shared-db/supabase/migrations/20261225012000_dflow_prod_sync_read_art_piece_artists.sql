-- derived-from: none
-- Claim popcre/shared-db#6728. App contract popcre/designflow-data-syncing#103
-- (production preview HTTP 500 "permission denied for table art_piece",
-- 2026-11-20). The merch-group repair in-use scan reads dflow_prod.art_piece
-- and dflow_prod.artists as designflow_prod_data_sync_grants. Grant SELECT
-- only. dflow_prod tables have no row security, so no policy is needed.
-- Rollback: revoke select on both tables.
begin;
set local lock_timeout = '5s';
grant select on table dflow_prod."art_piece" to designflow_prod_data_sync_grants;
grant select on table dflow_prod."artists" to designflow_prod_data_sync_grants;
do $check$
begin
  if not has_table_privilege('designflow_prod_data_sync_runtime', 'dflow_prod.art_piece', 'select')
     or not has_table_privilege('designflow_prod_data_sync_runtime', 'dflow_prod.artists', 'select') then
    raise exception 'runtime cannot read dflow_prod.art_piece / artists';
  end if;
end $check$;
commit;
