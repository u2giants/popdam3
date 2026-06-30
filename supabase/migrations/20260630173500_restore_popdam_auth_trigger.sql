-- Restore PopDAM auth provisioning after the shared CRM auth migration replaced
-- the original generic on_auth_user_created trigger name.
--
-- Keep this trigger name PopDAM-specific so shared-app migrations can add their
-- own auth.users triggers without clobbering PopDAM profile/app_access creation.

DROP TRIGGER IF EXISTS on_auth_user_created_popdam ON auth.users;

CREATE TRIGGER on_auth_user_created_popdam
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Backfill users created while the PopDAM trigger was missing. Limit the
-- automatic grant to managed company SSO providers; invitation-based users are
-- still governed by public.handle_new_user() on future signup.
WITH company_sso_users AS (
  SELECT
    u.id,
    lower(u.email) AS email,
    COALESCE(
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      lower(u.email)
    ) AS full_name
  FROM auth.users u
  WHERE u.raw_app_meta_data->>'provider' IN ('authentik', 'azure')
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = u.id
    )
)
INSERT INTO public.profiles (user_id, email, full_name)
SELECT id, email, full_name
FROM company_sso_users
ON CONFLICT (user_id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      updated_at = now();

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'user'::public.app_role
FROM auth.users u
WHERE u.raw_app_meta_data->>'provider' IN ('authentik', 'azure')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.app_access (user_id, app)
SELECT u.id, 'popdam'::public.app_name
FROM auth.users u
WHERE u.raw_app_meta_data->>'provider' IN ('authentik', 'azure')
ON CONFLICT (user_id, app) DO NOTHING;
