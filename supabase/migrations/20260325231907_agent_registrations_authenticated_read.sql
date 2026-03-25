-- Allow all authenticated users to read agent_registrations so the
-- library page and AppHeader can show agent status (bridgeStatus) via
-- the Supabase JS client. Write operations remain admin-only.
CREATE POLICY "authenticated users can read agent_registrations"
  ON public.agent_registrations
  FOR SELECT
  TO authenticated
  USING (true);
