
-- ============================================================
-- ERP Enrichment Pipeline — Schema Migration
-- ============================================================

-- 1) erp_sync_runs: Job metadata for each sync execution
CREATE TABLE public.erp_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  total_fetched int DEFAULT 0,
  total_upserted int DEFAULT 0,
  total_errors int DEFAULT 0,
  error_samples jsonb DEFAULT '[]'::jsonb,
  run_metadata jsonb DEFAULT '{}'::jsonb,
  created_by text
);

ALTER TABLE public.erp_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage erp_sync_runs" ON public.erp_sync_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2) erp_items_raw: Immutable audit snapshots
CREATE TABLE public.erp_items_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  sync_run_id uuid REFERENCES public.erp_sync_runs(id) ON DELETE SET NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_erp_items_raw_external_id ON public.erp_items_raw (external_id);
CREATE INDEX idx_erp_items_raw_sync_run_id ON public.erp_items_raw (sync_run_id);

ALTER TABLE public.erp_items_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage erp_items_raw" ON public.erp_items_raw
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) erp_items_current: Latest normalized row per ERP item
CREATE TABLE public.erp_items_current (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE NOT NULL,
  style_number text,
  item_description text,
  mg_category text,
  mg01_code text,
  mg02_code text,
  mg03_code text,
  mg04_code text,
  mg05_code text,
  mg06_code text,
  size_code text,
  licensor_code text,
  property_code text,
  division_code text,
  erp_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  sync_run_id uuid REFERENCES public.erp_sync_runs(id) ON DELETE SET NULL,
  source_system text NOT NULL DEFAULT 'designflow',
  raw_mg_fields jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_erp_items_current_style_number ON public.erp_items_current (style_number);
CREATE INDEX idx_erp_items_current_mg_category ON public.erp_items_current (mg_category);
CREATE INDEX idx_erp_items_current_synced_at ON public.erp_items_current (synced_at);

ALTER TABLE public.erp_items_current ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage erp_items_current" ON public.erp_items_current
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) product_category_predictions: AI classification results
CREATE TABLE public.product_category_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  erp_item_id uuid REFERENCES public.erp_items_current(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  predicted_category text NOT NULL,
  confidence real NOT NULL,
  rationale text,
  classification_source text NOT NULL DEFAULT 'ai',
  ai_model text,
  ai_prompt_version text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  input_context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pcp_status ON public.product_category_predictions (status);
CREATE INDEX idx_pcp_erp_item_id ON public.product_category_predictions (erp_item_id);

ALTER TABLE public.product_category_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage product_category_predictions" ON public.product_category_predictions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5) erp_enrichment_log: Per-field provenance tracking
CREATE TABLE public.erp_enrichment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  source text NOT NULL,
  confidence real,
  run_id uuid,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_eel_target_id ON public.erp_enrichment_log (target_id);
CREATE INDEX idx_eel_run_id ON public.erp_enrichment_log (run_id);

ALTER TABLE public.erp_enrichment_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage erp_enrichment_log" ON public.erp_enrichment_log
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 6) updated_at trigger for erp_items_current
CREATE TRIGGER set_erp_items_current_updated_at
  BEFORE UPDATE ON public.erp_items_current
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
