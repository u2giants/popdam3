-- Enforce single running ERP sync at the DB level.
-- A second concurrent INSERT of a 'running' row will fail immediately,
-- preventing the application-level lock check from being bypassed.
CREATE UNIQUE INDEX IF NOT EXISTS erp_sync_runs_one_running
  ON erp_sync_runs ((true))
  WHERE status = 'running';
