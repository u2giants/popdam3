-- Allow users authenticated via Authentik to bypass the invitation check.
--
-- Authentik users come from AD (already trusted). The edge function sets
-- app_metadata.provider = 'authentik' when calling admin.createUser(), so the
-- trigger can distinguish them from regular self-signup flows.
--
-- All other paths (Google, Microsoft, email/password) still require an invitation.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _invitation record;
  _email text;
BEGIN
  _email := NEW.email;

  -- Authentik users come from AD — skip invitation, auto-assign 'user' role
  IF NEW.raw_app_meta_data->>'provider' = 'authentik' THEN
    INSERT INTO public.profiles (user_id, email, full_name)
    VALUES (NEW.id, _email, COALESCE(NEW.raw_user_meta_data->>'full_name', _email));

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
  END IF;

  -- All other sign-in methods require a pending invitation
  SELECT * INTO _invitation
  FROM public.invitations
  WHERE email = _email AND accepted_at IS NULL;

  IF _invitation IS NULL THEN
    RAISE EXCEPTION 'Access denied: no valid invitation found for %', _email;
  END IF;

  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, _email, COALESCE(NEW.raw_user_meta_data->>'full_name', _email));

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _invitation.role);

  IF NEW.invited_at IS NULL OR NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.invitations
    SET accepted_at = now()
    WHERE id = _invitation.id;
  END IF;

  RETURN NEW;
END;
$$;
