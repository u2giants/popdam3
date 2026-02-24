
-- Style Groups table
CREATE TABLE public.style_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  folder_path TEXT NOT NULL,
  primary_asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  asset_count INTEGER DEFAULT 0,
  workflow_status public.workflow_status DEFAULT 'other',
  is_licensed BOOLEAN DEFAULT false,
  licensor_code TEXT,
  licensor_name TEXT,
  property_code TEXT,
  property_name TEXT,
  product_category TEXT,
  division_code TEXT,
  division_name TEXT,
  mg01_code TEXT,
  mg01_name TEXT,
  mg02_code TEXT,
  mg02_name TEXT,
  mg03_code TEXT,
  mg03_name TEXT,
  size_code TEXT,
  size_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add style_group_id FK to assets
ALTER TABLE public.assets ADD COLUMN style_group_id UUID REFERENCES public.style_groups(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX idx_assets_style_group_id ON public.assets(style_group_id);
CREATE INDEX idx_style_groups_sku ON public.style_groups(sku);

-- RLS
ALTER TABLE public.style_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read style_groups"
ON public.style_groups
FOR SELECT
USING (true);

CREATE POLICY "Admins can manage style_groups"
ON public.style_groups
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Updated_at trigger
CREATE TRIGGER update_style_groups_updated_at
BEFORE UPDATE ON public.style_groups
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
