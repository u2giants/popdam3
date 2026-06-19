-- The previous style_guide_file_groups/style_guide_folders VIEWS used
-- security_invoker, so RLS on style_guide_files (no anon policy) blocked anon.
-- The matviews bypass RLS, and Supabase's default privileges auto-granted anon
-- SELECT — exposing the licensed-art catalog (licensor/property/style-guide
-- names) to the public anon key. Revoke to restore authenticated-only access.
REVOKE ALL ON public.style_guide_file_groups FROM anon, PUBLIC;
REVOKE ALL ON public.style_guide_folders FROM anon, PUBLIC;
GRANT SELECT ON public.style_guide_file_groups TO authenticated, service_role;
GRANT SELECT ON public.style_guide_folders TO authenticated, service_role;
