
-- Generic hygiene findings table for all file health checks
CREATE TABLE public.hygiene_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  relative_path text NOT NULL,
  filename text NOT NULL,
  check_type text NOT NULL,  -- e.g. 'ai_embedded_raster', 'tiff_uncompressed', 'psd_oversized_layer'
  severity text NOT NULL DEFAULT 'warning',  -- 'info', 'warning', 'critical'
  status text NOT NULL DEFAULT 'open',  -- 'open', 'dismissed', 'resolved'
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- For ai_embedded_raster: { embedded_count, total_embedded_bytes, largest_raster_bytes, raster_items: [...] }
  scan_session_id text,
  found_by_agent text,
  found_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_hygiene_findings_check_type ON public.hygiene_findings(check_type);
CREATE INDEX idx_hygiene_findings_status ON public.hygiene_findings(status);
CREATE INDEX idx_hygiene_findings_asset_id ON public.hygiene_findings(asset_id);
CREATE INDEX idx_hygiene_findings_relative_path ON public.hygiene_findings(relative_path);

-- Prevent duplicate findings for the same file + check type
CREATE UNIQUE INDEX uq_hygiene_findings_path_check 
  ON public.hygiene_findings(relative_path, check_type) 
  WHERE status != 'resolved';

-- RLS
ALTER TABLE public.hygiene_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage hygiene_findings"
  ON public.hygiene_findings FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
