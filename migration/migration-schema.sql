-- ============================================================================
-- PopDAM Migration Schema — Lovable Cloud → External Supabase
-- Generated 2026-03-11
--
-- INSTRUCTIONS:
--   1. Open your external Supabase project dashboard
--   2. Go to SQL Editor
--   3. Paste this ENTIRE file
--   4. Click "Run"
--   5. If you get errors about pg_trgm, run: CREATE EXTENSION IF NOT EXISTS pg_trgm;
--      separately first, then run this file again.
--
-- This script is IDEMPOTENT for enums/extensions (uses IF NOT EXISTS).
-- Tables will fail if they already exist — that's intentional (don't run twice).
-- ============================================================================

-- ── 0. Extensions ───────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 1. Enums ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.file_type AS ENUM ('psd', 'ai', 'jpg', 'png');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_status AS ENUM ('pending', 'processing', 'tagged', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.queue_status AS ENUM ('pending', 'claimed', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_type AS ENUM ('art_piece', 'product', 'packaging', 'tech_pack', 'photography');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.art_source AS ENUM ('freelancer', 'straight_style_guide', 'style_guide_composition');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.workflow_status AS ENUM (
    'product_ideas', 'concept_approved', 'in_development', 'freelancer_art',
    'discontinued', 'in_process', 'customer_adopted', 'licensor_approved', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Tables ───────────────────────────────────────────────────────────────

-- 2.1 admin_config
CREATE TABLE public.admin_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

-- 2.2 licensors
CREATE TABLE public.licensors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  external_id text UNIQUE NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2.3 properties
CREATE TABLE public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licensor_id uuid NOT NULL REFERENCES public.licensors(id) ON DELETE CASCADE,
  name text NOT NULL,
  external_id text UNIQUE NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2.4 characters
CREATE TABLE public.characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  external_id text UNIQUE NULL,
  usage_count integer NOT NULL DEFAULT 0,
  is_priority boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2.5 product_categories
CREATE TABLE public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  external_id text UNIQUE NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.6 product_types
CREATE TABLE public.product_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.product_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  external_id text UNIQUE NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.7 product_subtypes
CREATE TABLE public.product_subtypes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id uuid NOT NULL REFERENCES public.product_types(id) ON DELETE CASCADE,
  name text NOT NULL,
  external_id text UNIQUE NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.8 style_groups
CREATE TABLE public.style_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  folder_path text NOT NULL,
  primary_asset_id uuid NULL,  -- FK added after assets table
  primary_asset_type text NULL,
  primary_thumbnail_url text NULL,
  primary_thumbnail_error text NULL,
  asset_count integer NULL DEFAULT 0,
  latest_file_date timestamptz NULL,
  workflow_status workflow_status NULL DEFAULT 'other',
  is_licensed boolean NULL DEFAULT false,
  licensor_id uuid NULL REFERENCES public.licensors(id) ON DELETE SET NULL,
  licensor_code text NULL,
  licensor_name text NULL,
  property_id uuid NULL REFERENCES public.properties(id) ON DELETE SET NULL,
  property_code text NULL,
  property_name text NULL,
  product_category text NULL,
  division_code text NULL,
  division_name text NULL,
  mg01_code text NULL,
  mg01_name text NULL,
  mg02_code text NULL,
  mg02_name text NULL,
  mg03_code text NULL,
  mg03_name text NULL,
  size_code text NULL,
  size_name text NULL,
  designer_name text NULL,
  technical_designer_name text NULL,
  freelancer_name text NULL,
  designer_conflict boolean NOT NULL DEFAULT false,
  cover_description text NULL,
  created_at timestamptz NULL DEFAULT now(),
  updated_at timestamptz NULL DEFAULT now()
);

-- 2.9 assets
CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  relative_path text NOT NULL UNIQUE,
  file_type file_type NOT NULL,
  file_size bigint NULL DEFAULT 0,
  width integer NULL DEFAULT 0,
  height integer NULL DEFAULT 0,
  artboards integer NULL DEFAULT 1,
  thumbnail_url text NULL,
  thumbnail_error text NULL,
  is_licensed boolean NULL DEFAULT false,
  licensor_id uuid NULL REFERENCES public.licensors(id) ON DELETE SET NULL,
  licensor_code text NULL,
  licensor_name text NULL,
  property_id uuid NULL REFERENCES public.properties(id) ON DELETE SET NULL,
  property_code text NULL,
  property_name text NULL,
  product_subtype_id uuid NULL REFERENCES public.product_subtypes(id) ON DELETE SET NULL,
  product_category text NULL,
  asset_type asset_type NULL,
  art_source art_source NULL,
  big_theme text NULL,
  little_theme text NULL,
  design_ref text NULL,
  design_style text NULL,
  ai_description text NULL,
  scene_description text NULL,
  cover_description text NULL,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  workflow_status workflow_status NULL DEFAULT 'other',
  status asset_status NULL DEFAULT 'pending',
  is_deleted boolean NULL DEFAULT false,
  quick_hash text NOT NULL,
  quick_hash_version integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  modified_at timestamptz NOT NULL,  -- NO DEFAULT — agent must supply
  file_created_at timestamptz NULL,
  ingested_at timestamptz NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_scanned_at timestamptz NULL,
  ai_tagged_at timestamptz NULL,
  primary_sort_tier smallint NOT NULL DEFAULT 7,
  sku text NULL,
  sku_sequence text NULL,
  style_group_id uuid NULL REFERENCES public.style_groups(id) ON DELETE SET NULL,
  designer_name text NULL,
  technical_designer_name text NULL,
  freelancer_name text NULL,
  division_code text NULL,
  division_name text NULL,
  mg01_code text NULL,
  mg01_name text NULL,
  mg02_code text NULL,
  mg02_name text NULL,
  mg03_code text NULL,
  mg03_name text NULL,
  size_code text NULL,
  size_name text NULL
);

-- Add deferred FK from style_groups.primary_asset_id → assets
ALTER TABLE public.style_groups
  ADD CONSTRAINT style_groups_primary_asset_id_fkey
  FOREIGN KEY (primary_asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;

-- 2.10 asset_tags
CREATE TABLE public.asset_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  tag text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, tag)
);

-- 2.11 asset_characters
CREATE TABLE public.asset_characters (
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, character_id)
);

-- 2.12 asset_path_history
CREATE TABLE public.asset_path_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  old_relative_path text NOT NULL,
  new_relative_path text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now()
);

-- 2.13 processing_queue
CREATE TABLE public.processing_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status queue_status NULL DEFAULT 'pending',
  agent_id text NULL,
  claimed_at timestamptz NULL,
  completed_at timestamptz NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.14 render_queue
CREATE TABLE public.render_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  status queue_status NULL DEFAULT 'pending',
  claimed_by text NULL,
  claimed_at timestamptz NULL,
  completed_at timestamptz NULL,
  error_message text NULL,
  attempts integer NOT NULL DEFAULT 0,
  lease_expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.15 profiles
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  email text NULL,
  full_name text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2.16 user_roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- 2.17 invitations
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  role app_role NULL DEFAULT 'user',
  invited_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz NULL
);

