-- Fix OAuth first-login provisioning.
--
-- Microsoft/Azure can return an email with different casing than the invitation
-- stored by admin-api, which lowercases invite emails. The auth.users trigger
-- was doing an exact match and surfaced the miss as Supabase's generic
-- "database error saving new user" message.
--
-- This also restores app_access grants that were accidentally dropped by the
-- Authentik invitation-bypass migration.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _invitation record;
  _email text;
  _full_name text;
  _app public.app_name;
BEGIN
  _email := lower(NEW.email);
  _full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    _email
  );

  -- Authentik users come from company AD. They bypass invitations but still
  -- need the same profile, role, and app_access bootstrap as invited users.
  IF NEW.raw_app_meta_data->>'provider' = 'authentik' THEN
    INSERT INTO public.profiles (user_id, email, full_name)
    VALUES (NEW.id, _email, _full_name)
    ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
          updated_at = now();

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.app_access (user_id, app)
    VALUES (NEW.id, 'popdam'::public.app_name)
    ON CONFLICT (user_id, app) DO NOTHING;

    RETURN NEW;
  END IF;

  -- Google, Microsoft, and email/password remain invitation-only.
  SELECT * INTO _invitation
  FROM public.invitations
  WHERE lower(email) = _email AND accepted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF _invitation IS NULL THEN
    RAISE EXCEPTION 'Access denied: no valid invitation found for %', _email;
  END IF;

  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, _email, _full_name)
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _invitation.role)
  ON CONFLICT (user_id, role) DO NOTHING;

  FOREACH _app IN ARRAY COALESCE(_invitation.apps, ARRAY['popdam']::public.app_name[])
  LOOP
    INSERT INTO public.app_access (user_id, app, granted_by)
    VALUES (NEW.id, _app, _invitation.invited_by)
    ON CONFLICT (user_id, app) DO NOTHING;
  END LOOP;

  IF NEW.invited_at IS NULL OR NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.invitations
    SET accepted_at = now()
    WHERE id = _invitation.id;
  END IF;

  RETURN NEW;
END;
$$;
