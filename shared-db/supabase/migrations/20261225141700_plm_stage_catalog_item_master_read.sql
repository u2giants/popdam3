-- designflow-tracking#130: column-scoped read-only access for DesignFlow Item
-- Master to read Stage Catalog licensing durations (plm.stage_list, plm.stage,
-- plm.stage_duration) when retiring dflow_prod."LicensingTime". No write
-- rights; no changes to tracking or backend grants.
-- derived-from: none

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant usage on schema plm to designflow_prod_item_master_grants;

grant select (id, key, name, duration_unit, position, version, updated_at)
  on plm.stage_list to designflow_prod_item_master_grants;

grant select (id, list_id, position, name, default_duration, duration_varies_by,
  counts_toward_total, applies_to, done_signal, active)
  on plm.stage to designflow_prod_item_master_grants;

grant select (id, stage_id, scope_kind, scope_value, duration)
  on plm.stage_duration to designflow_prod_item_master_grants;

create policy stage_list_dflow_prod_item_master_read on plm.stage_list for select
  to designflow_prod_item_master_grants
  using (true);

create policy stage_dflow_prod_item_master_read on plm.stage for select
  to designflow_prod_item_master_grants
  using (true);

create policy stage_duration_dflow_prod_item_master_read on plm.stage_duration for select
  to designflow_prod_item_master_grants
  using (true);

commit;
