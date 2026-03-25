-- Add BEFORE UPDATE trigger on assets to keep updated_at current.
-- This was missing — all other key tables (style_groups, licensors, etc.) have it.
-- Without it, the ERP enrichment live log (which queries WHERE updated_at >= startedAt)
-- always returns zero results because updated_at never changes on bulk writes.

CREATE OR REPLACE FUNCTION public.set_assets_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_assets_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_assets_updated_at();
