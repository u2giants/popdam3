-- Recreate production style-tracker audit triggers after their tables and
-- functions have been reconciled.

drop trigger if exists trg_style_tracker_item_bridge_audit on plm.style_tracker_item_bridge;
create trigger trg_style_tracker_item_bridge_audit
  before insert or update on plm.style_tracker_item_bridge
  for each row execute function plm.set_style_tracker_bridge_audit_fields();

drop trigger if exists trg_style_tracker_value_resolution_audit on plm.style_tracker_value_resolution;
create trigger trg_style_tracker_value_resolution_audit
  before insert or update on plm.style_tracker_value_resolution
  for each row execute function plm.set_style_tracker_value_resolution_audit_fields();

drop trigger if exists trg_style_tracker_row_audit on public.style_tracker_rows;
create trigger trg_style_tracker_row_audit
  after insert or update of row_data on public.style_tracker_rows
  for each row execute function public.log_style_tracker_row_audit();

drop trigger if exists trg_style_tracker_rows_audit on public.style_tracker_rows;
create trigger trg_style_tracker_rows_audit
  before insert or update on public.style_tracker_rows
  for each row execute function public.set_style_tracker_row_audit_fields();
