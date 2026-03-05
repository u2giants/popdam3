
-- 1) Create asset_tags table
CREATE TABLE public.asset_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  tag text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  UNIQUE(asset_id, tag)
);

-- 2) Indexes
CREATE INDEX idx_asset_tags_asset_id ON public.asset_tags(asset_id);
CREATE INDEX idx_asset_tags_source ON public.asset_tags(source);

-- 3) Enable RLS
ALTER TABLE public.asset_tags ENABLE ROW LEVEL SECURITY;

-- 4) RLS policies
CREATE POLICY "Authenticated read asset_tags"
  ON public.asset_tags FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin manage asset_tags"
  ON public.asset_tags FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5) Backfill from existing tags array
INSERT INTO public.asset_tags (asset_id, tag, source, created_at)
SELECT
  a.id,
  unnest(a.tags),
  CASE WHEN a.ai_tagged_at IS NOT NULL THEN 'ai' ELSE 'manual' END,
  COALESCE(a.ai_tagged_at, a.created_at)
FROM public.assets a
WHERE array_length(a.tags, 1) > 0
ON CONFLICT (asset_id, tag) DO NOTHING;

-- 6) Sync trigger: rebuild assets.tags from asset_tags on INSERT/DELETE/UPDATE
CREATE OR REPLACE FUNCTION public.sync_asset_tags_to_array()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_asset_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_asset_id := OLD.asset_id;
  ELSE
    v_asset_id := NEW.asset_id;
  END IF;

  UPDATE public.assets
  SET tags = COALESCE(
    (SELECT array_agg(at.tag ORDER BY at.tag) FROM public.asset_tags at WHERE at.asset_id = v_asset_id),
    '{}'::text[]
  )
  WHERE id = v_asset_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_asset_tags
  AFTER INSERT OR DELETE OR UPDATE ON public.asset_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_asset_tags_to_array();
