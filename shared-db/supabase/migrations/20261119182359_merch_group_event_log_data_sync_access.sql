-- Claim #6860 (popcre/designflow-data-syncing#117 follow-up).
-- popcre-sync-prod connects as designflow_prod_data_sync_runtime (secret
-- DB_USER_SYNC), not designflow_prod_backend_runtime, and logs
-- "permission denied for schema coldlion" when it reads/writes the
-- merch-group event journal. Give it exactly what 20261112221917 gave the
-- backend runtime: schema USAGE, SELECT, INSERT, UPDATE(status, reason,
-- rows_touched, processed_at), role-scoped RLS policies; never DELETE.
-- Guarded: the role exists only where the DesignFlow runtime is provisioned.
-- derived-from: none
-- Mirrors the grants of 20261112221917_merch_group_event_log_runtime_access.sql.

do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'designflow_prod_data_sync_runtime') then
    grant usage on schema coldlion to designflow_prod_data_sync_runtime;
    grant select, insert on table coldlion.merch_group_event_log
      to designflow_prod_data_sync_runtime;
    grant update (status, reason, rows_touched, processed_at)
      on table coldlion.merch_group_event_log to designflow_prod_data_sync_runtime;

    if not exists (select 1 from pg_policies where schemaname = 'coldlion'
                   and tablename = 'merch_group_event_log'
                   and policyname = 'merch_group_event_log_data_sync_select') then
      create policy merch_group_event_log_data_sync_select on coldlion.merch_group_event_log
        for select to designflow_prod_data_sync_runtime using (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'coldlion'
                   and tablename = 'merch_group_event_log'
                   and policyname = 'merch_group_event_log_data_sync_insert') then
      create policy merch_group_event_log_data_sync_insert on coldlion.merch_group_event_log
        for insert to designflow_prod_data_sync_runtime with check (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'coldlion'
                   and tablename = 'merch_group_event_log'
                   and policyname = 'merch_group_event_log_data_sync_update') then
      create policy merch_group_event_log_data_sync_update on coldlion.merch_group_event_log
        for update to designflow_prod_data_sync_runtime using (true) with check (true);
    end if;

    if not (has_schema_privilege('designflow_prod_data_sync_runtime', 'coldlion', 'usage')
        and has_table_privilege('designflow_prod_data_sync_runtime', 'coldlion.merch_group_event_log', 'select')
        and has_table_privilege('designflow_prod_data_sync_runtime', 'coldlion.merch_group_event_log', 'insert')
        and has_column_privilege('designflow_prod_data_sync_runtime', 'coldlion.merch_group_event_log', 'status', 'update')) then
      raise exception '#6860 post-check: data-sync grants missing on coldlion.merch_group_event_log';
    end if;
    if has_table_privilege('designflow_prod_data_sync_runtime', 'coldlion.merch_group_event_log', 'delete')
       or has_column_privilege('designflow_prod_data_sync_runtime', 'coldlion.merch_group_event_log', 'payload', 'update') then
      raise exception '#6860 post-check: data-sync role must not hold DELETE or evidence-column UPDATE';
    end if;
  end if;
end
$g$;