-- 2.18 agent_registrations
CREATE TABLE public.agent_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL,
  agent_key_hash text NOT NULL UNIQUE,
  agent_type text NOT NULL DEFAULT 'bridge',
  last_heartbeat timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.19 agent_pairings
CREATE TABLE public.agent_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pairing_code text NOT NULL UNIQUE,
  agent_type text NOT NULL,
  agent_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES auth.users(id),
  consumed_at timestamptz NULL,
  agent_registration_id uuid NULL REFERENCES public.agent_registrations(id) ON DELETE CASCADE,
  consumed_by_agent_id uuid NULL
);

-- 2.20 hygiene_findings
CREATE TABLE public.hygiene_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  check_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  status text NOT NULL DEFAULT 'open',
  filename text NOT NULL,
  relative_path text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  found_at timestamptz NOT NULL DEFAULT now(),
  found_by_agent text NULL,
  scan_session_id text NULL,
  review_notes text NULL,
  reviewed_at timestamptz NULL,
  reviewed_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.21 tiff_optimization_queue
CREATE TABLE public.tiff_optimization_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  relative_path text NOT NULL UNIQUE,
  file_size bigint NOT NULL,
  file_modified_at timestamptz NOT NULL,
  file_created_at timestamptz NULL,
  status text NOT NULL DEFAULT 'scanned',
  mode text NULL,
  compression_type text NULL,
  claimed_by text NULL,
  claimed_at timestamptz NULL,
  processed_at timestamptz NULL,
  error_message text NULL,
  new_filename text NULL,
  new_file_size bigint NULL,
  new_file_modified_at timestamptz NULL,
  new_file_created_at timestamptz NULL,
  original_backed_up boolean NULL DEFAULT false,
  original_deleted boolean NULL DEFAULT false,
  scan_session_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.22 erp_sync_runs
CREATE TABLE public.erp_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  total_fetched integer NULL DEFAULT 0,
  total_upserted integer NULL DEFAULT 0,
  total_errors integer NULL DEFAULT 0,
  error_samples jsonb NULL DEFAULT '[]'::jsonb,
  run_metadata jsonb NULL DEFAULT '{}'::jsonb,
  created_by text NULL
);

-- 2.23 erp_items_current
CREATE TABLE public.erp_items_current (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  style_number text NULL,
  item_description text NULL,
  licensor_code text NULL,
  property_code text NULL,
  division_code text NULL,
  mg_category text NULL,
  mg01_code text NULL,
  mg02_code text NULL,
  mg03_code text NULL,
  mg04_code text NULL,
  mg05_code text NULL,
  mg06_code text NULL,
  size_code text NULL,
  raw_mg_fields jsonb NULL DEFAULT '{}'::jsonb,
  source_system text NOT NULL DEFAULT 'designflow',
  dismissed boolean NOT NULL DEFAULT false,
  erp_updated_at timestamptz NULL,
  sync_run_id uuid NULL REFERENCES public.erp_sync_runs(id) ON DELETE SET NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2.24 erp_items_raw
CREATE TABLE public.erp_items_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  sync_run_id uuid NULL REFERENCES public.erp_sync_runs(id) ON DELETE SET NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- 2.25 erp_enrichment_log
CREATE TABLE public.erp_enrichment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL,
  target_type text NOT NULL,
  field_name text NOT NULL,
  old_value text NULL,
  new_value text NULL,
  source text NOT NULL,
  confidence real NULL,
  run_id uuid NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- 2.26 product_category_predictions
CREATE TABLE public.product_category_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  erp_item_id uuid NULL REFERENCES public.erp_items_current(id) ON DELETE CASCADE,
  predicted_category text NOT NULL,
  confidence real NOT NULL,
  rationale text NULL,
  classification_source text NOT NULL DEFAULT 'ai',
  ai_model text NULL,
  ai_prompt_version text NULL,
  input_context jsonb NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewed_at timestamptz NULL,
  reviewed_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- ── 3. Indexes ──────────────────────────────────────────────────────────────

-- agent_pairings
CREATE INDEX idx_agent_pairings_code ON public.agent_pairings (pairing_code) WHERE status = 'pending';

-- agent_registrations
CREATE INDEX idx_agent_registrations_last_heartbeat ON public.agent_registrations (last_heartbeat);

-- asset_tags
CREATE INDEX idx_asset_tags_asset_id ON public.asset_tags (asset_id);
CREATE INDEX idx_asset_tags_source ON public.asset_tags (source);

-- assets
CREATE INDEX idx_assets_file_type ON public.assets (file_type);
CREATE INDEX idx_assets_status ON public.assets (status);
CREATE INDEX idx_assets_workflow_status ON public.assets (workflow_status);
CREATE INDEX idx_assets_is_licensed ON public.assets (is_licensed);
CREATE INDEX idx_assets_is_deleted ON public.assets (is_deleted);
CREATE INDEX idx_assets_modified_at ON public.assets (modified_at);
CREATE INDEX idx_assets_file_created_at ON public.assets (file_created_at);
CREATE INDEX idx_assets_licensor_id ON public.assets (licensor_id);
CREATE INDEX idx_assets_property_id ON public.assets (property_id);
CREATE INDEX idx_assets_product_subtype_id ON public.assets (product_subtype_id);
CREATE INDEX idx_assets_quick_hash ON public.assets (quick_hash);
CREATE INDEX idx_assets_style_group_id ON public.assets (style_group_id);
CREATE INDEX idx_assets_tags ON public.assets USING gin (tags);
CREATE INDEX idx_assets_filename_trgm ON public.assets USING gin (filename gin_trgm_ops);
CREATE INDEX idx_assets_relative_path_trgm ON public.assets USING gin (relative_path gin_trgm_ops);
CREATE INDEX idx_assets_ai_tagged_at ON public.assets (ai_tagged_at) WHERE ai_tagged_at IS NOT NULL;
CREATE INDEX idx_assets_clear_style_cursor ON public.assets (id) WHERE is_deleted = false AND style_group_id IS NOT NULL;
CREATE INDEX idx_assets_primary_sort_tier ON public.assets (style_group_id, primary_sort_tier, created_at) WHERE is_deleted = false;

-- characters
CREATE INDEX idx_characters_is_priority ON public.characters (is_priority) WHERE is_priority = true;
CREATE INDEX idx_characters_usage_count ON public.characters (usage_count);

-- erp_enrichment_log
CREATE INDEX idx_eel_run_id ON public.erp_enrichment_log (run_id);
CREATE INDEX idx_eel_target_id ON public.erp_enrichment_log (target_id);

-- erp_items_current
CREATE INDEX idx_erp_items_current_style_number ON public.erp_items_current (style_number);
CREATE INDEX idx_erp_items_current_synced_at ON public.erp_items_current (synced_at);
CREATE INDEX idx_erp_items_current_mg_category ON public.erp_items_current (mg_category);
CREATE INDEX idx_erp_items_current_dismissed ON public.erp_items_current (dismissed) WHERE dismissed = true;

-- erp_items_raw
CREATE INDEX idx_erp_items_raw_external_id ON public.erp_items_raw (external_id);
CREATE INDEX idx_erp_items_raw_sync_run_id ON public.erp_items_raw (sync_run_id);

-- hygiene_findings
CREATE INDEX idx_hygiene_findings_asset_id ON public.hygiene_findings (asset_id);
CREATE INDEX idx_hygiene_findings_check_type ON public.hygiene_findings (check_type);
CREATE INDEX idx_hygiene_findings_status ON public.hygiene_findings (status);
CREATE INDEX idx_hygiene_findings_relative_path ON public.hygiene_findings (relative_path);
CREATE UNIQUE INDEX uq_hygiene_findings_path_check ON public.hygiene_findings (relative_path, check_type) WHERE status <> 'resolved';

-- processing_queue
CREATE INDEX idx_processing_queue_status ON public.processing_queue (status);

-- product_category_predictions
CREATE INDEX idx_pcp_erp_item_id ON public.product_category_predictions (erp_item_id);
CREATE INDEX idx_pcp_status ON public.product_category_predictions (status);

-- render_queue
CREATE INDEX idx_render_queue_status ON public.render_queue (status);
CREATE UNIQUE INDEX uq_render_queue_asset_active ON public.render_queue (asset_id) WHERE status IN ('pending', 'claimed');

-- style_groups
CREATE INDEX idx_style_groups_sku ON public.style_groups (sku);
CREATE INDEX idx_style_groups_licensor_id ON public.style_groups (licensor_id);
CREATE INDEX idx_style_groups_property_id ON public.style_groups (property_id);
CREATE INDEX idx_style_groups_latest_file_date ON public.style_groups (latest_file_date);

-- tiff_optimization_queue
CREATE INDEX idx_tiff_opt_status ON public.tiff_optimization_queue (status);
CREATE INDEX idx_tiff_opt_compression ON public.tiff_optimization_queue (compression_type);


-- ── 4. Functions ────────────────────────────────────────────────────────────

-- 4.1 has_role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 4.2 handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
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
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, _email, COALESCE(NEW.raw_user_meta_data->>'full_name', _email));
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _invitation.role);
  UPDATE public.invitations SET accepted_at = now() WHERE id = _invitation.id;
  RETURN NEW;
