-- Claim #6898. The nightly ColdLion job (popcre-item-header-sync-prod) runs as
-- designflow_prod_data_sync_runtime and now refreshes seasons from ColdLion
-- (popcre/designflow-data-syncing#150). It failed 2026-11-20 with
-- "permission denied for table SeasonCode": data_sync_grants holds SELECT only.
-- Grant INSERT and UPDATE; never DELETE. id is an identity column, so no
-- sequence grant. Guarded: dflow_prod exists only where DesignFlow runs.
-- derived-from: none

do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'designflow_prod_data_sync_grants')
     and to_regclass('dflow_prod."SeasonCode"') is not null then
    grant insert, update on table dflow_prod."SeasonCode" to designflow_prod_data_sync_grants;

    if not (has_table_privilege('designflow_prod_data_sync_runtime', 'dflow_prod."SeasonCode"', 'insert')
        and has_table_privilege('designflow_prod_data_sync_runtime', 'dflow_prod."SeasonCode"', 'update')) then
      raise exception '#6898 post-check: data-sync runtime cannot write dflow_prod."SeasonCode"';
    end if;
    if has_table_privilege('designflow_prod_data_sync_runtime', 'dflow_prod."SeasonCode"', 'delete') then
      raise exception '#6898 post-check: data-sync runtime must not hold DELETE on dflow_prod."SeasonCode"';
    end if;
  end if;
end
$g$;
