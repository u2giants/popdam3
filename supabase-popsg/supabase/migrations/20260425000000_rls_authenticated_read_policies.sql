-- Allow all authenticated users to SELECT from tables that the frontend
-- reads directly via the Supabase JS client (AppHeader agent status,
-- crawl progress realtime, library file grid).
--
-- Without these policies the JS client returns 0 rows (RLS silently
-- filters everything), making the UI appear as if no data exists.

CREATE POLICY "authenticated users can read agent_registrations"
  ON public.agent_registrations
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated read admin_config"
  ON public.admin_config
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated read style_guide_files"
  ON public.style_guide_files
  FOR SELECT
  TO authenticated
  USING (true);