END;
$$;

-- 4.3 update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 4.4 compute_primary_sort_tier
CREATE OR REPLACE FUNCTION public.compute_primary_sort_tier()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  fn text := lower(NEW.filename);
  has_thumb boolean := (NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_error IS NULL);
  is_mockup boolean := (fn LIKE '%mockup%' OR fn LIKE '%mock up%');
  is_art boolean := (fn LIKE '%art%');
  is_pkg boolean := (fn LIKE '%packaging%');
BEGIN
  IF is_mockup AND has_thumb THEN NEW.primary_sort_tier := 1;
  ELSIF is_art AND has_thumb THEN NEW.primary_sort_tier := 2;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_pkg AND has_thumb THEN NEW.primary_sort_tier := 3;
  ELSIF is_pkg AND has_thumb THEN NEW.primary_sort_tier := 4;
  ELSIF is_mockup THEN NEW.primary_sort_tier := 5;
  ELSIF is_art THEN NEW.primary_sort_tier := 6;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_pkg THEN NEW.primary_sort_tier := 7;
  ELSE NEW.primary_sort_tier := 8;
  END IF;
  RETURN NEW;
END;
$$;

-- 4.5 auto_queue_render
CREATE OR REPLACE FUNCTION public.auto_queue_render()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.filename LIKE '._%' OR NEW.filename = '.DS_Store' OR NEW.filename = '.localized'
     OR NEW.filename = 'Thumbs.db' OR NEW.filename = 'desktop.ini' OR NEW.filename LIKE '~%' THEN
    RETURN NEW;
  END IF;
  IF NEW.thumbnail_error IS NOT NULL AND NEW.thumbnail_url IS NULL THEN
    INSERT INTO public.render_queue (asset_id, status) VALUES (NEW.id, 'pending')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- 4.6 sync_asset_tags_to_array
CREATE OR REPLACE FUNCTION public.sync_asset_tags_to_array()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_asset_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_asset_id := OLD.asset_id;
  ELSE v_asset_id := NEW.asset_id;
  END IF;
  UPDATE public.assets
  SET tags = COALESCE(
    (SELECT array_agg(at.tag ORDER BY at.tag) FROM public.asset_tags at WHERE at.asset_id = v_asset_id),
    '{}'::text[]
  )
  WHERE id = v_asset_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- 4.7 sync_primary_asset_on_thumbnail
CREATE OR REPLACE FUNCTION public.sync_primary_asset_on_thumbnail()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.style_group_id IS NOT NULL THEN
    IF NEW.thumbnail_url IS NOT NULL AND (OLD.thumbnail_url IS NULL) THEN
      UPDATE public.style_groups sg
      SET primary_asset_id = NEW.id,
          primary_asset_type = NEW.asset_type::text,
          primary_thumbnail_url = NEW.thumbnail_url,
          primary_thumbnail_error = NEW.thumbnail_error,
          updated_at = now()
      WHERE sg.id = NEW.style_group_id
        AND (sg.primary_asset_id IS NULL
             OR NOT EXISTS (
               SELECT 1 FROM public.assets a
               WHERE a.id = sg.primary_asset_id AND a.thumbnail_url IS NOT NULL AND a.is_deleted = false
             ));
    END IF;
    UPDATE public.style_groups sg
    SET primary_thumbnail_url = NEW.thumbnail_url,
        primary_thumbnail_error = NEW.thumbnail_error,
        updated_at = now()
    WHERE sg.id = NEW.style_group_id
      AND sg.primary_asset_id = NEW.id
      AND (sg.primary_thumbnail_url IS DISTINCT FROM NEW.thumbnail_url
           OR sg.primary_thumbnail_error IS DISTINCT FROM NEW.thumbnail_error);
  END IF;
  RETURN NEW;
END;
$$;

-- 4.8 sync_designer_to_style_group
CREATE OR REPLACE FUNCTION public.sync_designer_to_style_group()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_group_id uuid;
  v_conflict boolean := false;
  v_designer text;
  v_tech_designer text;
  v_freelancer text;
  v_designers text[];
  v_tech_designers text[];
  v_freelancers text[];
