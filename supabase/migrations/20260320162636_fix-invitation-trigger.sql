-- Fix invitation trigger to preserve Pending/Accepted semantics when using
-- auth.admin.inviteUserByEmail(), which inserts into auth.users immediately
-- (with invited_at set, email_confirmed_at null) before the user clicks the link.
--
-- Before: handle_new_user set accepted_at on INSERT, so all invites showed "Accepted" immediately.
-- After:
--   handle_new_user creates profile + assigns role but does NOT set accepted_at for admin invites.
--   handle_user_confirmed sets accepted_at when the user actually clicks the magic link.

-- 1. Update handle_new_user to skip accepted_at for admin-invited (not-yet-confirmed) users
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

  SELECT * INTO _invitation
  FROM public.invitations
  WHERE email = _email AND accepted_at IS NULL;

  IF _invitation IS NULL THEN
    RAISE EXCEPTION 'Access denied: no valid invitation found for %', _email;
  END IF;

  -- Create profile
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, _email, COALESCE(NEW.raw_user_meta_data->>'full_name', _email));

  -- Assign role from invitation
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _invitation.role);

  -- Only mark accepted when this is a regular signup (user confirmed themselves).
  -- For admin invites (invited_at set, email not yet confirmed), leave accepted_at null
  -- so the invitation shows as "Pending" until the user clicks the magic link.
  IF NEW.invited_at IS NULL OR NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.invitations
    SET accepted_at = now()
    WHERE id = _invitation.id;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Add trigger to mark invitation accepted when user confirms their email (clicks magic link)
CREATE OR REPLACE FUNCTION public.handle_user_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.invitations
    SET accepted_at = now()
    WHERE email = NEW.email AND accepted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_confirmed();
