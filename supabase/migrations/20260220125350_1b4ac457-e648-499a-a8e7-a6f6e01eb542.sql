
-- =============================================
-- PopDAM V2 — Phase 1 Database Migration
-- =============================================

-- 1) ENUMS
CREATE TYPE public.file_type AS ENUM ('psd', 'ai');
CREATE TYPE public.asset_status AS ENUM ('pending', 'processing', 'tagged', 'error');
CREATE TYPE public.queue_status AS ENUM ('pending', 'claimed', 'processing', 'completed', 'failed');
CREATE TYPE public.asset_type AS ENUM ('art_piece', 'product');
CREATE TYPE public.art_source AS ENUM ('freelancer', 'straight_style_guide', 'style_guide_composition');
CREATE TYPE public.workflow_status AS ENUM (
  'product_ideas', 'concept_approved', 'in_development', 'freelancer_art',
  'discontinued', 'in_process', 'customer_adopted', 'licensor_approved', 'other'
);
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- 2) EXTENSION for trigram search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 3) TABLES

-- 3.1 licensors
CREATE TABLE public.licensors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  external_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3.2 properties
CREATE TABLE public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licensor_id uuid NOT NULL REFERENCES public.licensors(id) ON DELETE CASCADE,
  name text NOT NULL,
  external_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3.3 characters
CREATE TABLE public.characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  external_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3.4 product taxonomy
CREATE TABLE public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  external_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.product_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  external_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_subtypes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id uuid NOT NULL REFERENCES public.product_types(id) ON DELETE CASCADE,
  name text NOT NULL,
  external_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3.5 assets (main table)
CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  relative_path text NOT NULL,
  file_type public.file_type NOT NULL,
  file_size bigint DEFAULT 0,
  width int DEFAULT 0,
  height int DEFAULT 0,
  artboards int DEFAULT 1,
  thumbnail_url text,
  thumbnail_error text,
  is_licensed boolean DEFAULT false,
  is_deleted boolean DEFAULT false,
  licensor_id uuid REFERENCES public.licensors(id) ON DELETE SET NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  product_subtype_id uuid REFERENCES public.product_subtypes(id) ON DELETE SET NULL,
  asset_type public.asset_type,
  art_source public.art_source,
  big_theme text,
  little_theme text,
  design_ref text,
  design_style text,
  ai_description text,
  scene_description text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  workflow_status public.workflow_status DEFAULT 'other',
  status public.asset_status DEFAULT 'pending',
  quick_hash text NOT NULL,
  quick_hash_version int NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_scanned_at timestamptz,
  modified_at timestamptz NOT NULL,  -- NO DEFAULT: agent must supply from disk
  file_created_at timestamptz,
  ingested_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_relative_path_unique UNIQUE (relative_path)
);

-- 3.6 asset_characters (join table)
CREATE TABLE public.asset_characters (
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, character_id)
);

-- 3.7 asset_path_history
CREATE TABLE public.asset_path_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  old_relative_path text NOT NULL,
  new_relative_path text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now()
);

-- 3.8 processing_queue
CREATE TABLE public.processing_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status public.queue_status DEFAULT 'pending',
  agent_id text,
  claimed_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3.9 render_queue
CREATE TABLE public.render_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  status public.queue_status DEFAULT 'pending',
  claimed_by text,
  claimed_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3.10 agent_registrations
CREATE TABLE public.agent_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL,
  agent_type text NOT NULL DEFAULT 'bridge',
  agent_key_hash text UNIQUE NOT NULL,
  last_heartbeat timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3.11 profiles
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3.12 user_roles (separate from profiles per security requirement)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- 3.13 invitations
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  role public.app_role DEFAULT 'user',
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

-- 3.14 admin_config
CREATE TABLE public.admin_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- =============================================
-- 4) INDEXES
-- =============================================

CREATE INDEX idx_assets_file_type ON public.assets (file_type);
CREATE INDEX idx_assets_status ON public.assets (status);
CREATE INDEX idx_assets_workflow_status ON public.assets (workflow_status);
CREATE INDEX idx_assets_is_licensed ON public.assets (is_licensed);
CREATE INDEX idx_assets_modified_at ON public.assets (modified_at);
CREATE INDEX idx_assets_file_created_at ON public.assets (file_created_at);
CREATE INDEX idx_assets_licensor_id ON public.assets (licensor_id);
CREATE INDEX idx_assets_property_id ON public.assets (property_id);
CREATE INDEX idx_assets_product_subtype_id ON public.assets (product_subtype_id);
CREATE INDEX idx_assets_quick_hash ON public.assets (quick_hash);
CREATE INDEX idx_assets_tags ON public.assets USING GIN (tags);
CREATE INDEX idx_assets_filename_trgm ON public.assets USING GIN (filename gin_trgm_ops);
CREATE INDEX idx_assets_relative_path_trgm ON public.assets USING GIN (relative_path gin_trgm_ops);
CREATE INDEX idx_assets_is_deleted ON public.assets (is_deleted);

