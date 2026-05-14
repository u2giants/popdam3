-- Allow any authenticated user to set the cover image on a style group,
-- but only update the 4 cover-specific columns (not workflow_status, sku, etc.)
CREATE OR REPLACE FUNCTION public.set_style_group_cover(
  p_group_id uuid,
  p_asset_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset assets%ROWTYPE;
BEGIN
  -- Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Fetch the asset and verify it belongs to this style group
  SELECT * INTO v_asset FROM public.assets WHERE id = p_asset_id AND is_deleted = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;
  IF v_asset.style_group_id IS DISTINCT FROM p_group_id THEN
    RAISE EXCEPTION 'Asset does not belong to this style group';
  END IF;

  -- Update only the cover columns
  UPDATE public.style_groups
  SET
    primary_asset_id        = p_asset_id,
    primary_asset_type      = v_asset.asset_type,
    primary_thumbnail_url   = v_asset.thumbnail_url,
    primary_thumbnail_error = v_asset.thumbnail_error,
    updated_at              = now()
  WHERE id = p_group_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.set_style_group_cover(uuid, uuid) TO authenticated;
