ALTER TABLE public.assets ADD COLUMN ai_tagged_at TIMESTAMPTZ;
CREATE INDEX idx_assets_ai_tagged_at ON public.assets(ai_tagged_at) WHERE ai_tagged_at IS NOT NULL;