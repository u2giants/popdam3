-- Production PO header sync from PLM.
-- One style/SKU can have multiple production PO numbers.

CREATE TABLE public.prod_order_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  total_fetched int NOT NULL DEFAULT 0,
  total_upserted int NOT NULL DEFAULT 0,
  total_errors int NOT NULL DEFAULT 0,
  error_samples jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL DEFAULT 'admin-api'
);

CREATE INDEX idx_prod_order_sync_runs_started_at
  ON public.prod_order_sync_runs (started_at DESC);

ALTER TABLE public.prod_order_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage prod_order_sync_runs"
ON public.prod_order_sync_runs
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages prod_order_sync_runs"
ON public.prod_order_sync_runs
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE public.prod_order_headers_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  sync_run_id uuid REFERENCES public.prod_order_sync_runs(id) ON DELETE SET NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prod_order_headers_raw_external_id
  ON public.prod_order_headers_raw (external_id);
CREATE INDEX idx_prod_order_headers_raw_sync_run_id
  ON public.prod_order_headers_raw (sync_run_id);

ALTER TABLE public.prod_order_headers_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage prod_order_headers_raw"
ON public.prod_order_headers_raw
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages prod_order_headers_raw"
ON public.prod_order_headers_raw
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE public.prod_order_headers_current (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  prod_order_number text NOT NULL,
  style_number text NOT NULL,
  order_status text,
  customer_code text,
  customer_name text,
  quantity numeric,
  due_date date,
  order_date date,
  erp_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  sync_run_id uuid REFERENCES public.prod_order_sync_runs(id) ON DELETE SET NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prod_order_headers_current_style_number
  ON public.prod_order_headers_current (style_number);
CREATE INDEX idx_prod_order_headers_current_prod_order_number
  ON public.prod_order_headers_current (prod_order_number);
CREATE INDEX idx_prod_order_headers_current_due_date
  ON public.prod_order_headers_current (due_date);

ALTER TABLE public.prod_order_headers_current ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read prod_order_headers_current"
ON public.prod_order_headers_current
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins manage prod_order_headers_current"
ON public.prod_order_headers_current
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages prod_order_headers_current"
ON public.prod_order_headers_current
TO service_role
USING (true)
WITH CHECK (true);

CREATE TRIGGER update_prod_order_headers_current_updated_at
BEFORE UPDATE ON public.prod_order_headers_current
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.prod_order_headers_current IS
  'Latest production PO headers from PLM/ERP, keyed to PopDAM styles by style_number.';
COMMENT ON COLUMN public.prod_order_headers_current.prod_order_number IS
  'Production PO number shown on style groups. A style_number can have many production POs.';
