-- #1722: make the OrderList bridge lookup index-only.
--
-- The repository's atomic migration runner cannot execute CREATE/DROP INDEX
-- CONCURRENTLY. Keep the operation transactional and fail quickly instead of
-- waiting behind live traffic.

set lock_timeout = '5s';
set statement_timeout = '5min';

create index if not exists style_tracker_item_bridge_plm_item_cover_idx
  on plm.style_tracker_item_bridge using btree (plm_item_id)
  include (id, style_tracker_row_id, tracker_type);

drop index if exists plm.style_tracker_item_bridge_plm_item_idx;
