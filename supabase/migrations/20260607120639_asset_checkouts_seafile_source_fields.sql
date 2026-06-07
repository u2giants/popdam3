-- Seafile-aware checkout: source provenance + helper heartbeat tracking.
-- All columns nullable, no backfill. Does NOT touch the existing partial unique
-- index on asset_checkouts(asset_id) WHERE status IN
-- ('active','checkin_queued','uploading','verifying').
ALTER TABLE public.asset_checkouts
  ADD COLUMN IF NOT EXISTS source_provider text,
  ADD COLUMN IF NOT EXISTS source_local_path text,
  ADD COLUMN IF NOT EXISTS seafile_library_id text,
  ADD COLUMN IF NOT EXISTS seafile_path text,
  ADD COLUMN IF NOT EXISTS source_version text,
  ADD COLUMN IF NOT EXISTS last_helper_heartbeat_at timestamptz;

COMMENT ON COLUMN public.asset_checkouts.source_provider IS 'Storage provider the source was read from: seafile | synology | local';
COMMENT ON COLUMN public.asset_checkouts.source_local_path IS 'Machine-local source path at checkout time (informational)';
COMMENT ON COLUMN public.asset_checkouts.seafile_library_id IS 'Seafile library UUID, when source_provider = seafile';
COMMENT ON COLUMN public.asset_checkouts.seafile_path IS 'Path within the Seafile library, when source_provider = seafile';
COMMENT ON COLUMN public.asset_checkouts.source_version IS 'Seafile file obj_id at checkout (server-side conflict detection); null for non-Seafile';
COMMENT ON COLUMN public.asset_checkouts.last_helper_heartbeat_at IS 'Updated on every heartbeat carrying this checkout id';
