-- Claim #6171 (successor of #5809 / #6128; popcre/designflow-data-syncing#117).
-- derived-from: none
-- The DesignFlow sync service connects as designflow_prod_backend_runtime
-- (no BYPASSRLS) and got "permission denied for table merch_group_event_log".
-- It inserts journal rows, reads them back by key/event_id, and updates
-- status/reason/rows_touched/processed_at. Grant exactly SELECT, INSERT,
-- UPDATE (never DELETE) plus matching RLS policies scoped to that role.
-- id is uuid default gen_random_uuid(): no sequence to grant.
-- Guarded: the role exists only where the DesignFlow runtime is provisioned.

do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'designflow_prod_backend_runtime') then
    grant select, insert, update on table coldlion.merch_group_event_log
      to designflow_prod_backend_runtime;

    if not exists (select 1 from pg_policies where schemaname = 'coldlion'
                   and tablename = 'merch_group_event_log'
                   and policyname = 'merch_group_event_log_runtime_select') then
      create policy merch_group_event_log_runtime_select on coldlion.merch_group_event_log
        for select to designflow_prod_backend_runtime using (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'coldlion'
                   and tablename = 'merch_group_event_log'
                   and policyname = 'merch_group_event_log_runtime_insert') then
      create policy merch_group_event_log_runtime_insert on coldlion.merch_group_event_log
        for insert to designflow_prod_backend_runtime with check (true);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'coldlion'
                   and tablename = 'merch_group_event_log'
                   and policyname = 'merch_group_event_log_runtime_update') then
      create policy merch_group_event_log_runtime_update on coldlion.merch_group_event_log
        for update to designflow_prod_backend_runtime using (true) with check (true);
    end if;

    -- Post-check.
    if not (has_table_privilege('designflow_prod_backend_runtime', 'coldlion.merch_group_event_log', 'select')
        and has_table_privilege('designflow_prod_backend_runtime', 'coldlion.merch_group_event_log', 'insert')
        and has_table_privilege('designflow_prod_backend_runtime', 'coldlion.merch_group_event_log', 'update')) then
      raise exception '#6171 post-check: runtime grants missing on coldlion.merch_group_event_log';
    end if;
    if has_table_privilege('designflow_prod_backend_runtime', 'coldlion.merch_group_event_log', 'delete') then
      raise exception '#6171 post-check: runtime role must not hold DELETE on coldlion.merch_group_event_log';
    end if;
  end if;
end
$g$;
