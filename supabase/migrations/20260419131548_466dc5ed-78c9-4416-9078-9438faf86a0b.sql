-- 1) Enum of apps that a user can be granted access to
CREATE TYPE public.app_name AS ENUM ('popdam', 'styleguides');

-- 2) app_access: which app(s) each user can enter
CREATE TABLE public.app_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  app public.app_name NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid,
  UNIQUE (user_id, app)
);

CREATE INDEX idx_app_access_user_id ON public.app_access(user_id);

ALTER TABLE public.app_access ENABLE ROW LEVEL SECURITY;

-- Users can read their own access rows (so a frontend can decide whether to show an app switcher)
CREATE POLICY "Users read own app_access"
  ON public.app_access
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admins manage all access
CREATE POLICY "Admins manage app_access"
  ON public.app_access
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 3) Helper: check if a user has access to a given app
CREATE OR REPLACE FUNCTION public.has_app_access(_user_id uuid, _app public.app_name)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = _user_id AND app = _app
  )
$$;

-- 4) Backfill: every existing user gets popdam access
INSERT INTO public.app_access (user_id, app)
SELECT user_id, 'popdam'::public.app_name
FROM public.profiles
ON CONFLICT (user_id, app) DO NOTHING;

-- 5) Extend invitations with which apps the invitee should be granted
ALTER TABLE public.invitations
  ADD COLUMN apps public.app_name[] NOT NULL DEFAULT ARRAY['popdam']::public.app_name[];

-- 6) Update handle_new_user to grant app_access from the invitation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _invitation record;
  _email text;
  _app public.app_name;
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

  -- Grant app access from invitation.apps (default ['popdam'])
  FOREACH _app IN ARRAY COALESCE(_invitation.apps, ARRAY['popdam']::public.app_name[])
  LOOP
    INSERT INTO public.app_access (user_id, app, granted_by)
    VALUES (NEW.id, _app, _invitation.invited_by)
    ON CONFLICT (user_id, app) DO NOTHING;
  END LOOP;

  -- Mark invitation accepted
  UPDATE public.invitations
  SET accepted_at = now()
  WHERE id = _invitation.id;

  RETURN NEW;
END;
$function$;