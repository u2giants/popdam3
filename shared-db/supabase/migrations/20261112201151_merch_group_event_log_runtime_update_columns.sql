-- Claim #6171; fix-forward for review finding #6173 on 20261112190611.
-- derived-from: none
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
