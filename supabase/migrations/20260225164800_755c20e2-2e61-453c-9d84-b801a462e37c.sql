CREATE UNIQUE INDEX uq_render_queue_asset_active
ON public.render_queue (asset_id)
WHERE status IN ('pending', 'claimed');