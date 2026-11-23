-- derived-from: none
-- Claim popcre/shared-db#6980. The DesignFlow production sync duplicate
-- cleanup (designflow-data-syncing helpers/merchGroupPull.js
-- assertNoDuplicateReferences) checks that no row of
-- dflow_prod.mg_combination_description names a duplicate merch group in
-- mg01_id, mg02_id or mg03_id. The sync role cannot read the table, so the
-- cleanup refuses. Grant column-scoped SELECT on exactly those columns.
-- Read-only. Rollback: revoke select (mg01_id, mg02_id, mg03_id) on the table.
begin;
set local lock_timeout = '5s';

do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'designflow_prod_data_sync_grants')
     and to_regclass('dflow_prod.mg_combination_description') is not null then
    grant usage on schema dflow_prod to designflow_prod_data_sync_grants;
    grant select (mg01_id, mg02_id, mg03_id)
      on table dflow_prod."mg_combination_description" to designflow_prod_data_sync_grants;

    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'dflow_prod' and c.relname = 'mg_combination_description'
                 and (c.relrowsecurity or c.relforcerowsecurity)) then
      raise exception 'row security on mg_combination_description: column grant would read zero rows';
    end if;

    if exists (select 1 from pg_roles where rolname = 'designflow_prod_data_sync_runtime')
       and not (has_column_privilege('designflow_prod_data_sync_runtime', 'dflow_prod.mg_combination_description', 'mg01_id', 'select')
            and has_column_privilege('designflow_prod_data_sync_runtime', 'dflow_prod.mg_combination_description', 'mg02_id', 'select')
            and has_column_privilege('designflow_prod_data_sync_runtime', 'dflow_prod.mg_combination_description', 'mg03_id', 'select')) then
      raise exception 'sync runtime still cannot read mg_combination_description reference columns';
    end if;
  end if;
end
$grant$;

commit;
