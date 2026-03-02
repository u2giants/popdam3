CREATE OR REPLACE FUNCTION public.refresh_style_group_stats()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.style_groups sg
  SET
    asset_count = sub.count,
    latest_file_date = sub.latest_date,
    updated_at = now()
  FROM (
    SELECT style_group_id, count(*) AS count, max(modified_at) AS latest_date
    FROM public.assets
    WHERE is_deleted = false AND style_group_id IS NOT NULL
    GROUP BY style_group_id
  ) AS sub
  WHERE sg.id = sub.style_group_id;
$$;