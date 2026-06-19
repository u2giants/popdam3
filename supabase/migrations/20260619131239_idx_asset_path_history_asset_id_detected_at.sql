-- asset_path_history has ~4.7M rows and only a PK on id. The asset detail panel
-- queries `where asset_id = ? order by detected_at desc limit 10`, which without
-- a supporting index does a full parallel seq scan (~30s) and 500s under the 8s
-- authenticated statement_timeout. This composite index turns it into a bounded
-- index scan (find the asset's rows already in detected_at order, take 10).
-- Result: ~30,500ms -> ~16ms.
CREATE INDEX IF NOT EXISTS idx_asset_path_history_asset_id_detected_at
  ON public.asset_path_history (asset_id, detected_at DESC);
