-- #4930: plm.production_order_line_source_ref went unanalyzed after ColdLion rows
-- arrived (planner saw 1 coldlion row, actual 1,131), producing a 28.9M-check nested
-- loop in api.dam_order_list and statement timeouts. Default autoanalyze waits for
-- 50 + 10% of rows to change; this small, source-skewed table needs 50 + 2%.
alter table plm.production_order_line_source_ref
  set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 50);
