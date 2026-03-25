-- Allow anonymous (unauthenticated) clients to read the SCAN_REQUEST row from
-- admin_config so the bridge agent can subscribe via Supabase Realtime without
-- needing a Supabase JWT.
--
-- SCAN_REQUEST contains only: request_id, status, requested_at, requested_by (uuid),
-- target_agent_id.  No secrets are stored in this key — secrets live in other
-- admin_config keys that remain restricted to authenticated admin users.
--
-- This policy enables the bridge agent's Realtime watcher (startRealtimeWatcher)
-- to receive an instant push notification when a scan is triggered, eliminating
-- the up-to-30s heartbeat polling delay.

CREATE POLICY "anon can read SCAN_REQUEST for Realtime watcher"
  ON public.admin_config
  FOR SELECT
  TO anon
  USING (key = 'SCAN_REQUEST');