BEGIN
  v_group_id := NEW.style_group_id;
  IF v_group_id IS NULL THEN RETURN NEW; END IF;
  SELECT
    array_agg(DISTINCT a.designer_name) FILTER (WHERE a.designer_name IS NOT NULL),
    array_agg(DISTINCT a.technical_designer_name) FILTER (WHERE a.technical_designer_name IS NOT NULL),
    array_agg(DISTINCT a.freelancer_name) FILTER (WHERE a.freelancer_name IS NOT NULL)
  INTO v_designers, v_tech_designers, v_freelancers
  FROM public.assets a
  WHERE a.style_group_id = v_group_id AND a.is_deleted = false;
  v_designer := v_designers[1];
  v_tech_designer := v_tech_designers[1];
  v_freelancer := v_freelancers[1];
  IF array_length(v_designers, 1) > 1 OR array_length(v_tech_designers, 1) > 1 OR array_length(v_freelancers, 1) > 1 THEN
    v_conflict := true;
  END IF;
  UPDATE public.style_groups
  SET designer_name = v_designer, technical_designer_name = v_tech_designer,
      freelancer_name = v_freelancer, designer_conflict = v_conflict, updated_at = now()
  WHERE id = v_group_id;
  RETURN NEW;
END;
$$;

-- 4.9 sync_cover_description_to_style_group
CREATE OR REPLACE FUNCTION public.sync_cover_description_to_style_group()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_group_id uuid;
  v_desc text;
BEGIN
  v_group_id := NEW.style_group_id;
  IF v_group_id IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(
    (SELECT a.cover_description FROM public.assets a
     JOIN public.style_groups sg ON sg.primary_asset_id = a.id
     WHERE sg.id = v_group_id AND a.cover_description IS NOT NULL),
    (SELECT a.cover_description FROM public.assets a
     WHERE a.style_group_id = v_group_id AND a.is_deleted = false AND a.cover_description IS NOT NULL
     LIMIT 1)
  ) INTO v_desc;
  UPDATE public.style_groups
  SET cover_description = v_desc, updated_at = now()
  WHERE id = v_group_id AND (cover_description IS DISTINCT FROM v_desc);
  RETURN NEW;
END;
$$;

-- 4.10 claim_jobs
CREATE OR REPLACE FUNCTION public.claim_jobs(p_agent_id text, p_batch_size integer DEFAULT 5)
RETURNS SETOF processing_queue
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
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

