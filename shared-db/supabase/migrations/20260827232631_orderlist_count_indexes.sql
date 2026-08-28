-- #1657: keep exact OrderList counts off two cold sequential scans.

set lock_timeout = '5s';
set statement_timeout = '5min';

create index if not exists style_tracker_item_bridge_plm_item_idx
  on plm.style_tracker_item_bridge using btree (plm_item_id);

create index if not exists production_order_line_count_cover_idx
  on plm.production_order_line using btree (production_order_id, item_id, id);