CREATE INDEX idx_processing_queue_status ON public.processing_queue (status);
CREATE INDEX idx_render_queue_status ON public.render_queue (status);
CREATE INDEX idx_agent_registrations_last_heartbeat ON public.agent_registrations (last_heartbeat);

-- =============================================
-- 5) FUNCTIONS
-- =============================================

-- 5.1 has_role() — SECURITY DEFINER for RLS without recursion
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 5.2 handle_new_user() — invitation-only enforcement trigger
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
  
  -- Mark invitation accepted
  UPDATE public.invitations
  SET accepted_at = now()
  WHERE id = _invitation.id;
  
  RETURN NEW;
END;
$$;

-- Attach trigger to auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 5.3 claim_jobs() — FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_jobs(
  p_agent_id text,
  p_batch_size int DEFAULT 5
)
RETURNS SETOF public.processing_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.processing_queue
  SET status = 'claimed', agent_id = p_agent_id, claimed_at = now()
  WHERE id IN (
    SELECT id FROM public.processing_queue
    WHERE status = 'pending'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  RETURNING *;
END;
$$;

-- 5.4 reset_stale_jobs()
CREATE OR REPLACE FUNCTION public.reset_stale_jobs(p_timeout_minutes int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected int;
BEGIN
  UPDATE public.processing_queue
  SET status = 'pending', agent_id = NULL, claimed_at = NULL
  WHERE status IN ('claimed', 'processing')
    AND claimed_at < now() - (p_timeout_minutes || ' minutes')::interval;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- 5.5 auto_queue_render() — trigger for .ai files with thumbnail errors
CREATE OR REPLACE FUNCTION public.auto_queue_render()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.file_type = 'ai' AND NEW.thumbnail_error IS NOT NULL AND NEW.thumbnail_url IS NULL THEN
    INSERT INTO public.render_queue (asset_id, status)
    VALUES (NEW.id, 'pending')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_queue_render
  AFTER INSERT OR UPDATE OF thumbnail_error ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_queue_render();

-- 5.6 update_updated_at_column()
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_licensors_updated_at BEFORE UPDATE ON public.licensors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_characters_updated_at BEFORE UPDATE ON public.characters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 6) RLS POLICIES
-- =============================================

-- Enable RLS on all tables
ALTER TABLE public.licensors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_subtypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_path_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.render_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;

-- Assets: authenticated can read non-deleted, admins can write
CREATE POLICY "Authenticated users can read visible assets"
  ON public.assets FOR SELECT TO authenticated
  USING (is_deleted = false);

CREATE POLICY "Admins can insert assets"
  ON public.assets FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update assets"
  ON public.assets FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Reference tables: authenticated read, admin write
CREATE POLICY "Authenticated read licensors" ON public.licensors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write licensors" ON public.licensors FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read properties" ON public.properties FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write properties" ON public.properties FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read characters" ON public.characters FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write characters" ON public.characters FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read product_categories" ON public.product_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write product_categories" ON public.product_categories FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read product_types" ON public.product_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write product_types" ON public.product_types FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read product_subtypes" ON public.product_subtypes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write product_subtypes" ON public.product_subtypes FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Asset characters: authenticated read
CREATE POLICY "Authenticated read asset_characters" ON public.asset_characters FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write asset_characters" ON public.asset_characters FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Path history: authenticated read
CREATE POLICY "Authenticated read asset_path_history" ON public.asset_path_history FOR SELECT TO authenticated USING (true);

-- Queues: admin only
CREATE POLICY "Admin manage processing_queue" ON public.processing_queue FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin manage render_queue" ON public.render_queue FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Agent registrations: admin only
CREATE POLICY "Admin manage agent_registrations" ON public.agent_registrations FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Profiles: users read own, admins read all
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- User roles: no direct access (use has_role function)
CREATE POLICY "Admins manage user_roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Invitations: admin only
CREATE POLICY "Admin manage invitations" ON public.invitations FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Admin config: authenticated read, admin write
CREATE POLICY "Authenticated read admin_config" ON public.admin_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write admin_config" ON public.admin_config FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin update admin_config" ON public.admin_config FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin delete admin_config" ON public.admin_config FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- =============================================
-- 7) SEED DATA
-- =============================================

INSERT INTO public.admin_config (key, value) VALUES
  ('THUMBNAIL_MIN_DATE', '"2020-01-01"'),
  ('SCAN_MIN_DATE', '"2010-01-01"'),
  ('NAS_CONFIG', '{"host": "edgesynology2", "ip": "", "share": "mac", "mount_root": "/mnt/nas/mac"}'),
  ('SPACES_CONFIG', '{"public_base_url": "", "endpoint": "", "region": "nyc3", "bucket_name": "popdam"}'),
  ('AI_CONFIG', '{"provider": "lovable", "model_name": "google/gemini-3-flash-preview", "enabled": true}'),
  ('TAXONOMY_ENDPOINTS', '{"licensors": "", "properties": "", "characters": "", "products": ""}')
ON CONFLICT (key) DO NOTHING;
