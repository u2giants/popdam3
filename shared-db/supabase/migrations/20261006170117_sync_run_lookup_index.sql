-- derived-from: none
-- Speed repeated ColdLion failure lookbacks and snapshot selection.
create index if not exists sync_run_source_name_source_system_status_started_at_idx
  on ingest.sync_run (source_name, source_system, status, started_at desc);