-- 4.11 reset_stale_jobs
CREATE OR REPLACE FUNCTION public.reset_stale_jobs(p_timeout_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE affected int;
BEGIN
  UPDATE public.processing_queue
  SET status = 'pending', agent_id = NULL, claimed_at = NULL
  WHERE status IN ('claimed', 'processing')
    AND claimed_at < now() - (p_timeout_minutes || ' minutes')::interval;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- 4.12 claim_render_jobs
CREATE OR REPLACE FUNCTION public.claim_render_jobs(
  p_agent_id text, p_batch_size integer DEFAULT 1,
  p_lease_minutes integer DEFAULT 5, p_max_attempts integer DEFAULT 5
)
RETURNS TABLE(id uuid, asset_id uuid, attempts integer, lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT rq.id FROM render_queue rq
    WHERE (rq.status = 'pending' OR (rq.status = 'claimed' AND rq.lease_expires_at IS NOT NULL AND rq.lease_expires_at < now()))
      AND rq.attempts < p_max_attempts
    ORDER BY rq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE render_queue rq
  SET status = 'claimed', claimed_by = p_agent_id, claimed_at = now(),
      lease_expires_at = now() + (p_lease_minutes || ' minutes')::interval,
      attempts = rq.attempts + 1
  FROM claimable WHERE rq.id = claimable.id
  RETURNING rq.id, rq.asset_id, rq.attempts, rq.lease_expires_at;
END;
$$;

-- 4.13 claim_tiff_jobs
CREATE OR REPLACE FUNCTION public.claim_tiff_jobs(
  p_agent_id text, p_batch_size integer DEFAULT 1, p_lease_minutes integer DEFAULT 10
)
RETURNS TABLE(id uuid, relative_path text, filename text, file_size bigint, file_modified_at timestamptz, file_created_at timestamptz, mode text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT tq.id FROM tiff_optimization_queue tq
    WHERE tq.status IN ('queued_test', 'queued_process')
    ORDER BY tq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE tiff_optimization_queue tq
  SET status = 'processing', claimed_by = p_agent_id, claimed_at = now()
  FROM claimable WHERE tq.id = claimable.id
  RETURNING tq.id, tq.relative_path, tq.filename, tq.file_size, tq.file_modified_at, tq.file_created_at,
    CASE WHEN tq.status = 'queued_test' THEN 'test' ELSE 'process' END AS mode;
END;
$$;

-- 4.14 execute_readonly_query
CREATE OR REPLACE FUNCTION public.execute_readonly_query(query_text text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT (lower(trim(query_text)) ~ '^select\s') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;
  IF lower(query_text) ~ '\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute)\b' THEN
    RAISE EXCEPTION 'Query contains forbidden keywords';
  END IF;
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text) INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- 4.15 get_filter_counts
CREATE OR REPLACE FUNCTION public.get_filter_counts(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_min_date timestamptz;
  v_search text;
  v_file_types text[];
  v_statuses text[];
  v_workflow_statuses text[];
  v_is_licensed boolean;
  v_licensor_id uuid;
  v_property_id uuid;
  v_asset_types text[];
  v_art_sources text[];
  v_tag_filter text;
  v_result jsonb := '{}'::jsonb;
BEGIN
  SELECT (value #>> '{}')::timestamptz INTO v_min_date FROM admin_config WHERE key = 'THUMBNAIL_MIN_DATE';
  IF v_min_date IS NULL THEN v_min_date := '2020-01-01'::timestamptz; END IF;
  v_search := p_filters ->> 'search';
  v_is_licensed := (p_filters ->> 'isLicensed')::boolean;
  v_licensor_id := (p_filters ->> 'licensorId')::uuid;
  v_property_id := (p_filters ->> 'propertyId')::uuid;
  v_tag_filter := p_filters ->> 'tagFilter';
  IF p_filters ? 'fileType' AND jsonb_array_length(p_filters -> 'fileType') > 0 THEN
    SELECT array_agg(x::text) INTO v_file_types FROM jsonb_array_elements_text(p_filters -> 'fileType') x;
  END IF;
  IF p_filters ? 'status' AND jsonb_array_length(p_filters -> 'status') > 0 THEN
    SELECT array_agg(x::text) INTO v_statuses FROM jsonb_array_elements_text(p_filters -> 'status') x;
  END IF;
  IF p_filters ? 'workflowStatus' AND jsonb_array_length(p_filters -> 'workflowStatus') > 0 THEN
    SELECT array_agg(x::text) INTO v_workflow_statuses FROM jsonb_array_elements_text(p_filters -> 'workflowStatus') x;
  END IF;
  IF p_filters ? 'assetType' AND jsonb_array_length(p_filters -> 'assetType') > 0 THEN
    SELECT array_agg(x::text) INTO v_asset_types FROM jsonb_array_elements_text(p_filters -> 'assetType') x;
  END IF;
  IF p_filters ? 'artSource' AND jsonb_array_length(p_filters -> 'artSource') > 0 THEN
    SELECT array_agg(x::text) INTO v_art_sources FROM jsonb_array_elements_text(p_filters -> 'artSource') x;
  END IF;

  v_result := v_result || jsonb_build_object('fileType', COALESCE((
    SELECT jsonb_object_agg(file_type::text, cnt) FROM (
      SELECT file_type, count(*) as cnt FROM assets
      WHERE is_deleted = false
        AND (modified_at >= v_min_date OR file_created_at >= v_min_date OR thumbnail_url IS NOT NULL)
        AND (v_search IS NULL OR filename ILIKE '%' || v_search || '%')
        AND (v_statuses IS NULL OR status::text = ANY(v_statuses))
        AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
        AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        AND (v_licensor_id IS NULL OR licensor_id = v_licensor_id)
        AND (v_property_id IS NULL OR property_id = v_property_id)
        AND (v_asset_types IS NULL OR asset_type::text = ANY(v_asset_types))
        AND (v_art_sources IS NULL OR art_source::text = ANY(v_art_sources))
        AND (v_tag_filter IS NULL OR v_tag_filter = ANY(tags))
      GROUP BY file_type
    ) sub
  ), '{}'::jsonb));

  v_result := v_result || jsonb_build_object('status', COALESCE((
    SELECT jsonb_object_agg(status::text, cnt) FROM (
      SELECT status, count(*) as cnt FROM assets
      WHERE is_deleted = false
        AND (modified_at >= v_min_date OR file_created_at >= v_min_date OR thumbnail_url IS NOT NULL)
        AND (v_search IS NULL OR filename ILIKE '%' || v_search || '%')
        AND (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
        AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
        AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        AND (v_licensor_id IS NULL OR licensor_id = v_licensor_id)
        AND (v_property_id IS NULL OR property_id = v_property_id)
        AND (v_asset_types IS NULL OR asset_type::text = ANY(v_asset_types))
        AND (v_art_sources IS NULL OR art_source::text = ANY(v_art_sources))
        AND (v_tag_filter IS NULL OR v_tag_filter = ANY(tags))
      GROUP BY status
    ) sub
  ), '{}'::jsonb));

  v_result := v_result || jsonb_build_object('workflowStatus', COALESCE((
    SELECT jsonb_object_agg(ws, cnt) FROM (
      SELECT workflow_status as ws, count(*) as cnt FROM assets
      WHERE is_deleted = false AND workflow_status IS NOT NULL
        AND (modified_at >= v_min_date OR file_created_at >= v_min_date OR thumbnail_url IS NOT NULL)
        AND (v_search IS NULL OR filename ILIKE '%' || v_search || '%')
        AND (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
        AND (v_statuses IS NULL OR status::text = ANY(v_statuses))
        AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        AND (v_licensor_id IS NULL OR licensor_id = v_licensor_id)
        AND (v_property_id IS NULL OR property_id = v_property_id)
        AND (v_asset_types IS NULL OR asset_type::text = ANY(v_asset_types))
        AND (v_art_sources IS NULL OR art_source::text = ANY(v_art_sources))
        AND (v_tag_filter IS NULL OR v_tag_filter = ANY(tags))
      GROUP BY workflow_status
    ) sub
  ), '{}'::jsonb));

  v_result := v_result || jsonb_build_object('isLicensed', (
    SELECT jsonb_build_object(
      'true', coalesce(sum(CASE WHEN is_licensed = true THEN 1 ELSE 0 END), 0),
      'false', coalesce(sum(CASE WHEN is_licensed = false OR is_licensed IS NULL THEN 1 ELSE 0 END), 0)
    ) FROM assets
    WHERE is_deleted = false
      AND (modified_at >= v_min_date OR file_created_at >= v_min_date OR thumbnail_url IS NOT NULL)
      AND (v_search IS NULL OR filename ILIKE '%' || v_search || '%')
      AND (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
      AND (v_statuses IS NULL OR status::text = ANY(v_statuses))
      AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
      AND (v_licensor_id IS NULL OR licensor_id = v_licensor_id)
      AND (v_property_id IS NULL OR property_id = v_property_id)
      AND (v_asset_types IS NULL OR asset_type::text = ANY(v_asset_types))
      AND (v_art_sources IS NULL OR art_source::text = ANY(v_art_sources))
      AND (v_tag_filter IS NULL OR v_tag_filter = ANY(tags))
  ));

  RETURN v_result;
END;
$$;

-- 4.16 refresh_style_group_counts
CREATE OR REPLACE FUNCTION public.refresh_style_group_counts()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $$
  UPDATE public.style_groups sg
  SET asset_count = COALESCE(agg.asset_count, 0),
      latest_file_date = agg.latest_file_date,
      updated_at = now()
  FROM (
    SELECT a.style_group_id, COUNT(*)::integer AS asset_count, MAX(a.modified_at) AS latest_file_date
    FROM public.assets a
    WHERE a.is_deleted = false AND a.style_group_id IS NOT NULL
    GROUP BY a.style_group_id
  ) agg
  WHERE sg.id = agg.style_group_id;
$$;

-- 4.17 refresh_style_group_counts_batch
CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_batch(p_group_ids uuid[])
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $$
  WITH agg AS (
    SELECT a.style_group_id, COUNT(*)::integer AS asset_count, MAX(a.modified_at) AS latest_file_date
    FROM public.assets a
    WHERE a.is_deleted = false AND a.style_group_id = ANY(p_group_ids)
    GROUP BY a.style_group_id
  ),
  upd AS (
    UPDATE public.style_groups sg
    SET asset_count = COALESCE(agg.asset_count, 0), latest_file_date = agg.latest_file_date, updated_at = now()
    FROM agg WHERE sg.id = agg.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;

-- 4.18 refresh_style_group_primaries
CREATE OR REPLACE FUNCTION public.refresh_style_group_primaries(p_group_ids uuid[])
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $$
  WITH picked AS (
    SELECT DISTINCT ON (sg.id)
      sg.id AS style_group_id, a.id AS primary_asset_id,
      a.asset_type::text AS primary_asset_type,
      a.thumbnail_url AS primary_thumbnail_url,
      a.thumbnail_error AS primary_thumbnail_error
    FROM public.style_groups sg
    LEFT JOIN public.assets a ON a.style_group_id = sg.id AND a.is_deleted = false
    WHERE sg.id = ANY(p_group_ids)
    ORDER BY sg.id, a.primary_sort_tier ASC, a.created_at ASC
  ),
  upd AS (
    UPDATE public.style_groups sg SET
      primary_asset_id = picked.primary_asset_id,
      primary_asset_type = picked.primary_asset_type,
      primary_thumbnail_url = picked.primary_thumbnail_url,
      primary_thumbnail_error = picked.primary_thumbnail_error,
      updated_at = now()
    FROM picked WHERE sg.id = picked.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;

-- 4.19 clear_style_group_batch
CREATE OR REPLACE FUNCTION public.clear_style_group_batch(p_last_id uuid DEFAULT NULL, p_batch_size integer DEFAULT 200)
RETURNS TABLE(cleared_count integer, last_id uuid, has_more boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_start_id uuid := COALESCE(p_last_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_cleared integer;
  v_last uuid;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN p_batch_size := 1; END IF;
  WITH batch AS (
    SELECT a.id FROM public.assets a
    WHERE a.is_deleted = false AND a.style_group_id IS NOT NULL AND a.id > v_start_id
    ORDER BY a.id ASC LIMIT p_batch_size
  ),
  upd AS (
    UPDATE public.assets a SET style_group_id = NULL FROM batch b WHERE a.id = b.id RETURNING a.id
  )
  SELECT COUNT(*)::integer, (SELECT u.id FROM upd u ORDER BY u.id DESC LIMIT 1)
  INTO v_cleared, v_last FROM upd;
  RETURN QUERY SELECT COALESCE(v_cleared, 0), v_last, COALESCE(v_cleared, 0) = p_batch_size;
END;
$$;

-- 4.20 bulk_assign_style_groups
CREATE OR REPLACE FUNCTION public.bulk_assign_style_groups(p_assignments jsonb)
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH rows AS (
    SELECT (x->>'asset_id')::uuid AS asset_id, (x->>'style_group_id')::uuid AS style_group_id
    FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::jsonb)) AS x
  ),
  upd AS (
    UPDATE public.assets a SET style_group_id = r.style_group_id
    FROM rows r WHERE a.id = r.asset_id AND a.is_deleted = false
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;

-- 4.21 rebuild_style_groups_batch
CREATE OR REPLACE FUNCTION public.rebuild_style_groups_batch(p_last_asset_id uuid DEFAULT NULL, p_batch_size integer DEFAULT 500)
RETURNS TABLE(next_cursor uuid, groups_created integer, assets_assigned integer, assets_ungrouped integer, done boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_last_id uuid;
  v_groups_created int := 0;
  v_assets_assigned int := 0;
  v_ungrouped int := 0;
  v_fetched int := 0;
  v_done boolean;
BEGIN
  WITH asset_batch AS (
    SELECT a.id, a.relative_path, a.filename, a.file_type,
           a.is_licensed, a.licensor_id, a.licensor_code, a.licensor_name,
           a.property_id, a.property_code, a.property_name,
           a.product_category, a.division_code, a.division_name,
           a.mg01_code, a.mg01_name, a.mg02_code, a.mg02_name,
           a.mg03_code, a.mg03_name, a.size_code, a.size_name
    FROM assets a
    WHERE a.is_deleted = false AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
    ORDER BY a.id LIMIT p_batch_size
  ),
  asset_skus AS (
    SELECT ab.*,
      (SELECT seg FROM unnest(string_to_array(ab.relative_path, '/')) WITH ORDINALITY AS t(seg, ord)
       WHERE seg ~ '^[A-Za-z]{1,6}[0-9]' AND length(seg) >= 10
         AND ord < array_length(string_to_array(ab.relative_path, '/'), 1)
       ORDER BY ord LIMIT 1) AS sku
    FROM asset_batch ab
  ),
  batch_stats AS (
    SELECT count(*)::int AS total_fetched,
           (SELECT s.id FROM asset_skus s ORDER BY s.id DESC LIMIT 1) AS last_id
    FROM asset_skus
  ),
  grouped_assets AS (SELECT * FROM asset_skus WHERE sku IS NOT NULL),
  sku_representatives AS (
    SELECT DISTINCT ON (sku) sku, relative_path, is_licensed, licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    FROM grouped_assets ORDER BY sku, id
  ),
  sku_with_folder AS (
    SELECT sr.*,
      (SELECT string_agg(seg, '/' ORDER BY ord)
       FROM unnest(string_to_array(sr.relative_path, '/')) WITH ORDINALITY AS t(seg, ord)
       WHERE ord <= (SELECT min(t2.ord) FROM unnest(string_to_array(sr.relative_path, '/')) WITH ORDINALITY AS t2(seg, ord) WHERE t2.seg = sr.sku)
      ) AS folder_path
    FROM sku_representatives sr
  ),
  upserted_groups AS (
    INSERT INTO style_groups (sku, folder_path, is_licensed, licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category, division_code, division_name,
      mg01_code, mg01_name, mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name)
    SELECT sku, COALESCE(folder_path, sku), COALESCE(is_licensed, false), licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category, division_code, division_name,
      mg01_code, mg01_name, mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    FROM sku_with_folder
    ON CONFLICT (sku) DO UPDATE SET
      folder_path = COALESCE(EXCLUDED.folder_path, style_groups.folder_path),
      is_licensed = COALESCE(EXCLUDED.is_licensed, style_groups.is_licensed),
      licensor_id = COALESCE(EXCLUDED.licensor_id, style_groups.licensor_id),
      licensor_code = COALESCE(EXCLUDED.licensor_code, style_groups.licensor_code),
      licensor_name = COALESCE(EXCLUDED.licensor_name, style_groups.licensor_name),
      property_id = COALESCE(EXCLUDED.property_id, style_groups.property_id),
      property_code = COALESCE(EXCLUDED.property_code, style_groups.property_code),
      property_name = COALESCE(EXCLUDED.property_name, style_groups.property_name),
      product_category = COALESCE(EXCLUDED.product_category, style_groups.product_category),
      division_code = COALESCE(EXCLUDED.division_code, style_groups.division_code),
      division_name = COALESCE(EXCLUDED.division_name, style_groups.division_name),
      mg01_code = COALESCE(EXCLUDED.mg01_code, style_groups.mg01_code),
      mg01_name = COALESCE(EXCLUDED.mg01_name, style_groups.mg01_name),
      mg02_code = COALESCE(EXCLUDED.mg02_code, style_groups.mg02_code),
      mg02_name = COALESCE(EXCLUDED.mg02_name, style_groups.mg02_name),
      mg03_code = COALESCE(EXCLUDED.mg03_code, style_groups.mg03_code),
      mg03_name = COALESCE(EXCLUDED.mg03_name, style_groups.mg03_name),
      size_code = COALESCE(EXCLUDED.size_code, style_groups.size_code),
      size_name = COALESCE(EXCLUDED.size_name, style_groups.size_name),
      updated_at = now()
    RETURNING id, sku
  ),
  assigned AS (
    UPDATE assets a SET style_group_id = ug.id
    FROM grouped_assets ga JOIN upserted_groups ug ON ug.sku = ga.sku
    WHERE a.id = ga.id RETURNING 1
  )
  SELECT (SELECT bs.last_id FROM batch_stats bs),
         (SELECT count(*)::int FROM upserted_groups),
         (SELECT count(*)::int FROM assigned),
         (SELECT count(*)::int FROM asset_skus WHERE sku IS NULL),
         (SELECT bs.total_fetched FROM batch_stats bs) < p_batch_size
  INTO v_last_id, v_groups_created, v_assets_assigned, v_ungrouped, v_done;
  RETURN QUERY SELECT v_last_id, v_groups_created, v_assets_assigned, v_ungrouped, COALESCE(v_done, true);
END;
$$;

-- 4.22 propagate_group_tags_batch
CREATE OR REPLACE FUNCTION public.propagate_group_tags_batch(p_cursor uuid DEFAULT NULL, p_batch_size integer DEFAULT 100)
RETURNS TABLE(next_cursor uuid, propagated integer, skipped integer, done boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_next_cursor uuid;
  v_total_propagated int := 0;
  v_group_count int := 0;
  v_batch_propagated int;
  v_file_specific_tags text[] := ARRAY[
    'art_piece','art piece','product','product shot','product photo',
    'packaging','package','tech_pack','tech pack','technical pack',
    'photography','photo','mockup','mock up','mock-up',
    'front view','back view','side view','flat lay','flatlay',
    'render','3d render'
  ];
BEGIN
  FOR v_next_cursor IN
    SELECT sg.id FROM style_groups sg
    WHERE (p_cursor IS NULL OR sg.id > p_cursor)
    ORDER BY sg.id LIMIT p_batch_size
  LOOP
    v_group_count := v_group_count + 1;
    WITH source_asset AS (
      SELECT a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      FROM assets a
      WHERE a.style_group_id = v_next_cursor AND a.is_deleted = false AND a.ai_tagged_at IS NOT NULL
      ORDER BY a.primary_sort_tier ASC, a.ai_tagged_at ASC LIMIT 1
    ),
    source_tags AS (
      SELECT at2.tag FROM asset_tags at2
      JOIN source_asset sa ON sa.id = at2.asset_id
      WHERE at2.source = 'ai' AND lower(trim(at2.tag)) != ALL(v_file_specific_tags)
    ),
    source_chars AS (
      SELECT ac.character_id FROM asset_characters ac JOIN source_asset sa ON sa.id = ac.asset_id
    ),
    siblings AS (
      SELECT a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      FROM assets a CROSS JOIN source_asset sa
      WHERE a.style_group_id = v_next_cursor AND a.is_deleted = false AND a.id != sa.id
    ),
    inserted_tags AS (
      INSERT INTO asset_tags (asset_id, tag, source)
      SELECT s.id, st.tag, 'ai' FROM siblings s CROSS JOIN source_tags st
      ON CONFLICT (asset_id, tag) DO NOTHING RETURNING 1
    ),
    inserted_chars AS (
      INSERT INTO asset_characters (asset_id, character_id)
      SELECT s.id, sc.character_id FROM siblings s CROSS JOIN source_chars sc
      ON CONFLICT (asset_id, character_id) DO NOTHING RETURNING 1
    ),
    meta_updates AS (
      UPDATE assets a SET
        licensor_id = COALESCE(a.licensor_id, sa.licensor_id),
        property_id = COALESCE(a.property_id, sa.property_id),
        is_licensed = CASE WHEN a.is_licensed = true THEN true ELSE COALESCE(sa.is_licensed, a.is_licensed) END,
        big_theme = COALESCE(a.big_theme, sa.big_theme),
        little_theme = COALESCE(a.little_theme, sa.little_theme),
        design_style = COALESCE(a.design_style, sa.design_style),
        cover_description = COALESCE(a.cover_description, sa.cover_description)
      FROM source_asset sa, siblings s
      WHERE a.id = s.id AND (
        (a.licensor_id IS NULL AND sa.licensor_id IS NOT NULL) OR
        (a.property_id IS NULL AND sa.property_id IS NOT NULL) OR
        (a.is_licensed IS NOT TRUE AND sa.is_licensed = true) OR
        (a.big_theme IS NULL AND sa.big_theme IS NOT NULL) OR
        (a.little_theme IS NULL AND sa.little_theme IS NOT NULL) OR
        (a.design_style IS NULL AND sa.design_style IS NOT NULL) OR
        (a.cover_description IS NULL AND sa.cover_description IS NOT NULL)
      )
      RETURNING 1
    )
    SELECT (SELECT count(*)::int FROM inserted_tags) + (SELECT count(*)::int FROM inserted_chars)
    INTO v_batch_propagated;
    v_total_propagated := v_total_propagated + COALESCE(v_batch_propagated, 0);
  END LOOP;
  RETURN QUERY SELECT v_next_cursor, v_total_propagated, 0::int, (v_group_count < p_batch_size);
END;
$$;

-- 4.23 reconcile_style_group_stats_batch
CREATE OR REPLACE FUNCTION public.reconcile_style_group_stats_batch(
  p_cursor uuid DEFAULT NULL, p_batch_size integer DEFAULT 200, p_sub text DEFAULT 'counts'
)
RETURNS TABLE(next_cursor uuid, processed integer, sub text, done boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_ids uuid[];
  v_count int;
  v_last_id uuid;
  v_done boolean;
BEGIN
  SELECT array_agg(sg.id ORDER BY sg.id), count(*)::int
  INTO v_ids, v_count
  FROM (SELECT sg2.id FROM style_groups sg2
        WHERE (p_cursor IS NULL OR sg2.id > p_cursor)
        ORDER BY sg2.id LIMIT p_batch_size) sg;
  v_done := (v_count < p_batch_size);
  IF v_count = 0 THEN
    IF p_sub = 'counts' THEN
      RETURN QUERY SELECT NULL::uuid, 0, 'counts_done'::text, false;
    ELSE
      RETURN QUERY SELECT NULL::uuid, 0, 'complete'::text, true;
    END IF;
    RETURN;
  END IF;
  v_last_id := v_ids[array_length(v_ids, 1)];
  IF p_sub = 'counts' THEN
    PERFORM refresh_style_group_counts_batch(v_ids);
    IF v_done THEN
      RETURN QUERY SELECT v_last_id, v_count, 'counts_done'::text, false;
    ELSE
      RETURN QUERY SELECT v_last_id, v_count, 'counts'::text, false;
    END IF;
  ELSIF p_sub = 'primaries' THEN
    PERFORM refresh_style_group_primaries(v_ids);
    RETURN QUERY SELECT v_last_id, v_count, p_sub, v_done;
  ELSE
    RAISE EXCEPTION 'Unknown sub-stage: %', p_sub;
  END IF;
END;
$$;

-- 4.24 update_bulk_operation
CREATE OR REPLACE FUNCTION public.update_bulk_operation(p_op_key text, p_op_state jsonb, p_only_if_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current jsonb;
  v_existing_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));
  SELECT value INTO v_current FROM admin_config WHERE key = 'BULK_OPERATIONS';
  v_current := COALESCE(v_current, '{}'::jsonb);
  IF p_only_if_status IS NOT NULL THEN
    v_existing_status := v_current->p_op_key->>'status';
    IF v_existing_status IS DISTINCT FROM p_only_if_status THEN
      RETURN v_current;
    END IF;
  END IF;
  v_current := jsonb_set(v_current, ARRAY[p_op_key], p_op_state);
  INSERT INTO admin_config (key, value, updated_at)
  VALUES ('BULK_OPERATIONS', v_current, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
  RETURN v_current;
END;
$$;

-- 4.25 update_bulk_operations_batch
CREATE OR REPLACE FUNCTION public.update_bulk_operations_batch(p_updates jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current jsonb;
  v_key text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));
  SELECT value INTO v_current FROM admin_config WHERE key = 'BULK_OPERATIONS';
  v_current := COALESCE(v_current, '{}'::jsonb);
  FOR v_key IN SELECT jsonb_object_keys(p_updates) LOOP
    v_current := jsonb_set(v_current, ARRAY[v_key], p_updates->v_key);
  END LOOP;
  INSERT INTO admin_config (key, value, updated_at)
  VALUES ('BULK_OPERATIONS', v_current, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
  RETURN v_current;
END;
$$;


-- ── 5. Triggers ─────────────────────────────────────────────────────────────

-- Auth trigger (handle_new_user on auth.users)
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at triggers
CREATE TRIGGER update_licensors_updated_at BEFORE UPDATE ON public.licensors FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_characters_updated_at BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_style_groups_updated_at BEFORE UPDATE ON public.style_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_erp_items_current_updated_at BEFORE UPDATE ON public.erp_items_current FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Assets triggers
CREATE TRIGGER trg_compute_primary_sort_tier
  BEFORE INSERT OR UPDATE OF filename, thumbnail_url, thumbnail_error ON public.assets
  FOR EACH ROW EXECUTE FUNCTION compute_primary_sort_tier();

CREATE TRIGGER trg_auto_queue_render
  AFTER INSERT OR UPDATE OF thumbnail_error, thumbnail_url ON public.assets
  FOR EACH ROW EXECUTE FUNCTION auto_queue_render();

CREATE TRIGGER trg_sync_primary_on_thumbnail
  AFTER UPDATE OF thumbnail_url ON public.assets
  FOR EACH ROW EXECUTE FUNCTION sync_primary_asset_on_thumbnail();

CREATE TRIGGER trg_sync_designer_to_style_group
  AFTER INSERT OR UPDATE OF designer_name, technical_designer_name, freelancer_name, style_group_id ON public.assets
  FOR EACH ROW EXECUTE FUNCTION sync_designer_to_style_group();

CREATE TRIGGER trg_sync_cover_description_to_style_group
  AFTER INSERT OR UPDATE OF cover_description, style_group_id ON public.assets
  FOR EACH ROW EXECUTE FUNCTION sync_cover_description_to_style_group();

-- Asset tags trigger
CREATE TRIGGER trg_sync_asset_tags
  AFTER INSERT OR DELETE OR UPDATE ON public.asset_tags
  FOR EACH ROW EXECUTE FUNCTION sync_asset_tags_to_array();


-- ── 6. RLS Policies ────────────────────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_path_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_enrichment_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_items_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_items_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hygiene_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licensors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_category_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_subtypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.render_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.style_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiff_optimization_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- admin_config
CREATE POLICY "Authenticated read admin_config" ON public.admin_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write admin_config" ON public.admin_config FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin update admin_config" ON public.admin_config FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin delete admin_config" ON public.admin_config FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- agent_pairings
CREATE POLICY "Admin manage agent_pairings" ON public.agent_pairings FOR ALL USING (has_role(auth.uid(), 'admin'));

-- agent_registrations
CREATE POLICY "Admin manage agent_registrations" ON public.agent_registrations FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- asset_characters
CREATE POLICY "Authenticated read asset_characters" ON public.asset_characters FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write asset_characters" ON public.asset_characters FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- asset_path_history
CREATE POLICY "Authenticated read asset_path_history" ON public.asset_path_history FOR SELECT TO authenticated USING (true);

-- asset_tags
CREATE POLICY "Authenticated read asset_tags" ON public.asset_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manage asset_tags" ON public.asset_tags FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- assets
CREATE POLICY "Authenticated users can read visible assets" ON public.assets FOR SELECT TO authenticated USING (is_deleted = false);
CREATE POLICY "Admins can insert assets" ON public.assets FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update assets" ON public.assets FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- characters
CREATE POLICY "Authenticated read characters" ON public.characters FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write characters" ON public.characters FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- erp_enrichment_log
CREATE POLICY "Admin manage erp_enrichment_log" ON public.erp_enrichment_log FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- erp_items_current
CREATE POLICY "Admin manage erp_items_current" ON public.erp_items_current FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- erp_items_raw
CREATE POLICY "Admin manage erp_items_raw" ON public.erp_items_raw FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- erp_sync_runs
CREATE POLICY "Admin manage erp_sync_runs" ON public.erp_sync_runs FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- hygiene_findings
CREATE POLICY "Admin manage hygiene_findings" ON public.hygiene_findings FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- invitations
CREATE POLICY "Admin manage invitations" ON public.invitations FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- licensors
CREATE POLICY "Authenticated read licensors" ON public.licensors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write licensors" ON public.licensors FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- processing_queue
CREATE POLICY "Admin manage processing_queue" ON public.processing_queue FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- product_categories
CREATE POLICY "Authenticated read product_categories" ON public.product_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write product_categories" ON public.product_categories FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- product_category_predictions
CREATE POLICY "Admin manage product_category_predictions" ON public.product_category_predictions FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- product_subtypes
CREATE POLICY "Authenticated read product_subtypes" ON public.product_subtypes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write product_subtypes" ON public.product_subtypes FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- product_types
CREATE POLICY "Authenticated read product_types" ON public.product_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write product_types" ON public.product_types FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- profiles
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read all profiles" ON public.profiles FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- properties
CREATE POLICY "Authenticated read properties" ON public.properties FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write properties" ON public.properties FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- render_queue
CREATE POLICY "Admin manage render_queue" ON public.render_queue FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- style_groups
CREATE POLICY "Authenticated users can read style_groups" ON public.style_groups FOR SELECT USING (true);
CREATE POLICY "Admins can manage style_groups" ON public.style_groups FOR ALL USING (has_role(auth.uid(), 'admin'));

-- tiff_optimization_queue
CREATE POLICY "Admin manage tiff_optimization_queue" ON public.tiff_optimization_queue FOR ALL USING (has_role(auth.uid(), 'admin'));

-- user_roles
CREATE POLICY "Admins manage user_roles" ON public.user_roles FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));


-- ── 7. Realtime Publication ─────────────────────────────────────────────────
-- (Only add tables that your app subscribes to in real time)
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.assets;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.processing_queue;


-- ── DONE ────────────────────────────────────────────────────────────────────
-- Next: Import data CSVs with session_replication_role = 'replica'
-- Then: Re-enable with SET session_replication_role = 'origin';
