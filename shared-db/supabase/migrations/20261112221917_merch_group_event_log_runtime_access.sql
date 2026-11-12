-- Claim #6171 (popcre/designflow-data-syncing#117). Re-version of merged PRs
-- #6172 (20261112190611) and #6192 (20261112201151), neither ever applied:
-- #6172 ran out of automatic promotion attempts because main kept moving
-- under its post-merge rehearsal. Both bodies are carried verbatim below, in
-- order, so they promote as one unit. Net effect for
-- designflow_prod_backend_runtime on coldlion.merch_group_event_log:
-- schema USAGE, SELECT, INSERT, UPDATE(status, reason, rows_touched,
-- processed_at), role-scoped RLS policies; no DELETE.
-- derived-from: none

-- ===== formerly 20261112190611 =====
-- Claim #6171 (successor of #5809 / #6128; popcre/designflow-data-syncing#117).
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

-- ===== formerly 20261112201151 =====
-- Claim #6171; fix-forward for review finding #6173 on 20261112190611.
-- Narrow designflow_prod_backend_runtime's UPDATE on
-- coldlion.merch_group_event_log from the whole table to the four columns the
-- sync service writes (designflow-data-syncing helpers/merchGroupEventProcessor.js:
-- status, reason, rows_touched, processed_at). Evidence columns (event_id,
-- payload, action, company/division/key, previous_key, received_at,
-- occurred_at) become immutable to the runtime. Also states the schema USAGE
-- the grant depends on instead of relying on incidental role membership.
-- SELECT and INSERT are unchanged; DELETE stays ungranted.

do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'designflow_prod_backend_runtime') then
    grant usage on schema coldlion to designflow_prod_backend_runtime;
    revoke update on table coldlion.merch_group_event_log from designflow_prod_backend_runtime;
    grant update (status, reason, rows_touched, processed_at)
      on table coldlion.merch_group_event_log to designflow_prod_backend_runtime;

    if not (has_schema_privilege('designflow_prod_backend_runtime', 'coldlion', 'usage')
        and has_table_privilege('designflow_prod_backend_runtime', 'coldlion.merch_group_event_log', 'select')
        and has_table_privilege('designflow_prod_backend_runtime', 'coldlion.merch_group_event_log', 'insert')
        and has_column_privilege('designflow_prod_backend_runtime', 'coldlion.merch_group_event_log', 'status', 'update')
        and has_column_privilege('designflow_prod_backend_runtime', 'coldlion.merch_group_event_log', 'processed_at', 'update')) then
      raise exception '#6171 post-check: runtime access incomplete on coldlion.merch_group_event_log';
    end if;
    if has_column_privilege('designflow_prod_backend_runtime', 'coldlion.merch_group_event_log', 'payload', 'update')
       or has_column_privilege('designflow_prod_backend_runtime', 'coldlion.merch_group_event_log', 'event_id', 'update')
       or has_table_privilege('designflow_prod_backend_runtime', 'coldlion.merch_group_event_log', 'delete') then
      raise exception '#6171 post-check: runtime can still change evidence columns or delete';
    end if;
  end if;
end
$g$;
